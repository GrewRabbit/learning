// app/lib/ai/services/__tests__/fs-html-cache.test.ts
// FsHtmlCache 单元测试（架构 §5.1 接口）
//
// 与 html-cache.test.ts（内存 LRU）的区别：本测试针对文件系统持久化实现，
// 验证真实磁盘读写、目录创建、分桶结构、inflight 单飞、JSON 损坏容错。
//
// 策略：mkdtempSync 创建隔离临时目录，afterEach 清理；set/getOrCompute 的
// 异步写入用短暂延时等待（fire-and-forget 设计，写入完成后 readFileSync 才可见）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FsHtmlCache } from '../fs-html-cache';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import type { Solution } from '@/app/lib/ai/types';

const SAMPLE_SOLUTION: Solution = {
  html: '<!DOCTYPE html><html><body>test</body></html>',
  validated: true,
  cached: false,
};

/** 等待 fire-and-forget 异步写入落盘 */
function flushWrites(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FsHtmlCache（文件系统持久化）', () => {
  let tmpDir: string;
  let cache: FsHtmlCache;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gesp6-fscache-'));
    cache = new FsHtmlCache({ baseDir: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('构造与目录创建', () => {
    it('构造时自动创建 primary / content 目录', () => {
      expect(existsSync(path.join(tmpDir, 'primary'))).toBe(true);
      expect(existsSync(path.join(tmpDir, 'content'))).toBe(true);
    });

    it('baseDir 已存在时不抛错（幂等）', () => {
      expect(() => new FsHtmlCache({ baseDir: tmpDir })).not.toThrow();
    });
  });

  describe('空缓存读取', () => {
    it('getByPrimaryKey 未命中返回 null', () => {
      const result = cache.getByPrimaryKey('luogu', 'P1000');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('getByContentKey 未命中返回 null', () => {
      const result = cache.getByContentKey('nonexistent-hash');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('buildPrimaryKey', () => {
    it('格式为 gesp6:platform:{platform}:{problemId}', () => {
      expect(cache.buildPrimaryKey('luogu', 'P1000')).toBe(
        'gesp6:platform:luogu:P1000',
      );
      expect(cache.buildPrimaryKey('youdao', '4924')).toBe(
        'gesp6:platform:youdao:4924',
      );
    });
  });

  describe('set + 读取联动', () => {
    it('set 写入主 key 索引 + 内容文件（HTML + meta.json 分桶）', async () => {
      const primaryKey = cache.buildPrimaryKey('luogu', 'P1000');
      const contentHash = 'a1b2c3d4e5f6';

      cache.set(primaryKey, contentHash, SAMPLE_SOLUTION);
      await flushWrites();

      // 主 key 索引文件
      const indexPath = path.join(tmpDir, 'primary', 'luogu_P1000.json');
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      expect(index.contentHash).toBe(contentHash);

      // 内容 HTML（分桶 a1）
      const htmlPath = path.join(tmpDir, 'content', 'a1', `${contentHash}.html`);
      expect(existsSync(htmlPath)).toBe(true);
      expect(readFileSync(htmlPath, 'utf-8')).toBe(SAMPLE_SOLUTION.html);

      // 内容 meta.json
      const metaPath = path.join(tmpDir, 'content', 'a1', `${contentHash}.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.validated).toBe(true);
    });

    it('set 后 getByPrimaryKey 命中返回 cached: true', async () => {
      const primaryKey = cache.buildPrimaryKey('luogu', 'P1000');
      const contentHash = 'b2c3d4e5f6';

      cache.set(primaryKey, contentHash, SAMPLE_SOLUTION);
      await flushWrites();

      const result = cache.getByPrimaryKey('luogu', 'P1000');
      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data?.html).toBe(SAMPLE_SOLUTION.html);
      expect(result.data?.validated).toBe(true);
      expect(result.data?.cached).toBe(true);
    });

    it('set 仅写内容（primaryKey=null）→ getByPrimaryKey 仍返回 null', async () => {
      const contentHash = 'c3d4e5f6';
      cache.set(null, contentHash, SAMPLE_SOLUTION);
      await flushWrites();

      // 内容文件存在
      const result = cache.getByContentKey(contentHash);
      expect(result.data).not.toBeNull();
      // 但主 key 索引未写
      const primaryResult = cache.getByPrimaryKey('luogu', 'P1000');
      expect(primaryResult.data).toBeNull();
    });

    it('warning 字段持久化', async () => {
      const warningSolution: Solution = {
        html: '<html/>',
        validated: false,
        warning: '格式不合规',
        cached: false,
      };
      cache.set(cache.buildPrimaryKey('luogu', 'P1'), 'd4e5f6', warningSolution);
      await flushWrites();

      const result = cache.getByPrimaryKey('luogu', 'P1');
      expect(result.data?.validated).toBe(false);
      expect(result.data?.warning).toBe('格式不合规');
    });
  });

  describe('getOrCompute', () => {
    it('未命中 → 调用 compute → 返回结果', async () => {
      const compute = vi.fn().mockResolvedValue({
        success: true,
        data: { ...SAMPLE_SOLUTION, cached: false },
      });

      const result = await cache.getOrCompute('hash-orc-1', compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe(SAMPLE_SOLUTION.html);
      // 未命中走 compute，cached 字段沿用 compute 返回值（false）
      expect(result.data?.cached).toBe(false);
    });

    it('命中 → 不调用 compute', async () => {
      const compute = vi.fn().mockResolvedValue({
        success: true,
        data: { ...SAMPLE_SOLUTION, cached: false },
      });

      await cache.getOrCompute('hash-orc-2', compute);
      await flushWrites();

      const compute2 = vi.fn().mockResolvedValue({
        success: true,
        data: { ...SAMPLE_SOLUTION, cached: false },
      });
      const result = await cache.getOrCompute('hash-orc-2', compute2);

      expect(compute2).not.toHaveBeenCalled();
      expect(result.data?.cached).toBe(true);
    });

    it('inflight 单飞：并发同 contentHash 只调用一次 compute', async () => {
      const compute = vi.fn().mockImplementation(async () => {
        // 模拟耗时计算，确保并发窗口内第二次调用命中 inflight
        await new Promise((r) => setTimeout(r, 50));
        return { success: true, data: { ...SAMPLE_SOLUTION, cached: false } };
      });

      const [r1, r2] = await Promise.all([
        cache.getOrCompute('hash-orc-3', compute),
        cache.getOrCompute('hash-orc-3', compute),
      ]);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.data?.html).toBe(r2.data?.html);
    });

    it('compute 失败 → 返回失败 + 清理 inflight（下次可重试）', async () => {
      const compute = vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
      });

      const result = await cache.getOrCompute('hash-orc-4', compute);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_TIMEOUT');

      // inflight 已清理，再次调用会重新执行 compute
      const compute2 = vi.fn().mockResolvedValue({
        success: true,
        data: { ...SAMPLE_SOLUTION, cached: false },
      });
      const result2 = await cache.getOrCompute('hash-orc-4', compute2);
      expect(compute2).toHaveBeenCalledTimes(1);
      expect(result2.success).toBe(true);
    });
  });

  describe('容错：JSON 损坏', () => {
    it('主 key 索引文件损坏 → 视为未命中返回 null', async () => {
      const primaryKey = cache.buildPrimaryKey('luogu', 'P1000');
      cache.set(primaryKey, 'e5f6g7', SAMPLE_SOLUTION);
      await flushWrites();

      // 破坏主 key 索引文件
      const indexPath = path.join(tmpDir, 'primary', 'luogu_P1000.json');
      const { writeFileSync } = await import('fs');
      writeFileSync(indexPath, '{ 不是合法 JSON', 'utf-8');

      const result = cache.getByPrimaryKey('luogu', 'P1000');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('内容 meta.json 损坏 → 视为未命中返回 null', async () => {
      const contentHash = 'f6g7h8';
      cache.set(null, contentHash, SAMPLE_SOLUTION);
      await flushWrites();

      // 破坏 meta.json
      const metaPath = path.join(tmpDir, 'content', contentHash.slice(0, 2), `${contentHash}.json`);
      const { writeFileSync } = await import('fs');
      writeFileSync(metaPath, '损坏的内容', 'utf-8');

      const result = cache.getByContentKey(contentHash);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });
});
