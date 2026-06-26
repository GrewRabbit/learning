// app/solution/components/mindmap-node.tsx
// 思维导图自定义节点（FR-026/027/029，spec §7.10 层级视觉表）
//
// 职责：
//   1. 4 种 depth 层级视觉区分（字号 + 背景色 + 边框，spec §7.10）
//   2. 折叠 +N 徽章（FR-026，N = 直接子节点数）
//   3. 折叠按钮触发展开/折叠（FR-027，chevron 图标，避免歧义：节点主体点击触发选中）
//   4. 选中态高亮边框（FR-028，配合详情面板）
//
// 注册名 'mindmap-node'，由 mindmap-display.tsx 通过 nodeTypes 注册。
// 节点组件仅渲染视觉与触发 callback，折叠状态由 display 组件管理（通过 Context 传递 callback）。

'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import type { MindmapFlowNode } from '@/app/solution/components/mindmap-layout';

/**
 * 思维导图节点动作 Context
 *
 * 节点组件通过此 Context 获取 toggleCollapse 回调（由 display 组件提供）。
 * 不通过 node.data 传递函数，保持 data 可序列化。
 */
export interface MindmapNodeActions {
  /** 切换节点展开/折叠状态（FR-027） */
  toggleCollapse: (id: string) => void;
}

export const MindmapNodeActionsContext = React.createContext<MindmapNodeActions | null>(
  null,
);

/**
 * 根据层级获取节点视觉样式（spec §7.10 层级视觉表，FR-029）
 *
 * | depth | 样式 |
 * |-------|------|
 * | 0（根） | text-lg，bg-primary text-primary-foreground |
 * | 1 | text-base，bg-card，加粗边框 border-2 |
 * | 2 | text-sm，bg-muted，普通边框 |
 * | 3+ | 同 depth 2 |
 *
 * depth 0 节点背景为 bg-primary，折叠徽章需反色（bg-primary-foreground text-primary）才可见；
 * 其他 depth 徽章用任务指定样式 bg-primary text-primary-foreground。
 */
function getDepthStyles(depth: number): {
  container: string;
  text: string;
  badge: string;
} {
  if (depth === 0) {
    return {
      container: 'bg-primary text-primary-foreground border border-primary',
      text: 'text-lg',
      badge: 'bg-primary-foreground text-primary hover:bg-primary-foreground/90',
    };
  }
  if (depth === 1) {
    return {
      container: 'bg-card text-card-foreground border-2 border-border',
      text: 'text-base',
      badge: 'bg-primary text-primary-foreground hover:bg-primary/90',
    };
  }
  // depth 2 及 3+ 相同样式（spec §7.10）
  return {
    container: 'bg-muted text-foreground border border-border',
    text: 'text-sm',
    badge: 'bg-primary text-primary-foreground hover:bg-primary/90',
  };
}

/**
 * 思维导图自定义节点组件
 *
 * - 注册名 'mindmap-node'
 * - 层级视觉区分（4 种 depth，spec §7.10，FR-029）
 * - 折叠 +N 徽章（FR-026）：isCollapsed=true 且 childCount>0 时显示 "+N"
 * - 折叠按钮触发展开/折叠（FR-027）：chevron 图标，stopPropagation 避免触发节点选中
 * - 选中态高亮边框（FR-028）：ReactFlow 内置 selected 或 data.isSelected 任一为 true
 */
export function MindmapNode({
  id,
  data,
  selected,
}: NodeProps<MindmapFlowNode>): React.JSX.Element {
  const actions = React.useContext(MindmapNodeActionsContext);
  const { label, depth, childCount, isCollapsed, isSelected } = data;
  const depthStyles = getDepthStyles(depth);

  const hasChildren = childCount > 0;
  const isHighlighted = selected || isSelected;

  /**
   * 折叠按钮点击处理（FR-027）
   * stopPropagation 阻止冒泡到 ReactFlow onNodeClick（避免同时触发节点选中，避免歧义）
   */
  const handleToggleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    actions?.toggleCollapse(id);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 shadow-sm transition-colors',
        depthStyles.container,
        // 选中态高亮边框（FR-028）
        isHighlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <span className={cn('font-medium', depthStyles.text)}>{label}</span>
      {hasChildren && (
        <button
          type="button"
          onClick={handleToggleClick}
          className={cn(
            'nodrag flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold transition-colors',
            depthStyles.badge,
          )}
          aria-label={isCollapsed ? `展开 ${label}（含 ${childCount} 个子节点）` : `折叠 ${label}`}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <>
              <ChevronRight className="h-3 w-3" />
              <span>+{childCount}</span>
            </>
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}
