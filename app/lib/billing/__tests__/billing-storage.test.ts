// app/lib/billing/__tests__/billing-storage.test.ts
// billing-storage 模块单元测试（T9 前端计费反馈，AD-10/FR-030）
//
// 覆盖：
// - save/load 往返（BILLING_INFO_STORAGE_KEY 读写一致）
// - 读取降级：无 key / 非法 JSON → null（FR-030「计费信息缺失降级」，
//   存量历史任务与旧页面无计费信息，不渲染计费条、不影响解法展示）
// - 写入失败容错：sessionStorage 抛异常时仅 logClientError，不向调用方抛出
//
// vitest environment: 'node'，无 sessionStorage，用 FakeSessionStorage stub
// （项目惯例：不引入 jsdom，见 app/solve/components/__tests__/image-uploader.test.ts 头注释）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BILLING_INFO_STORAGE_KEY } from '@/app/lib/ai/types';
import {
  saveBillingFeedback,
  loadBillingFeedback,
} from '../billing-storage';

/** 覆盖 Storage 接口的最小 sessionStorage 替身（node 环境无 sessionStorage） */
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

/** setItem 恒抛异常的替身（模拟超出配额等写入失败） */
class ThrowingSessionStorage extends FakeSessionStorage {
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

describe('billing-storage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new FakeSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('saveBillingFeedback + loadBillingFeedback 往返', () => {
    it('写入 done 反馈后可原样读回（charged + 剩余额度）', () => {
      saveBillingFeedback({ charged: true, balanceRemaining: 4 });

      expect(loadBillingFeedback()).toEqual({
        charged: true,
        balanceRemaining: 4,
      });
    });

    it('写入额度不足反馈后可原样读回（insufficient 标记 + message）', () => {
      saveBillingFeedback({
        insufficientBalance: true,
        message: '余额不足，请联系管理员充值',
      });

      expect(loadBillingFeedback()).toEqual({
        insufficientBalance: true,
        message: '余额不足，请联系管理员充值',
      });
    });

    it('再次写入覆盖旧值（后一次任务的结果为准）', () => {
      saveBillingFeedback({ charged: true, balanceRemaining: 1 });
      saveBillingFeedback({ insufficientBalance: true, message: '余额不足' });

      expect(loadBillingFeedback()).toEqual({
        insufficientBalance: true,
        message: '余额不足',
      });
    });
  });

  describe('读取降级（FR-030 计费信息缺失 → 静默返回 null）', () => {
    it('无 BILLING key（存量历史任务）→ null', () => {
      expect(loadBillingFeedback()).toBeNull();
    });

    it('非法 JSON → null 且不抛出', () => {
      sessionStorage.setItem(BILLING_INFO_STORAGE_KEY, '{not-json');

      expect(loadBillingFeedback()).toBeNull();
    });
  });

  describe('写入失败容错（不中断跳转/主流程）', () => {
    it('sessionStorage.setItem 抛异常 → 不抛出，仅记录客户端错误日志', () => {
      vi.stubGlobal('sessionStorage', new ThrowingSessionStorage());
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() =>
        saveBillingFeedback({ charged: true, balanceRemaining: 4 }),
      ).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
