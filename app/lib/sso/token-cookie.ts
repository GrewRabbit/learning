// app/lib/sso/token-cookie.ts
// SSO cookie 名称、属性与读写帮助（M1 步骤 5 创建，步骤 6 由 token-cookie/token-refresher 扩展）
// - 状态 cookie（sso_authorize_state）：登录发起时服务端写入的一次性 JSON cookie（FR-003/005）
// - 会话 cookie（sso_access_token / sso_refresh_token / sso_id_token）：登录成功后写入（FR-015）
//
// 安全属性（FR-015）：httpOnly=true（code_verifier 等高敏凭据禁前端 JS 读取）
//   + sameSite=lax + path=/ + secure=true（仅生产环境）

import type { NextResponse } from 'next/server';

/** 登录状态 cookie 名（单 JSON cookie，含 code_verifier/state/nonce/returnTo 4 字段） */
export const STATE_COOKIE_NAME = 'sso_authorize_state';
/** access_token 会话 cookie 名 */
export const ACCESS_TOKEN_COOKIE_NAME = 'sso_access_token';
/** refresh_token 会话 cookie 名 */
export const REFRESH_TOKEN_COOKIE_NAME = 'sso_refresh_token';
/** id_token 会话 cookie 名 */
export const ID_TOKEN_COOKIE_NAME = 'sso_id_token';

/** 状态 cookie 有效期：10 分钟，一次性（FR-003/007） */
export const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
/** 默认落地页（returnTo 缺失/非法时回退，OQ-009） */
export const DEFAULT_RETURN_TO = '/solve';
/** access_token 默认有效期（expires_in 缺失/非正数时回退，FR-015） */
export const DEFAULT_ACCESS_TOKEN_MAX_AGE_SECONDS = 900;

/** 状态 cookie 载荷（FR-003/005；returnTo 缺失时回退默认落地页） */
export interface StateCookiePayload {
  code_verifier: string;
  state: string;
  nonce: string;
  returnTo?: string;
}

/** 会话 token 集合（用于写 cookie，FR-015） */
export interface SessionTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresIn: number;
}

/**
 * 开放重定向防御（FR-023）：returnTo 必须为同源相对路径
 * - 必须以 / 开头且非 // 开头（拒协议相对 URL）
 * - 拒绝 javascript: / data: 协议与跨域绝对 URL
 */
export function isSafeReturnTo(candidate: string | undefined | null): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return false;
  }
  if (/^javascript:/i.test(candidate) || /^data:/i.test(candidate)) {
    return false;
  }
  return true;
}

/** 序列化状态 cookie 载荷为 JSON 字符串（4 字段） */
export function serializeStateCookie(payload: StateCookiePayload): string {
  return JSON.stringify(payload);
}

/** 解析状态 cookie 值；缺失 / 非法 JSON / 字段不完整 → null */
export function parseStateCookie(raw: string | undefined | null): StateCookiePayload | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.code_verifier !== 'string' ||
      typeof record.state !== 'string' ||
      typeof record.nonce !== 'string'
    ) {
      return null;
    }
    return {
      code_verifier: record.code_verifier,
      state: record.state,
      nonce: record.nonce,
      returnTo: typeof record.returnTo === 'string' ? record.returnTo : undefined,
    };
  } catch {
    return null;
  }
}

/** cookie 安全属性（FR-015）：secure 仅生产环境 */
function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * 写入一次性登录状态 cookie（FR-003）
 * httpOnly=true（code_verifier 为可兑换授权码的高敏凭据，禁止前端 JS 读取）
 * maxAge=10 分钟，path=/
 */
export function setStateCookie(response: NextResponse, payload: StateCookiePayload): void {
  response.cookies.set(STATE_COOKIE_NAME, serializeStateCookie(payload), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(),
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** 清除一次性登录状态 cookie（FR-006/007/010，一次性使用） */
export function clearStateCookie(response: NextResponse): void {
  response.cookies.set(STATE_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(),
    maxAge: 0,
  });
}

/**
 * 清除全部会话 cookie（FR-019 ②：登出 / 会话失效时清空）
 * sso_access_token / sso_refresh_token / sso_id_token 三 cookie maxAge:0，
 * 属性与 clearStateCookie 一致（httpOnly + secure(生产) + sameSite=lax + path=/）
 */
export function clearSessionCookies(response: NextResponse): void {
  for (const name of [
    ACCESS_TOKEN_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    ID_TOKEN_COOKIE_NAME,
  ]) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: cookieSecure(),
      maxAge: 0,
    });
  }
}

/**
 * 登录成功后写入会话 cookie（FR-015）
 * - sso_access_token：maxAge=expires_in（非正数回退 900s）
 * - sso_refresh_token：仅响应含 refresh_token 时写入，maxAge=30 天
 * - sso_id_token：maxAge=30 天
 * 均 httpOnly=true + secure=true(生产) + sameSite=lax + path=/
 */
export function setSessionCookies(
  response: NextResponse,
  tokens: SessionTokenSet,
  refreshTokenMaxAgeDays: number,
): void {
  const refreshMaxAge = refreshTokenMaxAgeDays * 86400;
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(),
    maxAge: tokens.expiresIn > 0 ? tokens.expiresIn : DEFAULT_ACCESS_TOKEN_MAX_AGE_SECONDS,
  });
  if (tokens.refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: cookieSecure(),
      maxAge: refreshMaxAge,
    });
  }
  response.cookies.set(ID_TOKEN_COOKIE_NAME, tokens.idToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(),
    maxAge: refreshMaxAge,
  });
}
