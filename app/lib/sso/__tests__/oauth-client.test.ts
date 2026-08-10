// app/lib/sso/__tests__/oauth-client.test.ts
// OAuthClient 单元测试（M2）：全 mock（构造注入 fetchFn + mock discovery-service 模块）
// 覆盖：exchangeCode 成功/网络错误/HTTP 错误/invalid_grant/JSON 解析失败
//       refreshToken 成功/invalid_grant 映射、getUserInfo、revokeToken 400 幂等、callEndSession

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SsoConfig } from '../types';
import { OAuthClient } from '../oauth-client';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

vi.mock('@/app/lib/sso/discovery-service', () => ({
  discoveryService: { getEndpoint: vi.fn() },
}));

import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';

const baseConfig: SsoConfig = {
  issuer: 'https://idp.example.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  idTokenVerifyMode: 'strict',
  refreshTokenMaxAgeDays: 30,
  mockEnabled: false,
  retryMax: 3,
  scope: 'openid profile offline_access',
};

const ENDPOINTS: Record<string, string> = {
  token_endpoint: 'https://idp.example.com/token',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  revocation_endpoint: 'https://idp.example.com/revoke',
  end_session_endpoint: 'https://idp.example.com/logout',
};

const tokenResponse = {
  access_token: 'at-123',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'rt-123',
  id_token: 'idtoken-abc',
  scope: 'openid profile',
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

function formBodyOf(call: unknown[]): URLSearchParams {
  const init = call[1] as { body?: string };
  return new URLSearchParams(init.body ?? '');
}

describe('OAuthClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: OAuthClient;

  beforeEach(() => {
    vi.mocked(getSsoConfig).mockReturnValue(baseConfig);
    vi.mocked(discoveryService.getEndpoint).mockImplementation(
      async (name) =>
        ENDPOINTS[name] !== undefined
          ? { success: true, data: ENDPOINTS[name] }
          : { success: false, error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'no endpoint' } },
    );
    fetchMock = vi.fn();
    client = new OAuthClient({ fetchFn: fetchMock });
  });

  describe('exchangeCode', () => {
    it('POST token_endpoint 携带完整表单参数并返回 TokenResponse', async () => {
      fetchMock.mockResolvedValue(jsonResponse(tokenResponse));

      const result = await client.exchangeCode({
        code: 'auth-code-1',
        code_verifier: 'verifier-1',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.access_token).toBe('at-123');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ENDPOINTS.token_endpoint);
      expect(init.method).toBe('POST');
      const headers = new Headers(init.headers);
      expect(headers.get('Content-Type')).toContain('application/x-www-form-urlencoded');

      const body = new URLSearchParams(init.body as string);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code-1');
      expect(body.get('redirect_uri')).toBe('https://app.example.com/callback');
      expect(body.get('client_id')).toBe('test-client');
      expect(body.get('client_secret')).toBe('test-secret');
      expect(body.get('code_verifier')).toBe('verifier-1');
    });

    it('clientSecret 缺省（mock 模式）时省略 client_secret 字段', async () => {
      vi.mocked(getSsoConfig).mockReturnValue({ ...baseConfig, clientSecret: undefined });
      fetchMock.mockResolvedValue(jsonResponse(tokenResponse));

      const result = await client.exchangeCode({
        code: 'auth-code-1',
        code_verifier: 'verifier-1',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const body = new URLSearchParams(
        (fetchMock.mock.calls[0][1] as { body?: string }).body ?? '',
      );
      expect(body.get('client_secret')).toBeNull();
    });

    it('网络错误返回 AUTH_IDP_UNREACHABLE', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.exchangeCode({
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_UNREACHABLE');
    });

    it('IDP 返回 OAuth 错误（invalid_grant）映射 AUTH_TOKEN_EXCHANGE_FAILED', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400),
      );

      const result = await client.exchangeCode({
        code: 'bad-code',
        code_verifier: 'v',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_TOKEN_EXCHANGE_FAILED');
    });

    it('IDP 返回其他 OAuth 错误（invalid_client）映射 AUTH_IDP_ERROR', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'invalid_client' }, 401),
      );

      const result = await client.exchangeCode({
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_ERROR');
    });

    it('响应 JSON 解析失败返回 AUTH_TOKEN_EXCHANGE_FAILED', async () => {
      fetchMock.mockResolvedValue(new Response('not-json', { status: 200 }));

      const result = await client.exchangeCode({
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_TOKEN_EXCHANGE_FAILED');
    });
  });

  describe('refreshToken', () => {
    it('POST grant_type=refresh_token 携带 scope（默认用配置 scope）', async () => {
      fetchMock.mockResolvedValue(jsonResponse(tokenResponse));

      const result = await client.refreshToken({ refresh_token: 'rt-123' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const body = new URLSearchParams(
        (fetchMock.mock.calls[0][1] as { body?: string }).body ?? '',
      );
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('rt-123');
      expect(body.get('client_id')).toBe('test-client');
      expect(body.get('client_secret')).toBe('test-secret');
      expect(body.get('scope')).toBe('openid profile offline_access');
    });

    it('参数 scope 优先于配置 scope', async () => {
      fetchMock.mockResolvedValue(jsonResponse(tokenResponse));

      await client.refreshToken({
        refresh_token: 'rt-123',
        scope: 'openid offline_access',
      });

      const body = new URLSearchParams(
        (fetchMock.mock.calls[0][1] as { body?: string }).body ?? '',
      );
      expect(body.get('scope')).toBe('openid offline_access');
    });

    it('invalid_grant 映射 AUTH_INVALID_GRANT', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: 'invalid_grant' }, 400),
      );

      const result = await client.refreshToken({ refresh_token: 'stale' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_INVALID_GRANT');
    });

    it('刷新响应不含 id_token 视为成功（FR-008，刷新不返回 id_token）', async () => {
      const { id_token: _ignored, ...refreshResponse } = tokenResponse;
      fetchMock.mockResolvedValue(jsonResponse(refreshResponse));

      const result = await client.refreshToken({ refresh_token: 'rt-123' });

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.access_token).toBe('at-123');
      expect(result.data.id_token).toBeUndefined();
    });
  });

  describe('getUserInfo', () => {
    const claims = {
      sub: 'user-1',
      iss: 'https://idp.example.com',
      aud: 'test-client',
      exp: 1893456000,
      iat: 1893450000,
      preferred_username: 'alice',
      email: 'alice@example.com',
    };

    it('GET userinfo_endpoint 携带 Bearer 头并返回 claims', async () => {
      fetchMock.mockResolvedValue(jsonResponse(claims));

      const result = await client.getUserInfo('at-123');

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.sub).toBe('user-1');
      expect(result.data.preferred_username).toBe('alice');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ENDPOINTS.userinfo_endpoint);
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer at-123');
    });

    it('HTTP 错误返回 AUTH_IDP_ERROR', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 401));

      const result = await client.getUserInfo('bad-token');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_ERROR');
    });
  });

  describe('revokeToken', () => {
    it('POST revocation_endpoint 成功返回 void', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 200));

      const result = await client.revokeToken('rt-123', 'refresh_token');

      expect(result.success).toBe(true);
      const body = new URLSearchParams(
        (fetchMock.mock.calls[0][1] as { body?: string }).body ?? '',
      );
      expect(body.get('token')).toBe('rt-123');
      expect(body.get('token_type_hint')).toBe('refresh_token');
    });

    it('400 响应视为幂等成功（RFC 7009）', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'unsupported_token' }, 400));

      const result = await client.revokeToken('at-123', 'access_token');

      expect(result.success).toBe(true);
    });

    it('其他 HTTP 错误返回 AUTH_IDP_ERROR', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));

      const result = await client.revokeToken('at-123', 'access_token');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_ERROR');
    });
  });

  describe('callEndSession', () => {
    it('生成 end_session URL（含可选参数）', async () => {
      const result = await client.callEndSession({
        idTokenHint: 'idtoken-abc',
        postLogoutRedirectUri: 'https://app.example.com/logout-done',
        state: 'logout-state-1',
      });

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      const url = new URL(result.data.url);
      expect(url.origin + url.pathname).toBe('https://idp.example.com/logout');
      expect(url.searchParams.get('id_token_hint')).toBe('idtoken-abc');
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
        'https://app.example.com/logout-done',
      );
      expect(url.searchParams.get('state')).toBe('logout-state-1');
    });

    it('无可选参数时不附加 query', async () => {
      const result = await client.callEndSession({});

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.url).toBe('https://idp.example.com/logout');
    });

    it('end_session_endpoint 缺失返回 AUTH_IDP_DISCOVERY_FAILED', async () => {
      vi.mocked(discoveryService.getEndpoint).mockResolvedValueOnce({
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'endpoint missing' },
      });

      const result = await client.callEndSession({});

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    });
  });
});
