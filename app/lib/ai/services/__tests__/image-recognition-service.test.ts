// app/lib/ai/services/__tests__/image-recognition-service.test.ts
// ImageRecognitionService 单元测试（FR-003，NFR-001/004）
// 测试图片识别成功/失败/超时/markdown 提取场景

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';

// Mock 依赖
vi.mock('@/app/lib/ai/clients/vision-client', () => ({
  visionClient: {
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

import { imageRecognitionService } from '@/app/lib/ai/services/image-recognition-service';
import { visionClient } from '@/app/lib/ai/clients/vision-client';

const mockedChat = visionClient.chat as MockedFunction<typeof visionClient.chat>;

const baseInput = {
  imageBase64: 'iVBORw0KGgoAAAANSUhEUg==',
  mimeType: 'image/png' as const,
};

describe('ImageRecognitionService - 图片识别', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('识别成功：返回题目文本', async () => {
    const recognizedText = '请实现一个函数，计算两个整数的最大公约数。';
    mockedChat.mockResolvedValue(recognizedText);

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.text).toBe(recognizedText);
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('识别成功：应提取纯文本（无 markdown 包裹）', async () => {
    const plainText = '输入一个整数 n，输出 1 到 n 的和。';
    mockedChat.mockResolvedValue(plainText);

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.text).toBe(plainText);
  });

  it('应正确构造 data URL 传入 vision client', async () => {
    mockedChat.mockResolvedValue('题目文本');

    await imageRecognitionService.recognize(baseInput);

    const messages = mockedChat.mock.calls[0][0];
    const userMessage = messages[0];
    expect(userMessage.role).toBe('user');
    // content 应为数组，包含 text 和 image_url 两个 part
    expect(Array.isArray(userMessage.content)).toBe(true);
    const parts = userMessage.content as Array<{ type: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('image_url');
  });

  it('应支持 jpeg MIME 类型', async () => {
    mockedChat.mockResolvedValue('题目');
    await imageRecognitionService.recognize({
      imageBase64: '/9j/4AAQ',
      mimeType: 'image/jpeg',
    });
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('应支持 webp MIME 类型', async () => {
    mockedChat.mockResolvedValue('题目');
    await imageRecognitionService.recognize({
      imageBase64: 'UklGRiQ=',
      mimeType: 'image/webp',
    });
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('未识别到编程题目时仍返回成功', async () => {
    mockedChat.mockResolvedValue('未识别到编程题目');

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.text).toBe('未识别到编程题目');
  });

  it('LLM 调用失败应返回 CPP_AI_VISION_RECOGNITION_FAILED', async () => {
    mockedChat.mockRejectedValue(new Error('API 连接失败'));

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_VISION_RECOGNITION_FAILED');
    expect(result.error?.message).toBe('图片识别失败，请重试');
  });

  it('LLM 超时应返回 CPP_AI_LLM_TIMEOUT', async () => {
    const timeoutError = new Error('Request timed out');
    timeoutError.name = 'APIConnectionTimeoutError';
    mockedChat.mockRejectedValue(timeoutError);

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CPP_AI_LLM_TIMEOUT');
    expect(result.error?.message).toBe('AI 响应超时，请重试');
  });

  it('应返回空字符串当 LLM 返回空响应', async () => {
    mockedChat.mockResolvedValue('');

    const result = await imageRecognitionService.recognize(baseInput);

    expect(result.success).toBe(true);
    expect(result.data?.text).toBe('');
  });
});
