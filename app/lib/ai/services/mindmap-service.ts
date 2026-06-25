// app/lib/ai/services/mindmap-service.ts
// 思维导图 JSON 生成服务（Stage 2，FR-008，Zod 校验 + 失败重试最多 2 次）

import { llmClient } from '@/app/lib/ai/clients/llm-client';
import { validateEnv } from '@/app/lib/env';
import { logger } from '@/app/lib/logging/logger';
import {
  buildMindmapPrompt,
  buildMindmapRetryPrompt,
} from '@/app/lib/ai/prompts/mindmap-prompt';
import { MindmapSchema } from '@/app/lib/ai/schemas/mindmap-schema';
import type { Mindmap } from '@/app/lib/ai/schemas/mindmap-schema';
import type { ServiceResult, ChatMessage } from '@/app/lib/ai/types';
import { isLlmTimeoutError } from '@/app/lib/ai/types';

/**
 * Stage 2 思维导图生成输入
 */
interface GenerateInput {
  problem: string;
  code: string;
}

/** 最大重试次数（NFR-005：最多重试 2 次，共 3 次尝试） */
const MAX_RETRY_COUNT = 2;

/**
 * 从 LLM 输出中提取 JSON 字符串
 * 处理 markdown 代码块包裹的 JSON
 */
function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}

/**
 * 计算思维导图节点总数（用于日志）
 */
function countNodes(node: { children?: Array<{ children?: unknown[] }> }): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child as { children?: Array<{ children?: unknown[] }> });
    }
  }
  return count;
}

/**
 * 思维导图 JSON 生成服务（Stage 2，FR-008）
 * 调用 llm-client，输出经 MindmapSchema 校验，失败重试最多 2 次
 */
export class MindmapService {
  /**
   * 生成思维导图 JSON（Stage 2，含 Zod 校验与重试）
   * @param input 题目与代码
   * @returns Mindmap JSON（校验失败重试最多 2 次）
   */
  async generate(input: GenerateInput): Promise<ServiceResult<Mindmap>> {
    try {
      validateEnv();
      const startTime = Date.now();
      logger.info('思维导图生成开始');

      const baseMessages = buildMindmapPrompt(input);
      let lastError = '';

      for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
        // 重试时附错误信息让模型修正（NFR-005）
        const currentMessages: ChatMessage[] = lastError
          ? buildMindmapRetryPrompt(baseMessages, lastError)
          : baseMessages;

        const response = await llmClient.chat(currentMessages);
        const jsonStr = extractJson(response);

        // JSON 解析
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch (e) {
          lastError = `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`;
          logger.warn('思维导图 JSON 解析失败', { attempt, error: lastError });
          continue;
        }

        // Zod 校验（递归 schema）
        const validated = MindmapSchema.safeParse(parsed);
        if (validated.success) {
          const elapsed = Date.now() - startTime;
          const nodeCount = countNodes(validated.data.root);
          logger.info('思维导图生成完成', { elapsed, attempt, nodeCount });
          return { success: true, data: validated.data };
        }

        lastError = validated.error.message;
        logger.warn('思维导图 Zod 校验失败', { attempt, error: lastError });
      }

      // 3 次均失败（JSON 解析或 Zod 校验失败）
      logger.error('思维导图生成失败，重试次数耗尽', { maxRetry: MAX_RETRY_COUNT });
      return {
        success: false,
        error: {
          code: 'CPP_AI_JSON_VALIDATION_FAILED',
          message: '思维导图数据格式校验失败',
        },
      };
    } catch (error) {
      if (isLlmTimeoutError(error)) {
        logger.error('思维导图生成超时', {
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
      // LLM 调用本身失败（网络错误等）
      logger.error('思维导图生成异常', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: {
          code: 'CPP_AI_MINDMAP_GENERATION_FAILED',
          message: '思维导图生成失败，可重试',
        },
      };
    }
  }
}

export const mindmapService = new MindmapService();
