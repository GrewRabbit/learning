// app/lib/ai/services/__tests__/mindmap-service.test.ts
// MindmapService 单元测试（架构 §5.4，FR-008，FR-024~029）
// 测试递归 schema 校验与重试逻辑

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';

// Mock 依赖
vi.mock('@/app/lib/ai/clients/llm-client', () => ({
  llmClient: {
    chat: vi.fn(),
  },
}));

vi.mock('@/app/lib/env', () => ({
  validateEnv: vi.fn(),
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { mindmapService } from '@/app/lib/ai/services/mindmap-service';
import { llmClient } from '@/app/lib/ai/clients/llm-client';

const mockedChat = llmClient.chat as MockedFunction<typeof llmClient.chat>;

const baseInput = { problem: '求两数之和', code: 'int main() { return 0; }' };

// 合法思维导图 JSON（多层递归）
const validMindmapJson = JSON.stringify({
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
        ],
      },
      { id: 'c2', label: '输出', explanation: '输出结果' },
    ],
  },
});

describe('MindmapService - 递归 schema 校验与重试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('首次尝试即成功（合法递归结构）', async () => {
    mockedChat.mockResolvedValue(validMindmapJson);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.root.id).toBe('root');
    expect(result.data?.root.children).toHaveLength(2);
    expect(result.data?.root.children?.[0].children?.[0].id).toBe('c1-1');
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('应提取 markdown 代码块包裹的 JSON', async () => {
    const wrappedJson = '```json\n' + validMindmapJson + '\n```';
    mockedChat.mockResolvedValue(wrappedJson);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.root.id).toBe('root');
  });

  it('应接受叶子节点（无 children）', async () => {
    const leafOnly = JSON.stringify({
      root: { id: 'root', label: '根', explanation: '根节点' },
    });
    mockedChat.mockResolvedValue(leafOnly);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.root.children).toBeUndefined();
  });

  it('应接受空 children 数组', async () => {
    const emptyChildren = JSON.stringify({
      root: {
        id: 'root',
        label: '根',
        explanation: '根节点',
        children: [],
      },
    });
    mockedChat.mockResolvedValue(emptyChildren);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.root.children).toEqual([]);
  });

  it('重试场景：首次非法 JSON，重试后成功', async () => {
    mockedChat
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(validMindmapJson);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });

  it('重试场景：首次递归校验失败，重试后成功', async () => {
    // 深层子节点缺失 explanation
    const invalidDeep = JSON.stringify({
      root: {
        id: 'root',
        label: '根',
        explanation: '根节点',
        children: [
          {
            id: 'c1',
            label: '子',
            explanation: '子节点',
            children: [{ id: 'c1-1', label: '缺 explanation' }],
          },
        ],
      },
    });
    mockedChat
      .mockResolvedValueOnce(invalidDeep)
      .mockResolvedValueOnce(validMindmapJson);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });

  it('3 次均返回非法 JSON 应返回校验失败', async () => {
    mockedChat.mockResolvedValue('not-json');

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_JSON_VALIDATION_FAILED');
    expect(mockedChat).toHaveBeenCalledTimes(3);
  });

  it('3 次递归校验失败应返回校验失败', async () => {
    const invalidJson = JSON.stringify({
      root: { id: 'root', label: '根' }, // 缺 explanation
    });
    mockedChat.mockResolvedValue(invalidJson);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_JSON_VALIDATION_FAILED');
    expect(mockedChat).toHaveBeenCalledTimes(3);
  });

  it('LLM 调用抛出异常应返回生成失败', async () => {
    mockedChat.mockRejectedValue(new Error('网络错误'));

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_MINDMAP_GENERATION_FAILED');
  });

  it('重试时应追加错误修正提示', async () => {
    mockedChat
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce(validMindmapJson);

    await mindmapService.generate(baseInput);

    // 第一次调用：2 条消息
    expect(mockedChat.mock.calls[0][0]).toHaveLength(2);
    // 第二次调用：3 条消息（含重试修正提示）
    expect(mockedChat.mock.calls[1][0]).toHaveLength(3);
    const retryMessages = mockedChat.mock.calls[1][0];
    expect(retryMessages[retryMessages.length - 1].role).toBe('user');
  });

  it('应正确处理深层递归结构（5 层）', async () => {
    const deepNested = JSON.stringify({
      root: {
        id: 'n0',
        label: '第0层',
        explanation: '根',
        children: [
          {
            id: 'n1',
            label: '第1层',
            explanation: '1',
            children: [
              {
                id: 'n2',
                label: '第2层',
                explanation: '2',
                children: [
                  {
                    id: 'n3',
                    label: '第3层',
                    explanation: '3',
                    children: [
                      { id: 'n4', label: '第4层', explanation: '4' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    mockedChat.mockResolvedValue(deepNested);

    const result = await mindmapService.generate(baseInput);

    expect(result.success).toBe(true);
    let node = result.data?.root;
    for (let i = 0; i < 4; i++) {
      expect(node?.children).toBeDefined();
      expect(node?.children).toHaveLength(1);
      node = node?.children?.[0];
    }
    expect(node?.id).toBe('n4');
  });
});
