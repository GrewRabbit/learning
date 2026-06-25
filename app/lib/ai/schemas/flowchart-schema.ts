// app/lib/ai/schemas/flowchart-schema.ts
// FlowchartSchema Zod 定义（架构 §5.5.1，FR-017~023）
// 含 6 种节点类型、回边 isBackEdge 字段

import { z } from 'zod';

/**
 * 流程图节点类型（FR-018）
 * - start: 起始节点
 * - process: 处理节点
 * - decision: 判断节点
 * - loop: 循环节点
 * - data: 数据节点
 * - end: 结束节点
 */
export const FlowchartNodeType = z.enum([
  'start',
  'process',
  'decision',
  'loop',
  'data',
  'end',
]);

/**
 * 流程图节点 Schema
 * - codeRef: 行号范围字符串（如 "10-15"），无对应代码时省略（FR-020）
 * - requirementRef: 题目要求编号（如 "R1"），无对应要求时省略（FR-019）
 * - explanation: 节点说明（FR-020 hover tooltip）
 */
export const FlowchartNodeSchema = z.object({
  id: z.string(),
  type: FlowchartNodeType,
  label: z.string(),
  codeRef: z.string().optional(),
  requirementRef: z.string().optional(),
  explanation: z.string(),
});

/**
 * 流程图边 Schema
 * - label: decision 出边标签（如 "是"/"否"）（FR-021）
 * - explanation: 边路径说明（FR-022 hover tooltip）
 * - isBackEdge: 回边标记（FR-021 loop 回边虚线）
 */
export const FlowchartEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  explanation: z.string().optional(),
  isBackEdge: z.boolean().optional(),
});

/**
 * 流程图 Schema（架构 §5.5.1）
 */
export const FlowchartSchema = z.object({
  nodes: z.array(FlowchartNodeSchema),
  edges: z.array(FlowchartEdgeSchema),
});

export type FlowchartNode = z.infer<typeof FlowchartNodeSchema>;
export type FlowchartEdge = z.infer<typeof FlowchartEdgeSchema>;
export type Flowchart = z.infer<typeof FlowchartSchema>;
