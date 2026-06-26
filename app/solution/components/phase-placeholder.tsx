// app/solution/components/phase-placeholder.tsx
// 流程图/思维导图 Tab 的 Phase 3 占位组件
// Phase 2 范围：不渲染 ReactFlow，仅显示占位
// 事件解析逻辑已在 solution-tabs.tsx 的 handleEvent 中预留（flowchart/mindmap）
// Phase 3 将替换为本目录下的 flowchart-display.tsx / mindmap-display.tsx

'use client';

import * as React from 'react';
import { AlertCircle, GitBranch, Loader } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * 错误信息（遵循 ServiceResult 的 error 字段结构）
 */
export interface PhaseError {
  code: string;
  message: string;
}

/**
 * PhasePlaceholder Props
 */
export interface PhasePlaceholderProps {
  /** Tab 名称（流程图 / 思维导图） */
  title: string;
  /** Stage 2 错误信息（来自 flowchart-error / mindmap-error 事件，FR-009） */
  error: PhaseError | null;
  /** Stage 2 是否已开始 */
  isStage2Started: boolean;
  /** Stage 2 是否已完成（收到 done 事件） */
  isStage2Done: boolean;
  /** 重新生成回调（错误状态下的重试按钮） */
  onRegenerate: () => void;
}

/**
 * Phase 3 占位组件
 * - 等待 Stage 1 完成：显示「等待 Stage 1 完成...」
 * - Stage 2 进行中：显示「正在生成...」
 * - Stage 2 出错：显示错误信息 + 重试按钮（FR-009 独立容错）
 * - Stage 2 完成：显示「Phase 3 实现」占位
 */
export function PhasePlaceholder({
  title,
  error,
  isStage2Started,
  isStage2Done,
  onRegenerate,
}: PhasePlaceholderProps): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        {error ? (
          <>
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRegenerate}
            >
              重新生成
            </Button>
          </>
        ) : !isStage2Started && !isStage2Done ? (
          <>
            <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              等待 Stage 1 完成，{title}即将开始生成...
            </p>
          </>
        ) : isStage2Started && !isStage2Done ? (
          <>
            <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              正在生成{title}...
            </p>
          </>
        ) : (
          <>
            <GitBranch className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {title}可视化将在 Phase 3 实现
            </p>
            <p className="text-xs text-muted-foreground">
              当前已收到{title}数据，渲染逻辑待接入
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
