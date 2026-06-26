// app/actions.ts
// 首页专属 Server Actions（遵循 api-conventions.md "页面专属 Action 放同目录 actions.ts"）
// recognizeImage 由前端 useActionState 消费，无持久化故无需 revalidatePath（架构 §5.2）

'use server';

import { z } from 'zod';

import { imageRecognitionService } from '@/app/lib/ai/services/image-recognition-service';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult } from '@/app/lib/ai/types';

/**
 * recognizeImage 输入校验 Schema（NFR-008：所有用户输入经 Zod 验证）
 * - imageBase64：非空字符串（前端 FileReader 转换后的 base64 数据，不含 data: 前缀）
 * - mimeType：jpg/png/webp 三选一（NFR-010 文件类型限制）
 */
const recognizeImageSchema = z.object({
  imageBase64: z.string().min(1, '图片数据不能为空'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

/**
 * 识别图片中的编程题目文本（FR-003）
 * 由前端 useActionState 配合 <form action={action}> 调用
 * @param formData 包含 imageBase64 与 mimeType 字段
 * @returns 识别文本（success）或错误信息（error）
 */
export async function recognizeImage(
  formData: FormData,
): Promise<ServiceResult<{ text: string }>> {
  try {
    const parsed = recognizeImageSchema.safeParse({
      imageBase64: formData.get('imageBase64'),
      mimeType: formData.get('mimeType'),
    });
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'CPP_INPUT_VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? '输入校验失败',
        },
      };
    }

    // 图片识别结果通过 return 值传回前端（useActionState），无持久化，
    // 故无需 revalidatePath 刷新缓存（架构 §5.2 说明）
    const result = await imageRecognitionService.recognize(parsed.data);
    return result;
  } catch (error) {
    logger.error('recognizeImage 未捕获异常', {
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
