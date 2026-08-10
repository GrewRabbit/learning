// app/lib/auth/__tests__/guard.test.ts
// M5 认证守卫（requireAuth）单元测试
//
// 测试策略：
// - 用 jose 真实生成 RS256 密钥对 + SignJWT 构造 access_token
// - mock discoveryService.getJwks 返回对应公钥 JWKS（唯一 JWKS 路径，AR1-006）
// - mock getSsoConfig 返回固定 issuer/clientId
// - 通过 Request 的 cookie 头传入 token

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import type { JWK } from 'jose';
import { requireAuth } from '@/app/lib/auth/guard';
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { auditLogger } from '@/app/lib/logging/audit-logger';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

vi.mock('@/app/lib/sso/discovery-service', () => ({
  discoveryService: {
    getJwks: vi.fn(),
    getEndpoint: vi.fn(),
    getIssuer: vi.fn(),
    clearCache: vi.fn(),
  },
}));

vi.mock('@/app/lib/logging/audit-logger', () => ({
  auditLogger: { log: vi.fn() },
}));

const KID = 'test-key';
const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'test-client';
const SUB = 'user-123';

// 构造带 cookie 头的 Request（access_token 由 cookie 传入）
function createRequestWithToken(token: string): Request {
  return new Request('http://localhost/api/solve', {
    method: 'POST',
    headers: {
      cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    },
  });
}

async function signAccessToken(claims: {
  exp: number;
  iss?: string;
  aud?: string;
  kid?: string;
}): Promise<string> {
  const jwt = new SignJWT({ sub: SUB })
    .setProtectedHeader({ alg: 'RS256', kid: claims.kid ?? KID })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(claims.exp)
    .sign(privateKey);
  return jwt;
}

let privateKey: CryptoKey;
let publicJwk: JWK;

describe('requireAuth（M5 认证守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSsoConfig).mockReturnValue({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: 'test-secret',
      idTokenVerifyMode: 'strict',
      refreshTokenMaxAgeDays: 14,
      mockEnabled: false,
      retryMax: 3,
      scope: 'openid offline_access',
    });
    vi.mocked(discoveryService.getJwks).mockResolvedValue({
      success: true,
      data: { keys: [publicJwk] },
    });
  });

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, kty: 'RSA' };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('无 access_token cookie → AUTH_SESSION_INVALID，且记录审计日志（AR2-010）', async () => {
    const req = new Request('http://localhost/api/solve', { method: 'POST' });
    const result = await requireAuth(req);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
    expect(discoveryService.getJwks).not.toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith('auth.session_invalid', {
      code: 'AUTH_SESSION_INVALID',
    });
  });

  it('token 非 JWT（无法解析）→ AUTH_SESSION_INVALID', async () => {
    const result = await requireAuth(createRequestWithToken('not-a-jwt'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
    expect(discoveryService.getJwks).not.toHaveBeenCalled();
  });

  it('算法非 RS256 → AUTH_SESSION_INVALID（fail-closed）', async () => {
    const token = await new SignJWT({ sub: SUB })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode('secret'));
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
    expect(discoveryService.getJwks).not.toHaveBeenCalled();
  });

  it('验签失败（公钥不匹配）→ AUTH_SESSION_INVALID', async () => {
    // 用另一把密钥签发，但 JWKS 返回测试主密钥 → 验签必然失败
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const token = await new SignJWT({ sub: SUB })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(otherKey);
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
  });

  it('iss 与配置不符 → AUTH_SESSION_INVALID', async () => {
    const token = await signAccessToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://evil.example.com',
    });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
  });

  it('aud 与配置不符 → AUTH_SESSION_INVALID', async () => {
    const token = await signAccessToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: 'other-client',
    });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
  });

  it('exp 已过期 → AUTH_TOKEN_EXPIRED（不记 session_invalid 审计）', async () => {
    const token = await signAccessToken({
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_TOKEN_EXPIRED');
    }
    expect(auditLogger.log).not.toHaveBeenCalled();
  });

  it('JWKS 获取失败 → AUTH_SESSION_INVALID', async () => {
    vi.mocked(discoveryService.getJwks).mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: '获取失败' },
    });
    const token = await signAccessToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
  });

  it('JWKS 中无匹配 kid → AUTH_SESSION_INVALID', async () => {
    vi.mocked(discoveryService.getJwks).mockResolvedValue({
      success: true,
      data: { keys: [{ ...publicJwk, kid: 'other-key' }] },
    });
    const token = await signAccessToken({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('AUTH_SESSION_INVALID');
    }
  });

  it('成功：按 kid 调 getJwks 并返回 AccessTokenClaims', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signAccessToken({ exp });
    const result = await requireAuth(createRequestWithToken(token));
    expect(result.success).toBe(true);
    // kid 未命中场景：guard 必须把 token 的 kid 传给 getJwks（强制刷新路径，AR1-006）
    expect(discoveryService.getJwks).toHaveBeenCalledWith(KID);
    if (result.success) {
      expect(result.data?.sub).toBe(SUB);
      expect(result.data?.iss).toBe(ISSUER);
      expect(result.data?.aud).toBe(CLIENT_ID);
      expect(result.data?.exp).toBe(exp);
      expect(result.data?.iat).toBeGreaterThan(0);
    }
    // 成功路径不产生 session_invalid 审计
    expect(auditLogger.log).not.toHaveBeenCalled();
  });
});
