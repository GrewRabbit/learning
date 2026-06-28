// app/result/components/html-renderer.tsx
// iframe 渲染组件（架构 §4.3 + §8.2 iframe 隔离 + FR-017）
// sandbox="allow-scripts"（不加 allow-same-origin，不加 allow-top-navigation）
// csp 属性硬编码（系统控制，不依赖 LLM 输出），仅允许 inline 脚本 + jsdelivr CDN

'use client';

import * as React from 'react';

/**
 * iframe CSP（架构 §8.2 硬编码）
 * - default-src 'none'：默认全禁
 * - script-src 'unsafe-inline' https://cdn.jsdelivr.net：允许 inline 脚本与 jsdelivr（Mermaid）
 * - style-src 'unsafe-inline'：允许 inline 样式
 * - img-src 'self' data:：允许同源图片与 data URI
 * - font-src 'self'：确保 Mermaid 字体加载
 */
const IFRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ');

export interface HtmlRendererProps {
  /** LLM 生成的 HTML 字符串（srcDoc 内容） */
  html: string;
  /** iframe 高度（默认 800px） */
  height?: number | string;
}

/**
 * HtmlRenderer：iframe srcDoc 渲染
 *
 * 安全策略（架构 §8.2）：
 * - sandbox="allow-scripts"：允许脚本执行（Mermaid 渲染），但禁止 same-origin（隔离 cookie/DOM）
 * - 不加 allow-top-navigation：禁止 iframe 跳转父页面
 * - csp 属性：独立浏览上下文，父页 CSP 不继承，由系统硬编码控制
 */
export function HtmlRenderer({
  html,
  height = 800,
}: HtmlRendererProps): React.JSX.Element {
  return (
    <iframe
      title="解题网页"
      sandbox="allow-scripts"
      // csp 属性 React 需小写，HTML 会被序列化为 csp="..."
      // React 19 前 iframe 不识别 csp 属性，需 ts-expect-error 展开
      // @ts-expect-error - csp 属性不在 React iframe 类型定义中
      csp={IFRAME_CSP}
      srcDoc={html}
      style={{
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        border: '1px solid hsl(var(--border))',
        borderRadius: '0.5rem',
      }}
    />
  );
}
