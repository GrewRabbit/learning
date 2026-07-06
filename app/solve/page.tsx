// app/solve/page.tsx
// 题目输入页（架构 §6 + §4.3 + FR-001/002/003）
// 入口：渲染页面 header + SolveForm 表单组件
// 表单/输入区逻辑见 components/solve-form.tsx
// 提交/轮询逻辑见 hooks/use-job-polling.ts

'use client';

import * as React from 'react';
import { SolveForm } from './components/solve-form';

export default function SolvePage(): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          信奥赛 C++ 解题专家
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成解题讲解方案
        </p>
      </header>
      <SolveForm />
    </main>
  );
}
