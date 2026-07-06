// app/global-error.tsx
// 根 layout 错误边界（Next.js 最佳实践 error-handling.md）
// 捕获 root layout.tsx 自身抛出的错误（error.tsx 无法捕获 root layout 错误）
// 必须为 Client Component，且必须包含 <html> 和 <body> 标签（Next.js 约定）

'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logClientError } from '@/app/lib/logging/logger';

/**
 * GlobalError 边界组件
 *
 * 触发场景：root layout.tsx 抛错、全局 Provider 抛错
 * 与 error.tsx 的区别：error.tsx 作为 children 渲染在 root layout 内，
 *   若 root layout 自身崩溃，error.tsx 不会渲染，必须由 global-error.tsx 接管
 *
 * 注：必须自带 <html><body>，不依赖 globals.css（root layout 加载失败时 CSS 可能也加载失败）
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  React.useEffect(() => {
    logClientError('[global-error]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#fef2f2',
          color: '#991b1b',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <AlertTriangle
          size={48}
          color="#dc2626"
          style={{ marginBottom: '1rem' }}
        />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          应用发生严重错误
        </h1>
        <p style={{ fontSize: '0.875rem', marginBottom: '0.25rem', opacity: 0.9 }}>
          根布局加载失败，请刷新页面或联系管理员。
        </p>
        {error.digest && (
          <p style={{ fontSize: '0.75rem', marginBottom: '1.5rem', opacity: 0.7 }}>
            错误编号：<code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={() => reset()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1.5rem',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
            minWidth: '7rem',
            justifyContent: 'center',
          }}
        >
          <RefreshCw size={16} />
          重试
        </button>
      </body>
    </html>
  );
}
