// app/api/sso/refresh/route.ts
// SSO 令牌刷新端点（架构 §5.3 M1，token spec FR-004~FR-010）
// - POST：读取请求 cookie 的 refresh_token → tokenRefresher.refreshIfNeeded()（含触发判定与单飞）
//   - 成功：setSessionCookies 回写新 access/refresh_token（refresh 替换 + access maxAge 按新 expires_in 重置，
//     FR-006/007）；id_token 保持请求中的原值（FR-008：刷新响应不返回 id_token）
//   - invalid_grant：onInvalidGrant 清全部 token cookie + 返回 401（引导重新登录，FR-009）
//   - 无 refresh_token cookie：401 AUTH_SESSION_INVALID（FR-003 语义）
// - GET：405（仅 POST，与 authorize 端点一致）
// 错误 envelope { success:false, error:{ code, message } }；文案仅安全通用描述（FR-026）

import { NextRequest, NextResponse } from 'next/server';
import { tokenRefresher } from '@/app/lib/sso/token-refresher';
import { setSessionCookies, ID_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie';
import { getSsoConfig } from '@/app/lib/sso/config';

/** 错误响应信封（FR-026：仅错误码 + 安全通用文案，不泄漏内部细节） */
function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** GET 不支持（仅 POST，架构 §5.3） */
export async function GET(): Promise<NextResponse> {
  return errorResponse(405, 'METHOD_NOT_ALLOWED', '仅支持 POST 请求');
}

/**
 * POST /api/sso/refresh — 令牌按需刷新（FR-004~FR-010）
 * 成功回写新 access/refresh cookie；失败按错误码分类返回（invalid_grant 附带清 cookie）
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refresh = await tokenRefresher.refreshIfNeeded(request);

  if (!refresh.success) {
    const code = refresh.error?.code ?? 'AUTH_REFRESH_FAILED';
    switch (code) {
      case 'AUTH_SESSION_INVALID':
        return errorResponse(401, 'AUTH_SESSION_INVALID', '登录会话无效，请重新登录');
      case 'AUTH_INVALID_GRANT': {
        const response = errorResponse(401, 'AUTH_INVALID_GRANT', '登录会话已失效，请重新登录');
        await tokenRefresher.onInvalidGrant(response);
        return response;
      }
      case 'AUTH_IDP_RATE_LIMITED':
        return errorResponse(429, 'AUTH_IDP_RATE_LIMITED', '身份服务繁忙，请稍后重试');
      case 'AUTH_IDP_UNREACHABLE':
        return errorResponse(502, 'AUTH_IDP_UNREACHABLE', '身份服务暂时不可用，请稍后重试');
      default:
        return errorResponse(500, 'AUTH_REFRESH_FAILED', '令牌刷新失败，请稍后重试');
    }
  }

  // 无需刷新（access_token 剩余有效期充足，FR-004）：保持现有 cookie 不变
  const tokens = refresh.data;
  if (tokens === undefined) {
    return NextResponse.json({ success: true, data: {} });
  }

  // 刷新成功（FR-006/007）：立即替换 refresh_token + 覆盖 access_token（maxAge 按新 expires_in 重置）
  // id_token 不更新（FR-008：刷新响应不含 id_token，沿用请求中的原值）
  const config = getSsoConfig();
  const response = NextResponse.json({ success: true, data: {} });
  setSessionCookies(
    response,
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: request.cookies.get(ID_TOKEN_COOKIE_NAME)?.value ?? '',
      expiresIn: tokens.expires_in,
    },
    config.refreshTokenMaxAgeDays,
  );
  return response;
}
