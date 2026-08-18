// app/lib/db/daos/access-dao.ts
// 用户已获取解法 DAO（计费权威表 user_solution_access，架构 §5.1 / §4.3）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 仅事务内调用（tx 注入，由 billing-service.settleSuccessfulSolution 持有事务）；
// 错误向上抛给事务持有者归类（连接类 → GESP6_BILLING_DB_UNAVAILABLE）。

import type { DbTx } from '@/app/lib/db/connection';
import { userSolutionAccess } from '@/app/lib/db/schema';

export const accessDao = {
  /**
   * 插入「用户已获取」记录（FR-015/FR-017，AC-015）：
   * ON CONFLICT (user_id, content_hash) DO NOTHING + RETURNING——
   * 并发同键完成回调仅一方插入成功，失败方判定「已获取过」免费返回，仅计费 1 次。
   *
   * @returns true=首次获取（需计费）/ false=已获取过（免费返回）
   */
  async insertAccessIfAbsent(userId: string, contentHash: string, tx: DbTx): Promise<boolean> {
    const rows = await tx
      .insert(userSolutionAccess)
      .values({ userId, contentHash })
      .onConflictDoNothing({ target: [userSolutionAccess.userId, userSolutionAccess.contentHash] })
      .returning({ userId: userSolutionAccess.userId });
    return rows.length > 0;
  },
};
