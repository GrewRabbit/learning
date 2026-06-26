// app/lib/ai/services/solution-service.ts
// 代码+分析生成服务（Stage 1，FR-006/007）
// generateStream 方法，回调 + 返回值混合设计（架构 §5.4.2）
// <<<CODE>>>/<<<ANALYSIS>>> 标记状态机解析（架构 §4.2.2，状态：pending→code→analysis）
// 边界场景处理（架构 §4.2.3）：标记分片、标记重复、标记乱序、标记缺失

import { llmClient } from '@/app/lib/ai/clients/llm-client';
import { validateEnv } from '@/app/lib/env';
import { logger } from '@/app/lib/logging/logger';
import { buildSolutionPrompt } from '@/app/lib/ai/prompts/solution-prompt';
import type { ServiceResult } from '@/app/lib/ai/types';
import { isAbortError, isLlmTimeoutError } from '@/app/lib/ai/types';

/**
 * Stage 1 解答生成输入
 */
interface GenerateStreamInput {
  problem: string;
  standardAnswer?: string;
  mode: 'normal' | 'deep';
}

/**
 * 流式回调（按标记状态机分流）
 * - onCodeChunk: 代码 chunk 推送（FR-007/013）
 * - onAnalysisChunk: 分析 chunk 推送（FR-007/015）
 * - onFormatInvalid: 标记缺失时回调，用于记录警告日志
 */
interface StreamCallbacks {
  onCodeChunk: (content: string) => void;
  onAnalysisChunk: (content: string) => void;
  onFormatInvalid: () => void;
}

/**
 * 标记状态机状态（单向转换，不可回退）
 * - pending: 初始状态，等待 <<<CODE>>> 标记
 * - code: 收到 <<<CODE>>> 后，等待 <<<ANALYSIS>>> 标记
 * - analysis: 收到 <<<ANALYSIS>>> 后，后续全部作为分析
 */
type ParserState = 'pending' | 'code' | 'analysis';

const CODE_MARKER = '<<<CODE>>>';
const ANALYSIS_MARKER = '<<<ANALYSIS>>>';
const ALL_MARKERS = [CODE_MARKER, ANALYSIS_MARKER];

/**
 * 代码+分析生成服务（Stage 1，FR-006/007）
 */
export class SolutionService {
  /**
   * 流式生成代码与分析（Stage 1）
   *
   * 回调 + 返回值混合设计（架构 §5.4.2）：
   * - 回调（onCodeChunk/onAnalysisChunk）：用于流式推送 chunk，前端实时渲染
   * - 返回值（ServiceResult<{ code, analysis }>）：用于提供完整文本，作为 Stage 2 上下文
   *
   * @param input 题目与模式
   * @param callbacks 流式回调（按标记状态机分流）
   * @param signal 可选 AbortSignal，abort 时停止 LLM 调用并返回取消结果（架构 §4.4.3）
   * @returns 完整代码与分析（用于 Stage 2 上下文）。fallback=true 表示非流式降级，
   *          此时回调未推送任何 chunk，Route Handler 需自行推送完整内容
   */
  async generateStream(
    input: GenerateStreamInput,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<ServiceResult<{ code: string; analysis: string; fallback?: boolean }>> {
    try {
      validateEnv();
      const startTime = Date.now();
      logger.info('Stage 1 解答生成开始', { mode: input.mode });

      const messages = buildSolutionPrompt(input);

      // 标记状态机状态
      let state: ParserState = 'pending';
      // 标记缓冲区（处理标记分片）
      let buffer = '';
      // 完整内容累积（用于返回值）
      let codeBuilder = '';
      let analysisBuilder = '';

      /**
       * 推送普通文本（根据当前状态分流）
       * - pending 状态：推送到 analysis（标记缺失时全部作为 analysis，架构 §4.2.3）
       * - code 状态：推送到 code
       * - analysis 状态：推送到 analysis
       */
      const pushText = (text: string): void => {
        if (text === '') return;
        if (state === 'code') {
          codeBuilder += text;
          callbacks.onCodeChunk(text);
        } else {
          // pending 和 analysis 状态都推送到 analysis
          analysisBuilder += text;
          callbacks.onAnalysisChunk(text);
        }
      };

      /**
       * 查找 buffer 尾部是否是任何标记的前缀
       * 返回最长匹配的前缀长度（0 表示不是前缀）
       */
      const findLongestMarkerPrefix = (buf: string): number => {
        let maxLen = 0;
        for (const marker of ALL_MARKERS) {
          const checkLen = Math.min(marker.length, buf.length);
          for (let i = 1; i <= checkLen; i++) {
            if (buf.endsWith(marker.slice(0, i)) && i > maxLen) {
              maxLen = i;
            }
          }
        }
        return maxLen;
      };

      /**
       * 根据当前状态获取目标标记
       * - pending: 找 <<<CODE>>>
       * - code: 找 <<<ANALYSIS>>>
       * - analysis: 不找（返回 null）
       */
      const getTargetMarker = (): string | null => {
        if (state === 'pending') return CODE_MARKER;
        if (state === 'code') return ANALYSIS_MARKER;
        return null;
      };

      // 消费流式 chunk
      const stream = llmClient.chatStream(messages, signal);
      for await (const chunk of stream) {
        buffer += chunk.content;

        // 处理 buffer 中的标记（循环处理，因为 buffer 中可能包含多个标记）
        let shouldContinue = true;
        while (shouldContinue) {
          shouldContinue = false;

          const targetMarker = getTargetMarker();

          if (targetMarker === null) {
            // analysis 状态：全部作为 analysis 推送，不再查找标记
            pushText(buffer);
            buffer = '';
            break;
          }

          const idx = buffer.indexOf(targetMarker);
          if (idx >= 0) {
            // 找到目标标记：推送标记前的文本，切换状态，继续处理剩余 buffer
            if (idx > 0) {
              pushText(buffer.slice(0, idx));
            }
            // 切换状态（单向：pending→code→analysis）
            state = state === 'pending' ? 'code' : 'analysis';
            buffer = buffer.slice(idx + targetMarker.length);
            shouldContinue = true;
            continue;
          }

          // 没找到目标标记：检查 buffer 尾部是否是任何标记的前缀（处理标记分片）
          const prefixLen = findLongestMarkerPrefix(buffer);
          if (prefixLen > 0 && prefixLen < buffer.length) {
            // 保留可能是标记前缀的尾部，推送其余部分
            pushText(buffer.slice(0, buffer.length - prefixLen));
            buffer = buffer.slice(buffer.length - prefixLen);
          } else if (prefixLen === buffer.length) {
            // 整个 buffer 都是标记前缀，保留等待下一个 chunk
            break;
          } else {
            // 没有标记前缀，全部推送
            pushText(buffer);
            buffer = '';
          }
        }
      }

      // flush 剩余 buffer（流结束时）
      if (buffer) {
        pushText(buffer);
        buffer = '';
      }

      // 检查标记缺失（架构 §4.2.3）
      // - state === 'pending'：标记全部缺失 或 仅 ANALYSIS 无 CODE
      // - state === 'code'：仅 CODE 无 ANALYSIS
      const formatInvalid = state !== 'analysis';
      if (formatInvalid) {
        callbacks.onFormatInvalid();
        logger.warn('Stage 1 解答格式无效', {
          code: 'CPP_AI_SOLUTION_FORMAT_INVALID',
          state,
        });
      }

      const elapsed = Date.now() - startTime;
      logger.info('Stage 1 解答生成完成', {
        elapsed,
        formatInvalid,
        codeLength: codeBuilder.length,
        analysisLength: analysisBuilder.length,
      });

      return {
        success: true,
        data: { code: codeBuilder, analysis: analysisBuilder },
      };
    } catch (error) {
      // 用户主动取消：不降级（重试无意义），直接返回取消结果（架构 §4.4.3）
      // AbortError 必须先于 timeout 判定，避免被 timeout 误捕获
      if (isAbortError(error)) {
        logger.info('Stage 1 解答生成被用户取消', {
          code: 'CPP_AI_GENERATION_CANCELLED',
        });
        return {
          success: false,
          error: {
            code: 'CPP_AI_GENERATION_CANCELLED',
            message: '用户取消生成',
          },
        };
      }

      // 超时错误不降级（重试也不会改善）
      if (isLlmTimeoutError(error)) {
        logger.error('Stage 1 解答生成超时', {
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

      // 流式失败，降级为非流式（DeepSeek 流式 API 对长响应可能不稳定）
      logger.warn('Stage 1 流式生成失败，降级为非流式', {
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        const messages = buildSolutionPrompt(input);
        const fullResponse = await llmClient.chat(messages, signal);

        // 解析标记（非流式简化版，无需处理分片）
        const codeStart = fullResponse.indexOf(CODE_MARKER);
        const analysisStart = fullResponse.indexOf(ANALYSIS_MARKER);

        let code = '';
        let analysis = '';
        let formatInvalid = false;

        if (codeStart !== -1 && analysisStart !== -1 && analysisStart > codeStart) {
          code = fullResponse.slice(codeStart + CODE_MARKER.length, analysisStart).trim();
          analysis = fullResponse.slice(analysisStart + ANALYSIS_MARKER.length).trim();
        } else {
          // 标记缺失或乱序，全部作为 analysis（降级处理，架构 §4.2.3）
          analysis = fullResponse;
          formatInvalid = true;
          callbacks.onFormatInvalid();
          logger.warn('Stage 1 解答格式无效', {
            code: 'CPP_AI_SOLUTION_FORMAT_INVALID',
            state: 'fallback',
          });
        }

        // 非流式降级：不通过回调推送（避免与流式已推送的部分内容重复）
        // Route Handler 依据返回值 fallback=true 自行推送完整内容（重发 stage1-start 清空前端状态）
        logger.info('Stage 1 非流式降级生成完成', {
          codeLength: code.length,
          analysisLength: analysis.length,
          formatInvalid,
        });

        return { success: true, data: { code, analysis, fallback: true } };
      } catch (fallbackError) {
        // 用户主动取消：降级过程中被 abort，返回取消结果（架构 §4.4.3）
        if (isAbortError(fallbackError)) {
          logger.info('Stage 1 非流式降级被用户取消', {
            code: 'CPP_AI_GENERATION_CANCELLED',
          });
          return {
            success: false,
            error: {
              code: 'CPP_AI_GENERATION_CANCELLED',
              message: '用户取消生成',
            },
          };
        }
        if (isLlmTimeoutError(fallbackError)) {
          logger.error('Stage 1 非流式降级超时', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          return {
            success: false,
            error: {
              code: 'CPP_AI_LLM_TIMEOUT',
              message: 'AI 响应超时，请重试',
            },
          };
        }
        logger.error('Stage 1 非流式降级失败', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        return {
          success: false,
          error: {
            code: 'CPP_AI_SOLUTION_GENERATION_FAILED',
            message: '解答生成失败，请重试',
          },
        };
      }
    }
  }
}

export const solutionService = new SolutionService();
