// tests/integration-tests/db-billing.test.ts
// 计费链路真实库集成测试（T8，架构 §6 / 实施进度「T8 待启动定义」）
//
// 覆盖矩阵（真实 PostgreSQL 行为，mock 无法验证的部分）：
// - AC-005：并发 10 个相同 sub 首次建档 → users 仅 1 条（唯一约束生效）
// - AC-015：并发 10 个 (user, contentHash) settle → 仅计费 1 次（唯一约束 + 事务生效）
// - AC-019：新用户建档后获得 GESP6_FREE_QUOTA_INITIAL 次免费额度
// - AC-018：人工充值（type=recharge，含 operator/remark）后余额按金额增加，流水完整
// - 真实 settle 全链路：首次获取计费 1 次 + 流水 + solve_records；再次获取免费（AC-011/012 真实库复核）
// - AC-013：用户 A 已获取后，用户 B 首次获取同一 contentHash → B 计费（用户维度隔离）
//
// 隔离策略（实施进度 T8 定义）：测试用户/内容用唯一前缀 e2e-billing-it-{ts}，
// 每个测试前后清理自身数据，不污染生产数据。
//
// 运行前提：.env.local 含 DATABASE_URL（真实库 gesp6_billing）。模块加载时读取。

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, getPool } from '@/app/lib/db/connection';
import { userDao } from '@/app/lib/db/daos/user-dao';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';
import { billingService } from '@/app/lib/billing/billing-service';
import {
  billingRecords,
  quotaAccounts,
  solveRecords,
  userSolutionAccess,
  users,
} from '@/app/lib/db/schema';

// 模块加载时读取 .env.local（与 migrate.ts / 导入脚本一致）
try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local 缺失：后续用例抛 GESP6_DB_UNAVAILABLE，测试自然失败并给出清晰错误
}

const FREE_QUOTA_INITIAL = Number(process.env.GESP6_FREE_QUOTA_INITIAL ?? 5);
const SOLUTION_PRICE = Number(process.env.GESP6_SOLUTION_PRICE ?? 1);

/** 每个测试独立的前缀（含随机 UUID，避免跨 run 冲突） */
let testPrefix = '';

/** 本测试文件创建的所有用户 id，afterEach 统一清理 */
let createdUserIds: string[] = [];
/** 本测试文件写入的所有 contentHash，afterEach 统一清理 */
let createdContentHashes: string[] = [];

function uniqueTag(): string {
  return `e2e-billing-it-${randomUUID()}`;
}

/** 直接建用户 + 额度账户（绕过 getOrCreateUser，测试用例按需调用） */
async function createUserDirect(sub: string, freeBalance = 5): Promise<{ userId: string }> {
  const result = await getDb()
    .insert(users)
    .values({ ssoSub: sub })
    .onConflictDoNothing({ target: users.ssoSub })
    .returning({ id: users.id });
  let userId = result[0]?.id;
  if (userId === undefined) {
    const rows = await getDb().select({ id: users.id }).from(users).where(sql`${users.ssoSub} = ${sub}`).limit(1);
    userId = rows[0]?.id;
  }
  if (userId === undefined) {
    throw new Error('测试前置：创建用户失败');
  }
  await getDb()
    .insert(quotaAccounts)
    .values({ userId, freeBalance, rechargeBalance: 0 })
    .onConflictDoNothing({ target: quotaAccounts.userId });
  createdUserIds.push(userId);
  return { userId };
}

/** 清理本文件测试数据（逆序删 FK 依赖子表） */
async function cleanup(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const contentHash of createdContentHashes) {
      await client.query('DELETE FROM user_solution_access WHERE content_hash = $1', [contentHash]);
    }
    for (const userId of createdUserIds) {
      await client.query('DELETE FROM billing_records WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM solve_records WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_solution_access WHERE user_id = $1', [userId]);
    }
    for (const userId of createdUserIds) {
      await client.query('DELETE FROM quota_accounts WHERE user_id = $1', [userId]);
    }
    for (const userId of createdUserIds) {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    for (const contentHash of createdContentHashes) {
      await client.query('DELETE FROM solutions WHERE content_hash = $1', [contentHash]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** 注册 contentHash：记录待清理 + 插入 solutions 行（settle 的 FK 前置，schema §4.6/4.8） */
async function registerContentHash(contentHash: string): Promise<void> {
  createdContentHashes.push(contentHash);
  await solutionDao.insertIfAbsentSolution(contentHash, {
    html: '<html>t8-integration-test</html>',
    validated: true,
    warning: undefined,
    cached: false,
    contentHash,
  });
}

/** 统计某用户某 contentHash 的 consume 流水数 */
async function countConsume(userId: string, contentHash: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(billingRecords)
    .where(sql`${billingRecords.userId} = ${userId} AND ${billingRecords.contentHash} = ${contentHash} AND ${billingRecords.type} = 'consume'`);
  return rows[0]?.n ?? 0;
}

/** 查询某用户当前余额（双列和） */
async function getBalanceTotal(userId: string): Promise<number> {
  const rows = await getDb()
    .select({
      free: quotaAccounts.freeBalance,
      recharge: quotaAccounts.rechargeBalance,
    })
    .from(quotaAccounts)
    .where(sql`${quotaAccounts.userId} = ${userId}`)
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error('测试前置：余额账户不存在');
  return row.free + row.recharge;
}

beforeEach(() => {
  testPrefix = uniqueTag();
});

afterEach(async () => {
  await cleanup();
  createdUserIds = [];
  createdContentHashes = [];
});

describe('真实库：并发建档唯一性（AC-005）', () => {
  test('并发 10 个相同 sub 首次请求 → users 仅 1 条记录', async () => {
    const sub = testPrefix;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL)),
    );
    expect(results.every((r) => r.success)).toBe(true);
    const ids = results.map((r) => (r.success && r.data ? r.data.userId : ''));
    expect(new Set(ids).size).toBe(1);
    const rows = await getDb()
      .select({ id: users.id, quotaFree: quotaAccounts.freeBalance })
      .from(users)
      .innerJoin(quotaAccounts, sql`${quotaAccounts.userId} = ${users.id}`)
      .where(sql`${users.ssoSub} = ${sub}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quotaFree).toBe(FREE_QUOTA_INITIAL);
    const firstId = rows[0]?.id;
    if (firstId) createdUserIds.push(firstId);
  });
});

describe('真实库：新用户建档赠额（AC-019）', () => {
  test('getOrCreateUser 后 quota_accounts.free_balance = GESP6_FREE_QUOTA_INITIAL', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    expect(result.success).toBe(true);
    const userId = result.success && result.data ? result.data.userId : '';
    expect(userId).toBeTruthy();
    createdUserIds.push(userId);
    const balance = await getBalanceTotal(userId);
    expect(balance).toBe(FREE_QUOTA_INITIAL);
  });
});

describe('真实库：settle 全链路（AC-011/012/013）', () => {
  test('首次获取计费 1 次（charged=true、余额-1、consume 流水 1 条、solve_records billed=true）', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const contentHash = uniqueTag();
    await registerContentHash(contentHash);
    const before = await getBalanceTotal(userId);

    const settle = await billingService.settleSuccessfulSolution({
      userId,
      contentHash,
      jobId: uniqueTag(),
      inputType: 'text',
      cached: false,
      validated: true,
    });
    expect(settle.success).toBe(true);
    expect(settle.data?.charged).toBe(true);
    expect(settle.data?.balanceRemaining).toBe(before - SOLUTION_PRICE);
    expect(await countConsume(userId, contentHash)).toBe(1);

    const sr = await getDb()
      .select({ billed: solveRecords.billed, cached: solveRecords.cached })
      .from(solveRecords)
      .where(sql`${solveRecords.userId} = ${userId} AND ${solveRecords.contentHash} = ${contentHash}`)
      .limit(1);
    expect(sr[0]?.billed).toBe(true);
    expect(sr[0]?.cached).toBe(false);
  });

  test('再次获取同一 contentHash → 免费（charged=false、不新增流水、余额不变）', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const contentHash = uniqueTag();
    await registerContentHash(contentHash);

    await billingService.settleSuccessfulSolution({
      userId, contentHash, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    const balanceAfterFirst = await getBalanceTotal(userId);

    const settle2 = await billingService.settleSuccessfulSolution({
      userId, contentHash, jobId: uniqueTag(), inputType: 'text', cached: true, validated: true,
    });
    expect(settle2.success).toBe(true);
    expect(settle2.data?.charged).toBe(false);
    expect(settle2.data?.balanceRemaining).toBe(balanceAfterFirst);
    expect(await countConsume(userId, contentHash)).toBe(1); // 仍为 1，无新增

    const sr = await getDb()
      .select({ billed: solveRecords.billed })
      .from(solveRecords)
      .where(sql`${solveRecords.userId} = ${userId} AND ${solveRecords.contentHash} = ${contentHash}`)
      .orderBy(sql`created_at DESC`)
      .limit(1);
    expect(sr[0]?.billed).toBe(false); // 免费返回仍写 solve_record（billed=false）
  });

  test('用户 A 已获取后，用户 B 首次获取同一 contentHash → B 计费（AC-013 用户隔离）', async () => {
    const subA = testPrefix + '-a';
    const subB = testPrefix + '-b';
    const ra = await userDao.getOrCreateUser(subA, FREE_QUOTA_INITIAL);
    const rb = await userDao.getOrCreateUser(subB, FREE_QUOTA_INITIAL);
    const userIdA = ra.success && ra.data ? ra.data.userId : '';
    const userIdB = rb.success && rb.data ? rb.data.userId : '';
    createdUserIds.push(userIdA, userIdB);
    const contentHash = uniqueTag();
    await registerContentHash(contentHash);

    await billingService.settleSuccessfulSolution({
      userId: userIdA, contentHash, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    const balanceBBefore = await getBalanceTotal(userIdB);
    const settleB = await billingService.settleSuccessfulSolution({
      userId: userIdB, contentHash, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    expect(settleB.success).toBe(true);
    expect(settleB.data?.charged).toBe(true);
    expect(settleB.data?.balanceRemaining).toBe(balanceBBefore - SOLUTION_PRICE);
    expect(await countConsume(userIdB, contentHash)).toBe(1);
  });

  test('同一用户两种解法（不同 contentHash）→ 各计费 1 次，累计 2 次（AC-014）', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const contentHashA = uniqueTag();
    const contentHashB = uniqueTag();
    await registerContentHash(contentHashA);
    await registerContentHash(contentHashB);
    const before = await getBalanceTotal(userId);

    const settleA = await billingService.settleSuccessfulSolution({
      userId, contentHash: contentHashA, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    const settleB = await billingService.settleSuccessfulSolution({
      userId, contentHash: contentHashB, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });

    expect(settleA.success).toBe(true);
    expect(settleA.data?.charged).toBe(true);
    expect(settleB.success).toBe(true);
    expect(settleB.data?.charged).toBe(true);
    // 累计计费：两种解法各扣 1 次
    expect(await countConsume(userId, contentHashA)).toBe(1);
    expect(await countConsume(userId, contentHashB)).toBe(1);
    expect(await getBalanceTotal(userId)).toBe(before - 2 * SOLUTION_PRICE);
  });
});

describe('真实库：余额边界（AC-017）', () => {
  test('余额恰好等于价格：扣费成功、余额归 0；后续请求被拒（GESP6_BILLING_INSUFFICIENT_BALANCE）', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, 1); // 余额 = 1 = price（默认 1）
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const contentHash = uniqueTag();
    await registerContentHash(contentHash);
    expect(await getBalanceTotal(userId)).toBe(1);

    const settle = await billingService.settleSuccessfulSolution({
      userId, contentHash, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    expect(settle.success).toBe(true);
    expect(settle.data?.charged).toBe(true);
    expect(settle.data?.balanceRemaining).toBe(0); // 余额恰好扣完

    // 后续新解法请求被拒（AC-016 边界联动）
    const contentHash2 = uniqueTag();
    await registerContentHash(contentHash2);
    const settle2 = await billingService.settleSuccessfulSolution({
      userId, contentHash: contentHash2, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
    });
    expect(settle2.success).toBe(false);
    expect(settle2.error?.code).toBe('GESP6_BILLING_INSUFFICIENT_BALANCE');
    expect(await getBalanceTotal(userId)).toBe(0);
  });
});

describe('真实库：并发 settle 唯一性（AC-015）', () => {
  test('并发 10 个同一 (user, contentHash) settle → 仅计费 1 次（consume 流水 1 条、余额仅扣 1 次）', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const contentHash = uniqueTag();
    await registerContentHash(contentHash);
    const before = await getBalanceTotal(userId);

    const settles = await Promise.all(
      Array.from({ length: 10 }, () =>
        billingService.settleSuccessfulSolution({
          userId, contentHash, jobId: uniqueTag(), inputType: 'text', cached: false, validated: true,
        }),
      ),
    );
    const chargedCount = settles.filter((s) => s.success && s.data?.charged === true).length;
    expect(chargedCount).toBe(1);
    expect(await countConsume(userId, contentHash)).toBe(1);
    expect(await getBalanceTotal(userId)).toBe(before - SOLUTION_PRICE);
  });
});

describe('真实库：人工充值（AC-018）', () => {
  test('rechargeBalance(amount=3, operator/remark) → 余额+3、type=recharge 流水含 operator/remark', async () => {
    const sub = testPrefix;
    const result = await userDao.getOrCreateUser(sub, FREE_QUOTA_INITIAL);
    const userId = result.success && result.data ? result.data.userId : '';
    createdUserIds.push(userId);
    const before = await getBalanceTotal(userId);

    const recharge = await billingService.rechargeBalance({
      userId,
      amount: 3,
      operator: 't8-integration-test',
      remark: '集成测试充值',
    });
    expect(recharge.success).toBe(true);
    expect(recharge.data?.balanceRemaining).toBe(before + 3);
    expect(await getBalanceTotal(userId)).toBe(before + 3);

    const recs = await getDb()
      .select({ type: billingRecords.type, amount: billingRecords.amount, operator: billingRecords.operator, remark: billingRecords.remark })
      .from(billingRecords)
      .where(sql`${billingRecords.userId} = ${userId} AND ${billingRecords.type} = 'recharge'`);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.amount).toBe(3);
    expect(recs[0]?.operator).toBe('t8-integration-test');
    expect(recs[0]?.remark).toBe('集成测试充值');
  });
});