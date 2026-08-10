// app/lib/sso/pkce.ts
// PKCE / state / nonce 生成与校验（架构 §11，SSO 集成步骤 2，模块 M2，AR2-011）
//
// 同构纯函数：仅依赖 Web API（crypto.getRandomValues / TextEncoder / SubtleCrypto），
// 'use client' 组件（浏览器）与 Node 服务层均可引用。
// 禁用 node:crypto / Buffer；base64url 编码基于 Uint8Array 手工实现（RFC 4648 §5）。

// PKCE code_verifier 允许字符集（RFC 7636 §4.1：A-Z / a-z / 0-9 / - . _ ~）
const PKCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** code_verifier 最小长度（RFC 7636 §4.1） */
const VERIFIER_MIN_LENGTH = 43;
/** code_verifier 最大长度（RFC 7636 §4.1） */
const VERIFIER_MAX_LENGTH = 128;
/** state 最小长度（防暴力猜测） */
const STATE_MIN_LENGTH = 32;
/** nonce 最小长度（防重放，spec-sso-auth FR-002：≥32） */
const NONCE_MIN_LENGTH = 32;

/**
 * 生成指定长度的密码学安全随机字节
 * （Web Crypto getRandomValues，浏览器与 Node 18+ 均可用）
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 基于 Uint8Array 的 base64url 编码（RFC 4648 §5，无填充 =）
 * 3 字节 → 4 字符；末组不足 3 字节时按 2 字节 → 3 字符 / 1 字节 → 2 字符处理
 */
function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const b2 = bytes[i + 2]!;
    result += alphabet[b0 >> 2];
    result += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)];
    result += alphabet[b2 & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i]!;
    result += alphabet[b0 >> 2];
    result += alphabet[(b0 & 0x03) << 4];
  } else if (remaining === 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    result += alphabet[b0 >> 2];
    result += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += alphabet[(b1 & 0x0f) << 2];
  }
  return result;
}

/**
 * 从给定字符集生成指定长度的随机串（拒绝采样保证均匀分布）
 * 批量取随机字节，仅接受落入 [0, floor(256/len)*len) 区间的字节
 */
async function generateFromAlphabet(length: number, alphabet: string): Promise<string> {
  const alphabetLength = alphabet.length;
  const maxValid = Math.floor(256 / alphabetLength) * alphabetLength;
  const chars: string[] = [];
  while (chars.length < length) {
    // 按需分批生成，避免一次性申请过大缓冲
    const batchSize = Math.min(Math.max(length - chars.length, 1) * 2, 256);
    const pool = randomBytes(batchSize);
    for (const byte of pool) {
      if (byte < maxValid && chars.length < length) {
        chars.push(alphabet[byte % alphabetLength]);
      }
      if (chars.length >= length) {
        break;
      }
    }
  }
  return chars.join('');
}

/**
 * 生成 PKCE code_verifier（默认 64 位，合法范围 43-128）
 * 字符集：A-Z a-z 0-9 - . _ ~（RFC 7636 §4.1）
 */
export async function generateCodeVerifier(length = 64): Promise<string> {
  if (!Number.isInteger(length) || length < VERIFIER_MIN_LENGTH || length > VERIFIER_MAX_LENGTH) {
    throw new RangeError(
      `code_verifier 长度必须在 ${VERIFIER_MIN_LENGTH}-${VERIFIER_MAX_LENGTH} 之间，实际传入 ${length}`,
    );
  }
  return generateFromAlphabet(length, PKCE_ALPHABET);
}

/**
 * 生成 PKCE code_challenge（S256：SHA-256(verifier) 的 base64url 编码，43 字符）
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * 生成 CSRF 防护 state（≥32 字符）
 */
export async function generateState(): Promise<string> {
  return generateFromAlphabet(STATE_MIN_LENGTH, PKCE_ALPHABET);
}

/**
 * 生成防重放 nonce（≥32 字符）
 */
export async function generateNonce(): Promise<string> {
  return generateFromAlphabet(NONCE_MIN_LENGTH, PKCE_ALPHABET);
}

/**
 * 校验 PKCE challenge 与 verifier 是否匹配（S256）
 * 长度不一致直接判定失败；长度一致时逐字符比较，避免提前短路泄漏时序信息
 */
export async function verifyPkceChallenge(challenge: string, verifier: string): Promise<boolean> {
  const expected = await generateCodeChallenge(verifier);
  if (expected.length !== challenge.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ challenge.charCodeAt(i);
  }
  return mismatch === 0;
}