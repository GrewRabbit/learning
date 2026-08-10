// app/lib/sso/__tests__/callback-flow.test.ts
// callback-flow（SSO 回调编排）单元测试（架构 §5.3，auth spec FR-006~015/023，AR2-010 审计接入）
// 覆盖：审计日志接入——成功路径 login.success（含 subject）、各失败路径 login.failure（含对应
//       AUTH_* 错误码）、catch 异常路径；审计调用不携带任何敏感字段（FR-026/022）。
// 全 mock（config/discovery/oauth-client/id-token-verifier/audit-logger），无真实 IDP。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  STATE_COOKIE_NAME,
  serializeStateCookie,
  type StateCookiePayload,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig, TokenResponse, IdTokenClaims } from '@/app/lib/sso/types';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

vi.mock('@/app/lib/sso/discovery-service', () => ({
  discoveryService: {
    getEndpoint: vi.fn(),
    getIssuer: vi.fn(),
  },
}));

vi.mock('@/app/lib/sso/oauth-client', () => ({
  oauthClient: {
    exchangeCode: vi.fn(),
    getUserInfo: vi.fn(),
  },
}));

vi.mock('@/app/lib/sso/id-token-verifier', () => ({
  idTokenVerifier: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock('@/app/lib/logging/audit-logger', () => ({
  auditLogger: { log: vi.fn() },
}));

import { handleCallback } from '@/app/lib/sso/callback-flow';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { idTokenVerifier } from '@/app/lib/sso/id-token-verifier';
import { auditLogger } from '@/app/lib/logging/audit-logger';

const mockAuditLog = vi.mocked(auditLogger.log);

const baseConfig: SsoConfig = {
  issuer: 'https://idp.example.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  idTokenVerifyMode: 'strict',
  refreshTokenMaxAgeDays: 30,
  mockEnabled: false,
  retryMax: 3,
  scope: 'openid profile email offline_access',
  publicRedirectUri: 'http://localhost/api/sso/callback',
};

const ISSUER = 'https://idp.example.com';
const STATE = 's'.repeat(32);
const CODE_VERIFIER = 'v'.repeat(64);

const mockGetSsoConfig = vi.mocked(getSsoConfig);
const mockGetIssuer = vi.mocked(discoveryService.getIssuer);
const mockExchangeCode = vi.mocked(oauthClient.exchangeCode);
const mockGetUserInfo = vi.mocked(oauthClient.getUserInfo);
const mockVerifyIdToken = vi.mocked(idTokenVerifier.verifyIdToken);

const happyTokenResponse: TokenResponse = {
  access_token: 'at-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt-1',
  id_token: 'idt-1',
  scope: 'openid profile',
};

const happyIdTokenClaims: IdTokenClaims = {
  sub: 'user-1',
  iss: ISSUER,
  aud: 'test-client',
  exp: 1_999_999_999,
  iat: 1_999_999_900,
  name: 'User One',
};

/** 构造状态 cookie 值（与真实写入一致） */
function buildStateCookie(overrides: Partial<StateCookiePayload> = {}): string {
  return serializeStateCookie({
    code_verifier: CODE_VERIFIER,
    state: STATE,
    nonce: 'n'.repeat(32),
    returnTo: '/dashboard',
    ...overrides,
  });
}

function createCallbackRequest(
  params: Record<string, string>,
  stateCookieValue?: string,
): NextRequest {
  const query = new URLSearchParams(params).toString();
  const headers: HeadersInit = {};
  if (stateCookieValue !== undefined) {
    headers.cookie = `${STATE_COOKIE_NAME}=${encodeURIComponent(stateCookieValue)}`;
  }
  return new NextRequest(`http://localhost/api/sso/callback?${query}`, { headers });
}

describe('handleCallback 审计日志接入（AR2-010）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
    mockGetIssuer.mockReturnValue(ISSUER);
    mockExchangeCode.mockResolvedValue({ success: true, data: happyTokenResponse });
    mockVerifyIdToken.mockResolvedValue({ success: true, data: happyIdTokenClaims });
    mockGetUserInfo.mockResolvedValue({ success: true, data: happyIdTokenClaims });
  });

  describe('成功路径', () => {
    it('登录成功 → auditLogger.log("login.success", { subject: idClaims.sub })', async () => {
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.success', { subject: 'user-1' });
    });
  });

  describe('失败路径', () => {
    it('error=access_denied → login.failure AUTH_LOGIN_IDP_ERROR', async () => {
      await handleCallback(
        createCallbackRequest({ error: 'access_denied' }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
    });

    it('Zod 校验失败（缺 code/iss）→ login.failure AUTH_LOGIN_MISSING_PARAMS', async () => {
      await handleCallback(createCallbackRequest({ state: STATE }));

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_LOGIN_MISSING_PARAMS',
      });
    });

    it('无状态 cookie → login.failure AUTH_LOGIN_STATE_MISMATCH', async () => {
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_LOGIN_STATE_MISMATCH',
      });
    });

    it('state 与 cookie 不一致 → login.failure AUTH_LOGIN_STATE_MISMATCH', async () => {
      await handleCallback(
        createCallbackRequest(
          { code: 'code-1', state: 'x'.repeat(32), iss: ISSUER },
          buildStateCookie(),
        ),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_LOGIN_STATE_MISMATCH',
      });
    });

    it('iss 与 Discovery issuer 不一致 → login.failure AUTH_LOGIN_ISS_MISMATCH', async () => {
      await handleCallback(
        createCallbackRequest(
          { code: 'code-1', state: STATE, iss: 'https://evil.example.com' },
          buildStateCookie(),
        ),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_LOGIN_ISS_MISMATCH',
      });
    });

    it('令牌交换失败 → login.failure AUTH_TOKEN_EXCHANGE_FAILED', async () => {
      mockExchangeCode.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_EXCHANGE_FAILED', message: 'invalid_grant' },
      });
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_TOKEN_EXCHANGE_FAILED',
      });
    });

    it('id_token 验证失败 → login.failure AUTH_ID_TOKEN_INVALID', async () => {
      mockVerifyIdToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_ID_TOKEN_INVALID', message: '签名无效' },
      });
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
    });

    it('userinfo sub 与 id_token sub 不一致 → login.failure AUTH_ID_TOKEN_INVALID', async () => {
      mockGetUserInfo.mockResolvedValue({
        success: true,
        data: { ...happyIdTokenClaims, sub: 'user-2' },
      });
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', { code: 'AUTH_ID_TOKEN_INVALID' });
    });

    it('userinfo 端点不可达 → login.failure AUTH_LOGIN_IDP_UNREACHABLE', async () => {
      mockGetUserInfo.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_LOGIN_IDP_UNREACHABLE', message: '不可达' },
      });
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', {
        code: 'AUTH_LOGIN_IDP_UNREACHABLE',
      });
    });

    it('编排抛出异常 → login.failure AUTH_LOGIN_IDP_ERROR（catch 路径）', async () => {
      mockExchangeCode.mockRejectedValue(new Error('network down'));
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      expect(mockAuditLog).toHaveBeenCalledWith('login.failure', { code: 'AUTH_LOGIN_IDP_ERROR' });
    });
  });

  describe('脱敏约束（FR-026/022）', () => {
    it('审计调用参数不含任何敏感明文（token/state/code_verifier/secret）', async () => {
      // 成功路径
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      // 失败路径
      mockExchangeCode.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_EXCHANGE_FAILED', message: 'invalid_grant' },
      });
      await handleCallback(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );

      const serialized = JSON.stringify(mockAuditLog.mock.calls);
      expect(serialized).not.toContain('at-1');
      expect(serialized).not.toContain('rt-1');
      expect(serialized).not.toContain('idt-1');
      expect(serialized).not.toContain(STATE);
      expect(serialized).not.toContain(CODE_VERIFIER);
      expect(serialized).not.toContain('test-secret');
    });
  });
});
