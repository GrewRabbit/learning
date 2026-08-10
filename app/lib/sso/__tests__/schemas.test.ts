// app/lib/sso/__tests__/schemas.test.ts
// schemas.ts 单元测试（架构 §11，SSO 集成步骤 2，模块 M2）
// 覆盖：authorizeFormSchema 通过/拒绝（含 returnTo 开放重定向防护）、callbackQuerySchema 通过/拒绝

import { describe, it, expect } from 'vitest';
import { authorizeFormSchema, callbackQuerySchema } from '../schemas';

// 合法 fixture：S256 code_challenge 恒为 43 字符 base64url（charCodeAt 值 0-9 的 'A' 即合法）
const VALID_CODE_CHALLENGE = 'A'.repeat(43);
const VALID_CODE_VERIFIER = 'B'.repeat(43);
const VALID_STATE = 'C'.repeat(32);
const VALID_NONCE = 'D'.repeat(32);

function validAuthorizeForm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code_verifier: VALID_CODE_VERIFIER,
    code_challenge: VALID_CODE_CHALLENGE,
    state: VALID_STATE,
    nonce: VALID_NONCE,
    ...overrides,
  };
}

describe('authorizeFormSchema', () => {
  it('合法表单通过（无 returnTo）', () => {
    const result = authorizeFormSchema.safeParse(validAuthorizeForm());
    expect(result.success).toBe(true);
  });

  it('合法表单通过（含同源 returnTo）', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: '/problem/P15800' }),
    );
    expect(result.success).toBe(true);
  });

  it('拒绝：code_verifier 长度 <43', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_verifier: 'B'.repeat(42) }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：code_verifier 长度 >128', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_verifier: 'B'.repeat(129) }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：code_verifier 含非法字符（+ 不属于 base64url 字符集）', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_verifier: `${'B'.repeat(42)}+` }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：code_challenge 长度≠43（S256 应恒为 43 字符）', () => {
    const short = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_challenge: 'A'.repeat(42) }),
    );
    const long = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_challenge: 'A'.repeat(44) }),
    );
    expect(short.success).toBe(false);
    expect(long.success).toBe(false);
  });

  it('拒绝：code_challenge 含非 base64url 字符', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ code_challenge: `${'A'.repeat(42)}=` }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：state 长度 <32', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ state: 'C'.repeat(31) }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：nonce 长度 <32', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ nonce: 'D'.repeat(31) }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：returnTo 为 //evil.com（协议相对 URL，开放重定向）', () => {
    const result = authorizeFormSchema.safeParse(validAuthorizeForm({ returnTo: '//evil.com' }));
    expect(result.success).toBe(false);
  });

  it('拒绝：returnTo 为 javascript: 伪协议', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: 'javascript:alert(1)' }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：returnTo 为 data: 伪协议', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: 'data:text/html,<script>alert(1)</script>' }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：returnTo 为跨域 http/https 绝对地址', () => {
    const http = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: 'http://evil.com/phish' }),
    );
    const https = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: 'https://evil.com/phish' }),
    );
    expect(http.success).toBe(false);
    expect(https.success).toBe(false);
  });

  it('拒绝：returnTo 非 / 开头（相对路径不合法）', () => {
    const result = authorizeFormSchema.safeParse(
      validAuthorizeForm({ returnTo: 'problem/P15800' }),
    );
    expect(result.success).toBe(false);
  });

  it('拒绝：returnTo 为空字符串', () => {
    const result = authorizeFormSchema.safeParse(validAuthorizeForm({ returnTo: '' }));
    expect(result.success).toBe(false);
  });
});

describe('callbackQuerySchema', () => {
  it('合法回调（code/state/iss）通过', () => {
    const result = callbackQuerySchema.safeParse({
      code: 'auth-code-123',
      state: VALID_STATE,
      iss: 'https://sso.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('合法回调（含 error/error_description）通过', () => {
    const result = callbackQuerySchema.safeParse({
      code: 'auth-code-123',
      state: VALID_STATE,
      iss: 'https://sso.example.com',
      error: 'access_denied',
      error_description: 'User rejected',
    });
    expect(result.success).toBe(true);
  });

  it('拒绝：缺少 code', () => {
    const result = callbackQuerySchema.safeParse({
      state: VALID_STATE,
      iss: 'https://sso.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('拒绝：缺少 iss', () => {
    const result = callbackQuerySchema.safeParse({
      code: 'auth-code-123',
      state: VALID_STATE,
    });
    expect(result.success).toBe(false);
  });
});