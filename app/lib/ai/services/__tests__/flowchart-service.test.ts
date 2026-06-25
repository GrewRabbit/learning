// app/lib/ai/services/__tests__/flowchart-service.test.ts
// FlowchartService 单元测试（架构 §5.4，FR-008，NFR-005）
// 测试 Zod 校验与重试逻辑：mock LLM 返回非法 JSON → 重试 → 成功

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

import { flowchartService } from '@/app/lib/ai/services/flowchart-service';
import { llmClient } from '@/app/lib/ai/clients/llm-client';

const mockedChat = llmClient.chat as MockedFunction<typeof llmClient.chat>;

const baseInput = { problem: '求两数之和', code: 'int main() { return 0; }' };

// 合法流程图 JSON
const validFlowchartJson = JSON.stringify({
  nodes: [
    { id: 'n1', type: 'start', label: '开始', explanation: '入口' },
    { id: 'n2', type: 'process', label: '计算', explanation: '计算逻辑' },
    { id: 'n3', type: 'end', label: '结束', explanation: '出口' },
  ],
  edges: [
    { source: 'n1', target: 'n2' },
    { source: 'n2', target: 'n3' },
  ],
});

describe('FlowchartService - Zod 校验与重试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('首次尝试即成功（合法 JSON）', async () => {
    mockedChat.mockResolvedValue(validFlowchartJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
    expect(result.data?.edges).toHaveLength(2);
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('应提取 markdown 代码块包裹的 JSON', async () => {
    const wrappedJson = '```json\n' + validFlowchartJson + '\n```';
    mockedChat.mockResolvedValue(wrappedJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
  });

  it('应提取无语言标记的 markdown 代码块', async () => {
    const wrappedJson = '```\n' + validFlowchartJson + '\n```';
    mockedChat.mockResolvedValue(wrappedJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
  });

  it('重试场景：首次非法 JSON，重试后成功', async () => {
    mockedChat
      .mockResolvedValueOnce('这不是合法 JSON')
      .mockResolvedValueOnce(validFlowchartJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });

  it('重试场景：首次 Zod 校验失败，重试后成功', async () => {
    // 缺失必填字段 explanation
    const invalidJson = JSON.stringify({
      nodes: [{ id: 'n1', type: 'start', label: '开始' }],
      edges: [],
    });
    mockedChat
      .mockResolvedValueOnce(invalidJson)
      .mockResolvedValueOnce(validFlowchartJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });

  it('3 次均返回非法 JSON 应返回校验失败', async () => {
    mockedChat.mockResolvedValue('not-json');

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_JSON_VALIDATION_FAILED');
    expect(mockedChat).toHaveBeenCalledTimes(3);
  });

  it('3 次 Zod 校验失败应返回校验失败', async () => {
    const invalidJson = JSON.stringify({
      nodes: [{ id: 'n1', type: 'invalid_type', label: 'x', explanation: 'y' }],
      edges: [],
    });
    mockedChat.mockResolvedValue(invalidJson);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_JSON_VALIDATION_FAILED');
    expect(mockedChat).toHaveBeenCalledTimes(3);
  });

  it('LLM 调用抛出异常应返回生成失败', async () => {
    mockedChat.mockRejectedValue(new Error('网络错误'));

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_FLOWCHART_GENERATION_FAILED');
  });

  it('重试时应追加错误修正提示', async () => {
    mockedChat
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce(validFlowchartJson);

    await flowchartService.generate(baseInput);

    // 第一次调用：2 条消息（system + user）
    expect(mockedChat.mock.calls[0][0]).toHaveLength(2);
    // 第二次调用：3 条消息（system + user + 重试修正提示）
    expect(mockedChat.mock.calls[1][0]).toHaveLength(3);
    // 重试消息应为 user 角色
    const retryMessages = mockedChat.mock.calls[1][0];
    expect(retryMessages[retryMessages.length - 1].role).toBe('user');
  });

  it('应接受包含回边 isBackEdge 的合法数据', async () => {
    const withBackEdge = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'start', label: '开始', explanation: '入口' },
        { id: 'n2', type: 'loop', label: '循环', explanation: '循环体' },
        { id: 'n3', type: 'end', label: '结束', explanation: '出口' },
      ],
      edges: [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n2', isBackEdge: true },
        { source: 'n2', target: 'n3' },
      ],
    });
    mockedChat.mockResolvedValue(withBackEdge);

    const result = await flowchartService.generate(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.edges[1].isBackEdge).toBe(true);
  });
});
