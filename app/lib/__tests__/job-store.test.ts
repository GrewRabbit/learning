// app/lib/__tests__/job-store.test.ts
// job-store 单元测试
// 测试 createJob / completeJob / failJob / cancelJob / getJob 的状态转换与边界条件

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createJob,
  completeJob,
  failJob,
  cancelJob,
  getJob,
  appendThinkingChunk,
  appendOrganizingChunk,
  type JobRecord,
} from '../job-store';
import { logger } from '@/app/lib/logging/logger';

// mock logger（避免测试输出噪音）
vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('job-store', () => {
  describe('createJob', () => {
    it('创建任务 → 返回非空 jobId', () => {
      const jobId = createJob();
      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
    });

    it('创建任务 → getJob 返回 processing 状态', () => {
      const jobId = createJob();
      const job = getJob(jobId);
      expect(job).not.toBeNull();
      expect(job?.status).toBe('processing');
      expect(job?.id).toBe(jobId);
      expect(job?.createdAt).toBeGreaterThan(0);
      expect(job?.completedAt).toBeUndefined();
      expect(job?.thinkingContent).toBe('');
      expect(job?.organizingContent).toBe('');
    });

    it('多次创建 → 返回不同 jobId', () => {
      const id1 = createJob();
      const id2 = createJob();
      expect(id1).not.toBe(id2);
    });
  });

  describe('completeJob', () => {
    it('完成 processing 任务 → 状态变 done + 存储 result', () => {
      const jobId = createJob();
      const solution = { html: '<html></html>', validated: true, cached: false, contentHash: 'hash-1' };
      completeJob(jobId, solution);

      const job = getJob(jobId);
      expect(job?.status).toBe('done');
      expect(job?.result).toEqual(solution);
      expect(job?.completedAt).toBeGreaterThan(0);
    });

    it('完成不存在的任务 → 不抛错（静默跳过）', () => {
      expect(() =>
        completeJob('nonexistent', { html: '', validated: false, cached: false, contentHash: 'hash-2' }),
      ).not.toThrow();
    });

    it('带 billing 参数 → 写入 charged/balanceRemaining + 日志携带 charged（FR-022/AD-09）', () => {
      const jobId = createJob();
      completeJob(
        jobId,
        { html: '<html></html>', validated: true, cached: false, contentHash: 'hash-3' },
        { charged: true, balanceRemaining: 3 },
      );

      const job = getJob(jobId);
      expect(job?.charged).toBe(true);
      expect(job?.balanceRemaining).toBe(3);
      expect(logger.info).toHaveBeenCalledWith(
        '[JobStore] 任务已完成',
        expect.objectContaining({ charged: true }),
      );
    });

    it('不带 billing 参数 → 保持默认 charged=false / balanceRemaining=null（既有调用兼容）', () => {
      const jobId = createJob();
      completeJob(jobId, { html: '', validated: true, cached: false, contentHash: 'hash-4' });

      const job = getJob(jobId);
      expect(job?.status).toBe('done');
      expect(job?.charged).toBe(false);
      expect(job?.balanceRemaining).toBeNull();
    });

    it('fail-open 语义：显式传入 charged=false / balanceRemaining=null', () => {
      const jobId = createJob();
      completeJob(
        jobId,
        { html: '', validated: true, cached: false, contentHash: 'hash-5' },
        { charged: false, balanceRemaining: null },
      );

      const job = getJob(jobId);
      expect(job?.charged).toBe(false);
      expect(job?.balanceRemaining).toBeNull();
    });
  });

  describe('failJob', () => {
    it('失败 processing 任务 → 状态变 error + 存储 error', () => {
      const jobId = createJob();
      const error = { code: 'GESP6_LLM_TIMEOUT', message: '超时' };
      failJob(jobId, error);

      const job = getJob(jobId);
      expect(job?.status).toBe('error');
      expect(job?.error).toEqual(error);
      expect(job?.completedAt).toBeGreaterThan(0);
    });

    it('失败不存在的任务 → 不抛错', () => {
      expect(() => failJob('nonexistent', { code: 'X', message: 'Y' })).not.toThrow();
    });
  });

  describe('cancelJob', () => {
    it('取消 processing 任务 → 返回 true + 状态变 cancelled', () => {
      const jobId = createJob();
      const result = cancelJob(jobId);
      expect(result).toBe(true);

      const job = getJob(jobId);
      expect(job?.status).toBe('cancelled');
      expect(job?.completedAt).toBeGreaterThan(0);
    });

    it('取消不存在的 jobId → 返回 false', () => {
      const result = cancelJob('nonexistent-id');
      expect(result).toBe(false);
    });

    it('取消已完成的任务 → 返回 false（状态不变）', () => {
      const jobId = createJob();
      completeJob(jobId, { html: '', validated: true, cached: false, contentHash: 'hash-6' });

      const result = cancelJob(jobId);
      expect(result).toBe(false);

      const job = getJob(jobId);
      expect(job?.status).toBe('done');
    });

    it('取消已失败的任务 → 返回 false', () => {
      const jobId = createJob();
      failJob(jobId, { code: 'X', message: 'Y' });

      const result = cancelJob(jobId);
      expect(result).toBe(false);

      const job = getJob(jobId);
      expect(job?.status).toBe('error');
    });

    it('重复取消同一任务 → 第二次返回 false', () => {
      const jobId = createJob();

      const first = cancelJob(jobId);
      expect(first).toBe(true);

      const second = cancelJob(jobId);
      expect(second).toBe(false);

      const job = getJob(jobId);
      expect(job?.status).toBe('cancelled');
    });
  });

  describe('getJob', () => {
    it('查询不存在的 jobId → 返回 null', () => {
      const job = getJob('nonexistent');
      expect(job).toBeNull();
    });

    it('查询已取消的任务 → 返回 cancelled 状态', () => {
      const jobId = createJob();
      cancelJob(jobId);

      const job = getJob(jobId);
      expect(job?.status).toBe('cancelled');
    });
  });

  describe('appendThinkingChunk', () => {
    it('追加单个片段 → thinkingContent 更新', () => {
      const jobId = createJob();
      appendThinkingChunk(jobId, '思考片段');
      const job = getJob(jobId);
      expect(job?.thinkingContent).toBe('思考片段');
    });

    it('追加多个片段 → thinkingContent 累积拼接', () => {
      const jobId = createJob();
      appendThinkingChunk(jobId, '片段1');
      appendThinkingChunk(jobId, '片段2');
      appendThinkingChunk(jobId, '片段3');
      const job = getJob(jobId);
      expect(job?.thinkingContent).toBe('片段1片段2片段3');
    });

    it('不存在的 jobId → 静默跳过（不抛错）', () => {
      expect(() => appendThinkingChunk('nonexistent', 'text')).not.toThrow();
      // 确保未创建任何任务
      expect(getJob('nonexistent')).toBeNull();
    });

    it('空字符串片段 → 正常追加（不影响已有内容）', () => {
      const jobId = createJob();
      appendThinkingChunk(jobId, '片段1');
      appendThinkingChunk(jobId, '');
      const job = getJob(jobId);
      expect(job?.thinkingContent).toBe('片段1');
    });

    it('不同任务的 thinkingContent 互不影响', () => {
      const jobId1 = createJob();
      const jobId2 = createJob();
      appendThinkingChunk(jobId1, '任务1思考');
      appendThinkingChunk(jobId2, '任务2思考');
      expect(getJob(jobId1)?.thinkingContent).toBe('任务1思考');
      expect(getJob(jobId2)?.thinkingContent).toBe('任务2思考');
    });
  });

  describe('appendOrganizingChunk', () => {
    it('追加单个片段 → organizingContent 更新', () => {
      const jobId = createJob();
      appendOrganizingChunk(jobId, '回答片段');
      const job = getJob(jobId);
      expect(job?.organizingContent).toBe('回答片段');
    });

    it('追加多个片段 → organizingContent 累积拼接', () => {
      const jobId = createJob();
      appendOrganizingChunk(jobId, '片段1');
      appendOrganizingChunk(jobId, '片段2');
      appendOrganizingChunk(jobId, '片段3');
      const job = getJob(jobId);
      expect(job?.organizingContent).toBe('片段1片段2片段3');
    });

    it('不存在的 jobId → 静默跳过（不抛错）', () => {
      expect(() => appendOrganizingChunk('nonexistent', 'text')).not.toThrow();
      expect(getJob('nonexistent')).toBeNull();
    });

    it('空字符串片段 → 正常追加（不影响已有内容）', () => {
      const jobId = createJob();
      appendOrganizingChunk(jobId, '片段1');
      appendOrganizingChunk(jobId, '');
      const job = getJob(jobId);
      expect(job?.organizingContent).toBe('片段1');
    });

    it('不同任务的 organizingContent 互不影响', () => {
      const jobId1 = createJob();
      const jobId2 = createJob();
      appendOrganizingChunk(jobId1, '任务1回答');
      appendOrganizingChunk(jobId2, '任务2回答');
      expect(getJob(jobId1)?.organizingContent).toBe('任务1回答');
      expect(getJob(jobId2)?.organizingContent).toBe('任务2回答');
    });

    it('thinkingContent 与 organizingContent 独立累积（互不干扰）', () => {
      const jobId = createJob();
      appendThinkingChunk(jobId, '思考');
      appendOrganizingChunk(jobId, '回答');
      const job = getJob(jobId);
      expect(job?.thinkingContent).toBe('思考');
      expect(job?.organizingContent).toBe('回答');
    });
  });

  describe('状态转换矩阵', () => {
    it('processing → done（completeJob）', () => {
      const jobId = createJob();
      completeJob(jobId, { html: '', validated: true, cached: false, contentHash: 'hash-7' });
      expect(getJob(jobId)?.status).toBe('done');
    });

    it('processing → error（failJob）', () => {
      const jobId = createJob();
      failJob(jobId, { code: 'X', message: 'Y' });
      expect(getJob(jobId)?.status).toBe('error');
    });

    it('processing → cancelled（cancelJob）', () => {
      const jobId = createJob();
      cancelJob(jobId);
      expect(getJob(jobId)?.status).toBe('cancelled');
    });

    it('cancelJob 是唯一带状态守卫的写入：done/error/cancelled 状态下调用均返回 false', () => {
      // cancelJob 仅允许 processing → cancelled，其他终态调用直接返回 false 不改变状态
      const doneId = createJob();
      completeJob(doneId, { html: '', validated: true, cached: false, contentHash: 'hash-8' });
      expect(cancelJob(doneId)).toBe(false);
      expect(getJob(doneId)?.status).toBe('done');

      const errorId = createJob();
      failJob(errorId, { code: 'X', message: 'Y' });
      expect(cancelJob(errorId)).toBe(false);
      expect(getJob(errorId)?.status).toBe('error');

      const cancelledId = createJob();
      cancelJob(cancelledId);
      expect(cancelJob(cancelledId)).toBe(false);
      expect(getJob(cancelledId)?.status).toBe('cancelled');
    });

    it('completeJob/failJob 无状态守卫：会覆写任意终态（route.ts 在调用前自行检查 cancelled）', () => {
      // 当前实现：completeJob 和 failJob 仅检查 job 存在，不检查状态
      // 这是已知设计取舍 —— 终态保护责任在调用方（route.ts）
      // route.ts POST 的 .then 回调在调用 completeJob 前已检查 job.status === 'cancelled'，
      // 因此实际运行时不会出现 cancelled → done 的覆写
      const doneId = createJob();
      completeJob(doneId, { html: '', validated: true, cached: false, contentHash: 'hash-9' });
      failJob(doneId, { code: 'X', message: 'Y' });
      // failJob 会将 done 覆写为 error（实现未阻止）
      expect(getJob(doneId)?.status).toBe('error');

      const cancelledId = createJob();
      cancelJob(cancelledId);
      completeJob(cancelledId, { html: '', validated: true, cached: false, contentHash: 'hash-10' });
      // completeJob 会将 cancelled 覆写为 done（实现未阻止）
      expect(getJob(cancelledId)?.status).toBe('done');
    });
  });
});
