// __tests__/middleware.test.ts
// middleware 登录墙行为测试（v1.3 全站登录墙，arch-sso-dataflow.md §4.1.3 / spec-sso-auth-v1.3.md AC-035~038）
// 职责：matcher 三分类、限流（先于认证, AR1-001）、公开白名单豁免（D-004）、
//       受保护 API 401 JSON（FR-016）、受保护页面 302 /login?returnTo（FR-029）
// 测试策略：mock next/server；限流/分流用例给唯一 IP（nextIp）隔离，避免模块级 ipRequestMap 跨用例污染
//（v1.2 → v1.3 断言升级：受保护 API 无 cookie 由 302 改 401 JSON；页面由放行改 302 returnTo；matcher 单条改两条）

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mocks（hoisted，所有用例共享）----
const { mockNext, mockJson, mockRedirect } = vi.hoisted(() => ({
  mockNext: vi.fn(),
  mockJson: vi.fn((body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    body,
  })),
  mockRedirect: vi.fn((url: URL) => ({ url, status: 302 })),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    next: mockNext,
    json: mockJson,
    redirect: mockRedirect,
  },
}));

import { middleware } from '../middleware';

function nextIp(): string {
  return `10.0.0.${Math.floor(Math.random() * 1000)}`;
}

const ACCESS_TOKEN_COOKIE = 'sso_access_token';
const nowInSec = (): number => Math.floor(Date.now() / 1000);
const FUTURE_EXP = nowInSec() + 3600;
const PAST_EXP = nowInSec() - 3600;

/** 构造合法 JWT token（payload 含 exp），签名部分任意（粗检不验签，FR-016） */
function makeToken(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ iss: 'happyrabbit', sub: 'test-user-001', exp }));
  return `${header}.${payload}.fake-signature`;
}

/** 构造 middleware 期望的 Request 形状（fullPath 可含 query；headers/cookies 可注入） */
function createReq(
  fullPath: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
): unknown {
  const [pathname, query = ''] = fullPath.split('?');
  return {
    nextUrl: { pathname, search: query === '' ? '' : `?${query}` },
    url: `http://localhost${fullPath}`,
    headers: new Headers(headers),
    cookies: {
      get: (name: string): { value: string } | undefined =>
        cookies[name] !== undefined ? { value: cookies[name] } : undefined,
    },
  };
}

/** 期望的 401 JSON 响应体（FR-016：受保护 API 未登录返回 JSON，非 HTML 登录页） */
const AUTH_401_BODY = {
  success: false,
  error: { code: 'AUTH_SESSION_INVALID', message: '未登录或会话已过期' },
};

/** 期望的 429 JSON 响应体（AR1-001：限流先于认证） */
const RATE_LIMITED_BODY = {
  success: false,
  error: { code: 'GESP6_RATE_LIMITED', message: expect.any(String) as unknown },
};

/** 断言某次 redirect 调用的目标 URL（URL 实例无自有可枚举属性，deep-equal 会空真，故校验 href 字符串） */
function expectRedirectTo(expectedHref: string): void {
  expect(mockRedirect).toHaveBeenCalledTimes(1);
  const [calledUrl] = mockRedirect.mock.calls[0] ?? [];
  expect(calledUrl).toBeInstanceOf(URL);
  expect((calledUrl as URL).href).toBe(expectedHref);
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('/api/health 豁免', () => {
    it('未登录访问 /api/health 直接放行，不经过限流计数与认证粗检', async () => {
      await middleware(createReq('/api/health', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockJson).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('限流配额耗尽后 /api/health 仍放行（早退豁免，便于部署探活）', async () => {
      const ip = nextIp();
      // 用合法 cookie 耗尽同 IP 配额（20 次全部放行）
      for (let i = 0; i < 20; i++) {
        await middleware(
          createReq('/api/solve', { 'x-forwarded-for': ip }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
        );
      }
      mockNext.mockClear();
      await middleware(createReq('/api/health', { 'x-forwarded-for': ip }) as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockJson).not.toHaveBeenCalled();
    });
  });

  describe('限流逻辑（先于认证，AR1-001）', () => {
    it('单 IP 前 20 次请求放行', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': nextIp() },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      ) as never;
      for (let i = 0; i < 20; i++) {
        await middleware(req);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
    });

    it('单 IP 第 21 次请求返回 429 GESP6_RATE_LIMITED（不再放行）', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': nextIp() },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      ) as never;
      for (let i = 0; i < 20; i++) {
        await middleware(req);
      }
      mockNext.mockClear();
      await middleware(req);
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('不同 IP 独立计数（不互相影响）', async () => {
      for (let i = 0; i < 4; i++) {
        await middleware(
          createReq('/api/solve', { 'x-forwarded-for': nextIp() }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
        );
      }
      expect(mockNext).toHaveBeenCalledTimes(4);
    });

    it('未认证请求同样消耗配额：前 20 次 401（API JSON），第 21 次 429（而非 302）', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        await middleware(createReq('/api/solve', { 'x-forwarded-for': ip }) as never);
      }
      expect(mockJson).toHaveBeenCalledTimes(20);
      expect(mockJson).toHaveBeenCalledWith(AUTH_401_BODY, { status: 401 });
      expect(mockRedirect).not.toHaveBeenCalled();
      mockJson.mockClear();
      await middleware(createReq('/api/solve', { 'x-forwarded-for': ip }) as never);
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
    });
  });

  describe('IP 提取', () => {
    it('x-forwarded-for 取首段：多级代理列表只按首段计数', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 172.16.0.1' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      ) as never;
      for (let i = 0; i < 20; i++) {
        await middleware(req);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      mockNext.mockClear();
      // 首段相同（后续段不同）→ 同桶已耗尽 → 429
      await middleware(
        createReq('/api/solve', { 'x-forwarded-for': '203.0.113.7, 10.0.0.9' }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
      );
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
    });

    it('仅 x-real-ip 时按 x-real-ip 计数', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-real-ip': '198.51.100.9' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      ) as never;
      for (let i = 0; i < 20; i++) {
        await middleware(req);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      mockNext.mockClear();
      await middleware(createReq('/api/solve', { 'x-real-ip': '198.51.100.9' }) as never);
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
    });

    it('无任何 IP 头时使用 unknown，仍可放行（不因缺 IP 直接 429）', async () => {
      await middleware(createReq('/api/solve', {}, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('x-forwarded-for 优先于 x-real-ip（xff 决定计数桶）', async () => {
      // 20 次带 xff+xrip → 按 xff 计数
      const both = createReq(
        '/api/solve',
        { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      ) as never;
      for (let i = 0; i < 20; i++) {
        await middleware(both);
      }
      mockNext.mockClear();
      // 仅 xrip=5.6.7.8（无 xff）→ 独立桶，仍放行
      await middleware(
        createReq('/api/solve', { 'x-real-ip': '5.6.7.8' }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
      );
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockJson).not.toHaveBeenCalled();
      // xff 仍是 1.2.3.4 → 同桶已耗尽 → 429
      mockNext.mockClear();
      await middleware(createReq('/api/solve', { 'x-forwarded-for': '1.2.3.4' }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never);
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
    });

    it('x-forwarded-for 首段 trim 后参与计数（带空白不产生新桶）', async () => {
      for (let i = 0; i < 20; i++) {
        await middleware(
          createReq('/api/solve', { 'x-forwarded-for': ' 10.1.2.3 ' }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
        );
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      mockNext.mockClear();
      await middleware(
        createReq('/api/solve', { 'x-forwarded-for': '10.1.2.3' }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
      );
      expect(mockJson).toHaveBeenCalledWith(RATE_LIMITED_BODY, { status: 429 });
    });
  });

  describe('认证粗检（受保护 API → 401 JSON，FR-016）', () => {
    it('受保护 API 无 cookie → 401 JSON AUTH_SESSION_INVALID（不再 302）', async () => {
      await middleware(createReq('/api/solve', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(AUTH_401_BODY, { status: 401 });
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('cookie 存在但 exp 已过期 → 401 JSON AUTH_SESSION_INVALID', async () => {
      await middleware(
        createReq('/api/solve', { 'x-forwarded-for': nextIp() }, { [ACCESS_TOKEN_COOKIE]: makeToken(PAST_EXP) }) as never,
      );
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(AUTH_401_BODY, { status: 401 });
    });

    it('cookie 非 JWT（解析失败）→ 401 JSON AUTH_SESSION_INVALID', async () => {
      await middleware(
        createReq('/api/solve', { 'x-forwarded-for': nextIp() }, { [ACCESS_TOKEN_COOKIE]: 'not-a-jwt' }) as never,
      );
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(AUTH_401_BODY, { status: 401 });
    });

    it('cookie exp 有效且未过期 → 放行', async () => {
      await middleware(
        createReq('/api/solve', { 'x-forwarded-for': nextIp() }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
      );
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockJson).not.toHaveBeenCalled();
    });

    it('/api/sso/authorize 豁免认证粗检（无 cookie 也放行，AR2-001 防死循环）', async () => {
      await middleware(createReq('/api/sso/authorize', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockJson).not.toHaveBeenCalled();
    });

    it('任意非白名单 /api/* 均受保护：/api/jobs、/api/anything → 401（v1.3 全站 API 登录墙）', async () => {
      await middleware(createReq('/api/jobs', { 'x-forwarded-for': nextIp() }) as never);
      await middleware(createReq('/api/anything', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockJson).toHaveBeenCalledTimes(2);
      expect(mockJson).toHaveBeenCalledWith(AUTH_401_BODY, { status: 401 });
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('页面路由登录墙（受保护页面 → 302 /login?returnTo，FR-029/AC-036）', () => {
    it('/solve 无 cookie → 302 /login?returnTo=%2Fsolve', async () => {
      await middleware(createReq('/solve', { 'x-forwarded-for': nextIp() }) as never);
      expectRedirectTo('http://localhost/login?returnTo=%2Fsolve');
      expect(mockJson).not.toHaveBeenCalled();
    });

    it('/solve?source=x → returnTo 携带 query（编码 %2F %3F %3D）', async () => {
      await middleware(createReq('/solve?source=x', { 'x-forwarded-for': nextIp() }) as never);
      expectRedirectTo('http://localhost/login?returnTo=%2Fsolve%3Fsource%3Dx');
    });

    it('/result 无 cookie → 302 /login?returnTo=%2Fresult', async () => {
      await middleware(createReq('/result', { 'x-forwarded-for': nextIp() }) as never);
      expectRedirectTo('http://localhost/login?returnTo=%2Fresult');
    });

    it('/solve 有合法 cookie → 放行（不重定向）', async () => {
      await middleware(
        createReq('/solve', { 'x-forwarded-for': nextIp() }, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) }) as never,
      );
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('公开白名单（D-004/AC-035，不读 cookie 直接放行）', () => {
    it('首页 / 无 cookie 放行', async () => {
      await middleware(createReq('/', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('locale 前缀首页 /en、/zh 无 cookie 放行（AR3-001 二段式预留）', async () => {
      await middleware(createReq('/en', { 'x-forwarded-for': nextIp() }) as never);
      await middleware(createReq('/zh', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('locale 前缀登录页 /en/login、/zh/login 无 cookie 放行', async () => {
      await middleware(createReq('/en/login', { 'x-forwarded-for': nextIp() }) as never);
      await middleware(createReq('/zh/login', { 'x-forwarded-for': nextIp() }) as never);
      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('locale 前缀业务页 /en/solve 不放行 → 302 回登录（白名单仅首页/登录页）', async () => {
      await middleware(createReq('/en/solve', { 'x-forwarded-for': nextIp() }) as never);
      expectRedirectTo('http://localhost/login?returnTo=%2Fen%2Fsolve');
    });
  });

  describe('config 导出', () => {
    it('matcher 两条目：API 全集 + 页面路由负向断言（排除静态资源/metadata/顶层 login）', async () => {
      const { config } = await import('../middleware');
      expect(config.matcher).toHaveLength(2);
      expect(config.matcher).toEqual([
        '/api/:path*',
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|login).*)',
      ]);
    });

    it('matcher 语义：/login 与静态资源被负向断言排除，/solve、/en/login 命中（AC-035/AR3-010）', async () => {
      const { config } = await import('../middleware');
      const pageMatcher = new RegExp(`^${config.matcher[1]}$`);
      expect(pageMatcher.test('/solve')).toBe(true);
      expect(pageMatcher.test('/en/login')).toBe(true);
      expect(pageMatcher.test('/en')).toBe(true);
      expect(pageMatcher.test('/login')).toBe(false);
      expect(pageMatcher.test('/_next/static/chunks/x.js')).toBe(false);
      expect(pageMatcher.test('/favicon.ico')).toBe(false);
      expect(pageMatcher.test('/robots.txt')).toBe(false);
    });
  });
});
