// app/lib/ai/services/__tests__/db-html-cache.test.ts
// DbHtmlCache 单元测试（FR-014/AD-06，AC-008/AC-009/AC-010a；架构 §8.1 AR1-009 LRU 前置层）
// 全 mock solutionDao（零真实 DB）；行为逐条对齐 DualKeyHtmlCache（任务行为基准）
//
// 覆盖点：
// - content 命中（LRU 层命中不出 DAO / LRU miss 出 DAO）/ miss → compute → 双写
// - Plan B：sample 命中 → content2 命中 → upsertSolution(当前hash) + upsertSampleIndex(当前fp,当前hash)
//   （终审观察 3：确保 T5 settle 写 user_solution_access 的 FK→solutions 不断裂）
// - 索引失效自愈（LRU 清理 + 继续下一候选）、单飞、forceRegenerate
// - 读失败降级 miss（FR-014b/AC-010a）、写失败不阻断（NFR-007）
// - validated=false 不写 sample 索引；set 双写 + 主 key 解析

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Solution } from '@/app/lib/ai/types';

// mock logger（避免测试输出噪音）
vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// mock solutionDao（全 mock，零真实 DB；DbHtmlCache 唯一数据源）
vi.mock('@/app/lib/db/daos/solution-dao', () => ({
  solutionDao: {
    getByContentHash: vi.fn(),
    getPrimaryContentHash: vi.fn(),
    getBySampleFingerprint: vi.fn(),
    upsertSolution: vi.fn(),
    upsertPrimaryIndex: vi.fn(),
    upsertSampleIndex: vi.fn(),
  },
}));

import { DbHtmlCache } from '../db-html-cache';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';

/** 测试辅助：构造单候选 SampleFingerprint（仅 all 有值） */
const fpOnly = (all: string): { all: string; first: string } => ({ all, first: '' });

/** 测试辅助：构造 Solution（contentHash 必填，FR-029） */
const buildSolution = (html: string, contentHash: string, validated = true): Solution => ({
  html,
  validated,
  cached: false,
  contentHash,
});

/** mock 读路径默认全部 miss、写路径默认成功 */
function mockDefaults(): void {
  vi.mocked(solutionDao.getByContentHash).mockResolvedValue({ success: true, data: null });
  vi.mocked(solutionDao.getPrimaryContentHash).mockResolvedValue({ success: true, data: null });
  vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValue({ success: true, data: null });
  vi.mocked(solutionDao.upsertSolution).mockResolvedValue(undefined);
  vi.mocked(solutionDao.upsertPrimaryIndex).mockResolvedValue(undefined);
  vi.mocked(solutionDao.upsertSampleIndex).mockResolvedValue(undefined);
}

describe('DbHtmlCache', () => {
  let cache: DbHtmlCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaults();
    cache = new DbHtmlCache();
  });

  describe('getOrCompute content 路径（FR-007 第 1 步）', () => {
    it('content 命中（DAO）→ 返回 cached: true 且不调 compute', async () => {
      const stored = buildSolution('<html>stored</html>', 'hash-1');
      // DAO 命中时携带 cached: true（solutionDao.toSolutionWithHash 语义）
      vi.mocked(solutionDao.getByContentHash).mockResolvedValue({
        success: true,
        data: { ...stored, cached: true },
      });
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>new</html>', 'hash-1') }));

      const result = await cache.getOrCompute('hash-1', compute);

      expect(compute).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.cached).toBe(true);
      expect(result.data?.html).toBe('<html>stored</html>');
      expect(solutionDao.getByContentHash).toHaveBeenCalledWith('hash-1');
    });

    it('content 命中后写入 LRU：二次查询不再出 DAO', async () => {
      const stored = buildSolution('<html>stored</html>', 'hash-1');
      vi.mocked(solutionDao.getByContentHash).mockResolvedValue({
        success: true,
        data: { ...stored, cached: true },
      });
      const compute = vi.fn(async () => ({ success: true, data: stored }));

      await cache.getOrCompute('hash-1', compute);
      await cache.getOrCompute('hash-1', compute);

      expect(solutionDao.getByContentHash).toHaveBeenCalledTimes(1);
      expect(compute).not.toHaveBeenCalled();
    });

    it('content miss → compute → 双写 LRU + upsertSolution', async () => {
      const computed = buildSolution('<html>computed</html>', 'hash-2');
      const compute = vi.fn(async () => ({ success: true, data: computed }));

      const result = await cache.getOrCompute('hash-2', compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>computed</html>');
      // DB 权威写（AR1-001 DO UPDATE 语义）
      expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-2', computed);
      // LRU 前置层写：二次查询命中 LRU、不再出 DAO
      await cache.getOrCompute('hash-2', vi.fn(async () => ({ success: true, data: computed })));
      expect(solutionDao.getByContentHash).toHaveBeenCalledTimes(1);
    });
  });

  describe('Plan B（sample 命中，FR-007 第 2 步 + 终审观察 3）', () => {
    it('sample 命中 → content2 命中 → upsertSolution(当前hash) + upsertSampleIndex(当前fp,当前hash) + cached: true', async () => {
      // sample 索引：fp-old → hash-old；hash-old 的内容存在
      vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValue({
        success: true,
        data: { contentHash: 'hash-old' },
      });
      const oldSolution = { ...buildSolution('<html>old</html>', 'hash-old'), cached: true };
      vi.mocked(solutionDao.getByContentHash).mockImplementation(async (hash: string) =>
        hash === 'hash-old'
          ? { success: true, data: oldSolution }
          : { success: true, data: null },
      );
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>x</html>', 'hash-req') }));

      const result = await cache.getOrCompute('hash-req', compute, fpOnly('fp-old'));

      expect(compute).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.cached).toBe(true);
      expect(result.data?.html).toBe('<html>old</html>');
      // 关键断言（终审观察 3）：当前请求 hash 在 DB 建立 solutions 行（T5 settle FK 不断裂）
      expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-req', oldSolution);
      // sample 索引指向当前 contentHash（对齐 DualKeyHtmlCache 写入语义）
      expect(solutionDao.upsertSampleIndex).toHaveBeenCalledWith('fp-old', 'hash-req');
      // LRU 回写：当前 hash → solution（后续直接命中）
      await cache.getOrCompute('hash-req', compute, fpOnly('fp-old'));
      expect(solutionDao.getByContentHash).toHaveBeenCalledTimes(2); // hash-req 初查 + hash-old，LRU 命中后不再查
    });

    it('索引失效：all 候选 content2 miss → 清理 LRU + 继续 first 候选命中', async () => {
      // all 候选指向 hash-stale（内容已被删除=索引失效），first 候选指向 hash-ok
      vi.mocked(solutionDao.getBySampleFingerprint).mockImplementation(async (fp: string) =>
        fp === 'fp-all'
          ? { success: true, data: { contentHash: 'hash-stale' } }
          : { success: true, data: { contentHash: 'hash-ok' } },
      );
      const okSolution = { ...buildSolution('<html>ok</html>', 'hash-ok'), cached: true };
      vi.mocked(solutionDao.getByContentHash).mockImplementation(async (hash: string) =>
        hash === 'hash-ok'
          ? { success: true, data: okSolution }
          : { success: true, data: null },
      );
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>x</html>', 'hash-req') }));

      const result = await cache.getOrCompute(
        'hash-req',
        compute,
        { all: 'fp-all', first: 'fp-first' },
      );

      // 失效候选被跳过（查了 hash-stale 但 miss），first 候选命中
      expect(solutionDao.getByContentHash).toHaveBeenCalledWith('hash-stale');
      expect(compute).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>ok</html>');
      // first 候选索引回写指向当前 hash
      expect(solutionDao.upsertSampleIndex).toHaveBeenCalledWith('fp-first', 'hash-req');
    });

    it('所有候选均失效 → 降级走 compute', async () => {
      vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValue({
        success: true,
        data: { contentHash: 'hash-stale' },
      });
      // 所有 content 查询均 miss（索引失效）
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>new</html>', 'hash-req') }));

      const result = await cache.getOrCompute(
        'hash-req',
        compute,
        { all: 'fp-all', first: 'fp-first' },
      );

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>new</html>');
    });
  });

  describe('单飞（FR-014a）', () => {
    it('并发同 contentHash → compute 仅一次（复用同一 Promise）', async () => {
      const computed = buildSolution('<html>slow</html>', 'hash-conc');
      const compute = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { success: true, data: computed };
      });

      const [r1, r2] = await Promise.all([
        cache.getOrCompute('hash-conc', compute),
        cache.getOrCompute('hash-conc', compute),
      ]);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(r1.data?.html).toBe('<html>slow</html>');
      expect(r2.data?.html).toBe('<html>slow</html>');
    });

    it('完成后 in-flight 清理（失败后可再次 compute）', async () => {
      const fail = vi.fn(async () => ({
        success: false,
        error: { code: 'GESP6_LLM_TIMEOUT', message: 'fail' },
      }));
      await cache.getOrCompute('hash-retry', fail);

      const ok = vi.fn(async () => ({ success: true, data: buildSolution('<html>ok</html>', 'hash-retry') }));
      await cache.getOrCompute('hash-retry', ok);

      expect(ok).toHaveBeenCalledTimes(1);
    });
  });

  describe('forceRegenerate（FR-007 跳过读）', () => {
    it('DB 已有解法仍强制 compute 并覆盖', async () => {
      const stored = { ...buildSolution('<html>stored</html>', 'hash-frc'), cached: true };
      vi.mocked(solutionDao.getByContentHash).mockResolvedValue({
        success: true,
        data: stored,
      });
      const fresh = buildSolution('<html>fresh</html>', 'hash-frc');
      const compute = vi.fn(async () => ({ success: true, data: fresh }));

      const result = await cache.getOrCompute('hash-frc', compute, undefined, true);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(solutionDao.getByContentHash).not.toHaveBeenCalled();
      expect(result.data?.html).toBe('<html>fresh</html>');
      expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-frc', fresh);
    });
  });

  describe('读失败降级 miss（FR-014b/AC-010a，§4.2）', () => {
    it('DAO 读失败 → 不抛出、视为 miss 降级 compute 成功返回', async () => {
      vi.mocked(solutionDao.getByContentHash).mockResolvedValue({
        success: false,
        error: { code: 'GESP6_DB_UNAVAILABLE', message: '数据库暂不可用' },
      });
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>ok</html>', 'hash-deg') }));

      const result = await cache.getOrCompute('hash-deg', compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>ok</html>');
    });

    it('sample DAO 读失败 → 视为该候选 miss，继续走 compute', async () => {
      vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValue({
        success: false,
        error: { code: 'GESP6_DB_UNAVAILABLE', message: '数据库暂不可用' },
      });
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>ok</html>', 'hash-deg2') }));

      const result = await cache.getOrCompute('hash-deg2', compute, fpOnly('fp-deg'));

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('写失败不阻断（NFR-007）', () => {
    it('upsertSolution 抛错 → getOrCompute 仍成功返回', async () => {
      vi.mocked(solutionDao.upsertSolution).mockRejectedValue(new Error('write failed'));
      const computed = buildSolution('<html>ok</html>', 'hash-wf');
      const compute = vi.fn(async () => ({ success: true, data: computed }));

      const result = await cache.getOrCompute('hash-wf', compute);

      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>ok</html>');
    });

    it('Plan B 回写抛错 → 仍返回命中结果（不阻断）', async () => {
      vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValue({
        success: true,
        data: { contentHash: 'hash-old' },
      });
      const oldSolution = { ...buildSolution('<html>old</html>', 'hash-old'), cached: true };
      vi.mocked(solutionDao.getByContentHash).mockImplementation(async (hash: string) =>
        hash === 'hash-old' ? { success: true, data: oldSolution } : { success: true, data: null },
      );
      vi.mocked(solutionDao.upsertSolution).mockRejectedValue(new Error('write failed'));
      const compute = vi.fn(async () => ({ success: true, data: buildSolution('<html>x</html>', 'hash-pbw') }));

      const result = await cache.getOrCompute('hash-pbw', compute, fpOnly('fp-pbw'));

      expect(result.success).toBe(true);
      expect(result.data?.cached).toBe(true);
      expect(result.data?.html).toBe('<html>old</html>');
    });
  });

  describe('sample 索引写入条件（FR-008 对齐）', () => {
    it('validated=false → 不写 sample 索引（仍写 solutions）', async () => {
      const degraded = buildSolution('<html>degraded</html>', 'hash-inv', false);
      const compute = vi.fn(async () => ({ success: true, data: degraded }));

      await cache.getOrCompute('hash-inv', compute, fpOnly('fp-inv'));

      expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-inv', degraded);
      expect(solutionDao.upsertSampleIndex).not.toHaveBeenCalled();
    });

    it('validated=true + 多候选 → 全部候选写入 sample 索引', async () => {
      const computed = buildSolution('<html>ok</html>', 'hash-dual');
      const compute = vi.fn(async () => ({ success: true, data: computed }));

      await cache.getOrCompute('hash-dual', compute, { all: 'fp-a', first: 'fp-b' });

      expect(solutionDao.upsertSampleIndex).toHaveBeenCalledWith('fp-a', 'hash-dual');
      expect(solutionDao.upsertSampleIndex).toHaveBeenCalledWith('fp-b', 'hash-dual');
    });
  });

  describe('set 双写 + 主 key 解析（LRU + DB）', () => {
    it('primaryKey 为 gesp6:platform: 前缀 → 解析后 upsertPrimaryIndex(platform, problemId, hash)', async () => {
      const solution = buildSolution('<html>s</html>', 'hash-set');

      cache.set('gesp6:platform:luogu:P1000', 'hash-set', solution);

      // DB 写为 fire-and-forget，轮询确认（FsHtmlCache 同款模式）
      await vi.waitFor(() => {
        expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-set', solution);
        expect(solutionDao.upsertPrimaryIndex).toHaveBeenCalledWith('luogu', 'P1000', 'hash-set');
      });
      // LRU 同步写：立即命中不出 DAO
      const primary = await cache.getByPrimaryKey('luogu', 'P1000');
      expect(primary.success).toBe(true);
      expect(primary.data?.html).toBe('<html>s</html>');
      expect(solutionDao.getPrimaryContentHash).not.toHaveBeenCalled();
    });

    it('primaryKey=null → 仅写 solutions，跳过 primary 索引', async () => {
      const solution = buildSolution('<html>s</html>', 'hash-null');

      cache.set(null, 'hash-null', solution);

      await vi.waitFor(() => {
        expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-null', solution);
      });
      expect(solutionDao.upsertPrimaryIndex).not.toHaveBeenCalled();
    });

    it('primaryKey 无 gesp6:platform: 前缀 → 解析失败跳过 primary（solutions 仍写）', async () => {
      const solution = buildSolution('<html>s</html>', 'hash-bad');

      cache.set('invalid-key-format', 'hash-bad', solution);

      await vi.waitFor(() => {
        expect(solutionDao.upsertSolution).toHaveBeenCalledWith('hash-bad', solution);
      });
      expect(solutionDao.upsertPrimaryIndex).not.toHaveBeenCalled();
    });

    it('DB 写失败 → 不抛出（仅记日志，NFR-007）', async () => {
      vi.mocked(solutionDao.upsertSolution).mockRejectedValue(new Error('db down'));
      const solution = buildSolution('<html>s</html>', 'hash-wf2');

      expect(() => cache.set(null, 'hash-wf2', solution)).not.toThrow();
      // LRU 仍已写入（性能层与 DB 解耦）
      const content = await cache.getByContentKey('hash-wf2');
      expect(content.data?.html).toBe('<html>s</html>');
    });
  });

  describe('getByPrimaryKey（两步查询：索引 → content）', () => {
    it('DAO 两步命中 → 返回 Solution 并写 LRU', async () => {
      const stored = { ...buildSolution('<html>db</html>', 'hash-p'), cached: true };
      vi.mocked(solutionDao.getPrimaryContentHash).mockResolvedValue({
        success: true,
        data: { contentHash: 'hash-p' },
      });
      vi.mocked(solutionDao.getByContentHash).mockResolvedValue({
        success: true,
        data: stored,
      });

      const result = await cache.getByPrimaryKey('luogu', 'P1000');

      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<html>db</html>');
      expect(result.data?.contentHash).toBe('hash-p');
      // LRU 写：二次查询不再出 DAO
      await cache.getByPrimaryKey('luogu', 'P1000');
      expect(solutionDao.getPrimaryContentHash).toHaveBeenCalledTimes(1);
    });

    it('索引 miss → data=null', async () => {
      const result = await cache.getByPrimaryKey('luogu', 'P404');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('索引指向的 content 缺失（索引失效）→ data=null（不抛出）', async () => {
      vi.mocked(solutionDao.getPrimaryContentHash).mockResolvedValue({
        success: true,
        data: { contentHash: 'hash-gone' },
      });

      const result = await cache.getByPrimaryKey('luogu', 'P500');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('索引 DAO 读失败 → success=false（miss 语义，不抛出）', async () => {
      vi.mocked(solutionDao.getPrimaryContentHash).mockResolvedValue({
        success: false,
        error: { code: 'GESP6_DB_UNAVAILABLE', message: '数据库暂不可用' },
      });

      const result = await cache.getByPrimaryKey('luogu', 'P600');

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
    });
  });

  describe('getByContentKey / getBySampleFingerprint', () => {
    it('getByContentKey DAO 命中携带 contentHash；miss 返回 null', async () => {
      const stored = { ...buildSolution('<html>db</html>', 'hash-c'), cached: true };
      vi.mocked(solutionDao.getByContentHash).mockResolvedValueOnce({
        success: true,
        data: stored,
      });

      const hit = await cache.getByContentKey('hash-c');
      expect(hit.success).toBe(true);
      expect(hit.data?.contentHash).toBe('hash-c');

      const miss = await cache.getByContentKey('hash-none');
      expect(miss.success).toBe(true);
      expect(miss.data).toBeNull();
    });

    it('getBySampleFingerprint DAO 命中返回 contentHash', async () => {
      vi.mocked(solutionDao.getBySampleFingerprint).mockResolvedValueOnce({
        success: true,
        data: { contentHash: 'hash-s' },
      });

      const result = await cache.getBySampleFingerprint('fp-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ contentHash: 'hash-s' });
    });
  });

  describe('buildPrimaryKey', () => {
    it('与 DualKeyHtmlCache 格式一致（gesp6:platform:{platform}:{problemId}）', () => {
      expect(cache.buildPrimaryKey('luogu', 'P11447')).toBe('gesp6:platform:luogu:P11447');
    });
  });
});
