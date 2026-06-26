// app/solution/components/flowchart-edge.tsx
// 流程图自定义边（FR-021/022，spec §7.9）
// 职责：
//   1. 回边虚线渲染（FR-021）：data.isBackEdge=true 时 strokeDasharray='5 3'
//      样式由 flowchart-layout.ts 设置到 edge.style，本组件透传给 BaseEdge
//   2. decision 出边标签（FR-021）：data.label 在边中点渲染为圆角徽章
//   3. hover 边 tooltip（FR-022，§9.1 风险 #10）：边 hover 显示 explanation
//   4. tooltip 实现：React state + onMouseEnter/onMouseLeave + absolute 定位
//      （z-50 + pointer-events-none，防遮挡；nodrag nopan 防画布拖拽冲突）

'use client';

import * as React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

import type { FlowchartRFEdge } from '@/app/solution/components/flowchart-layout';

/**
 * 流程图自定义边（注册名 'flowchart-edge'，FR-021/022）
 *
 * 实现说明：
 * - BaseEdge 接收 getBezierPath 计算的 path 字符串与 style（含回边 strokeDasharray）
 * - EdgeLabelRenderer 提供 HTML 覆盖层（SVG 之上的 div），用于渲染标签与 tooltip
 * - 边中点坐标 (labelX, labelY) 由 getBezierPath 返回
 * - 标签 hover 目标：有 label 用 label 自身；无 label 但有 explanation 用 24x24 隐形热区
 * - tooltip 锚点为边中点正上方 12px，bottom-center 对齐（translate(-50%, -100%)）
 */
export function FlowchartEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps<FlowchartRFEdge>): React.JSX.Element {
  const [isHovered, setIsHovered] = React.useState(false);

  // 计算贝塞尔路径与边中点（用于标签与 tooltip 定位）
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = data?.label;
  const explanation = data?.explanation;
  const hasLabel = typeof label === 'string' && label.length > 0;
  const hasExplanation =
    typeof explanation === 'string' && explanation.length > 0;
  // 仅当存在 label 或 explanation 时渲染 hover 目标（避免无意义热区遮挡画布）
  const showHoverTarget = hasLabel || hasExplanation;

  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />

      {showHoverTarget ? (
        <EdgeLabelRenderer>
          {/* hover 目标 + decision 出边标签（FR-021） */}
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={(): void => setIsHovered(true)}
            onMouseLeave={(): void => setIsHovered(false)}
          >
            {hasLabel ? (
              <span className="inline-block rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-card-foreground shadow-sm">
                {label}
              </span>
            ) : (
              // 无标签边：24x24 隐形热区作为 hover 目标（FR-022 边 hover）
              <span className="inline-block h-6 w-6" aria-hidden />
            )}
          </div>

          {/* hover tooltip（FR-022，§9.1 风险 #10） */}
          {isHovered && hasExplanation ? (
            <div
              className="nodrag nopan pointer-events-none absolute z-50 w-56 rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
              style={{
                // bottom-center 对齐到边中点上方 12px（tooltip 向上展开）
                transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 12}px)`,
              }}
              role="tooltip"
            >
              <p className="text-xs leading-relaxed">{explanation}</p>
            </div>
          ) : null}
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
