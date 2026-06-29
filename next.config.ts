// next.config.ts（项目根目录，Next.js 约定位置）
// 安全头配置（P0，架构 §8.2 + §14.4 + deployment-checklist.md §三）
// 注：srcDoc iframe 会继承父页面 CSP（W3C 规范 https://w3c.github.io/webappsec-csp/#initialize-document-csp），
//     因此 jsdelivr CDN（Mermaid 脚本 + 字体）的放行必须配置在父页 CSP 中。
//     父页本身不加载 jsdelivr，但继承机制要求在此放行；sandbox="allow-scripts" 隔离 iframe DOM 访问。

import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // 父页 CSP：允许同源 + jsdelivr CDN（Mermaid 脚本与字体在 srcDoc iframe 内加载）
    // 注：srcDoc iframe 继承父页 CSP，若父页不放行 jsdelivr，iframe 内 Mermaid 会被拦截
    // 注：'unsafe-inline' 用于 Next.js hydration inline script（dev 与 prod 均需要）
    // 注：dev 模式额外允许 'unsafe-eval'（Next.js HMR/React Refresh 依赖 eval），
    //     prod 模式不包含 'unsafe-eval'（deployment-checklist.md §三 安全要求）
    // 安全权衡：sandbox="allow-scripts"（无 allow-same-origin）使 iframe 为 opaque origin，
    //           即使父页放行 jsdelivr，iframe 内脚本也无法访问父页 DOM/Cookie
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net"
        : "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' https://cdn.jsdelivr.net",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // 应用到所有路由
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
