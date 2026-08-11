// next.config.ts（项目根目录，Next.js 约定位置）
// 安全头配置（P0，架构 §8.2 + §14.4 + deployment-checklist.md §三）
// 注：srcDoc iframe 会继承父页面 CSP（W3C 规范 https://w3c.github.io/webappsec-csp/#initialize-document-csp），
//     因此 srcDoc iframe 内加载的资源（Mermaid 脚本 + 字体）必须同源或在本 CSP 中放行。
//     当前 Mermaid 脚本与字体均从同源 /public/_shared/ 以绝对路径加载（绝对路径经 base URI
//     继承解析到父页同源，不违反 opaque origin 限制），故 script-src / font-src 无需放行外部 CDN。
//     sandbox="allow-scripts" 隔离 iframe DOM 访问。

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
    // 父页 CSP：仅允许同源（Mermaid 脚本与字体经 srcDoc iframe 从 /public/_shared/ 同源加载）
    // 注：srcDoc iframe 继承父页 CSP，资源必须同源或在本 CSP 中放行；当前全部走同源绝对路径
    // 注：'unsafe-inline' 用于 Next.js hydration inline script（dev 与 prod 均需要）
    // 注：dev 模式额外允许 'unsafe-eval'（Next.js HMR/React Refresh 依赖 eval），
    //     prod 模式不包含 'unsafe-eval'（deployment-checklist.md §三 安全要求）
    // 安全权衡：sandbox="allow-scripts"（无 allow-same-origin）使 iframe 为 opaque origin，
    //           即使父页放行同源资源，iframe 内脚本也无法访问父页 DOM/Cookie
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
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
    value: 'camera=(self), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Docker / 容器化部署优化（cicd-workflow.md §三、deployment-checklist.md §一）
  // 生成最小化 standalone 输出，仅需 .next/standalone + .next/static + public/ 三部分
  // 避免镜像打包全量 node_modules，显著减小镜像体积
  output: 'standalone',
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
