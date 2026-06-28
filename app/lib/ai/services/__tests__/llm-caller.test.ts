// app/lib/ai/services/__tests__/llm-caller.test.ts
// LLMCaller 单元测试（架构 §5.1 接口 + §7.1 依赖 + §4.4 超时处理）
// mock @/app/lib/ai/config + openai SDK

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock @/app/lib/ai/config（getTextConfig 返回固定配置）
vi.mock('@/app/lib/ai/config', () => ({
  getTextConfig: vi.fn(() => ({
    provider: 'test',
    model: 'test-model',
    apiKey: 'test-key',
    baseUrl: 'http://test',
  })),
}));

// mock openai SDK（chat.completions.create 为 mockCreate）
const mockCreate = vi.fn();
vi.mock('openai', () => {
  class APIConnectionTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionTimeoutError';
    }
  }
  class MockOpenAI {
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
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
    const timeoutError = new OpenAI.APIConnectionTimeoutError('timeout');
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
});
