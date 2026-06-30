// app/lib/ai/services/llm-caller.ts
// LLMCaller 实现（架构 §5.1 接口 + §7.1 依赖 + §4.4 超时处理）
// 封装 OpenAI 兼容 SDK 调用，超时 120s 返回 GESP6_LLM_TIMEOUT
//
// Prompt 加载策略：
//   LLMInput.prompt 字段由调用方（Orchestrator）加载 gesp6-skill.md 文本后填入。
//   LLMCaller 仅负责 SDK 调用，不关心 Prompt 来源。
//   ImageRecognizer 复用 LLMCaller.generate，传入识别 Prompt（架构 §5.1 注释）。
//
// 并发容错策略（P0 修复）：
//   应用层指数退避重试：429 RateLimitError / APIConnectionError 重试 3 次（1s → 2s → 4s）
//   超时 / 其他错误不重试，直接返回错误码供 Orchestrator 处理
//   SDK 层 maxRetries=0 保留（避免 SDK 自动重试与应用层重试叠加）

import OpenAI from 'openai';
import { getTextConfig, getVisionConfig } from '@/app/lib/ai/config';
import type { ModelConfig } from '@/app/lib/ai/config';
import type { ServiceResult, LLMInput, LLMOutput } from '@/app/lib/ai/types';
import { ConcurrencyLimiter } from './concurrency-limiter';

/** LLMCaller 接口（架构 §5.1） */
export interface LLMCaller {
  generate(input: LLMInput): Promise<ServiceResult<LLMOutput>>;
}

/** LLM 调用超时（毫秒，架构 §4.4：>120s 中止） */
const LLM_TIMEOUT_MS = 120_000;
/** 应用层重试最大次数（仅针对 429 / 网络错误，P0 修复） */
const LLM_MAX_RETRY = 3;
/** 重试基础延迟（毫秒），指数退避：1s → 2s → 4s */
const LLM_RETRY_BASE_DELAY_MS = 1_000;
/**
 * LLM 全局并发上限（P1 修复）
 * 设为 3 的原因：
 * - DeepSeek 默认 QPS 限制约 60 req/min（≈1 req/s），3 并发约 3 req/s
 * - 留余量避免触发服务方 429（配合 P0 重试机制兜底）
 * - 单核服务器上 3 个并发 LLM 调用（IO 密集型）不会显著拖慢
 */
const LLM_MAX_CONCURRENT = 3;
/** LLM 全局并发限制器（模块级单例，所有请求共享） */
const llmLimiter = new ConcurrencyLimiter(LLM_MAX_CONCURRENT);

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
    // 全局并发限制（P1 修复：避免触发 LLM 服务方 QPS 限制）
    return llmLimiter.run(() => this.generateWithRetry(input));
  }

  /**
   * 带重试的 LLM 调用（在并发限制内执行）
   */
  private async generateWithRetry(
    input: LLMInput,
  ): Promise<ServiceResult<LLMOutput>> {
    const config = this.getConfig(input);

    // 应用层指数退避重试（P0 修复）
    // 仅针对 429 RateLimitError / APIConnectionError（网络抖动）
    // 超时 / 其他错误不重试
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= LLM_MAX_RETRY; attempt++) {
      try {
        const raw = await this.callOnce(input, config);
        return { success: true, data: { raw } };
      } catch (error) {
        lastError = error;

        // 超时直接返回（不重试，架构 §4.4）
        if (this.isTimeoutError(error)) {
          return {
            success: false,
            error: {
              code: 'GESP6_LLM_TIMEOUT',
              message: 'LLM 调用超时（>120s）',
            },
          };
        }

        // 可重试错误：429 / 网络错误
        if (attempt < LLM_MAX_RETRY && this.isRetryableError(error)) {
          const delay = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        // 其他错误或重试耗尽 → 跳出循环返回错误
        break;
      }
    }

    // 重试耗尽或不可重试错误
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? '未知错误');
    return {
      success: false,
      error: {
        code: 'GESP6_INTERNAL_ERROR',
        message: `LLM 调用失败：${message}`,
      },
    };
  }

  /**
   * 单次 LLM 调用（不含重试逻辑）
   * 每次调用创建新 client（避免连接复用导致的 keep-alive 问题）
   */
  private async callOnce(
    input: LLMInput,
    config: ModelConfig,
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: 0, // SDK 层不重试（应用层重试在 generate() 中实现）
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

    return response.choices[0]?.message?.content ?? '';
  }

  /**
   * 判断是否为超时错误（不重试）
   * OpenAI SDK v4：APIConnectionTimeoutError
   * 通用回退：error.message/name 含 'timeout'
   */
  private isTimeoutError(error: unknown): boolean {
    return (
      error instanceof OpenAI.APIConnectionTimeoutError ||
      (error instanceof Error &&
        (/timeout/i.test(error.message) || /timeout/i.test(error.name)))
    );
  }

  /**
   * 判断是否为可重试错误
   * - RateLimitError：429 限流（可重试，指数退避后通常恢复）
   * - APIConnectionError：网络连接错误（可重试，可能是短暂抖动）
   */
  private isRetryableError(error: unknown): boolean {
    return (
      error instanceof OpenAI.RateLimitError ||
      error instanceof OpenAI.APIConnectionError
    );
  }

  /** 延迟工具（用于指数退避） */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** 单例导出（api-conventions.md） */
export const llmCaller = new OpenAIClientLLMCaller();
