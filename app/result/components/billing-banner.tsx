// app/result/components/billing-banner.tsx
// 计费反馈信息条（架构 AD-10 + FR-030）
// 读取 BILLING_INFO_STORAGE_KEY 的展示组件（由 page.tsx 读入后经 props 传入）：
// - 正常：本次是否计费 + 剩余额度（balanceRemaining=null →「额度暂不可用」）
// - 额度不足：「余额不足，请联系管理员充值」提示（FR-019，醒目非阻断）
// - feedback=null（历史任务/读取失败）：不渲染（静默降级，不影响解法展示）
//
// 独立于解法内容区的展示组件：任何计费展示异常均不触及 Solution 渲染主流程

import * as React from 'react';
import { AlertCircle, BadgeCheck, Coins } from 'lucide-react';
import {
  type BillingFeedback,
  isInsufficientBalanceFeedback,
} from '@/app/lib/billing/billing-storage';

export interface BillingBannerProps {
  /** 计费反馈（null=缺失，静默不渲染） */
  feedback: BillingFeedback | null;
}

/**
 * BillingBanner：结果页顶部计费信息条
 *
 * 样式遵循 component-rules.md 语义色变量（--destructive / --muted，禁止原始色值），
 * 结构对齐 warning-banner（语义色边框 + hsl 透明度软背景）
 */
export function BillingBanner({
  feedback,
}: BillingBannerProps): React.JSX.Element | null {
  if (!feedback) return null;

  if (isInsufficientBalanceFeedback(feedback)) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm"
        style={{
          backgroundColor: 'hsl(var(--destructive) / 0.1)',
          color: 'hsl(var(--destructive))',
        }}
      >
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p className="font-medium">{feedback.message}</p>
      </div>
    );
  }

  const balanceText =
    feedback.balanceRemaining === null
      ? '额度暂不可用'
      : `剩余额度：${feedback.balanceRemaining} 次`;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground"
      role="status"
    >
      {feedback.charged ? (
        <Coins className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      ) : (
        <BadgeCheck className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      )}
      <span className="font-medium text-foreground">
        {feedback.charged ? '本次已计费' : '本次免费（已获取过的解法）'}
      </span>
      <span>{balanceText}</span>
    </div>
  );
}
