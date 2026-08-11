// app/lib/auth/guard.ts
// M5 认证守卫（Node 层，架构 §5.2 requireAuth + requireAuthPage + AD-02/AD-04）
// 职责：从请求 Cookie 读取 sso_access_token，本地 JWT 验签（RS256 + kid + iss + aud + exp，fail-closed）
//
// 与 middleware（Edge 粗检）的分工（FR-016）：
//   - middleware：仅 base64url 解码取 exp 做粗检（不验签），Edge Runtime
//   - 本守卫：Node Runtime 完整验签，供受保护 API（/api/solve 等）与受保护页面（requireAuthPage）调用
//
// 验签核心 verifyAccessToken 为 requireAuth 与 requireAuthPage 共用（架构 §5.2），
// JWKS 取 discoveryService.getJwks(kid) 唯一路径（AR1-006）；cookie 读取留在各自入口。
//
// 错误码（token spec FR-025，本文件不重复定义）：
//   - AUTH_TOKEN_EXPIRED：exp 过期
//   - AUTH_SESSION_INVALID：无 token / 解析失败 / 验签失败 / iss、aud 不符 / 结构非法

import { decodeProtectedHeader, importJWK, jwtVerify, errors as joseErrors } from 'jose';
import type { JWK } from 'jose';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ServiceResult } from '@/app/lib/ai/types';
import type { AccessTokenClaims } from '@/app/lib/sso/types';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
} from '@/app/lib/sso/token-cookie';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { getSsoConfig } from '@/app/lib/sso/config';
import { auditLogger } from '@/app/lib/logging/audit-logger';

/** 仅接受 RS256 签名算法（token spec：SP 侧强制 RSA 验签） */
const ALLOWED_ALGORITHM = 'RS256';

/**
 * 从 Cookie 请求头解析指定名称的 cookie 值
 *
 * 手动解析（不引第三方库）：按 ';' 分段、'=' 分割，匹配名称后返回
 * 解码后的值。URL 编码非法时视为该 cookie 不存在（fail-closed）。
 *
 * @param request 原始请求
 * @param name cookie 名称
 * @returns cookie 值；不存在或解析失败返回 undefined
 */
function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = part.slice(0, eqIndex).trim();
    if (key !== name) {
      continue;
    }
    try {
      return decodeURIComponent(part.slice(eqIndex + 1).trim());
    } catch {
      // URL 编码非法 → 视为无此 cookie
      return undefined;
    }
  }
  return undefined;
}

/**
 * 在 JWKS keys 中按 kid 查找匹配的 JWK（同 id-token-verifier 的实现）
 *
 * @param keys JWKS keys 数组
 * @param kid 待匹配的 key id
 * @returns 匹配的 JWK；未命中返回 undefined
 */
function findKeyByKid(keys: unknown[], kid: string): JWK | undefined {
  for (const key of keys) {
    if (typeof key !== 'object' || key === null) {
      continue;
    }
    const candidate = key as { kid?: unknown; kty?: unknown };
    if (candidate.kid === kid && typeof candidate.kty === 'string') {
      return key as JWK;
    }
  }
  return undefined;
}

/**
 * 验签核心（requireAuth 与 requireAuthPage 共用，架构 §5.2；AR1-006 JWKS 唯一路径）
 *
 * 校验流程（fail-closed，任一环节失败即拒绝）：
 * 1. 解析 JWT 结构（三段式），非法 → AUTH_SESSION_INVALID
 * 2. 解受保护头：alg 必须为 RS256、kid 必须存在（token spec FR-003）
 * 3. 经 discoveryService.getJwks(kid) 取 JWKS 并匹配 kid（唯一路径，AR1-006；
 *    kid 未命中时 discoveryService 内部强制刷新缓存重取一次）
 * 4. jose jwtVerify 验签 + iss（=== SSO issuer）+ aud（=== SSO clientId）+ exp 校验
 *    - exp 过期 → AUTH_TOKEN_EXPIRED（AD-04：过期不尝试续期）
 *    - 其余失败 → AUTH_SESSION_INVALID
 *
 * @param token access_token JWT（调用方负责从 cookie 读取）
 * @returns 成功 → AccessTokenClaims（含 sub/iss/aud/exp）；失败 → 对应 AUTH_* 错误码
 */
async function verifyAccessToken(token: string): Promise<ServiceResult<AccessTokenClaims>> {
  const config = getSsoConfig();

  // 1. 解析 JWT 结构（三段式）
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }

  // 2. 解受保护头：alg / kid 校验（token spec FR-003）
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    // 非合法 JWT（解析异常）→ 会话无效
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }
  if (header.alg !== ALLOWED_ALGORITHM || typeof header.kid !== 'string') {
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }

  // 3. JWKS 拉取 + kid 匹配（唯一路径，AR1-006；未命中强制刷新由 discoveryService 内部处理）
  const jwksResult = await discoveryService.getJwks(header.kid);
  if (!jwksResult.success || !jwksResult.data) {
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }
  const jwk = findKeyByKid(jwksResult.data.keys, header.kid);
  if (jwk === undefined) {
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }

  // 4. 验签 + iss/aud/exp 校验（jose 统一处理，fail-closed）
  try {
    const publicKey = await importJWK(jwk, ALLOWED_ALGORITHM);
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [ALLOWED_ALGORITHM],
      issuer: config.issuer,
      audience: config.clientId,
    });
    return { success: true, data: payload as AccessTokenClaims };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      // exp 过期 → AUTH_TOKEN_EXPIRED（AD-04）
      return {
        success: false,
        error: { code: 'AUTH_TOKEN_EXPIRED', message: '登录已过期，请重新登录' },
      };
    }
    // 验签失败 / iss / aud 不符 / 其他异常 → 会话无效
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }
}

/**
 * requireAuth：M5 认证守卫（架构 §5.2，auth FR-016、token FR-003）
 *
 * 供受保护 API（/api/solve 等）调用（现状保留）：从请求 Cookie 读 sso_access_token，
 * 调共用验签核心 verifyAccessToken（fail-closed，iss/aud/exp 校验 + JWKS 唯一路径 AR1-006）。
 * cookie 读取留在本入口，验签核心与 requireAuthPage 共用。
 *
 * @param request 原始请求（读取 Cookie）
 * @returns 成功 → AccessTokenClaims（含 sub/iss/aud/exp）；失败 → 对应 AUTH_* 错误码
 */
export async function requireAuth(request: Request): Promise<ServiceResult<AccessTokenClaims>> {
  // 读取 access_token cookie（缺失 → AUTH_SESSION_INVALID）
  const accessToken = readCookie(request, ACCESS_TOKEN_COOKIE_NAME);
  if (!accessToken) {
    auditLogger.log('auth.session_invalid', { code: 'AUTH_SESSION_INVALID' });
    return {
      success: false,
      error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
    };
  }

  return verifyAccessToken(accessToken);
}

/**
 * requireAuthPage：页面 Node 层深校验入口（v1.3 新增，架构 §5.2 D-003/FR-029，AC-039）
 *
 * 在 RSC server component 内调用（无 request 参数）：从 cookies() 读 sso_access_token，
 * 调共用验签核心 verifyAccessToken（fail-closed，iss/aud/exp 校验 + JWKS 唯一路径 AR1-006）。
 *
 * 失败载体（AR3-006，关键）：RSC server component 内无法返回 NextResponse.redirect——
 * 校验失败时不返回 ServiceResult 走调用方，而是：
 *   1. 经 await 后的 cookies() 实例逐一 delete 清除 sso_access_token / sso_refresh_token /
 *      sso_id_token 三个会话 cookie（cookies() 为只读、Next 15 async API）
 *   2. 调 next/navigation 的 redirect()（抛 NEXT_REDIRECT，302 → /login?returnTo=<当前路径>）
 *      当前路径取 headers() 的 x-pathname 请求头；项目当前未注入该头时退化为顶层 /login（returnTo 省略）
 *
 * @returns 成功 → { success: true, data: AccessTokenClaims }；失败 → 清 cookie + redirect（不返回）
 */
export async function requireAuthPage(): Promise<ServiceResult<AccessTokenClaims>> {
  // 读取 access_token cookie（Next 15 async cookies）
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;

  const result = await verifyAccessToken(accessToken ?? '');

  if (result.success) {
    return result;
  }

  // 失败载体（AR3-006）：cookies() 为只读——经 await 后的实例逐一清除三个会话 cookie
  cookieStore.delete(ACCESS_TOKEN_COOKIE_NAME);
  cookieStore.delete(REFRESH_TOKEN_COOKIE_NAME);
  cookieStore.delete(ID_TOKEN_COOKIE_NAME);

  // 获取当前路径（优先 x-pathname 请求头；项目当前未注入该头 → 退化为顶层 /login，AR1-009 二段式①）
  const headerStore = await headers();
  const pathname = headerStore.get('x-pathname');
  if (pathname) {
    redirect(`/login?returnTo=${encodeURIComponent(pathname)}`);
  }
  redirect('/login');
}
