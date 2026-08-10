// app/lib/sso/__tests__/token-refresher.test.ts
// token-refresher 单元测试（架构 §5.2，token spec FR-004~FR-010，AC-004~AC-010）
// 覆盖：触发判定（AC-004）、单飞并发（AC-005）、新令牌返回与旧值弃用（AC-006/007）、
//       无 id_token 不报错（AC-008）、invalid_grant 清 cookie + 安全告警（AC-009）、
//       invalid_client 不重试记配置错误 / 429 透传不重试（AC-010）、无 refresh_token → AUTH_SESSION_INVALID
// 全部 mock oauthClient 与 logger，不联网

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { TokenRefresher } from '../token-refresher';
import { oauthClient } from '../oauth-client';
import { logger } from '@/app/lib/logging/logger';
import { auditLogger } from '@/app/lib/logging/audit-logger';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  ID_TOKEN_COOKIE_NAME,
} from '../token-cookie';
import type { ServiceResult } from '@/app/lib/ai/types';
import type { TokenResponse } from '../types';

vi.mock('@/app/lib/sso/oauth-client', () => ({
  oauthClient: { refreshToken: vi.fn() },
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/app/lib/logging/audit-logger', () => ({
  auditLogger: { log: vi.fn() },
}));

const mockRefreshToken = vi.mocked(oauthClient.refreshToken);

/** 固定时钟：now() 恒返回 NOW_MS，对应 Unix 秒 1_800_000_000 */
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

/** 构造含指定 exp 的假 JWT（三段式，payload 仅 exp/iat，无需签名校验） */
function buildAccessToken(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'https://idp.example.com', sub: 'u-1', iat: expSeconds - 900, exp: expSeconds }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

/** 构造带会话 cookie 的 NextRequest（access/refresh/id_token 可选） */
function createRequest(
  accessToken?: string,
  refreshToken?: string,
  idToken?: string,
): NextRequest {
  const cookieParts: string[] = [];
  if (accessToken !== undefined) cookieParts.push(`${ACCESS_TOKEN_COOKIE_NAME}=${accessToken}`);
  if (refreshToken !== undefined) cookieParts.push(`${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}`);
  if (idToken !== undefined) cookieParts.push(`${ID_TOKEN_COOKIE_NAME}=${idToken}`);
  return new NextRequest('http://localhost/api/sso/refresh', {
    headers: cookieParts.length > 0 ? { cookie: cookieParts.join('; ') } : {},
  });
}

/** 刷新成功的标准响应（含轮换后新 refresh_token） */
const refreshedTokens: TokenResponse = {
  access_token: 'at-2',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'rt-2',
  id_token: 'idt-2',
};

describe('TokenRefresher.refreshIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('触发判定（AC-004/FR-004）', () => {
    it('access_token 剩余 <60s → 触发刷新，用 cookie 中的 refresh_token', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 59), 'rt-1'),
      );

      expect(res.success).toBe(true);
      expect(res.data?.access_token).toBe('at-2');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      expect(mockRefreshToken).toHaveBeenCalledWith({ refresh_token: 'rt-1' });
    });

    it('access_token 剩余 ≥60s → 不触发，不调用 IDP（边界 60s 也不触发）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

      const res61 = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 61), 'rt-1'),
      );
      expect(res61.success).toBe(true);
      expect(res61.data).toBeUndefined();
      expect(mockRefreshToken).not.toHaveBeenCalled();

      const res60 = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 60), 'rt-1'),
      );
      expect(res60.success).toBe(true);
      expect(res60.data).toBeUndefined();
      expect(mockRefreshToken).not.toHaveBeenCalled();
    });

    it('access_token 缺失或无法解码 exp → 视为需刷新（恢复路径）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

      const resMissing = await refresher.refreshIfNeeded(createRequest(undefined, 'rt-1'));
      expect(resMissing.success).toBe(true);
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);

      const resMalformed = await refresher.refreshIfNeeded(createRequest('not-a-jwt', 'rt-1'));
      expect(resMalformed.success).toBe(true);
      expect(mockRefreshToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('单飞 inflight（AC-005/FR-005）', () => {
    it('并发触发同一 refresh_token → 仅一次网络请求，其余复用结果', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      let resolveRefresh!: (value: ServiceResult<TokenResponse>) => void;
      mockRefreshToken.mockImplementation(
        () =>
          new Promise<ServiceResult<TokenResponse>>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      const req = createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1');
      const p1 = refresher.refreshIfNeeded(req);
      const p2 = refresher.refreshIfNeeded(req);
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);

      resolveRefresh({ success: true, data: refreshedTokens });
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.data?.refresh_token).toBe('rt-2');
      expect(r2.data?.refresh_token).toBe('rt-2');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('刷新完成后 inflight 释放，后续调用重新发起新刷新', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      let resolveRefresh!: (value: ServiceResult<TokenResponse>) => void;
      mockRefreshToken
        .mockImplementationOnce(
          () =>
            new Promise<ServiceResult<TokenResponse>>((resolve) => {
              resolveRefresh = resolve;
            }),
        )
        .mockResolvedValueOnce({ success: true, data: refreshedTokens });

      const p1 = refresher.refreshIfNeeded(createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'));
      resolveRefresh({ success: true, data: refreshedTokens });
      await p1;

      const p2 = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(mockRefreshToken).toHaveBeenCalledTimes(2);
      expect(p2.data?.access_token).toBe('at-2');
    });
  });

  describe('轮换与 id_token（AC-006/007/008）', () => {
    it('刷新成功 → 返回新 TokenResponse（含新 access/refresh）（AC-006/FR-006）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({ success: true, data: refreshedTokens });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(true);
      expect(res.data?.access_token).toBe('at-2');
      expect(res.data?.refresh_token).toBe('rt-2');
      expect(res.data?.expires_in).toBe(900);
    });

    it('刷新后旧 refresh_token 不再使用，后续仅用新值（AC-007/FR-007）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken
        .mockResolvedValueOnce({
          success: true,
          data: { ...refreshedTokens, refresh_token: 'rt-2' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { ...refreshedTokens, refresh_token: 'rt-3' },
        });

      await refresher.refreshIfNeeded(createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'));
      await refresher.refreshIfNeeded(createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-2'));

      const usedRefreshTokens = mockRefreshToken.mock.calls.map((call) => call[0].refresh_token);
      expect(usedRefreshTokens).toEqual(['rt-1', 'rt-2']);
    });

    it('刷新响应无 id_token → 不报错，正常返回新令牌（AC-008/FR-008）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      const noIdToken = {
        access_token: 'at-2',
        token_type: 'Bearer',
        expires_in: 900,
        refresh_token: 'rt-2',
      } as unknown as TokenResponse;
      mockRefreshToken.mockResolvedValue({ success: true, data: noIdToken });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(true);
      expect(res.data?.access_token).toBe('at-2');
      expect(res.data?.refresh_token).toBe('rt-2');
    });
  });

  describe('失败分类（AC-009/010/FR-009/010）', () => {
    it('invalid_grant → 返回 AUTH_INVALID_GRANT，不重试（AC-009/FR-009）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_INVALID_GRANT', message: 'IDP 返回 invalid_grant' },
      });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('AUTH_INVALID_GRANT');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('invalid_client → 不重试并记录配置错误（AC-010/FR-010）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: 'IDP 返回 OAuth 错误: invalid_client' },
      });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('AUTH_IDP_ERROR');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1); // 本层不重试
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('invalid_client'),
        expect.anything(),
      );
    });

    it('429 耗尽 → 透传 AUTH_IDP_RATE_LIMITED，本层不重试（AC-010）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_IDP_RATE_LIMITED', message: 'IDP 限流（重试耗尽）' },
      });

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('AUTH_IDP_RATE_LIMITED');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('oauthClient 意外抛错 → AUTH_REFRESH_FAILED（防御性，不泄漏异常）', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      mockRefreshToken.mockRejectedValue(new Error('boom'));

      const res = await refresher.refreshIfNeeded(
        createRequest(buildAccessToken(NOW_SECONDS + 5), 'rt-1'),
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('AUTH_REFRESH_FAILED');
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('会话判定（FR-003 语义）', () => {
    it('无 refresh_token cookie → AUTH_SESSION_INVALID，不调用 IDP', async () => {
      const refresher = new TokenRefresher({ now: () => NOW_MS });
      const res = await refresher.refreshIfNeeded(createRequest(buildAccessToken(NOW_SECONDS + 5)));

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('AUTH_SESSION_INVALID');
      expect(mockRefreshToken).not.toHaveBeenCalled();
    });
  });
});

describe('TokenRefresher.onInvalidGrant（AC-009/FR-009）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('清除 access/refresh/id_token 全部 cookie（maxAge=0）', async () => {
    const refresher = new TokenRefresher({ now: () => NOW_MS });
    const response = NextResponse.json({ success: false });

    const result = await refresher.onInvalidGrant(response);

    expect(result.success).toBe(true);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(response.cookies.get(ID_TOKEN_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it('记录安全告警日志，含 AUTH_INVALID_GRANT 且不含 token 明文', async () => {
    const refresher = new TokenRefresher({ now: () => NOW_MS });
    const response = NextResponse.json({ success: false });

    await refresher.onInvalidGrant(response);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(logger.error).mock.calls[0];
    expect(callArgs[0]).toContain('AUTH_INVALID_GRANT');
    expect(JSON.stringify(callArgs)).not.toContain('rt-1');
    expect(JSON.stringify(callArgs)).not.toContain('at-1');
  });

  it('记录 invalid_grant 安全告警审计日志（AUTH_TOKEN_INVALID_GRANT，不含 token 明文）（AR2-010/FR-009）', async () => {
    const refresher = new TokenRefresher({ now: () => NOW_MS });
    const response = NextResponse.json({ success: false });

    await refresher.onInvalidGrant(response);

    expect(auditLogger.log).toHaveBeenCalledWith('token.invalid_grant', {
      code: 'AUTH_TOKEN_INVALID_GRANT',
    });
    const auditCalls = JSON.stringify(vi.mocked(auditLogger.log).mock.calls);
    expect(auditCalls).not.toContain('rt-1');
    expect(auditCalls).not.toContain('at-1');
  });
});
