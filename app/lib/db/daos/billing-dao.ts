// app/lib/db/daos/billing-dao.ts
// 计费流水 DAO（billing_records + solve_records，架构 §5.1 / §4.3）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 仅事务内调用（tx 注入）；solve_records 唯一写入点为
// billingService.settleSuccessfulSolution（AR1-021），本 DAO 不做业务判定。
// 错误向上抛给事务持有者归类（连接类 → GESP6_BILLING_DB_UNAVAILABLE）。

import type { DbTx } from '@/app/lib/db/connection';
import { billingRecords, solveRecords } from '@/app/lib/db/schema';

/** 计费/充值流水参数（AR1-008 成对 CHECK：consume 必带 contentHash / recharge 必为 null；次数口径 AR1-011） */
export interface BillingRecordParams {
  userId: string;
  /** consume 必填；recharge 必为 null（数据库 CHECK 约束兜底） */
  contentHash: string | null;
  type: 'consume' | 'recharge';
  /** 正数（消耗/充值次数） */
  amount: number;
  /** 变更后 free + recharge 之和 */
  balanceAfter: number;
  /** 人工充值操作人（consume 为空） */
  operator?: string;
  remark?: string;
}

/** 解题记录参数（FR-008；platform 输入时 platform/problemId 成对，CHECK 约束兜底） */
export interface SolveRecordParams {
  userId: string;
  /** 仅溯源（job-store 不入库，FR-010） */
  jobId: string;
  inputType: 'text' | 'image' | 'platform';
  platform?: string;
  problemId?: string;
  sampleFp?: string;
  contentHash: string;
  /** 本次是否缓存命中（透传，不影响计费判定，AR1-020） */
  cached: boolean;
  /** 是否通过编译验证（透传） */
  validated: boolean;
  /** 本次是否计费（settle 判定结果） */
  billed: boolean;
}

export const billingDao = {
  /** 写入计费/充值流水 */
  async insertBillingRecord(params: BillingRecordParams, tx: DbTx): Promise<void> {
    await tx.insert(billingRecords).values({
      userId: params.userId,
      contentHash: params.contentHash,
      type: params.type,
      amount: params.amount,
      balanceAfter: params.balanceAfter,
      operator: params.operator,
      remark: params.remark,
    });
  },

  /** 写入解题记录（settle 同事务，§4.1 b） */
  async insertSolveRecord(params: SolveRecordParams, tx: DbTx): Promise<void> {
    await tx.insert(solveRecords).values({
      userId: params.userId,
      jobId: params.jobId,
      inputType: params.inputType,
      platform: params.platform,
      problemId: params.problemId,
      sampleFp: params.sampleFp,
      contentHash: params.contentHash,
      cached: params.cached,
      validated: params.validated,
      billed: params.billed,
    });
  },
};
