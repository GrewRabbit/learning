// app/lib/sso/oauth-client.ts
// OAuth/OIDC 客户端（M2，单例）：令牌交换 / 刷新 / UserInfo / 撤销 / end_session 跳转
// - 端点全部取自 Discovery（FR-016），经 discoveryService.getEndpoint 获取
// - IDP 调用超时 10s + 重试（retryMax，429 Retry-After / 网络与 5xx 指数退避，上限 3）
// - 令牌交换响应校验 token_type 为 Bearer（FR-009）
// 参考：架构 arch-sso-v1.2 §5.2 / §4.2，spec-sso-auth FR-009/FR-011/FR-020、FR-025

import type { ServiceResult } from '@/app/lib/ai/types';
import type {
  EndSessionParams,
  ExchangeCodeParams,
  IdTokenClaims,
  RefreshTokenParams,
  TokenResponse,
} from './types';
import { getSsoConfig } from './config';
import { discoveryService } from './discovery-service';

const IDP_TIMEOUT_MS = 10_000;
const MAX_RETRY_CAP = 3;
const BACKOFF_BASE_MS = 100;

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

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

interface OAuthClientOptions {
  fetchFn?: typeof fetch;
}

/**
 * OAuth/OIDC 客户端单例类（构造注入 fetchFn 便于单元测试 mock）
 */
export class OAuthClient {
  private readonly fetchFn: typeof fetch;

  constructor(options?: OAuthClientOptions) {
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * 授权码交换令牌（FR-009）：POST token_endpoint，form 编码
   * 网络/超时 → AUTH_IDP_UNREACHABLE；OAuth 错误 invalid_grant → AUTH_TOKEN_EXCHANGE_FAILED；
   * 其他 OAuth 错误 → AUTH_IDP_ERROR；429 耗尽 → AUTH_IDP_RATE_LIMITED
   */
  async exchangeCode(p: ExchangeCodeParams): Promise<ServiceResult<TokenResponse>> {
    const endpointResult = await discoveryService.getEndpoint('token_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      return { success: false, error: endpointResult.error };
    }

    const config = getSsoConfig();
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', p.code);
    body.set('redirect_uri', p.redirect_uri);
    body.set('client_id', config.clientId);
    if (config.clientSecret !== undefined) {
      body.set('client_secret', config.clientSecret);
    }
    body.set('code_verifier', p.code_verifier);

    return this.postTokenRequest(endpointResult.data, body, 'exchange');
  }

  /**
   * 刷新令牌（FR-011）：grant_type=refresh_token，scope 默认取配置
   * invalid_grant → AUTH_INVALID_GRANT；网络/超时 → AUTH_IDP_UNREACHABLE
   */
  async refreshToken(p: RefreshTokenParams): Promise<ServiceResult<TokenResponse>> {
    const endpointResult = await discoveryService.getEndpoint('token_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      return { success: false, error: endpointResult.error };
    }

    const config = getSsoConfig();
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', p.refresh_token);
    body.set('client_id', config.clientId);
    if (config.clientSecret !== undefined) {
      body.set('client_secret', config.clientSecret);
    }
    body.set('scope', p.scope ?? config.scope);

    return this.postTokenRequest(endpointResult.data, body, 'refresh');
  }

  /**
   * 获取 UserInfo：GET userinfo_endpoint，Authorization: Bearer
   * HTTP 错误 → AUTH_IDP_ERROR；网络/超时 → AUTH_IDP_UNREACHABLE
   */
  async getUserInfo(accessToken: string): Promise<ServiceResult<IdTokenClaims>> {
    const endpointResult = await discoveryService.getEndpoint('userinfo_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      return { success: false, error: endpointResult.error };
    }

    let resp: Response;
    try {
      resp = await fetchWithRetry(
        this.fetchFn,
        endpointResult.data,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        },
        getSsoConfig().retryMax,
      );
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_UNREACHABLE', message: 'UserInfo 端点不可达（网络/超时）' },
      };
    }

    if (!resp.ok) {
      return {
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: `UserInfo 返回 HTTP ${resp.status}` },
      };
    }

    let claims: unknown;
    try {
      claims = await resp.json();
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: 'UserInfo 响应 JSON 解析失败' },
      };
    }

    const typedClaims = claims as IdTokenClaims;
    if (typeof typedClaims !== 'object' || typedClaims === null || typeof typedClaims.sub !== 'string') {
      return {
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: 'UserInfo 响应缺少 sub 声明' },
      };
    }
    return { success: true, data: typedClaims };
  }

  /**
   * 撤销令牌（FR-020）：POST revocation_endpoint（RFC 7009）
   * 400 视为幂等成功（token 已撤销/不可用）；其他 HTTP 错误 → AUTH_IDP_ERROR
   */
  async revokeToken(
    token: string,
    hint: 'access_token' | 'refresh_token',
  ): Promise<ServiceResult<void>> {
    const endpointResult = await discoveryService.getEndpoint('revocation_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      return { success: false, error: endpointResult.error };
    }

    const body = new URLSearchParams();
    body.set('token', token);
    body.set('token_type_hint', hint);

    let resp: Response;
    try {
      resp = await fetchWithRetry(
        this.fetchFn,
        endpointResult.data,
        { method: 'POST', headers: { 'Content-Type': FORM_CONTENT_TYPE }, body: body.toString() },
        getSsoConfig().retryMax,
      );
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_UNREACHABLE', message: 'Revocation 端点不可达（网络/超时）' },
      };
    }

    if (resp.ok || resp.status === 400) {
      return { success: true };
    }
    return {
      success: false,
      error: { code: 'AUTH_IDP_ERROR', message: `Revocation 返回 HTTP ${resp.status}` },
    };
  }

  /**
   * 生成 end_session URL（含可选 id_token_hint / post_logout_redirect_uri / state），供浏览器顶层跳转
   * 端点缺失 → AUTH_IDP_DISCOVERY_FAILED
   */
  async callEndSession(
    p: EndSessionParams,
  ): Promise<ServiceResult<{ url: string }>> {
    const endpointResult = await discoveryService.getEndpoint('end_session_endpoint');
    if (!endpointResult.success || endpointResult.data === undefined) {
      return { success: false, error: endpointResult.error };
    }

    const url = new URL(endpointResult.data);
    if (p.idTokenHint !== undefined) {
      url.searchParams.set('id_token_hint', p.idTokenHint);
    }
    if (p.postLogoutRedirectUri !== undefined) {
      url.searchParams.set('post_logout_redirect_uri', p.postLogoutRedirectUri);
    }
    if (p.state !== undefined) {
      url.searchParams.set('state', p.state);
    }
    return { success: true, data: { url: url.toString() } };
  }

  /**
   * token 端点 POST 公共处理（exchange / refresh）
   * 校验 token_type 为 Bearer（FR-009，OIDC 规范化小写比较）
   */
  private async postTokenRequest(
    tokenEndpoint: string,
    body: URLSearchParams,
    mode: 'exchange' | 'refresh',
  ): Promise<ServiceResult<TokenResponse>> {
    let resp: Response;
    try {
      resp = await fetchWithRetry(
        this.fetchFn,
        tokenEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': FORM_CONTENT_TYPE, Accept: 'application/json' },
          body: body.toString(),
        },
        getSsoConfig().retryMax,
      );
    } catch {
      return {
        success: false,
        error: { code: 'AUTH_IDP_UNREACHABLE', message: 'Token 端点不可达（网络/超时）' },
      };
    }

    if (!resp.ok) {
      const oauthError = await this.parseOAuthError(resp);
      if (oauthError !== null) {
        // invalid_grant 分类映射
        if (oauthError.error === 'invalid_grant') {
          return {
            success: false,
            error: {
              code: mode === 'exchange' ? 'AUTH_TOKEN_EXCHANGE_FAILED' : 'AUTH_INVALID_GRANT',
              message: 'IDP 返回 invalid_grant',
            },
          };
        }
        return {
          success: false,
          error: { code: 'AUTH_IDP_ERROR', message: `IDP 返回 OAuth 错误: ${oauthError.error}` },
        };
      }
      // 无 OAuth 错误体：429 耗尽单独映射，其余按 HTTP 状态归为 IDP 错误
      if (resp.status === 429) {
        return {
          success: false,
          error: { code: 'AUTH_IDP_RATE_LIMITED', message: 'IDP 限流（重试耗尽）' },
        };
      }
      return {
        success: false,
        error: { code: 'AUTH_IDP_ERROR', message: `Token 端点返回 HTTP ${resp.status}` },
      };
    }

    let tokenData: unknown;
    try {
      tokenData = await resp.json();
    } catch {
      return {
        success: false,
        error: {
          code: mode === 'exchange' ? 'AUTH_TOKEN_EXCHANGE_FAILED' : 'AUTH_IDP_ERROR',
          message: 'Token 响应 JSON 解析失败',
        },
      };
    }

    const typed = tokenData as Partial<TokenResponse>;
    // token_type 校验：须为 Bearer（大小写不敏感，FR-009）
    // id_token 仅 token 交换响应必需；刷新响应不返回 id_token（FR-008），refresh 模式不强制
    if (
      typeof typed.access_token !== 'string' ||
      (mode === 'exchange' && typeof typed.id_token !== 'string') ||
      typed.token_type === undefined ||
      typed.token_type.toLowerCase() !== 'bearer'
    ) {
      return {
        success: false,
        error: { code: 'AUTH_TOKEN_EXCHANGE_FAILED', message: 'Token 响应缺失字段或 token_type 非 Bearer' },
      };
    }

    return { success: true, data: typed as TokenResponse };
  }

  /** 尝试解析 OAuth 标准错误响应（RFC 6749 §5.2）；非 JSON / 无 error 字段返回 null */
  private async parseOAuthError(resp: Response): Promise<{ error: string } | null> {
    try {
      const body = (await resp.json()) as { error?: unknown };
      if (typeof body?.error === 'string') {
        return { error: body.error };
      }
    } catch {
      // JSON 解析失败视为无 OAuth 错误体
    }
    return null;
  }
}

/** OAuth 客户端单例（构造注入 fetchFn 便于测试替换，生产默认 global fetch） */
export const oauthClient = new OAuthClient();
