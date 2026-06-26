// app/solution/components/mindmap-display.tsx
// 思维导图可视化容器（FR-024/027/028，架构 §6.4.2/6.4.3 状态机）
//
// 职责：
//   1. 状态机渲染（架构 §6.4.2/6.4.3）：
//      - error 非 null → 错误信息 + 重新生成按钮（FR-009）
//      - mindmap 为 null 且未 done → 加载状态
//      - mindmap 为 null 且 done → 空状态
//      - mindmap 非 null → 渲染 ReactFlow 画布 + 详情面板
//   2. 折叠状态管理（FR-027）：collapsedIds Set，默认 depth >= 3 折叠（FR-025）
//   3. useMemo 缓存 layoutMindmap（NFR-003，§9.1 风险 #6 折叠后布局重算）
//   4. 详情面板联动（FR-028）：selectedNodeId + findMindmapNode 查找节点信息
//   5. ReactFlow 配置（FR-023 同等能力）：Controls + MiniMap + Background + fitView
//
// Props 契约严格遵循整合阶段主对话调用约定。

'use client';

import * as React from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertCircle, Loader, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { logClientError } from '@/app/lib/logging/logger';
import type { Mindmap } from '@/app/lib/ai/schemas/mindmap-schema';
import {
  collectDefaultCollapsedIds,
  findMindmapNode,
  layoutMindmap,
  type MindmapFlowNode,
} from '@/app/solution/components/mindmap-layout';
import {
  MindmapNode,
  MindmapNodeActionsContext,
  type MindmapNodeActions,
} from '@/app/solution/components/mindmap-node';
import {
  MindmapDetailPanel,
  type MindmapDetailNode,
} from '@/app/solution/components/mindmap-detail-panel';

/**
 * 思维导图错误信息（遵循 ServiceResult 的 error 字段结构）
 */
export interface MindmapError {
  code: string;
  message: string;
}

/**
 * MindmapDisplay Props（整合阶段主对话调用契约，严格遵循）
 */
export interface MindmapDisplayProps {
  /** mindmap 事件携带的完整 Mindmap JSON，null 表示尚未收到 */
  mindmap: Mindmap | null;
  /** mindmap-error 事件携带的错误信息，null 表示无错误 */
  error: MindmapError | null;
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
 * 思维导图可视化容器
 *
 * 状态机（架构 §6.4.2/6.4.3）：
 * - error 非 null → 错误信息 + 重新生成按钮（FR-009）
 * - mindmap 为 null 且未 done → 加载状态
 * - mindmap 为 null 且 done → 空状态
 * - mindmap 非 null → 渲染 ReactFlow 画布 + 详情面板
 */
export function MindmapDisplay({
  mindmap,
  error,
  isStage2Started,
  isStage2Done,
  onRegenerate,
}: MindmapDisplayProps): React.JSX.Element {
  // === 折叠状态（FR-027）===
  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(
    new Set(),
  );

  // === 选中节点（FR-028 详情面板联动）===
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(
    null,
  );

  /**
   * mindmap 变化时初始化默认折叠状态（FR-025 默认展开 3 层）
   * - mindmap 为 null：清空折叠与选中
   * - mindmap 非 null：收集 depth >= 3 且有子节点的节点 id 作为初始折叠集合
   *
   * 仅在 mindmap 引用变化时触发（重新生成会得到新 mindmap 引用，自动重置）。
   */
  React.useEffect(() => {
    if (!mindmap) {
      setCollapsedIds(new Set());
      setSelectedNodeId(null);
      return;
    }
    setCollapsedIds(collectDefaultCollapsedIds(mindmap.root));
    setSelectedNodeId(null);
  }, [mindmap]);

  /**
   * useMemo 缓存 dagre 布局结果（NFR-003，§9.1 风险 #6）
   * 仅在 mindmap 或 collapsedIds 变化时重算，选中态变化不触发重算。
   */
  const layout = React.useMemo(
    () => (mindmap ? layoutMindmap(mindmap, collapsedIds) : { nodes: [], edges: [] }),
    [mindmap, collapsedIds],
  );

  /**
   * 节点选中态后处理（FR-028）
   * 在 layout 结果上 map 设置 isSelected，避免 layoutMindmap 依赖 selectedNodeId。
   * 选中态变化只触发 map（轻量），不触发 dagre 重算。
   */
  const nodes = React.useMemo<MindmapFlowNode[]>(
    () =>
      layout.nodes.map((n) => ({
        ...n,
        data: { ...n.data, isSelected: n.id === selectedNodeId },
      })),
    [layout, selectedNodeId],
  );

  /**
   * 选中节点信息查找（FR-028）
   * 从 mindmap 树结构查找（非 layout.nodes），确保折叠父节点后选中节点信息仍可获取。
   */
  const selectedNode = React.useMemo<MindmapDetailNode | null>(() => {
    if (!selectedNodeId || !mindmap) {
      return null;
    }
    return findMindmapNode(mindmap.root, selectedNodeId);
  }, [selectedNodeId, mindmap]);

  /**
   * nodeTypes 稳定引用（避免 ReactFlow 每次渲染重新注册节点类型）
   */
  const nodeTypes = React.useMemo<NodeTypes>(
    () => ({ 'mindmap-node': MindmapNode }),
    [],
  );

  /**
   * 切换节点展开/折叠（FR-027）
   * 由节点组件的折叠按钮通过 Context 触发。
   */
  const handleToggleCollapse = React.useCallback((id: string): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * 节点点击触发选中（FR-028）
   * 点击节点主体时触发（折叠按钮已 stopPropagation，不会触发此回调）。
   */
  const handleNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: Node): void => {
      setSelectedNodeId(node.id);
    },
    [],
  );

  /**
   * Context value 稳定引用（避免 Provider 每次渲染触发节点组件重渲染）
   */
  const actionsValue = React.useMemo<MindmapNodeActions>(
    () => ({ toggleCollapse: handleToggleCollapse }),
    [handleToggleCollapse],
  );

  /**
   * 重新生成按钮点击（FR-005/009）
   * 错误状态下由重试按钮触发，调用父组件 onRegenerate。
   */
  const handleRegenerate = (): void => {
    try {
      onRegenerate();
    } catch (err) {
      logClientError('思维导图重新生成触发失败', {
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

  // 2. 加载状态：mindmap 未到且未完成
  if (!mindmap && !isStage2Done) {
    const loadingText = isStage2Started
      ? '正在生成思维导图...'
      : '等待 Stage 1 完成，思维导图即将开始生成...';
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{loadingText}</p>
        </CardContent>
      </Card>
    );
  }

  // 3. 空状态：Stage 2 完成但未收到 mindmap 数据（理论上的部分失败兜底）
  if (!mindmap) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            思维导图数据为空
          </p>
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

  // 4. 正常渲染：ReactFlow 画布 + 详情面板（FR-024/028）
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* 左侧 ReactFlow 画布（FR-024，架构 ADR-05 dagre LR 树形布局） */}
      <div
        className={`${CANVAS_HEIGHT} flex-1 overflow-hidden rounded-md border border-border bg-background`}
      >
        <MindmapNodeActionsContext.Provider value={actionsValue}>
          <ReactFlow
            nodes={nodes}
            edges={layout.edges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
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
        </MindmapNodeActionsContext.Provider>
      </div>

      {/* 右侧详情面板（FR-028） */}
      <div className={`${CANVAS_HEIGHT} w-full shrink-0 md:w-80`}>
        <MindmapDetailPanel node={selectedNode} />
      </div>
    </div>
  );
}
