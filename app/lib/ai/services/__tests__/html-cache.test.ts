// app/lib/ai/services/__tests__/html-cache.test.ts
// HtmlCache 单元测试（架构 §5.1 接口 + §7.1 双 key + §5.1 注释单飞）
// 纯内存测试，无需 mock

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DualKeyHtmlCache, htmlCache, computeContentHash } from '../html-cache';
import type { Solution } from '@/app/lib/ai/types';

describe('DualKeyHtmlCache', () => {
  let cache: DualKeyHtmlCache;

  beforeEach(() => {
    cache = new DualKeyHtmlCache();
  });

  const solution: Solution = {
    html: '<html></html>',
    validated: true,
    cached: false,
  };

  describe('主 key', () => {
    it('set 后 getByPrimaryKey 命中', () => {
      const primaryKey = cache.buildPrimaryKey('luogu', 'P11447');
      cache.set(primaryKey, 'hash123', solution);
      const result = cache.getByPrimaryKey('luogu', 'P11447');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(solution);
    });

    it('未写入返回 null', () => {
      const result = cache.getByPrimaryKey('luogu', 'P99999');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('buildPrimaryKey 格式正确（gesp6:platform:{platform}:{problemId}）', () => {
      expect(cache.buildPrimaryKey('luogu', 'P11447')).toBe(
        'gesp6:platform:luogu:P11447',
      );
      expect(cache.buildPrimaryKey('youdao', '7997')).toBe(
        'gesp6:platform:youdao:7997',
      );
    });
  });

  describe('内容 key', () => {
    it('set 后 getByContentKey 命中', () => {
      cache.set(null, 'hash123', solution);
      const result = cache.getByContentKey('hash123');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(solution);
    });

    it('未写入返回 null', () => {
      const result = cache.getByContentKey('nonexistent');
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('set 行为', () => {
    it('primaryKey=null 仅写 contentCache（text/image 输入）', () => {
      cache.set(null, 'hash123', solution);
      expect(cache.getByContentKey('hash123').data).toEqual(solution);
      // 主 key 未写入
      expect(cache.getByPrimaryKey('luogu', 'P1').data).toBeNull();
    });

    it('primaryKey 非 null 同时写 primaryCache + contentCache（platform 输入）', () => {
      const primaryKey = cache.buildPrimaryKey('luogu', 'P1');
      cache.set(primaryKey, 'hash123', solution);
      expect(cache.getByPrimaryKey('luogu', 'P1').data).toEqual(solution);
      expect(cache.getByContentKey('hash123').data).toEqual(solution);
    });
  });

  describe('getOrCompute', () => {
    it('缓存命中时不调用 compute', async () => {
      cache.set(null, 'hash123', solution);
      const compute = vi.fn(async () => ({ success: true, data: solution }));
      const result = await cache.getOrCompute('hash123', compute);
      expect(compute).not.toHaveBeenCalled();
      expect(result.data).toEqual(solution);
    });

    it('缓存未命中时调用 compute 并写入内容 key', async () => {
      const compute = vi.fn(async () => ({ success: true, data: solution }));
      const result = await cache.getOrCompute('hash123', compute);
      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual(solution);
      // 二次查询命中缓存（不再调用 compute）
      const compute2 = vi.fn(async () => ({ success: true, data: solution }));
      const result2 = await cache.getOrCompute('hash123', compute2);
      expect(compute2).not.toHaveBeenCalled();
      expect(result2.data).toEqual(solution);
    });

    it('单飞：相同 contentHash 并发复用同一 Promise', async () => {
      const compute = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { success: true, data: solution };
      });
      const [r1, r2, r3] = await Promise.all([
        cache.getOrCompute('hash123', compute),
        cache.getOrCompute('hash123', compute),
        cache.getOrCompute('hash123', compute),
      ]);
      expect(compute).toHaveBeenCalledTimes(1);
      expect(r1.data).toEqual(solution);
      expect(r2.data).toEqual(solution);
      expect(r3.data).toEqual(solution);
    });

    it('不同 contentHash 各自调用 compute', async () => {
      const compute = vi.fn(async (hash: string) => ({
        success: true,
        data: { ...solution, html: hash },
      }));
      await Promise.all([
        cache.getOrCompute('hash1', () => compute('hash1')),
        cache.getOrCompute('hash2', () => compute('hash2')),
      ]);
      expect(compute).toHaveBeenCalledTimes(2);
    });

    it('compute 失败不写入缓存', async () => {
      const compute = vi.fn(async () => ({
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: 'fail' },
      }));
      const result = await cache.getOrCompute('hash123', compute);
      expect(result.success).toBe(false);
      // 缓存未写入
      const cached = cache.getByContentKey('hash123');
      expect(cached.data).toBeNull();
    });

    it('完成后 in-flight 清理（失败后可再次调用 compute）', async () => {
      const compute1 = vi.fn(async () => ({
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: 'fail' },
      }));
      await cache.getOrCompute('hash123', compute1);
      // 再次调用，compute 应被再次调用（in-flight 已清理）
      const compute2 = vi.fn(async () => ({ success: true, data: solution }));
      await cache.getOrCompute('hash123', compute2);
      expect(compute2).toHaveBeenCalledTimes(1);
    });
  });

  describe('computeContentHash', () => {
    it('相同内容产生相同 hash', () => {
      expect(computeContentHash('hello')).toBe(computeContentHash('hello'));
    });

    it('不同内容产生不同 hash', () => {
      expect(computeContentHash('hello')).not.toBe(computeContentHash('world'));
    });

    it('返回 64 位 hex 字符串（SHA-256）', () => {
      expect(computeContentHash('test')).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('单例导出', () => {
    it('htmlCache 是 DualKeyHtmlCache 实例', () => {
      expect(htmlCache).toBeInstanceOf(DualKeyHtmlCache);
    });
  });
});
