// app/__tests__/actions.test.ts
// recognizeImage Server Action 单元测试（FR-003，AC-002，NFR-008/010）
// 覆盖：Zod 验证失败、服务层成功透传、服务层失败透传、未捕获异常兜底

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';
import type { ServiceResult } from '@/app/lib/ai/types';

// Mock 依赖：imageRecognitionService + logger（禁止真实 AI 调用）
vi.mock('@/app/lib/ai/services/image-recognition-service', () => ({
  imageRecognitionService: {
    recognize: vi.fn(),
  },
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { recognizeImage } from '@/app/actions';
import { imageRecognitionService } from '@/app/lib/ai/services/image-recognition-service';
import { logger } from '@/app/lib/logging/logger';

const mockedRecognize = imageRecognitionService.recognize as MockedFunction<
  typeof imageRecognitionService.recognize
>;

/** 构造包含图片数据的 FormData */
function createFormData(imageBase64: string, mimeType: string): FormData {
  const fd = new FormData();
  fd.append('imageBase64', imageBase64);
  fd.append('mimeType', mimeType);
  return fd;
}

describe('recognizeImage Server Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Zod 验证失败 → CPP_INPUT_VALIDATION_ERROR（NFR-008）', () => {
    it('should return CPP_INPUT_VALIDATION_ERROR when imageBase64 为空', async () => {
      const result = await recognizeImage(createFormData('', 'image/png'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_INPUT_VALIDATION_ERROR');
      expect(mockedRecognize).not.toHaveBeenCalled();
    });

    it('should return CPP_INPUT_VALIDATION_ERROR when imageBase64 缺失', async () => {
      const fd = new FormData();
      fd.append('mimeType', 'image/png');

      const result = await recognizeImage(fd);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_INPUT_VALIDATION_ERROR');
      expect(mockedRecognize).not.toHaveBeenCalled();
    });

    it('should return CPP_INPUT_VALIDATION_ERROR when mimeType 非法（NFR-010 类型限制）', async () => {
      const result = await recognizeImage(createFormData('base64data', 'image/gif'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_INPUT_VALIDATION_ERROR');
      expect(mockedRecognize).not.toHaveBeenCalled();
    });

    it('should return CPP_INPUT_VALIDATION_ERROR when mimeType 缺失', async () => {
      const fd = new FormData();
      fd.append('imageBase64', 'base64data');

      const result = await recognizeImage(fd);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_INPUT_VALIDATION_ERROR');
    });
  });

  describe('服务层成功 → 透传 ServiceResult（AC-002）', () => {
    it('should pass through ServiceResult when 识别成功', async () => {
      const serviceResult: ServiceResult<{ text: string }> = {
        success: true,
        data: { text: '请实现一个排序算法' },
      };
      mockedRecognize.mockResolvedValue(serviceResult);

      const result = await recognizeImage(createFormData('base64data', 'image/png'));

      expect(result).toEqual(serviceResult);
      expect(result.success).toBe(true);
      expect(result.data?.text).toBe('请实现一个排序算法');
    });

    it('should call recognize with parsed input（jpg/jpeg 支持）', async () => {
      mockedRecognize.mockResolvedValue({ success: true, data: { text: '题目' } });

      await recognizeImage(createFormData('base64data', 'image/jpeg'));

      expect(mockedRecognize).toHaveBeenCalledWith({
        imageBase64: 'base64data',
        mimeType: 'image/jpeg',
      });
    });

    it('should support webp mimeType', async () => {
      mockedRecognize.mockResolvedValue({ success: true, data: { text: '题目' } });

      await recognizeImage(createFormData('base64data', 'image/webp'));

      expect(mockedRecognize).toHaveBeenCalledWith({
        imageBase64: 'base64data',
        mimeType: 'image/webp',
      });
    });
  });

  describe('服务层失败 → 透传 ServiceResult', () => {
    it('should pass through ServiceResult when 识别失败', async () => {
      const serviceResult: ServiceResult<{ text: string }> = {
        success: false,
        error: {
          code: 'CPP_AI_VISION_RECOGNITION_FAILED',
          message: '图片识别失败，请重试',
        },
      };
      mockedRecognize.mockResolvedValue(serviceResult);

      const result = await recognizeImage(createFormData('base64data', 'image/png'));

      expect(result).toEqual(serviceResult);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_AI_VISION_RECOGNITION_FAILED');
    });

    it('should pass through timeout error from service（CPP_AI_LLM_TIMEOUT）', async () => {
      mockedRecognize.mockResolvedValue({
        success: false,
        error: { code: 'CPP_AI_LLM_TIMEOUT', message: 'AI 响应超时，请重试' },
      });

      const result = await recognizeImage(createFormData('base64data', 'image/webp'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_AI_LLM_TIMEOUT');
    });
  });

  describe('未捕获异常 → CPP_AI_VISION_RECOGNITION_FAILED 兜底（NFR-007）', () => {
    it('should return CPP_AI_VISION_RECOGNITION_FAILED when recognize 抛出异常', async () => {
      mockedRecognize.mockRejectedValue(new Error('意外错误'));

      const result = await recognizeImage(createFormData('base64data', 'image/png'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_AI_VISION_RECOGNITION_FAILED');
      expect(result.error?.message).toBe('图片识别失败，请重试');
      expect(logger.error).toHaveBeenCalledWith(
        'recognizeImage 未捕获异常',
        expect.objectContaining({ error: '意外错误' }),
      );
    });

    it('should handle non-Error throws', async () => {
      mockedRecognize.mockRejectedValue('string error');

      const result = await recognizeImage(createFormData('base64data', 'image/png'));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CPP_AI_VISION_RECOGNITION_FAILED');
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
