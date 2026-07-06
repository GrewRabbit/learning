// app/solve/hooks/use-job-polling.ts
// 解题任务提交与轮询自定义 Hook（架构 §6 + §4.3 + FR-001/002/003）
// 负责：提交任务 → 获取 jobId → 轮询状态 → 完成/失败/超时处理
// 从 solve/page.tsx 抽出（CR1-003 拆分）

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  type Problem,
  type Solution,
  SOLUTION_STORAGE_KEY,
  PROBLEM_STORAGE_KEY,
} from '@/app/lib/ai/types';

/** 轮询间隔（毫秒，统一 10 秒） */
const POLL_INTERVAL_MS = 10_000;
/** 网络错误最大重试次数（超过则提示网络不稳定） */
const MAX_NETWORK_ERRORS = 3;
/** 客户端超时（30 分钟） */
const CLIENT_TIMEOUT_MS = 30 * 60 * 1000;

/** useJobPolling 入参 */
export interface UseJobPollingOptions {
  /**
   * 错误回调（用于在 UI 层展示错误信息）
   * 传 null 表示清除已有错误（提交时重置）
   */
  onError: (message: string | null) => void;
}

/** useJobPolling 返回值 */
export interface UseJobPollingResult {
  loading: boolean;
  elapsedMs: number;
  /** GLM-5.x thinking 模式下的思考过程（reasoning_content 累积） */
  thinkingContent: string;
  /** GLM-5.x thinking 模式下的组织回答过程（content 累积，思考阶段结束后开始） */
  organizingContent: string;
  /** 提交任务（explicitProblem 为 ?regenerate=true 自动提交时传入） */
  handleSubmit: (problem: Problem, regenerate?: boolean) => Promise<void>;
  /** 取消轮询并通知服务端 */
  handleCancel: () => void;
}

/** 通知服务端取消任务（静默失败，不影响用户体验） */
function cancelJobOnServer(jobId: string): void {
  fetch(`/api/solve?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {
    // 静默失败：网络不通也无法取消，不影响前端流程
  });
}

/**
 * 解题任务提交与轮询 Hook
 *
 * - 提交 Problem 到 POST /api/solve 获取 jobId
 * - 轮询 GET /api/solve?jobId=xxx 直到完成
 * - 完成时将 Solution 与原始 Problem 写入 sessionStorage 并跳转 /result
 * - 客户端超时（>30 分钟）自动取消并通知服务端
 * - 连续网络错误 > 3 次停止轮询
 */
export function useJobPolling({ onError }: UseJobPollingOptions): UseJobPollingResult {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  // GLM-5.x thinking 模式下的思考过程（reasoning_content 累积）
  const [thinkingContent, setThinkingContent] = React.useState('');
  // GLM-5.x thinking 模式下的组织回答过程（content 累积，思考阶段结束后开始）
  const [organizingContent, setOrganizingContent] = React.useState('');

  // 轮询控制
  const pollingRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitTsRef = React.useRef(0);
  const elapsedTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // 网络错误连续计数（成功响应时重置）
  const networkErrorRef = React.useRef(0);
  // 当前任务编号（供取消时通知服务端）
  const currentJobIdRef = React.useRef<string | null>(null);
  // 当前提交的 Problem（job 完成时写入 sessionStorage，供 /result 页"重新生成"读取）
  const submittedProblemRef = React.useRef<Problem | null>(null);

  // 清理函数
  React.useEffect(() => {
    return () => {
      pollingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // 启动耗时计时器
  const startElapsedTimer = (): void => {
    submitTsRef.current = Date.now();
    setElapsedMs(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - submitTsRef.current);
    }, 1000);
  };

  // 停止耗时计时器
  const stopElapsedTimer = (): void => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  // 轮询任务状态
  const pollJob = async (jobId: string): Promise<void> => {
    if (!pollingRef.current) return;

    // 客户端超时检查
    const elapsed = Date.now() - submitTsRef.current;
    if (elapsed > CLIENT_TIMEOUT_MS) {
      pollingRef.current = false;
      setLoading(false);
      stopElapsedTimer();
      onError('处理超时（>30分钟），请稍后重试或重新提交');
      // 通知服务端取消，避免浪费后续 AI 调用
      cancelJobOnServer(jobId);
      return;
    }

    try {
      const res = await fetch(`/api/solve?jobId=${encodeURIComponent(jobId)}`);
      const data = (await res.json()) as {
        success: boolean;
        data?: {
          status: string;
          result?: Solution;
          thinkingContent?: string;
          organizingContent?: string;
        };
        error?: { code: string; message: string };
      };

      if (!pollingRef.current) return;

      // HTTP 请求成功（无论业务结果），重置网络错误计数
      networkErrorRef.current = 0;

      // 更新思考过程与组织回答内容（processing 和 done 状态都会返回）
      if (data.data?.thinkingContent !== undefined) {
        setThinkingContent(data.data.thinkingContent);
      }
      if (data.data?.organizingContent !== undefined) {
        setOrganizingContent(data.data.organizingContent);
      }

      if (data.success && data.data?.status === 'done' && data.data.result) {
        // 完成
        pollingRef.current = false;
        stopElapsedTimer();
        // CR1-009：Solution 对象可能过大（HTML + 思考过程 > 5MB），包裹 try-catch 降级处理
        try {
          sessionStorage.setItem(SOLUTION_STORAGE_KEY, JSON.stringify(data.data.result));
        } catch {
          // sessionStorage 写入失败（Solution 对象过大超出配额）→ 降级提示，不阻断主流程
          setLoading(false);
          onError('结果数据过大，无法缓存到本地');
          return;
        }
        // 同时存储原始 Problem，供 /result 页"重新生成"功能读取
        if (submittedProblemRef.current) {
          try {
            sessionStorage.setItem(PROBLEM_STORAGE_KEY, JSON.stringify(submittedProblemRef.current));
          } catch {
            // sessionStorage 写入失败（如图片 base64 超出配额）→ 忽略，不影响主流程
            // /result 页"重新生成"按钮将提示"未找到原题目数据"
          }
        }
        router.push('/result');
        return;
      }

      if (!data.success && data.error) {
        // 任务失败或已取消
        pollingRef.current = false;
        setLoading(false);
        stopElapsedTimer();
        onError(data.error.message ?? '生成失败');
        return;
      }

      // 仍在处理中，继续轮询
      timerRef.current = setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS);
    } catch {
      // 网络错误，计数并判断是否超过上限
      if (!pollingRef.current) return;
      networkErrorRef.current += 1;
      if (networkErrorRef.current > MAX_NETWORK_ERRORS) {
        pollingRef.current = false;
        setLoading(false);
        stopElapsedTimer();
        onError('网络连接不稳定，请检查网络后重试');
        return;
      }
      timerRef.current = setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS);
    }
  };

  // 提交
  // explicitProblem: ?regenerate=true 自动提交时传入（绕过 buildProblem 从表单读取）
  // regenerate: true 时 POST body 携带 regenerate 标志，服务端跳过缓存读强制重新生成
  const handleSubmit = async (problem: Problem, regenerate?: boolean): Promise<void> => {
    onError(null);

    // 记录当前提交的 Problem，job 完成时写入 sessionStorage 供 /result 页"重新生成"读取
    submittedProblemRef.current = problem;

    setLoading(true);
    setThinkingContent('');
    setOrganizingContent('');
    startElapsedTimer();
    networkErrorRef.current = 0;
    currentJobIdRef.current = null;

    try {
      // 1. 提交任务，获取 jobId
      const res = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem, ...(regenerate ? { regenerate: true } : {}) }),
      });
      const submitResult = (await res.json()) as {
        success: boolean;
        data?: { jobId: string };
        error?: { code: string; message: string };
      };

      if (!submitResult.success || !submitResult.data?.jobId) {
        setLoading(false);
        stopElapsedTimer();
        onError(submitResult.error?.message ?? '提交失败');
        return;
      }

      // 2. 记录 jobId，开始轮询
      currentJobIdRef.current = submitResult.data.jobId;
      pollingRef.current = true;
      pollJob(submitResult.data.jobId);
    } catch (e) {
      setLoading(false);
      stopElapsedTimer();
      onError(e instanceof Error ? e.message : '网络错误');
    }
  };

  // 取消轮询
  const handleCancel = (): void => {
    pollingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stopElapsedTimer();
    setLoading(false);
    // 通知服务端取消，避免浪费后续 AI 调用
    if (currentJobIdRef.current) {
      cancelJobOnServer(currentJobIdRef.current);
      currentJobIdRef.current = null;
    }
  };

  return {
    loading,
    elapsedMs,
    thinkingContent,
    organizingContent,
    handleSubmit,
    handleCancel,
  };
}
