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
    getByPrimaryKey: vi.fn(() => ({ success: true, data: null })) as MockedFunction<HtmlCache['getByPrimaryKey']>,
    getByContentKey: vi.fn(() => ({ success: true, data: null })) as MockedFunction<HtmlCache['getByContentKey']>,
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
      deps.mockCache.getByPrimaryKey.mockReturnValue({
        success: true,
        data: { html: '<html>cached</html>', validated: true, cached: false },
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
});
