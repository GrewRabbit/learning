// app/lib/billing/billing-service.ts
// 计费服务（架构 D2 / §5.1）：settleSuccessfulSolution 单事务原子计费（AD-04 / §4.1 b / §4.3）、
// rechargeBalance 人工充值（FR-020）。事务封装在本服务内（R-08），DAO 仅收 tx 注入，route 不感知事务。
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 计费语义核心（FR-015/FR-017）：以 user_solution_access 唯一约束为唯一计费权威；
// cached/validated 仅透传写入 solve_records，不影响计费与否（AR1-020）；
// solve_records 唯一写入点为本服务（AR1-021，route 回调不单独写）。

import type { ServiceResult } from '@/app/lib/ai/types';
import { getDb, type DbTx } from '@/app/lib/db/connection';
import { accessDao } from '@/app/lib/db/daos/access-dao';
import { billingDao } from '@/app/lib/db/daos/billing-dao';
import type { SolveRecordParams } from '@/app/lib/db/daos/billing-dao';
import { userDao } from '@/app/lib/db/daos/user-dao';
import { classifyDbError } from '@/app/lib/db/errors';
import { logger } from '@/app/lib/logging/logger';

/** settleSuccessfulSolution 入参（架构 §5.1 原样） */
export interface SettleSuccessfulSolutionParams {
  userId: string;
  contentHash: string;
  jobId: string;
  inputType: 'text' | 'image' | 'platform';
  platform?: string;
  problemId?: string;
  sampleFp?: string;
  /** 是否缓存命中（仅透传 solve_records，不影响计费判定，AR1-020） */
  cached: boolean;
  /** 是否通过编译验证（仅透传，AR1-020） */
  validated: boolean;
}

/** rechargeBalance 入参（架构 §5.1） */
export interface RechargeBalanceParams {
  userId: string;
  /** 充值次数（正整数，次数口径 AR1-011） */
  amount: number;
  /** 人工充值操作人标识（FR-020） */
  operator: string;
  remark?: string;
}

/** 单次计费价格（GESP6_SOLUTION_PRICE，默认 1；非正整数容错回退默认，§7.2 / FR-016） */
function getPrice(): number {
  const parsed = Number(process.env.GESP6_SOLUTION_PRICE);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** 额度不足业务标记异常：事务回调内抛出触发回滚（access 插入一并回滚，§4.3），由 settle 捕获转 ServiceResult（§5.1） */
class InsufficientBalanceError extends Error {
  constructor() {
    super('insufficient balance');
    this.name = 'InsufficientBalanceError';
  }
}

/** solve_records 参数构造（cached/validated 仅透传，billed 按判定结果） */
function buildSolveRecord(p: SettleSuccessfulSolutionParams, billed: boolean): SolveRecordParams {
  return {
    userId: p.userId,
    jobId: p.jobId,
    inputType: p.inputType,
    platform: p.platform,
    problemId: p.problemId,
    sampleFp: p.sampleFp,
    contentHash: p.contentHash,
    cached: p.cached,
    validated: p.validated,
    billed,
  };
}

/**
 * 事务异常 → ServiceResult（架构 §5.3，不抛未捕获异常）
 * 连接类 → GESP6_BILLING_DB_UNAVAILABLE；其余 → GESP6_BILLING_DEDUCT_FAILED。
 * 日志仅记 code 与 errorName，不携带数据库错误详情（NFR-005）。
 */
function toBillingFailure(
  operation: 'settle' | 'recharge',
  error: unknown,
  context: Record<string, unknown>,
): ServiceResult<never> {
  const classified = classifyDbError(error, 'billing');
  const code = classified?.code ?? 'GESP6_BILLING_DEDUCT_FAILED';
  const message = classified !== null ? '数据库暂不可用，计费处理失败' : '计费处理失败';
  logger.error('billing: 事务失败', {
    ...context,
    operation,
    code,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return { success: false, error: { code, message } };
}

export class BillingService {
  /**
   * 解题成功结算（AD-04 / §4.1 b）：单事务六步——
   * ① accessDao.insertAccessIfAbsent（唯一约束，计费唯一权威，FR-015/FR-017）
   *    已获取过（false）→ ② getBalance → ③ insertSolveRecord(billed=false) → COMMIT →
   *    { charged: false, balanceRemaining: 双列和 }（AC-012，免费返回）
   *    首次（true）→ ④ deductFreeFirst（单条 CASE WHEN 免费优先，§4.3 / AR1-017）
   *      'insufficient' → 抛 InsufficientBalanceError 回滚 → GESP6_BILLING_INSUFFICIENT_BALANCE（FR-019）
   *      'free' | 'recharge' → ⑤ getBalance（已持行锁读一致）→ insertBillingRecord(consume)
   *      → ⑥ insertSolveRecord(billed=true) → COMMIT → { charged: true, balanceRemaining }
   */
  async settleSuccessfulSolution(
    p: SettleSuccessfulSolutionParams,
  ): Promise<ServiceResult<{ charged: boolean; balanceRemaining: number | null }>> {
    try {
      const price = getPrice();
      const outcome = await getDb().transaction(async (tx: DbTx) => {
        const isFirstAccess = await accessDao.insertAccessIfAbsent(p.userId, p.contentHash, tx);
        if (!isFirstAccess) {
          const balance = await userDao.getBalance(p.userId, tx);
          const balanceRemaining = balance.freeBalance + balance.rechargeBalance; // 双列和，AR1-011
          await billingDao.insertSolveRecord(buildSolveRecord(p, false), tx);
          return { charged: false as const, balanceRemaining };
        }

        const source = await userDao.deductFreeFirst(p.userId, price, tx);
        if (source === 'insufficient') {
          // 0 行 → 额度不足 → 回滚（access 插入一并回滚，§4.3），外层转 ServiceResult
          throw new InsufficientBalanceError();
        }
        const balance = await userDao.getBalance(p.userId, tx); // 事务内已持行锁，读一致（§4.3）
        const balanceRemaining = balance.freeBalance + balance.rechargeBalance; // 双列和，AR1-011
        await billingDao.insertBillingRecord(
          { userId: p.userId, contentHash: p.contentHash, type: 'consume', amount: price, balanceAfter: balanceRemaining },
          tx,
        );
        await billingDao.insertSolveRecord(buildSolveRecord(p, true), tx);
        return { charged: true as const, balanceRemaining, source };
      });

      if (outcome.charged) {
        logger.info('billing settle: 首次获取计费', {
          jobId: p.jobId,
          userId: p.userId,
          balanceRemaining: outcome.balanceRemaining,
          source: outcome.source,
        });
      } else {
        logger.info('billing settle: 已获取过免费返回', {
          jobId: p.jobId,
          userId: p.userId,
          balanceRemaining: outcome.balanceRemaining,
        });
      }
      return { success: true, data: { charged: outcome.charged, balanceRemaining: outcome.balanceRemaining } };
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        logger.warn('billing settle: 额度不足', { jobId: p.jobId, userId: p.userId, price: getPrice() });
        return {
          success: false,
          error: { code: 'GESP6_BILLING_INSUFFICIENT_BALANCE', message: '余额不足，请联系管理员充值' },
        };
      }
      return toBillingFailure('settle', error, { jobId: p.jobId, userId: p.userId });
    }
  }

  /**
   * 人工充值（FR-020 / AR1-008）：单事务 addRecharge → getBalance →
   * insertBillingRecord(type=recharge, contentHash=null, operator/remark) → COMMIT。
   * amount 非正整数直接拒绝（不触 DB）。
   */
  async rechargeBalance(p: RechargeBalanceParams): Promise<ServiceResult<{ balanceRemaining: number }>> {
    if (!Number.isInteger(p.amount) || p.amount <= 0) {
      return { success: false, error: { code: 'GESP6_BILLING_DEDUCT_FAILED', message: '充值金额必须为正整数' } };
    }
    try {
      const balanceRemaining = await getDb().transaction(async (tx: DbTx) => {
        await userDao.addRecharge(p.userId, p.amount, tx);
        const balance = await userDao.getBalance(p.userId, tx);
        const balanceAfter = balance.freeBalance + balance.rechargeBalance; // 双列和，AR1-011
        await billingDao.insertBillingRecord(
          {
            userId: p.userId,
            contentHash: null, // recharge 无 contentHash（AR1-008 成对 CHECK）
            type: 'recharge',
            amount: p.amount,
            balanceAfter,
            operator: p.operator,
            remark: p.remark,
          },
          tx,
        );
        return balanceAfter;
      });
      logger.info('billing recharge: 充值成功', {
        userId: p.userId,
        amount: p.amount,
        balanceRemaining,
        operator: p.operator,
      });
      return { success: true, data: { balanceRemaining } };
    } catch (error) {
      return toBillingFailure('recharge', error, { userId: p.userId, amount: p.amount });
    }
  }
}

/** 单例导出（api-conventions.md） */
export const billingService = new BillingService();
