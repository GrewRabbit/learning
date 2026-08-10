// middleware.ts（项目根目录，Next.js 约定位置）
// 速率限制（P0，架构 §8.2 + §14.4）
// 策略：单 IP 每分钟 20 次，内存 Map（key 为 IP，value 为时间戳数组），每分钟清理过期记录
//
// 认证粗检（架构 §4.1.3，AR1-001/AR1-009/AR2-001/FR-016/FR-024）：
//   - 仅对受保护路由（/api/solve）做粗检：读 sso_access_token cookie，
//     仅 base64url 解码 JWT payload 取 exp（不验签，FR-016），
//     不存在/解码失败/已过期 → 302 重定向至 /login（[locale] 未落地，维持顶层 /login，AR1-009）
//   - /api/sso/* 不在受保护前缀内，天然豁免粗检（否则自身 302 死循环，AR2-001），但仍走限流
//   - 粗检不引用任何服务端 SSO 密钥环境变量（FR-024：Edge 环境
//     引用密钥会被打包内联泄露）；完整验签在 Node 层 app/lib/auth/guard.ts（M5）完成
//
// 顺序（AR1-001）：限流先于认证，未认证请求同样消耗配额
//
// Edge Runtime 约束（dev-workflow.md §五）：
//   - 中间件在 Edge Runtime 运行，禁止使用 logger（只能用 console）
//   - 仅用 Web API（atob / TextDecoder / Uint8Array），禁止 Node 原生模块
//   - 不引入重型依赖
//
// 适用范围：所有 /api/* 路由（健康检查 /api/health 不限流，便于部署探活）

import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 分钟窗口
// 单 IP 每分钟最多 20 次（P0 调整：原 5 次过低）
// 配额消耗说明：1 题最多 4 次 LLM 调用（生成 1 次 + 修正循环 3 次）
// 20 次配额允许单用户每分钟最多 5 题并发，覆盖正常使用场景
const RATE_LIMIT_MAX = 20;

// 受保护路由前缀（架构 §4.1.3：触发 LLM 调用消耗成本，必须经过认证粗检）
// /api/sso/* 不在本前缀内 → 自动豁免粗检（避免自身 302 死循环，AR2-001）
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
 * 解码 JWT payload 中的 exp（仅 base64url 解码，不验签，FR-016）
 *
 * Edge Runtime 兼容：仅用 Web API（atob / TextDecoder / Uint8Array），不引 Node 模块。
 * 任何解析异常（非三段结构 / base64 非法 / JSON 解析失败 / exp 非有限数字）→ undefined。
 *
 * @param token JWT 字符串
 * @returns exp（Unix 秒）；解析失败返回 undefined
 */
function decodeJwtExp(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    // base64url → base64（补齐 padding）
    const base64url = parts[1] ?? '';
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    // atob 返回二进制字符串，经 TextDecoder 正确处理 UTF-8（payload 可能含多字节字符）
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json) as { exp?: unknown };
    const exp = payload.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 认证粗检（架构 §4.1.3，FR-016）
 *
 * 仅检查 sso_access_token cookie 是否存在且 exp 未过期：
 * - 不验签（验签在 Node 层 guard.ts，Edge 无 JWKS 密钥）
 * - 不引用任何服务端 SSO 密钥环境变量（FR-024）
 *
 * @param req NextRequest（读取 cookies）
 * @returns true = 会话粗检通过（放行）；false = 应重定向至 /login
 */
function isSessionValid(req: NextRequest): boolean {
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  if (!token) {
    return false;
  }
  const exp = decodeJwtExp(token);
  return exp !== undefined && exp > Math.floor(Date.now() / 1000);
}

export function middleware(req: NextRequest): NextResponse {
  // 健康检查不限流（便于部署探活）
  if (req.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  // 限流（架构 §4.1.3 AR1-001：先于认证，未认证请求同样消耗配额）
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

  // 认证粗检（架构 §4.1.3）：仅受保护路由（/api/solve），/api/sso/* 天然豁免
  if (
    req.nextUrl.pathname.startsWith(PROTECTED_API_PREFIX) &&
    !isSessionValid(req)
  ) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

/**
 * 匹配器：仅对 /api/* 路由生效（排除 _next/static、_next/image、favicon.ico）
 */
export const config = {
  matcher: ['/api/:path*'],
};
