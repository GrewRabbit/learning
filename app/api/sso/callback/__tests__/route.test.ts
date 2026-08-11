// app/api/sso/callback/__tests__/route.test.ts
// /api/sso/callback 路由单元测试（架构 §5.3 + auth spec FR-006~015/023，AC-006/007/008/009/012/017）
// 覆盖：缺参/access_denied/state 不符/iss 不符/交换失败/id_token 无效/userinfo 不一致各失败路径，
//       成功三会话 cookie 属性 + 清状态 cookie（一次性）、returnTo 复检回默认

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  STATE_COOKIE_NAME,
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
  serializeStateCookie,
  type StateCookiePayload,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig, TokenResponse, IdTokenClaims } from '@/app/lib/sso/types';

// mock 配置与 SSO 服务模块（避免真实 env / 网络调用）
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

import { GET } from '../route';
import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { idTokenVerifier } from '@/app/lib/sso/id-token-verifier';

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
const NONCE = 'n'.repeat(32);
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

/** 构造状态 cookie 值（服务端 JSON 序列化，与真实写入一致） */
function buildStateCookie(overrides: Partial<StateCookiePayload> = {}): string {
  return serializeStateCookie({
    code_verifier: CODE_VERIFIER,
    state: STATE,
    nonce: NONCE,
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

interface ErrorBody {
  success: boolean;
  error?: { code: string; message: string };
}

async function parseErrorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

describe('GET /api/sso/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
    mockGetIssuer.mockReturnValue(ISSUER);
    mockExchangeCode.mockResolvedValue({ success: true, data: happyTokenResponse });
    mockVerifyIdToken.mockResolvedValue({ success: true, data: happyIdTokenClaims });
    mockGetUserInfo.mockResolvedValue({ success: true, data: happyIdTokenClaims });
  });

  describe('失败路径', () => {
    it('缺少 code → 400 AUTH_LOGIN_MISSING_PARAMS，不发起令牌交换（AC-006）', async () => {
      const res = await GET(createCallbackRequest({ state: STATE, iss: ISSUER }));
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('AUTH_LOGIN_MISSING_PARAMS');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('缺少 iss → 400 AUTH_LOGIN_MISSING_PARAMS', async () => {
      const res = await GET(createCallbackRequest({ code: 'code-1', state: STATE }));
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_MISSING_PARAMS');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('error=access_denied → 400 友好提示 + 清状态 cookie，不交换（AC-006/FR-006）', async () => {
      const res = await GET(
        createCallbackRequest({ error: 'access_denied' }, buildStateCookie()),
      );
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('AUTH_LOGIN_IDP_ERROR');
      expect(body.error?.message).toContain('未授权');
      expect(res.cookies.get(STATE_COOKIE_NAME)?.maxAge).toBe(0);
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('error=invalid_request（其他）→ 400 AUTH_LOGIN_IDP_ERROR（AC-006）', async () => {
      const res = await GET(createCallbackRequest({ error: 'invalid_request' }));
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_IDP_ERROR');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('无状态 cookie → 400 AUTH_LOGIN_STATE_MISMATCH，不交换（AC-007）', async () => {
      const res = await GET(createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }));
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_STATE_MISMATCH');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('state 与 cookie 不一致 → 400 AUTH_LOGIN_STATE_MISMATCH，不交换（FR-007）', async () => {
      const res = await GET(
        createCallbackRequest(
          { code: 'code-1', state: 'x'.repeat(32), iss: ISSUER },
          buildStateCookie(),
        ),
      );
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_STATE_MISMATCH');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('iss 与 Discovery issuer 不一致 → 400 AUTH_LOGIN_ISS_MISMATCH，不交换（AC-009/FR-008）', async () => {
      const res = await GET(
        createCallbackRequest(
          { code: 'code-1', state: STATE, iss: 'https://evil.example.com' },
          buildStateCookie(),
        ),
      );
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_ISS_MISMATCH');
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('令牌交换失败 → 400 AUTH_TOKEN_EXCHANGE_FAILED + 清状态 cookie，不泄露 IDP 细节（AC-008/FR-010）', async () => {
      mockExchangeCode.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_EXCHANGE_FAILED', message: 'invalid_grant' },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(400);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_TOKEN_EXCHANGE_FAILED');
      expect(body.error?.message).not.toContain('invalid_grant');
      expect(res.cookies.get(STATE_COOKIE_NAME)?.maxAge).toBe(0);
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)).toBeUndefined();
    });

    it('令牌交换网络失败 → 502 AUTH_LOGIN_IDP_UNREACHABLE', async () => {
      mockExchangeCode.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_LOGIN_IDP_UNREACHABLE', message: '网络错误' },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(502);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_LOGIN_IDP_UNREACHABLE');
    });

    it('id_token 验证失败 → 401 AUTH_ID_TOKEN_INVALID，不写会话 cookie（AC-012/FR-011）', async () => {
      mockVerifyIdToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_ID_TOKEN_INVALID', message: 'id_token 验证失败: 签名无效' },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(401);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)).toBeUndefined();
      expect(res.cookies.get(STATE_COOKIE_NAME)?.maxAge).toBe(0);
    });

    it('userinfo sub 与 id_token sub 不一致 → 401，不写会话 cookie（FR-013）', async () => {
      mockGetUserInfo.mockResolvedValue({
        success: true,
        data: { ...happyIdTokenClaims, sub: 'user-2' },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(401);
      const body = await parseErrorBody(res);
      expect(body.error?.code).toBe('AUTH_ID_TOKEN_INVALID');
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)).toBeUndefined();
    });

    it('userinfo 获取失败（401）→ 401 且不写会话 cookie（记录日志，续期归步骤 6）', async () => {
      mockGetUserInfo.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: 'UserInfo 返回 HTTP 401' },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(401);
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)).toBeUndefined();
    });
  });

  describe('成功路径', () => {
    it('成功 → 302 至 returnTo + 三会话 cookie 属性 + 清状态 cookie（AC-017/FR-015）', async () => {
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost/dashboard');

      // 编排调用链
      expect(mockExchangeCode).toHaveBeenCalledWith({
        code: 'code-1',
        redirect_uri: 'http://localhost/api/sso/callback',
        code_verifier: CODE_VERIFIER,
      });
      expect(mockVerifyIdToken).toHaveBeenCalledWith('idt-1', NONCE);
      expect(mockGetUserInfo).toHaveBeenCalledWith('at-1');

      // access cookie：value + httpOnly + sameSite=lax + path=/ + maxAge=expires_in(900)
      const access = res.cookies.get(ACCESS_TOKEN_COOKIE_NAME);
      expect(access?.value).toBe('at-1');
      expect(access?.httpOnly).toBe(true);
      expect(access?.sameSite).toBe('lax');
      expect(access?.path).toBe('/');
      expect(access?.maxAge).toBe(900);

      // refresh / id cookie：30 天
      const refresh = res.cookies.get(REFRESH_TOKEN_COOKIE_NAME);
      expect(refresh?.value).toBe('rt-1');
      expect(refresh?.httpOnly).toBe(true);
      expect(refresh?.maxAge).toBe(30 * 86_400);
      const id = res.cookies.get(ID_TOKEN_COOKIE_NAME);
      expect(id?.value).toBe('idt-1');
      expect(id?.maxAge).toBe(30 * 86_400);

      // 状态 cookie 一次性：成功后清除
      expect(res.cookies.get(STATE_COOKIE_NAME)?.maxAge).toBe(0);
    });

    it('成功且无 refresh_token → 不写 refresh cookie', async () => {
      mockExchangeCode.mockResolvedValue({
        success: true,
        data: { ...happyTokenResponse, refresh_token: undefined },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(302);
      expect(res.cookies.get(REFRESH_TOKEN_COOKIE_NAME)).toBeUndefined();
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value).toBe('at-1');
    });

    it('成功但 cookie returnTo 非法（//evil.com）→ 302 回默认 /solve（FR-023，OQ-009）', async () => {
      const res = await GET(
        createCallbackRequest(
          { code: 'code-1', state: STATE, iss: ISSUER },
          buildStateCookie({ returnTo: '//evil.com' }),
        ),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost/solve');
    });

    it('成功且 returnTo 缺失 → 302 回默认 /solve（OQ-009）', async () => {
      const payload = buildStateCookie();
      const res = await GET(
        createCallbackRequest(
          { code: 'code-1', state: STATE, iss: ISSUER },
          payload.replace(',"returnTo":"/dashboard"', ''),
        ),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost/solve');
    });

    it('成功且 expires_in=0 → access cookie maxAge 默认 900', async () => {
      mockExchangeCode.mockResolvedValue({
        success: true,
        data: { ...happyTokenResponse, expires_in: 0 },
      });
      const res = await GET(
        createCallbackRequest({ code: 'code-1', state: STATE, iss: ISSUER }, buildStateCookie()),
      );
      expect(res.status).toBe(302);
      expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.maxAge).toBe(900);
    });
  });
});
