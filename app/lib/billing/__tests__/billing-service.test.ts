// app/lib/billing/__tests__/billing-service.test.ts
// BillingService 单元测试（架构 §4.1 b settle 六步 / §5.1 两方法签名 / §5.3 错误码；全 mock 零真实 DB）
//
// 覆盖（AC/AR 映射）：
// - AC-011 首次获取计费（consume 流水 amount/balanceAfter + billed=true 解题记录）
// - AC-012 已获取过免费（不扣费、无 consume 流水、billed=false、balanceRemaining=双列和 AR1-011）
// - AR1-017 免费优先 'recharge' 分支同样计费成功
// - AC-016 额度不足（错误码 + 「余额不足，请联系管理员充值」文案 + 事务回滚 + 无流水无记录）
// - AC-026 fail-closed 服务层（连接类 → GESP6_BILLING_DB_UNAVAILABLE；其他 → GESP6_BILLING_DEDUCT_FAILED）
// - §7.2 GESP6_SOLUTION_PRICE 价格读取（默认 1 / 环境覆盖）
// - AR1-020 cached/validated 仅透传 solve_records、不影响计费判定
// - AR1-008 rechargeBalance（type=recharge、contentHash=null、operator/remark、双列和）+ 参数校验 + DB 异常分类

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDb, type Db, type DbTx } from '@/app/lib/db/connection';
import { accessDao } from '@/app/lib/db/daos/access-dao';
import { billingDao } from '@/app/lib/db/daos/billing-dao';
import { userDao } from '@/app/lib/db/daos/user-dao';
import { connectionError } from '@/app/lib/db/daos/__tests__/mock-db';
import { logger } from '@/app/lib/logging/logger';
import { billingService } from '@/app/lib/billing/billing-service';

// mock 四 DAO 模块 + 连接 + logger（billing-service 不触碰真实 pg/Pool）
vi.mock('@/app/lib/db/connection', () => ({ getDb: vi.fn() }));
vi.mock('@/app/lib/db/daos/user-dao', () => ({
  userDao: { deductFreeFirst: vi.fn(), getBalance: vi.fn(), addRecharge: vi.fn() },
}));
vi.mock('@/app/lib/db/daos/access-dao', () => ({
  accessDao: { insertAccessIfAbsent: vi.fn() },
}));
vi.mock('@/app/lib/db/daos/billing-dao', () => ({
  billingDao: { insertBillingRecord: vi.fn(), insertSolveRecord: vi.fn() },
}));
vi.mock('@/app/lib/logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** settle 入参基线（架构 §5.1 原样形状，platform 输入） */
const SETTLE_INPUT = {
  userId: 'user-1',
  contentHash: 'hash-abc',
  jobId: 'job-1',
  inputType: 'platform',
  platform: 'luogu',
  problemId: 'P11447',
  sampleFp: 'fp-1',
  cached: true,
  validated: true,
} as const;

/**
 * 事务 mock：callback 正常 resolve 才置 committed；异常向上传播（Drizzle 真实语义为
 * 回滚），committed 保持 false 供断言回滚语义（AC-016）
 */
function useTransactionMock(): { tx: DbTx; isCommitted: () => boolean } {
  const tx = {} as DbTx;
  let committed = false;
  const db = {
    transaction: async (callback: (tx: DbTx) => Promise<unknown>): Promise<unknown> => {
      const result = await callback(tx);
      committed = true;
      return result;
    },
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as Db);
  return { tx, isCommitted: () => committed };
}

beforeEach(() => {
  delete process.env.GESP6_SOLUTION_PRICE;
  vi.mocked(getDb).mockReset();
  vi.mocked(accessDao.insertAccessIfAbsent).mockReset().mockResolvedValue(true);
  vi.mocked(userDao.deductFreeFirst).mockReset().mockResolvedValue('free');
  vi.mocked(userDao.getBalance).mockReset().mockResolvedValue({ freeBalance: 2, rechargeBalance: 3 });
  vi.mocked(userDao.addRecharge).mockReset().mockResolvedValue(undefined);
  vi.mocked(billingDao.insertBillingRecord).mockReset().mockResolvedValue(undefined);
  vi.mocked(billingDao.insertSolveRecord).mockReset().mockResolvedValue(undefined);
});

describe('settleSuccessfulSolution（§4.1 b 单事务六步）', () => {
  test('首次获取：access 命中 + free 扣减 → charged=true、consume 流水与 billed=true 记录（AC-011）', async () => {
    const { tx, isCommitted } = useTransactionMock();

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    // 双列和口径：2 + 3 = 5（AR1-011）
    expect(result).toEqual({ success: true, data: { charged: true, balanceRemaining: 5 } });
    expect(isCommitted()).toBe(true);
    // 事务内调用：DAO 均收注入的 tx（R-08）
    expect(accessDao.insertAccessIfAbsent).toHaveBeenCalledWith('user-1', 'hash-abc', tx);
    expect(userDao.deductFreeFirst).toHaveBeenCalledWith('user-1', 1, tx);
    expect(userDao.getBalance).toHaveBeenCalledWith('user-1', tx);
    expect(billingDao.insertBillingRecord).toHaveBeenCalledWith(
      { userId: 'user-1', contentHash: 'hash-abc', type: 'consume', amount: 1, balanceAfter: 5 },
      tx,
    );
    expect(billingDao.insertSolveRecord).toHaveBeenCalledWith({ ...SETTLE_INPUT, billed: true }, tx);
  });

  test('已获取过：access 未命中 → 不扣费、无 consume 流水、billed=false、balanceRemaining=双列和（AC-012）', async () => {
    const { tx, isCommitted } = useTransactionMock();
    vi.mocked(accessDao.insertAccessIfAbsent).mockResolvedValue(false);

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result).toEqual({ success: true, data: { charged: false, balanceRemaining: 5 } });
    expect(isCommitted()).toBe(true);
    expect(userDao.deductFreeFirst).not.toHaveBeenCalled();
    expect(billingDao.insertBillingRecord).not.toHaveBeenCalled();
    expect(billingDao.insertSolveRecord).toHaveBeenCalledWith({ ...SETTLE_INPUT, billed: false }, tx);
  });

  test('免费额度不足、充值余额扣减（recharge 分支）→ 同样计费成功（AR1-017 分支覆盖）', async () => {
    const { isCommitted } = useTransactionMock();
    vi.mocked(userDao.deductFreeFirst).mockResolvedValue('recharge');

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result).toEqual({ success: true, data: { charged: true, balanceRemaining: 5 } });
    expect(isCommitted()).toBe(true);
    expect(billingDao.insertBillingRecord).toHaveBeenCalledTimes(1);
    expect(billingDao.insertSolveRecord).toHaveBeenCalledWith(
      expect.objectContaining({ billed: true }),
      expect.anything(),
    );
    // §8.4 打点：来源（free/recharge）
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: 'recharge' }),
    );
  });

  test('额度不足：insufficient → GESP6_BILLING_INSUFFICIENT_BALANCE + 提示文案，事务回滚、无流水无记录（AC-016）', async () => {
    const { isCommitted } = useTransactionMock();
    vi.mocked(userDao.deductFreeFirst).mockResolvedValue('insufficient');

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_BILLING_INSUFFICIENT_BALANCE');
    expect(result.error?.message).toContain('余额不足，请联系管理员充值');
    // 回滚语义：事务回调抛出未提交（access 插入一并回滚，§4.3）
    expect(isCommitted()).toBe(false);
    expect(billingDao.insertBillingRecord).not.toHaveBeenCalled();
    expect(billingDao.insertSolveRecord).not.toHaveBeenCalled();
    // §8.4 打点：额度不足分支
    expect(logger.warn).toHaveBeenCalled();
  });

  test('access 判定抛连接类错误 → GESP6_BILLING_DB_UNAVAILABLE（AC-026 fail-closed 服务层）', async () => {
    useTransactionMock();
    vi.mocked(accessDao.insertAccessIfAbsent).mockRejectedValue(
      connectionError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'),
    );

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_BILLING_DB_UNAVAILABLE');
  });

  test('写流水抛非连接类错误 → GESP6_BILLING_DEDUCT_FAILED（AC-026 fail-closed 服务层）', async () => {
    useTransactionMock();
    vi.mocked(billingDao.insertBillingRecord).mockRejectedValue(new Error('insert failed'));

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_BILLING_DEDUCT_FAILED');
  });

  test('price 读取：GESP6_SOLUTION_PRICE=3 覆盖默认 1（§7.2）', async () => {
    const { tx } = useTransactionMock();
    vi.stubEnv('GESP6_SOLUTION_PRICE', '3');

    const result = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });

    expect(result).toEqual({ success: true, data: { charged: true, balanceRemaining: 5 } });
    expect(userDao.deductFreeFirst).toHaveBeenCalledWith('user-1', 3, tx);
    expect(billingDao.insertBillingRecord).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3, balanceAfter: 5 }),
      tx,
    );
  });

  test('cached/validated 仅透传 solve_records、不影响计费判定（AR1-020）', async () => {
    const { isCommitted } = useTransactionMock();

    // 缓存未命中 + 未通过验证的降级返回：仍视为成功获取，首次计费（FR-015 降级行）
    const missResult = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT, cached: false, validated: false });
    expect(missResult).toEqual({ success: true, data: { charged: true, balanceRemaining: 5 } });
    expect(billingDao.insertSolveRecord).toHaveBeenCalledWith(
      { ...SETTLE_INPUT, cached: false, validated: false, billed: true },
      expect.anything(),
    );

    // 缓存命中但未获取过：同样计费（FR-015 第二行，计费仅依据 access 唯一约束）
    const hitResult = await billingService.settleSuccessfulSolution({ ...SETTLE_INPUT });
    expect(hitResult).toEqual({ success: true, data: { charged: true, balanceRemaining: 5 } });
    expect(isCommitted()).toBe(true);
  });
});

describe('rechargeBalance（FR-020 / AR1-008）', () => {
  test('充值成功：addRecharge + type=recharge 流水（contentHash=null、operator/remark）+ 双列和余额（AR1-008）', async () => {
    const { tx, isCommitted } = useTransactionMock();
    vi.mocked(userDao.getBalance).mockResolvedValue({ freeBalance: 2, rechargeBalance: 13 });

    const result = await billingService.rechargeBalance({ userId: 'user-1', amount: 10, operator: 'admin-1', remark: 'manual' });

    expect(result).toEqual({ success: true, data: { balanceRemaining: 15 } });
    expect(isCommitted()).toBe(true);
    expect(userDao.addRecharge).toHaveBeenCalledWith('user-1', 10, tx);
    expect(billingDao.insertBillingRecord).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        contentHash: null,
        type: 'recharge',
        amount: 10,
        balanceAfter: 15,
        operator: 'admin-1',
        remark: 'manual',
      },
      tx,
    );
  });

  test('amount 非正整数（0 / -1 / 1.5 / NaN）→ 直接拒绝，不触 DB', async () => {
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      const result = await billingService.rechargeBalance({ userId: 'user-1', amount, operator: 'admin-1' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_BILLING_DEDUCT_FAILED');
    }
    expect(getDb).not.toHaveBeenCalled();
    expect(userDao.addRecharge).not.toHaveBeenCalled();
  });

  test('充值路径抛连接类错误 → GESP6_BILLING_DB_UNAVAILABLE', async () => {
    useTransactionMock();
    vi.mocked(userDao.addRecharge).mockRejectedValue(
      connectionError('ETIMEDOUT', 'timeout expired when trying to connect'),
    );

    const result = await billingService.rechargeBalance({ userId: 'user-1', amount: 10, operator: 'admin-1' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_BILLING_DB_UNAVAILABLE');
  });

  test('充值路径抛其他错误 → GESP6_BILLING_DEDUCT_FAILED', async () => {
    useTransactionMock();
    vi.mocked(userDao.addRecharge).mockRejectedValue(new Error('update failed'));

    const result = await billingService.rechargeBalance({ userId: 'user-1', amount: 10, operator: 'admin-1' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_BILLING_DEDUCT_FAILED');
  });
});
