// app/solution/components/flowchart-node.tsx
// 流程图自定义节点（FR-018/019/020，spec §7.9 节点类型表）
// 职责：
//   1. 6 种节点类型视觉区分（图标 + 形状 + 语义色，FR-018）
//   2. requirementRef 徽章（右上角，FR-019）
//   3. hover tooltip（explanation + codeRef + requirementRef，FR-020）
//   4. tooltip 实现：React state + onMouseEnter/onMouseLeave + absolute 定位 div
//      （z-index 高 + pointer-events-none，§9.1 风险 #10 防遮挡）

'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CircleStop,
  Database,
  GitBranch,
  Play,
  Repeat,
  Square,
} from 'lucide-react';
import type { NodeProps } from '@xyflow/react';

import type {
  FlowchartNodeType,
  FlowchartRFNode,
} from '@/app/solution/components/flowchart-layout';
import { cn } from '@/lib/utils';

/**
 * 节点类型视觉配置（spec §7.9 节点类型表）
 * - Icon: lucide 图标
 * - bodyClass: 背景色 + 文字色 + 边框（不含圆角，圆角在 shapeClass）
 * - shapeClass: 圆角等形状类（仅 rect 形状使用）
 */
interface NodeVisualConfig {
  Icon: LucideIcon;
  bodyClass: string;
  shapeClass: string;
}

const NODE_CONFIG: Record<FlowchartNodeType, NodeVisualConfig> = {
  start: {
    Icon: Play,
    bodyClass: 'bg-success text-success-foreground',
    shapeClass: 'rounded-md',
  },
  process: {
    Icon: Square,
    bodyClass: 'bg-primary text-primary-foreground',
    shapeClass: 'rounded-sm',
  },
  decision: {
    Icon: GitBranch,
    bodyClass: 'bg-warning text-warning-foreground',
    shapeClass: '',
  },
  loop: {
    Icon: Repeat,
    bodyClass:
      'bg-info text-info-foreground border-2 border-dashed border-info-foreground',
    shapeClass: 'rounded-sm',
  },
  data: {
    Icon: Database,
    bodyClass: 'bg-muted text-muted-foreground',
    shapeClass: '',
  },
  end: {
    Icon: CircleStop,
    bodyClass: 'bg-destructive text-destructive-foreground',
    shapeClass: 'rounded-full',
  },
};

/**
 * 节点主体内容（图标 + label）
 * 提取为独立变量以便在菱形/平行四边形的反向 transform 层中复用
 */
function NodeContent({
  Icon,
  label,
}: {
  Icon: LucideIcon;
  label: string;
}): React.JSX.Element {
  return (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="px-1 text-center text-sm font-medium">{label}</span>
    </>
  );
}

/**
 * 流程图自定义节点（注册名 'flowchart-node'，FR-018/019/020）
 *
 * 6 种节点类型视觉区分（spec §7.9）：
 * - start: Play 图标，圆角矩形，bg-success
 * - process: Square 图标，矩形，bg-primary
 * - decision: GitBranch 图标，菱形（rotate-45 + 内层 -rotate-45），bg-warning
 * - loop: Repeat 图标，矩形（虚线边 border-dashed），bg-info
 * - data: Database 图标，平行四边形（skew-x-6 + 内层 -skew-x-6），bg-muted
 * - end: CircleStop 图标，圆角矩形（rounded-full），bg-destructive
 */
export function FlowchartNode({
  data,
  selected,
}: NodeProps<FlowchartRFNode>): React.JSX.Element {
  const [isHovered, setIsHovered] = React.useState(false);
  const config = NODE_CONFIG[data.nodeType];
  const { Icon } = config;

  /**
   * 根据节点类型渲染不同形状的主体
   * - decision: 菱形（外层 rotate-45 + 内层 -rotate-45 保持文字正向）
   * - data: 平行四边形（外层 skew-x-6 + 内层 -skew-x-6 保持文字正向）
   * - 其他: 矩形/圆角矩形（shapeClass 控制圆角）
   */
  const renderBody = (): React.JSX.Element => {
    if (data.nodeType === 'decision') {
      // 菱形：固定尺寸正方形旋转 45deg，内层反向旋转保持文字正向
      return (
        <div
          className={cn(
            'flex rotate-45 items-center justify-center',
            config.bodyClass,
          )}
          style={{ width: 100, height: 100 }}
        >
          <div className="-rotate-45 flex flex-col items-center gap-1 text-center">
            <NodeContent Icon={Icon} label={data.label} />
          </div>
        </div>
      );
    }

    if (data.nodeType === 'data') {
      // 平行四边形：外层 skew-x-6 倾斜，内层 -skew-x-6 反向保持文字正向
      return (
        <div
          className={cn(
            'flex skew-x-6 items-center justify-center py-2',
            config.bodyClass,
          )}
        >
          <div className="-skew-x-6 flex items-center gap-1 px-3 text-center">
            <NodeContent Icon={Icon} label={data.label} />
          </div>
        </div>
      );
    }

    // 矩形/圆角矩形（start/process/loop/end）
    return (
      <div
        className={cn(
          'flex min-w-[120px] items-center justify-center gap-1 px-4 py-2',
          config.bodyClass,
          config.shapeClass,
        )}
      >
        <NodeContent Icon={Icon} label={data.label} />
      </div>
    );
  };

  return (
    <div
      className={cn('relative', selected && 'ring-2 ring-ring ring-offset-2')}
      onMouseEnter={(): void => setIsHovered(true)}
      onMouseLeave={(): void => setIsHovered(false)}
    >
      {renderBody()}

      {/* requirementRef 徽章（FR-019，节点右上角） */}
      {data.requirementRef ? (
        <span className="absolute -right-2 -top-2 z-10 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
          {data.requirementRef}
        </span>
      ) : null}

      {/* hover tooltip（FR-020，§9.1 风险 #10） */}
      {isHovered ? (
        <div
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
          role="tooltip"
        >
          <p className="text-xs leading-relaxed">{data.explanation}</p>
          {data.codeRef ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              代码行：{data.codeRef}
            </p>
          ) : null}
          {data.requirementRef ? (
            <p className="mt-1 text-xs text-muted-foreground">
              对应要求：{data.requirementRef}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
