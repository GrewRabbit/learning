// app/solution/components/mindmap-detail-panel.tsx
// 思维导图右侧详情面板（FR-028）
//
// 职责：
//   1. node 为 null → 显示空状态提示（"点击节点查看详情"）
//   2. node 非 null → 显示节点 label（标题）、depth（层级标识）、explanation（详细说明）
//   3. 右侧固定宽度，可滚动
//
// 由 mindmap-display.tsx 调用，传入当前选中节点信息（由 findMindmapNode 从树结构查找）。

'use client';

import * as React from 'react';
import { Info } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * 思维导图详情面板节点信息（FR-028）
 *
 * 与 mindmap-layout.ts 的 findMindmapNode 返回类型结构一致，
 * 由 display 组件查找后传入。
 */
export interface MindmapDetailNode {
  id: string;
  label: string;
  explanation: string;
  depth: number;
}

/**
 * MindmapDetailPanel Props（FR-028）
 */
export interface MindmapDetailPanelProps {
  /** 当前选中的节点，null 表示无选中（显示空状态提示） */
  node: MindmapDetailNode | null;
}

/**
 * 根据层级获取层级标签
 * - depth 0：根节点
 * - depth 1：主分支
 * - depth 2：子节点
 * - depth 3+：第 N 层
 */
function getDepthLabel(depth: number): string {
  if (depth === 0) {
    return '根节点';
  }
  if (depth === 1) {
    return '主分支';
  }
  if (depth === 2) {
    return '子节点';
  }
  return `第 ${depth + 1} 层`;
}

/**
 * 思维导图右侧详情面板（FR-028）
 *
 * - node 为 null → 空状态提示（"点击节点查看详情"）
 * - node 非 null → 显示 label（标题）、depth（层级标识）、explanation（详细说明）
 * - 固定宽度 w-80，可滚动（overflow-y-auto），高度与画布一致
 */
export function MindmapDetailPanel({
  node,
}: MindmapDetailPanelProps): React.JSX.Element {
  // 空状态：未选中节点（FR-028）
  if (!node) {
    return (
      <Card className="h-full border-dashed">
        <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <Info className="h-6 w-6" />
          <p className="text-sm">点击节点查看详情</p>
        </CardContent>
      </Card>
    );
  }

  // 选中节点：显示 label / depth / explanation（FR-028）
  return (
    <Card className="h-full overflow-y-auto">
      <CardHeader className="pb-3">
        <CardDescription className="text-xs">
          {getDepthLabel(node.depth)}
        </CardDescription>
        <CardTitle className="text-base leading-tight">
          {node.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm leading-relaxed text-muted-foreground">
          {node.explanation || '暂无详细说明'}
        </div>
      </CardContent>
    </Card>
  );
}
