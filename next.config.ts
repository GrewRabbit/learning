// next.config.ts（项目根目录，Next.js 约定位置）
// 安全头配置（P0，架构 §8.2 + §14.4 + deployment-checklist.md §三）
// 注：CSP 主要通过 iframe csp 属性应用到 srcDoc 内 HTML（见架构 §8.2），
//     next.config.ts 的 headers() 配置全局响应头，覆盖父页与所有 API 响应

import type { NextConfig } from 'next';

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
    // 父页 CSP：仅允许同源与 jsdelivr CDN（Mermaid 在 iframe 内加载，父页本身不加载 Mermaid）
    // iframe srcDoc 内 HTML 的 CSP 通过 iframe csp 属性单独配置（见架构 §8.2）
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
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
