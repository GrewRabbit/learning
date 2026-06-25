// app/lib/ai/schemas/mindmap-schema.ts
// MindmapSchema Zod 定义（架构 §5.5.2，FR-024~029，递归类型）
// 先声明 type 再 z.ZodType 标注再 z.lazy 递归

import { z } from 'zod';

/**
 * 思维导图节点类型（递归）
 * - id: 节点唯一标识
 * - label: 节点标签
 * - explanation: 节点说明（在本题中的应用方式）
 * - children: 子节点（递归）
 *
 * 注意：Schema 不含 depth 字段，层级 depth 由前端遍历树结构计算（FR-025）
 */
export type MindmapNode = {
  id: string;
  label: string;
  explanation: string;
  children?: MindmapNode[];
};

/**
 * 思维导图节点 Schema（递归）
 * 先声明 MindmapNode 类型，再用 z.ZodType<MindmapNode> 标注，
 * 最后在 children 中通过 z.lazy(() => z.array(MindmapNodeSchema)) 实现递归引用
 */
export const MindmapNodeSchema: z.ZodType<MindmapNode> = z.object({
  id: z.string(),
  label: z.string(),
  explanation: z.string(),
  children: z.lazy(() => z.array(MindmapNodeSchema)).optional(),
});

/**
 * 思维导图 Schema（架构 §5.5.2）
 */
export const MindmapSchema = z.object({
  root: MindmapNodeSchema,
});

export type Mindmap = z.infer<typeof MindmapSchema>;
