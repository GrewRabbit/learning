// app/lib/sso/__tests__/token-cookie.test.ts
// token-cookie 单元测试（M1 状态 cookie + 会话 cookie 的集中定义与读写）
// 覆盖：returnTo 开放重定向校验（FR-023）、状态 cookie 序列化/解析、写/清状态 cookie 属性、
//       会话 cookie 属性与 maxAge（FR-015，AC-017）

import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import {
  STATE_COOKIE_NAME,
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
  STATE_COOKIE_MAX_AGE_SECONDS,
  DEFAULT_RETURN_TO,
  isSafeReturnTo,
  serializeStateCookie,
  parseStateCookie,
  setStateCookie,
  clearStateCookie,
  setSessionCookies,
  type StateCookiePayload,
} from '../token-cookie';

const statePayload: StateCookiePayload = {
  code_verifier: 'v'.repeat(64),
  state: 's'.repeat(32),
  nonce: 'n'.repeat(32),
  returnTo: '/dashboard',
};

describe('isSafeReturnTo（FR-023 开放重定向防御）', () => {
  it('同源相对路径 → 合法', () => {
    expect(isSafeReturnTo('/dashboard')).toBe(true);
    expect(isSafeReturnTo('/')).toBe(true);
    expect(isSafeReturnTo('/zh/login?x=1')).toBe(true);
  });

  it('空 / undefined / null → 非法', () => {
    expect(isSafeReturnTo('')).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo(null)).toBe(false);
  });

  it('协议相对 URL（//evil.com）→ 非法', () => {
    expect(isSafeReturnTo('//evil.com')).toBe(false);
  });

  it('跨域绝对 URL → 非法', () => {
    expect(isSafeReturnTo('https://evil.com/phish')).toBe(false);
    expect(isSafeReturnTo('http://localhost:3000/x')).toBe(false);
  });

  it('javascript: / data: 协议 → 非法', () => {
    expect(isSafeReturnTo('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnTo('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('不以 / 开头的相对路径 → 非法', () => {
    expect(isSafeReturnTo('dashboard')).toBe(false);
  });
});

describe('状态 cookie 序列化 / 解析', () => {
  it('serializeStateCookie → JSON 字符串（含 4 字段）', () => {
    const raw = serializeStateCookie(statePayload);
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed.code_verifier).toBe(statePayload.code_verifier);
    expect(parsed.state).toBe(statePayload.state);
    expect(parsed.nonce).toBe(statePayload.nonce);
    expect(parsed.returnTo).toBe(statePayload.returnTo);
  });

  it('parseStateCookie：合法 JSON → 还原 4 字段', () => {
    const parsed = parseStateCookie(JSON.stringify(statePayload));
    expect(parsed).toEqual(statePayload);
  });

  it('parseStateCookie：空 / undefined → null', () => {
    expect(parseStateCookie('')).toBeNull();
    expect(parseStateCookie(undefined)).toBeNull();
    expect(parseStateCookie(null)).toBeNull();
  });

  it('parseStateCookie：非法 JSON → null', () => {
    expect(parseStateCookie('not-json{')).toBeNull();
  });

  it('parseStateCookie：字段缺失或类型错误 → null', () => {
    expect(parseStateCookie(JSON.stringify({ state: 'x' }))).toBeNull();
    expect(parseStateCookie(JSON.stringify({ ...statePayload, code_verifier: 123 }))).toBeNull();
    expect(parseStateCookie(JSON.stringify('abc'))).toBeNull();
  });
});

describe('setStateCookie（AC-001/002/003 状态 cookie 属性）', () => {
  it('写入 httpOnly + sameSite=lax + path=/ + maxAge=10min + JSON 值', () => {
    const res = NextResponse.json({ ok: true });
    setStateCookie(res, statePayload);
    const c = res.cookies.get(STATE_COOKIE_NAME);
    expect(c).toBeDefined();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('lax');
    expect(c?.path).toBe('/');
    expect(c?.maxAge).toBe(STATE_COOKIE_MAX_AGE_SECONDS);
    expect(JSON.parse(c!.value)).toEqual(statePayload);
  });
});

describe('clearStateCookie', () => {
  it('清空状态 cookie：maxAge=0 且值为空串', () => {
    const res = NextResponse.json({ ok: true });
    clearStateCookie(res);
    const c = res.cookies.get(STATE_COOKIE_NAME);
    expect(c?.value).toBe('');
    expect(c?.maxAge).toBe(0);
    expect(c?.path).toBe('/');
  });
});

describe('setSessionCookies（FR-015 会话 cookie，AC-017）', () => {
  const tokens = {
    accessToken: 'at-123',
    refreshToken: 'rt-123',
    idToken: 'idt-123',
    expiresIn: 900,
  };

  it('access_token：maxAge=expires_in，httpOnly+sameSite=lax+path=/', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, tokens, 30);
    const c = res.cookies.get(ACCESS_TOKEN_COOKIE_NAME);
    expect(c?.value).toBe('at-123');
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('lax');
    expect(c?.path).toBe('/');
    expect(c?.maxAge).toBe(900);
  });

  it('refresh_token 存在 → 写入，maxAge=30 天', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, tokens, 30);
    const c = res.cookies.get(REFRESH_TOKEN_COOKIE_NAME);
    expect(c?.value).toBe('rt-123');
    expect(c?.maxAge).toBe(30 * 86400);
    expect(c?.httpOnly).toBe(true);
  });

  it('refresh_token 缺失 → 不写 refresh cookie', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, { ...tokens, refreshToken: undefined }, 30);
    expect(res.cookies.get(REFRESH_TOKEN_COOKIE_NAME)).toBeUndefined();
  });

  it('id_token → 写入，maxAge=30 天', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, tokens, 30);
    const c = res.cookies.get(ID_TOKEN_COOKIE_NAME);
    expect(c?.value).toBe('idt-123');
    expect(c?.maxAge).toBe(30 * 86400);
  });

  it('expires_in 非正数 → access_token maxAge 回退默认 900s', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, { ...tokens, expiresIn: 0 }, 30);
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.maxAge).toBe(900);
  });

  it('secure 与生产环境开关一致（非生产为 false，生产为 true）', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookies(res, tokens, 30);
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.secure).toBe(
      process.env.NODE_ENV === 'production',
    );
  });
});

describe('DEFAULT_RETURN_TO', () => {
  it('默认落地页为 /solve（OQ-009）', () => {
    expect(DEFAULT_RETURN_TO).toBe('/solve');
  });
});
