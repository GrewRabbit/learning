// app/solution/components/mindmap-layout.ts
// 思维导图 dagre LR 布局 + 折叠过滤（FR-024/025/027，架构 ADR-05，§9.1 风险 #6）
//
// 职责：
//   1. 递归遍历 MindmapNode 计算 depth（根节点 depth=0，逐层 +1，架构 §5.5.2）
//   2. 折叠过滤：collapsedIds 中的节点，其 children 不参与布局（FR-027）
//   3. dagre LR 树形布局（rankdir='LR'，从左到右，架构 ADR-05）
//   4. 节点尺寸根据 depth 递减（对应 spec §7.10 层级视觉）
//
// 纯函数，便于外层 useMemo 缓存（NFR-003，§9.1 风险 #6 折叠后布局重算）

import * as dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

import type { Mindmap, MindmapNode } from '@/app/lib/ai/schemas/mindmap-schema';

/**
 * 思维导图节点 data 类型（ReactFlow Node.data）
 * - label: 节点标签
 * - explanation: 节点说明（在本题中的应用方式）
 * - depth: 层级（根节点 depth=0，由前端遍历计算，架构 §5.5.2）
 * - childCount: 直接子节点数（折叠徽章 +N 用，FR-026）
 * - isCollapsed: 当前节点是否被折叠（FR-027）
 * - isSelected: 是否被选中（详情面板联动 FR-028，由 display 后处理设置）
 *
 * 索引签名 [key: string]: unknown 满足 @xyflow/react v12 的 Node<Data> 约束
 * （Data 必须满足 Record<string, unknown>）。
 */
export interface MindmapNodeData {
  label: string;
  explanation: string;
  depth: number;
  childCount: number;
  isCollapsed: boolean;
  isSelected: boolean;
  [key: string]: unknown;
}

/**
 * 思维导图 ReactFlow 节点类型
 * Node<Data, Type> 泛型：第一参数为 data 类型，第二参数为节点 type 字符串（@xyflow/react v12）
 */
export type MindmapFlowNode = Node<MindmapNodeData, 'mindmap-node'>;

/**
 * dagre 布局节点尺寸（根据 depth 递减，对应 spec §7.10 层级视觉）
 * - depth 0（根）：最大尺寸，对应 text-lg
 * - depth 1：中等尺寸，对应 text-base
 * - depth 2：标准尺寸，对应 text-sm
 * - depth 3+：同 depth 2
 */
function getNodeSize(depth: number): { width: number; height: number } {
  if (depth === 0) {
    return { width: 180, height: 64 };
  }
  if (depth === 1) {
    return { width: 160, height: 52 };
  }
  if (depth === 2) {
    return { width: 140, height: 44 };
  }
  return { width: 130, height: 40 };
}

/**
 * 递归遍历思维导图，构建 ReactFlow nodes 与 edges
 *
 * - depth 计算：根节点 depth=0，逐层 +1（架构 §5.5.2）
 * - 折叠过滤：collapsedIds 中的节点，其 children 不参与布局（FR-027）
 *   折叠节点本身仍渲染（显示 +N 徽章提示有子节点）
 *
 * @param node 当前遍历的节点
 * @param depth 当前层级
 * @param collapsedIds 折叠节点 id 集合
 * @param nodes 累积的 ReactFlow 节点数组（可变累积，避免递归创建新数组）
 * @param edges 累积的 ReactFlow 边数组
 * @param parentId 父节点 id（根节点无父，不建边）
 */
function traverseMindmap(
  node: MindmapNode,
  depth: number,
  collapsedIds: Set<string>,
  nodes: MindmapFlowNode[],
  edges: Edge[],
  parentId?: string,
): void {
  const childCount = node.children?.length ?? 0;
  const isCollapsed = collapsedIds.has(node.id);
  const { width, height } = getNodeSize(depth);

  nodes.push({
    id: node.id,
    type: 'mindmap-node',
    position: { x: 0, y: 0 }, // 占位，由 dagre 计算后覆写
    data: {
      label: node.label,
      explanation: node.explanation,
      depth,
      childCount,
      isCollapsed,
      isSelected: false, // 由 display 后处理设置（避免 layoutMindmap 依赖 selectedNodeId）
    },
    width,
    height,
  });

  if (parentId) {
    edges.push({
      id: `${parentId}-${node.id}`,
      source: parentId,
      target: node.id,
      type: 'default',
    });
  }

  // 折叠过滤：当前节点被折叠时不递归 children（FR-027）
  if (isCollapsed) {
    return;
  }

  if (node.children) {
    for (const child of node.children) {
      traverseMindmap(child, depth + 1, collapsedIds, nodes, edges, node.id);
    }
  }
}

/**
 * 思维导图 dagre LR 布局 + 折叠过滤（FR-024/025/027，架构 ADR-05）
 *
 * 纯函数，便于外层 useMemo 缓存（NFR-003，§9.1 风险 #6）。
 * 选中态（isSelected）由调用方后处理设置，本函数不依赖 selectedNodeId。
 *
 * @param mindmap 思维导图 JSON（符合 MindmapSchema）
 * @param collapsedIds 折叠节点 id 集合（集合中的节点其 children 不参与布局）
 * @returns ReactFlow nodes 与 edges（nodes 已含 dagre 计算的坐标）
 */
export function layoutMindmap(
  mindmap: Mindmap,
  collapsedIds: Set<string>,
): { nodes: MindmapFlowNode[]; edges: Edge[] } {
  const nodes: MindmapFlowNode[] = [];
  const edges: Edge[] = [];

  // 递归遍历构建节点与边（带 depth 计算与折叠过滤）
  traverseMindmap(mindmap.root, 0, collapsedIds, nodes, edges);

  // dagre LR 布局（架构 ADR-05，rankdir='LR' 从左到右树形布局）
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 40,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size = getNodeSize(node.data.depth);
    const width = node.width ?? size.width;
    const height = node.height ?? size.height;
    g.setNode(node.id, { width, height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // 将 dagre 计算的坐标写回节点
  // dagre 返回节点中心坐标，ReactFlow 需要左上角坐标，需减去半宽半高
  for (const node of nodes) {
    const layoutNode = g.node(node.id);
    if (layoutNode) {
      const size = getNodeSize(node.data.depth);
      const width = node.width ?? size.width;
      const height = node.height ?? size.height;
      node.position = {
        x: layoutNode.x - width / 2,
        y: layoutNode.y - height / 2,
      };
    }
  }

  return { nodes, edges };
}

/**
 * 收集思维导图中所有 depth >= 3 且有子节点的节点 id（FR-025 默认展开 3 层）
 *
 * 用于初始化 collapsedIds：depth 0/1/2 展开，depth >= 3 且有子节点的默认折叠。
 * "第 4 层起默认折叠"（spec FR-025）= depth 3 起的节点（有子节点时）折叠，
 * 折叠后其子节点（depth 4+）不可见，逐层展开探索。
 *
 * @param root 思维导图根节点
 * @returns 初始折叠节点 id 集合
 */
export function collectDefaultCollapsedIds(root: MindmapNode): Set<string> {
  const result = new Set<string>();

  const collect = (node: MindmapNode, depth: number): void => {
    if (depth >= 3 && node.children && node.children.length > 0) {
      result.add(node.id);
    }
    if (node.children) {
      for (const child of node.children) {
        collect(child, depth + 1);
      }
    }
  };

  collect(root, 0);
  return result;
}

/**
 * 在思维导图树中查找指定 id 的节点，返回其完整信息（含 depth）
 *
 * 用于详情面板联动（FR-028）：根据 selectedNodeId 查找节点的 label/explanation/depth。
 * 从树结构查找而非从 layout.nodes 查找，确保折叠父节点后选中节点信息仍可获取。
 *
 * @param root 思维导图根节点
 * @param targetId 目标节点 id
 * @returns 节点信息（含 depth），未找到返回 null
 */
export function findMindmapNode(
  root: MindmapNode,
  targetId: string,
): { id: string; label: string; explanation: string; depth: number } | null {
  const find = (
    node: MindmapNode,
    depth: number,
  ): { id: string; label: string; explanation: string; depth: number } | null => {
    if (node.id === targetId) {
      return {
        id: node.id,
        label: node.label,
        explanation: node.explanation,
        depth,
      };
    }
    if (node.children) {
      for (const child of node.children) {
        const found = find(child, depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };

  return find(root, 0);
}
