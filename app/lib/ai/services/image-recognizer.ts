// app/lib/ai/services/image-recognizer.ts
// ImageRecognizer 实现（架构 §5.1 接口 + §7.1 依赖 + §4.4 异常流）
// 多模态 LLM 调用，仅识别图片为文本不解题
// 模型不支持图片时返回 GESP6_MODEL_NOT_SUPPORTED（架构 §4.4）
// 复用 LLMCaller.generate（架构 §5.1 注释）

import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult, Problem } from '@/app/lib/ai/types';
import { findModelByName } from '@/app/lib/models.config';
import { llmCaller, type LLMCaller } from './llm-caller';

/** ImageRecognizer 接口（架构 §5.1） */
export interface ImageRecognizer {
  recognize(imageBase64: string): Promise<ServiceResult<{ text: string }>>;
}

/** 识别 Prompt 文件路径（架构 §6 目录结构） */
const PROMPT_FILE_PATH = path.join(
  process.cwd(),
  'app/lib/ai/prompts/image-recognition-prompt.md',
);

/** 错误码（架构 §5.4） */
const MODEL_NOT_SUPPORTED_CODE = 'GESP6_MODEL_NOT_SUPPORTED';

export class LLMImageRecognizer implements ImageRecognizer {
  constructor(private readonly caller: LLMCaller = llmCaller) {}

  async recognize(imageBase64: string): Promise<ServiceResult<{ text: string }>> {
    // 1. 检测当前模型是否支持图片（架构 §4.4：模型不支持图片前置拒绝）
    const modelCheck = this.checkModelSupportsImage();
    if (!modelCheck.supports) {
      return {
        success: false,
        error: {
          code: MODEL_NOT_SUPPORTED_CODE,
          message: modelCheck.reason ?? '当前模型不支持图片输入',
        },
      };
    }

    try {
      // 2. 加载识别 Prompt（Phase 3 填充实际文本，当前为占位）
      const promptText = await this.loadPrompt();

      // 3. 构造图片 Problem（架构 §5.1 注释：传入识别 Prompt + 图片 Problem）
      const problem: Problem = {
        type: 'image',
        content: imageBase64,
      };

      // 4. 调用 LLMCaller.generate（多模态，LLMCaller 内部构造 image_url 消息）
      const result = await this.caller.generate({ prompt: promptText, problem });
      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error ?? {
            code: 'GESP6_INTERNAL_ERROR',
            message: '图片识别 LLM 调用失败',
          },
        };
      }

      // 5. 返回识别的纯文本（架构 §5.1 注释：LLMOutput.raw 为识别的纯文本）
      return { success: true, data: { text: result.data.raw } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'GESP6_INTERNAL_ERROR',
          message: `图片识别失败：${message}`,
        },
      };
    }
  }

  /**
   * 检测当前模型是否支持图片输入
   * 从环境变量 AI_VISION_MODEL 读取模型名，在 models.config.ts 中查找 supportsImage
   */
  private checkModelSupportsImage(): { supports: boolean; reason?: string } {
    const modelName = process.env.AI_VISION_MODEL;
    if (!modelName) {
      return {
        supports: false,
        reason: '未配置 AI_VISION_MODEL 环境变量',
      };
    }

    const modelConfig = findModelByName(modelName);
    if (!modelConfig) {
      return {
        supports: false,
        reason: `模型 ${modelName} 未在 models.config.ts 中登记能力`,
      };
    }

    if (!modelConfig.supportsImage) {
      return {
        supports: false,
        reason: `当前模型 ${modelName} 不支持图片输入（supportsImage=false），请切换模型或改用题号/文本输入`,
      };
    }

    return { supports: true };
  }

  /**
   * 加载识别 Prompt 文本
   * Phase 1 创建占位文件，Phase 3 填充实际文本
   * 文件不存在时回退为空字符串（让 LLM 用默认行为识别）
   */
  private async loadPrompt(): Promise<string> {
    try {
      return await readFile(PROMPT_FILE_PATH, 'utf-8');
    } catch {
      logger.warn(
        `[ImageRecognizer] 识别 Prompt 文件不存在：${PROMPT_FILE_PATH}，使用空 prompt`,
      );
      return '';
    }
  }
}

/** 单例导出（api-conventions.md） */
export const imageRecognizer = new LLMImageRecognizer();
