// app/lib/ai/schemas/__tests__/mindmap-schema.test.ts
// MindmapSchema 单元测试（架构 §5.5.2，FR-024~029，递归类型）
// 测试递归 schema 校验合法/非法数据

import { describe, it, expect } from 'vitest';
import { MindmapSchema } from '@/app/lib/ai/schemas/mindmap-schema';

describe('MindmapSchema', () => {
  // 合法思维导图样本（多层递归）
  const validMindmap = {
    root: {
      id: 'root',
      label: '解题思路',
      explanation: '根节点',
      children: [
        {
          id: 'c1',
          label: '输入处理',
          explanation: '读取输入',
          children: [
            { id: 'c1-1', label: '变量声明', explanation: '声明变量' },
            { id: 'c1-2', label: '读取数据', explanation: 'cin 读取' },
          ],
        },
        {
          id: 'c2',
          label: '核心算法',
          explanation: '主逻辑',
          children: [
            {
              id: 'c2-1',
              label: '循环',
              explanation: 'for 循环',
              children: [{ id: 'c2-1-1', label: '累加', explanation: 'sum += x' }],
            },
          ],
        },
        { id: 'c3', label: '输出', explanation: '输出结果' },
      ],
    },
  };

  it('应接受合法思维导图（多层递归）', () => {
    const result = MindmapSchema.safeParse(validMindmap);
    expect(result.success).toBe(true);
  });

  it('应接受无 children 的叶子节点', () => {
    const minimal = {
      root: { id: 'root', label: '根', explanation: '根节点' },
    };
    const result = MindmapSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('应接受 children 为空数组', () => {
    const data = {
      root: { id: 'root', label: '根', explanation: '根节点', children: [] },
    };
    const result = MindmapSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('应正确解析深层递归结构', () => {
    const result = MindmapSchema.safeParse(validMindmap);
    if (result.success) {
      expect(result.data.root.id).toBe('root');
      expect(result.data.root.children).toHaveLength(3);
      expect(result.data.root.children?.[0].children).toHaveLength(2);
      expect(result.data.root.children?.[1].children?.[0].children?.[0].id).toBe('c2-1-1');
    }
  });

  it('应拒绝缺失 root 字段', () => {
    const result = MindmapSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('应拒绝根节点缺失必填字段 id', () => {
    const invalid = {
      root: { label: '根', explanation: '根节点' },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝根节点缺失必填字段 label', () => {
    const invalid = {
      root: { id: 'root', explanation: '根节点' },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝根节点缺失必填字段 explanation', () => {
    const invalid = {
      root: { id: 'root', label: '根' },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝子节点缺失必填字段', () => {
    const invalid = {
      root: {
        id: 'root',
        label: '根',
        explanation: '根节点',
        children: [{ id: 'c1', label: '子节点' }], // 缺 explanation
      },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝深层子节点缺失必填字段（递归校验）', () => {
    const invalid = {
      root: {
        id: 'root',
        label: '根',
        explanation: '根节点',
        children: [
          {
            id: 'c1',
            label: '子',
            explanation: '子节点',
            children: [{ id: 'c1-1', explanation: '缺 label' }],
          },
        ],
      },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝 children 非数组类型', () => {
    const invalid = {
      root: {
        id: 'root',
        label: '根',
        explanation: '根节点',
        children: 'not-an-array',
      },
    };
    expect(MindmapSchema.safeParse(invalid).success).toBe(false);
  });

  it('应拒绝非对象根类型', () => {
    expect(MindmapSchema.safeParse('invalid').success).toBe(false);
    expect(MindmapSchema.safeParse(null).success).toBe(false);
    expect(MindmapSchema.safeParse([]).success).toBe(false);
  });

  it('应接受非常深的递归结构（无栈溢出）', () => {
    // 构造 10 层深的链式结构
    let node: { id: string; label: string; explanation: string; children?: unknown[] } = {
      id: 'leaf',
      label: '叶子',
      explanation: '最深层',
    };
    for (let i = 9; i >= 0; i--) {
      node = {
        id: `n${i}`,
        label: `节点${i}`,
        explanation: `第${i}层`,
        children: [node],
      };
    }
    const result = MindmapSchema.safeParse({ root: node });
    expect(result.success).toBe(true);
  });
});
