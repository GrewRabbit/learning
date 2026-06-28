// middleware.ts（项目根目录，Next.js 约定位置）
// 速率限制（P0，架构 §8.2 + §14.4）
// 策略：单 IP 每分钟 5 次，内存 Map（key 为 IP，value 为时间戳数组），每分钟清理过期记录
//
// Edge Runtime 约束（dev-workflow.md §五）：
//   - 中间件在 Edge Runtime 运行，禁止使用 logger（只能用 console）
//   - 仅做认证检查与速率限制，不引入重型依赖
//
// 适用范围：所有 /api/* 路由（健康检查 /api/health 不限流，便于部署探活）

import { NextResponse, type NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 分钟窗口
const RATE_LIMIT_MAX = 5;            // 单 IP 每分钟最多 5 次

// 内存 Map：key 为 IP，value 为该 IP 在窗口内的时间戳数组
// 注：Edge Runtime 多实例下内存不共享，精确限流需 Redis；MVP 阶段单实例足够（P2 优化项）
const ipRequestMap = new Map<string, number[]>();

/**
 * 清理过期时间戳（窗口外的记录）
 */
function pruneExpiredTimestamps(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
}

/**
 * 提取客户端 IP
 * 优先取 x-forwarded-for 首段（经代理时），回退 x-real-ip，最后回退 'unknown'
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function middleware(req: NextRequest): NextResponse {
  // 健康检查不限流（便于部署探活）
  if (req.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  const ip = getClientIp(req);
  const now = Date.now();

  const raw = ipRequestMap.get(ip) ?? [];
  const valid = pruneExpiredTimestamps(raw, now);

  if (valid.length >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'GESP6_RATE_LIMITED',
          message: '请求过于频繁，请稍后再试（每分钟最多 5 次）',
        },
      },
      { status: 429 },
    );
  }

  valid.push(now);
  ipRequestMap.set(ip, valid);

  return NextResponse.next();
}

/**
 * 匹配器：仅对 /api/* 路由生效（排除 _next/static、_next/image、favicon.ico）
 */
export const config = {
  matcher: ['/api/:path*'],
};
