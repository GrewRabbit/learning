// app/lib/ai/services/fix-loop.ts
// 修正循环逻辑（从 orchestrator.ts 抽出，CR1-001 拆分补充）
// 架构 §4.2 步骤5：最多 3 次修正，每次调用 LLM 修正代码后重新验证
//
// 抽出原因：orchestrator.ts 拆出 format-errors.ts + prompt-loader.ts 后仍超 500 行，
// 修正循环作为"步骤5"具有清晰边界且单元/集成测试充分覆盖，外移风险可控。

import { logger } from '@/app/lib/logging/logger';
import type {
  ServiceResult,
  Solution,
  Meta,
  ValidationResult,
  LLMChunk,
} from '@/app/lib/ai/types';
import type { LLMCaller } from './llm-caller';
import type { HtmlParser } from './html-parser';
import type { CodeValidator } from './code-validator';
import { FIX_PROMPT_TEMPLATE } from '../prompts/fix-prompt-template';
import { formatErrors } from './format-errors';

/** 修正循环最大次数（架构 §4.2 步骤 5） */
const MAX_FIX_ROUNDS = 3;
/** g++ 环境不可用错误码（架构 §5.4） */
const COMPILE_ENV_ERROR_CODE = 'GESP6_COMPILE_ENV_ERROR';

/** 修正循环输入参数 */
export interface FixLoopInput {
  /** LLM 调用器（生成修正代码） */
  caller: LLMCaller;
  /** HTML 解析器（解析修正输出） */
  parser: HtmlParser;
  /** 代码验证器（重新验证修正后代码） */
  validator: CodeValidator;
  /** 当前 meta（含 code 与 samples） */
  meta: Meta;
  /** 当前 HTML */
  html: string;
  /** 首次验证结果（用于填充修正 Prompt 的错误信息） */
  validateResult: ServiceResult<ValidationResult>;
  /** 取消检查回调 */
  shouldAbort?: () => boolean;
  /** 流式分片回调 */
  onChunk?: (chunk: LLMChunk) => void;
  /** compute 起始时间戳（用于日志耗时统计） */
  computeStartTs: number;
}

/**
 * 执行修正循环（架构 §4.2 步骤 5）
 *
 * 最多 MAX_FIX_ROUNDS 次：调用 LLM 修正代码 → 解析 META/HTML → 重新验证
 * - 任一轮验证通过 → 成功返回 { validated: true }
 * - g++ 不可用 / 取消 / 解析失败 → 降级返回 { validated: false, warning }
 * - 3 次后仍失败 → 降级返回 { validated: false, warning: '已修正 3 次' }
 */
export async function runFixLoop(
  input: FixLoopInput,
): Promise<ServiceResult<Solution>> {
  const {
    caller,
    parser,
    validator,
    meta,
    html,
    validateResult,
    shouldAbort,
    onChunk,
    computeStartTs,
  } = input;
  let currentMeta = meta;
  let currentHtml = html;
  let currentValidate = validateResult;

  logger.info('[Orchestrator.compute] 进入修正循环', {
    maxRounds: MAX_FIX_ROUNDS,
  });
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    // 取消检查（用户主动取消或超时放弃时，跳过后续修正，避免浪费 AI 调用）
    if (shouldAbort?.()) {
      logger.info('[Orchestrator.compute] 检测到取消标记，中止修正循环', {
        round,
      });
      return {
        success: false,
        error: { code: 'GESP6_CANCELLED', message: '任务已取消' },
      };
    }
    const fixStartTs = Date.now();

    // 调用 LLM 修正代码（使用 FIX_PROMPT_TEMPLATE 填充占位符，要求仅输出 META 块）
    const errors = formatErrors(currentValidate);
    const fixPrompt = FIX_PROMPT_TEMPLATE.replace(
      '{{ORIGINAL_CODE}}',
      currentMeta.code,
    )
      .replace('{{SAMPLES_JSON}}', JSON.stringify(currentMeta.samples))
      .replace('{{ERRORS}}', errors);
    const fixResult = await caller.generate({
      prompt: fixPrompt,
      problem: {
        type: 'text',
        content: '请根据错误信息修正代码，仅输出 META 块。',
      },
      onChunk,
    });
    logger.info('[Orchestrator.compute] 修正调用完成', {
      round,
      success: fixResult.success,
      rawLength: fixResult.data?.raw.length,
      elapsedMs: Date.now() - fixStartTs,
      errorCode: fixResult.error?.code,
    });
    if (!fixResult.success || !fixResult.data) {
      return {
        success: true,
        data: {
          html: currentHtml,
          validated: false,
          warning: `第 ${round} 次修正调用失败：${fixResult.error?.message ?? '未知错误'}`,
          cached: false,
        },
      };
    }

    // 解析修正输出（修正阶段格式不合规 → 降级返回，不消耗修正配额，架构 §4.4）
    const fixParse = parser.parseMetaAndHtml(fixResult.data.raw);
    if (!fixParse.success || !fixParse.data) {
      logger.warn('[Orchestrator.compute] 修正输出解析失败，降级返回', {
        round,
      });
      return {
        success: true,
        data: {
          html: currentHtml,
          validated: false,
          warning: `第 ${round} 次修正输出格式不合规，已降级返回`,
          cached: false,
        },
      };
    }

    // 更新 meta（HTML 保持原文不变，仅当 LLM 输出了新 HTML 时才更新）
    currentMeta = fixParse.data.meta;
    if (fixParse.data.html) {
      currentHtml = fixParse.data.html;
    }

    // 重新验证
    currentValidate = await validator.validate(
      currentMeta.code,
      currentMeta.samples,
    );
    logger.info('[Orchestrator.compute] 修正后重新验证', {
      round,
      success: currentValidate.success,
      passed: currentValidate.data?.passed,
      compiled: currentValidate.data?.compiled,
      failuresCount: currentValidate.data?.failures?.length,
      errorCode: currentValidate.error?.code,
    });
    if (
      !currentValidate.success &&
      currentValidate.error?.code === COMPILE_ENV_ERROR_CODE
    ) {
      return {
        success: true,
        data: {
          html: currentHtml,
          validated: false,
          warning: 'g++ 编译器不可用，未通过代码验证',
          cached: false,
        },
      };
    }
    if (currentValidate.success && currentValidate.data?.passed) {
      logger.info('[Orchestrator.compute] 修正后验证通过', {
        round,
        elapsedMs: Date.now() - computeStartTs,
      });
      return {
        success: true,
        data: { html: currentHtml, validated: true, cached: false },
      };
    }
  }

  // 步骤 7：3 次修正后仍失败
  logger.warn('[Orchestrator.compute] 3 次修正后仍未通过', {
    elapsedMs: Date.now() - computeStartTs,
  });
  return {
    success: true,
    data: {
      html: currentHtml,
      validated: false,
      warning: '代码未通过样例验证（已修正 3 次）',
      cached: false,
    },
  };
}
