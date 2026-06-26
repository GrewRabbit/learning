// app/solution/page.tsx
// 解题结果页（Server Component，FR-030/031）
// 仅渲染壳结构与布局，不参与 SSE 数据获取
// SSE 流式数据由 solution-tabs.tsx（Client Component）通过 fetch 消费（架构 §6.3 AR1-004）

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { SolutionTabs } from '@/app/solution/components/solution-tabs';

/**
 * 解题结果页元数据
 */
export const metadata: Metadata = {
  title: '解题结果 - C++ 编程培训辅助系统',
  description: 'AI 生成的代码、分析、流程图与思维导图',
};

/**
 * searchParams 类型（Next.js 15：searchParams 为 Promise）
 */
interface SolutionSearchParams {
  problem?: string;
  standardAnswer?: string;
  mode?: string;
}

/**
 * 解题结果页
 * - 从 searchParams 读取 problem（题目文本）与可选 standardAnswer
 * - 校验 problem 非空，否则提示返回首页
 * - 将 problem/standardAnswer/mode 传递给 SolutionTabs Client Component
 */
export default async function SolutionPage({
  searchParams,
}: {
  searchParams: Promise<SolutionSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const problem = params.problem ?? '';
  const standardAnswer = params.standardAnswer;
  // mode 默认 normal；显式 deep 时使用 deep（FR-005）
  const mode: 'normal' | 'deep' = params.mode === 'deep' ? 'deep' : 'normal';

  // 缺失 problem 参数：提示返回首页
  if (!problem.trim()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-4 px-4 py-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">
          未提供题目文本
        </h1>
        <p className="text-sm text-muted-foreground">
          请先在首页输入题目后再生成解答
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页修改题目
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          解题结果
        </h1>
        {standardAnswer && (
          <p className="mt-1 text-xs text-primary">
            当前为「基于标准答案深度解读」模式
          </p>
        )}
      </header>

      <SolutionTabs
        problem={problem}
        standardAnswer={standardAnswer}
        mode={mode}
      />
    </main>
  );
}
