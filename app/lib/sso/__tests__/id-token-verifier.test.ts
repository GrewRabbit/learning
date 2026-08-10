// app/lib/sso/__tests__/id-token-verifier.test.ts
// IdTokenVerifier 单元测试（M2，架构 §4.1.2 步骤 6 / §5.2，spec-sso-auth FR-011/FR-012）
// 覆盖：AC-012 参数化 8 步验证（strict 均 AUTH_ID_TOKEN_INVALID）、AC-013 soft 仅记日志、
//       成功路径（真实 jose RS256 签名）、时钟容差 60s、kid 刷新重取
// 全部 mock discoveryService（模块 mock + fetchFn 注入），不联网

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { IdTokenClaims, SsoConfig } from '../types';
import { IdTokenVerifier } from '../id-token-verifier';
import { logger } from '@/app/lib/logging/logger';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { getSsoConfig } from '@/app/lib/sso/config';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

// 保留 DiscoveryService 类（fetchFn 注入用例用真实实现），仅替换 discoveryService 单例
vi.mock('@/app/lib/sso/discovery-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/sso/discovery-service')>();
  return {
    ...actual,
    discoveryService: {
      getJwks: vi.fn(),
      getEndpoint: vi.fn(),
      getIssuer: vi.fn(),
      clearCache: vi.fn(),
    },
  };
});

const { ISSUER, CLIENT_ID } = vi.hoisted(() => ({
  ISSUER: 'https://idp.example.com',
  CLIENT_ID: 'test-client',
}));

const KID = 'test-key';

const baseConfig: SsoConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: 'test-secret',
  idTokenVerifyMode: 'strict',
  refreshTokenMaxAgeDays: 30,
  mockEnabled: false,
  retryMax: 3,
  scope: 'openid profile offline_access',
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function b64url(input: unknown): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

describe('IdTokenVerifier', () => {
  let keyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
  let wrongKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
  type PublicJwk = Awaited<ReturnType<typeof exportJWK>> & { kid: string };
  let publicJwk: PublicJwk;
  let verifier: IdTokenVerifier;

  beforeAll(async () => {
    keyPair = await generateKeyPair('RS256');
    wrongKeyPair = await generateKeyPair('RS256');
    publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: KID };
  });

  beforeEach(() => {
    vi.mocked(getSsoConfig).mockReturnValue(baseConfig);
    vi.mocked(discoveryService.getJwks).mockResolvedValue({
      success: true,
      data: { keys: [publicJwk] },
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    verifier = new IdTokenVerifier();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 用真实 jose 生成 RS256 签名 id_token */
  async function signToken(options: {
    iss?: string;
    aud?: string | string[];
    expSec?: number;
    nonce?: string;
    kid?: string;
    signWith?: CryptoKey;
    payload?: Record<string, unknown>;
  } = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({
      sub: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      groups: ['admin'],
      ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
      ...options.payload,
    })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID })
      .setIssuer(options.iss ?? ISSUER)
      .setAudience(options.aud ?? CLIENT_ID)
      .setExpirationTime(options.expSec ?? nowSec + 3600)
      .setIssuedAt(nowSec);
    return jwt.sign(options.signWith ?? keyPair.privateKey);
  }

  describe('成功路径', () => {
    it('真实 RS256 签名 id_token 验证成功并返回 IdTokenClaims', async () => {
      const token = await signToken({ nonce: 'nonce-123' });

      const result = await verifier.verifyIdToken(token, 'nonce-123');

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.sub).toBe('user-123');
      expect(result.data.iss).toBe(ISSUER);
      expect(result.data.aud).toBe(CLIENT_ID);
      expect(result.data.name).toBe('Test User');
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.groups).toEqual(['admin']);
      expect(result.data.nonce).toBe('nonce-123');
      // JWKS 以 header kid 匹配获取
      expect(discoveryService.getJwks).toHaveBeenCalledWith(KID);
    });

    it('kid 未命中缓存时 discovery 刷新 JWKS 后重试成功（FR-012）', async () => {
      // 模拟 discovery-service 行为：缓存中无该 kid → 强制重取 → 返回含该 kid 的新 JWKS
      vi.mocked(discoveryService.getJwks).mockImplementation(async (kid?: string) => {
        if (kid === KID) return { success: true, data: { keys: [publicJwk] } };
        return { success: true, data: { keys: [] } };
      });

      const token = await signToken();
      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(true);
      expect(discoveryService.getJwks).toHaveBeenCalledWith(KID);
    });

    it('构造注入 fetchFn 时经真实 DiscoveryService 拉取 JWKS 验证成功（不联网）', async () => {
      const discoveryDoc = { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(discoveryDoc))
        .mockResolvedValueOnce(jsonResponse({ keys: [publicJwk] }));
      const injected = new IdTokenVerifier({ fetchFn: fetchMock });

      const token = await signToken();
      const result = await injected.verifyIdToken(token);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data?.sub).toBe('user-123');
      // discovery 文档 + jwks 各 1 次
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC-012：strict 模式 8 步验证失败均拒绝（AUTH_ID_TOKEN_INVALID）', () => {
    it('① JWT 三段格式错误', async () => {
      const cases = ['not-a-jwt', 'header.payload', 'a.b.c.d', ''];
      for (const bad of cases) {
        const result = await verifier.verifyIdToken(bad);
        expect(result.success).toBe(false);
        if (result.success) continue;
        expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
      }
    });

    it('② alg=none 拒绝', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const noneToken = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
        sub: 'user-123',
        iss: ISSUER,
        aud: CLIENT_ID,
        exp: nowSec + 3600,
        iat: nowSec,
      })}.`;

      const result = await verifier.verifyIdToken(noneToken);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('② 非 RS256 alg（HS256）拒绝', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const hsToken = `${b64url({ alg: 'HS256', kid: KID })}.${b64url({
        sub: 'user-123',
        iss: ISSUER,
        aud: CLIENT_ID,
        exp: nowSec + 3600,
        iat: nowSec,
      })}.xxxx`;

      const result = await verifier.verifyIdToken(hsToken);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('③ kid 不匹配（刷新后 JWKS 仍无该 kid）拒绝', async () => {
      vi.mocked(discoveryService.getJwks).mockResolvedValue({
        success: true,
        data: { keys: [publicJwk] },
      });
      const token = await signToken({ kid: 'unknown-kid' });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
      expect(discoveryService.getJwks).toHaveBeenCalledWith('unknown-kid');
    });

    it('④ 签名错误（用错误私钥签名）拒绝', async () => {
      const token = await signToken({ signWith: wrongKeyPair.privateKey });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('⑤ iss 与配置 issuer 不一致拒绝', async () => {
      const token = await signToken({ iss: 'https://evil.example.com' });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('⑥ aud 不包含 client_id 拒绝', async () => {
      const token = await signToken({ aud: 'other-client' });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('⑦ exp 过期超过时钟容差（>60s）拒绝', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signToken({ expSec: nowSec - 120 });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });

    it('⑧ nonce 与 expectedNonce 不一致拒绝', async () => {
      const token = await signToken({ nonce: 'expected-nonce' });

      const result = await verifier.verifyIdToken(token, 'wrong-nonce');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
    });
  });

  describe('时钟容差（clockTolerance 60s）', () => {
    it('exp 已过期但 <60s 时验证通过', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signToken({ expSec: nowSec - 30 });

      const result = await verifier.verifyIdToken(token);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data?.sub).toBe('user-123');
    });
  });

  describe('AC-013：soft 模式验证失败仅记日志、不拒绝登录', () => {
    it('签名错误时记录日志并仍返回成功（数据尽力解析）', async () => {
      vi.mocked(getSsoConfig).mockReturnValue({ ...baseConfig, idTokenVerifyMode: 'soft' });
      const token = await signToken({ signWith: wrongKeyPair.privateKey });

      const result = await verifier.verifyIdToken(token);

      expect(logger.warn).toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (!result.success) return;
      // 尽力解析 payload（未验签）
      expect(result.data?.sub).toBe('user-123');
    });

    it('iss 不符时记录日志并仍返回成功', async () => {
      vi.mocked(getSsoConfig).mockReturnValue({ ...baseConfig, idTokenVerifyMode: 'soft' });
      const token = await signToken({ iss: 'https://evil.example.com' });

      const result = await verifier.verifyIdToken(token);

      expect(logger.warn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('格式错误时记录日志并仍返回成功（无 data）', async () => {
      vi.mocked(getSsoConfig).mockReturnValue({ ...baseConfig, idTokenVerifyMode: 'soft' });

      const result = await verifier.verifyIdToken('not-a-jwt');

      expect(logger.warn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
