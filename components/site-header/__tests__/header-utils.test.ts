import { describe, expect, it } from 'vitest';

import {
  decodeJwtExp,
  getSafeSsoUrl,
  getSafeSsoUrls,
  isLoginPath,
  isSessionActive,
} from '../header-utils';

function base64url(input: object): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

describe('header-utils isLoginPath', () => {
  it('顶层 /login 应隐藏', () => {
    expect(isLoginPath('/login')).toBe(true);
  });

  it('本地化 /en/login 与 /zh/login 应隐藏', () => {
    expect(isLoginPath('/en/login')).toBe(true);
    expect(isLoginPath('/zh/login')).toBe(true);
  });

  it('/login/ 带尾斜杠应隐藏', () => {
    expect(isLoginPath('/login/')).toBe(true);
  });

  it('业务页不应隐藏', () => {
    expect(isLoginPath('/')).toBe(false);
    expect(isLoginPath('/solve')).toBe(false);
    expect(isLoginPath('/result/abc')).toBe(false);
    expect(isLoginPath('/loginable')).toBe(false);
  });
});

describe('header-utils getSafeSsoUrl/getSafeSsoUrls', () => {
  it('合法 https/http URL 保留', () => {
    expect(getSafeSsoUrl('https://auth.happyrabbit.top/dashboard')).toBe(
      'https://auth.happyrabbit.top/dashboard',
    );
    expect(getSafeSsoUrl('http://localhost:3000/solve')).toBe(
      'http://localhost:3000/solve',
    );
  });

  it('空值返回 undefined', () => {
    expect(getSafeSsoUrl('')).toBeUndefined();
    expect(getSafeSsoUrl(undefined)).toBeUndefined();
    expect(getSafeSsoUrl('  ')).toBeUndefined();
  });

  it('危险协议与非法 URL 返回 undefined', () => {
    expect(getSafeSsoUrl('javascript:alert(1)')).toBeUndefined();
    expect(getSafeSsoUrl('data:text/html,<script>1</script>')).toBeUndefined();
  });

  it('getSafeSsoUrls 双字段过滤', () => {
    expect(
      getSafeSsoUrls({
        registerUri: 'https://auth.happyrabbit.top/zh-CN/register',
        dashboardUrl: 'javascript:alert(1)',
      }),
    ).toEqual({
      registerUri: 'https://auth.happyrabbit.top/zh-CN/register',
      dashboardUrl: undefined,
    });
  });
});

describe('header-utils decodeJwtExp/isSessionActive', () => {
  const now = 1_700_000_000;

  it('解析合法 JWT 的 exp', () => {
    const token = `header.${base64url({ exp: now + 300 })}.signature`;
    expect(decodeJwtExp(token)).toBe(now + 300);
  });

  it('三段式非法 / 缺 exp / 异常 token 返回 undefined', () => {
    expect(decodeJwtExp('only-two-parts')).toBeUndefined();
    expect(decodeJwtExp(`a.${base64url({ noExp: true })}.c`)).toBeUndefined();
    expect(decodeJwtExp('a.-invalid-base64-.c')).toBeUndefined();
  });

  it('isSessionActive 按当前时间判定', () => {
    expect(isSessionActive(undefined, now)).toBe(false);
    expect(isSessionActive(now + 60, now)).toBe(true);
    expect(isSessionActive(now - 1, now)).toBe(false);
    expect(isSessionActive(now, now)).toBe(false);
  });
});