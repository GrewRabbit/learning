// app/not-found.tsx
// 自定义 404 页面（Next.js 最佳实践 error-handling.md）
// 触发场景：访问不存在的路由、Server Component 调用 notFound()
// 注：可为 Server Component，无需 'use client'

import Link from 'next/link';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * NotFound 404 页面
 *
 * 触发场景：
 * - 访问不存在的路由（如 /foo）
 * - Server Component 调用 notFound()（当前项目未使用，预留）
 */
export default function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-8 text-center">
      <Compass className="mb-4 h-12 w-12 text-muted-foreground" />
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
        404
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        页面不存在，请检查 URL 或返回首页。
      </p>
      <Button asChild>
        <Link href="/">
          <Home className="h-4 w-4" />
          返回首页
        </Link>
      </Button>
    </main>
  );
}
