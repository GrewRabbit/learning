// app/lib/billing/billing-storage.ts
// 计费反馈 sessionStorage 存取（架构 AD-10，FR-022/FR-030）
//
// 职责：/solve 轮询 done（或额度不足 error）分支将计费反馈写入 sessionStorage，
// /result 页读取展示。纯浏览器端模块，无服务端依赖（与 billing-service.ts 无关联）。
//
// 存储形状（BILLING_INFO_STORAGE_KEY，JSON 序列化，两形态互斥）：
// - done：{ "charged": boolean, "balanceRemaining": number | null }
//     balanceRemaining=null 表示额度暂不可用（fail-open 放行期间，FR-030）
// - error（GESP6_BILLING_INSUFFICIENT_BALANCE）：{ "insufficientBalance": true, "message": string }
//
// 容错：写入失败仅 logClientError 不中断（不阻断跳转）；读取无 key 或解析失败
// 返回 null（存量历史任务无计费信息 → result 页静默不渲染计费条，FR-030 降级）。

import { BILLING_INFO_STORAGE_KEY } from '@/app/lib/ai/types';
import { logClientError } from '@/app/lib/logging/logger';

/** done 分支计费反馈（FR-022：charged/balanceRemaining 与 result 平级透出） */
export interface BillingResultFeedback {
  /** 本次是否计费（首次获取=true；已获取过/fail-open 放行=false） */
  charged: boolean;
  /** 计费后剩余额度（次数）；null=额度暂不可用（fail-open 放行期间） */
  balanceRemaining: number | null;
}

/** 额度不足反馈（FR-019：GESP6_BILLING_INSUFFICIENT_BALANCE） */
export interface InsufficientBalanceFeedback {
  insufficientBalance: true;
  /** 服务端错误文案（含「余额不足，请联系管理员充值」） */
  message: string;
}

/** sessionStorage 中的计费反馈（两形态互斥，读取方以 insufficientBalance 字段判别） */
export type BillingFeedback = BillingResultFeedback | InsufficientBalanceFeedback;

/** 额度不足错误码（spec FR-033 / 架构 §5.3） */
export const INSUFFICIENT_BALANCE_ERROR_CODE = 'GESP6_BILLING_INSUFFICIENT_BALANCE';

/** 判定轮询 error.code 是否额度不足（use-job-polling error 分支据此写入反馈） */
export function isInsufficientBalanceError(code: string): boolean {
  return code === INSUFFICIENT_BALANCE_ERROR_CODE;
}

/** 判别反馈是否额度不足形态（BillingBanner 展示分支用） */
export function isInsufficientBalanceFeedback(
  feedback: BillingFeedback,
): feedback is InsufficientBalanceFeedback {
  return (feedback as InsufficientBalanceFeedback).insufficientBalance === true;
}

/** 写入计费反馈（写失败仅记录客户端日志，不向调用方抛出） */
export function saveBillingFeedback(feedback: BillingFeedback): void {
  try {
    sessionStorage.setItem(BILLING_INFO_STORAGE_KEY, JSON.stringify(feedback));
  } catch (error) {
    // sessionStorage 写入失败（如超出配额）→ 降级：不中断轮询跳转主流程，仅 /result 页无计费条
    logClientError('[billing-storage] 写入 sessionStorage 失败', {
      key: BILLING_INFO_STORAGE_KEY,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 读取计费反馈
 * 返回 null 的场景（均为静默降级，不影响解法展示）：
 * - 无该 key（存量历史任务 / 旧页面跳转）
 * - JSON 解析失败（数据非法）
 */
export function loadBillingFeedback(): BillingFeedback | null {
  try {
    const stored = sessionStorage.getItem(BILLING_INFO_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as BillingFeedback;
  } catch {
    // 解析失败视为无数据（计费信息缺失降级，FR-030）
    return null;
  }
}
