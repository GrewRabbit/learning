// app/lib/sso/logout-service.ts
// SSO 登出编排服务（架构 §4.1.5 / §5.3，auth spec FR-019~FR-023，模块 M7）
// - revokeTokens：顺序 revoke access_token → refresh_token（token_type_hint 分别
//   'access_token'/'refresh_token'，FR-019 ①）；任一失败不抛出，仅记日志
//   （AUTH_TOKEN_REVOKE_FAILED 仅日志不阻断，FR-013/020）
// - clearSessionCookies：清除 sso_access_token/sso_refresh_token/sso_id_token 三 cookie
//   （FR-019 ②，委托 token-cookie 同属性实现）
// - isLogoutRedirectAllowed：post_logout_redirect_uri 白名单校验（FR-022/023）——
//   复用 isSafeReturnTo 的开放重定向语义（同源相对），再精确命中注册白名单
//   （白名单为空时回退 redirectUris，config.ts 集中定义，OQ-007 默认仅 '/'）
// - buildEndSessionPage：构造 end_session HTML form 自动提交页（AR1-002）——
//   method=POST、action=IDP end_session_endpoint（Discovery）、enctype=x-www-form-urlencoded，
//   隐藏字段 id_token_hint（不可用→回退 client_id，FR-019）/ post_logout_redirect_uri（白名单，FR-022）
//   / state（SP 生成 ≥32 加密随机源，FR-021）；页面 onload 自动 submit；
//   id_token 为 PII 仅 POST body 提交（FR-019/AR2-008）
// - 登出 state 用于 IDP 307 回传校验（FR-021）；本文件只负责生成与构造，
//   307 回传校验端点不在本步骤范围（见 arch-sso-v1.2 §11 后续步骤）
// 日志脱敏（FR-026）：本文件所有日志/返回均不含 token/state 明文

import type { NextResponse } from 'next/server';

import type { ServiceResult } from '@/app/lib/ai/types';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { generateState } from '@/app/lib/sso/pkce';
import {
  clearSessionCookies as clearSessionCookiesInResponse,
  isSafeReturnTo,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig } from '@/app/lib/sso/types';
import { auditLogger } from '@/app/lib/logging/audit-logger';
import { logger } from '@/app/lib/logging/logger';

/** end_session HTML form 页构造参数 */
export interface EndSessionPageParams {
  /** 当前 id_token（sso_id_token cookie；缺失/不可用→回退 client_id，FR-019） */
  idTokenHint?: string;
  /** 登出后跳转地址（已通过白名单校验，FR-022） */
  postLogoutRedirectUri?: string;
}

/** end_session HTML form 页构造输入（含 action 与登出 state） */
interface EndSessionFormInput {
  endSessionEndpoint: string;
  clientId: string;
  idTokenHint?: string;
  postLogoutRedirectUri?: string;
  state: string;
}

/** HTML 属性值转义（防隐藏字段注入；id_token 等值含 base64url 安全字符，client_id 等仍须转义） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * SSO 登出编排服务单例（架构 §4.1.5：revoke → 清 cookie → end_session）
 */
export class LogoutService {
  /** 清除三个会话 cookie（FR-019 ②，委托 token-cookie 同属性实现） */
  clearSessionCookies(response: NextResponse): void {
    clearSessionCookiesInResponse(response);
  }

  /**
   * 顺序 revoke access_token → refresh_token（FR-019 ①）
   * 任一失败不抛出（FR-020：AUTH_TOKEN_REVOKE_FAILED 仅日志，不阻断登出）
   */
  async revokeTokens(accessToken?: string, refreshToken?: string): Promise<void> {
    await this.revokeOne(accessToken, 'access_token');
    await this.revokeOne(refreshToken, 'refresh_token');
    // 登出完成审计（AR2-010）：revoke 不阻断（FR-020），revoke 结束后即视为登出完成
    auditLogger.log('logout.completed');
  }

  /**
   * 单个 token revoke；任一失败（error result 或异常）仅记日志不抛出（FR-020）
   * AUTH_TOKEN_REVOKE_FAILED 仅日志，不阻断登出；不记录 token 明文（FR-026）
   */
  private async revokeOne(
    token: string | undefined,
    hint: 'access_token' | 'refresh_token',
  ): Promise<void> {
    if (!token) {
      return;
    }
    try {
      const result = await oauthClient.revokeToken(token, hint);
      if (!result.success) {
        logger.warn(`SSO revoke ${hint} 失败，不阻断登出（AUTH_TOKEN_REVOKE_FAILED）`, {
          code: result.error?.code,
        });
        auditLogger.log('logout.revoke_failed', { code: 'AUTH_TOKEN_REVOKE_FAILED' });
      }
    } catch {
      logger.warn(`SSO revoke ${hint} 异常，不阻断登出（AUTH_TOKEN_REVOKE_FAILED）`);
      auditLogger.log('logout.revoke_failed', { code: 'AUTH_TOKEN_REVOKE_FAILED' });
    }
  }

  /**
   * post_logout_redirect_uri 白名单校验（FR-022/023）
   * 1. 复用 isSafeReturnTo 开放重定向语义（同源相对路径，拒 //evil.com / javascript: / data: / 跨域）
   * 2. 再精确命中注册白名单（config.logoutRedirectWhitelist，OQ-007 默认 ['/']；
   *    白名单为空时回退 redirectUris → publicRedirectUri，FR-022）
   */
  isLogoutRedirectAllowed(candidate: string | undefined | null): boolean {
    if (typeof candidate !== 'string' || !isSafeReturnTo(candidate)) {
      return false;
    }
    const whitelist = this.getLogoutRedirectWhitelist(getSsoConfig());
    return whitelist.includes(candidate);
  }

  /**
   * 构造 end_session HTML form 自动提交页（AR1-002）
   * - action 取 Discovery end_session_endpoint（FR-014 端点一律取自 Discovery）；获取失败 →
   *   AUTH_IDP_DISCOVERY_FAILED
   * - 登出 state 由 SP 生成（≥32 加密随机源，与登录 state 对齐，FR-021）
   * - id_token_hint 不可用（cookie 缺失）→ 回退 client_id 字段（FR-019）
   * - 返回 {html}；页面 body onload 自动 submit + noscript 手动按钮兜底
   */
  async buildEndSessionPage(
    params: EndSessionPageParams,
  ): Promise<ServiceResult<{ html: string }>> {
    const endpointResult = await discoveryService.getEndpoint('end_session_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      logger.error('SSO Discovery 获取 end_session_endpoint 失败', {
        code: endpointResult.error?.code,
      });
      return {
        success: false,
        error: {
          code: 'AUTH_IDP_DISCOVERY_FAILED',
          message: '登出服务配置获取失败，请稍后重试',
        },
      };
    }
    const config = getSsoConfig();
    const state = await generateState();
    const html = this.buildEndSessionFormHtml({
      endSessionEndpoint: endpointResult.data,
      clientId: config.clientId,
      idTokenHint: params.idTokenHint,
      postLogoutRedirectUri: params.postLogoutRedirectUri,
      state,
    });
    return { success: true, data: { html } };
  }

  /** 登出重定向白名单：config 配置非空用之，为空回退 redirectUris（publicRedirectUri，FR-022） */
  private getLogoutRedirectWhitelist(config: SsoConfig): string[] {
    const configured = config.logoutRedirectWhitelist;
    if (configured && configured.length > 0) {
      return configured;
    }
    if (config.publicRedirectUri) {
      return [config.publicRedirectUri];
    }
    return ['/'];
  }

  /** 构造 end_session HTML form 自动提交页（隐藏字段全部经 HTML 转义；无明文 token 落 URL） */
  private buildEndSessionFormHtml(input: EndSessionFormInput): string {
    const hiddenFields: string[] = [];
    if (input.idTokenHint) {
      // 可用 → id_token_hint（PII，仅 POST body，FR-019/AR2-008）
      hiddenFields.push(
        `<input type="hidden" name="id_token_hint" value="${escapeHtml(input.idTokenHint)}">`,
      );
    } else {
      // 不可用 → 回退 client_id（FR-019）
      hiddenFields.push(
        `<input type="hidden" name="client_id" value="${escapeHtml(input.clientId)}">`,
      );
    }
    if (input.postLogoutRedirectUri) {
      hiddenFields.push(
        `<input type="hidden" name="post_logout_redirect_uri" value="${escapeHtml(input.postLogoutRedirectUri)}">`,
      );
    }
    hiddenFields.push(
      `<input type="hidden" name="state" value="${escapeHtml(input.state)}">`,
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <title>正在退出登录…</title>
</head>
<body onload="document.getElementById('sso-logout-form').submit()">
  <form id="sso-logout-form" method="post" action="${escapeHtml(input.endSessionEndpoint)}" enctype="application/x-www-form-urlencoded">
    ${hiddenFields.join('\n    ')}
    <noscript>
      <button type="submit">继续退出登录</button>
    </noscript>
  </form>
</body>
</html>`;
  }
}

/** SSO 登出编排服务单例 */
export const logoutService = new LogoutService();
