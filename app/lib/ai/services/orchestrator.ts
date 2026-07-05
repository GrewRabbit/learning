// app/lib/ai/services/orchestrator.ts
// Orchestrator 编排层实现（架构 §4.2 编排数据流 + §4.4 异常流 + §5.1 接口）
//
// 编排流程（架构 §4.2）：
// 1. 输入预处理与双 key 缓存检查（步骤 1）
//    - platform: 主 key 前置检查 → ProblemFetcher 抓取 → 标准化 → getOrCompute → 回填主 key
//    - image: ImageRecognizer 识别 → 标准化 → getOrCompute
//    - text: 标准化 → getOrCompute
// 2. LLM 生成调用（步骤 2）
// 3. HTML 解析 + 格式重试（步骤 3 + §4.4，仅生成阶段 1 次）
// 4. 编译验证（步骤 4，g++ 不可用降级）
// 5. 修正循环最多 3 次（步骤 5）
// 6. 成功返回 / 降级返回（步骤 6-7）

import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '@/app/lib/logging/logger';
import type {
  ServiceResult,
  Problem,
  Solution,
  Meta,
  ValidationResult,
  LLMOutput,
  LLMChunk,
} from '@/app/lib/ai/types';
import { llmCaller, type LLMCaller } from './llm-caller';
import { htmlParser, type HtmlParser } from './html-parser';
import { codeValidator, type CodeValidator } from './code-validator';
import { htmlCache, type HtmlCache, computeContentHash } from './html-cache';
import { fetchProblem } from './problem-fetchers';
import { normalizeContent, extractSampleFingerprint } from './problem-fetchers/types';
import { imageRecognizer, type ImageRecognizer } from './image-recognizer';
import { FIX_PROMPT_TEMPLATE } from '../prompts/fix-prompt-template';

/** Orchestrator 接口（架构 §5.1） */
export interface Orchestrator {
  solve(
    problem: Problem,
    shouldAbort?: () => boolean,
    onChunk?: (chunk: LLMChunk) => void,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>>;
}

/** skill Prompt 文件路径 */
const SKILL_PROMPT_PATH = path.join(
  process.cwd(),
  'app/lib/ai/prompts/gesp6-skill.md',
);

/** C++ 知识点体系库文件路径（供第五章思维导图按层级组织） */
const KNOWLEDGE_BASE_PATH = path.join(
  process.cwd(),
  'app/lib/ai/data/cpp-knowledge.md',
);

/** 修正循环最大次数（架构 §4.2 步骤 5） */
const MAX_FIX_ROUNDS = 3;
/** 格式重试最大次数（架构 §4.4：仅生成阶段 1 次） */
const MAX_FORMAT_RETRY = 1;
/** g++ 环境不可用错误码（架构 §5.4） */
const COMPILE_ENV_ERROR_CODE = 'GESP6_COMPILE_ENV_ERROR';

/**
 * FixedLoopOrchestrator：固定流程编排实现（架构 §5.1）
 *
 * 未来可替换为 AgentOrchestrator（架构 §8.3 预留）
 */
export class FixedLoopOrchestrator implements Orchestrator {
  private skillPromptCache: string | null = null;
  private knowledgeBaseCache: string | null = null;

  constructor(
    private readonly caller: LLMCaller = llmCaller,
    private readonly parser: HtmlParser = htmlParser,
    private readonly validator: CodeValidator = codeValidator,
    private readonly cache: HtmlCache = htmlCache,
    private readonly recognizer: ImageRecognizer = imageRecognizer,
  ) {}

  async solve(
    problem: Problem,
    shouldAbort?: () => boolean,
    onChunk?: (chunk: LLMChunk) => void,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>> {
    if (problem.type === 'platform') {
      return this.solvePlatform(problem, shouldAbort, onChunk, forceRegenerate);
    }
    return this.solveTextOrImage(problem, shouldAbort, onChunk, forceRegenerate);
  }

  /**
   * platform 输入处理（架构 §4.2 步骤 1：主 key 前置检查）
   *
   * forceRegenerate=true 时跳过主 key 前置检查 + getOrCompute 内部缓存读，
   * 直接走 compute 强制 LLM 重新生成，生成后覆盖现有缓存映射。
   */
  private async solvePlatform(
    problem: Problem,
    shouldAbort?: () => boolean,
    onChunk?: (chunk: LLMChunk) => void,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>> {
    const { platform, problemId } = problem;
    if (!platform || !problemId) {
      logger.warn('[Orchestrator.solvePlatform] 缺少 platform/problemId', { problem });
      return {
        success: false,
        error: {
          code: 'GESP6_INPUT_INVALID',
          message: 'platform 输入缺少 platform/problemId',
        },
      };
    }

    logger.info('[Orchestrator.solvePlatform] 开始', {
      platform,
      problemId,
      forceRegenerate: Boolean(forceRegenerate),
    });

    // 主 key 前置检查（无需网络抓取，架构 §4.2 步骤 1）
    // forceRegenerate 时跳过，强制走 compute 路径
    if (!forceRegenerate) {
      const cached = this.cache.getByPrimaryKey(platform, problemId);
      logger.info('[Orchestrator.solvePlatform] 主 key 查询', {
        platform,
        problemId,
        hit: cached.success && Boolean(cached.data),
        errorCode: cached.error?.code,
      });
      if (cached.success && cached.data) {
        logger.info('[Orchestrator.solvePlatform] 主 key 命中，直接返回', {
          platform,
          problemId,
          validated: cached.data.validated,
        });
        return { success: true, data: { ...cached.data, cached: true } };
      }
    } else {
      logger.info('[Orchestrator.solvePlatform] forceRegenerate=true，跳过主 key 检查', {
        platform,
        problemId,
      });
    }

    // ProblemFetcher 抓取
    const fetchStartTs = Date.now();
    const fetchResult = await fetchProblem(platform, problemId);
    logger.info('[Orchestrator.solvePlatform] fetchProblem 完成', {
      platform,
      problemId,
      success: fetchResult.success,
      contentLength: fetchResult.data?.content.length,
      elapsedMs: Date.now() - fetchStartTs,
      errorCode: fetchResult.error?.code,
    });
    if (!fetchResult.success || !fetchResult.data) {
      return {
        success: false,
        error: fetchResult.error ?? {
          code: 'GESP6_PLATFORM_FETCH_FAILED',
          message: '题目抓取失败',
        },
      };
    }

    const rawContent = fetchResult.data.content;
    const normalizedContent = normalizeContent(rawContent);
    const contentHash = computeContentHash(normalizedContent);
    // FR-015：fetcher 抓取后额外算 sampleFp（用原始 markdown，extractSampleFingerprint 内部对代码块做 normalizeContent）
    const sampleFp = extractSampleFingerprint(rawContent);
    const primaryKey = this.cache.buildPrimaryKey(platform, problemId);
    logger.info('[Orchestrator.solvePlatform] 哈希计算完成', {
      platform,
      problemId,
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      sampleFpAll: sampleFp.all,
      sampleFpAllShort: sampleFp.all ? sampleFp.all.slice(0, 16) : '',
      sampleFpFirst: sampleFp.first,
      sampleFpFirstShort: sampleFp.first ? sampleFp.first.slice(0, 16) : '',
      hasSampleFp: Boolean(sampleFp.all) || Boolean(sampleFp.first),
      rawContentLength: rawContent.length,
      normalizedContentLength: normalizedContent.length,
      normalizedPreview: normalizedContent.slice(0, 80),
    });

    // getOrCompute（内容 key 缓存 + sample 指纹查询 + 单飞 + compute 回调，FR-007）
    const gocStartTs = Date.now();
    const result = await this.cache.getOrCompute(
      contentHash,
      () => this.compute(normalizedContent, shouldAbort, onChunk),
      sampleFp,
      forceRegenerate,
    );
    logger.info('[Orchestrator.solvePlatform] getOrCompute 完成', {
      platform,
      problemId,
      contentHash,
      sampleFpAll: sampleFp.all,
      sampleFpFirst: sampleFp.first,
      success: result.success,
      cached: result.data?.cached,
      validated: result.data?.validated,
      hasWarning: Boolean(result.data?.warning),
      elapsedMs: Date.now() - gocStartTs,
      errorCode: result.error?.code,
    });

    // 回填主 key（仅 validated=true 时，避免缓存错误结果，架构 §4.2 步骤 6，FR-016 回填逻辑不变）
    // sample 命中时，FR-007 第 2 步已在 getOrCompute 内部用当前 contentHash 建立映射，
    // 此处仍用当前 contentHash 调用 set，后续 primary 命中 → getByContentKey(当前contentHash) → 命中
    if (result.success && result.data?.validated) {
      this.cache.set(primaryKey, contentHash, result.data);
      logger.info('[Orchestrator.solvePlatform] 主 key 回填完成', {
        platform,
        problemId,
        primaryKey,
        contentHash,
      });
    } else {
      logger.warn('[Orchestrator.solvePlatform] 跳过主 key 回填（validated=false 或失败）', {
        platform,
        problemId,
        success: result.success,
        validated: result.data?.validated,
      });
    }

    return result;
  }

  /**
   * text/image 输入处理（架构 §4.2 步骤 1：前置标准化 + 内容 key 查询）
   *
   * forceRegenerate=true 时 getOrCompute 内部跳过缓存读，直接走 compute 强制重新生成。
   */
  private async solveTextOrImage(
    problem: Problem,
    shouldAbort?: () => boolean,
    onChunk?: (chunk: LLMChunk) => void,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>> {
    logger.info('[Orchestrator.solveTextOrImage] 开始', {
      type: problem.type,
      forceRegenerate: Boolean(forceRegenerate),
    });
    let normalizedContent: string;
    let rawContent: string;

    if (problem.type === 'image') {
      // ImageRecognizer 识别（模型不支持返回 GESP6_MODEL_NOT_SUPPORTED）
      const recognizeStartTs = Date.now();
      const recognizeResult = await this.recognizer.recognize(problem.content);
      logger.info('[Orchestrator.solveTextOrImage] 图片识别完成', {
        success: recognizeResult.success,
        textLength: recognizeResult.data?.text.length,
        elapsedMs: Date.now() - recognizeStartTs,
        errorCode: recognizeResult.error?.code,
        errorMessage: recognizeResult.error?.message,
        imageContentLength: problem.content.length,
      });
      if (!recognizeResult.success || !recognizeResult.data) {
        return {
          success: false,
          error: recognizeResult.error ?? {
            code: 'GESP6_INTERNAL_ERROR',
            message: '图片识别失败',
          },
        };
      }
      rawContent = recognizeResult.data.text;
      normalizedContent = normalizeContent(rawContent);
    } else {
      rawContent = problem.content;
      normalizedContent = normalizeContent(rawContent);
    }

    const contentHash = computeContentHash(normalizedContent);
    // FR-014：算 contentHash 后额外算 sampleFp（用原始 markdown，extractSampleFingerprint 内部对代码块做 normalizeContent）
    const sampleFp = extractSampleFingerprint(rawContent);
    logger.info('[Orchestrator.solveTextOrImage] 哈希计算完成', {
      type: problem.type,
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      sampleFpAll: sampleFp.all,
      sampleFpAllShort: sampleFp.all ? sampleFp.all.slice(0, 16) : '',
      sampleFpFirst: sampleFp.first,
      sampleFpFirstShort: sampleFp.first ? sampleFp.first.slice(0, 16) : '',
      hasSampleFp: Boolean(sampleFp.all) || Boolean(sampleFp.first),
      rawContentLength: rawContent.length,
      normalizedContentLength: normalizedContent.length,
      normalizedPreview: normalizedContent.slice(0, 80),
    });

    const gocStartTs = Date.now();
    const result = await this.cache.getOrCompute(
      contentHash,
      () => this.compute(normalizedContent, shouldAbort, onChunk),
      sampleFp,
      forceRegenerate,
    );
    logger.info('[Orchestrator.solveTextOrImage] getOrCompute 完成', {
      type: problem.type,
      contentHash,
      sampleFpAll: sampleFp.all,
      sampleFpFirst: sampleFp.first,
      success: result.success,
      cached: result.data?.cached,
      validated: result.data?.validated,
      hasWarning: Boolean(result.data?.warning),
      elapsedMs: Date.now() - gocStartTs,
      errorCode: result.error?.code,
    });
    return result;
  }

  /**
   * compute 回调（架构 §4.2 步骤 2-7）
   * LLM 生成 + 解析 + 验证 + 修正循环
   *
   * shouldAbort：可选的取消检查回调，在修正循环每轮开始前调用。
   * 若返回 true，则中止后续修正，返回 cancelled 结果（不写缓存）。
   */
  private async compute(
    normalizedContent: string,
    shouldAbort?: () => boolean,
    onChunk?: (chunk: LLMChunk) => void,
  ): Promise<ServiceResult<Solution>> {
    const computeStartTs = Date.now();
    logger.info('[Orchestrator.compute] 开始 LLM 生成流程', {
      contentLength: normalizedContent.length,
    });

    // 拼接 skill prompt + C++ 知识点体系库（供第五章思维导图按层级组织）
    const [skillPrompt, knowledgeBase] = await Promise.all([
      this.loadSkillPrompt(),
      this.loadKnowledgeBase(),
    ]);
    const fullPrompt = knowledgeBase
      ? `${skillPrompt}\n\n## C++ 知识点体系库（第五章思维导图必须按此库的层级组织节点）\n\n${knowledgeBase}`
      : skillPrompt;

    // 步骤 2：LLM 生成调用
    const genStartTs = Date.now();
    const generateResult = await this.caller.generate({
      prompt: fullPrompt,
      problem: { type: 'text', content: normalizedContent },
      onChunk,
    });
    logger.info('[Orchestrator.compute] LLM 生成完成', {
      success: generateResult.success,
      rawLength: generateResult.data?.raw.length,
      elapsedMs: Date.now() - genStartTs,
      errorCode: generateResult.error?.code,
    });
    if (!generateResult.success || !generateResult.data) {
      return {
        success: false,
        error: generateResult.error ?? {
          code: 'GESP6_INTERNAL_ERROR',
          message: 'LLM 生成调用失败',
        },
      };
    }

    // 步骤 3：HTML 解析（含格式重试，仅生成阶段 1 次，架构 §4.4）
    let rawOutput = generateResult.data.raw;
    let parseResult = this.parser.parseMetaAndHtml(rawOutput);
    logger.info('[Orchestrator.compute] 首次解析', {
      success: parseResult.success,
    });

    if (!parseResult.success) {
      for (let i = 0; i < MAX_FORMAT_RETRY; i++) {
        logger.info('[Orchestrator.compute] 格式重试', { retryRound: i + 1 });
        const retryResult = await this.caller.generate({
          prompt: fullPrompt,
          problem: { type: 'text', content: normalizedContent },
          onChunk,
        });
        if (!retryResult.success || !retryResult.data) break;
        rawOutput = retryResult.data.raw;
        parseResult = this.parser.parseMetaAndHtml(rawOutput);
        if (parseResult.success) break;
      }
    }

    if (!parseResult.success || !parseResult.data) {
      // 格式重试仍失败 → 降级返回原始 HTML（架构 §4.4）
      logger.warn('[Orchestrator.compute] 解析失败，降级返回原始 HTML', {
        rawLength: rawOutput.length,
        elapsedMs: Date.now() - computeStartTs,
      });
      return {
        success: true,
        data: {
          html: rawOutput,
          validated: false,
          warning: 'LLM 输出格式不合规，已降级返回原始 HTML',
          cached: false,
        },
      };
    }

    let meta = parseResult.data.meta;
    let html = parseResult.data.html;
    logger.info('[Orchestrator.compute] 解析成功', {
      hasCode: Boolean(meta.code),
      codeLength: meta.code?.length,
      samplesCount: meta.samples?.length,
    });

    // 步骤 4：编译验证
    let validateResult = await this.validator.validate(meta.code, meta.samples);
    logger.info('[Orchestrator.compute] 首次验证', {
      success: validateResult.success,
      passed: validateResult.data?.passed,
      compiled: validateResult.data?.compiled,
      failuresCount: validateResult.data?.failures?.length,
      errorCode: validateResult.error?.code,
    });

    // g++ 不可用 → 跳过验证降级返回（架构 §4.4）
    if (
      !validateResult.success &&
      validateResult.error?.code === COMPILE_ENV_ERROR_CODE
    ) {
      logger.warn('[Orchestrator.compute] g++ 不可用，降级返回', {
        elapsedMs: Date.now() - computeStartTs,
      });
      return {
        success: true,
        data: {
          html,
          validated: false,
          warning: 'g++ 编译器不可用，未通过代码验证',
          cached: false,
        },
      };
    }

    // 验证通过 → 成功返回
    if (validateResult.success && validateResult.data?.passed) {
      logger.info('[Orchestrator.compute] 首次验证通过', {
        elapsedMs: Date.now() - computeStartTs,
      });
      return {
        success: true,
        data: { html, validated: true, cached: false },
      };
    }

    // 步骤 5：修正循环（最多 3 次，架构 §4.2 步骤 5）
    logger.info('[Orchestrator.compute] 进入修正循环', { maxRounds: MAX_FIX_ROUNDS });
    for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
      // 取消检查（用户主动取消或超时放弃时，跳过后续修正，避免浪费 AI 调用）
      if (shouldAbort?.()) {
        logger.info('[Orchestrator.compute] 检测到取消标记，中止修正循环', { round });
        return {
          success: false,
          error: { code: 'GESP6_CANCELLED', message: '任务已取消' },
        };
      }
      const fixStartTs = Date.now();
      const fixResult = await this.callFix(normalizedContent, meta, validateResult, onChunk);
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
            html,
            validated: false,
            warning: `第 ${round} 次修正调用失败：${fixResult.error?.message ?? '未知错误'}`,
            cached: false,
          },
        };
      }

      // 解析修正输出（修正阶段格式不合规 → 降级返回，不消耗修正配额，架构 §4.4）
      const fixParse = this.parser.parseMetaAndHtml(fixResult.data.raw);
      if (!fixParse.success || !fixParse.data) {
        logger.warn('[Orchestrator.compute] 修正输出解析失败，降级返回', { round });
        return {
          success: true,
          data: {
            html,
            validated: false,
            warning: `第 ${round} 次修正输出格式不合规，已降级返回`,
            cached: false,
          },
        };
      }

      // 更新 meta（HTML 保持原文不变，仅当 LLM 输出了新 HTML 时才更新）
      meta = fixParse.data.meta;
      if (fixParse.data.html) {
        html = fixParse.data.html;
      }

      // 重新验证
      validateResult = await this.validator.validate(meta.code, meta.samples);
      logger.info('[Orchestrator.compute] 修正后重新验证', {
        round,
        success: validateResult.success,
        passed: validateResult.data?.passed,
        compiled: validateResult.data?.compiled,
        failuresCount: validateResult.data?.failures?.length,
        errorCode: validateResult.error?.code,
      });
      if (
        !validateResult.success &&
        validateResult.error?.code === COMPILE_ENV_ERROR_CODE
      ) {
        return {
          success: true,
          data: {
            html,
            validated: false,
            warning: 'g++ 编译器不可用，未通过代码验证',
            cached: false,
          },
        };
      }
      if (validateResult.success && validateResult.data?.passed) {
        logger.info('[Orchestrator.compute] 修正后验证通过', {
          round,
          elapsedMs: Date.now() - computeStartTs,
        });
        return {
          success: true,
          data: { html, validated: true, cached: false },
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
        html,
        validated: false,
        warning: '代码未通过样例验证（已修正 3 次）',
        cached: false,
      },
    };
  }

  /**
   * 修正循环 LLM 调用（架构 §4.2 步骤 5）
   * 使用 FIX_PROMPT_TEMPLATE 填充占位符，要求仅输出 META 块
   */
  private async callFix(
    _normalizedContent: string,
    meta: Meta,
    lastValidate: ServiceResult<ValidationResult>,
    onChunk?: (chunk: LLMChunk) => void,
  ): Promise<ServiceResult<LLMOutput>> {
    const errors = this.formatErrors(lastValidate);
    const fixPrompt = FIX_PROMPT_TEMPLATE.replace(
      '{{ORIGINAL_CODE}}',
      meta.code,
    )
      .replace('{{SAMPLES_JSON}}', JSON.stringify(meta.samples))
      .replace('{{ERRORS}}', errors);

    return this.caller.generate({
      prompt: fixPrompt,
      problem: {
        type: 'text',
        content: '请根据错误信息修正代码，仅输出 META 块。',
      },
      onChunk,
    });
  }

  /**
   * 格式化错误信息（供 FIX_PROMPT_TEMPLATE 的 {{ERRORS}} 占位符）
   */
  private formatErrors(
    validateResult: ServiceResult<ValidationResult>,
  ): string {
    if (!validateResult.success) {
      return `验证过程异常：${validateResult.error?.message ?? '未知错误'}`;
    }
    const data = validateResult.data!;
    const parts: string[] = [];

    if (!data.compiled) {
      parts.push('【编译错误】');
      parts.push(data.errors.join('\n'));
    } else if (data.failures && data.failures.length > 0) {
      parts.push('【样例测试失败】');
      for (const f of data.failures) {
        parts.push(`\n样例 ${f.sampleIndex + 1}:`);
        parts.push(`输入:\n${f.input}`);
        parts.push(`期望输出:\n${f.expected}`);
        parts.push(`实际输出:\n${f.actual}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * 加载 skill Prompt（带缓存，避免每次调用都读文件）
   */
  private async loadSkillPrompt(): Promise<string> {
    if (this.skillPromptCache !== null) {
      return this.skillPromptCache;
    }
    try {
      this.skillPromptCache = await readFile(SKILL_PROMPT_PATH, 'utf-8');
    } catch {
      console.warn(
        `[Orchestrator] skill prompt 文件不存在：${SKILL_PROMPT_PATH}`,
      );
      this.skillPromptCache = '';
    }
    return this.skillPromptCache;
  }

  /**
   * 加载 C++ 知识点体系库（带缓存）
   * 用于第五章思维导图按系统化分类分层级组织，避免 LLM 自由发挥
   */
  private async loadKnowledgeBase(): Promise<string> {
    if (this.knowledgeBaseCache !== null) {
      return this.knowledgeBaseCache;
    }
    try {
      this.knowledgeBaseCache = await readFile(KNOWLEDGE_BASE_PATH, 'utf-8');
    } catch {
      console.warn(
        `[Orchestrator] 知识点库文件不存在：${KNOWLEDGE_BASE_PATH}`,
      );
      this.knowledgeBaseCache = '';
    }
    return this.knowledgeBaseCache;
  }
}

/** 单例导出（api-conventions.md） */
export const gesp6Orchestrator = new FixedLoopOrchestrator();
