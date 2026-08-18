// app/lib/db/daos/__tests__/solution-dao.test.ts
// solutionDao 单元测试（AR1-001：运行期 upsert 走 DO UPDATE / 导入期 insertIfAbsent 走 DO NOTHING；全 mock）

import { describe, test, expect, vi } from 'vitest';
import { getDb, type Db } from '@/app/lib/db/connection';
import { primaryIndexes, sampleIndexes, solutions } from '@/app/lib/db/schema';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';
import { connectionError, createMockDb, type InsertOp } from './mock-db';

// mock 连接模块（DAO 测试不触碰真实 pg/Pool）
vi.mock('@/app/lib/db/connection', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

/** 将 mock db 设为 getDb() 返回值 */
function useDb(db: Record<string, unknown>): void {
  vi.mocked(getDb).mockImplementation(() => db as unknown as Db);
}

/** 取首个 insert 操作 */
function firstInsertOp(ops: ReturnType<typeof createMockDb>['ops']): InsertOp {
  const insertOps = ops.filter((op): op is InsertOp => op.op === 'insert');
  expect(insertOps).toHaveLength(1);
  return insertOps[0];
}

const SAMPLE_SOLUTION = { html: '<html>sol</html>', validated: true, warning: undefined, cached: false };

describe('solutionDao 读路径', () => {
  test('getByContentHash 命中 → 返回携带 contentHash 的原始 Solution（cached: true，AD-08 不填充 sampleFp）', async () => {
    const { db } = createMockDb({
      selectRows: new Map<unknown, unknown[]>([
        [solutions, [{ contentHash: 'hash-1', html: '<html>sol</html>', validated: true, warning: null }]],
      ]),
    });
    useDb(db);

    const result = await solutionDao.getByContentHash('hash-1');

    expect(result).toEqual({
      success: true,
      data: { contentHash: 'hash-1', html: '<html>sol</html>', validated: true, warning: undefined, cached: true },
    });
  });

  test('getByContentHash 未命中 → success=true + data=null（DbHtmlCache 视为 miss）', async () => {
    const { db } = createMockDb({ selectRows: new Map() });
    useDb(db);

    const result = await solutionDao.getByContentHash('hash-missing');

    expect(result).toEqual({ success: true, data: null });
  });

  test('getPrimaryContentHash 命中 → { contentHash }；未命中 → null', async () => {
    const hit = createMockDb({
      selectRows: new Map<unknown, unknown[]>([[primaryIndexes, [{ contentHash: 'hash-p' }]]]),
    });
    useDb(hit.db);
    expect(await solutionDao.getPrimaryContentHash('luogu', 'P1001')).toEqual({
      success: true,
      data: { contentHash: 'hash-p' },
    });

    const miss = createMockDb({ selectRows: new Map() }); // 未配置行 → 未命中
    useDb(miss.db);
    expect(await solutionDao.getPrimaryContentHash('luogu', 'P1001')).toEqual({ success: true, data: null });
  });

  test('getBySampleFingerprint 命中 → { contentHash }；未命中 → null', async () => {
    const hit = createMockDb({
      selectRows: new Map<unknown, unknown[]>([[sampleIndexes, [{ contentHash: 'hash-s' }]]]),
    });
    useDb(hit.db);
    expect(await solutionDao.getBySampleFingerprint('fp-1')).toEqual({
      success: true,
      data: { contentHash: 'hash-s' },
    });

    const miss = createMockDb({ selectRows: new Map() });
    useDb(miss.db);
    expect(await solutionDao.getBySampleFingerprint('fp-1')).toEqual({ success: true, data: null });
  });

  test('读失败（连接类）→ success=false + GESP6_DB_UNAVAILABLE（信息不含连接串）', async () => {
    const { db } = createMockDb();
    useDb({
      ...db,
      select: (): never => {
        throw connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432');
      },
    });

    const result = await solutionDao.getByContentHash('hash-1');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_DB_UNAVAILABLE');
    expect(result.error?.message).not.toContain('postgres://');
  });
});

describe('solutionDao 运行期 upsert（AR1-001：DO UPDATE，DbHtmlCache.set 用；写异常上抛）', () => {
  test('upsertSolution → onConflictDoUpdate(target=contentHash)，set 更新 html/validated/warning，返回 void', async () => {
    const { db, ops } = createMockDb();
    useDb(db);

    await expect(solutionDao.upsertSolution('hash-1', SAMPLE_SOLUTION)).resolves.toBeUndefined();

    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doUpdate');
    expect(op.table).toBe(solutions);
    expect(op.target).toBe(solutions.contentHash);
    expect(op.set).toMatchObject({ html: '<html>sol</html>', validated: true });
  });

  test('upsertPrimaryIndex → onConflictDoUpdate(复合主键)，set 指向最新 contentHash', async () => {
    const { db, ops } = createMockDb();
    useDb(db);

    await expect(solutionDao.upsertPrimaryIndex('luogu', 'P1001', 'hash-new')).resolves.toBeUndefined();

    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doUpdate');
    expect(op.table).toBe(primaryIndexes);
    expect(op.target).toEqual([primaryIndexes.platform, primaryIndexes.problemId]);
    expect(op.set).toEqual({ contentHash: 'hash-new' });
    expect(op.values).toMatchObject({ platform: 'luogu', problemId: 'P1001', contentHash: 'hash-new' });
  });

  test('upsertSampleIndex → onConflictDoUpdate(target=sampleFp)', async () => {
    const { db, ops } = createMockDb();
    useDb(db);

    await expect(solutionDao.upsertSampleIndex('fp-1', 'hash-1')).resolves.toBeUndefined();

    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doUpdate');
    expect(op.table).toBe(sampleIndexes);
    expect(op.target).toBe(sampleIndexes.sampleFp);
    expect(op.set).toEqual({ contentHash: 'hash-1' });
  });

  test('写失败（连接类）→ 异常上抛（由 DbHtmlCache.set 内部 catch 记日志，NFR-007）', async () => {
    const { db } = createMockDb();
    useDb({
      ...db,
      insert: (): never => {
        throw connectionError('ETIMEDOUT', 'connect ETIMEDOUT');
      },
    });

    await expect(solutionDao.upsertSolution('hash-1', SAMPLE_SOLUTION)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });
});

describe('solutionDao 导入期 insertIfAbsent（AR1-001：DO NOTHING，导入脚本用；异常上抛）', () => {
  test('insertIfAbsentSolution 新插入 → true；已存在（冲突跳过）→ false', async () => {
    const inserted = createMockDb({
      insertReturningRows: new Map<unknown, unknown[]>([[solutions, [{ contentHash: 'hash-1' }]]]),
    });
    useDb(inserted.db);
    expect(await solutionDao.insertIfAbsentSolution('hash-1', SAMPLE_SOLUTION)).toBe(true);

    const skipped = createMockDb({ insertReturningRows: new Map() }); // RETURNING 空 = 冲突跳过
    useDb(skipped.db);
    expect(await solutionDao.insertIfAbsentSolution('hash-1', SAMPLE_SOLUTION)).toBe(false);
  });

  test('insertIfAbsentSolution → onConflictDoNothing(target=contentHash)', () => {
    const { db, ops } = createMockDb({
      insertReturningRows: new Map<unknown, unknown[]>([[solutions, [{ contentHash: 'hash-1' }]]]),
    });
    useDb(db);

    void solutionDao.insertIfAbsentSolution('hash-1', SAMPLE_SOLUTION);

    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doNothing');
    expect(op.table).toBe(solutions);
    expect(op.target).toBe(solutions.contentHash);
  });

  test('insertIfAbsentPrimaryIndex → DO NOTHING + 复合主键 target，返回是否新插入', async () => {
    const { db, ops } = createMockDb({
      insertReturningRows: new Map<unknown, unknown[]>([[primaryIndexes, [{ platform: 'luogu', problemId: 'P1001' }]]]),
    });
    useDb(db);

    const inserted = await solutionDao.insertIfAbsentPrimaryIndex('luogu', 'P1001', 'hash-1');

    expect(inserted).toBe(true);
    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doNothing');
    expect(op.target).toEqual([primaryIndexes.platform, primaryIndexes.problemId]);
  });

  test('insertIfAbsentSampleIndex → DO NOTHING + sampleFp target，冲突时返回 false', async () => {
    const skipped = createMockDb({ insertReturningRows: new Map() });
    useDb(skipped.db);

    const inserted = await solutionDao.insertIfAbsentSampleIndex('fp-1', 'hash-1');

    expect(inserted).toBe(false);
    const op = firstInsertOp(skipped.ops);
    expect(op.conflict).toBe('doNothing');
    expect(op.target).toBe(sampleIndexes.sampleFp);
  });

  test('insertIfAbsent 写失败 → 异常上抛（导入脚本按批捕获记入失败清单，AR1-013）', async () => {
    const { db } = createMockDb();
    useDb({
      ...db,
      insert: (): never => {
        throw connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432');
      },
    });

    await expect(solutionDao.insertIfAbsentSolution('hash-1', SAMPLE_SOLUTION)).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
