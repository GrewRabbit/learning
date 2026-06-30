// tests/integration-tests/orchestrator.test.ts
// Orchestrator 集成测试（testing-standards.md §三）
//
// 与单元测试（app/lib/ai/services/__tests__/orchestrator.test.ts）的区别：
// - 单元测试：5 个依赖全 mock，仅验证编排逻辑（调用次数、分支选择）
// - 集成测试：仅 mock LLM（避免真实 API 调用）+ ImageRecognizer + fetchProblem，
//   保留真实 HtmlParser / CodeValidator（真实 g++ 编译）/ HtmlCache（真实内存 LRU）
//
// 验证目标：Orchestrator 串联 HtmlParser→CodeValidator→HtmlCache 的完整链路协作正确性，
// 这是单元测试全 mock 无法覆盖的"组合后是否正确"盲区。
//
// g++ 依赖：需系统安装 g++（CI ubuntu-latest 自带）。g++ 不可用时用例会失败。

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { FixedLoopOrchestrator } from '@/app/lib/ai/services/orchestrator';
import { htmlParser } from '@/app/lib/ai/services/html-parser';
import { codeValidator } from '@/app/lib/ai/services/code-validator';
import {
  DualKeyHtmlCache,
  computeContentHash,
  type HtmlCache,
} from '@/app/lib/ai/services/html-cache';
import type {
  LLMCaller,
} from '@/app/lib/ai/services/llm-caller';
import type { ImageRecognizer } from '@/app/lib/ai/services/image-recognizer';
import type { LLMOutput } from '@/app/lib/ai/types';

// mock fs/promises（Orchestrator.loadSkillPrompt/loadKnowledgeBase 依赖 readFile，
// 集成测试不验证 prompt 文件加载，返回空字符串避免文件依赖）
// 重要：必须用 partial mock 保留 mkdtemp/rm/writeFile，否则真实 CodeValidator
// 无法创建临时目录/写入源码/清理（vi.mock 工厂会覆盖整个模块）
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue(''),
  };
});

// mock problem-fetchers（避免真实网络请求洛谷/有道，platform 场景注入虚拟题目）
vi.mock('@/app/lib/ai/services/problem-fetchers', () => ({
  fetchProblem: vi.fn(),
}));

import { fetchProblem } from '@/app/lib/ai/services/problem-fetchers';

/** A+B 正确代码（g++ 编译通过 + 样例通过） */
const correctCode =
  '#include <iostream>\n' +
  'int main() {\n' +
  '  int a, b;\n' +
  '  std::cin >> a >> b;\n' +
  '  std::cout << a + b;\n' +
  '  return 0;\n' +
  '}';

/** A+B 错误代码（编译通过但样例失败：减法而非加法，1 2 → -1 ≠ 3） */
const wrongCode = correctCode.replace('a + b', 'a - b');

/** 构造 LLM 原始输出（<<<META>>>{json}<<<HTML>>>html 双段格式，供真实 HtmlParser 解析） */
function buildRaw(code: string, html = '<!DOCTYPE html><html></html>'): string {
  const meta = {
    code,
    samples: [{ input: '1 2', expectedOutput: '3' }],
  };
  return `<<<META>>>${JSON.stringify(meta)}<<<HTML>>>${html}`;
}

/** 构造 mock LLMCaller（仅 mock generate，返回预设 raw 输出） */
function createMockCaller(): { generate: MockedFunction<LLMCaller['generate']> } {
  return {
    generate: vi.fn() as MockedFunction<LLMCaller['generate']>,
  };
}

/** 构造 mock ImageRecognizer */
function createMockRecognizer(): { recognize: MockedFunction<ImageRecognizer['recognize']> } {
  return {
    recognize: vi.fn() as MockedFunction<ImageRecognizer['recognize']>,
  };
}

describe('Orchestrator 集成测试（真实 HtmlParser + g++ CodeValidator + HtmlCache）', () => {
  let mockCaller: ReturnType<typeof createMockCaller>;
  let mockRecognizer: ReturnType<typeof createMockRecognizer>;
  let cache: HtmlCache;
  let orchestrator: FixedLoopOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaller = createMockCaller();
    mockRecognizer = createMockRecognizer();
    // 每个用例独立缓存实例，避免用例间缓存污染
    cache = new DualKeyHtmlCache();
    orchestrator = new FixedLoopOrchestrator(
      mockCaller,
      htmlParser,        // 真实 HtmlParser
      codeValidator,     // 真实 CodeValidator（调用系统 g++）
      cache,             // 真实 DualKeyHtmlCache（内存 LRU）
      mockRecognizer,
    );
  });

  describe('text 输入完整链路', () => {
    it('生成正确代码 → 真实 g++ 编译通过 → validated: true', async () => {
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '给定两个整数 a 和 b，输出它们的和。',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(result.data?.cached).toBe(false);
      // 仅生成阶段调用 1 次 LLM（未触发修正循环）
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('首次代码错误 → 修正循环修正后通过 → validated: true', async () => {
      // 第 1 次：错误代码（减法），第 2 次：修正为正确代码（加法）
      mockCaller.generate
        .mockResolvedValueOnce({
          success: true,
          data: { raw: buildRaw(wrongCode) } as LLMOutput,
        })
        .mockResolvedValueOnce({
          success: true,
          data: { raw: buildRaw(correctCode) } as LLMOutput,
        });

      const result = await orchestrator.solve({
        type: 'text',
        content: '给定两个整数 a 和 b，输出它们的和。',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      // 1 次生成 + 1 次修正 = 2 次 LLM 调用
      expect(mockCaller.generate).toHaveBeenCalledTimes(2);
    }, 30_000);

    it('相同 text 输入二次调用 → 命中内容缓存 cached: true（不调用 LLM）', async () => {
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      const problem = {
        type: 'text' as const,
        content: '给定两个整数 a 和 b，输出它们的和。',
      };

      // 第一次：生成 + 缓存写入
      const first = await orchestrator.solve(problem);
      expect(first.data?.cached).toBe(false);
      expect(first.data?.validated).toBe(true);

      // 第二次：相同内容（标准化后 hash 一致）→ 命中内容缓存
      const second = await orchestrator.solve(problem);
      expect(second.data?.cached).toBe(true);
      expect(second.data?.validated).toBe(true);
      // LLM 仍只调用 1 次（第二次命中缓存未调用）
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
    }, 30_000);
  });

  describe('platform 输入完整链路', () => {
    const platformProblem = {
      type: 'platform' as const,
      content: 'https://www.luogu.com.cn/problem/P1000',
      platform: 'luogu',
      problemId: 'P1000',
    };

    it('抓取 → g++ 通过 → 主 key 回填 → 二次命中主 key cached: true', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: {
          content: '给定两个整数 a 和 b，输出它们的和。',
          platform: 'luogu',
          problemId: 'P1000',
        },
      });
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      // 第一次：抓取 + 生成 + 验证 + 主 key 回填
      const first = await orchestrator.solve(platformProblem);
      expect(first.success).toBe(true);
      expect(first.data?.validated).toBe(true);
      expect(first.data?.cached).toBe(false);
      expect(fetchProblem).toHaveBeenCalledTimes(1);

      // 第二次：主 key 命中 → 不再抓取、不再调用 LLM
      const second = await orchestrator.solve(platformProblem);
      expect(second.data?.cached).toBe(true);
      expect(second.data?.validated).toBe(true);
      // fetchProblem 仍只调用 1 次（第二次主 key 命中未抓取）
      expect(fetchProblem).toHaveBeenCalledTimes(1);
      // LLM 仍只调用 1 次
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('主 key 未命中 + 抓取失败 → GESP6_PLATFORM_FETCH_FAILED', async () => {
      vi.mocked(fetchProblem).mockResolvedValue({
        success: false,
        error: { code: 'GESP6_PLATFORM_FETCH_FAILED', message: '网络错误' },
      });

      const result = await orchestrator.solve(platformProblem);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
      // 抓取失败不应触发 LLM 调用
      expect(mockCaller.generate).not.toHaveBeenCalled();
    });
  });

  describe('LLM 输出格式与真实 HtmlParser 协作', () => {
    it('LLM 输出缺 META 标记 → 真实 HtmlParser 解析失败 → 格式重试 → 降级返回', async () => {
      // 两次都返回无 META 标记的输出（触发格式重试 1 次后仍失败 → 降级）
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: '这是一段没有标记的纯文本输出' } as LLMOutput,
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('格式不合规');
      // 1 次生成 + 1 次格式重试 = 2 次
      expect(mockCaller.generate).toHaveBeenCalledTimes(2);
    }, 30_000);

    it('LLM 输出 META JSON 缺 code 字段 → 真实 HtmlParser 解析失败', async () => {
      // META JSON 缺 code 字段（HtmlParser.parseMeta 返回 null）
      const invalidMetaRaw = '<<<META>>>{"samples":[]}<<<HTML>>><html></html>';
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: invalidMetaRaw } as LLMOutput,
      });

      const result = await orchestrator.solve({
        type: 'text',
        content: '题目内容',
      });

      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toContain('格式不合规');
    }, 30_000);
  });

  describe('并发集成（P1：验证 llmLimiter + compileLimiter 协同不死锁）', () => {
    // 验证目标：3 个并发 solve 请求（不同内容避免缓存命中），
    // 全部成功完成，不因 llmLimiter（max=3）/ compileLimiter（max=2）排队而死锁或超时
    it('3 个并发 text 请求 → 全部成功 + 全部 validated', async () => {
      // 3 个不同题目（不同 content → 不同 contentHash → 不命中缓存）
      const problems = [
        {
          type: 'text' as const,
          content: '题目 A：给定两个整数 a 和 b，输出它们的和。',
        },
        {
          type: 'text' as const,
          content: '题目 B：给定两个整数 a 和 b，输出它们的和。',
        },
        {
          type: 'text' as const,
          content: '题目 C：给定两个整数 a 和 b，输出它们的和。',
        },
      ];

      // mock LLM：每次返回正确代码（A+B 通过）
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      // 并发发起 3 个 solve
      const results = await Promise.all(
        problems.map((p) => orchestrator.solve(p)),
      );

      // 全部成功
      expect(results.every((r) => r.success)).toBe(true);
      // 全部 validated
      expect(results.every((r) => r.data?.validated === true)).toBe(true);
      // 全部非缓存（不同 content → 不同 hash）
      expect(results.every((r) => r.data?.cached === false)).toBe(true);
      // LLM 调用 3 次（每个 solve 1 次，未触发修正循环）
      expect(mockCaller.generate).toHaveBeenCalledTimes(3);
    }, 30_000);

    it('2 个并发 platform 请求（不同平台）→ 全部成功', async () => {
      const problems = [
        {
          type: 'platform' as const,
          content: 'https://www.luogu.com.cn/problem/P1000',
          platform: 'luogu',
          problemId: 'P1000',
        },
        {
          type: 'platform' as const,
          content: 'https://www.luogu.com.cn/problem/P1001',
          platform: 'luogu',
          problemId: 'P1001',
        },
      ];

      // mock 不同平台题目抓取
      vi.mocked(fetchProblem)
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: '题目 A：给定两个整数 a 和 b，输出它们的和。',
            platform: 'luogu',
            problemId: 'P1000',
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: '题目 B：给定两个整数 a 和 b，输出它们的和。',
            platform: 'luogu',
            problemId: 'P1001',
          },
        });

      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      const results = await Promise.all(
        problems.map((p) => orchestrator.solve(p)),
      );

      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => r.data?.validated === true)).toBe(true);
      // 抓取 2 次（不同 problemId）
      expect(fetchProblem).toHaveBeenCalledTimes(2);
      // LLM 调用 2 次
      expect(mockCaller.generate).toHaveBeenCalledTimes(2);
    }, 30_000);
  });
});
