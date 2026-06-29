// app/lib/ai/services/llm-caller.ts
// LLMCaller 实现（架构 §5.1 接口 + §7.1 依赖 + §4.4 超时处理）
// 封装 OpenAI 兼容 SDK 调用，超时 120s 返回 GESP6_LLM_TIMEOUT
//
// Prompt 加载策略：
//   LLMInput.prompt 字段由调用方（Orchestrator）加载 gesp6-skill.md 文本后填入。
//   LLMCaller 仅负责 SDK 调用，不关心 Prompt 来源。
//   ImageRecognizer 复用 LLMCaller.generate，传入识别 Prompt（架构 §5.1 注释）。

import OpenAI from 'openai';
import { getTextConfig, getVisionConfig } from '@/app/lib/ai/config';
import type { ModelConfig } from '@/app/lib/ai/config';
import type { ServiceResult, LLMInput, LLMOutput } from '@/app/lib/ai/types';

/** LLMCaller 接口（架构 §5.1） */
export interface LLMCaller {
  generate(input: LLMInput): Promise<ServiceResult<LLMOutput>>;
}

/** LLM 调用超时（毫秒，架构 §4.4：>120s 中止） */
const LLM_TIMEOUT_MS = 120_000;

/**
 * OpenAI 兼容 LLMCaller 实现
 *
 * 依赖（架构 §7.1）：
 * - OpenAI SDK
 * - gesp6-skill.md（由调用方加载填入 LLMInput.prompt）
 * - models.config.ts（间接，通过 config 选取模型）
 *
 * 模型选择策略：
 * - problem.type === 'image' → getVisionConfig()（视觉模型，图片识别）
 * - 其他（text/platform）→ getTextConfig()（文本模型，推理生成 HTML）
 */
export class OpenAIClientLLMCaller implements LLMCaller {
  /**
   * 根据 problem.type 选择模型配置
   * - image：视觉模型（getVisionConfig）
   * - text/platform：文本模型（getTextConfig）
   */
  private getConfig(input: LLMInput): ModelConfig {
    return input.problem.type === 'image'
      ? getVisionConfig()
      : getTextConfig();
  }

  async generate(input: LLMInput): Promise<ServiceResult<LLMOutput>> {
    try {
      const config = this.getConfig(input);
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: LLM_TIMEOUT_MS,
        maxRetries: 0, // 不重试（架构 §4.4 由 Orchestrator 触发格式重试/修正循环）
        // 阿里云 MaaS 网关与 undici 的 keep-alive 不兼容，会触发 "Premature close"
        // 强制 Connection: close 规避该问题（已实测验证）
        defaultHeaders: { Connection: 'close' },
      });

      // 构造 chat messages
      // - system: skill Prompt 全文（由调用方加载）
      // - user: 题目内容（image 类型构造多模态消息，架构 §7.1 ImageRecognizer 复用）
      // - history: 修正循环时携带的历史消息（架构 §5.2 LLMInput.history）
      const userMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam =
        input.problem.type === 'image'
          ? {
              role: 'user',
              content: [
                { type: 'text', text: input.problem.content || '请识别图片中的题目内容' },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${input.problem.content}` },
                },
              ],
            }
          : { role: 'user', content: input.problem.content };

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: input.prompt },
        userMessage,
        ...(input.history ?? []).map((h) => ({
          role: h.role,
          content: h.content,
        })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      ];

      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        stream: false,
      });

      const raw = response.choices[0]?.message?.content ?? '';
      return { success: true, data: { raw } };
    } catch (error) {
      // 超时检测（架构 §4.4：返回 GESP6_LLM_TIMEOUT）
      // OpenAI SDK v4 超时错误类型：APIConnectionTimeoutError
      // 通用回退：error.message 含 'timeout' 或 error.name 含 'Timeout'
      const isTimeout =
        error instanceof OpenAI.APIConnectionTimeoutError ||
        (error instanceof Error &&
          (/timeout/i.test(error.message) || /timeout/i.test(error.name)));
      if (isTimeout) {
        return {
          success: false,
          error: {
            code: 'GESP6_LLM_TIMEOUT',
            message: 'LLM 调用超时（>120s）',
          },
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'GESP6_INTERNAL_ERROR',
          message: `LLM 调用失败：${message}`,
        },
      };
    }
  }
}

/** 单例导出（api-conventions.md） */
export const llmCaller = new OpenAIClientLLMCaller();
