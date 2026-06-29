// app/result/components/html-renderer.tsx
// iframe 渲染组件（架构 §4.3 + §8.2 iframe 隔离 + FR-017）
// sandbox="allow-scripts"（不加 allow-same-origin，不加 allow-top-navigation）
// 注：srcDoc iframe 会继承父页面 CSP（W3C 规范），因此 jsdelivr CDN 的放行在 next.config.ts 父页 CSP 中配置

'use client';

import * as React from 'react';

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
 * - CSP：srcDoc iframe 继承父页面 CSP（W3C 规范），jsdelivr 放行在 next.config.ts 中配置
 */
export function HtmlRenderer({
  html,
  height = 800,
}: HtmlRendererProps): React.JSX.Element {
  return (
    <iframe
      title="解题方案"
      sandbox="allow-scripts"
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
