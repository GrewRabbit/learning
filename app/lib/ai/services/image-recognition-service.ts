// app/lib/ai/services/image-recognition-service.ts
// 图片识别服务（FR-003，调用 vision-client，单例导出）

import { visionClient } from '@/app/lib/ai/clients/vision-client';
import type { VisionMessage } from '@/app/lib/ai/clients/vision-client';
import { validateEnv } from '@/app/lib/env';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult } from '@/app/lib/ai/types';
import { isLlmTimeoutError } from '@/app/lib/ai/types';

/**
 * 图片识别输入
 */
interface RecognizeInput {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * 图片识别服务（FR-003）
 * 调用视觉模型（Kimi Vision / 通义千问 VL）识别图片中的编程题目文本
 */
export class ImageRecognitionService {
  /**
   * 识别图片中的编程题目文本
   * @param input 图片数据与 MIME 类型
   * @returns 识别文本
   */
  async recognize(input: RecognizeInput): Promise<ServiceResult<{ text: string }>> {
    try {
      validateEnv();
      const startTime = Date.now();
      logger.info('图片识别开始');

      const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;
      const messages: VisionMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请识别图片中的编程题目文本，仅输出识别到的题目文本，不要添加任何解释说明。如果图片中没有编程题目，请输出"未识别到编程题目"。',
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ];

      const text = await visionClient.chat(messages);

      const elapsed = Date.now() - startTime;
      logger.info('图片识别完成', { elapsed, textLength: text.length });

      return {
        success: true,
        data: { text },
      };
    } catch (error) {
      if (isLlmTimeoutError(error)) {
        logger.error('图片识别超时', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: {
            code: 'CPP_AI_LLM_TIMEOUT',
            message: 'AI 响应超时，请重试',
          },
        };
      }
      logger.error('图片识别失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CPP_AI_VISION_RECOGNITION_FAILED',
          message: '图片识别失败，请重试',
        },
      };
    }
  }
}

export const imageRecognitionService = new ImageRecognitionService();
