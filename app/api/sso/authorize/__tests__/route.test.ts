// app/api/sso/authorize/__tests__/route.test.ts
// /api/sso/authorize 路由单元测试（架构 §5.3 + auth spec FR-002~005/FR-023，AC-001/002/003/004）
// 覆盖：GET 405、表单校验 400（不写 cookie）、成功写一次性状态 cookie（属性 + JSON 4 字段）、
//       302 URL 含全部必填参数且与 cookie 值自洽、returnTo 规范化、Discovery 失败 500

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { STATE_COOKIE_NAME, type StateCookiePayload } from '@/app/lib/sso/token-cookie';
import { generateCodeChallenge } from '@/app/lib/sso/pkce';
import type { SsoConfig } from '@/app/lib/sso/types';

// mock 配置与 Discovery（避免真实 env / 网络调用）
vi.mock('@/app/lib/sso/config', () => ({
  getSsoConfig: vi.fn(),
}));

vi.mock('@/app/lib/sso/discovery-service', () => ({
  discoveryService: {
    getEndpoint: vi.fn(),
    getIssuer: vi.fn(),
  },
}));

import { POST, GET } from '../route';
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
  scope: 'openid profile email offline_access',
  publicRedirectUri: 'http://localhost/api/sso/callback',
};

const AUTHORIZE_ENDPOINT = 'https://idp.example.com/authorize';

const mockGetSsoConfig = vi.mocked(getSsoConfig);
const mockGetEndpoint = vi.mocked(discoveryService.getEndpoint);

function createFormRequest(overrides: Record<string, string> = {}): Request {
  const params = new URLSearchParams({
    code_verifier: 'v'.repeat(64),
    code_challenge: 'c'.repeat(43),
    state: 's'.repeat(32),
    nonce: 'n'.repeat(32),
    ...overrides,
  });
  return new Request('http://localhost/api/sso/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

interface ErrorBody {
  success: boolean;
  error?: { code: string; message: string };
}

async function parseErrorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

/** 从 302 响应中读取状态 cookie 载荷 */
function readStateCookiePayload(response: NextResponse): StateCookiePayload | null {
  const cookie = response.cookies.get(STATE_COOKIE_NAME);
  if (!cookie) {
    return null;
  }
  return JSON.parse(cookie.value) as StateCookiePayload;
}

describe('POST /api/sso/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSsoConfig.mockReturnValue(baseConfig);
    mockGetEndpoint.mockResolvedValue({ success: true, data: AUTHORIZE_ENDPOINT });
  });

  it('非法表单（缺 code_verifier）→ 400 AUTH_LOGIN_MISSING_PARAMS 且不写状态 cookie', async () => {
    const res = await POST(createFormRequest({ code_verifier: '' }));
    expect(res.status).toBe(400);
    const body = await parseErrorBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('AUTH_LOGIN_MISSING_PARAMS');
    expect(res.cookies.get(STATE_COOKIE_NAME)).toBeUndefined();
  });

  it('非法表单（state 过短 <32）→ 400 AUTH_LOGIN_MISSING_PARAMS', async () => {
    const res = await POST(createFormRequest({ state: 'short' }));
    expect(res.status).toBe(400);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_LOGIN_MISSING_PARAMS');
    expect(res.cookies.get(STATE_COOKIE_NAME)).toBeUndefined();
  });

  it('成功 → 302 且 location 含全部必填参数（AC-001/004）', async () => {
    const res = await POST(createFormRequest());
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBeDefined();
    expect(location?.startsWith(AUTHORIZE_ENDPOINT)).toBe(true);
    const url = new URL(location!);
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/api/sso/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBeDefined();
    expect(url.searchParams.get('state')).toBeDefined();
    expect(url.searchParams.get('code_challenge')).toBeDefined();
  });

  it('成功 → 状态 cookie 属性 httpOnly+sameSite=lax+path=/+maxAge=10min（AC-002/003）', async () => {
    const res = await POST(createFormRequest());
    const cookie = res.cookies.get(STATE_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(600);
  });

  it('成功 → 状态 cookie JSON 含 4 字段且与 URL 参数自洽（URL state=cookie state、URL code_challenge=S256(cookie code_verifier)）', async () => {
    const res = await POST(createFormRequest());
    const payload = readStateCookiePayload(res);
    expect(payload).not.toBeNull();
    expect(payload!.code_verifier).toBeDefined();
    expect(payload!.state).toBeDefined();
    expect(payload!.nonce).toBeDefined();
    expect(payload!.returnTo).toBeDefined();

    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('state')).toBe(payload!.state);
    expect(url.searchParams.get('nonce')).toBe(payload!.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(
      await generateCodeChallenge(payload!.code_verifier),
    );
  });

  it('成功 → code_verifier 43-128 / state≥32 / nonce≥32（FR-002）', async () => {
    const res = await POST(createFormRequest());
    const payload = readStateCookiePayload(res);
    expect(payload!.code_verifier.length).toBeGreaterThanOrEqual(43);
    expect(payload!.code_verifier.length).toBeLessThanOrEqual(128);
    expect(payload!.state.length).toBeGreaterThanOrEqual(32);
    expect(payload!.nonce.length).toBeGreaterThanOrEqual(32);
  });

  it('returnTo 合法（/dashboard）→ 存入状态 cookie', async () => {
    const res = await POST(createFormRequest({ returnTo: '/dashboard' }));
    const payload = readStateCookiePayload(res);
    expect(payload?.returnTo).toBe('/dashboard');
  });

  it.each([
    ['javascript:alert(1)', 'javascript 协议'],
    ['//evil.com', '协议相对 URL'],
    ['https://evil.com/phish', '跨域绝对 URL'],
  ])('returnTo 非法（%s）→ 忽略并用默认 /（FR-005/023）', async (illegal) => {
    const res = await POST(createFormRequest({ returnTo: illegal }));
    expect(res.status).toBe(302);
    const payload = readStateCookiePayload(res);
    expect(payload?.returnTo).toBe('/');
  });

  it('scope 必含 openid（FR-004）', async () => {
    const res = await POST(createFormRequest());
    const url = new URL(res.headers.get('location')!);
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope.split(' ')).toContain('openid');
  });

  it('Discovery 获取 authorization_endpoint 失败 → 500 AUTH_IDP_DISCOVERY_FAILED', async () => {
    mockGetEndpoint.mockResolvedValue({
      success: false,
      error: { code: 'AUTH_IDP_DISCOVERY_FAILED', message: 'Discovery 获取失败' },
    });
    const res = await POST(createFormRequest());
    expect(res.status).toBe(500);
    const body = await parseErrorBody(res);
    expect(body.error?.code).toBe('AUTH_IDP_DISCOVERY_FAILED');
    expect(res.cookies.get(STATE_COOKIE_NAME)).toBeUndefined();
  });

  it('GET → 405（仅 POST）', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    const body = await parseErrorBody(res);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('METHOD_NOT_ALLOWED');
  });
});
