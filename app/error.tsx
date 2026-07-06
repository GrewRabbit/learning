// app/error.tsx
// 路由段错误边界（Next.js 最佳实践 error-handling.md）
// 捕获 app/ 下所有子路由段的渲染/异常错误（不含 root layout，root 由 global-error.tsx 处理）
// 必须为 Client Component（Next.js 约定）

'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logClientError } from '@/app/lib/logging/logger';

/**
 * Error 边界组件
 *
 * 触发场景：Server/Client Component 渲染抛错、unhandled promise rejection 等
 * 不触发场景：root layout.tsx 自身抛错（由 global-error.tsx 处理）
 *
 * 注：error.digest 在生产环境由 Next.js 自动注入（用于错误追踪）
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  // 错误发生时记录到客户端错误日志（dev-workflow.md §六 logClientError）
  // 注：useEffect 避免每次渲染重复记录
  React.useEffect(() => {
    logClientError('[route-error]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-8 text-center">
      <AlertCircle className="mb-4 h-12 w-12 text-destructive" />
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        页面出错了
      </h1>
      <p className="mb-1 text-sm text-muted-foreground">
        生成或加载解题方案时发生错误，请重试。
      </p>
      {error.digest && (
        <p className="mb-6 text-xs text-muted-foreground">
          错误编号：<code className="rounded bg-muted px-1.5 py-0.5">{error.digest}</code>
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={() => reset()} className="min-w-28">
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
        <Button asChild variant="outline" className="min-w-28">
          <Link href="/">
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </Button>
      </div>
    </main>
  );
}
