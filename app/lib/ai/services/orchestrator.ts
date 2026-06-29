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
import type {
  ServiceResult,
  Problem,
  Solution,
  Meta,
  ValidationResult,
  LLMOutput,
} from '@/app/lib/ai/types';
import { llmCaller, type LLMCaller } from './llm-caller';
import { htmlParser, type HtmlParser } from './html-parser';
import { codeValidator, type CodeValidator } from './code-validator';
import { htmlCache, type HtmlCache, computeContentHash } from './html-cache';
import { fetchProblem } from './problem-fetchers';
import { normalizeContent } from './problem-fetchers/types';
import { imageRecognizer, type ImageRecognizer } from './image-recognizer';
import { FIX_PROMPT_TEMPLATE } from '../prompts/fix-prompt-template';

/** Orchestrator 接口（架构 §5.1） */
export interface Orchestrator {
  solve(problem: Problem): Promise<ServiceResult<Solution>>;
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

  async solve(problem: Problem): Promise<ServiceResult<Solution>> {
    if (problem.type === 'platform') {
      return this.solvePlatform(problem);
    }
    return this.solveTextOrImage(problem);
  }

  /**
   * platform 输入处理（架构 §4.2 步骤 1：主 key 前置检查）
   */
  private async solvePlatform(
    problem: Problem,
  ): Promise<ServiceResult<Solution>> {
    const { platform, problemId } = problem;
    if (!platform || !problemId) {
      return {
        success: false,
        error: {
          code: 'GESP6_INPUT_INVALID',
          message: 'platform 输入缺少 platform/problemId',
        },
      };
    }

    // 主 key 前置检查（无需网络抓取，架构 §4.2 步骤 1）
    const cached = this.cache.getByPrimaryKey(platform, problemId);
    if (cached.success && cached.data) {
      return { success: true, data: { ...cached.data, cached: true } };
    }

    // ProblemFetcher 抓取
    const fetchResult = await fetchProblem(platform, problemId);
    if (!fetchResult.success || !fetchResult.data) {
      return {
        success: false,
        error: fetchResult.error ?? {
          code: 'GESP6_PLATFORM_FETCH_FAILED',
          message: '题目抓取失败',
        },
      };
    }

    const normalizedContent = normalizeContent(fetchResult.data.content);
    const contentHash = computeContentHash(normalizedContent);
    const primaryKey = this.cache.buildPrimaryKey(platform, problemId);

    // getOrCompute（内容 key 缓存 + 单飞 + compute 回调）
    const result = await this.cache.getOrCompute(contentHash, () =>
      this.compute(normalizedContent),
    );

    // 回填主 key（仅 validated=true 时，避免缓存错误结果，架构 §4.2 步骤 6）
    if (result.success && result.data?.validated) {
      this.cache.set(primaryKey, contentHash, result.data);
    }

    return result;
  }

  /**
   * text/image 输入处理（架构 §4.2 步骤 1：前置标准化 + 内容 key 查询）
   */
  private async solveTextOrImage(
    problem: Problem,
  ): Promise<ServiceResult<Solution>> {
    let normalizedContent: string;

    if (problem.type === 'image') {
      // ImageRecognizer 识别（模型不支持返回 GESP6_MODEL_NOT_SUPPORTED）
      const recognizeResult = await this.recognizer.recognize(problem.content);
      if (!recognizeResult.success || !recognizeResult.data) {
        return {
          success: false,
          error: recognizeResult.error ?? {
            code: 'GESP6_INTERNAL_ERROR',
            message: '图片识别失败',
          },
        };
      }
      normalizedContent = normalizeContent(recognizeResult.data.text);
    } else {
      normalizedContent = normalizeContent(problem.content);
    }

    const contentHash = computeContentHash(normalizedContent);
    return this.cache.getOrCompute(contentHash, () =>
      this.compute(normalizedContent),
    );
  }

  /**
   * compute 回调（架构 §4.2 步骤 2-7）
   * LLM 生成 + 解析 + 验证 + 修正循环
   */
  private async compute(
    normalizedContent: string,
  ): Promise<ServiceResult<Solution>> {
    // 拼接 skill prompt + C++ 知识点体系库（供第五章思维导图按层级组织）
    const [skillPrompt, knowledgeBase] = await Promise.all([
      this.loadSkillPrompt(),
      this.loadKnowledgeBase(),
    ]);
    const fullPrompt = knowledgeBase
      ? `${skillPrompt}\n\n## C++ 知识点体系库（第五章思维导图必须按此库的层级组织节点）\n\n${knowledgeBase}`
      : skillPrompt;

    // 步骤 2：LLM 生成调用
    const generateResult = await this.caller.generate({
      prompt: fullPrompt,
      problem: { type: 'text', content: normalizedContent },
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

    if (!parseResult.success) {
      for (let i = 0; i < MAX_FORMAT_RETRY; i++) {
        const retryResult = await this.caller.generate({
          prompt: fullPrompt,
          problem: { type: 'text', content: normalizedContent },
        });
        if (!retryResult.success || !retryResult.data) break;
        rawOutput = retryResult.data.raw;
        parseResult = this.parser.parseMetaAndHtml(rawOutput);
        if (parseResult.success) break;
      }
    }

    if (!parseResult.success || !parseResult.data) {
      // 格式重试仍失败 → 降级返回原始 HTML（架构 §4.4）
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

    // 步骤 4：编译验证
    let validateResult = await this.validator.validate(meta.code, meta.samples);

    // g++ 不可用 → 跳过验证降级返回（架构 §4.4）
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

    // 验证通过 → 成功返回
    if (validateResult.success && validateResult.data?.passed) {
      return {
        success: true,
        data: { html, validated: true, cached: false },
      };
    }

    // 步骤 5：修正循环（最多 3 次，架构 §4.2 步骤 5）
    for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
      const fixResult = await this.callFix(normalizedContent, meta, validateResult);
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
        return {
          success: true,
          data: { html, validated: true, cached: false },
        };
      }
    }

    // 步骤 7：3 次修正后仍失败
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
