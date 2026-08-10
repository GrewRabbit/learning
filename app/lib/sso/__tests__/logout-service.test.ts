// app/lib/sso/__tests__/logout-service.test.ts
// logout-service 登出编排服务单元测试（架构 §4.1.5/§5.3，auth spec FR-019~FR-023）
// 全 mock（config/discovery/oauth-client），无真实网络（testing-standards NFR-003）
// 覆盖：① clearSessionCookies 清三 cookie（含属性断言）② revoke 失败不阻断
// ③ end_session form 页构造（action/隐藏字段）④ id_token_hint 缺失回退 client_id
// ⑤ 白名单校验（合法/跨域/协议相对/javascript: 拒绝）⑥ discovery 失败

import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/app/lib/logging/audit-logger', () => ({
  auditLogger: { log: vi.fn() },
}));

import { getSsoConfig } from '@/app/lib/sso/config';
import { discoveryService } from '@/app/lib/sso/discovery-service';
import { logoutService } from '@/app/lib/sso/logout-service';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { auditLogger } from '@/app/lib/logging/audit-logger';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig } from '@/app/lib/sso/types';
import { logger } from '@/app/lib/logging/logger';

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

describe('logoutService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
    mockGetEndpoint.mockResolvedValue({ success: true, data: END_SESSION_URL });
    mockRevokeToken.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearSessionCookies（FR-019 ②）', () => {
    it('清除 access/refresh/id_token 三 cookie，属性与 clearStateCookie 一致', () => {
      const response = NextResponse.json({ success: true });
      logoutService.clearSessionCookies(response);

      for (const name of [
        ACCESS_TOKEN_COOKIE_NAME,
        REFRESH_TOKEN_COOKIE_NAME,
        ID_TOKEN_COOKIE_NAME,
      ]) {
        const cookie = response.cookies.get(name);
        expect(cookie).toBeDefined();
        expect(cookie?.value).toBe('');
        expect(cookie?.httpOnly).toBe(true);
        expect(cookie?.sameSite).toBe('lax');
        expect(cookie?.path).toBe('/');
        expect(cookie?.maxAge).toBe(0);
      }
    });
  });

  describe('revokeTokens（FR-019 ①/FR-020）', () => {
    it('顺序 revoke access_token → refresh_token，分别带对应 token_type_hint', async () => {
      await logoutService.revokeTokens('access-token', 'refresh-token');

      expect(mockRevokeToken).toHaveBeenCalledTimes(2);
      expect(mockRevokeToken).toHaveBeenNthCalledWith(1, 'access-token', 'access_token');
      expect(mockRevokeToken).toHaveBeenNthCalledWith(2, 'refresh-token', 'refresh_token');
    });

    it('revoke 失败（reject）不抛出、不阻断登出', async () => {
      mockRevokeToken.mockRejectedValue(new Error('network down'));

      await expect(logoutService.revokeTokens('access-token', 'refresh-token')).resolves.toBeUndefined();
      expect(mockRevokeToken).toHaveBeenCalledTimes(2);
    });

    it('revoke 失败（error result）仅记日志，不抛出', async () => {
      mockRevokeToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_REVOKE_FAILED', message: 'revoke failed' },
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      await expect(logoutService.revokeTokens('access-token')).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('AUTH_TOKEN_REVOKE_FAILED');
    });

    it('token 缺失时不调用 revoke', async () => {
      await logoutService.revokeTokens();

      expect(mockRevokeToken).not.toHaveBeenCalled();
    });
  });

  describe('审计日志（AR2-010）', () => {
    it('revoke 完成 → auditLogger.log("logout.completed")', async () => {
      await logoutService.revokeTokens('access-token', 'refresh-token');

      expect(auditLogger.log).toHaveBeenCalledWith('logout.completed');
    });

    it('revoke 失败（error result）→ auditLogger.log("logout.revoke_failed", { code: AUTH_TOKEN_REVOKE_FAILED })', async () => {
      mockRevokeToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_REVOKE_FAILED', message: 'revoke failed' },
      });

      await logoutService.revokeTokens('access-token');

      expect(auditLogger.log).toHaveBeenCalledWith('logout.revoke_failed', {
        code: 'AUTH_TOKEN_REVOKE_FAILED',
      });
    });

    it('revoke 异常（reject）→ 同样记录 logout.revoke_failed，且不阻断登出完成审计', async () => {
      mockRevokeToken.mockRejectedValue(new Error('network down'));

      await logoutService.revokeTokens('access-token');

      expect(auditLogger.log).toHaveBeenCalledWith('logout.revoke_failed', {
        code: 'AUTH_TOKEN_REVOKE_FAILED',
      });
      expect(auditLogger.log).toHaveBeenCalledWith('logout.completed');
    });
  });

  describe('isLogoutRedirectAllowed（FR-022/023 白名单校验）', () => {
    it('白名单内同源相对路径放行（默认仅 "/"）', () => {
      expect(logoutService.isLogoutRedirectAllowed('/')).toBe(true);
    });

    it('白名单外同源路径拒绝（更强白名单：不仅同源相对，还须命中注册列表）', () => {
      expect(logoutService.isLogoutRedirectAllowed('/dashboard')).toBe(false);
    });

    it('拒绝协议相对 URL（//evil.com）', () => {
      expect(logoutService.isLogoutRedirectAllowed('//evil.com')).toBe(false);
    });

    it('拒绝跨域绝对 URL', () => {
      expect(logoutService.isLogoutRedirectAllowed('https://evil.com/phish')).toBe(false);
      expect(logoutService.isLogoutRedirectAllowed('http://localhost:3000/x')).toBe(false);
    });

    it('拒绝 javascript:/data: 危险协议', () => {
      expect(logoutService.isLogoutRedirectAllowed('javascript:alert(1)')).toBe(false);
      expect(logoutService.isLogoutRedirectAllowed('data:text/html,<script>alert(1)</script>')).toBe(
        false,
      );
    });

    it('拒绝空串/非字符串', () => {
      expect(logoutService.isLogoutRedirectAllowed('')).toBe(false);
      expect(logoutService.isLogoutRedirectAllowed(undefined)).toBe(false);
      expect(logoutService.isLogoutRedirectAllowed(null)).toBe(false);
    });

    it('白名单为空时回退 redirectUris（publicRedirectUri，FR-022）；绝对地址仍被开放重定向语义拒绝', () => {
      mockGetSsoConfig.mockReturnValue({
        ...baseConfig,
        logoutRedirectWhitelist: [],
      });
      // 回退值为绝对 URL：相对路径不命中
      expect(logoutService.isLogoutRedirectAllowed('/')).toBe(false);
      // 绝对 URL 本身被 isSafeReturnTo 拒绝（fail-closed）
      expect(logoutService.isLogoutRedirectAllowed('http://localhost/api/sso/callback')).toBe(false);
    });
  });

  describe('buildEndSessionPage（AR1-002 end_session form 页）', () => {
    it('构造自动提交 form 页：action/method/enctype + id_token_hint/state/白名单 redirect', async () => {
      const result = await logoutService.buildEndSessionPage({
        idTokenHint: 'id.token.abc',
        postLogoutRedirectUri: '/',
      });

      expect(result.success).toBe(true);
      const html = result.success ? (result.data?.html ?? '') : '';
      expect(html).toContain(`action="${END_SESSION_URL}"`);
      expect(html).toContain('method="post"');
      expect(html).toContain('enctype="application/x-www-form-urlencoded"');
      expect(html).toContain('name="id_token_hint" value="id.token.abc"');
      expect(html).toContain('name="post_logout_redirect_uri" value="/"');
      // 自动提交脚本
      expect(html).toContain("onload=\"document.getElementById('sso-logout-form').submit()\"");
      // 登出 state ≥32（加密随机源，FR-021）
      const stateMatch = html.match(/name="state" value="([^"]+)"/);
      expect(stateMatch).not.toBeNull();
      expect(stateMatch?.[1]?.length).toBeGreaterThanOrEqual(32);
      expect(stateMatch?.[1]).toMatch(/^[A-Za-z0-9._~-]+$/);
      // 有 id_token_hint 时不带 client_id
      expect(html).not.toContain('name="client_id"');
    });

    it('id_token_hint 缺失（cookie 不可用）→ 回退 client_id（FR-019）', async () => {
      const result = await logoutService.buildEndSessionPage({});

      expect(result.success).toBe(true);
      const html = result.success ? (result.data?.html ?? '') : '';
      expect(html).toContain('name="client_id" value="test-client"');
      expect(html).not.toContain('name="id_token_hint"');
    });

    it('未提供 post_logout_redirect_uri 时不含该隐藏字段', async () => {
      const result = await logoutService.buildEndSessionPage({ idTokenHint: 'id.token.abc' });

      expect(result.success).toBe(true);
      const html = result.success ? (result.data?.html ?? '') : '';
      expect(html).not.toContain('post_logout_redirect_uri');
    });

    it('隐藏字段值 HTML 转义（防注入）', async () => {
      mockGetSsoConfig.mockReturnValue({ ...baseConfig, clientId: 'a&b"<c>' });
      const result = await logoutService.buildEndSessionPage({});

      expect(result.success).toBe(true);
      const html = result.success ? (result.data?.html ?? '') : '';
      expect(html).toContain('name="client_id" value="a&amp;b&quot;&lt;c&gt;"');
    });

    it('Discovery 获取 end_session_endpoint 失败 → AUTH_IDP_DISCOVERY_FAILED', async () => {
      mockGetEndpoint.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'discovery failed' },
      });

      const result = await logoutService.buildEndSessionPage({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
      }
    });
  });
});
