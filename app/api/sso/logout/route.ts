// app/api/sso/logout/route.ts
// SSO 登出端点（架构 §5.3，auth spec FR-019~FR-023，模块 M7）
// - 仅 POST（AR2-007）：GET → 405（Method Not Allowed）
// - POST 流程（FR-019 编排顺序）：
//   ① 从 cookie 读 sso_access_token / sso_refresh_token / sso_id_token
//   ② 读请求体可选 post_logout_redirect_uri（用户可控输入 Zod 校验格式与长度，FR-019）
//   ③ 白名单校验（FR-022/023；非法 → 400 AUTH_LOGOUT_REDIRECT_INVALID，但 cookie 仍须清除）
//   ④ revokeTokens：顺序 revoke access→refresh，失败不阻断（FR-020）
//   ⑤ clearSessionCookies：清三会话 cookie（FR-019 ②；错误路径也清，FR-022）
//   ⑥ 无 redirect → 200 {success:true}；有合法 redirect → 200 end_session HTML form
//      自动提交页（AR1-002），页面 POST 提交 IDP（id_token 为 PII 仅 body，AR2-008）
// - Discovery 获取 end_session_endpoint 失败 → 500 AUTH_IDP_DISCOVERY_FAILED（cookie 仍清）
// - 日志/响应脱敏（FR-026）：不输出 token/state 明文

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { logoutService } from '@/app/lib/sso/logout-service';
import { logoutFormSchema } from '@/app/lib/sso/schemas';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '@/app/lib/sso/token-cookie';
import { logger } from '@/app/lib/logging/logger';

/** 错误响应信封（auth spec §3.7，FR-026 仅错误码 + 安全通用文案） */
function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** GET 不支持（仅 POST，架构 §5.3，AR2-007） */
export async function GET(): Promise<NextResponse> {
  return errorResponse(405, 'METHOD_NOT_ALLOWED', '仅支持 POST 请求');
}

/** 登出编排：revoke → 清 cookie → （可选）end_session form 页 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ① 从 cookie 读会话 token（FR-019；缺失即视为本地无会话，仍继续清 cookie 与构造）
    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)?.value;
    const idToken = request.cookies.get(ID_TOKEN_COOKIE_NAME)?.value;

    // ② 读请求体可选 post_logout_redirect_uri（Zod 校验格式与长度，FR-019 用户可控输入）
    const form = await request.formData();
    const rawRedirect = form.get('post_logout_redirect_uri');
    const redirectValue = typeof rawRedirect === 'string' ? rawRedirect : '';
    const parsed = logoutFormSchema.safeParse({ post_logout_redirect_uri: redirectValue });
    // 空串视为未提供；格式非法（超长/非字符串）→ 视为不合法跳转目标
    const redirect =
      parsed.success && parsed.data.post_logout_redirect_uri !== undefined
        ? parsed.data.post_logout_redirect_uri
        : undefined;
    const effectiveRedirect = redirect !== undefined && redirect.length > 0 ? redirect : undefined;

    // ③ 白名单校验（FR-022/023）；提供了但非法 → 400（cookie 仍须清除，FR-022 错误路径）
    const redirectAllowed =
      effectiveRedirect !== undefined &&
      logoutService.isLogoutRedirectAllowed(effectiveRedirect);
    if (effectiveRedirect !== undefined && !redirectAllowed) {
      logger.warn('SSO 登出重定向目标不在白名单，仅本地登出');
    }

    // ④ revoke（顺序 access→refresh，失败不阻断，FR-020）
    await logoutService.revokeTokens(accessToken, refreshToken);

    // ⑤/⑥ 构造响应（先在响应上清 cookie，FR-019 ②/FR-022）
    let response: NextResponse;
    if (redirectAllowed && effectiveRedirect !== undefined) {
      // 有合法 redirect → end_session HTML form 自动提交页（AR1-002）
      const pageResult = await logoutService.buildEndSessionPage({
        idTokenHint: idToken,
        postLogoutRedirectUri: effectiveRedirect,
      });
      if (!pageResult.success) {
        response = errorResponse(500, 'AUTH_IDP_DISCOVERY_FAILED', '登出服务配置获取失败，请稍后重试');
      } else {
        response = new NextResponse(pageResult.data?.html ?? '', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    } else if (effectiveRedirect !== undefined) {
      // 提供了但非法（白名单外/非法格式）→ 400，cookie 仍清（FR-022）
      response = errorResponse(400, 'AUTH_LOGOUT_REDIRECT_INVALID', '登出跳转地址不合法');
    } else {
      // 无 redirect → 200 {success:true}（FR-021）
      response = NextResponse.json({ success: true });
    }
    logoutService.clearSessionCookies(response);
    return response;
  } catch (error) {
    logger.error('SSO logout 处理异常');
    // 异常路径也清 cookie（登出不可被阻断，FR-020）
    const response = errorResponse(500, 'AUTH_LOGIN_IDP_ERROR', '登出失败，请稍后重试');
    logoutService.clearSessionCookies(response);
    return response;
  }
}
