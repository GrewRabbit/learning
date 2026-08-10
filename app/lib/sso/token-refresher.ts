// app/lib/sso/token-refresher.ts
// SSO 令牌刷新服务（架构 §5.2，模块 M3，token spec FR-004~FR-010）
// 职责：
//   - 触发判定（FR-004）：access_token 剩余有效期 <60s（decode exp 计算）才发起刷新；供步骤 8 requireAuth 复用
//   - 单飞 inflight（FR-005）：同一 refresh_token 同一时刻至多一个刷新请求在途，并发触发复用同一 Promise
//   - 轮换（FR-006/007）：经 oauthClient.refreshToken 换取新令牌，成功立即返回新 TokenResponse；
//     新 access/refresh 的 cookie 回写由调用方（路由层）负责，本模块不写 cookie
//   - FR-008：刷新响应不含 id_token 时本模块不关心、不更新（id_token cookie 由路由层保持原值）
//   - 失败分类（FR-009/010）：invalid_grant 由 onInvalidGrant 清全部 token cookie + 安全告警；
//     invalid_client 不重试记配置错误；429/5xx/网络重试已在 oauth-client 实现，本层不重复
// 日志脱敏（FR-022/026）：不输出任何 token 明文
// 运行分层：本模块仅 Node 层使用（requireAuth / 受保护 API），可安全使用 Buffer 等 Node 特性

import type { NextRequest, NextResponse } from 'next/server';
import type { ServiceResult } from '@/app/lib/ai/types';
import type { TokenResponse } from './types';
import { oauthClient } from './oauth-client';
import { auditLogger } from '@/app/lib/logging/audit-logger';
import { logger } from '@/app/lib/logging/logger';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
} from './token-cookie';

/** 触发刷新阈值：access_token 剩余有效期小于该秒数即触发（FR-004，默认提前 60 秒） */
export const REFRESH_THRESHOLD_SECONDS = 60;

/** 安全告警日志错误码（token spec FR-009；与 oauth-client 刷新路径错误码一致） */
const INVALID_GRANT_CODE = 'AUTH_INVALID_GRANT';

/** 构造注入选项：now 为可控时钟（默认 Date.now），fetchFn 保留 DI 占位（IDP 调用经 oauthClient 单例） */
export interface TokenRefresherOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** 解析 JWT payload 的 exp（Unix 秒）；非三段 / 非法 JSON / 无 exp → undefined（不做签名验证） */
function decodeJwtExp(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  let payloadJson: string;
  try {
    payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null) {
      return undefined;
    }
    const exp = (payload as Record<string, unknown>).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

/** cookie 清除安全属性（与 token-cookie.ts 一致：secure 仅生产环境） */
function clearOptions(): { httpOnly: boolean; sameSite: 'lax'; path: string; secure: boolean; maxAge: number } {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  };
}

/**
 * 令牌刷新服务单例类（构造注入 now 便于测试可控时钟）
 * 写 cookie 的职责在调用方（路由层）：本模块只读请求 cookie 触发判定、返回新 TokenResponse
 */
export class TokenRefresher {
  private readonly now: () => number;
  private readonly fetchFn: typeof fetch | undefined;
  /** 单飞 inflight Map（FR-005）：key=refresh_token 值，value=在途刷新 Promise */
  private readonly inflight = new Map<string, Promise<ServiceResult<TokenResponse>>>();

  constructor(options?: TokenRefresherOptions) {
    this.now = options?.now ?? Date.now;
    this.fetchFn = options?.fetchFn;
  }

  /**
   * 按需刷新（FR-004~FR-010）
   * - 无 refresh_token cookie → AUTH_SESSION_INVALID（FR-003 语义）
   * - access_token 剩余有效期 ≥60s → 不触发，返回 { success: true }（无 data）
   * - access_token 缺失 / 无法解码 exp → 视为需刷新（恢复路径）
   * - 触发 → oauthClient.refreshToken 轮换；成功返回新 TokenResponse，失败分类透传
   */
  async refreshIfNeeded(request: NextRequest): Promise<ServiceResult<TokenResponse>> {
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)?.value;
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      return {
        success: false,
        error: { code: 'AUTH_SESSION_INVALID', message: '会话中不存在 refresh_token' },
      };
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const remaining = typeof accessToken === 'string' ? this.remainingSeconds(accessToken) : undefined;
    if (remaining !== undefined && remaining >= REFRESH_THRESHOLD_SECONDS) {
      return { success: true };
    }

    return this.dispatchRefresh(refreshToken);
  }

  /**
   * invalid_grant 处置（FR-009）：清除 access/refresh/id_token 全部会话 cookie
   * 并记录安全告警日志（含 AUTH_INVALID_GRANT，不含 token 明文）；返回错误供调用方引导重新登录
   */
  async onInvalidGrant(response: NextResponse): Promise<ServiceResult<void>> {
    const options = clearOptions();
    response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, '', options);
    response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, '', options);
    response.cookies.set(ID_TOKEN_COOKIE_NAME, '', options);
    logger.error(
      `SSO refresh: 安全告警 ${INVALID_GRANT_CODE}（refresh_token 无效/已撤销/被重放），已清除全部会话 cookie`,
      { code: INVALID_GRANT_CODE },
    );
    // invalid_grant 安全告警审计（AR2-010，token spec FR-009/AC-009）：token 窃取检测关键事件，
    // 错误码使用架构 §5.4 的 AUTH_TOKEN_INVALID_GRANT，不含 token 明文（FR-022）
    auditLogger.log('token.invalid_grant', { code: 'AUTH_TOKEN_INVALID_GRANT' });
    return { success: true };
  }

  /** access_token 剩余有效期（秒）；无法解码 → undefined */
  private remainingSeconds(accessToken: string): number | undefined {
    const exp = decodeJwtExp(accessToken);
    if (exp === undefined) {
      return undefined;
    }
    return exp - Math.floor(this.now() / 1000);
  }

  /** 单飞派发（FR-005）：同一 refresh_token 在途时复用既有 Promise，完成后释放 */
  private dispatchRefresh(refreshToken: string): Promise<ServiceResult<TokenResponse>> {
    const existing = this.inflight.get(refreshToken);
    if (existing !== undefined) {
      return existing;
    }
    const promise = this.performRefresh(refreshToken);
    this.inflight.set(refreshToken, promise);
    promise.then(
      () => this.releaseInflight(refreshToken, promise),
      () => this.releaseInflight(refreshToken, promise),
    );
    return promise;
  }

  /** 仅当 map 中仍是本次 Promise 时释放（避免误删后续新请求的条目） */
  private releaseInflight(
    refreshToken: string,
    promise: Promise<ServiceResult<TokenResponse>>,
  ): void {
    if (this.inflight.get(refreshToken) === promise) {
      this.inflight.delete(refreshToken);
    }
  }

  /** 执行 IDP 刷新轮换（FR-006/007）：失败分类记录日志后透传错误，不重试（重试归 oauth-client） */
  private async performRefresh(refreshToken: string): Promise<ServiceResult<TokenResponse>> {
    try {
      const result = await oauthClient.refreshToken({ refresh_token: refreshToken });
      if (!result.success || result.data === undefined) {
        this.logRefreshFailure(result.error?.code, result.error?.message);
        return {
          success: false,
          error: result.error ?? { code: 'AUTH_REFRESH_FAILED', message: '令牌刷新失败' },
        };
      }
      return { success: true, data: result.data };
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_REFRESH_FAILED', message: '令牌刷新失败' },
      };
    }
  }

  /** 刷新失败分类日志（FR-009/010）：invalid_grant 归 onInvalidGrant 告警，本处不重复记录 */
  private logRefreshFailure(code: string | undefined, message: string | undefined): void {
    if (code === INVALID_GRANT_CODE) {
      return;
    }
    if (code === 'AUTH_IDP_ERROR' && typeof message === 'string' && message.includes('invalid_client')) {
      logger.error('SSO refresh: 客户端配置错误（invalid_client），不重试', { code: 'AUTH_IDP_ERROR' });
      return;
    }
    logger.warn('SSO refresh: 刷新失败', { code: code ?? 'AUTH_REFRESH_FAILED' });
  }
}

/** 令牌刷新服务单例（Node 层，供 /api/sso/refresh 与步骤 8 requireAuth 使用） */
export const tokenRefresher = new TokenRefresher();
