// app/lib/ai/schemas/__tests__/flowchart-schema.test.ts
// FlowchartSchema 单元测试（架构 §5.5.1，FR-017~023）
// 测试合法/非法数据校验

import { describe, it, expect } from 'vitest';
import { FlowchartSchema, FlowchartNodeType } from '@/app/lib/ai/schemas/flowchart-schema';

describe('FlowchartNodeType', () => {
  it('应接受 6 种合法节点类型', () => {
    const validTypes = ['start', 'process', 'decision', 'loop', 'data', 'end'];
    for (const t of validTypes) {
      expect(FlowchartNodeType.safeParse(t).success).toBe(true);
    }
  });

  it('应拒绝非法节点类型', () => {
    expect(FlowchartNodeType.safeParse('invalid').success).toBe(false);
    expect(FlowchartNodeType.safeParse('START').success).toBe(false);
    expect(FlowchartNodeType.safeParse('').success).toBe(false);
  });
});

describe('FlowchartSchema', () => {
  // 合法流程图样本（覆盖 6 种节点类型 + 回边）
  const validFlowchart = {
    nodes: [
      { id: 'n1', type: 'start', label: '开始', explanation: '程序入口' },
      { id: 'n2', type: 'data', label: '读取输入', codeRef: '5-6', requirementRef: 'R1', explanation: '读取两个整数' },
      { id: 'n3', type: 'process', label: '计算', codeRef: '7', explanation: '计算逻辑' },
      { id: 'n4', type: 'decision', label: '判断', explanation: '条件判断' },
      { id: 'n5', type: 'loop', label: '循环', explanation: '循环体' },
      { id: 'n6', type: 'end', label: '结束', explanation: '程序结束' },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3', explanation: '顺序执行' },
      { source: 'n3', target: 'n4', label: '是' },
      { source: 'n5', target: 'n3', isBackEdge: true },
    ],
  };

  it('应接受合法流程图', () => {
    const result = FlowchartSchema.safeParse(validFlowchart);
    expect(result.success).toBe(true);
  });

  it('应接受空 nodes 与 edges 数组', () => {
    const result = FlowchartSchema.safeParse({ nodes: [], edges: [] });
    expect(result.success).toBe(true);
  });

  it('应接受可选字段缺失（codeRef/requirementRef/label/explanation/isBackEdge）', () => {
    const minimal = {
      nodes: [{ id: 'n1', type: 'start', label: '开始', explanation: '入口' }],
      edges: [{ source: 'n1', target: 'n1' }],
    };
    const result = FlowchartSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('应拒绝缺失 nodes 字段', () => {
    const result = FlowchartSchema.safeParse({ edges: [] });
    expect(result.success).toBe(false);
  });

  it('应拒绝缺失 edges 字段', () => {
    const result = FlowchartSchema.safeParse({ nodes: [] });
    expect(result.success).toBe(false);
  });

  it('应拒绝节点缺失必填字段 id', () => {
    const invalid = {
      nodes: [{ type: 'start', label: '开始', explanation: '入口' }],
      edges: [],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝节点缺失必填字段 type', () => {
    const invalid = {
      nodes: [{ id: 'n1', label: '开始', explanation: '入口' }],
      edges: [],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝节点缺失必填字段 label', () => {
    const invalid = {
      nodes: [{ id: 'n1', type: 'start', explanation: '入口' }],
      edges: [],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝节点缺失必填字段 explanation', () => {
    const invalid = {
      nodes: [{ id: 'n1', type: 'start', label: '开始' }],
      edges: [],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝边缺失必填字段 source', () => {
    const invalid = {
      nodes: [],
      edges: [{ target: 'n1' }],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝边缺失必填字段 target', () => {
    const invalid = {
      nodes: [],
      edges: [{ source: 'n1' }],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝非法 type 值', () => {
    const invalid = {
      nodes: [{ id: 'n1', type: 'invalid_type', label: '开始', explanation: '入口' }],
      edges: [],
    };
    expect(FlowchartSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝非对象根类型（数组）', () => {
    expect(FlowchartSchema.safeParse([]).success).toBe(false);
  });

  it('应拒绝非对象根类型（字符串）', () => {
    expect(FlowchartSchema.safeParse('invalid').success).toBe(false);
  });

  it('应拒绝非对象根类型（null）', () => {
    expect(FlowchartSchema.safeParse(null).success).toBe(false);
  });

  it('应正确推断合法数据的类型字段', () => {
    const result = FlowchartSchema.safeParse(validFlowchart);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(6);
      expect(result.data.edges).toHaveLength(4);
      expect(result.data.nodes[0].type).toBe('start');
      expect(result.data.edges[3].isBackEdge).toBe(true);
    }
  });
});
