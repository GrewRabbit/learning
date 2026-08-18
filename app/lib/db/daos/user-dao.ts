// app/lib/db/daos/user-dao.ts
// 用户域 DAO（用户 + 额度账户，架构 §5.1；AR1-010 粒度定稿：quota 域并入本文件）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 方法分两类：
// - getOrCreateUser：自管事务（AD-05 单事务幂等建档），返回 ServiceResult
// - deductFreeFirst / getBalance / addRecharge：仅事务内调用（tx 注入），
//   返回原始值、错误向上抛给事务持有者（billing-service）归类（架构 §5.1）

import { eq, sql } from 'drizzle-orm';
import type { ServiceResult } from '@/app/lib/ai/types';
import { getDb, type DbTx } from '@/app/lib/db/connection';
import { classifyDbError } from '@/app/lib/db/errors';
import { quotaAccounts, users } from '@/app/lib/db/schema';

/** deductFreeFirst 的 RETURNING 行（pg 返回 snake_case 列名） */
type DeductRow = {
  old_free_balance: number;
  old_recharge_balance: number;
  new_free_balance: number;
  new_recharge_balance: number;
};

export const userDao = {
  /**
   * 幂等建档（AD-05，FR-006/AC-004/AC-005）：单事务内
   * ① INSERT users ON CONFLICT (sso_sub) DO NOTHING（并发同 sub 仅 1 条，唯一约束幂等）
   * ② SELECT id（①后必然可见：本事务插入或并发事务已提交）
   * ③ INSERT quota_accounts ON CONFLICT (user_id) DO NOTHING（freeBalance=赠送额度）
   *
   * 注：任务书语句序为「建档→建账户→查 id」，因 quota_accounts.user_id 外键需要
   * users.id，调整为「建档→查 id→建账户」，同一事务内语义等价。
   */
  async getOrCreateUser(sub: string, freeQuotaInitial: number): Promise<ServiceResult<{ userId: string }>> {
    try {
      const userId = await getDb().transaction(async (tx) => {
        await tx.insert(users).values({ ssoSub: sub }).onConflictDoNothing({ target: users.ssoSub });

        const rows = await tx.select({ id: users.id }).from(users).where(eq(users.ssoSub, sub)).limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new Error('GESP6_USER_CREATE_FAILED: 建档后未查询到用户记录（数据异常）');
        }

        await tx
          .insert(quotaAccounts)
          .values({ userId: row.id, freeBalance: freeQuotaInitial, rechargeBalance: 0 })
          .onConflictDoNothing({ target: quotaAccounts.userId });
        return row.id;
      });
      return { success: true, data: { userId } };
    } catch (error) {
      // 连接类 → GESP6_DB_UNAVAILABLE（503）；其余 → GESP6_USER_CREATE_FAILED（500，§5.3）
      const classified = classifyDbError(error, 'generic');
      return classified !== null
        ? { success: false, error: { code: classified.code, message: '数据库暂不可用，用户建档失败' } }
        : { success: false, error: { code: 'GESP6_USER_CREATE_FAILED', message: '用户建档失败' } };
    }
  },

  /**
   * 免费优先扣减（§4.3 定稿 SQL 语义 / AR1-017）：单条 CASE WHEN 条件 UPDATE
   *
   * - SET 表达式引用更新前的行值（旧 free_balance），免费优先判定与扣减在同一
   *   行快照内原子完成，无「先判后扣」竞态窗口（AR1-017）
   * - WHERE 条件保证余额永不为负；影响 0 行 → 'insufficient'（调用方回滚事务）
   * - RETURNING 同时返回旧值（FROM 子查询，语句级快照）与新值（更新后行），
   *   按 free_balance 扣减前后是否变化判定 'free' / 'recharge'（单语句单次往返）
   * - 参数化 Drizzle sql 模板，禁止字符串拼接（FR-032）
   */
  async deductFreeFirst(userId: string, price: number, tx: DbTx): Promise<'free' | 'recharge' | 'insufficient'> {
    const result = await tx.execute<DeductRow>(sql`
      UPDATE quota_accounts AS qa
      SET
        free_balance = CASE WHEN qa.free_balance >= ${price} THEN qa.free_balance - ${price} ELSE qa.free_balance END,
        recharge_balance = CASE
          WHEN qa.free_balance >= ${price} THEN qa.recharge_balance
          WHEN qa.recharge_balance >= ${price} THEN qa.recharge_balance - ${price}
          ELSE qa.recharge_balance
        END,
        updated_at = now()
      FROM (
        SELECT user_id, free_balance, recharge_balance
        FROM quota_accounts
        WHERE user_id = ${userId}
      ) AS prev
      WHERE qa.user_id = prev.user_id
        AND (qa.free_balance >= ${price} OR qa.recharge_balance >= ${price})
      RETURNING
        prev.free_balance AS old_free_balance,
        prev.recharge_balance AS old_recharge_balance,
        qa.free_balance AS new_free_balance,
        qa.recharge_balance AS new_recharge_balance
    `);
    const rows = result.rows;
    if (rows.length === 0) {
      return 'insufficient';
    }
    const row = rows[0];
    return row.old_free_balance !== row.new_free_balance ? 'free' : 'recharge';
  },

  /**
   * 查询双列余额（事务内，§4.3：balanceAfter = free + recharge 之和由调用方计算）
   * 账户行缺失视为数据异常，抛错交由事务持有者处理
   */
  async getBalance(userId: string, tx: DbTx): Promise<{ freeBalance: number; rechargeBalance: number }> {
    const rows = await tx
      .select({ freeBalance: quotaAccounts.freeBalance, rechargeBalance: quotaAccounts.rechargeBalance })
      .from(quotaAccounts)
      .where(eq(quotaAccounts.userId, userId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('GESP6_BILLING_DEDUCT_FAILED: 额度账户记录不存在（数据异常）');
    }
    return row;
  },

  /** 充值（FR-020，事务内）：充值额度增量累加，updated_at 取数据库时钟 */
  async addRecharge(userId: string, amount: number, tx: DbTx): Promise<void> {
    await tx
      .update(quotaAccounts)
      .set({
        rechargeBalance: sql`${quotaAccounts.rechargeBalance} + ${amount}`,
        updatedAt: sql`now()`,
      })
      .where(eq(quotaAccounts.userId, userId));
  },
};
