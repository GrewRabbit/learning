// app/lib/sso/__tests__/discovery-service.test.ts
// DiscoveryService 单元测试（M2）：全 mock global fetch（构造注入 fetchFn）
// 覆盖：正常获取端点 / 端点缺失 / issuer 不匹配 / JWKS 缓存 1h / kid 未命中重取 / 超时重试 / 429 Retry-After / clearCache

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SsoConfig } from '../types';
import { DiscoveryService } from '../discovery-service';

vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

import { getSsoConfig } from '@/app/lib/sso/config';

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

const discoveryDoc = {
  issuer: 'https://idp.example.com',
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  revocation_endpoint: 'https://idp.example.com/revoke',
  end_session_endpoint: 'https://idp.example.com/logout',
  jwks_uri: 'https://idp.example.com/jwks',
};

const jwks = {
  keys: [
    { kid: 'key-1', kty: 'RSA', use: 'sig' },
    { kid: 'key-2', kty: 'RSA', use: 'sig' },
  ],
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

describe('DiscoveryService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: DiscoveryService;

  beforeEach(() => {
    vi.mocked(getSsoConfig).mockReturnValue(baseConfig);
    fetchMock = vi.fn();
    service = new DiscoveryService({ fetchFn: fetchMock });
  });

  describe('getIssuer', () => {
    it('返回 getSsoConfig().issuer', () => {
      expect(service.getIssuer()).toBe('https://idp.example.com');
    });
  });

  describe('getEndpoint', () => {
    it('从 Discovery 文档返回端点 URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse(discoveryDoc));

      const result = await service.getEndpoint('token_endpoint');

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toBe('https://idp.example.com/token');
      // 请求 URL 为 {issuer}/.well-known/openid-configuration
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        '/.well-known/openid-configuration',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('Discovery 文档缺失端点时返回 AUTH_IDP_DISCOVERY_FAILED', async () => {
      const docWithoutUserinfo: Partial<typeof discoveryDoc> = { ...discoveryDoc };
      delete docWithoutUserinfo.userinfo_endpoint;
      fetchMock.mockResolvedValue(jsonResponse(docWithoutUserinfo));

      const result = await service.getEndpoint('userinfo_endpoint');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    });

    it('Discovery 文档 issuer 与配置不一致时返回 AUTH_IDP_DISCOVERY_FAILED', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ...discoveryDoc, issuer: 'https://evil.example.com' }),
      );

      const result = await service.getEndpoint('token_endpoint');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    });

    it('网络错误重试耗尽后返回 AUTH_IDP_DISCOVERY_FAILED（超时/不可达）', async () => {
      vi.mocked(getSsoConfig).mockReturnValue({ ...baseConfig, retryMax: 1 });
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await service.getEndpoint('token_endpoint');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
      // 首次 + retryMax(1) 次重试
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('Discovery 返回非 2xx 时返回 AUTH_IDP_DISCOVERY_FAILED', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));

      const result = await service.getEndpoint('token_endpoint');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    });

    it('429 时尊重 Retry-After 重试后成功', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '0' }))
        .mockResolvedValueOnce(jsonResponse(discoveryDoc));

      const result = await service.getEndpoint('token_endpoint');

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getJwks', () => {
    it('获取 JWKS 成功', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryDoc))
        .mockResolvedValueOnce(jsonResponse(jwks));

      const result = await service.getJwks();

      expect(result.success).toBe(true);
      if (!result.success || result.data === undefined) return;
      expect(result.data.keys).toHaveLength(2);
    });

    it('1 小时内第二次调用命中缓存，不重复请求', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryDoc))
        .mockResolvedValueOnce(jsonResponse(jwks));

      await service.getJwks();
      const second = await service.getJwks();

      expect(second.success).toBe(true);
      // 第一次：discovery + jwks 各 1 次；第二次：全部命中缓存
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('kid 未命中缓存时强制重取一次', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryDoc))
        .mockResolvedValueOnce(jsonResponse(jwks))
        .mockResolvedValue(jsonResponse(jwks));

      const first = await service.getJwks('key-1');
      expect(first.success).toBe(true);
      // kid-3 不在缓存 → 触发重取
      const second = await service.getJwks('key-3');

      expect(second.success).toBe(true);
      // discovery 1 次 + jwks 2 次（首次 + kid 未命中重取）
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('clearCache 后重新拉取 Discovery 与 JWKS', async () => {
      // 按调用奇偶交替返回 discovery 文档 / jwks（clearCache 后第二轮同样 doc→jwks）
      let callCount = 0;
      const docThenJwks = vi.fn(async () => {
        callCount += 1;
        return callCount % 2 === 1 ? jsonResponse(discoveryDoc) : jsonResponse(jwks);
      });
      const service2 = new DiscoveryService({ fetchFn: docThenJwks });

      await service2.getJwks();
      service2.clearCache();
      const after = await service2.getJwks();

      expect(after.success).toBe(true);
      // 第一轮 discovery + jwks；clearCache 后第二轮 discovery + jwks
      expect(docThenJwks).toHaveBeenCalledTimes(4);
    });

    it('JWKS 拉取失败返回 AUTH_IDP_DISCOVERY_FAILED', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(discoveryDoc))
        .mockResolvedValue(jsonResponse({}, 500));

      const result = await service.getJwks();

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    });
  });
});
