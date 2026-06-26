// app/solution/components/flowchart-display.tsx
// 流程图可视化容器（FR-017/023，架构 §6.4.2/6.4.3 状态机）
//
// 职责：
//   1. 状态机渲染（架构 §6.4.2/6.4.3）：
//      - error 非 null → 错误信息 + 重新生成按钮（FR-009）
//      - flowchart 为 null 且未 done → 加载状态（等待 Stage 1 / 生成中）
//      - flowchart 为 null 且 done → 空状态（部分失败兜底）
//      - flowchart 非 null → 渲染 ReactFlow 画布
//   2. useMemo 缓存 layoutFlowchart（NFR-003，§9.1 风险 #6），依赖 [flowchart]
//   3. ReactFlow 配置（FR-023）：
//      - nodeTypes/edgeTypes 模块级常量（避免每次渲染重新注册导致节点实例重建）
//      - nodesDraggable=false（只读查看）、nodesConnectable=false（禁止连线）
//      - elementsSelectable=true（允许选中）、fitView（自动适配视口）
//      - Controls + MiniMap + Background

'use client';

import * as React from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertCircle, Loader, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { logClientError } from '@/app/lib/logging/logger';
import type { Flowchart } from '@/app/lib/ai/schemas/flowchart-schema';
import { layoutFlowchart } from '@/app/solution/components/flowchart-layout';
import { FlowchartEdge } from '@/app/solution/components/flowchart-edge';
import { FlowchartNode } from '@/app/solution/components/flowchart-node';

/**
 * 流程图错误信息（遵循 ServiceResult 的 error 字段结构）
 */
export interface FlowchartError {
  code: string;
  message: string;
}

/**
 * FlowchartDisplay Props（整合阶段主对话调用契约，严格遵循）
 */
export interface FlowchartDisplayProps {
  /** flowchart 事件携带的完整 Flowchart JSON，null 表示尚未收到 */
  flowchart: Flowchart | null;
  /** flowchart-error 事件携带的错误信息，null 表示无错误 */
  error: FlowchartError | null;
  /** Stage 2 是否已开始 */
  isStage2Started: boolean;
  /** Stage 2 是否已完成（收到 done 事件） */
  isStage2Done: boolean;
  /** 重新生成回调（错误状态下重试按钮触发，FR-005/009） */
  onRegenerate: () => void;
}

/** 画布固定高度（NFR-015 移动端适配，桌面端 600px） */
const CANVAS_HEIGHT = 'h-[600px]';

/**
 * nodeTypes / edgeTypes 模块级常量
 * ReactFlow 要求 nodeTypes/edgeTypes 引用稳定，否则每次渲染会重新注册类型并重建节点/边实例。
 * 模块级常量保证引用永远不变（优于 useMemo，因组件实例无关）。
 */
const NODE_TYPES: NodeTypes = { 'flowchart-node': FlowchartNode };
const EDGE_TYPES: EdgeTypes = { 'flowchart-edge': FlowchartEdge };

/**
 * 流程图可视化容器
 *
 * 状态机（架构 §6.4.2/6.4.3）：
 * - error 非 null → 错误信息 + 重新生成按钮（FR-009 独立容错）
 * - flowchart 为 null 且未 done → 加载状态（等待 Stage 1 或生成中）
 * - flowchart 为 null 且 done → 空状态（部分失败兜底，§6.4.3）
 * - flowchart 非 null → 渲染 ReactFlow 画布（FR-017/023）
 */
export function FlowchartDisplay({
  flowchart,
  error,
  isStage2Started,
  isStage2Done,
  onRegenerate,
}: FlowchartDisplayProps): React.JSX.Element {
  /**
   * useMemo 缓存 dagre 布局结果（NFR-003，§9.1 风险 #6）
   * 仅在 flowchart 引用变化时重算（重新生成会得到新引用，自动重算）。
   * flowchart 为 null 时返回空数组，不触发 dagre 计算。
   */
  const layout = React.useMemo(
    () =>
      flowchart
        ? layoutFlowchart(flowchart)
        : { nodes: [], edges: [] },
    [flowchart],
  );

  /**
   * 重新生成按钮点击（FR-005/009）
   * 错误/空状态下由重试按钮触发，调用父组件 onRegenerate。
   * try-catch 防止父组件回调异常导致 UI 崩溃。
   */
  const handleRegenerate = (): void => {
    try {
      onRegenerate();
    } catch (err) {
      logClientError('流程图重新生成触发失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // === 状态机渲染 ===

  // 1. 错误状态（FR-009 独立容错）
  if (error) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{error.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
          >
            <RefreshCw className="h-4 w-4" />
            重新生成
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 2. 加载状态：flowchart 未到且未完成
  if (!flowchart && !isStage2Done) {
    const loadingText = isStage2Started
      ? '正在生成流程图...'
      : '等待 Stage 1 完成，流程图即将开始生成...';
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{loadingText}</p>
        </CardContent>
      </Card>
    );
  }

  // 3. 空状态：Stage 2 完成但未收到 flowchart 数据（部分失败兜底，§6.4.3）
  if (!flowchart) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">流程图数据为空</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
          >
            <RefreshCw className="h-4 w-4" />
            重新生成
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 4. 正常渲染：ReactFlow 画布（FR-017/023）
  return (
    <div
      className={`${CANVAS_HEIGHT} overflow-hidden rounded-md border border-border bg-background`}
    >
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        minZoom={0.2}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
