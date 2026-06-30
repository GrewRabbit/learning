// app/lib/ai/services/__tests__/llm-caller.test.ts
// LLMCaller 单元测试（架构 §5.1 接口 + §7.1 依赖 + §4.4 超时处理）
// mock @/app/lib/ai/config + openai SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock @/app/lib/ai/config（getTextConfig / getVisionConfig 返回固定配置）
vi.mock('@/app/lib/ai/config', () => ({
  getTextConfig: vi.fn(() => ({
    provider: 'test',
    model: 'test-model',
    apiKey: 'test-key',
    baseUrl: 'http://test',
  })),
  getVisionConfig: vi.fn(() => ({
    provider: 'test-vision',
    model: 'test-vision-model',
    apiKey: 'test-vision-key',
    baseUrl: 'http://test-vision',
  })),
}));

// mock openai SDK（chat.completions.create 为 mockCreate）
const mockCreate = vi.fn();
vi.mock('openai', () => {
  // 模拟 OpenAI SDK v4 错误类型
  class APIConnectionTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }
  class RateLimitError extends Error {
    status = 429;
    constructor(message: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  }
  class APIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }
  class MockOpenAI {
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static RateLimitError = RateLimitError;
    static APIConnectionError = APIConnectionError;
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockOpenAI };
});

import { OpenAIClientLLMCaller, llmCaller } from '../llm-caller';

describe('OpenAIClientLLMCaller', () => {
  let caller: OpenAIClientLLMCaller;

  beforeEach(() => {
    caller = new OpenAIClientLLMCaller();
    mockCreate.mockReset();
  });

  it('正常路径返回 LLMOutput.raw', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '<<<META>>>{...}<<<HTML>>>html' } }],
    });
    const result = await caller.generate({
      prompt: 'system prompt',
      problem: { type: 'text', content: '题目内容' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.raw).toBe('<<<META>>>{...}<<<HTML>>>html');
  });

  it('image 类型构造多模态消息（content 为数组 + image_url）', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '识别文本' } }],
    });
    await caller.generate({
      prompt: '识别 prompt',
      problem: { type: 'image', content: 'base64data' },
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0];
    const userMessage = args.messages[1];
    expect(userMessage.role).toBe('user');
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content[0].type).toBe('text');
    expect(userMessage.content[1].type).toBe('image_url');
    expect(userMessage.content[1].image_url.url).toBe('data:image/jpeg;base64,base64data');
  });

  it('text 类型构造纯文本消息', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'resp' } }],
    });
    await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: '题目' },
    });
    const args = mockCreate.mock.calls[0][0];
    expect(args.messages[1].role).toBe('user');
    expect(typeof args.messages[1].content).toBe('string');
    expect(args.messages[1].content).toBe('题目');
  });

  it('携带 history 消息（修正循环场景）', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'resp' } }],
    });
    await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: 'c' },
      history: [
        { role: 'assistant', content: 'previous response' },
        { role: 'user', content: 'fix this' },
      ],
    });
    const args = mockCreate.mock.calls[0][0];
    // system + user + 2 history = 4 messages
    expect(args.messages).toHaveLength(4);
    expect(args.messages[2].role).toBe('assistant');
    expect(args.messages[2].content).toBe('previous response');
    expect(args.messages[3].role).toBe('user');
  });

  it('超时返回 GESP6_LLM_TIMEOUT（APIConnectionTimeoutError）', async () => {
    const OpenAI = (await import('openai')).default;
    const timeoutError = new OpenAI.APIConnectionTimeoutError({ message: 'timeout' });
    mockCreate.mockRejectedValueOnce(timeoutError);
    const result = await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: 'c' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');
  });

  it('超时返回 GESP6_LLM_TIMEOUT（通用 name/message regex 回退）', async () => {
    const error = new Error('Request timeout');
    mockCreate.mockRejectedValueOnce(error);
    const result = await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: 'c' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');
  });

  it('其他错误返回 GESP6_INTERNAL_ERROR', async () => {
    mockCreate.mockRejectedValueOnce(new Error('网络错误'));
    const result = await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: 'c' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_INTERNAL_ERROR');
    expect(result.error?.message).toContain('网络错误');
  });

  describe('应用层指数退避重试（P0 修复）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('429 RateLimitError → 重试 1 次后成功', async () => {
      const OpenAI = (await import('openai')).default;
      // 类型断言绕过 mock 与真实 SDK 构造函数签名差异
      const RateLimitError = OpenAI.RateLimitError as unknown as new (m: string) => Error;
      const rateLimitError = new RateLimitError('rate limited');
      mockCreate
        .mockRejectedValueOnce(rateLimitError) // 第 1 次：429
        .mockResolvedValueOnce({ choices: [{ message: { content: 'success' } }] }); // 第 2 次：成功

      const promise = caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      // 推进 1s 让指数退避 sleep 完成
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.raw).toBe('success');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('APIConnectionError → 重试 3 次后成功（1s → 2s → 4s）', async () => {
      const OpenAI = (await import('openai')).default;
      const ConnError = OpenAI.APIConnectionError as unknown as new (m: string) => Error;
      const connError = new ConnError('network error');
      mockCreate
        .mockRejectedValueOnce(connError) // 第 1 次：网络错误
        .mockRejectedValueOnce(connError) // 第 2 次：网络错误
        .mockRejectedValueOnce(connError) // 第 3 次：网络错误
        .mockResolvedValueOnce({ choices: [{ message: { content: 'final' } }] }); // 第 4 次：成功

      const promise = caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      // 推进 1s + 2s + 4s 让所有指数退避 sleep 完成
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.raw).toBe('final');
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('429 连续 4 次 → 重试耗尽返回 GESP6_INTERNAL_ERROR', async () => {
      const OpenAI = (await import('openai')).default;
      const RateLimitError = OpenAI.RateLimitError as unknown as new (m: string) => Error;
      const rateLimitError = new RateLimitError('rate limited');
      mockCreate.mockRejectedValue(rateLimitError);

      const promise = caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      // 推进所有重试间隔
      await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_INTERNAL_ERROR');
      expect(result.error?.message).toContain('rate limited');
      // 第 1 次 + 3 次重试 = 4 次
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('超时错误不触发重试（直接返回 GESP6_LLM_TIMEOUT）', async () => {
      const OpenAI = (await import('openai')).default;
      const TimeoutError = OpenAI.APIConnectionTimeoutError as unknown as new (m: string) => Error;
      const timeoutError = new TimeoutError('timeout');
      mockCreate.mockRejectedValue(timeoutError);

      const promise = caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');
      // 仅调用 1 次，未重试
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('其他错误不触发重试（直接返回 GESP6_INTERNAL_ERROR）', async () => {
      const authError = new Error('Invalid API key');
      authError.name = 'AuthenticationError';
      mockCreate.mockRejectedValueOnce(authError);

      const promise = caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_INTERNAL_ERROR');
      // 仅调用 1 次，未重试
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  it('响应 choices 为空时 raw 为空字符串', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });
    const result = await caller.generate({
      prompt: 'p',
      problem: { type: 'text', content: 'c' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.raw).toBe('');
  });

  it('单例导出', () => {
    expect(llmCaller).toBeInstanceOf(OpenAIClientLLMCaller);
  });

  describe('全局并发限制（P1 修复：LLM_MAX_CONCURRENT=3）', () => {
    // 验证 llmLimiter 单例是否正确包裹 generate
    // 关键：4 个并发调用，前 3 个立即开始（max in-flight=3），第 4 个排队等待
    it('4 个并发调用，同时 in-flight 数不超过 3', async () => {
      let inflight = 0;
      let maxInflight = 0;
      mockCreate.mockImplementation(async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        // 模拟慢速 LLM 调用（50ms）
        await new Promise((r) => setTimeout(r, 50));
        inflight--;
        return { choices: [{ message: { content: 'ok' } }] };
      });

      const promises = Array.from({ length: 4 }, () =>
        caller.generate({
          prompt: 'p',
          problem: { type: 'text', content: 'c' },
        }),
      );
      await Promise.all(promises);

      // LLM_MAX_CONCURRENT=3，maxInflight 不应超过 3
      expect(maxInflight).toBeLessThanOrEqual(3);
      // 至少 1 个并发（避免 mockImplementation 同步返回导致 maxInflight=1）
      expect(maxInflight).toBeGreaterThanOrEqual(2);
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('第 4 个调用排队等待，总耗时 > 2 个批次', async () => {
      // 单次调用 50ms，4 个并发因 max=3，至少 2 批：50ms + 50ms ≈ 100ms
      mockCreate.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { choices: [{ message: { content: 'ok' } }] };
      });

      const start = Date.now();
      const promises = Array.from({ length: 4 }, () =>
        caller.generate({
          prompt: 'p',
          problem: { type: 'text', content: 'c' },
        }),
      );
      await Promise.all(promises);
      const elapsed = Date.now() - start;

      // 4 任务 max=3 → 至少 2 批 → 总耗时 ≥ 80ms（允许 30ms 调度容差）
      expect(elapsed).toBeGreaterThanOrEqual(80);
      // 全部成功
      expect(mockCreate).toHaveBeenCalledTimes(4);
    });

    it('并发限制不阻塞单次调用（无并发时立即返回）', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'solo' } }],
      });
      const start = Date.now();
      const result = await caller.generate({
        prompt: 'p',
        problem: { type: 'text', content: 'c' },
      });
      const elapsed = Date.now() - start;
      expect(result.success).toBe(true);
      // 单次调用应 < 100ms（mock 立即 resolve）
      expect(elapsed).toBeLessThan(100);
    });
  });
});
