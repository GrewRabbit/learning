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

import { existsSync, unlinkSync, rmSync } from 'fs';
import * as os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { FixedLoopOrchestrator } from '@/app/lib/ai/services/orchestrator';
import { htmlParser } from '@/app/lib/ai/services/html-parser';
import { codeValidator } from '@/app/lib/ai/services/code-validator';
import {
  DualKeyHtmlCache,
  computeContentHash,
  type HtmlCache,
} from '@/app/lib/ai/services/html-cache';
import { FsHtmlCache } from '@/app/lib/ai/services/fs-html-cache';
import { extractSampleFingerprint } from '@/app/lib/ai/services/problem-fetchers/types';
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

  describe('样例指纹缓存层跨输入方式命中（spec-sample-fingerprint-cache-v1.1 §7.2）', () => {
    /** 代码块围栏标记（避免与 JS 模板字符串的反引号冲突） */
    const FENCE = '```';

    /**
     * B3614 fetcher 格式（platform 方式 mock fetchProblem 返回此内容）
     * 参考 luogu-fetcher.ts buildProblemMarkdown：## 样例 + ### 样例 N + ``` 无语言标记
     */
    const fetcherMarkdown = [
      '# 【模板】栈',
      '## 题目描述',
      '',
      '请你实现一个栈，支持 push、pop、query 操作。',
      '',
      '## 输入格式',
      '',
      '第一行一个整数 n，接下来 n 行每行一个操作。',
      '',
      '## 输出格式',
      '',
      '对于 query 输出栈顶，pop 空栈输出 Empty，query 空栈输出 Anguei!',
      '',
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      FENCE,
      '7',
      'push 1',
      'push 2',
      'query',
      'pop',
      'query',
      'pop',
      'pop',
      FENCE,
      '',
      '输出：',
      FENCE,
      '2',
      '1',
      'Empty',
      FENCE,
    ].join('\n');

    /**
     * B3614 用户手输格式（text 方式）
     * 与 fetcher 格式的差异：标题带题号、样例章节名不同（## 输入输出样例 #1）、
     * 代码块带语言标记（```cpp）→ 全文 hash 不同但样例指纹相同
     */
    const userTextMarkdown = [
      '# B3614 【模板】栈',
      '',
      '## 输入输出样例 #1',
      '',
      '### 输入 #1',
      FENCE + 'cpp',
      '7',
      'push 1',
      'push 2',
      'query',
      'pop',
      'query',
      'pop',
      'pop',
      FENCE,
      '',
      '### 输出 #1',
      FENCE,
      '2',
      '1',
      'Empty',
      FENCE,
    ].join('\n');

    /** platform 提交参数（B3614） */
    const platformProblem = {
      type: 'platform' as const,
      content: 'https://www.luogu.com.cn/problem/B3614',
      platform: 'luogu',
      problemId: 'B3614',
    };

    /** 验证两种输入方式样例指纹相同但全文 hash 不同（前置断言，AC-001） */
    function expectSameSampleFingerprintButDifferentContentHash(): void {
      const fetcherSampleFp = extractSampleFingerprint(fetcherMarkdown);
      const userSampleFp = extractSampleFingerprint(userTextMarkdown);
      expect(fetcherSampleFp, 'fetcher 格式应能提取样例指纹').not.toBe('');
      expect(userSampleFp, '用户手输格式应能提取样例指纹').not.toBe('');
      expect(fetcherSampleFp, '两种格式样例指纹应相同').toBe(userSampleFp);
      const fetcherHash = computeContentHash(fetcherMarkdown);
      const userHash = computeContentHash(userTextMarkdown);
      expect(fetcherHash, '两种格式全文 hash 应不同').not.toBe(userHash);
    }

    it('用例1：text 生成 → platform 命中 sample 索引（cached=true，未调 LLM）', async () => {
      // 前置断言：两种格式样例指纹相同但全文不同（AC-001）
      expectSameSampleFingerprintButDifferentContentHash();

      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      // 第一次：text 方式提交（用户手输格式）→ 生成 + 写 sample 索引（AC-006）
      const textResult = await orchestrator.solve({
        type: 'text',
        content: userTextMarkdown,
      });
      expect(textResult.success).toBe(true);
      expect(textResult.data?.validated).toBe(true);
      expect(textResult.data?.cached).toBe(false);
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);

      // 验证 sample 索引已写入（AC-003）
      const userSampleFp = extractSampleFingerprint(userTextMarkdown);
      const sampleIndex = cache.getBySampleFingerprint(userSampleFp);
      expect(sampleIndex.success).toBe(true);
      expect(sampleIndex.data, 'sample 索引应已写入').not.toBeNull();

      // 第二次：platform 方式提交同题（fetcher 格式，全文不同但样例指纹相同）
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: {
          content: fetcherMarkdown,
          platform: 'luogu',
          problemId: 'B3614',
        },
      });

      const platformResult = await orchestrator.solve(platformProblem);

      // 验证命中 sample 索引（AC-009、AC-010、AC-013）
      expect(platformResult.success).toBe(true);
      expect(platformResult.data?.cached, '应命中 sample 索引').toBe(true);
      expect(platformResult.data?.validated).toBe(true);
      // LLM 仍只调用 1 次（第二次命中 sample 索引未调 LLM）
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
      // fetchProblem 被调用 1 次（platform 方式抓取）
      expect(fetchProblem).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('用例2：platform 生成 → text 命中 sample 索引（cached=true，未调 LLM）', async () => {
      // 前置断言：两种格式样例指纹相同但全文不同（AC-001）
      expectSameSampleFingerprintButDifferentContentHash();

      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });
      vi.mocked(fetchProblem).mockResolvedValue({
        success: true,
        data: {
          content: fetcherMarkdown,
          platform: 'luogu',
          problemId: 'B3614',
        },
      });

      // 第一次：platform 方式提交（fetcher 格式）→ 生成 + 写 sample 索引 + 回填 primary（AC-006、AC-018）
      const platformResult = await orchestrator.solve(platformProblem);
      expect(platformResult.success).toBe(true);
      expect(platformResult.data?.validated).toBe(true);
      expect(platformResult.data?.cached).toBe(false);
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);

      // 验证 sample 索引已写入（AC-003）
      const fetcherSampleFp = extractSampleFingerprint(fetcherMarkdown);
      const sampleIndex = cache.getBySampleFingerprint(fetcherSampleFp);
      expect(sampleIndex.success).toBe(true);
      expect(sampleIndex.data, 'sample 索引应已写入').not.toBeNull();

      // 第二次：text 方式提交同题（用户手输格式，全文不同但样例指纹相同）
      const textResult = await orchestrator.solve({
        type: 'text',
        content: userTextMarkdown,
      });

      // 验证命中 sample 索引（AC-009、AC-010、AC-013）
      expect(textResult.success).toBe(true);
      expect(textResult.data?.cached, '应命中 sample 索引').toBe(true);
      expect(textResult.data?.validated).toBe(true);
      // LLM 仍只调用 1 次
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('用例3：sample 索引失效自愈（content 文件缺失 → 降级 compute → 覆盖失效索引）', async () => {
      // 使用 FsHtmlCache 在临时目录下（用例需要文件系统操作来模拟 content 文件缺失）
      const tmpDir = path.join(os.tmpdir(), `gesp6-test-${Date.now()}`);
      const fsCache = new FsHtmlCache({ baseDir: tmpDir });
      const fsOrchestrator = new FixedLoopOrchestrator(
        mockCaller,
        htmlParser,
        codeValidator,
        fsCache,
        mockRecognizer,
      );

      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      // 第一次：text 方式提交 → 生成 + 写 content 文件 + 写 sample 索引
      const first = await fsOrchestrator.solve({
        type: 'text',
        content: userTextMarkdown,
      });
      expect(first.success).toBe(true);
      expect(first.data?.validated).toBe(true);
      expect(first.data?.cached).toBe(false);
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);

      // 获取 sample 索引指向的 contentHash
      const userSampleFp = extractSampleFingerprint(userTextMarkdown);

      // 等待 sample 索引写入并可读（FsHtmlCache 写操作为 fire-and-forget 异步，
      // 文件创建后内容可能尚未写入，需轮询 getBySampleFingerprint 确保可读取）
      await vi.waitFor(() => {
        const idx = fsCache.getBySampleFingerprint(userSampleFp);
        expect(idx.success, 'sample 索引读取应成功').toBe(true);
        expect(idx.data, 'sample 索引应已写入且可读').not.toBeNull();
      }, { timeout: 5_000, interval: 50 });

      const sampleIndex = fsCache.getBySampleFingerprint(userSampleFp);
      expect(sampleIndex.success).toBe(true);
      expect(sampleIndex.data).not.toBeNull();
      const contentHash = sampleIndex.data!.contentHash;

      // 等待 content 文件写入并可读（同理，轮询 getByContentKey 确保可读取）
      await vi.waitFor(() => {
        const content = fsCache.getByContentKey(contentHash);
        expect(content.success, 'content 读取应成功').toBe(true);
        expect(content.data, 'content 文件应已写入且可读').not.toBeNull();
      }, { timeout: 5_000, interval: 50 });

      const bucketDir = path.join(tmpDir, 'content', contentHash.slice(0, 2));
      const htmlPath = path.join(bucketDir, `${contentHash}.html`);
      const metaPath = path.join(bucketDir, `${contentHash}.json`);

      // 手动删除 content 文件（模拟 sample 索引失效：sample 索引指向的 content 文件缺失）
      unlinkSync(htmlPath);
      unlinkSync(metaPath);
      expect(existsSync(htmlPath), '删除后 HTML 文件应不存在').toBe(false);

      // 第二次：相同 text 提交 → content miss → sample 命中但 content miss → 降级走 compute → 覆盖失效索引（AC-020）
      const second = await fsOrchestrator.solve({
        type: 'text',
        content: userTextMarkdown,
      });

      // 验证降级走 compute（LLM 被再次调用）
      expect(second.success).toBe(true);
      expect(second.data?.validated).toBe(true);
      expect(second.data?.cached, '降级走 compute 应 cached=false').toBe(false);
      expect(mockCaller.generate, 'LLM 应被调用 2 次（第二次降级 compute）').toHaveBeenCalledTimes(2);

      // 验证 content 文件恢复（compute 成功后重新写入）
      // writeContentFiles 与 writeSampleIndex 均为 fire-and-forget 异步，需轮询确认文件已写入
      await vi.waitFor(() => {
        expect(existsSync(htmlPath), 'content HTML 文件应已恢复').toBe(true);
        expect(existsSync(metaPath), 'content meta 文件应已恢复').toBe(true);
      }, { timeout: 5_000, interval: 50 });

      // 验证 sample 索引仍存在且 contentHash 正确（自愈后覆盖）
      // writeSampleIndex 为 fire-and-forget 异步，需轮询 getBySampleFingerprint 确认可读
      await vi.waitFor(() => {
        const idx = fsCache.getBySampleFingerprint(userSampleFp);
        expect(idx.success, '自愈后 sample 索引读取应成功').toBe(true);
        expect(idx.data, '自愈后 sample 索引应已写入且可读').not.toBeNull();
        expect(idx.data?.contentHash, '自愈后 sample 索引 contentHash 应正确').toBe(contentHash);
      }, { timeout: 5_000, interval: 50 });

      // 第三次：相同 text 提交 → 此时 content 文件已恢复 → 应命中 content 缓存（AC-004）
      const third = await fsOrchestrator.solve({
        type: 'text',
        content: userTextMarkdown,
      });
      expect(third.data?.cached, '自愈后第三次提交应命中 content 缓存').toBe(true);
      expect(mockCaller.generate, 'LLM 仍只调用 2 次（第三次命中缓存）').toHaveBeenCalledTimes(2);

      // 清理临时目录
      rmSync(tmpDir, { recursive: true, force: true });
    }, 30_000);
  });

  describe('shouldAbort 取消逻辑（真实 g++ 编译链路）', () => {
    it('生成错误代码 + g++ 编译通过但样例失败 → fix loop 第 1 轮 shouldAbort=true → 返回 GESP6_CANCELLED', async () => {
      // 真实 g++ 链路验证：wrongCode 编译通过但样例失败（1 2 → -1 ≠ 3）
      // 进入 fix loop → round 1 检测到取消 → 不调用 fix LLM → 返回 cancelled
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(wrongCode) } as LLMOutput,
      });

      let abortCalled = 0;
      const shouldAbort = (): boolean => {
        abortCalled += 1;
        return true; // 首次调用即返回 true
      };

      const result = await orchestrator.solve(
        { type: 'text', content: '给定两个整数 a 和 b，输出它们的和。' },
        shouldAbort,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_CANCELLED');
      expect(abortCalled, 'shouldAbort 应在 fix loop round 1 被调用 1 次').toBe(1);
      // 仅 1 次 LLM 调用（生成），未发起 fix 调用
      expect(mockCaller.generate).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('取消后不写缓存：相同 content 二次提交 → 重新走 compute（cached=false）', async () => {
      // 验证取消结果不写入 HtmlCache（避免缓存错误/取消结果）
      // 第一次：wrongCode + shouldAbort=true → 取消，不写缓存
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(wrongCode) } as LLMOutput,
      });

      const first = await orchestrator.solve(
        { type: 'text', content: '给定两个整数 a 和 b，输出它们的和。' },
        () => true,
      );
      expect(first.success).toBe(false);
      expect(first.error?.code).toBe('GESP6_CANCELLED');

      // 第二次：相同 content，不取消 → 应重新走 compute（未命中缓存）
      // 改 mock 返回正确代码
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(correctCode) } as LLMOutput,
      });

      const second = await orchestrator.solve({
        type: 'text',
        content: '给定两个整数 a 和 b，输出它们的和。',
      });
      expect(second.success).toBe(true);
      expect(second.data?.cached, '取消结果未写缓存，应重新 compute').toBe(false);
      expect(second.data?.validated).toBe(true);
      // LLM 调用 2 次：第一次生成（取消）+ 第二次生成（重新 compute）
      expect(mockCaller.generate).toHaveBeenCalledTimes(2);
    }, 30_000);

    it('第 1 轮修正未通过 + 第 2 轮 shouldAbort=true → 返回 GESP6_CANCELLED + 2 次 LLM 调用', async () => {
      // 生成错误代码 → g++ 验证失败 → round 1 修正仍错误（wrongCode）→ round 2 取消
      // 注意：每次 generate 都返回 wrongCode（mockResolvedValue 不重置）
      mockCaller.generate.mockResolvedValue({
        success: true,
        data: { raw: buildRaw(wrongCode) } as LLMOutput,
      });

      let abortCalled = 0;
      const shouldAbort = (): boolean => {
        abortCalled += 1;
        // round 1 → false（继续修正），round 2 → true（取消）
        return abortCalled > 1;
      };

      const result = await orchestrator.solve(
        { type: 'text', content: '给定两个整数 a 和 b，输出它们的和。' },
        shouldAbort,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_CANCELLED');
      expect(abortCalled, 'shouldAbort 应被调用 2 次（round 1 + round 2）').toBe(2);
      // 1 次生成 + 1 次 round 1 fix = 2 次 LLM 调用（round 2 取消未调用 fix）
      expect(mockCaller.generate).toHaveBeenCalledTimes(2);
    }, 30_000);
  });
});
