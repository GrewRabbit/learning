// app/solve/page.tsx
// 题目输入页（架构 §6 + §4.3 + FR-001/002/003）
// 三种输入方式：文本 / 图片 / 多平台 URL（Tabs 切换）
// 提交后调用 POST /api/solve 获取 jobId，轮询 GET /api/solve?jobId=xxx 直到完成

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { ImageUploader } from './components/image-uploader';
import { type Problem, type Solution, SOLUTION_STORAGE_KEY, PROBLEM_STORAGE_KEY } from '@/app/lib/ai/types';

/** 文本内容上限 10000 字符（架构 §5.3） */
const TEXT_MAX_LENGTH = 10_000;
/** 轮询间隔（毫秒，统一 10 秒） */
const POLL_INTERVAL_MS = 10_000;
/** 网络错误最大重试次数（超过则提示网络不稳定） */
const MAX_NETWORK_ERRORS = 3;
/** 客户端超时（15 分钟） */
const CLIENT_TIMEOUT_MS = 15 * 60 * 1000;

type InputType = 'text' | 'image' | 'platform';

/** 格式化耗时 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}分${secs}秒`;
}

export default function SolvePage(): React.JSX.Element {
  const router = useRouter();
  const [inputType, setInputType] = React.useState<InputType>('text');
  const [textContent, setTextContent] = React.useState('');
  const [imageBase64, setImageBase64] = React.useState('');
  const [platformUrl, setPlatformUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  // GLM-5.x thinking 模式下的思考过程（reasoning_content 累积）
  const [thinkingContent, setThinkingContent] = React.useState('');
  // 思考过程折叠面板展开状态（默认折叠，避免干扰主流程）
  const [showThinking, setShowThinking] = React.useState(false);

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

  // ?regenerate=true 自动提交（从 /result 页"重新生成"按钮跳转而来）
  // 从 sessionStorage 读取上一次提交的 Problem，预填表单并自动提交（regenerate=true）
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('regenerate') !== 'true') return;
    try {
      const stored = sessionStorage.getItem(PROBLEM_STORAGE_KEY);
      if (!stored) {
        setError('未找到原题目数据，请重新输入');
        return;
      }
      const problem = JSON.parse(stored) as Problem;
      // 预填表单（让用户看到正在重新生成的内容）
      setInputType(problem.type);
      if (problem.type === 'text') setTextContent(problem.content);
      if (problem.type === 'platform') setPlatformUrl(problem.content);
      if (problem.type === 'image') setImageBase64(problem.content);
      // 自动提交，regenerate=true 跳过缓存读
      void handleSubmit(problem, true);
    } catch {
      setError('原题目数据读取失败，请重新输入');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 构造 Problem
  const buildProblem = (): Problem | null => {
    if (inputType === 'text') {
      if (!textContent.trim()) {
        setError('请输入题目内容');
        return null;
      }
      if (textContent.length > TEXT_MAX_LENGTH) {
        setError(`文本内容不能超过 ${TEXT_MAX_LENGTH} 字符`);
        return null;
      }
      return { type: 'text', content: textContent };
    }
    if (inputType === 'image') {
      if (!imageBase64) {
        setError('请上传题目图片');
        return null;
      }
      return { type: 'image', content: imageBase64 };
    }
    // platform
    if (!platformUrl.trim()) {
      setError('请输入题目 URL');
      return null;
    }
    return { type: 'platform', content: platformUrl.trim() };
  };

  // 通知服务端取消任务（静默失败，不影响用户体验）
  const cancelJobOnServer = (jobId: string): void => {
    fetch(`/api/solve?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {
      // 静默失败：网络不通也无法取消，不影响前端流程
    });
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
      setError('处理超时（>15分钟），请稍后重试或重新提交');
      // 通知服务端取消，避免浪费后续 AI 调用
      cancelJobOnServer(jobId);
      return;
    }

    try {
      const res = await fetch(`/api/solve?jobId=${encodeURIComponent(jobId)}`);
      const data = await res.json() as {
        success: boolean;
        data?: { status: string; result?: Solution; thinkingContent?: string };
        error?: { code: string; message: string };
      };

      if (!pollingRef.current) return;

      // HTTP 请求成功（无论业务结果），重置网络错误计数
      networkErrorRef.current = 0;

      // 更新思考过程（processing 和 done 状态都会返回）
      if (data.data?.thinkingContent !== undefined) {
        setThinkingContent(data.data.thinkingContent);
      }

      if (data.success && data.data?.status === 'done' && data.data.result) {
        // 完成
        pollingRef.current = false;
        stopElapsedTimer();
        sessionStorage.setItem(SOLUTION_STORAGE_KEY, JSON.stringify(data.data.result));
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
        setError(data.error.message ?? '生成失败');
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
        setError('网络连接不稳定，请检查网络后重试');
        return;
      }
      timerRef.current = setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS);
    }
  };

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

  // 提交
  // explicitProblem: ?regenerate=true 自动提交时传入（绕过 buildProblem 从表单读取）
  // regenerate: true 时 POST body 携带 regenerate 标志，服务端跳过缓存读强制重新生成
  const handleSubmit = async (explicitProblem?: Problem, regenerate?: boolean): Promise<void> => {
    setError(null);
    const problem = explicitProblem ?? buildProblem();
    if (!problem) return;

    // 记录当前提交的 Problem，job 完成时写入 sessionStorage 供 /result 页"重新生成"读取
    submittedProblemRef.current = problem;

    setLoading(true);
    setThinkingContent('');
    setShowThinking(false);
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
      const submitResult = await res.json() as {
        success: boolean;
        data?: { jobId: string };
        error?: { code: string; message: string };
      };

      if (!submitResult.success || !submitResult.data?.jobId) {
        setLoading(false);
        stopElapsedTimer();
        setError(submitResult.error?.message ?? '提交失败');
        return;
      }

      // 2. 记录 jobId，开始轮询
      currentJobIdRef.current = submitResult.data.jobId;
      pollingRef.current = true;
      pollJob(submitResult.data.jobId);
    } catch (e) {
      setLoading(false);
      stopElapsedTimer();
      setError(e instanceof Error ? e.message : '网络错误');
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

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          信息学奥赛 C++ 解题专家
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成解题讲解方案
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>题目输入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={inputType}
            onValueChange={(v) => setInputType(v as InputType)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="text">文本输入</TabsTrigger>
              <TabsTrigger value="image">图片上传</TabsTrigger>
              <TabsTrigger value="platform">平台 URL</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-2">
              <Label htmlFor="text-content">题目描述</Label>
              <Textarea
                id="text-content"
                placeholder="粘贴 C++ 题目描述（含样例输入输出）..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={12}
                className="resize-y"
              />
              <p className="text-xs text-muted-foreground">
                {textContent.length} / {TEXT_MAX_LENGTH} 字符
              </p>
            </TabsContent>

            <TabsContent value="image" className="space-y-2">
              <Label>题目图片</Label>
              <ImageUploader
                value={imageBase64}
                onChange={setImageBase64}
                onError={setError}
              />
            </TabsContent>

            <TabsContent value="platform" className="space-y-2">
              <Label htmlFor="platform-url">题目 URL</Label>
              <Input
                id="platform-url"
                type="url"
                placeholder="https://www.luogu.com.cn/problem/P11447"
                value={platformUrl}
                onChange={(e) => setPlatformUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                支持洛谷、有道小图灵（需 https://）
              </p>
            </TabsContent>
          </Tabs>

          {error && (
            <div
              role="alert"
              className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>AI 正在解题中，请耐心等待...（已等待 {formatElapsed(elapsedMs)}）</span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                取消
              </Button>
            </div>
          )}

          {loading && thinkingContent && (
            <div className="rounded border border-border bg-card">
              <button
                type="button"
                onClick={() => setShowThinking((v) => !v)}
                className="flex w-full items-center gap-2 p-3 text-left text-sm text-foreground hover:bg-muted/50"
                aria-expanded={showThinking}
              >
                {showThinking ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <Brain className="h-4 w-4 shrink-0 text-primary" />
                <span>AI 思考过程</span>
                <span className="text-xs text-muted-foreground">
                 （{thinkingContent.length} 字）
                </span>
              </button>
              {showThinking && (
                <div className="max-h-96 overflow-y-auto border-t border-border p-3">
                  <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {thinkingContent}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="min-w-32"
            >
              {loading ? '处理中...' : '生成解题方案'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
