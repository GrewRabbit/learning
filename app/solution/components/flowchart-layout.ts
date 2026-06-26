// app/solution/components/flowchart-layout.ts
// dagre 自动布局工具（FR-017，架构 §5.5.1 / §9.1 风险 #11）
// 职责：
//   1. 将 Flowchart JSON 转换为 ReactFlow Node[]/Edge[]
//   2. 使用 @dagrejs/dagre 计算自上而下（rankdir='TB'）布局
//   3. 回边（isBackEdge=true）不参与 dagre 布局计算（避免循环引用死循环）
//      回边在 dagre 计算完成后手动添加到结果中
//   4. 纯函数，便于外层 useMemo 缓存（NFR-003，§9.1 风险 #6）

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

import type {
  Flowchart,
  FlowchartNode as FlowchartSchemaNode,
  FlowchartEdge as FlowchartSchemaEdge,
} from '@/app/lib/ai/schemas/flowchart-schema';

/**
 * 流程图节点类型（FR-018 spec §7.9，6 种）
 */
export type FlowchartNodeType =
  | 'start'
  | 'process'
  | 'decision'
  | 'loop'
  | 'data'
  | 'end';

/**
 * ReactFlow 节点 data 字段（携带 schema 中的节点信息）
 *
 * 注意：字段名用 nodeType 而非 type，避免与 ReactFlow Node 的 type 字段冲突
 * （ReactFlow Node 的 type 用于匹配 nodeTypes 注册名，此处固定为 'flowchart-node'）
 */
export interface FlowchartNodeData extends Record<string, unknown> {
  /** 节点类型（用于节点组件内视觉区分，对应 schema 的 node.type） */
  nodeType: FlowchartNodeType;
  /** 节点显示文本 */
  label: string;
  /** 行号范围字符串（如 "10-15"），无对应代码时省略（FR-020） */
  codeRef?: string;
  /** 题目要求编号（如 "R1"），无对应要求时省略（FR-019） */
  requirementRef?: string;
  /** 节点说明（FR-020 hover tooltip 必显示项） */
  explanation: string;
}

/**
 * ReactFlow 边 data 字段（携带 schema 中的边信息）
 */
export interface FlowchartEdgeData extends Record<string, unknown> {
  /** decision 出边标签（如 "是"/"否"）（FR-021） */
  label?: string;
  /** 边路径说明（FR-022 hover tooltip） */
  explanation?: string;
  /** 回边标记（FR-021 loop 回边虚线） */
  isBackEdge?: boolean;
}

/**
 * ReactFlow 自定义节点类型（注册名 'flowchart-node'）
 */
export type FlowchartRFNode = Node<FlowchartNodeData, 'flowchart-node'>;

/**
 * ReactFlow 自定义边类型（注册名 'flowchart-edge'）
 */
export type FlowchartRFEdge = Edge<FlowchartEdgeData, 'flowchart-edge'>;

/**
 * 节点尺寸配置（FR-017，dagre 布局所需）
 * - 默认 180x60
 * - decision（菱形）：增大到 200x100，因 rotate-45 后视觉 bounding box 增大
 * - data（平行四边形）：宽度增大到 200，因 skew 后视觉宽度增大
 */
const NODE_SIZE: Record<FlowchartNodeType, { width: number; height: number }> = {
  start: { width: 180, height: 60 },
  process: { width: 180, height: 60 },
  decision: { width: 200, height: 100 },
  loop: { width: 180, height: 60 },
  data: { width: 200, height: 60 },
  end: { width: 180, height: 60 },
};

/**
 * dagre 布局配置（rankdir='TB' 自上而下，spec §7.9）
 */
const DAGRE_CONFIG = {
  // 自上而下布局
  rankdir: 'TB',
  // 同层节点间距
  nodesep: 40,
  // 层间距
  ranksep: 60,
  // 边距
  marginx: 20,
  marginy: 20,
};

/**
 * 将 schema 节点转为 ReactFlow 节点 data
 * 显式构造对象，仅复制有定义的字段（避免 undefined 出现在 data 中）
 */
function toNodeData(node: FlowchartSchemaNode): FlowchartNodeData {
  const data: FlowchartNodeData = {
    nodeType: node.type,
    label: node.label,
    explanation: node.explanation,
  };
  if (node.codeRef !== undefined) {
    data.codeRef = node.codeRef;
  }
  if (node.requirementRef !== undefined) {
    data.requirementRef = node.requirementRef;
  }
  return data;
}

/**
 * 将 schema 边转为 ReactFlow 边 data
 */
function toEdgeData(edge: FlowchartSchemaEdge): FlowchartEdgeData {
  const data: FlowchartEdgeData = {
    isBackEdge: edge.isBackEdge === true,
  };
  if (edge.label !== undefined) {
    data.label = edge.label;
  }
  if (edge.explanation !== undefined) {
    data.explanation = edge.explanation;
  }
  return data;
}

/**
 * 计算 dagre 布局并返回 ReactFlow 节点与边（FR-017）
 *
 * 关键约束（FR-021，§9.1 风险 #11）：
 * isBackEdge=true 的回边不参与 dagre 布局计算（避免循环引用导致 dagre 死循环）。
 * 实现方式：非回边传入 dagre.graphlib 设置边；回边在 dagre 计算完成后手动添加到结果中
 * （回边 source/target 节点已通过 setNode 加入 dagre，其坐标已由 dagre 计算）。
 *
 * 性能（NFR-003，§9.1 风险 #6）：纯函数，外层用 useMemo 缓存，依赖 flowchart 引用。
 *
 * @param flowchart 符合 FlowchartSchema 的 JSON 数据
 * @returns ReactFlow 节点与边数组
 */
export function layoutFlowchart(flowchart: Flowchart): {
  nodes: FlowchartRFNode[];
  edges: FlowchartRFEdge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setGraph(DAGRE_CONFIG);
  g.setDefaultEdgeLabel(() => ({}));

  // 1. 全部节点加入 dagre（含尺寸）
  for (const node of flowchart.nodes) {
    const size = NODE_SIZE[node.type] ?? NODE_SIZE.process;
    g.setNode(node.id, size);
  }

  // 2. 仅非回边加入 dagre（回边跳过，避免循环引用导致 dagre 死循环）
  for (const edge of flowchart.edges) {
    if (edge.isBackEdge === true) {
      continue;
    }
    g.setEdge(edge.source, edge.target);
  }

  // 3. 计算 dagre 布局
  dagre.layout(g);

  // 4. 构造 ReactFlow 节点
  //    dagre 返回节点中心点 (x, y)，ReactFlow position 是左上角，需减去 width/2 与 height/2
  const nodes: FlowchartRFNode[] = flowchart.nodes.map((node) => {
    const size = NODE_SIZE[node.type] ?? NODE_SIZE.process;
    const dagreNode = g.node(node.id);
    const x = (dagreNode?.x ?? 0) - size.width / 2;
    const y = (dagreNode?.y ?? 0) - size.height / 2;
    return {
      id: node.id,
      type: 'flowchart-node',
      position: { x, y },
      data: toNodeData(node),
    };
  });

  // 5. 构造 ReactFlow 边（含回边，回边添加虚线样式 FR-021）
  const edges: FlowchartRFEdge[] = flowchart.edges.map((edge, idx) => {
    const isBackEdge = edge.isBackEdge === true;
    const rfEdge: FlowchartRFEdge = {
      id: `edge-${edge.source}-${edge.target}-${idx}`,
      source: edge.source,
      target: edge.target,
      type: 'flowchart-edge',
      data: toEdgeData(edge),
    };
    if (isBackEdge) {
      // 回边虚线样式（FR-021），animated: false（回边不动画）
      rfEdge.animated = false;
      rfEdge.style = { strokeDasharray: '5 3' };
    }
    return rfEdge;
  });

  return { nodes, edges };
}
