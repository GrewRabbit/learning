// app/lib/ai/services/__tests__/image-recognizer.test.ts
// ImageRecognizer 单元测试（架构 §5.1 接口 + §7.1 依赖 + §4.4 模型不支持前置拒绝）
// mock fs/promises.readFile + models.config.findModelByName + LLMCaller

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock fs/promises（readFile 控制 Prompt 文件加载）
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// mock models.config（findModelByName 返回固定能力配置）
vi.mock('@/app/lib/models.config', () => ({
  findModelByName: vi.fn((name: string) => {
    if (name === 'kimi-vision') {
      return { name: 'kimi-vision', supportsImage: true, supportsTool: false };
    }
    if (name === 'glm-5.2') {
      return { name: 'glm-5.2', supportsImage: false, supportsTool: true };
    }
    return undefined;
  }),
}));

import { LLMImageRecognizer, imageRecognizer } from '../image-recognizer';
import type { LLMCaller } from '../llm-caller';
import type { ServiceResult, LLMOutput } from '@/app/lib/ai/types';
import { readFile } from 'fs/promises';

const mockGenerate = vi.fn();
const mockCaller: LLMCaller = { generate: mockGenerate };
const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

describe('LLMImageRecognizer', () => {
  let recognizer: LLMImageRecognizer;
  const originalVisionModel = process.env.AI_VISION_MODEL;

  beforeEach(() => {
    recognizer = new LLMImageRecognizer(mockCaller);
    mockGenerate.mockReset();
    mockedReadFile.mockReset();
    delete process.env.AI_VISION_MODEL;
  });

  afterEach(() => {
    if (originalVisionModel === undefined) {
      delete process.env.AI_VISION_MODEL;
    } else {
      process.env.AI_VISION_MODEL = originalVisionModel;
    }
  });

  describe('模型能力前置检查（§4.4）', () => {
    it('AI_VISION_MODEL 未配置返回 GESP6_MODEL_NOT_SUPPORTED', async () => {
      delete process.env.AI_VISION_MODEL;
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_MODEL_NOT_SUPPORTED');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('模型未在 models.config.ts 登记返回 GESP6_MODEL_NOT_SUPPORTED', async () => {
      process.env.AI_VISION_MODEL = 'unknown-model';
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_MODEL_NOT_SUPPORTED');
      expect(result.error?.message).toContain('unknown-model');
    });

    it('模型 supportsImage=false 返回 GESP6_MODEL_NOT_SUPPORTED', async () => {
      process.env.AI_VISION_MODEL = 'glm-5.2';
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_MODEL_NOT_SUPPORTED');
      expect(result.error?.message).toContain('supportsImage=false');
    });
  });

  describe('正常识别路径', () => {
    it('模型支持 + LLM 调用成功返回识别文本', async () => {
      process.env.AI_VISION_MODEL = 'kimi-vision';
      mockedReadFile.mockResolvedValueOnce('识别 prompt 内容');
      mockGenerate.mockResolvedValueOnce({
        success: true,
        data: { raw: '识别出的题目内容' },
      } as ServiceResult<LLMOutput>);
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(true);
      expect(result.data?.text).toBe('识别出的题目内容');
      // 验证传入 LLMCaller 的 problem.type 为 image
      const callArgs = mockGenerate.mock.calls[0][0];
      expect(callArgs.problem.type).toBe('image');
      expect(callArgs.problem.content).toBe('base64data');
      expect(callArgs.prompt).toBe('识别 prompt 内容');
    });

    it('Prompt 文件不存在时回退空字符串（不阻断 LLM 调用）', async () => {
      process.env.AI_VISION_MODEL = 'kimi-vision';
      mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      mockGenerate.mockResolvedValueOnce({
        success: true,
        data: { raw: '识别文本' },
      } as ServiceResult<LLMOutput>);
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(true);
      expect(result.data?.text).toBe('识别文本');
      const callArgs = mockGenerate.mock.calls[0][0];
      expect(callArgs.prompt).toBe('');
    });
  });

  describe('LLM 调用失败', () => {
    it('LLM 返回失败时传递错误码', async () => {
      process.env.AI_VISION_MODEL = 'kimi-vision';
      mockedReadFile.mockResolvedValueOnce('prompt');
      mockGenerate.mockResolvedValueOnce({
        success: false,
        error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
      });
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');
    });

    it('LLM 返回失败且无 error 字段时回退 GESP6_INTERNAL_ERROR', async () => {
      process.env.AI_VISION_MODEL = 'kimi-vision';
      mockedReadFile.mockResolvedValueOnce('prompt');
      mockGenerate.mockResolvedValueOnce({ success: false });
      const result = await recognizer.recognize('base64data');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_INTERNAL_ERROR');
    });
  });

  it('单例导出', () => {
    expect(imageRecognizer).toBeInstanceOf(LLMImageRecognizer);
  });
});
