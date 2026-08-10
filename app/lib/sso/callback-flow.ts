// app/lib/sso/callback-flow.ts
// SSO 回调编排（架构 §5.3 R-08：route.ts 为薄适配，编排下沉本文件）
// 流程（auth spec §4.1.2，FR-006~015/023）：
//   error 参数处理 → Zod 校验 → 状态 cookie 恢复 → state 校验 → iss 校验
//   → 令牌交换 → id_token 验证 → userinfo 一致性 → 写会话 cookie + 302 回 returnTo
// 日志脱敏（FR-026）：不输出 access/refresh/id_token、state、code_verifier、client_secret

import { NextRequest, NextResponse } from 'next/server';
import { auditLogger } from '@/app/lib/logging/audit-logger';
import { logger } from '@/app/lib/logging/logger';
import { callbackQuerySchema } from '@/app/lib/sso/schemas';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { idTokenVerifier } from '@/app/lib/sso/id-token-verifier';
import {
  STATE_COOKIE_NAME,
  DEFAULT_RETURN_TO,
  isSafeReturnTo,
  parseStateCookie,
  clearStateCookie,
  setSessionCookies,
} from '@/app/lib/sso/token-cookie';

/** 统一错误响应：envelope {success:false, error:{code, message}}（架构 §5.3） */
function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status },
  );
}

/** 令牌交换失败映射（FR-009/010）：网络失败透传 502，其余统一 AUTH_TOKEN_EXCHANGE_FAILED */
function exchangeErrorResponse(code: string | undefined): NextResponse {
  if (code === 'AUTH_LOGIN_IDP_UNREACHABLE') {
    return errorResponse(502, 'AUTH_LOGIN_IDP_UNREACHABLE', '身份服务暂时不可用，请稍后重试');
  }
  return errorResponse(400, 'AUTH_TOKEN_EXCHANGE_FAILED', '登录失败，请重新登录');
}

/** 重定向目标：returnTo 复检开放重定向（FR-023），非法回默认落地页 */
function resolveRedirect(request: NextRequest, returnTo: string | undefined): string {
  const target = isSafeReturnTo(returnTo) ? (returnTo as string) : DEFAULT_RETURN_TO;
  return new URL(target, request.url).toString();
}

/**
 * SSO 回调编排入口（GET /api/sso/callback）
 * 失败路径均清除一次性状态 cookie（FR-006/007/010）；成功后清除并写会话 cookie（FR-015）
 */
export async function handleCallback(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const rawQuery = Object.fromEntries(url.searchParams.entries());

    // 步骤 1：error 参数（FR-006）——RFC 6749 error 回调不含 code/iss，须先于 schema 处理
    if (typeof rawQuery.error === 'string' && rawQuery.error.length > 0) {
      if (rawQuery.error === 'access_denied') {
        auditLogger.log('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
        const response = errorResponse(400, 'AUTH_LOGIN_IDP_ERROR', '您未授权本次登录，请重新尝试');
        clearStateCookie(response);
        return response;
      }
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
      return errorResponse(400, 'AUTH_LOGIN_IDP_ERROR', '身份提供商返回错误，请重新登录');
    }

    // 步骤 2：Zod 校验 code/state/iss（FR-006，回调参数为用户可控输入）
    const parsed = callbackQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_MISSING_PARAMS' });
      return errorResponse(400, 'AUTH_LOGIN_MISSING_PARAMS', '登录回调参数缺失或非法');
    }
    const { code, state, iss } = parsed.data;

    // 步骤 3：恢复状态 cookie（FR-003，服务端 cookie 为权威）
    const stored = parseStateCookie(request.cookies.get(STATE_COOKIE_NAME)?.value);
    if (!stored) {
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_STATE_MISMATCH' });
      return errorResponse(400, 'AUTH_LOGIN_STATE_MISMATCH', '登录状态已失效，请重新登录');
    }

    // 步骤 4：state 校验（FR-007，一次性）
    if (state !== stored.state) {
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_STATE_MISMATCH' });
      return errorResponse(400, 'AUTH_LOGIN_STATE_MISMATCH', '登录状态校验失败，请重新登录');
    }

    // 步骤 5：iss 校验（FR-008，RFC 9207 防 IDP 混淆）
    if (iss !== discoveryService.getIssuer()) {
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_ISS_MISMATCH' });
      return errorResponse(400, 'AUTH_LOGIN_ISS_MISMATCH', '身份提供商校验失败，请重新登录');
    }

    // 步骤 6：服务端令牌交换（FR-009，前端禁止直连 IDP token 端点）
    const config = getSsoConfig();
    if (!config.publicRedirectUri) {
      logger.error('SSO callback: 未配置 publicRedirectUri');
      auditLogger.log('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
      return errorResponse(500, 'AUTH_LOGIN_IDP_ERROR', '登录服务配置缺失');
    }
    const exchange = await oauthClient.exchangeCode({
      code,
      redirect_uri: config.publicRedirectUri,
      code_verifier: stored.code_verifier,
    });
    if (!exchange.success || exchange.data === undefined) {
      auditLogger.log('login.failure', { code: exchange.error?.code ?? 'AUTH_TOKEN_EXCHANGE_FAILED' });
      const response = exchangeErrorResponse(exchange.error?.code);
      clearStateCookie(response);
      return response;
    }
    const tokens = exchange.data;
    // token 交换响应必须含 id_token（oauth-client exchange 模式已校验，FR-011）
    if (typeof tokens.id_token !== 'string') {
      auditLogger.log('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
      const response = errorResponse(401, 'AUTH_ID_TOKEN_INVALID', '身份令牌校验失败，请重新登录');
      clearStateCookie(response);
      return response;
    }

    // 步骤 7：id_token 8 步验证（FR-011，strict 失败拒绝登录）
    const verify = await idTokenVerifier.verifyIdToken(tokens.id_token, stored.nonce);
    if (!verify.success || verify.data === undefined) {
      auditLogger.log('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
      const response = errorResponse(401, 'AUTH_ID_TOKEN_INVALID', '身份令牌校验失败，请重新登录');
      clearStateCookie(response);
      return response;
    }
    const idClaims = verify.data;

    // 步骤 8：userinfo 获取与 sub 一致性校验（FR-013）；401 等失败仅记录日志（续期归步骤 6）
    const userInfo = await oauthClient.getUserInfo(tokens.access_token);
    if (userInfo.success && userInfo.data !== undefined) {
      if (userInfo.data.sub !== idClaims.sub) {
        logger.warn('SSO callback: userinfo sub 与 id_token sub 不一致');
        auditLogger.log('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
        const response = errorResponse(401, 'AUTH_ID_TOKEN_INVALID', '身份信息校验失败，请重新登录');
        clearStateCookie(response);
        return response;
      }
    } else {
      if (userInfo.error?.code === 'AUTH_LOGIN_IDP_UNREACHABLE') {
        auditLogger.log('login.failure', { code: 'AUTH_LOGIN_IDP_UNREACHABLE' });
        const response = errorResponse(502, 'AUTH_LOGIN_IDP_UNREACHABLE', '身份服务暂时不可用，请稍后重试');
        clearStateCookie(response);
        return response;
      }
      logger.warn('SSO callback: userinfo 获取失败', { code: userInfo.error?.code });
      auditLogger.log('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
      const response = errorResponse(401, 'AUTH_ID_TOKEN_INVALID', '身份信息获取失败，请重新登录');
      clearStateCookie(response);
      return response;
    }

    // 步骤 9：写会话 cookie（FR-015）+ 清一次性状态 cookie + 302 回 returnTo（FR-023）
    // 登录成功审计（AR2-010）：subject 记录 id_token 的 sub（公开标识，FR-026）
    auditLogger.log('login.success', { subject: idClaims.sub });
    const response = NextResponse.redirect(resolveRedirect(request, stored.returnTo), 302);
    setSessionCookies(
      response,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
      },
      config.refreshTokenMaxAgeDays,
    );
    clearStateCookie(response);
    return response;
  } catch (error) {
    logger.error('SSO callback: 处理异常');
    auditLogger.log('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
    return errorResponse(500, 'AUTH_LOGIN_IDP_ERROR', '登录失败，请稍后重试');
  }
}
