// app/lib/ai/services/__tests__/html-cache.test.ts
// HtmlCache 单元测试（架构 §5.1 接口 + §7.1 双 key + §5.1 注释单飞）
// 纯内存测试，无需 mock

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DualKeyHtmlCache, htmlCache, computeContentHash } from '../html-cache';
import type { SampleFingerprint } from '../problem-fetchers/types';
import type { Solution } from '@/app/lib/ai/types';

/** 测试辅助：构造单候选 SampleFingerprint（仅 all 有值，模拟仅 1 个代码块场景） */
const fpOnly = (all: string): SampleFingerprint => ({ all, first: '' });

/** 测试辅助：构造多候选 SampleFingerprint（all + first 均有值，模拟 ≥2 个代码块场景） */
const fpDual = (all: string, first: string): SampleFingerprint => ({ all, first });

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
      // 缓存命中时 cached 被覆盖为 true（架构 §4.3）
      expect(result.data).toEqual({ ...solution, cached: true });
    });

    it('缓存未命中时调用 compute 并写入内容 key', async () => {
      const compute = vi.fn(async () => ({ success: true, data: solution }));
      const result = await cache.getOrCompute('hash123', compute);
      expect(compute).toHaveBeenCalledTimes(1);
      // 新计算结果 cached 为原值（compute 返回的 solution.cached = false）
      expect(result.data).toEqual(solution);
      // 二次查询命中缓存（不再调用 compute，cached 被覆盖为 true）
      const compute2 = vi.fn(async () => ({ success: true, data: solution }));
      const result2 = await cache.getOrCompute('hash123', compute2);
      expect(compute2).not.toHaveBeenCalled();
      expect(result2.data).toEqual({ ...solution, cached: true });
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

    it('forceRegenerate=true → 跳过缓存读，强制调用 compute 并覆盖缓存', async () => {
      // 先写入缓存
      cache.set(null, 'hash-frc', solution);
      expect(cache.getByContentKey('hash-frc').data).not.toBeNull();

      // forceRegenerate=true 应跳过缓存读，直接调用 compute
      const newSolution: Solution = { ...solution, html: '<html>new</html>' };
      const compute = vi.fn(async () => ({ success: true, data: newSolution }));
      const result = await cache.getOrCompute('hash-frc', compute, undefined, true);
      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual(newSolution);

      // 缓存已被覆盖为新内容
      const cached = cache.getByContentKey('hash-frc');
      expect(cached.data?.html).toBe('<html>new</html>');
    });

    it('forceRegenerate=true + sampleFp → 跳过 sample 查询，compute 后写入 sample 索引', async () => {
      const compute = vi.fn(async () => ({ success: true, data: solution }));
      const result = await cache.getOrCompute('hash-frc2', compute, fpOnly('sample-fp-frc'), true);
      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual(solution);
      // sample 索引已写入（validated=true，多候选全部写入）
      const sampleResult = cache.getBySampleFingerprint('sample-fp-frc');
      expect(sampleResult.data).toEqual({ contentHash: 'hash-frc2' });
    });
  });

  describe('sample 指纹缓存（FR-005~FR-008, FR-013）', () => {
    describe('getBySampleFingerprint', () => {
      it('未写入返回 null（FR-005）', () => {
        const result = cache.getBySampleFingerprint('sample-fp-1');
        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
      });

      it('sample 索引写入后命中返回 contentHash（FR-005）', async () => {
        // 通过 getOrCompute 触发 sample 索引写入（validated=true, FR-008）
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-1', compute, fpOnly('sample-fp-1'));
        const result = cache.getBySampleFingerprint('sample-fp-1');
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ contentHash: 'hash-1' });
      });
    });

    describe('getOrCompute 三条路径（FR-007）', () => {
      it('路径 1：content 命中 → 不查 sample, 不调 compute', async () => {
        cache.set(null, 'hash-1', solution);
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-1', compute, fpOnly('sample-fp-1'));
        expect(compute).not.toHaveBeenCalled();
        expect(result.data?.cached).toBe(true);
      });

      it('路径 2：content miss + sample 命中 → 返回缓存的 Solution（cached: true）', async () => {
        // 先写入 contentHash-2 的内容 + sample 索引（sample-fp-2 → hash-2）
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-2', compute, fpOnly('sample-fp-2'));
        // 现在用 hash-1（未写入 content）+ sample-fp-2 请求 → 应命中 sample 路径
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-1', compute2, fpOnly('sample-fp-2'));
        expect(compute2).not.toHaveBeenCalled();
        expect(result.data?.cached).toBe(true);
        expect(result.data?.html).toBe(solution.html);
      });

      it('路径 3：content miss + sample miss → 调 compute', async () => {
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-3', compute, fpOnly('sample-fp-3'));
        expect(compute).toHaveBeenCalledTimes(1);
        expect(result.data?.html).toBe(solution.html);
      });
    });

    describe('sample 索引回填条件（FR-008）', () => {
      it('compute 成功 + validated=true + sampleFp 非空 → 写入 sample 索引', async () => {
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-4', compute, fpOnly('sample-fp-4'));
        expect(cache.getBySampleFingerprint('sample-fp-4').data).toEqual({
          contentHash: 'hash-4',
        });
      });

      it('compute 成功 + validated=false → 不写入 sample 索引', async () => {
        const invalidSolution: Solution = {
          ...solution,
          validated: false,
          warning: '验证未通过',
        };
        const compute = vi.fn(async () => ({
          success: true,
          data: invalidSolution,
        }));
        await cache.getOrCompute('hash-5', compute, fpOnly('sample-fp-5'));
        expect(cache.getBySampleFingerprint('sample-fp-5').data).toBeNull();
      });

      it('sampleFp 为空 → 不写 sample 索引', async () => {
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-6', compute);
        expect(cache.getBySampleFingerprint('any-fp').data).toBeNull();
      });
    });

    describe('sample 命中后 contentCache 回写（方案 B, FR-007）', () => {
      it('sample 命中后, 当前 contentHash 在 contentCache 建立映射', async () => {
        // 准备: hash-2 内容 + sample 索引（sample-fp-2 → hash-2）
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-2', compute, fpOnly('sample-fp-2'));
        // 触发 sample 命中路径（hash-1 未写入 content, sample-fp-2 命中 hash-2）
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-1', compute2, fpOnly('sample-fp-2'));
        // 验证 hash-1 已在 contentCache 建立映射（直接 getByContentKey 命中）
        const direct = cache.getByContentKey('hash-1');
        expect(direct.data).not.toBeNull();
        expect(direct.data?.html).toBe(solution.html);
      });
    });

    describe('sample 索引失效降级（FR-007 自愈）', () => {
      it('sample 命中但 content2 已被 LRU 淘汰 → 降级走 compute + 自愈更新 sample 索引', async () => {
        // 1. 写入 hash-A + sample 索引
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-A', compute, fpOnly('sample-A'));

        // 2. 写入 100 个其他 contentHash, 让 hash-A 被 LRU 淘汰（max=100）
        for (let i = 0; i < 100; i++) {
          cache.set(null, `evict-${i}`, solution);
        }

        // 3. 验证 hash-A 已被淘汰
        expect(cache.getByContentKey('hash-A').data).toBeNull();

        // 4. 用新 contentHash + sample-A 请求 → sample 命中 hash-A, 但 content miss → 降级走 compute
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-C', compute2, fpOnly('sample-A'));
        expect(compute2).toHaveBeenCalledTimes(1); // 降级调用了 compute
        expect(result.data?.html).toBe(solution.html);

        // 5. 验证失效 sample 索引已被自愈更新为指向新的有效 contentHash（compute 成功后重写）
        //    旧失效索引（指向 hash-A）被替换为新有效索引（指向 hash-C）
        expect(cache.getBySampleFingerprint('sample-A').data).toEqual({
          contentHash: 'hash-C',
        });
      });
    });

    describe('多候选指纹（方案 B）', () => {
      it('compute 成功 + validated=true → all 与 first 候选均写入 sample 索引', async () => {
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-dual-1', compute, fpDual('fp-all-1', 'fp-first-1'));

        // all 候选索引
        expect(cache.getBySampleFingerprint('fp-all-1').data).toEqual({
          contentHash: 'hash-dual-1',
        });
        // first 候选索引
        expect(cache.getBySampleFingerprint('fp-first-1').data).toEqual({
          contentHash: 'hash-dual-1',
        });
      });

      it('content miss + all 候选命中 → 触发 Plan B 回写', async () => {
        // 准备: hash-dual-2 内容 + all/first 索引
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-dual-2', compute, fpDual('fp-all-2', 'fp-first-2'));

        // 用新 contentHash + 相同 all 候选请求 → all 命中触发 Plan B
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-dual-2b', compute2, fpDual('fp-all-2', 'fp-first-other'));
        expect(compute2).not.toHaveBeenCalled();
        expect(result.data?.cached).toBe(true);
        // hash-dual-2b 在 contentCache 建立映射
        expect(cache.getByContentKey('hash-dual-2b').data).not.toBeNull();
      });

      it('content miss + all miss + first 候选命中 → 触发 Plan B 回写', async () => {
        // 准备: hash-dual-3 内容 + all/first 索引
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-dual-3', compute, fpDual('fp-all-3', 'fp-first-3'));

        // 用新 contentHash + 不同 all + 相同 first 请求 → all miss, first 命中
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-dual-3b', compute2, fpDual('fp-all-other', 'fp-first-3'));
        expect(compute2).not.toHaveBeenCalled();
        expect(result.data?.cached).toBe(true);
        expect(result.data?.html).toBe(solution.html);
      });

      it('content miss + all 命中但 content2 失效 → 清理 all 索引并继续查 first', async () => {
        // 准备: hash-dual-4 内容 + all/first 索引，但 all 指向的 content 被 LRU 淘汰
        const compute = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-dual-4', compute, fpDual('fp-all-4', 'fp-first-4'));

        // 让 hash-dual-4 被 LRU 淘汰
        for (let i = 0; i < 100; i++) {
          cache.set(null, `evict-dual-${i}`, solution);
        }
        expect(cache.getByContentKey('hash-dual-4').data).toBeNull();

        // first 索引仍指向 hash-dual-4（也被淘汰）→ 两个候选都失效 → 降级走 compute
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-dual-4b', compute2, fpDual('fp-all-4', 'fp-first-4'));
        expect(compute2).toHaveBeenCalledTimes(1);
        expect(result.data?.html).toBe(solution.html);

        // 失效的 all 索引已被清理（自愈），compute 成功后重写为新 contentHash
        expect(cache.getBySampleFingerprint('fp-all-4').data).toEqual({
          contentHash: 'hash-dual-4b',
        });
        expect(cache.getBySampleFingerprint('fp-first-4').data).toEqual({
          contentHash: 'hash-dual-4b',
        });
      });

      it('多候选查询顺序：先查 all，all 命中则不再查 first', async () => {
        // 准备: all 候选指向 hash-A, first 候选指向 hash-B（理论上不会发生，但验证查询顺序）
        const computeA = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-A', computeA, fpOnly('fp-all-5'));
        const computeB = vi.fn(async () => ({ success: true, data: solution }));
        await cache.getOrCompute('hash-B', computeB, fpOnly('fp-first-5'));

        // 用新 contentHash + all=fp-all-5 + first=fp-first-5 请求
        // 应先查 all（命中 hash-A），不再查 first
        const compute2 = vi.fn(async () => ({ success: true, data: solution }));
        const result = await cache.getOrCompute('hash-C', compute2, fpDual('fp-all-5', 'fp-first-5'));
        expect(compute2).not.toHaveBeenCalled();
        expect(result.data?.cached).toBe(true);
        // hash-C 在 contentCache 建立映射（来自 hash-A 的内容）
        expect(cache.getByContentKey('hash-C').data).not.toBeNull();
      });
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
