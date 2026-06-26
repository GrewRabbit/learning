// app/solution/components/solution-tabs.tsx
// 解题结果 Tab 容器（FR-007/013/015/030/031）— 前端编排核心组件
// 职责：
//   1. fetch POST /api/solution 发起 SSE 流式请求
//   2. ReadableStream + TextDecoder 解码 + 按 '\n\n' 分隔事件（架构 §6.4.1）
//   3. 根据 event 类型分发到 state 更新函数
//   4. Tab 切换 + 流式状态管理（未就绪 Tab 显示加载 FR-031）
//   5. AbortController 取消生成（FR-031）
//   6. 流程图/思维导图 Tab 显示 Phase 3 占位（事件解析逻辑预留）

'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Brain,
  Code,
  FileText,
  GitBranch,
  Loader,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { logClientError } from '@/app/lib/logging/logger';
import { AnalysisDisplay } from '@/app/solution/components/analysis-display';
import { CodeDisplay } from '@/app/solution/components/code-display';
import {
  PhasePlaceholder,
  type PhaseError,
} from '@/app/solution/components/phase-placeholder';

/**
 * SolutionTabs Props
 */
export interface SolutionTabsProps {
  /** 题目文本（由 solution/page.tsx 从 searchParams 读取传入） */
  problem: string;
  /** 可选标准答案文本 */
  standardAnswer?: string;
  /** 生成模式：normal=普通生成，deep=基于标准答案深度解读（FR-005） */
  mode: 'normal' | 'deep';
}

/** Tab 标识 */
type TabId = 'code' | 'analysis' | 'flowchart' | 'mindmap';

/** 致命错误信息（遵循 ServiceResult 的 error 字段结构） */
interface FatalError {
  code: string;
  message: string;
}

/** /api/solution 请求体（架构 §5.3.1） */
interface SolutionRequestBody {
  problem: string;
  standardAnswer?: string;
  mode: 'normal' | 'deep';
}

/** SSE data 字段类型映射 */
interface Stage1DoneData {
  codeEmpty?: boolean;
  analysisEmpty?: boolean;
}
interface ChunkData {
  content?: string;
}
interface ErrorData {
  code?: string;
  message?: string;
}

/**
 * 解题结果 Tab 容器
 */
export function SolutionTabs({
  problem,
  standardAnswer,
  mode,
}: SolutionTabsProps): React.JSX.Element {
  // === 流式累积状态 ===
  const [code, setCode] = React.useState('');
  const [analysis, setAnalysis] = React.useState('');
  const [codeEmpty, setCodeEmpty] = React.useState<boolean | null>(null);
  const [analysisEmpty, setAnalysisEmpty] = React.useState<boolean | null>(null);

  // === 流程状态 ===
  const [isStage1Started, setIsStage1Started] = React.useState(false);
  const [isStage1Done, setIsStage1Done] = React.useState(false);
  const [isStage2Started, setIsStage2Started] = React.useState(false);
  const [isStage2Done, setIsStage2Done] = React.useState(false);
  const [isStreaming, setIsStreaming] = React.useState(false);

  // === 错误状态 ===
  const [fatalError, setFatalError] = React.useState<FatalError | null>(null);
  const [flowchartError, setFlowchartError] = React.useState<PhaseError | null>(
    null,
  );
  const [mindmapError, setMindmapError] = React.useState<PhaseError | null>(
    null,
  );
  const [networkError, setNetworkError] = React.useState<string | null>(null);

  // === Tab 状态 ===
  const [activeTab, setActiveTab] = React.useState<TabId>('code');

  // === Refs ===
  const abortRef = React.useRef<AbortController | null>(null);
  // stage1StartedRef：检测非流式降级重发 stage1-start（restart），清空已接收的部分内容避免重复
  const stage1StartedRef = React.useRef(false);

  /**
   * SSE 事件分发（架构 §4.4.1 事件清单）
   * 注意：flowchart / mindmap 事件解析逻辑预留，Phase 2 不渲染图表（任务说明）
   */
  const handleEvent = React.useCallback((eventName: string, dataStr: string) => {
    let data: Record<string, unknown> = {};
    if (dataStr) {
      try {
        data = JSON.parse(dataStr) as Record<string, unknown>;
      } catch (error) {
        logClientError('SSE data 解析失败', { eventName, error });
        return;
      }
    }

    switch (eventName) {
      case 'stage1-start':
        // 非流式降级 restart：Route Handler 重发 stage1-start，清空已接收的部分内容
        if (stage1StartedRef.current) {
          setCode('');
          setAnalysis('');
          setCodeEmpty(null);
          setAnalysisEmpty(null);
        }
        stage1StartedRef.current = true;
        setIsStage1Started(true);
        break;
      case 'code-chunk': {
        const content = (data as ChunkData).content ?? '';
        setCode((prev) => prev + content);
        break;
      }
      case 'analysis-chunk': {
        const content = (data as ChunkData).content ?? '';
        setAnalysis((prev) => prev + content);
        break;
      }
      case 'stage1-done': {
        const d = data as Stage1DoneData;
        setCodeEmpty(Boolean(d.codeEmpty));
        setAnalysisEmpty(Boolean(d.analysisEmpty));
        setIsStage1Done(true);
        break;
      }
      case 'stage2-start':
        setIsStage2Started(true);
        break;
      case 'flowchart':
        // Phase 3 实现：保留事件解析钩子，Phase 2 不渲染
        // setFlowchartData(data as Flowchart)
        break;
      case 'flowchart-error': {
        const d = data as ErrorData;
        setFlowchartError({
          code: d.code ?? 'CPP_AI_FLOWCHART_GENERATION_FAILED',
          message: d.message ?? '流程图生成失败，可重试',
        });
        break;
      }
      case 'mindmap':
        // Phase 3 实现：保留事件解析钩子，Phase 2 不渲染
        // setMindmapData(data as Mindmap)
        break;
      case 'mindmap-error': {
        const d = data as ErrorData;
        setMindmapError({
          code: d.code ?? 'CPP_AI_MINDMAP_GENERATION_FAILED',
          message: d.message ?? '思维导图生成失败，可重试',
        });
        break;
      }
      case 'done':
        setIsStage2Done(true);
        setIsStreaming(false);
        break;
      case 'error': {
        const d = data as ErrorData;
        setFatalError({
          code: d.code ?? 'CPP_INTERNAL_ERROR',
          message: d.message ?? '系统内部错误，请稍后重试',
        });
        setIsStreaming(false);
        break;
      }
      default:
        console.warn('未知 SSE 事件', { eventName });
    }
  }, []);

  /**
   * 重置流式状态（取消后或重新生成前调用，FR-031）
   */
  const resetStreamingState = React.useCallback((): void => {
    setCode('');
    setAnalysis('');
    setCodeEmpty(null);
    setAnalysisEmpty(null);
    setIsStage1Started(false);
    setIsStage1Done(false);
    setIsStage2Started(false);
    setIsStage2Done(false);
    setFatalError(null);
    setFlowchartError(null);
    setMindmapError(null);
    setNetworkError(null);
    stage1StartedRef.current = false;
  }, []);

  /**
   * 发起 SSE 流式请求（架构 §6.4.1）
   * - fetch POST /api/solution
   * - ReadableStream + TextDecoder 解码
   * - 维护缓冲区，按 '\n\n' 分隔事件，处理跨 chunk 不完整事件
   */
  const startGeneration = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      resetStreamingState();
      setIsStreaming(true);

      const body: SolutionRequestBody = { problem, mode };
      if (standardAnswer) {
        body.standardAnswer = standardAnswer;
      }

      let response: Response;
      try {
        response = await fetch('/api/solution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        // 用户主动取消（AbortError）— info 级别日志（架构 §4.4.3）
        if (err instanceof Error && err.name === 'AbortError') {
          console.info('用户取消生成');
          setIsStreaming(false);
          return;
        }
        logClientError('SSE 请求失败', { error: err });
        setNetworkError('连接中断，请重试');
        setIsStreaming(false);
        return;
      }

      // 流外错误：HTTP 状态码非 2xx（架构 §5.3.3）
      if (!response.ok || !response.body) {
        logClientError('SSE 响应异常', { status: response.status });
        setNetworkError(`服务异常（HTTP ${response.status}），请重试`);
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      /**
       * 解析缓冲区中完整的事件（以 '\n\n' 分隔），剩余不完整部分留在 buffer
       */
      const flushBuffer = (): void => {
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          let evtName = '';
          let dataStr = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) {
              evtName = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr += line.slice(6);
            }
          }
          if (evtName) {
            handleEvent(evtName, dataStr);
          }
        }
      };

      try {
        // eslint-disable-next-line no-constant-condition -- SSE 流式读取循环
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          flushBuffer();
        }
        // 刷新最终缓冲区（处理末尾无 '\n\n' 结尾的事件）
        buffer += decoder.decode();
        if (buffer.trim()) {
          flushBuffer();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.info('用户取消生成');
          // 取消后清理状态，恢复可重新生成（架构 §4.4.3）
          resetStreamingState();
        } else {
          logClientError('SSE 流读取失败', { error: err });
          setNetworkError('连接中断，请重试');
          setIsStreaming(false);
        }
      }
    },
    [problem, standardAnswer, mode, handleEvent, resetStreamingState],
  );

  /**
   * 初始挂载触发一次生成（合并启动与清理，修复 StrictMode 双触发 bug）
   * - StrictMode dev 模式：mount → cleanup abort → remount，第一次请求被 abort，第二次正常
   * - prod 模式：仅触发一次，正常执行
   */
  React.useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void startGeneration(controller.signal);
    return () => {
      controller.abort();
    };
  }, [startGeneration]);

  /** 取消生成（FR-031） */
  const handleCancel = (): void => {
    abortRef.current?.abort();
  };

  /** 重新生成（降级 UI / 错误状态触发，FR-005） */
  const handleRegenerate = (): void => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void startGeneration(controller.signal);
  };

  /** 切换 Tab */
  const handleTabChange = (value: string): void => {
    setActiveTab(value as TabId);
  };

  /** 顶部状态条 */
  const statusBar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-4 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {isStreaming ? (
          <>
            <Loader className="h-4 w-4 animate-spin" />
            <span>
              {isStage1Started && !isStage1Done
                ? '正在生成代码与分析...'
                : isStage2Started && !isStage2Done
                  ? '正在生成流程图与思维导图...'
                  : '正在生成...'}
            </span>
          </>
        ) : fatalError ? (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-destructive">{fatalError.message}</span>
          </>
        ) : networkError ? (
          <>
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-destructive">{networkError}</span>
          </>
        ) : isStage2Done ? (
          <span className="text-primary">生成完成</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {isStreaming && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            <X className="h-4 w-4" />
            取消生成
          </Button>
        )}
        {(fatalError || networkError) && !isStreaming && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
          >
            重新生成
          </Button>
        )}
        <Link
          href="/"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          返回首页
        </Link>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {statusBar}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="code" className="gap-1.5">
            <Code className="h-4 w-4" />
            <span>代码</span>
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5">
            <FileText className="h-4 w-4" />
            <span>分析</span>
          </TabsTrigger>
          <TabsTrigger value="flowchart" className="gap-1.5">
            <GitBranch className="h-4 w-4" />
            <span>流程图</span>
          </TabsTrigger>
          <TabsTrigger value="mindmap" className="gap-1.5">
            <Brain className="h-4 w-4" />
            <span>思维导图</span>
          </TabsTrigger>
        </TabsList>

        {/* 代码 Tab（FR-011~013） */}
        <TabsContent value="code">
          <CodeDisplay
            code={code}
            isStage1Done={isStage1Done}
            codeEmpty={codeEmpty}
            onRegenerate={handleRegenerate}
          />
        </TabsContent>

        {/* 分析 Tab（FR-014~016） */}
        <TabsContent value="analysis">
          <AnalysisDisplay
            analysis={analysis}
            mode={mode}
            analysisEmpty={analysisEmpty}
            onRegenerate={handleRegenerate}
          />
        </TabsContent>

        {/* 流程图 Tab — Phase 3 占位（事件解析逻辑已预留） */}
        <TabsContent value="flowchart">
          <PhasePlaceholder
            title="流程图"
            error={flowchartError}
            isStage2Started={isStage2Started}
            isStage2Done={isStage2Done}
            onRegenerate={handleRegenerate}
          />
        </TabsContent>

        {/* 思维导图 Tab — Phase 3 占位（事件解析逻辑已预留） */}
        <TabsContent value="mindmap">
          <PhasePlaceholder
            title="思维导图"
            error={mindmapError}
            isStage2Started={isStage2Started}
            isStage2Done={isStage2Done}
            onRegenerate={handleRegenerate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
