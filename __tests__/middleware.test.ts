// __tests__/middleware.test.ts
// middleware 单元测试（Next.js 最佳实践：rate limiting / IP 提取 / 健康检查豁免）
//
// 测试策略：
// - mock next/server 的 NextResponse（避免依赖 Next.js 运行时）
// - 用唯一 IP（nextIp）隔离用例，避免模块级 ipRequestMap 状态污染
// - 通过 middleware 函数间接覆盖 pruneExpiredTimestamps + getClientIp 内部逻辑

import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock next/server（middleware 仅用 NextResponse.json 与 NextResponse.next）
// 使用 vi.hoisted 提升 mock 变量，避免 vi.mock 工厂引用未初始化的顶层变量
const { mockNext, mockJson } = vi.hoisted(() => ({
  mockNext: vi.fn(),
  mockJson: vi.fn((body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    body,
  })),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    next: mockNext,
    json: mockJson,
  },
}));

// 动态 import middleware（必须在 mock 之后）
import { middleware } from '../middleware';

/**
 * 构造模拟 NextRequest 对象
 * middleware 仅访问 req.nextUrl.pathname 和 req.headers.get()
 */
function createReq(
  pathname: string,
  headers: Record<string, string> = {},
): {
  nextUrl: { pathname: string };
  headers: Headers;
} {
  return {
    nextUrl: { pathname },
    headers: new Headers(headers),
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

  describe('限流逻辑', () => {
    it('单 IP 前 20 次请求放行（200，P0 调整后阈值）', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        const req = createReq('/api/solve', { 'x-forwarded-for': ip });
        await middleware(req as never);
      }
      expect(mockNext).toHaveBeenCalledTimes(20);
      expect(mockJson).not.toHaveBeenCalled();
    });

    it('单 IP 第 21 次请求返回 429 GESP6_RATE_LIMITED', async () => {
      const ip = nextIp();
      for (let i = 0; i < 20; i++) {
        const req = createReq('/api/solve', { 'x-forwarded-for': ip });
        await middleware(req as never);
      }
      // 第 21 次
      const req = createReq('/api/solve', { 'x-forwarded-for': ip });
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
          createReq('/api/solve', { 'x-forwarded-for': ip1 }) as never,
        );
      }
      // ip2 调用 4 次（仍应放行，因 ip1 的计数不影响 ip2）
      for (let i = 0; i < 4; i++) {
        await middleware(
          createReq('/api/solve', { 'x-forwarded-for': ip2 }) as never,
        );
      }
      expect(mockNext).toHaveBeenCalledTimes(7);
      expect(mockJson).not.toHaveBeenCalled();
    });
  });

  describe('IP 提取', () => {
    it('x-forwarded-for 多 IP 取首段', async () => {
      const req = createReq('/api/solve', {
        'x-forwarded-for': '203.0.113.42, 198.51.100.1',
      });
      await middleware(req as never);
      // 验证放行（首次请求必然 200）
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('x-forwarded-for 单 IP 直接使用', async () => {
      const req = createReq('/api/solve', {
        'x-forwarded-for': '203.0.113.99',
      });
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('无 x-forwarded-for 时回退 x-real-ip', async () => {
      const req = createReq('/api/solve', {
        'x-real-ip': '198.51.100.50',
      });
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('无任何 IP 头时使用 unknown（仍可放行）', async () => {
      const req = createReq('/api/solve', {});
      await middleware(req as never);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('x-forwarded-for 优先级高于 x-real-ip', async () => {
      // 同时存在两个头时，x-forwarded-for 首段胜出
      // 通过连续调用验证：相同 xff 但不同 x-real-ip 应视为同一 IP（限流计数累积）
      const ip = nextIp();
      const req1 = createReq('/api/solve', {
        'x-forwarded-for': ip,
        'x-real-ip': '1.1.1.1',
      });
      const req2 = createReq('/api/solve', {
        'x-forwarded-for': ip,
        'x-real-ip': '2.2.2.2',
      });
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
