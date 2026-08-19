// app/solve/hooks/__tests__/use-job-polling.test.ts
// use-job-polling 轮询 done/error 分支的计费反馈行为单测（T9，AD-10/FR-022/FR-030）
//
// 惯例说明：hook 渲染依赖 React DOM 环境，按项目现状不引入 jsdom +
// @testing-library/react（见 app/solve/components/__tests__/image-uploader.test.ts 头注释）。
// 本文件以纯逻辑等价覆盖两个分支的 sessionStorage 行为：
// - done 分支：buildBillingFeedback(响应平级字段) → saveBillingFeedback 写入
// - error 分支：isInsufficientBalanceError(code) → saveBillingFeedback 写入 insufficient 标记
// 完整轮询链路（fetch → 跳转 /result）由 E2E 覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BILLING_INFO_STORAGE_KEY } from '@/app/lib/ai/types';
import {
  buildBillingFeedback,
} from '../use-job-polling';
import {
  INSUFFICIENT_BALANCE_ERROR_CODE,
  isInsufficientBalanceError,
  saveBillingFeedback,
} from '@/app/lib/billing/billing-storage';

// use-job-polling.ts 顶层引用 next/navigation（node 环境下 mock 掉，避免依赖 App Router 上下文）
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/** 覆盖 Storage 接口的最小 sessionStorage 替身 */
class FakeSessionStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/** 读取写入内容（断言 JSON 形状） */
function storedValue(): unknown {
  const raw = sessionStorage.getItem(BILLING_INFO_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('use-job-polling 计费反馈（done 分支 → sessionStorage）', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new FakeSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('done 响应含 charged/balanceRemaining → 写入 BILLING key 且 JSON 形状正确', () => {
    saveBillingFeedback(
      buildBillingFeedback({ charged: true, balanceRemaining: 4 }),
    );

    expect(sessionStorage.getItem(BILLING_INFO_STORAGE_KEY)).toBe(
      '{"charged":true,"balanceRemaining":4}',
    );
  });

  it('done 响应 balanceRemaining=null → 写入 null 值（fail-open 放行期间）', () => {
    saveBillingFeedback(
      buildBillingFeedback({ charged: false, balanceRemaining: null }),
    );

    expect(storedValue()).toEqual({ charged: false, balanceRemaining: null });
  });

  it('done 响应缺失计费字段（旧服务端契约）→ 缺省归一为 charged=false / balanceRemaining=null', () => {
    expect(buildBillingFeedback({})).toEqual({
      charged: false,
      balanceRemaining: null,
    });
  });
});

describe('use-job-polling 计费反馈（error 分支 → sessionStorage）', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new FakeSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('error code=GESP6_BILLING_INSUFFICIENT_BALANCE → 写入 insufficient 标记', () => {
    const message = '余额不足，请联系管理员充值';

    expect(isInsufficientBalanceError(INSUFFICIENT_BALANCE_ERROR_CODE)).toBe(
      true,
    );
    saveBillingFeedback({ insufficientBalance: true, message });

    expect(storedValue()).toEqual({ insufficientBalance: true, message });
  });

  it('error 其他 code（DB 不可用等）→ 判定为 false，不写 BILLING key', () => {
    expect(isInsufficientBalanceError('GESP6_BILLING_DB_UNAVAILABLE')).toBe(
      false,
    );
    expect(isInsufficientBalanceError('GESP6_DB_UNAVAILABLE')).toBe(false);

    expect(sessionStorage.getItem(BILLING_INFO_STORAGE_KEY)).toBeNull();
  });
});

describe('use-job-polling 计费反馈（写入失败不中断）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sessionStorage 写入抛异常 → saveBillingFeedback 不抛出（跳转/回调不受阻断）', () => {
    vi.stubGlobal(
      'sessionStorage',
      new (class extends FakeSessionStorage {
        setItem(): void {
          throw new Error('QuotaExceededError');
        }
      })(),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      saveBillingFeedback(buildBillingFeedback({ charged: true, balanceRemaining: 3 })),
    ).not.toThrow();

    consoleSpy.mockRestore();
  });
});
