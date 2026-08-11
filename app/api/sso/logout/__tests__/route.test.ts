// app/api/sso/logout/__tests__/route.test.ts
// /api/sso/logout 登出端点单元测试（架构 §5.3，auth spec FR-019~FR-023）
// 全 mock（config/discovery/oauth-client；logout-service 走真实实现，其依赖已 mock），无真实网络
// 覆盖：GET→405、无 redirect→200 {success:true}、白名单外→400+错误码且仍清 cookie、
//       合法 redirect→end_session form 页、id_token 缺失→client_id 回退、Discovery 失败→500 仍清 cookie

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));
vi.mock('@/app/lib/sso/discovery-service', () => ({
  discoveryService: {
    getEndpoint: vi.fn(),
  },
}));
vi.mock('@/app/lib/sso/oauth-client', () => ({
  oauthClient: {
    revokeToken: vi.fn(),
  },
}));

import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig } from '@/app/lib/sso/types';
import { GET, POST } from '../route';

const mockGetSsoConfig = vi.mocked(getSsoConfig);
const mockGetEndpoint = vi.mocked(discoveryService.getEndpoint);
const mockRevokeToken = vi.mocked(oauthClient.revokeToken);

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
  logoutRedirectWhitelist: ['/'],
};

const END_SESSION_URL = 'https://idp.example.com/end_session';

/** 构造带会话 cookie 的 POST 登出请求 */
function createLogoutRequest(body: string, withCookies = true): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (withCookies) {
    headers.cookie = [
      `${ACCESS_TOKEN_COOKIE_NAME}=access-token`,
      `${REFRESH_TOKEN_COOKIE_NAME}=refresh-token`,
      `${ID_TOKEN_COOKIE_NAME}=id.token.abc`,
    ].join('; ');
  }
  return new NextRequest('http://localhost/api/sso/logout', {
    method: 'POST',
    headers,
    body,
  });
}

describe('GET /api/sso/logout（AR2-007 仅 POST）', () => {
  it('GET → 405 METHOD_NOT_ALLOWED', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    const body = (await response.json()) as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('POST /api/sso/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
    mockGetEndpoint.mockResolvedValue({ success: true, data: END_SESSION_URL });
    mockRevokeToken.mockResolvedValue({ success: true });
  });

  it('无 redirect → 200 {success:true}，revoke access+refresh，清三 cookie', async () => {
    const response = await POST(createLogoutRequest(''));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // revoke 顺序（FR-019 ①）
    expect(mockRevokeToken).toHaveBeenCalledTimes(2);
    expect(mockRevokeToken).toHaveBeenNthCalledWith(1, 'access-token', 'access_token');
    expect(mockRevokeToken).toHaveBeenNthCalledWith(2, 'refresh-token', 'refresh_token');

    // 清三 cookie（FR-019 ②）
    for (const name of [
      ACCESS_TOKEN_COOKIE_NAME,
      REFRESH_TOKEN_COOKIE_NAME,
      ID_TOKEN_COOKIE_NAME,
    ]) {
      const cookie = response.cookies.get(name);
      expect(cookie).toBeDefined();
      expect(cookie?.value).toBe('');
      expect(cookie?.maxAge).toBe(0);
    }
  });

  it('无会话 cookie 时仍返回 200 {success:true}（本地无会话也完成登出）', async () => {
    const response = await POST(createLogoutRequest('', false));

    expect(response.status).toBe(200);
    expect(mockRevokeToken).not.toHaveBeenCalled();
  });

  it('合法 redirect（白名单内 "/"）→ 200 end_session HTML form 自动提交页', async () => {
    const response = await POST(
      createLogoutRequest(new URLSearchParams({ post_logout_redirect_uri: '/' }).toString()),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(`action="${END_SESSION_URL}"`);
    expect(html).toContain('method="post"');
    expect(html).toContain('enctype="application/x-www-form-urlencoded"');
    // id_token_hint 取自 sso_id_token cookie
    expect(html).toContain('name="id_token_hint" value="id.token.abc"');
    // 白名单相对路径 '/' 解析为绝对 URL 后传给 IDP（IDP 要求绝对地址，集成指南）
    expect(html).toContain('name="post_logout_redirect_uri" value="http://localhost/"');
    // 登出 state ≥32（FR-021）
    const stateMatch = html.match(/name="state" value="([^"]+)"/);
    expect(stateMatch?.[1]?.length).toBeGreaterThanOrEqual(32);
    // 自动提交脚本（AR1-002）
    expect(html).toContain("onload=\"document.getElementById('sso-logout-form').submit()\"");
    // URL 不含 id_token 明文（PII 仅 body，AR2-008）
    expect(html).not.toContain('id.token.abc?');
  });

  it('id_token cookie 缺失 → end_session 页回退 client_id（FR-019）', async () => {
    const response = await POST(
      createLogoutRequest(
        new URLSearchParams({ post_logout_redirect_uri: '/' }).toString(),
        false,
      ),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('name="client_id" value="test-client"');
    expect(html).not.toContain('name="id_token_hint"');
  });

  it('白名单外 redirect（跨域绝对 URL）→ 400 AUTH_LOGOUT_REDIRECT_INVALID，且仍清 cookie、仍 revoke（FR-022 错误路径）', async () => {
    const response = await POST(
      createLogoutRequest(
        new URLSearchParams({ post_logout_redirect_uri: 'https://evil.com/phish' }).toString(),
      ),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AUTH_LOGOUT_REDIRECT_INVALID');

    // 错误路径：cookie 仍须清除（FR-022）
    for (const name of [
      ACCESS_TOKEN_COOKIE_NAME,
      REFRESH_TOKEN_COOKIE_NAME,
      ID_TOKEN_COOKIE_NAME,
    ]) {
      const cookie = response.cookies.get(name);
      expect(cookie).toBeDefined();
      expect(cookie?.value).toBe('');
      expect(cookie?.maxAge).toBe(0);
    }
    // revoke 仍执行（登出不可阻断，FR-020）
    expect(mockRevokeToken).toHaveBeenCalled();
  });

  it('白名单外 redirect（协议相对 //evil.com）→ 400', async () => {
    const response = await POST(
      createLogoutRequest(new URLSearchParams({ post_logout_redirect_uri: '//evil.com' }).toString()),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error?: { code: string } };
    expect(body.error?.code).toBe('AUTH_LOGOUT_REDIRECT_INVALID');
  });

  it('白名单外 redirect（javascript: 协议）→ 400', async () => {
    const response = await POST(
      createLogoutRequest(
        new URLSearchParams({ post_logout_redirect_uri: 'javascript:alert(1)' }).toString(),
      ),
    );

    expect(response.status).toBe(400);
  });

  it('空串 post_logout_redirect_uri 视为未提供 → 200 {success:true}', async () => {
    const response = await POST(
      createLogoutRequest(new URLSearchParams({ post_logout_redirect_uri: '' }).toString()),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('Discovery 获取 end_session_endpoint 失败 → 500 AUTH_IDP_DISCOVERY_FAILED，cookie 仍清', async () => {
    mockGetEndpoint.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'discovery failed' },
    });
    const response = await POST(
      createLogoutRequest(new URLSearchParams({ post_logout_redirect_uri: '/' }).toString()),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { success: boolean; error?: { code: string } };
    expect(body.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    // 错误路径 cookie 仍清（FR-022）
    const cookie = response.cookies.get(ACCESS_TOKEN_COOKIE_NAME);
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });
});
