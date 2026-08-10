// app/api/sso/authorize/route.ts
// SSO 登录发起端点（架构 §5.3 M1，auth spec FR-002~005/023）
// - POST（form）：校验参数 → 服务端生成权威 PKCE/state/nonce → 写一次性状态 cookie → 302 跳转 IDP
// - GET：405（仅 POST）
// 状态持久化（FR-003）：服务端写 httpOnly 状态 cookie（权威副本），sessionStorage 由前端登录页负责

import { NextResponse } from 'next/server';
import { logger } from '@/app/lib/logging/logger';
import { authorizeFormSchema } from '@/app/lib/sso/schemas';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from '@/app/lib/sso/pkce';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import {
  DEFAULT_RETURN_TO,
  isSafeReturnTo,
  setStateCookie,
  type StateCookiePayload,
} from '@/app/lib/sso/token-cookie';

/** 错误响应信封（auth spec §3.7，FR-026 仅错误码 + 安全通用文案） */
function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** GET 不支持（仅 POST，架构 §5.3） */
export async function GET(): Promise<NextResponse> {
  return errorResponse(405, 'METHOD_NOT_ALLOWED', '仅支持 POST 请求');
}

/** 登录发起：校验表单 → 生成 PKCE → 写状态 cookie → 302 至 IDP authorize 端点 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. 解析 form body
    const form = await request.formData();
    const rawReturnTo = form.get('returnTo');
    const returnToValue = typeof rawReturnTo === 'string' ? rawReturnTo : '';

    // 2. returnTo 规范化（FR-005/023）：仅同源相对路径；非法忽略 → 默认落地页
    const returnTo = isSafeReturnTo(returnToValue) ? returnToValue : DEFAULT_RETURN_TO;

    // 3. Zod 校验提交参数格式与长度（全局代码规范；非法 returnTo 已在步骤 2 忽略，不参与校验）
    const parsed = authorizeFormSchema.safeParse({
      code_verifier: form.get('code_verifier'),
      code_challenge: form.get('code_challenge'),
      state: form.get('state'),
      nonce: form.get('nonce'),
      ...(returnTo === DEFAULT_RETURN_TO ? {} : { returnTo }),
    });
    if (!parsed.success) {
      return errorResponse(400, 'AUTH_LOGIN_MISSING_PARAMS', '登录请求参数缺失或非法');
    }

    // 4. 服务端生成权威 PKCE/state/nonce（FR-002；服务端 cookie 为权威副本，AR1-003 双写）
    const codeVerifier = await generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = await generateState();
    const nonce = await generateNonce();

    // 5. 配置与 Discovery（FR-014：端点一律取自 Discovery，禁止硬编码）
    const config = getSsoConfig();
    const endpointResult = await discoveryService.getEndpoint('authorization_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      logger.error('SSO Discovery 获取 authorization_endpoint 失败', {
        code: endpointResult.error?.code,
      });
      return errorResponse(500, 'AUTH_IDP_DISCOVERY_FAILED', '登录服务配置获取失败，请稍后重试');
    }
    const redirectUri = config.publicRedirectUri;
    if (!redirectUri) {
      logger.error('SSO 未配置 publicRedirectUri');
      return errorResponse(500, 'AUTH_LOGIN_IDP_ERROR', '登录服务配置缺失');
    }

    // 6. 构造 authorize URL（FR-004：client_id/redirect_uri/response_type=code/scope 含 openid/
    //    state/code_challenge/code_challenge_method=S256/nonce）
    const authorizeUrl = new URL(endpointResult.data);
    authorizeUrl.searchParams.set('client_id', config.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', config.scope);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('nonce', nonce);

    // 7. 写一次性状态 cookie（FR-003：httpOnly，code_verifier 禁前端 JS 读取）+ 302（FR-004）
    const payload: StateCookiePayload = { code_verifier: codeVerifier, state, nonce, returnTo };
    const response = NextResponse.redirect(authorizeUrl.toString(), 302);
    setStateCookie(response, payload);
    return response;
  } catch (error) {
    logger.error('SSO authorize 处理异常');
    return errorResponse(500, 'AUTH_LOGIN_IDP_ERROR', '登录失败，请稍后重试');
  }
}
