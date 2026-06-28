// app/result/page.tsx
// 结果展示页（架构 §4.3 + §6 + FR-017/018/019）
// 读取 sessionStorage 中的 Solution，渲染 WarningBanner + HtmlRenderer
// 无数据时提示返回 /solve

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HtmlRenderer } from './components/html-renderer';
import { WarningBanner } from './components/warning-banner';
import type { Solution } from '@/app/lib/ai/types';
import { SOLUTION_STORAGE_KEY } from '../solve/page';

export default function ResultPage(): React.JSX.Element {
  const [solution, setSolution] = React.useState<Solution | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SOLUTION_STORAGE_KEY);
      if (stored) {
        setSolution(JSON.parse(stored) as Solution);
      }
    } catch {
      // 解析失败视为无数据
    }
    setReady(true);
  }, []);

  // 加载中（避免 hydration 不一致）
  if (!ready) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
        <p className="text-center text-muted-foreground">加载中...</p>
      </main>
    );
  }

  // 无数据
  if (!solution) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <p className="text-muted-foreground">未找到解题结果，请重新生成</p>
          <Button asChild>
            <Link href="/solve">返回输入页</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            解题结果
          </h1>
          <p className="text-xs text-muted-foreground">
            {solution.cached ? '来自缓存' : '新生成'}
            {' · '}
            {solution.validated ? '已通过代码验证' : '未通过代码验证'}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/solve">重新生成</Link>
        </Button>
      </header>

      {!solution.validated && <WarningBanner warning={solution.warning} />}

      <div className="mt-4">
        <HtmlRenderer html={solution.html} />
      </div>
    </main>
  );
}
