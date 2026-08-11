// middleware.ts（项目根目录，Next.js 约定位置）
// 速率限制（P0，架构 §8.2 + §14.4）
// 策略：单 IP 每分钟 20 次，内存 Map（key 为 IP，value 为时间戳数组），每分钟清理过期记录
//
// 全站登录墙认证粗检（v1.3，架构 §4.1.3，AR1-001/AR1-009/AR2-001/FR-016/FR-029/D-002/D-004）：
//   - 适用范围：/api/* 全集 + 页面路由全集（matcher 负向断言排除框架静态资源 / metadata 根资源 / 登录入口页）
//   - 粗检语义：读 sso_access_token cookie，仅 base64url 解码 JWT payload 取 exp（不验签，FR-016），
//     不存在/解码失败/已过期 → 未认证，按路径类型分流：
//       · 受保护 API 路径（/api/ 开头）→ 401 JSON AUTH_SESSION_INVALID（FR-016：非浏览器客户端不收到 HTML 登录页）
//       · 受保护页面路径（非 /api/*）→ 302 → /login?returnTo=<原路径>（FR-029，returnTo 编码传递，登录成功回跳）
//   - 公开白名单常量（D-004，认证豁免，实现语义）：'/api/sso' 前缀、'/api/health'、'/' 首页、
//     [locale] 前缀首页 /<locale> 与 locale 前缀登录页 /{locale}/login（AR3-001）；
//     FR-028 业务白名单成员顶层 '/login' 不经白名单常量——由 matcher 负向断言排除（不进 middleware，AR3-010）
//   - 白名单命中 → 直接放行（不读 cookie）；未认证请求同样消耗限流配额（AR1-001）
//   - 302 重定向 locale 二段式（AR1-009）：① [locale] 落地前维持现状顶层 /login；② [locale] 落地后
//     从请求路径提取首段 locale 命中支持列表则 302 → /{locale}/login（该目标由白名单按 locale 支持列表豁免认证）
//   - 粗检不引用任何服务端 SSO 密钥环境变量（FR-024：Edge 环境
//     引用密钥会被打包内联泄露）；完整验签在 Node 层 app/lib/auth/guard.ts（M5）完成
//
// 顺序（AR1-001）：限流 → 白名单豁免 → 认证粗检（API 401 / 页面 302）→ 放行
//
// Edge Runtime 约束（dev-workflow.md §五）：
//   - 中间件在 Edge Runtime 运行，禁止使用 logger（只能用 console）
//   - 仅用 Web API（atob / TextDecoder / Uint8Array），禁止 Node 原生模块
//   - 不引入重型依赖
//
// 适用范围：/api/* 全集 + 页面路由全集（/api/health 不限流，便于部署探活）

import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie';

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 分钟窗口
// 单 IP 每分钟最多 20 次（P0 调整：原 5 次过低）
// 配额消耗说明：1 题最多 4 次 LLM 调用（生成 1 次 + 修正循环 3 次）
// 20 次配额允许单用户每分钟最多 5 题并发，覆盖正常使用场景
const RATE_LIMIT_MAX = 20;

// 公开白名单常量（D-004，认证豁免，实现语义；单一来源，供限流后的认证粗检引用）
// - '/api/sso' 前缀：OIDC 回调链（authorize/callback/logout/refresh）必须免认证，
//   否则自身 302 死循环（AR2-001）；仅限流，不豁免
// - '/api/health'：运维探活（同时豁免限流，见 middleware 内早退分支）
// - '/' 首页：公开（FR-028）
// - [locale] 前缀首页（/<locale>）与 locale 前缀登录页（/{locale}/login）：延续 '/' 与 '/login' 公开语义
//   （AR3-001，见 isLocalePrefixedPublicPath）
// - 顶层 '/login' 不在本常量内：由 matcher 负向断言排除（不进 middleware，实现路径不同，AR3-010）
// 限流豁免：仅 '/api/health'（现状不变，便于部署探活）

/** [locale] 支持列表（AR1-009/AR3-001）：落地后按 i18n 配置同步；当前阶段仅用于白名单判定预留 */
const SUPPORTED_LOCALES = ['en', 'zh'] as const;

/**
 * 判断路径是否为 locale 前缀公开路径（[locale] 二段式白名单预留，AR3-001）
 *
 * [locale] 落地后：/<locale> 延续 '/' 首页公开语义、/{locale}/login 延续 '/login' 登录页公开语义；
 * 其余 /<locale>/... 业务页仍需认证（若被 matcher 拦入则按未认证分流）。
 * 当前阶段 [locale] 未落地，无此类路径进入 middleware；本函数按 locale 支持列表精确匹配（非前缀模糊）。
 *
 * @param pathname 请求路径
 * @returns true = locale 前缀公开路径（首页或登录页）
 */
function isLocalePrefixedPublicPath(pathname: string): boolean {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname === `/${locale}` || pathname === `/${locale}/login`) {
      return true;
    }
  }
  return false;
}

/**
 * 认证豁免白名单判定（D-004，单一来源；实现语义，AR3-010）
 *
 * @param pathname 请求路径
 * @returns true = 公开路径，豁免认证粗检（直接放行，不读 cookie）
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/') {
    return true; // 首页公开（FR-028）
  }
  if (pathname.startsWith('/api/sso')) {
    return true; // OIDC 回调链（AR2-001：防自身 302 死循环）
  }
  if (pathname === '/api/health') {
    return true; // 运维探活
  }
  return isLocalePrefixedPublicPath(pathname); // [locale] 前缀首页与登录页（AR3-001）
}

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
 * @returns true = 会话粗检通过（放行）；false = 未认证（按路径类型 401 / 302 分流）
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

  // 公开白名单豁免认证（D-004）：命中直接放行（不读 cookie）
  // 顶层 /login 由 matcher 负向断言排除，不进本判定（AR3-010）
  if (isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // 认证粗检（架构 §4.1.3，FR-016/FR-029）：受保护子集（非白名单）未认证 → 分流
  if (!isSessionValid(req)) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      // 受保护 API 路径 → 401 JSON（FR-016：非浏览器客户端不收到 HTML 登录页）
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'AUTH_SESSION_INVALID',
            message: '未登录或会话已过期',
          },
        },
        { status: 401 },
      );
    }
    // 受保护页面路径 → 302 → /login?returnTo=<原路径>（FR-029，returnTo 编码传递，登录成功回跳）
    // AR1-009 二段式①：[locale] 落地前维持现状顶层 /login；[locale] 落地后此处改为按 locale 前缀二段式
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('returnTo', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * 匹配器（架构 §4.1.3，D-002，三分类）：
 * ① /api/:path*：API 全集——限流覆盖（先于认证）；/api/health 在 middleware 内豁免限流；
 *    /api/sso/* 与 /api/health 豁免认证粗检（公开白名单，FR-028）
 * ② 页面路由负向断言：排除框架静态资源、metadata 根资源与登录入口页——不进 middleware
 *    （Next.js 惯例，认证不得拦截，FR-028/AC-035）：
 *    _next/static、_next/image（构建产物/图片优化）、favicon.ico、icon.svg / apple-icon /
 *    opengraph-image / twitter-image（metadata 约定根资源）、robots.txt / sitemap.xml（SEO 抓取）、
 *    happyrabbit-logo.png（品牌 Logo，图片优化器内部回源该路径，若被拦则 /_next/image 优化失败 400）、
 *    _shared（public 静态共享目录：Mermaid 脚本 / 字体等，srcDoc iframe 同源加载）、
 *    顶层 login（登录入口页自身，防 302 死循环：登录页被拦则无法发起登录）；
 *    首页 / 进 matcher，middleware 内按公开白名单豁免认证（限流生效，防高频抓取，D-004）
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|happyrabbit-logo.png|_shared|login).*)',
  ],
};
