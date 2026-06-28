// app/page.tsx
// 首页（Server Component）
// 提供入口链接到 /solve 输入页

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 py-8 text-center">
      <header className="mb-8 space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          GESP6 解题网页生成器
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成解题讲解网页
        </p>
      </header>
      <Button asChild size="lg">
        <Link href="/solve">开始使用</Link>
      </Button>
    </main>
  );
}
