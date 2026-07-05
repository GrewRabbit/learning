// app/lib/job-store.ts
// 内存任务队列（轮询模式支持）
// 解决移动端浏览器 fetch 超时问题：POST 立即返回 jobId，GET 轮询查询状态

import { randomUUID } from 'crypto';
import { logger } from '@/app/lib/logging/logger';
import type { Solution } from '@/app/lib/ai/types';

/** 任务状态 */
export type JobStatus = 'processing' | 'done' | 'error' | 'cancelled';

/** 思考过程内容上限（字符数，防止超大 thinking 撑爆内存/响应体） */
const THINKING_CONTENT_MAX_LENGTH = 200_000;
/** 组织回答内容上限（字符数，防止超大 content 撑爆内存/响应体） */
const ORGANIZING_CONTENT_MAX_LENGTH = 200_000;

/** 任务记录 */
export interface JobRecord {
  id: string;
  status: JobStatus;
  result?: Solution;
  error?: { code: string; message: string };
  createdAt: number;
  completedAt?: number;
  /** GLM-5.x thinking 模式下的 reasoning_content 累积（供前端实时展示思考过程） */
  thinkingContent: string;
  /** GLM-5.x thinking 模式下的 content 累积（供前端实时展示"组织回答"过程） */
  organizingContent: string;
}

/** 任务自动清理时间（30 分钟） */
const JOB_TTL_MS = 30 * 60 * 1000;

/** 全局任务 Map（模块级单例，所有请求共享） */
const jobs = new Map<string, JobRecord>();

/** 上次清理时间戳（避免每次查询都清理） */
let lastCleanupTs = 0;

/**
 * 创建任务，返回 jobId
 */
export function createJob(): string {
  const id = randomUUID();
  const record: JobRecord = {
    id,
    status: 'processing',
    createdAt: Date.now(),
    thinkingContent: '',
    organizingContent: '',
  };
  jobs.set(id, record);
  logger.info('[JobStore] 任务已创建', { jobId: id });
  return id;
}

/**
 * 追加思考过程片段（reasoning_content）
 *
 * 由 route.ts POST 的 onChunk 回调调用，将 GLM-5.x thinking 模式下的
 * reasoning_content 逐片段累积到任务记录，供前端轮询时实时展示。
 *
 * 超过 THINKING_CONTENT_MAX_LENGTH 后静默丢弃后续片段，防止超大 thinking 撑爆内存。
 */
export function appendThinkingChunk(id: string, text: string): void {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  if (job.thinkingContent.length >= THINKING_CONTENT_MAX_LENGTH) {
    return;
  }
  job.thinkingContent += text;
}

/**
 * 追加组织回答片段（content）
 *
 * 由 route.ts POST 的 onChunk 回调调用，将 GLM-5.x thinking 模式下的
 * content 逐片段累积到任务记录，供前端轮询时实时展示"组织回答"过程。
 *
 * 思考阶段（reasoning_content）结束后进入回答阶段（content），
 * 前端通过 organizingContent 是否有内容判定思考阶段已结束。
 *
 * 超过 ORGANIZING_CONTENT_MAX_LENGTH 后静默丢弃后续片段，防止超大 content 撑爆内存。
 */
export function appendOrganizingChunk(id: string, text: string): void {
  const job = jobs.get(id);
  if (!job) {
    return;
  }
  if (job.organizingContent.length >= ORGANIZING_CONTENT_MAX_LENGTH) {
    return;
  }
  job.organizingContent += text;
}

/**
 * 更新任务状态为完成
 */
export function completeJob(id: string, result: Solution): void {
  const job = jobs.get(id);
  if (!job) {
    logger.warn('[JobStore] 完成任务时未找到任务', { jobId: id });
    return;
  }
  job.status = 'done';
  job.result = result;
  job.completedAt = Date.now();
  logger.info('[JobStore] 任务已完成', {
    jobId: id,
    elapsedMs: job.completedAt - job.createdAt,
    cached: result.cached,
    validated: result.validated,
  });
}

/**
 * 更新任务状态为失败
 */
export function failJob(id: string, error: { code: string; message: string }): void {
  const job = jobs.get(id);
  if (!job) {
    logger.warn('[JobStore] 失败任务时未找到任务', { jobId: id });
    return;
  }
  job.status = 'error';
  job.error = error;
  job.completedAt = Date.now();
  logger.warn('[JobStore] 任务失败', {
    jobId: id,
    elapsedMs: job.completedAt - job.createdAt,
    errorCode: error.code,
  });
}

/**
 * 取消任务（仅 processing 状态可取消）
 *
 * 用于前端用户主动取消或超时放弃时，通知服务端停止后续计算。
 * orchestrator 在修正循环每轮开始前检查任务状态，若已取消则中止。
 *
 * @returns true=取消成功；false=任务不存在或已完成
 */
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== 'processing') {
    logger.warn('[JobStore] 取消任务失败（不存在或非进行中）', {
      jobId: id,
      currentStatus: job?.status ?? 'not_found',
    });
    return false;
  }
  job.status = 'cancelled';
  job.completedAt = Date.now();
  logger.info('[JobStore] 任务已取消', {
    jobId: id,
    elapsedMs: job.completedAt - job.createdAt,
  });
  return true;
}

/**
 * 查询任务状态
 */
export function getJob(id: string): JobRecord | null {
  cleanupOldJobs();
  return jobs.get(id) ?? null;
}

/**
 * 清理过期任务（每次调用最多清理一次，间隔 > 5 分钟）
 */
function cleanupOldJobs(): void {
  const now = Date.now();
  if (now - lastCleanupTs < 5 * 60 * 1000) {
    return;
  }
  lastCleanupTs = now;
  let cleaned = 0;
  for (const [id, job] of jobs) {
    const age = now - job.createdAt;
    if (age > JOB_TTL_MS) {
      jobs.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info('[JobStore] 清理过期任务', { cleaned, remaining: jobs.size });
  }
}
