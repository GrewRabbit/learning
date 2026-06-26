// app/page.tsx
// 首页（Server Component，FR-001/002/004/005）
// 仅渲染页面壳结构与组合 Client Component，不含交互逻辑（dev-workflow.md）

import { InputSection } from '@/app/components/input-section';

/**
 * C++ 编程培训辅助系统首页
 * - 标题与说明
 * - 题目输入区 + 标准答案补充区（交互由 InputSection Client Component 处理）
 */
export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          C++ 编程培训辅助系统
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成代码解答、解题分析、流程图与知识点思维导图
        </p>
      </header>

      <InputSection />
    </main>
  );
}
