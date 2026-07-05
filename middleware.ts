// middleware.ts（项目根目录，Next.js 约定位置）
// 速率限制（P0，架构 §8.2 + §14.4）
// 策略：单 IP 每分钟 20 次，内存 Map（key 为 IP，value 为时间戳数组），每分钟清理过期记录
//
// 认证检查（dev-workflow.md §五）：
//   - 受保护路由（/api/solve）需通过 isAuthenticated 检查，未登录 → 重定向至 /login
//   - 当前为匿名模式（isAuthenticated 返回 true），待 SSO/LDAP 方案确认后实施
//
// Edge Runtime 约束（dev-workflow.md §五）：
//   - 中间件在 Edge Runtime 运行，禁止使用 logger（只能用 console）
//   - 仅做认证检查与速率限制，不引入重型依赖
//
// 适用范围：所有 /api/* 路由（健康检查 /api/health 不限流，便于部署探活）

import { NextResponse, type NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 分钟窗口
// 单 IP 每分钟最多 20 次（P0 调整：原 5 次过低）
// 配额消耗说明：1 题最多 4 次 LLM 调用（生成 1 次 + 修正循环 3 次）
// 20 次配额允许单用户每分钟最多 5 题并发，覆盖正常使用场景
const RATE_LIMIT_MAX = 20;

// 受保护路由前缀（dev-workflow.md §五：未登录访问受保护路由 → 重定向至 /login）
// /api/solve 触发 LLM 调用消耗成本，必须经过认证检查
const PROTECTED_API_PREFIX = '/api/solve';

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

/**
 * 认证检查（预留钩子，待 SSO/LDAP 方案确认后实施）
 *
 * 当前为匿名模式，返回 true（允许所有请求通过）。
 * TODO: 集成 SSO/LDAP 后实现真实认证逻辑：
 *   - 从 Cookie 提取 session id / JWT
 *   - 调用 LDAP/SSO 服务验证会话有效性
 *   - 返回 boolean 表示是否已认证
 *
 * Edge Runtime 限制（dev-workflow.md §六）：
 *   - 禁止使用 logger（只能用 console）
 *   - 禁止使用 Node.js 原生模块（fs、node:crypto 等）
 *   - 仅可使用 Web API（Request、Response、Headers、SubtleCrypto 等）
 *
 * @param _req NextRequest 对象（预留参数，未来认证实现会用到）
 * @returns 是否已认证
 */
function isAuthenticated(_req: NextRequest): boolean {
  // TODO: SSO/LDAP 集成后实现真实认证逻辑
  // 当前匿名模式：允许所有请求通过
  return true;
}

export function middleware(req: NextRequest): NextResponse {
  // 健康检查不限流（便于部署探活）
  if (req.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  // 认证检查（dev-workflow.md §五）
  // 受保护路由（/api/solve）触发 LLM 调用消耗成本，未登录 → 重定向至 /login
  // 当前 isAuthenticated 总是返回 true（匿名模式），待 SSO/LDAP 集成后启用
  if (
    req.nextUrl.pathname.startsWith(PROTECTED_API_PREFIX) &&
    !isAuthenticated(req)
  ) {
    return NextResponse.redirect(new URL('/login', req.url));
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
          message: '请求过于频繁，请稍后再试（每分钟最多 20 次）',
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
