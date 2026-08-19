// app/api/solve/settle-callback.ts
// 完成回调计费分支（架构 §4.1 b / FR-028 / AR1-005 / AR1-006 / AC-016 / AC-026）：
// 从 route.ts 提取以保持其单文件 ≤500 行（G1）。
// 职责：solve 成功且前置取消检查通过后——
//   userId=null（fail-open 建档放行）→ 跳过 DB 直接 completeJob（charged=false/balanceRemaining=null）；
//   userId 非空 → billingService.settleSuccessfulSolution 单事务计费（含 solve_records 写入，AR1-021），
//   按结果分支：成功透传 charged/balanceRemaining；额度不足/其他失败 → failJob（不返回解法）；
//   计费 DB 故障 → fail-closed（默认 failJob）/ fail-open（completeJob 放行，不计费不写任何 DB 记录）。
// 抛出的未预期异常由 route.ts 的 .catch 兜底转 failJob(GESP6_INTERNAL_ERROR)。

import { billingService } from '@/app/lib/billing/billing-service';
import { completeJob, failJob } from '@/app/lib/job-store';
import { logger } from '@/app/lib/logging/logger';
import type { Problem, Solution } from '@/app/lib/ai/types';

/**
 * fail-open 降级开关（NFR-007）：GESP6_BILLING_DEGRADE_OPEN === '1' 时显式开启——
 * 建档失败放行（userId=null，AR1-006）、计费 DB 故障放行（不计费不写任何 DB 记录）。
 * 模块级函数每次读取，便于运行时切换与测试 stubEnv。
 */
export function isBillingDegradeOpen(): boolean {
  return process.env.GESP6_BILLING_DEGRADE_OPEN === '1';
}

/**
 * 完成回调计费分支（FR-028）：成功且未取消的解法结果 → settle → completeJob/failJob。
 * 前置取消检查（AR1-005）在调用前由 route.ts 完成本函数不再重复读取 job 状态。
 */
export async function settleAndCompleteJob(
  jobId: string,
  userId: string | null,
  resolvedProblem: Problem,
  solution: Solution,
): Promise<void> {
  if (userId === null) {
    // fail-open 建档放行（AR1-006）：跳过 DB，不计费不写任何记录
    completeJob(jobId, solution, { charged: false, balanceRemaining: null });
    return;
  }
  // 原子计费（FR-028）：settle 单事务完成计费判定 + solve_records 写入（AR1-021，route 回调不单独写）
  const settle = await billingService.settleSuccessfulSolution({
    userId,
    contentHash: solution.contentHash,
    jobId,
    inputType: resolvedProblem.type,
    platform: resolvedProblem.platform,
    problemId: resolvedProblem.problemId,
    sampleFp: solution.sampleFp,
    cached: solution.cached,
    validated: solution.validated,
  });
  if (settle.success && settle.data) {
    completeJob(jobId, solution, {
      charged: settle.data.charged,
      balanceRemaining: settle.data.balanceRemaining,
    });
    return;
  }
  if (settle.error?.code === 'GESP6_BILLING_DB_UNAVAILABLE' || settle.error?.code === 'GESP6_DB_UNAVAILABLE') {
    if (isBillingDegradeOpen()) {
      // fail-open：放行不计费不写任何 DB 记录（settle 失败即未写入，AC-026）
      logger.warn('[SolveRoute] 计费 DB 故障，fail-open 放行', {
        jobId,
        code: settle.error.code,
      });
      completeJob(jobId, solution, { charged: false, balanceRemaining: null });
      return;
    }
    // fail-closed（默认，AC-026）：任务失败，不返回解法
    logger.error('[SolveRoute] 计费 DB 故障，任务失败', {
      jobId,
      code: settle.error.code,
    });
    failJob(jobId, settle.error);
    return;
  }
  // 额度不足 / 其他计费失败（FR-019/FR-021）：任务失败，不返回解法
  // （settle 事务已回滚，未写 solve_records）
  logger.warn('[SolveRoute] 计费失败，任务失败', {
    jobId,
    code: settle.error?.code,
  });
  failJob(jobId, settle.error ?? {
    code: 'GESP6_BILLING_DEDUCT_FAILED',
    message: '计费处理失败',
  });
}
