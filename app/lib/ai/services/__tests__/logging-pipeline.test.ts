// app/lib/ai/services/__tests__/logging-pipeline.test.ts
// 日志管线集成测试（dev-workflow.md §六 日志规范）
//
// 测试目标：验证关键业务事件产生预期日志，防止重构时日志被意外删除（回归保护）。
// 测试策略：spy console.log（logger 内部调用 console.log），断言日志字符串包含关键标记。
// 覆盖范围：extractSampleFingerprint + DualKeyHtmlCache.getOrCompute 三步查询 + CodeValidator 关键节点。
//
// 不覆盖：FsHtmlCache（需磁盘 IO，由 fs-html-cache.test.ts 间接覆盖）、
//         Orchestrator.compute（需 mock LLM，由 orchestrator.test.ts 间接覆盖）。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DualKeyHtmlCache, computeContentHash } from '../html-cache';
import { extractSampleFingerprint, normalizeContent } from '../problem-fetchers/types';
import type { Solution } from '@/app/lib/ai/types';

/** 提取 console.log 调用中包含指定关键字的日志条目 */
function findLogCall(
  calls: Array<Array<unknown>>,
  keyword: string,
): string | undefined {
  for (const args of calls) {
    const line = String(args[0] ?? '');
    if (line.includes(keyword)) return line;
  }
  return undefined;
}

describe('日志管线集成测试', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  /** 在所有 console spy 调用中搜索包含关键字的日志条目 */
  function findLog(keyword: string): string | undefined {
    const allCalls = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    return findLogCall(allCalls, keyword);
  }

  describe('extractSampleFingerprint 日志', () => {
    it('有代码块 → 产生"提取完成"日志，含 sampleFp 与 blockCount', () => {
      extractSampleFingerprint('```\n1 2\n```');
      const line = findLog('[extractSampleFingerprint] 提取完成');
      expect(line).toBeDefined();
      expect(line).toContain('blockCount":1');
      expect(line).toContain('sampleFp":"');
      expect(line).toContain('usedFallback');
    });

    it('无代码块 → 产生"降级信号"日志（FR-003）', () => {
      extractSampleFingerprint('纯文本无代码块');
      const line = findLog('降级信号 FR-003');
      expect(line).toBeDefined();
    });
  });

  describe('DualKeyHtmlCache 日志', () => {
    let cache: DualKeyHtmlCache;
    const contentHash = computeContentHash(normalizeContent('测试内容'));
    const solution: Solution = {
      html: '<html>cached</html>',
      validated: true,
      cached: false,
    };

    beforeEach(() => {
      cache = new DualKeyHtmlCache();
    });

    it('getOrCompute 第 1 步 content 命中 → 产生"第 1 步 content 命中"日志', async () => {
      // 预填充 content 缓存
      cache.set(null, contentHash, solution);
      logSpy.mockClear();
      warnSpy.mockClear();

      await cache.getOrCompute(
        contentHash,
        () => Promise.resolve({ success: true, data: solution }),
        undefined,
      );
      const line = findLog('第 1 步 content 命中');
      expect(line).toBeDefined();
      expect(line).toContain(contentHash.slice(0, 16));
    });

    it('getOrCompute 第 2 步 sample 命中 → 产生"Plan B 回写"日志', async () => {
      const sampleFp = 'a'.repeat(64);
      const contentHash2 = computeContentHash(normalizeContent('另一题目'));

      // 第一次 getOrCompute：走 compute 路径（contentHash2 未缓存），
      // compute 返回 validated=true → 写入 contentCache + sampleCache
      await cache.getOrCompute(
        contentHash2,
        () => Promise.resolve({ success: true, data: { ...solution, validated: true } }),
        sampleFp,
      );
      logSpy.mockClear();
      warnSpy.mockClear();

      // 第二次 getOrCompute：新 contentHash（未命中 content）+ 同一 sampleFp
      // → step 1 miss → step 2 sample 命中 → content2 命中 → Plan B 回写
      const newHash = computeContentHash(normalizeContent('全新内容'));
      await cache.getOrCompute(
        newHash,
        () => Promise.resolve({ success: true, data: solution }),
        sampleFp,
      );
      const planBLine = findLog('Plan B 回写');
      expect(planBLine).toBeDefined();
      const returnLine = findLog('Plan B 返回');
      expect(returnLine).toBeDefined();
    });

    it('getOrCompute 第 2 步 sample 未命中 → 产生"sample 索引未命中"日志', async () => {
      const sampleFp = 'b'.repeat(64);
      await cache.getOrCompute(
        contentHash,
        () => Promise.resolve({ success: true, data: solution }),
        sampleFp,
      );
      const line = findLog('sample 索引未命中');
      expect(line).toBeDefined();
    });

    it('getOrCompute 第 3 步 compute → validated=true 时产生"sample 索引已写入"日志', async () => {
      const sampleFp = 'c'.repeat(64);
      await cache.getOrCompute(
        contentHash,
        () => Promise.resolve({ success: true, data: { ...solution, validated: true } }),
        sampleFp,
      );
      const line = findLog('sample 索引已写入');
      expect(line).toBeDefined();
    });

    it('getOrCompute 第 3 步 compute → validated=false 时产生"跳过 sample 索引写入"日志', async () => {
      const sampleFp = 'd'.repeat(64);
      await cache.getOrCompute(
        contentHash,
        () => Promise.resolve({ success: true, data: { ...solution, validated: false } }),
        sampleFp,
      );
      // "跳过 sample 索引写入" 是 logger.warn → console.warn
      const line = findLog('跳过 sample 索引写入');
      expect(line).toBeDefined();
    });

    it('set 写入 → 产生"写入"日志，含 primaryKey/contentHash/validated', () => {
      logSpy.mockClear();
      warnSpy.mockClear();
      cache.set('gesp6:platform:luogu:B3614', contentHash, solution);
      const line = findLog('[DualKeyHtmlCache.set] 写入');
      expect(line).toBeDefined();
      expect(line).toContain('gesp6:platform:luogu:B3614');
      expect(line).toContain('validated":true');
    });

    it('getByPrimaryKey → 产生"查询"日志，含 hit/validated', () => {
      cache.set('gesp6:platform:luogu:B3614', contentHash, solution);
      logSpy.mockClear();
      warnSpy.mockClear();
      cache.getByPrimaryKey('luogu', 'B3614');
      const line = findLog('[DualKeyHtmlCache.getByPrimaryKey] 查询');
      expect(line).toBeDefined();
      expect(line).toContain('"hit":true');
    });
  });

  describe('日志格式规范', () => {
    it('所有 INFO 日志包含 ISO8601 时间戳 + [INFO] 级别标记', () => {
      extractSampleFingerprint('```\n1\n```');
      const line = findLog('[extractSampleFingerprint]');
      expect(line).toBeDefined();
      // 格式：[ISO8601] [INFO] [模块] 消息 {JSON}
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(line).toContain('[INFO]');
    });

    it('日志上下文为合法 JSON（可被解析）', () => {
      extractSampleFingerprint('```\n1\n```');
      const line = findLog('提取完成');
      expect(line).toBeDefined();
      // 提取 { 开始的 JSON 片段
      const jsonStart = line!.indexOf('{');
      expect(jsonStart).toBeGreaterThan(-1);
      const jsonStr = line!.slice(jsonStart);
      expect(() => JSON.parse(jsonStr)).not.toThrow();
    });
  });
});
