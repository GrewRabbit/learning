// app/lib/ai/services/__tests__/orchestrator.test.ts
// Orchestrator 单元测试（架构 §4.2 编排数据流 + §4.4 异常流）
// 通过构造函数注入 mock 依赖，测试编排逻辑（不测试具体 LLM/g++ 行为）

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { FixedLoopOrchestrator } from '../orchestrator';
import type {
  ServiceResult,
  Solution,
  Meta,
  ValidationResult,
  Problem,
} from '@/app/lib/ai/types';
import type { LLMCaller } from '../llm-caller';
import type { HtmlParser } from '../html-parser';
import type { CodeValidator } from '../code-validator';
import type { HtmlCache } from '../html-cache';
import type { ImageRecognizer } from '../image-recognizer';

// mock fs/promises（Orchestrator.loadSkillPrompt 依赖 readFile）
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
}));

// mock problem-fetchers（solvePlatform 依赖 fetchProblem）
vi.mock('@/app/lib/ai/services/problem-fetchers', () => ({
  fetchProblem: vi.fn(),
}));

// mock extractSampleFingerprint（AD-08 填充测试需可控指纹；默认空指纹=测试内容无代码块的真实行为）
const { extractSampleFingerprintMock } = vi.hoisted(() => ({
  extractSampleFingerprintMock: vi.fn(),
}));
vi.mock('@/app/lib/ai/services/problem-fetchers/types', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/ai/services/problem-fetchers/types')>();
  return { ...actual, extractSampleFingerprint: extractSampleFingerprintMock };
});

import { fetchProblem } from '@/app/lib/ai/services/problem-fetchers';

const mockMeta: Meta = {
  code: '#include <bits/stdc++.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d",a+b);return 0;}',
  samples: [{ input: '1 2', expectedOutput: '3' }],
};

const validHtml = '<!DOCTYPE html><html></html>';
const validRaw = `<<<META>>>${JSON.stringify(mockMeta)}<<<HTML>>>${validHtml}`;

const passValidate: ServiceResult<ValidationResult> = {
  success: true,
  data: { compiled: true, passed: true, errors: [], trimEnabled: false },
};

const failValidate: ServiceResult<ValidationResult> = {
  success: true,
  data: {
    compiled: true,
    passed: false,
    errors: [],
    trimEnabled: false,
    failures: [{ sampleIndex: 0, input: '1 2', expected: '3', actual: '4' }],
  },
};

function createMockDeps() {
  const mockCaller = {
    generate: vi.fn() as MockedFunction<LLMCaller['generate']>,
  };
  const mockParser = {
    parseMetaAndHtml: vi.fn() as MockedFunction<HtmlParser['parseMetaAndHtml']>,
  };
  const mockValidator = {
    validate: vi.fn() as MockedFunction<CodeValidator['validate']>,
  };
  const mockCache = {
    getByPrimaryKey: vi.fn(async () => ({ success: true, data: null })) as MockedFunction<HtmlCache['getByPrimaryKey']>,
    getByContentKey: vi.fn(async () => ({ success: true, data: null })) as MockedFunction<HtmlCache['getByContentKey']>,
    getBySampleFingerprint: vi.fn(async () => ({ success: true, data: null })) as MockedFunction<HtmlCache['getBySampleFingerprint']>,
    set: vi.fn() as MockedFunction<HtmlCache['set']>,
    getOrCompute: vi.fn(
      async (
        _hash: string,
        compute: () => Promise<ServiceResult<Solution>>,
      ) => compute(),
    ) as MockedFunction<HtmlCache['getOrCompute']>,
    buildPrimaryKey: vi.fn(
      (p: string, id: string) => `gesp6:platform:${p}:${id}`,
    ) as MockedFunction<HtmlCache['buildPrimaryKey']>,
  };
  const mockRecognizer = {
    recognize: vi.fn() as MockedFunction<ImageRecognizer['recognize']>,
  };
  return { mockCaller, mockParser, mockValidator, mockCache, mockRecognizer };
}

describe('FixedLoopOrchestrator', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let orchestrator: FixedLoopOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认空指纹（与原真实行为一致：测试内容 '题目内容' 无代码块）
    extractSampleFingerprintMock.mockReturnValue({ all: '', first: '' });
    deps = createMockDeps();
    orchestrator = new FixedLoopOrchestrator(
      deps.mockCaller,
      deps.mockParser,
      deps.mockValidator,
      deps.mockCache,
      deps.mockRecognizer,
    );
  });

  describe('text 输入', () => {
    it('生成成功 + 验证通过 → validated: true', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(result.data?.cached).toBe(false);
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(1);
    });

    it('验证失败 + 修正循环第1次成功 → validated: true', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate
        .mockResolvedValueOnce(failValidate)
        .mockResolvedValueOnce(passValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(2);
    });

    it('3次修正仍失败 → validated: false + warning', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('已修正 3 次');
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(4);
    });

    it('格式不合规 + 格式重试成功 → 正常流程', async () => {
      deps.mockCaller.generate
        .mockResolvedValueOnce({
          success: true,
          data: { raw: 'invalid output' },
        })
        .mockResolvedValueOnce({ success: true, data: { raw: validRaw } });
      deps.mockParser.parseMetaAndHtml
        .mockReturnValueOnce({
          success: false,
          error: { code: 'GESP6_LLM_FORMAT_ERROR', message: '格式错误' },
        })
        .mockReturnValue({
          success: true,
          data: { meta: mockMeta, html: validHtml },
        });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(2);
    });

    it('格式不合规 + 格式重试仍失败 → 降级返回', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: 'invalid output' },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: false,
        error: { code: 'GESP6_LLM_FORMAT_ERROR', message: '格式错误' },
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('格式不合规');
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(2);
    });

    it('g++ 不可用 → 跳过验证降级返回', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue({
        success: false,
        error: { code: 'GESP6_COMPILE_ENV_ERROR', message: 'g++ 不可用' },
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('g++');
    });

    it('LLM 调用失败 → 错误返回', async () => {
      deps.mockCaller.generate.mockResolvedValue({
        success: false,
        error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');
    });
  });

  describe('platform 输入', () => {
    const platformProblem: Problem = {
      type: 'platform',
      content: 'https://www.luogu.com.cn/problem/P1000',
      platform: 'luogu',
      problemId: 'P1000',
    };

    it('主 key 命中 → 直接返回 cached: true', async () => {
      deps.mockCache.getByPrimaryKey.mockResolvedValue({
        success: true,
        data: {
          html: '<html>cached</html>',
          validated: true,
          cached: false,
          contentHash: 'hash-cached',
        },
      });

      const result = await orchestrator.solve(platformProblem);

      expect(result.success).toBe(true);
      expect(result.data?.cached).toBe(true);
      expect(result.data?.html).toBe('<html>cached</html>');
      expect(deps.mockCache.getOrCompute).not.toHaveBeenCalled();
    });

    it('主 key 未命中 + 抓取成功 + 验证通过 → 回填主 key', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: { content: '题目内容', platform: 'luogu', problemId: 'P1000' },
      });
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve(platformProblem);

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(deps.mockCache.set).toHaveBeenCalledWith(
        'gesp6:platform:luogu:P1000',
        expect.any(String),
        expect.objectContaining({ validated: true }),
      );
    });

    it('抓取失败 → GESP6_PLATFORM_FETCH_FAILED', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: false,
        error: { code: 'GESP6_PLATFORM_FETCH_FAILED', message: '抓取失败' },
      });

      const result = await orchestrator.solve(platformProblem);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
      expect(deps.mockCache.getOrCompute).not.toHaveBeenCalled();
    });

    it('缺少 platform/problemId → GESP6_INPUT_INVALID', async () => {
      const result = await orchestrator.solve({
        type: 'platform',
        content: 'https://www.luogu.com.cn/problem/P1000',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_INPUT_INVALID');
    });

    it('forceRegenerate=true → 跳过主 key 检查 + getOrCompute 第 4 参数为 true', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: { content: '题目内容', platform: 'luogu', problemId: 'P1000' },
      });
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      await orchestrator.solve(platformProblem, undefined, undefined, true);

      // 主 key 检查被跳过
      expect(deps.mockCache.getByPrimaryKey).not.toHaveBeenCalled();
      // getOrCompute 第 4 参数为 true（第 3 参数为 SampleFingerprint 对象）
      expect(deps.mockCache.getOrCompute).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({ all: expect.any(String), first: expect.any(String) }),
        true,
      );
    });
  });

  describe('image 输入', () => {
    it('识别成功 + 正常流程', async () => {
      deps.mockRecognizer.recognize.mockResolvedValue({
        success: true,
        data: { text: '识别的题目文本' },
      });
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({
        type: 'image',
        content: 'base64data',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(deps.mockRecognizer.recognize).toHaveBeenCalledWith('base64data');
    });

    it('模型不支持图片 → GESP6_MODEL_NOT_SUPPORTED', async () => {
      deps.mockRecognizer.recognize.mockResolvedValue({
        success: false,
        error: { code: 'GESP6_MODEL_NOT_SUPPORTED', message: '不支持图片' },
      });

      const result = await orchestrator.solve({
        type: 'image',
        content: 'base64data',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_MODEL_NOT_SUPPORTED');
      expect(deps.mockCache.getOrCompute).not.toHaveBeenCalled();
    });
  });

  describe('修正循环异常', () => {
    it('修正输出格式不合规 → 降级返回（不消耗修正配额）', async () => {
      deps.mockCaller.generate
        .mockResolvedValueOnce({ success: true, data: { raw: validRaw } })
        .mockResolvedValueOnce({
          success: true,
          data: { raw: 'invalid fix output' },
        });
      deps.mockParser.parseMetaAndHtml
        .mockReturnValueOnce({
          success: true,
          data: { meta: mockMeta, html: validHtml },
        })
        .mockReturnValueOnce({
          success: false,
          error: { code: 'GESP6_LLM_FORMAT_ERROR', message: '格式错误' },
        });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('修正输出格式不合规');
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(2);
    });

    it('修正调用失败（超时）→ 降级返回', async () => {
      deps.mockCaller.generate
        .mockResolvedValueOnce({ success: true, data: { raw: validRaw } })
        .mockResolvedValueOnce({
          success: false,
          error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
        });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('修正调用失败');
    });
  });

  describe('shouldAbort 取消逻辑', () => {
    it('首次验证即通过 → 不进入修正循环 → shouldAbort 未被调用', async () => {
      // 验证通过时根本不进入 fix loop，shouldAbort 不应被调用
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const shouldAbort = vi.fn(() => false);
      const result = await orchestrator.solve(
        { type: 'text', content: '题目内容' },
        shouldAbort,
      );

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      // shouldAbort 仅在 fix loop 内被调用，未进入 fix loop → 0 次
      expect(shouldAbort).not.toHaveBeenCalled();
      // 仅 1 次 LLM 调用（生成）
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(1);
    });

    it('修正循环第 1 轮开始时 shouldAbort=true → 立即返回 GESP6_CANCELLED + 不调用 fix LLM', async () => {
      // 首次生成 + 解析成功 + 首次验证失败 → 进入 fix loop → round 1 检测到取消
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const shouldAbort = vi.fn(() => true);
      const result = await orchestrator.solve(
        { type: 'text', content: '题目内容' },
        shouldAbort,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_CANCELLED');
      // shouldAbort 在 fix loop round 1 开始时被调用 1 次
      expect(shouldAbort).toHaveBeenCalledTimes(1);
      // 仅 1 次 LLM 调用（生成），未发起 fix 调用
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(1);
    });

    it('第 1 轮修正未通过 + 第 2 轮 shouldAbort=true → 返回 GESP6_CANCELLED + 仅 2 次 LLM 调用', async () => {
      // 生成(1) + fix round 1(2) → 仍失败 → round 2 shouldAbort=true 取消
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      // 首次验证 + round 1 修正后验证 → 均失败
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const shouldAbort = vi.fn();
      shouldAbort.mockReturnValueOnce(false).mockReturnValueOnce(true);
      const result = await orchestrator.solve(
        { type: 'text', content: '题目内容' },
        shouldAbort,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_CANCELLED');
      // shouldAbort 在 round 1（false）+ round 2（true）各调用 1 次 = 2 次
      expect(shouldAbort).toHaveBeenCalledTimes(2);
      // 1 次生成 + 1 次 round 1 fix = 2 次 LLM 调用（round 2 取消未调用 fix）
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(2);
    });

    it('shouldAbort 始终 false → 走完整 3 轮修正循环（向后兼容）', async () => {
      // 提供但始终返回 false，行为应与不提供一致：完整跑完 3 轮 fix
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const shouldAbort = vi.fn(() => false);
      const result = await orchestrator.solve(
        { type: 'text', content: '题目内容' },
        shouldAbort,
      );

      // 3 轮 fix 跑完仍未通过 → 降级返回
      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('已修正 3 次');
      // shouldAbort 每轮调用 1 次，共 3 次
      expect(shouldAbort).toHaveBeenCalledTimes(3);
      // 1 次生成 + 3 次 fix = 4 次 LLM 调用
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(4);
    });

    it('未提供 shouldAbort → 行为与提供 false 一致（向后兼容）', async () => {
      // 不传 shouldAbort 参数，应等价于 false（可选参数 ?.() 安全调用）
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      // 不传第二参数
      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('已修正 3 次');
      // 1 次生成 + 3 次 fix = 4 次
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(4);
    });

    it('platform 输入抓取后进入修正循环也应支持 shouldAbort', async () => {
      // 验证 shouldAbort 在 platform 链路下也能传递到 compute
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: { content: '题目内容', platform: 'luogu', problemId: 'P1000' },
      });
      deps.mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: validRaw },
      });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(failValidate);

      const shouldAbort = vi.fn(() => true);
      const result = await orchestrator.solve(
        {
          type: 'platform',
          content: 'https://www.luogu.com.cn/problem/P1000',
          platform: 'luogu',
          problemId: 'P1000',
        },
        shouldAbort,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_CANCELLED');
      expect(shouldAbort).toHaveBeenCalledTimes(1);
      // 1 次生成（未发起 fix）
      expect(deps.mockCaller.generate).toHaveBeenCalledTimes(1);
    });
  });

  describe('Solution 身份字段填充（AD-08，AC-027/FR-029）', () => {
    const platformProblem: Problem = {
      type: 'platform',
      content: 'https://www.luogu.com.cn/problem/P1000',
      platform: 'luogu',
      problemId: 'P1000',
    };

    it('text compute 成功路径 → contentHash=本次请求 hash、sampleFp=all 优先', async () => {
      extractSampleFingerprintMock.mockReturnValue({ all: 'fp-all-1111', first: 'fp-first-1111' });
      deps.mockCaller.generate.mockResolvedValue({ success: true, data: { raw: validRaw } });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({ type: 'text', content: '题目内容' });

      expect(result.success).toBe(true);
      // contentHash = getOrCompute 收到的本次请求 hash（computeContentHash(normalized)）
      const requestHash = deps.mockCache.getOrCompute.mock.calls[0][0];
      expect(result.data?.contentHash).toBe(requestHash);
      expect(result.data?.sampleFp).toBe('fp-all-1111');
    });

    it('text 路径 all 为空字符串 → sampleFp 回退 first', async () => {
      extractSampleFingerprintMock.mockReturnValue({ all: '', first: 'fp-first-2222' });
      deps.mockCaller.generate.mockResolvedValue({ success: true, data: { raw: validRaw } });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({ type: 'text', content: '题目内容' });

      expect(result.data?.sampleFp).toBe('fp-first-2222');
    });

    it('text 路径指纹均为空 → sampleFp 为 undefined', async () => {
      deps.mockCaller.generate.mockResolvedValue({ success: true, data: { raw: validRaw } });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: true,
        data: { meta: mockMeta, html: validHtml },
      });
      deps.mockValidator.validate.mockResolvedValue(passValidate);

      const result = await orchestrator.solve({ type: 'text', content: '题目内容' });

      expect(result.data?.sampleFp).toBeUndefined();
    });

    it('text 降级路径（解析失败 validated=false）→ contentHash 仍填充', async () => {
      deps.mockCaller.generate.mockResolvedValue({ success: true, data: { raw: 'invalid output' } });
      deps.mockParser.parseMetaAndHtml.mockReturnValue({
        success: false,
        error: { code: 'GESP6_LLM_FORMAT_ERROR', message: '格式错误' },
      });

      const result = await orchestrator.solve({ type: 'text', content: '题目内容' });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      const requestHash = deps.mockCache.getOrCompute.mock.calls[0][0];
      expect(result.data?.contentHash).toBe(requestHash);
    });

    it('platform 主 key 命中 → contentHash=缓存携带值、sampleFp=undefined（清除缓存携带的旧值）', async () => {
      deps.mockCache.getByPrimaryKey.mockResolvedValue({
        success: true,
        data: {
          html: '<html>cached</html>',
          validated: true,
          cached: false,
          contentHash: 'hash-primary-1',
          sampleFp: 'stale-fp',
        },
      });

      const result = await orchestrator.solve(platformProblem);

      expect(result.success).toBe(true);
      expect(result.data?.cached).toBe(true);
      expect(result.data?.contentHash).toBe('hash-primary-1');
      expect(result.data?.sampleFp).toBeUndefined();
      expect(deps.mockCache.getOrCompute).not.toHaveBeenCalled();
    });

    it('platform getOrCompute 缓存命中（携带旧 hash）→ contentHash 覆盖为本次请求 hash（Plan B 计费语义，spec §8.8）', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: { content: '题目内容', platform: 'luogu', problemId: 'P1000' },
      });
      deps.mockCache.getOrCompute.mockResolvedValueOnce({
        success: true,
        data: {
          html: '<html>plan-b</html>',
          validated: true,
          cached: true,
          contentHash: 'hash-old',
        },
      });

      const result = await orchestrator.solve(platformProblem);

      const requestHash = deps.mockCache.getOrCompute.mock.calls[0][0];
      expect(result.data?.contentHash).toBe(requestHash);
      expect(result.data?.contentHash).not.toBe('hash-old');
    });
  });
});
