// app/result/components/__tests__/billing-banner.test.ts
// BillingBanner 纯展示组件单测（T9，FR-030）
//
// 覆盖：正常计费文案（charged=true/false + 剩余额度）、balanceRemaining=null →「额度暂不可用」、
// 额度不足提示（FR-019 文案）、feedback=null 不渲染（历史解法保护：计费条缺失不影响解法展示）。
//
// vitest environment: 'node'，无 DOM：用 react-dom/server renderToStaticMarkup +
// React.createElement（.ts 文件无法写 JSX）做字符串断言，不引入 jsdom（项目惯例）。

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingBanner } from '../billing-banner';
import { type BillingFeedback } from '@/app/lib/billing/billing-storage';

/** 渲染 BillingBanner 并返回静态 HTML（供文案断言） */
function renderBanner(feedback: BillingFeedback | null): string {
  return renderToStaticMarkup(
    React.createElement(BillingBanner, { feedback }),
  );
}

describe('BillingBanner（FR-030 结果页计费反馈）', () => {
  it('charged=true 且有余额 → 展示「本次已计费」与「剩余额度：4 次」', () => {
    const html = renderBanner({ charged: true, balanceRemaining: 4 });

    expect(html).toContain('本次已计费');
    expect(html).toContain('剩余额度：4 次');
  });

  it('charged=false 且有余额 → 展示「本次免费（已获取过的解法）」与剩余额度', () => {
    const html = renderBanner({ charged: false, balanceRemaining: 2 });

    expect(html).toContain('本次免费（已获取过的解法）');
    expect(html).toContain('剩余额度：2 次');
  });

  it('balanceRemaining=null → 展示「额度暂不可用」，不显示剩余额度数字', () => {
    const html = renderBanner({ charged: true, balanceRemaining: null });

    expect(html).toContain('额度暂不可用');
    expect(html).not.toContain('剩余额度：');
  });

  it('额度不足标记 → 展示「余额不足，请联系管理员充值」提示（role=alert）', () => {
    const html = renderBanner({
      insufficientBalance: true,
      message: '余额不足，请联系管理员充值',
    });

    expect(html).toContain('余额不足，请联系管理员充值');
    expect(html).toContain('role="alert"');
  });

  it('feedback=null（历史任务/读取失败降级）→ 不渲染任何计费内容', () => {
    expect(renderBanner(null)).toBe('');
  });
});
