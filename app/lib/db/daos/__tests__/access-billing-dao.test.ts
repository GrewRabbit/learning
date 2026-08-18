// app/lib/db/daos/__tests__/access-billing-dao.test.ts
// accessDao / billingDao 单元测试（计费权威唯一约束插入与流水字段映射；全 mock，tx 直接注入）

import { describe, test, expect } from 'vitest';
import type { DbTx } from '@/app/lib/db/connection';
import { billingRecords, solveRecords, userSolutionAccess } from '@/app/lib/db/schema';
import { accessDao } from '@/app/lib/db/daos/access-dao';
import { billingDao } from '@/app/lib/db/daos/billing-dao';
import { createMockDb, type InsertOp } from './mock-db';

/** 构造 mock tx */
function useTx(): ReturnType<typeof createMockDb> {
  return createMockDb();
}

function asTx(db: Record<string, unknown>): DbTx {
  return db as unknown as DbTx;
}

function firstInsertOp(ops: ReturnType<typeof createMockDb>['ops']): InsertOp {
  const insertOps = ops.filter((op): op is InsertOp => op.op === 'insert');
  expect(insertOps).toHaveLength(1);
  return insertOps[0];
}

describe('accessDao.insertAccessIfAbsent（计费权威，FR-015/FR-017）', () => {
  test('RETURNING 有行 → true（首次获取，需计费）', async () => {
    const { db, ops } = createMockDb({
      insertReturningRows: new Map<unknown, unknown[]>([[userSolutionAccess, [{ userId: 'u-1' }]]]),
    });

    const inserted = await accessDao.insertAccessIfAbsent('u-1', 'hash-1', asTx(db));

    expect(inserted).toBe(true);
    const op = firstInsertOp(ops);
    expect(op.conflict).toBe('doNothing');
    expect(op.table).toBe(userSolutionAccess);
    expect(op.target).toEqual([userSolutionAccess.userId, userSolutionAccess.contentHash]);
    expect(op.values).toEqual({ userId: 'u-1', contentHash: 'hash-1' });
  });

  test('RETURNING 空（唯一约束冲突）→ false（已获取过，免费返回，AC-015）', async () => {
    const { db } = createMockDb({ insertReturningRows: new Map() });

    const inserted = await accessDao.insertAccessIfAbsent('u-1', 'hash-1', asTx(db));

    expect(inserted).toBe(false);
  });
});

describe('billingDao.insertBillingRecord（AR1-008 成对 CHECK：consume 带 hash / recharge 不带）', () => {
  test('consume 流水：字段映射完整', async () => {
    const { db, ops } = useTx();

    await billingDao.insertBillingRecord(
      {
        userId: 'u-1',
        contentHash: 'hash-1',
        type: 'consume',
        amount: 1,
        balanceAfter: 4,
      },
      asTx(db),
    );

    const op = firstInsertOp(ops);
    expect(op.table).toBe(billingRecords);
    expect(op.conflict).toBe('none'); // 流水表追加写，无 upsert 语义
    expect(op.values).toEqual({
      userId: 'u-1',
      contentHash: 'hash-1',
      type: 'consume',
      amount: 1,
      balanceAfter: 4,
      operator: undefined,
      remark: undefined,
    });
  });

  test('recharge 流水：contentHash 为 null + operator/remark 透传', async () => {
    const { db, ops } = useTx();

    await billingDao.insertBillingRecord(
      {
        userId: 'u-1',
        contentHash: null,
        type: 'recharge',
        amount: 10,
        balanceAfter: 12,
        operator: 'admin',
        remark: '人工充值',
      },
      asTx(db),
    );

    const op = firstInsertOp(ops);
    expect(op.values).toEqual({
      userId: 'u-1',
      contentHash: null,
      type: 'recharge',
      amount: 10,
      balanceAfter: 12,
      operator: 'admin',
      remark: '人工充值',
    });
  });
});

describe('billingDao.insertSolveRecord（FR-008，AR1-021 唯一写入点）', () => {
  test('platform 输入记录：字段映射完整', async () => {
    const { db, ops } = useTx();

    await billingDao.insertSolveRecord(
      {
        userId: 'u-1',
        jobId: 'job-1',
        inputType: 'platform',
        platform: 'luogu',
        problemId: 'P1001',
        sampleFp: 'fp-1',
        contentHash: 'hash-1',
        cached: false,
        validated: true,
        billed: true,
      },
      asTx(db),
    );

    const op = firstInsertOp(ops);
    expect(op.table).toBe(solveRecords);
    expect(op.values).toEqual({
      userId: 'u-1',
      jobId: 'job-1',
      inputType: 'platform',
      platform: 'luogu',
      problemId: 'P1001',
      sampleFp: 'fp-1',
      contentHash: 'hash-1',
      cached: false,
      validated: true,
      billed: true,
    });
  });

  test('text 输入记录：platform/problemId/sampleFp 缺省为 undefined', async () => {
    const { db, ops } = useTx();

    await billingDao.insertSolveRecord(
      {
        userId: 'u-1',
        jobId: 'job-2',
        inputType: 'text',
        contentHash: 'hash-2',
        cached: true,
        validated: false,
        billed: false,
      },
      asTx(db),
    );

    const op = firstInsertOp(ops);
    expect(op.values).toMatchObject({
      inputType: 'text',
      platform: undefined,
      problemId: undefined,
      sampleFp: undefined,
      contentHash: 'hash-2',
      cached: true,
      billed: false,
    });
  });
});
