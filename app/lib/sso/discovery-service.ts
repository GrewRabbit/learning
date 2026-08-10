// app/lib/sso/discovery-service.ts
// Discovery 服务（M2，单例）：从 OIDC Discovery 文档获取端点 + JWKS
// - 端点全部取自 Discovery，代码中无硬编码端点（FR-016）
// - Discovery / JWKS 拉取超时 10s；失败重试（retryMax，429 尊重 Retry-After、网络/5xx 指数退避，上限 3）
// - JWKS 缓存 1h；kid 未命中缓存时强制重取一次
// 参考：架构 arch-sso-v1.2 §5.2 / §4.2，spec-sso-auth FR-014/FR-025

import type { ServiceResult } from '@/app/lib/ai/types';
import type { DiscoveryDocument, DiscoveryEndpoint, JsonWebKeySet } from './types';
import { getSsoConfig } from './config';

const IDP_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_RETRY_CAP = 3;
const BACKOFF_BASE_MS = 100;

/**
 * 带超时 + 重试的 IDP GET 请求
 * - 超时 10s（AbortSignal.timeout）
 * - 429：按 Retry-After（秒）等待后重试；无该头用指数退避
 * - 网络错误 / 5xx：指数退避重试；重试次数 = min(retryMax, 3)
 * - 重试耗尽：网络错误抛出；HTTP 错误返回最后一次 Response
 */
async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  retryMax: number,
): Promise<Response> {
  const maxAttempts = Math.min(retryMax, MAX_RETRY_CAP) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
      });
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (resp.status === 429 && !isLastAttempt) {
        await delay(parseRetryAfter(resp.headers.get('retry-after')) ?? backoffMs(attempt));
        continue;
      }
      if (resp.status >= 500 && !isLastAttempt) {
        await delay(backoffMs(attempt));
        continue;
      }
      return resp;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts - 1) {
        throw err;
      }
      await delay(backoffMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : Math.max(0, seconds * 1000);
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, 3000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasKid(jwks: JsonWebKeySet, kid: string): boolean {
  return jwks.keys.some((key) => {
    if (typeof key !== 'object' || key === null) return false;
    return (key as { kid?: unknown }).kid === kid;
  });
}

interface DiscoveryServiceOptions {
  fetchFn?: typeof fetch;
}

/**
 * Discovery 服务单例类（构造注入 fetchFn 便于单元测试 mock）
 */
export class DiscoveryService {
  private readonly fetchFn: typeof fetch;
  private discoveryCache: { doc: DiscoveryDocument; fetchedAt: number } | null = null;
  private jwksCache: { keys: JsonWebKeySet; fetchedAt: number } | null = null;

  constructor(options?: DiscoveryServiceOptions) {
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /** 返回配置中的 issuer（SSO_ISSUER） */
  getIssuer(): string {
    return getSsoConfig().issuer;
  }

  /**
   * 从 Discovery 文档取端点 URL（authorization/token/userinfo/revocation/end_session/jwks_uri）
   * 文档拉取失败、issuer 不匹配或端点缺失 → AUTH_IDP_DISCOVERY_FAILED
   */
  async getEndpoint(name: DiscoveryEndpoint): Promise<ServiceResult<string>> {
    const docResult = await this.fetchDiscoveryDocument();
    if (!docResult.success || docResult.data === undefined) {
      return { success: false, error: docResult.error };
    }

    const url = docResult.data[name];
    if (typeof url !== 'string' || url.length === 0) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: `Discovery 文档缺少端点: ${name}` },
      };
    }
    return { success: true, data: url };
  }

  /**
   * 获取 JWKS（缓存 1h）
   * - 传入 kid 且缓存中未命中该 kid 时，强制重取一次
   * - 拉取失败 → AUTH_IDP_DISCOVERY_FAILED
   */
  async getJwks(kid?: string): Promise<ServiceResult<JsonWebKeySet>> {
    const now = Date.now();
    if (this.jwksCache !== null) {
      const cacheValid = now - this.jwksCache.fetchedAt < CACHE_TTL_MS;
      const cacheHasKid = kid === undefined || hasKid(this.jwksCache.keys, kid);
      if (cacheValid && cacheHasKid) {
        return { success: true, data: this.jwksCache.keys };
      }
    }

    const refreshResult = await this.fetchJwks();
    if (!refreshResult.success || refreshResult.data === undefined) {
      return { success: false, error: refreshResult.error };
    }
    this.jwksCache = { keys: refreshResult.data, fetchedAt: Date.now() };
    return refreshResult;
  }

  /** 清空 Discovery / JWKS 缓存 */
  clearCache(): void {
    this.discoveryCache = null;
    this.jwksCache = null;
  }

  private async fetchDiscoveryDocument(): Promise<ServiceResult<DiscoveryDocument>> {
    const now = Date.now();
    if (this.discoveryCache !== null && now - this.discoveryCache.fetchedAt < CACHE_TTL_MS) {
      return { success: true, data: this.discoveryCache.doc };
    }

    const config = getSsoConfig();
    const discoveryUrl = `${config.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;

    let resp: Response;
    try {
      resp = await fetchWithRetry(
        this.fetchFn,
        discoveryUrl,
        { method: 'GET', headers: { Accept: 'application/json' } },
        config.retryMax,
      );
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'Discovery 文档获取失败（网络/超时）' },
      };
    }

    if (!resp.ok) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: `Discovery 文档返回 HTTP ${resp.status}` },
      };
    }

    let doc: unknown;
    try {
      doc = await resp.json();
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'Discovery 文档 JSON 解析失败' },
      };
    }

    const discovered = doc as DiscoveryDocument;
    // issuer 校验：文档 issuer 必须与配置 issuer 严格一致（FR-014）
    if (discovered.issuer !== config.issuer) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'Discovery 文档 issuer 与配置不一致' },
      };
    }

    this.discoveryCache = { doc: discovered, fetchedAt: Date.now() };
    return { success: true, data: discovered };
  }

  private async fetchJwks(): Promise<ServiceResult<JsonWebKeySet>> {
    const docResult = await this.fetchDiscoveryDocument();
    if (!docResult.success || docResult.data === undefined) {
      return { success: false, error: docResult.error };
    }

    const jwksUri = docResult.data['jwks_uri'];
    if (typeof jwksUri !== 'string' || jwksUri.length === 0) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'Discovery 文档缺少 jwks_uri' },
      };
    }

    let resp: Response;
    try {
      resp = await fetchWithRetry(
        this.fetchFn,
        jwksUri,
        { method: 'GET', headers: { Accept: 'application/json' } },
        getSsoConfig().retryMax,
      );
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'JWKS 获取失败（网络/超时）' },
      };
    }

    if (!resp.ok) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: `JWKS 返回 HTTP ${resp.status}` },
      };
    }

    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'JWKS JSON 解析失败' },
      };
    }

    const keys = (body as JsonWebKeySet).keys;
    if (!Array.isArray(keys)) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'JWKS 响应格式非法' },
      };
    }
    return { success: true, data: { keys } };
  }
}

/** Discovery 服务单例（构造注入 fetchFn 便于测试替换，生产默认 global fetch） */
export const discoveryService = new DiscoveryService();
