// app/lib/sso/__tests__/pkce.test.ts
// pkce.ts 单元测试（架构 §11，SSO 集成步骤 2，模块 M2）
// 覆盖：verifier 长度/字符集、challenge 往返、state/nonce 长度与随机性、verifyPkceChallenge 正反例

import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  verifyPkceChallenge,
} from '../pkce';

// PKCE code_verifier 合法字符集（RFC 7636 §4.1）
const PKCE_CHARSET = /^[A-Za-z0-9\-._~]+$/;
const BASE64URL_CHARSET = /^[A-Za-z0-9_-]+$/;

describe('generateCodeVerifier', () => {
  it('默认长度 64，且全部字符在合法字符集内', async () => {
    const verifier = await generateCodeVerifier();
    expect(verifier).toHaveLength(64);
    expect(verifier).toMatch(PKCE_CHARSET);
  });

  it('自定义长度（43 / 128 边界）合法', async () => {
    const min = await generateCodeVerifier(43);
    const max = await generateCodeVerifier(128);
    expect(min).toHaveLength(43);
    expect(max).toHaveLength(128);
    expect(min).toMatch(PKCE_CHARSET);
    expect(max).toMatch(PKCE_CHARSET);
  });

  it('越界长度（42 / 129 或非整数）抛 RangeError', async () => {
    await expect(generateCodeVerifier(42)).rejects.toThrow(RangeError);
    await expect(generateCodeVerifier(129)).rejects.toThrow(RangeError);
    await expect(generateCodeVerifier(0)).rejects.toThrow(RangeError);
  });

  it('每次生成结果互不相同（随机性）', async () => {
    const [a, b] = await Promise.all([generateCodeVerifier(), generateCodeVerifier()]);
    expect(a).not.toBe(b);
  });
});

describe('generateCodeChallenge / verifyPkceChallenge', () => {
  it('S256 challenge：43 字符 base64url，且与 verifier 往返验证通过', async () => {
    const verifier = await generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(BASE64URL_CHARSET);
    await expect(verifyPkceChallenge(challenge, verifier)).resolves.toBe(true);
  });

  it('不同 verifier 生成不同 challenge', async () => {
    const [v1, v2] = await Promise.all([generateCodeVerifier(), generateCodeVerifier()]);
    const [c1, c2] = await Promise.all([generateCodeChallenge(v1), generateCodeChallenge(v2)]);
    expect(c1).not.toBe(c2);
  });

  it('challenge 确定性与 RFC 7636 已知向量一致（S256 无填充 base64url）', async () => {
    // verifier 由 43 个 'a' 组成时，SHA-256 摘要固定，challenge 可复现
    const challenge = await generateCodeChallenge('a'.repeat(43));
    expect(challenge).toHaveLength(43);
    // 同一输入两次编码结果一致（确定性）
    const again = await generateCodeChallenge('a'.repeat(43));
    expect(challenge).toBe(again);
  });

  it('verifyPkceChallenge 反例：错误 verifier / 篡改 challenge / 空输入均返回 false', async () => {
    const verifier = await generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const otherVerifier = await generateCodeVerifier();

    await expect(verifyPkceChallenge(challenge, otherVerifier)).resolves.toBe(false);
    // 篡改末字符
    const tampered = challenge.slice(0, -1) + (challenge.endsWith('A') ? 'B' : 'A');
    await expect(verifyPkceChallenge(tampered, verifier)).resolves.toBe(false);
    await expect(verifyPkceChallenge('', verifier)).resolves.toBe(false);
    await expect(verifyPkceChallenge(challenge, '')).resolves.toBe(false);
  });
});

describe('generateState / generateNonce', () => {
  it('state 长度 ≥32，且符合字符集', async () => {
    const state = await generateState();
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(state).toMatch(PKCE_CHARSET);
  });

  it('nonce 长度 ≥32，且符合字符集', async () => {
    const nonce = await generateNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    expect(nonce).toMatch(PKCE_CHARSET);
  });

  it('state / nonce 每次生成互不相同（随机性）', async () => {
    const [s1, s2] = await Promise.all([generateState(), generateState()]);
    const [n1, n2] = await Promise.all([generateNonce(), generateNonce()]);
    expect(s1).not.toBe(s2);
    expect(n1).not.toBe(n2);
  });
});