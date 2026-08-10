// __tests__/middleware.test.ts
// middleware 单元测试（Next.js 最佳实践：rate limiting / IP 提取 / 健康检查豁免 / 认证粗检）
//
// 测试策略：
// - mock next/server 的 NextResponse（避免依赖 Next.js 运行时）
// - 用唯一 IP（nextIp）隔离用例，避免模块级 ipRequestMap 状态污染
// - 受保护路径（/api/solve）用例携带有效 exp 的假 JWT cookie，避免认证粗检 302 干扰限流断言
// - 通过 middleware 函数间接覆盖 pruneExpiredTimestamps + getClientIp + decodeJwtExp + isSessionValid 内部逻辑

import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock next/server（middleware 用 NextResponse.next / json / redirect）
// 使用 vi.hoisted 提升 mock 变量，避免 vi.mock 工厂引用未初始化的顶层变量
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

// 动态 import middleware（必须在 mock 之后）
import { middleware } from '../middleware';

// 与 token-cookie.ts 保持一致（middleware 粗检读取的 cookie 名）
const ACCESS_TOKEN_COOKIE = 'sso_access_token';

/** 未来时间戳（Unix 秒），用于构造有效 token */
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
/** 过去时间戳（Unix 秒），用于构造过期 token */
const PAST_EXP = Math.floor(Date.now() / 1000) - 3600;

/**
 * 构造假 JWT（middleware 粗检仅 base64url 解码 payload 取 exp，不验签）
 * 因此签名段可为任意非空字符串，header 也无需真实。
 */
function makeToken(exp: number): string {
  const encode = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = encode({ alg: 'RS256', kid: 'test-key' });
  const payload = encode({ iss: 'https://idp.example.com', sub: 'user-123', exp });
  return `${header}.${payload}.fake-signature`;
}

/**
 * 构造模拟 NextRequest 对象
 * middleware 访问 req.nextUrl.pathname、req.url、req.headers.get()、req.cookies.get()
 */
function createReq(
  pathname: string,
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
): {
  nextUrl: { pathname: string };
  url: string;
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
} {
  return {
    nextUrl: { pathname },
    url: `http://localhost${pathname}`,
    headers: new Headers(headers),
    cookies: {
      get: (name: string): { value: string } | undefined => {
        const value = cookies[name];
        return value !== undefined ? { value } : undefined;
      },
    },
  };
}

/** 生成唯一 IP（避免模块级 ipRequestMap 跨用例污染） */
let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `10.0.0.${ipSeq}`;
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('/api/health 豁免', () => {
    it('健康检查路径直接放行（不进入限流分支）', async () => {
      const req = createReq('/api/health');
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockJson).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('健康检查不限次（连续调用始终放行）', async () => {
      const req = createReq('/api/health');
      for (let i = 0; i < 20; i++) {
        await middleware(req as never);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      expect(mockJson).not.toHaveBeenCalled();
    });
  });

  describe('限流逻辑（先于认证，AR1-001）', () => {
    it('单 IP 前 20 次请求放行（200，P0 调整后阈值）', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        const req = createReq(
          '/api/solve',
          { 'x-forwarded-for': ip },
          { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
        );
        await middleware(req as never);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      expect(mockJson).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('单 IP 第 21 次请求返回 429 GESP6_RATE_LIMITED', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        const req = createReq(
          '/api/solve',
          { 'x-forwarded-for': ip },
          { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
        );
        await middleware(req as never);
      }
      // 第 21 次
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': ip },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(
        {
          success: false,
          error: {
            code: 'GESP6_RATE_LIMITED',
            message: expect.stringContaining('每分钟最多 20 次'),
          },
        },
        { status: 429 },
      );
    });

    it('不同 IP 独立计数（不互相影响）', async () => {
      const ip1 = nextIp();
      const ip2 = nextIp();
      // ip1 调用 3 次
      for (let i = 0; i < 3; i++) {
        await middleware(
          createReq(
            '/api/solve',
            { 'x-forwarded-for': ip1 },
            { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
          ) as never,
        );
      }
      // ip2 调用 4 次（仍应放行，因 ip1 的计数不影响 ip2）
      for (let i = 0; i < 4; i++) {
        await middleware(
          createReq(
            '/api/solve',
            { 'x-forwarded-for': ip2 },
            { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
          ) as never,
        );
      }
      expect(mockNext).toHaveBeenCalledTimes(7);
      expect(mockJson).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('未认证请求同样消耗配额：21 次无 cookie 请求第 21 次返回 429（而非 302）', async () => {
      const ip = nextIp();
      // 前 20 次：通过限流，但认证粗检失败 → 302（配额已消耗）
      for (let i = 0; i < 20; i++) {
        await middleware(createReq('/api/solve', { 'x-forwarded-for': ip }) as never);
      }
      expect(mockRedirect).toHaveBeenCalledTimes(20);
      // 第 21 次：限流先于认证生效 → 429
      await middleware(createReq('/api/solve', { 'x-forwarded-for': ip }) as never);
      expect(mockJson).toHaveBeenCalledTimes(1);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { code: 'GESP6_RATE_LIMITED', message: expect.any(String) },
        }),
        { status: 429 },
      );
    });
  });

  describe('IP 提取', () => {
    it('x-forwarded-for 多 IP 取首段', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': '203.0.113.42, 198.51.100.1' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      // 验证放行（首次请求必然 200）
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('x-forwarded-for 单 IP 直接使用', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-forwarded-for': '203.0.113.99' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('无 x-forwarded-for 时回退 x-real-ip', async () => {
      const req = createReq(
        '/api/solve',
        { 'x-real-ip': '198.51.100.50' },
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('无任何 IP 头时使用 unknown（仍可放行）', async () => {
      const req = createReq(
        '/api/solve',
        {},
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('x-forwarded-for 优先级高于 x-real-ip', async () => {
      // 同时存在两个头时，x-forwarded-for 首段胜出
      // 通过连续调用验证：相同 xff 但不同 x-real-ip 应视为同一 IP（限流计数累积）
      const ip = nextIp();
      const makeReq = (headers: Record<string, string>): ReturnType<typeof createReq> =>
        createReq('/api/solve', headers, { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) });
      const req1 = makeReq({ 'x-forwarded-for': ip, 'x-real-ip': '1.1.1.1' });
      const req2 = makeReq({ 'x-forwarded-for': ip, 'x-real-ip': '2.2.2.2' });
      // 调用 21 次（应触发限流，因为 xff 优先，x-real-ip 被忽略，相同 IP 累计计数达 20 阈值）
      for (let i = 0; i < 21; i++) {
        await middleware(req1 as never);
      }
      // 第 21 次应已触发 429
      expect(mockJson).toHaveBeenCalled();
      // 换 x-real-ip 但保持 x-forwarded-for 相同 → 应继续被限流
      mockJson.mockClear();
      await middleware(req2 as never);
      expect(mockJson).toHaveBeenCalled();
    });
  });

  describe('认证粗检（仅受保护路由 /api/solve，架构 §4.1.3）', () => {
    it('受保护路由无 cookie → 302 重定向 /login（顶层路径，AR1-009）', async () => {
      const req = createReq('/api/solve');
      await middleware(req as never);
      expect(mockRedirect).toHaveBeenCalledTimes(1);
      expect(mockRedirect).toHaveBeenCalledWith(new URL('/login', 'http://localhost/api/solve'));
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('受保护路由 cookie exp 已过期 → 302 重定向 /login', async () => {
      const req = createReq(
        '/api/solve',
        {},
        { [ACCESS_TOKEN_COOKIE]: makeToken(PAST_EXP) },
      );
      await middleware(req as never);
      expect(mockRedirect).toHaveBeenCalledTimes(1);
      expect(mockRedirect).toHaveBeenCalledWith(new URL('/login', 'http://localhost/api/solve'));
    });

    it('受保护路由 cookie 非 JWT（解析失败）→ 302 重定向 /login', async () => {
      const req = createReq(
        '/api/solve',
        {},
        { [ACCESS_TOKEN_COOKIE]: 'not-a-jwt' },
      );
      await middleware(req as never);
      expect(mockRedirect).toHaveBeenCalledTimes(1);
      expect(mockRedirect).toHaveBeenCalledWith(new URL('/login', 'http://localhost/api/solve'));
    });

    it('受保护路由 cookie exp 有效 → 放行', async () => {
      const req = createReq(
        '/api/solve',
        {},
        { [ACCESS_TOKEN_COOKIE]: makeToken(FUTURE_EXP) },
      );
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('/api/sso/* 豁免认证粗检（无 cookie 也放行，仅限流，AR2-001）', async () => {
      const req = createReq('/api/sso/authorize');
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('非受保护 /api 路径（如 /api/jobs）不触发粗检', async () => {
      const req = createReq('/api/jobs');
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('非 /api/* 路径', () => {
    it('页面路径 /solve 也经过 middleware 函数（matcher 在 config 控制，函数本身不区分）', async () => {
      const ip = nextIp();
      const req = createReq('/solve', { 'x-forwarded-for': ip });
      await middleware(req as never);
      // middleware 函数不区分路径是否为 /api/*（除 /api/health 豁免外），统一计数限流
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('config 导出', () => {
    it('matcher 仅匹配 /api/* 路由', async () => {
      const { config } = await import('../middleware');
      expect(config.matcher).toEqual(['/api/:path*']);
    });
  });
});
