// app/lib/ai/services/__tests__/solution-service.test.ts
// SolutionService 单元测试（架构 §4.2，FR-006/007）
// 测试标记状态机解析：正常/分片/重复/乱序/缺失场景

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';
import type { ChatMessage, StreamChunk } from '@/app/lib/ai/types';

// Mock 依赖
vi.mock('@/app/lib/ai/clients/llm-client', () => ({
  llmClient: {
    chatStream: vi.fn(),
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

import { solutionService } from '@/app/lib/ai/services/solution-service';
import { llmClient } from '@/app/lib/ai/clients/llm-client';

const mockedChatStream = llmClient.chatStream as MockedFunction<
  typeof llmClient.chatStream
>;
const mockedChat = llmClient.chat as MockedFunction<typeof llmClient.chat>;

/**
 * 创建模拟流式 chunk 异步生成器
 */
function createMockStream(chunks: string[]): AsyncGenerator<StreamChunk> {
  async function* gen(): AsyncGenerator<StreamChunk> {
    for (const c of chunks) {
      yield { content: c };
    }
  }
  return gen();
}

/**
 * 创建回调收集器
 */
function createCallbacks() {
  const codeChunks: string[] = [];
  const analysisChunks: string[] = [];
  let formatInvalidCalled = false;
  return {
    callbacks: {
      onCodeChunk: (content: string) => codeChunks.push(content),
      onAnalysisChunk: (content: string) => analysisChunks.push(content),
      onFormatInvalid: () => {
        formatInvalidCalled = true;
      },
    },
    codeChunks,
    analysisChunks,
    // 使用 getter 避免布尔值按值拷贝导致闭包内更新不反映到属性
    get formatInvalidCalled(): boolean {
      return formatInvalidCalled;
    },
    codeText: () => codeChunks.join(''),
    analysisText: () => analysisChunks.join(''),
  };
}

const baseInput = { problem: '求两数之和', mode: 'normal' as const };

describe('SolutionService - 标记状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常场景：CODE 与 ANALYSIS 标记完整', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream(['<<<CODE>>>', '代码内容', '<<<ANALYSIS>>>', '分析内容']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码内容');
    expect(result.data?.analysis).toBe('分析内容');
    expect(cb.codeText()).toBe('代码内容');
    expect(cb.analysisText()).toBe('分析内容');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('分片场景：标记跨 chunk 分片（<<<CO|DE>>>）', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream([
        '<<<CO',
        'DE>>>',
        '代码内容',
        '<<<ANAL',
        'YSIS>>>',
        '分析内容',
      ]),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码内容');
    expect(result.data?.analysis).toBe('分析内容');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('分片场景：标记前缀与内容混合', async () => {
    // '<<<' 是标记前缀，需保留到下一 chunk 才能判断
    mockedChatStream.mockImplementation(() =>
      createMockStream(['文本<<<', 'CODE>>>', '代码', '<<<ANALYSIS>>>', '分析']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码');
    // '文本' 在 pending 状态推送到 analysis，故 analysis 为 '文本分析'
    expect(result.data?.analysis).toBe('文本分析');
    expect(cb.analysisChunks.join('')).toBe('文本分析');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('重复场景：CODE 标记重复出现（仅首次生效，后续作为代码内容）', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream([
        '<<<CODE>>>',
        '<<<CODE>>>',
        '代码内容',
        '<<<ANALYSIS>>>',
        '分析内容',
      ]),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    // 第二个 <<<CODE>>> 在 code 状态下作为普通文本推送
    expect(result.data?.code).toBe('<<<CODE>>>代码内容');
    expect(result.data?.analysis).toBe('分析内容');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('乱序场景：ANALYSIS 标记先于 CODE 出现', async () => {
    // pending 状态只找 CODE_MARKER，ANALYSIS_MARKER 作为普通文本推送到 analysis
    mockedChatStream.mockImplementation(() =>
      createMockStream([
        '<<<ANALYSIS>>>',
        '分析内容',
        '<<<CODE>>>',
        '代码内容',
      ]),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码内容');
    // <<<ANALYSIS>>> 与 分析内容 都推送到 analysis（pending 状态）
    expect(result.data?.analysis).toBe('<<<ANALYSIS>>>分析内容');
    // 结束时 state='code'，触发 formatInvalid
    expect(cb.formatInvalidCalled).toBe(true);
  });

  it('缺失场景：无任何标记（全部作为 analysis）', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream(['这是分析内容，没有标记']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('');
    expect(result.data?.analysis).toBe('这是分析内容，没有标记');
    // state 始终为 pending，触发 formatInvalid
    expect(cb.formatInvalidCalled).toBe(true);
  });

  it('缺失场景：仅有 CODE 无 ANALYSIS', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream(['<<<CODE>>>', '代码内容']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码内容');
    expect(result.data?.analysis).toBe('');
    // 结束时 state='code'，触发 formatInvalid
    expect(cb.formatInvalidCalled).toBe(true);
  });

  it('空流场景：无任何 chunk', async () => {
    mockedChatStream.mockImplementation(() => createMockStream([]));

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('');
    expect(result.data?.analysis).toBe('');
    // state='pending'，触发 formatInvalid
    expect(cb.formatInvalidCalled).toBe(true);
  });

  it('单 chunk 完整场景：所有内容在一个 chunk', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream(['<<<CODE>>>代码内容<<<ANALYSIS>>>分析内容']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('代码内容');
    expect(result.data?.analysis).toBe('分析内容');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('异常场景：chatStream 抛出错误 + 非流式也失败 → 返回失败', async () => {
    mockedChatStream.mockImplementation(() => {
      throw new Error('LLM 连接失败');
    });
    mockedChat.mockRejectedValue(new Error('非流式也失败'));

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_SOLUTION_GENERATION_FAILED');
    expect(result.error?.message).toBe('解答生成失败，请重试');
  });

  it('流中抛出错误 + 非流式也失败 → 返回失败', async () => {
    mockedChatStream.mockImplementation(() => {
      async function* gen(): AsyncGenerator<StreamChunk> {
        yield { content: '<<<CODE>>>' };
        yield { content: '部分代码' };
        throw new Error('流中断');
      }
      return gen();
    });
    mockedChat.mockRejectedValue(new Error('非流式也失败'));

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_SOLUTION_GENERATION_FAILED');
  });

  it('非流式降级成功：chatStream 抛出错误 + chat 返回完整内容 → fallback 成功', async () => {
    mockedChatStream.mockImplementation(() => {
      throw new Error('LLM 流式连接失败');
    });
    mockedChat.mockResolvedValue(
      '<<<CODE>>>降级代码内容<<<ANALYSIS>>>降级分析内容',
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('降级代码内容');
    expect(result.data?.analysis).toBe('降级分析内容');
    expect(result.data?.fallback).toBe(true);
    // 降级时不通过回调推送（Route Handler 依据 fallback 标志自行推送）
    expect(cb.codeText()).toBe('');
    expect(cb.analysisText()).toBe('');
    expect(cb.formatInvalidCalled).toBe(false);
  });

  it('非流式降级成功：流中中断 + chat 返回完整内容 → fallback 成功', async () => {
    mockedChatStream.mockImplementation(() => {
      async function* gen(): AsyncGenerator<StreamChunk> {
        yield { content: '<<<CODE>>>' };
        yield { content: '部分代码' };
        throw new Error('流中断');
      }
      return gen();
    });
    mockedChat.mockResolvedValue(
      '<<<CODE>>>完整代码内容<<<ANALYSIS>>>完整分析内容',
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('完整代码内容');
    expect(result.data?.analysis).toBe('完整分析内容');
    expect(result.data?.fallback).toBe(true);
    // 流式部分已推送的 chunk 不应出现在返回值中（返回值是降级完整内容）
    expect(cb.codeText()).toBe('部分代码');
    expect(cb.analysisText()).toBe('');
  });

  it('非流式降级：标记缺失时全部作为 analysis + formatInvalid', async () => {
    mockedChatStream.mockImplementation(() => {
      throw new Error('LLM 流式连接失败');
    });
    mockedChat.mockResolvedValue('无标记的纯文本内容');

    const cb = createCallbacks();
    const result = await solutionService.generateStream(baseInput, cb.callbacks);

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('');
    expect(result.data?.analysis).toBe('无标记的纯文本内容');
    expect(result.data?.fallback).toBe(true);
    expect(cb.formatInvalidCalled).toBe(true);
  });

  it('应支持 deep 模式', async () => {
    mockedChatStream.mockImplementation(() =>
      createMockStream(['<<<CODE>>>', '深度代码', '<<<ANALYSIS>>>', '深度分析']),
    );

    const cb = createCallbacks();
    const result = await solutionService.generateStream(
      { problem: '复杂题目', mode: 'deep' },
      cb.callbacks,
    );

    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('深度代码');
    expect(result.data?.analysis).toBe('深度分析');
  });

  it('取消场景：signal 已 aborted 时返回取消结果（非超时、非失败，不降级）', async () => {
    const controller = new AbortController();
    controller.abort();

    // 模拟 OpenAI SDK 在 signal 已 aborted 时抛出 AbortError
    mockedChatStream.mockImplementation((_messages: ChatMessage[], signal?: AbortSignal) => {
      async function* gen(): AsyncGenerator<StreamChunk> {
        if (signal?.aborted) {
          const err = new Error('The user aborted a request');
          err.name = 'AbortError';
          throw err;
        }
        yield { content: '<<<CODE>>>' };
      }
      return gen();
    });

    const cb = createCallbacks();
    const result = await solutionService.generateStream(
      baseInput,
      cb.callbacks,
      controller.signal,
    );

    // 取消不当作超时（CPP_AI_LLM_TIMEOUT）或失败（CPP_AI_SOLUTION_GENERATION_FAILED）
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_GENERATION_CANCELLED');
    // 验证 signal 被透传给 llmClient.chatStream（架构 §4.4.3：触发时停止 LLM 调用）
    expect(mockedChatStream).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });

  it('取消场景：流中 abort 时返回取消结果', async () => {
    const controller = new AbortController();

    // 模拟流式过程中收到部分 chunk 后被 abort
    mockedChatStream.mockImplementation((_messages: ChatMessage[], signal?: AbortSignal) => {
      async function* gen(): AsyncGenerator<StreamChunk> {
        yield { content: '<<<CODE>>>' };
        yield { content: '部分代码' };
        // 模拟 abort 时机：下一个 chunk 前检测 signal
        if (signal?.aborted) {
          const err = new Error('The user aborted a request');
          err.name = 'AbortError';
          throw err;
        }
        yield { content: '剩余内容' };
      }
      return gen();
    });

    const cb = createCallbacks();
    // 在 generateStream 启动前先 abort（简化测试：模拟流中 abort 的结果）
    controller.abort();
    const result = await solutionService.generateStream(
      baseInput,
      cb.callbacks,
      controller.signal,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_GENERATION_CANCELLED');
  });
});
