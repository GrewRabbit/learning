// app/solution/components/analysis-display.tsx
// 解题分析展示组件（FR-014/015/016）
// - Markdown 实时渲染（react-markdown + remark-gfm）
// - 流式追加：每次 analysis 更新自动重渲染（FR-015）
// - 标准答案深度解读标签（FR-016，mode === 'deep'）
// - 降级 UI：analysisEmpty 时显示「重新生成」按钮（§4.2.4）
// - 通过 components 自定义元素样式，使用语义化 CSS 变量（不依赖 @tailwindcss/typography）

'use client';

import * as React from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader, RefreshCw, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * 分析展示组件 Props
 */
export interface AnalysisDisplayProps {
  /** 当前累积的分析 Markdown 文本（流式追加 FR-015） */
  analysis: string;
  /** 生成模式（FR-016：deep 时显示标签） */
  mode: 'normal' | 'deep';
  /** Stage 1 完成时 analysisEmpty 标志（true 表示分析区为空，需降级 UI） */
  analysisEmpty: boolean | null;
  /** 重新生成回调（降级 UI 中「重新生成」按钮触发） */
  onRegenerate: () => void;
}

/**
 * react-markdown 自定义元素渲染（使用语义化 CSS 变量）
 * react-markdown 默认转义文本，满足 NFR-017
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-5 text-2xl font-bold text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-xl font-semibold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-lg font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-3 text-base font-semibold text-foreground">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-3 leading-7 text-foreground">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-6 list-disc space-y-1 text-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-6 list-decimal space-y-1 text-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-primary bg-muted/50 py-2 pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    // 行内代码 vs 代码块：react-markdown 中代码块会带 language-xxx 类
    const isInline = !className?.includes('language-');
    if (isInline) {
      return (
        <code
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={cn('font-mono text-sm', className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border border-border bg-muted p-4 text-sm">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse border border-border text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-2 text-foreground">{children}</td>
  ),
  hr: () => <hr className="my-4 border-border" />,
};

/**
 * 解题分析展示组件
 */
export function AnalysisDisplay({
  analysis,
  mode,
  analysisEmpty,
  onRegenerate,
}: AnalysisDisplayProps): React.JSX.Element {
  /** 降级 UI：分析区为空（标记缺失或 LLM 未生成分析，§4.2.4） */
  if (analysisEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/30 py-12 text-center">
        <p className="text-sm text-destructive">分析生成异常，请重试</p>
        <Button type="button" variant="outline" size="sm" onClick={onRegenerate}>
          <RefreshCw className="h-4 w-4" />
          重新生成
        </Button>
      </div>
    );
  }

  /** 初始加载（未流式且未完成） */
  if (!analysis) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 py-12 text-muted-foreground">
        <Loader className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">正在生成分析...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 基于标准答案深度解读标签（FR-016） */}
      {mode === 'deep' && (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground',
          )}
        >
          <Sparkles className="h-3 w-3" />
          基于标准答案深度解读
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-6">
        <article className="text-sm">
          {/*
            react-markdown 默认转义，NFR-017：分析内容经 react-markdown 渲染（默认转义）
            remark-gfm 启用表格/列表/代码块/删除线等 GFM 扩展（FR-014）
          */}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MARKDOWN_COMPONENTS}
          >
            {analysis}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
