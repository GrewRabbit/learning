// app/lib/db/daos/__tests__/user-dao.test.ts
// userDao 单元测试（AD-05 建档三步幂等 / §4.3 deductFreeFirst 单条 CASE WHEN 三分支；全 mock）

import { describe, test, expect, vi } from 'vitest';
import { getDb, type Db, type DbTx } from '@/app/lib/db/connection';
import { quotaAccounts, users } from '@/app/lib/db/schema';
import { userDao } from '@/app/lib/db/daos/user-dao';
import { attachTransaction, connectionError, createMockDb, type InsertOp, type SelectOp } from './mock-db';

// mock 连接模块（DAO 测试不触碰真实 pg/Pool）
vi.mock('@/app/lib/db/connection', () => ({
  getDb: vi.fn(),
  getPool: vi.fn(),
}));

/** 将 mock db 设为 getDb() 返回值 */
function useDb(db: Record<string, unknown>): void {
  vi.mocked(getDb).mockImplementation(() => db as unknown as Db);
}

/** mock db 充当事务 tx（DAO 事务方法以 tx 注入） */
function asTx(db: Record<string, unknown>): DbTx {
  return db as unknown as DbTx;
}

/** 从 ops 过滤指定表的操作 */
function opsOn(ops: ReturnType<typeof createMockDb>['ops'], table: unknown): Array<SelectOp | InsertOp> {
  return ops.filter((op): op is SelectOp | InsertOp => op.table === table);
}

describe('userDao.getOrCreateUser（AD-05 单事务幂等建档）', () => {
  test('事务内三步：INSERT users DO NOTHING → SELECT id → INSERT quota_accounts DO NOTHING', async () => {
    const selectRows = new Map<unknown, unknown[]>([[users, [{ id: 'u-1' }]]]);
    const { db, ops } = createMockDb({ selectRows });
    useDb(attachTransaction(db));

    const result = await userDao.getOrCreateUser('sub-1', 5);

    expect(result).toEqual({ success: true, data: { userId: 'u-1' } });
    // 调用顺序：insert(users) → select(users) → insert(quota_accounts)
    expect(ops.map((op) => op.op)).toEqual(['insert', 'select', 'insert']);
    expect(ops[0]).toMatchObject({
      table: users,
      conflict: 'doNothing',
      values: { ssoSub: 'sub-1' },
    });
    expect(ops[1]).toMatchObject({ table: users });
    expect(ops[2]).toMatchObject({
      table: quotaAccounts,
      conflict: 'doNothing',
      values: { userId: 'u-1', freeBalance: 5, rechargeBalance: 0 },
    });
  });

  test('建档后查询不到用户记录 → GESP6_USER_CREATE_FAILED（非连接类）', async () => {
    const { db } = createMockDb({ selectRows: new Map() }); // users 无行 → SELECT 返回 []
    useDb(attachTransaction(db));

    const result = await userDao.getOrCreateUser('sub-missing', 5);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_USER_CREATE_FAILED');
  });

  test('事务抛连接类错误 → GESP6_DB_UNAVAILABLE', async () => {
    const { db } = createMockDb();
    useDb(
      attachTransaction(db, async () => {
        throw connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432');
      }),
    );

    const result = await userDao.getOrCreateUser('sub-1', 5);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_DB_UNAVAILABLE');
  });
});

describe('userDao.deductFreeFirst（§4.3 单条 CASE WHEN，AC-015 语义）', () => {
  test('SQL 形态：单条 UPDATE quota_accounts + CASE WHEN + RETURNING，userId/price 以参数对象携带', async () => {
    const { db, execute } = createMockDb({
      executeRows: [{ old_free_balance: 5, old_recharge_balance: 2, new_free_balance: 4, new_recharge_balance: 2 }],
    });

    await userDao.deductFreeFirst('user-1', 1, asTx(db));

    expect(execute).toHaveBeenCalledTimes(1);
    const sqlArg = execute.mock.calls[0][0] as { queryChunks: unknown[] };
    const serialized = JSON.stringify(sqlArg.queryChunks);
    // 单条语句 + CASE WHEN + RETURNING（AR1-017）；参数值在 SQL 对象的参数块中（FR-032 参数化）
    expect(serialized).toContain('UPDATE quota_accounts');
    expect(serialized).toContain('CASE WHEN');
    expect(serialized).toContain('RETURNING');
    expect(serialized).toContain('user-1');
    expect(serialized).toContain(1);
  });

  test('free_balance 扣减前后变化 → free', async () => {
    const { db } = createMockDb({
      executeRows: [{ old_free_balance: 5, old_recharge_balance: 2, new_free_balance: 4, new_recharge_balance: 2 }],
    });

    const branch = await userDao.deductFreeFirst('user-1', 1, asTx(db));
    expect(branch).toBe('free');
  });

  test('free_balance 未变、仅 recharge_balance 扣减 → recharge', async () => {
    const { db } = createMockDb({
      executeRows: [{ old_free_balance: 0, old_recharge_balance: 2, new_free_balance: 0, new_recharge_balance: 1 }],
    });

    const branch = await userDao.deductFreeFirst('user-1', 1, db as never);
    expect(branch).toBe('recharge');
  });

  test('影响 0 行（余额不足，条件 UPDATE 未命中）→ insufficient', async () => {
    const { db } = createMockDb({ executeRows: [] });

    const branch = await userDao.deductFreeFirst('user-1', 1, asTx(db));
    expect(branch).toBe('insufficient');
  });
});

describe('userDao.getBalance / addRecharge（事务内注入）', () => {
  test('getBalance 返回双列余额', async () => {
    const { db, ops } = createMockDb({
      selectRows: new Map<unknown, unknown[]>([[quotaAccounts, [{ freeBalance: 3, rechargeBalance: 7 }]]]),
    });

    const balance = await userDao.getBalance('user-1', db as never);

    expect(balance).toEqual({ freeBalance: 3, rechargeBalance: 7 });
    expect(opsOn(ops, quotaAccounts)[0]).toMatchObject({ op: 'select' });
  });

  test('getBalance 无账户行 → 抛错（事务回滚由上层处理）', async () => {
    const { db } = createMockDb({ selectRows: new Map() });

    await expect(userDao.getBalance('user-1', db as never)).rejects.toThrowError();
  });

  test('addRecharge：UPDATE quota_accounts 增量充值 + updated_at', async () => {
    const { db, ops } = createMockDb();

    await userDao.addRecharge('user-1', 10, asTx(db));

    expect(opsOn(ops, quotaAccounts)[0]).toMatchObject({ op: 'update', table: quotaAccounts });
    const updateOp = ops[0] as { op: string; set: Record<string, unknown> };
    expect(updateOp.set).toHaveProperty('rechargeBalance');
    expect(updateOp.set).toHaveProperty('updatedAt');
  });
});
