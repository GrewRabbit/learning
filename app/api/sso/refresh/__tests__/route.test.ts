// app/api/sso/refresh/__tests__/route.test.ts
// /api/sso/refresh 路由单元测试（架构 §5.3，token spec FR-004~FR-010，AC-006~AC-010）
// 覆盖：GET 405；无 refresh_token → 401 AUTH_SESSION_INVALID；成功回写新 access/refresh cookie
//       （maxAge 重置、id_token 保持原值 AC-006/008）；剩余充足不刷新；invalid_grant → 401 + 清 cookie
//       （AC-009）；429 → 429；IDP 不可达 → 502；其他失败 → 500 AUTH_REFRESH_FAILED
// 使用真实 TokenRefresher 单例 + mock oauthClient / config / logger，不联网

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '../route';
import { oauthClient } from '@/app/lib/sso/oauth-client';
import { getSsoConfig } from '@/app/lib/sso/config';
import { logger } from '@/app/lib/logging/logger';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
} from '@/app/lib/sso/token-cookie';
import type { SsoConfig, TokenResponse } from '@/app/lib/sso/types';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

vi.mock('@/app/lib/sso/oauth-client', () => ({
  oauthClient: { refreshToken: vi.fn() },
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockGetSsoConfig = vi.mocked(getSsoConfig);
const mockRefreshToken = vi.mocked(oauthClient.refreshToken);

const baseConfig: SsoConfig = {
  issuer: 'https://idp.example.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  idTokenVerifyMode: 'strict',
  refreshTokenMaxAgeDays: 30,
  mockEnabled: false,
  retryMax: 3,
  scope: 'openid profile email offline_access',
};

/** 构造含指定剩余有效期（秒）的假 JWT access_token */
function makeAccessToken(remainingSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + remainingSeconds;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'https://idp.example.com', sub: 'u-1', iat: exp - 900, exp }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

/** 构造带会话 cookie 的 POST 请求 */
function createRefreshRequest(
  accessToken?: string,
  refreshToken?: string,
  idToken?: string,
): NextRequest {
  const cookieParts: string[] = [];
  if (accessToken !== undefined) cookieParts.push(`${ACCESS_TOKEN_COOKIE_NAME}=${accessToken}`);
  if (refreshToken !== undefined) cookieParts.push(`${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}`);
  if (idToken !== undefined) cookieParts.push(`${ID_TOKEN_COOKIE_NAME}=${idToken}`);
  return new NextRequest('http://localhost/api/sso/refresh', {
    method: 'POST',
    headers: cookieParts.length > 0 ? { cookie: cookieParts.join('; ') } : {},
  });
}

/** 刷新响应：不含 id_token（FR-008：刷新响应不返回 id_token） */
const refreshedTokens = {
  access_token: 'at-new',
  token_type: 'Bearer',
  expires_in: 1200,
  refresh_token: 'rt-new',
} as unknown as TokenResponse;

interface ErrorBody {
  success: boolean;
  error?: { code: string; message: string };
}

async function parseErrorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

describe('POST /api/sso/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
  });

  it('刷新成功 → 200，回写新 access/refresh cookie（maxAge 重置），id_token 保持原值（AC-006/008）', async () => {
    mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

    const res = await POST(createRefreshRequest(makeAccessToken(-10), 'rt-1', 'idt-1'));

    expect(res.status).toBe(200);
    const body = await parseErrorBody(res);
    expect(body.success).toBe(true);

    expect(mockRefreshToken).toHaveBeenCalledWith({ refresh_token: 'rt-1' });

    const access = res.cookies.get(ACCESS_TOKEN_COOKIE_NAME);
    expect(access?.value).toBe('at-new');
    expect(access?.httpOnly).toBe(true);
    expect(access?.maxAge).toBe(1200); // maxAge 按新 expires_in 重置

    const refresh = res.cookies.get(REFRESH_TOKEN_COOKIE_NAME);
    expect(refresh?.value).toBe('rt-new');
    expect(refresh?.maxAge).toBe(30 * 86400);

    const id = res.cookies.get(ID_TOKEN_COOKIE_NAME);
    expect(id?.value).toBe('idt-1'); // 刷新响应无 id_token，不更新
  });

  it('access_token 剩余充足（≥60s）→ 200 不刷新，无 Set-Cookie 变更', async () => {
    mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

    const res = await POST(createRefreshRequest(makeAccessToken(3600), 'rt-1', 'idt-1'));

    expect(res.status).toBe(200);
    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)).toBeUndefined();
    expect(res.cookies.get(REFRESH_TOKEN_COOKIE_NAME)).toBeUndefined();
  });

  it('无 refresh_token cookie → 401 AUTH_SESSION_INVALID，不调用 IDP', async () => {
    const res = await POST(createRefreshRequest(makeAccessToken(-10), undefined, 'idt-1'));

    expect(res.status).toBe(401);
    const body = await parseErrorBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AUTH_SESSION_INVALID');
    expect(mockRefreshToken).not.toHaveBeenCalled();
  });

  it('invalid_grant → 401 + 清 access/refresh/id_token 全部 cookie + 安全告警（AC-009）', async () => {
    mockRefreshToken.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_INVALID_GRANT', message: 'IDP 返回 invalid_grant' },
    });

    const res = await POST(createRefreshRequest(makeAccessToken(-10), 'rt-1', 'idt-1'));

    expect(res.status).toBe(401);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_INVALID_GRANT');
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(res.cookies.get(REFRESH_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(res.cookies.get(ID_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('AUTH_INVALID_GRANT'),
      expect.anything(),
    );
  });

  it('AUTH_IDP_RATE_LIMITED → 429', async () => {
    mockRefreshToken.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_RATE_LIMITED', message: 'IDP 限流（重试耗尽）' },
    });

    const res = await POST(createRefreshRequest(makeAccessToken(-10), 'rt-1'));

    expect(res.status).toBe(429);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_IDP_RATE_LIMITED');
  });

  it('AUTH_IDP_UNREACHABLE → 502', async () => {
    mockRefreshToken.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_UNREACHABLE', message: 'Token 端点不可达（网络/超时）' },
    });

    const res = await POST(createRefreshRequest(makeAccessToken(-10), 'rt-1'));

    expect(res.status).toBe(502);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_IDP_UNREACHABLE');
  });

  it('其他失败（invalid_client / Discovery 失败）→ 500 AUTH_REFRESH_FAILED，文案不泄漏内部细节（FR-026）', async () => {
    mockRefreshToken.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_ERROR', message: 'IDP 返回 OAuth 错误: invalid_client' },
    });

    const res = await POST(createRefreshRequest(makeAccessToken(-10), 'rt-1'));

    expect(res.status).toBe(500);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_REFRESH_FAILED');
    expect(body.error?.message).not.toContain('invalid_client');
  });
});

describe('GET /api/sso/refresh', () => {
  it('仅 POST → 405 METHOD_NOT_ALLOWED', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    const body = await parseErrorBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('METHOD_NOT_ALLOWED');
  });
});
