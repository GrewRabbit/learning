// app/layout-client.tsx
// 布局客户端（dev-workflow.md Layout 拆分规范）
// 处理交互逻辑（useState、事件监听等），MVP 阶段简化但结构预留

'use client';

import * as React from 'react';

/**
 * 布局客户端组件
 * 由 layout.tsx（Server Component）调用，处理布局级交互逻辑
 * MVP 阶段无全局交互，结构预留以符合 dev-workflow.md 规范
 */
export function LayoutClient({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return <>{children}</>;
}
