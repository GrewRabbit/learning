// app/solve/components/solve-form.tsx
// 题目输入表单（架构 §6 + §4.3 + FR-001/002/003）
// 三种输入方式：文本 / 图片 / 多平台 URL（Tabs 切换）
// 提交按钮 + 思考过程折叠面板 + 组织回答折叠面板
// 从 solve/page.tsx 抽出（CR1-003 拆分）

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronDown, ChevronRight, Brain, PenLine } from 'lucide-react';
import { ImageUploader } from './image-uploader';
import { useJobPolling } from '../hooks/use-job-polling';
import { type Problem, PROBLEM_STORAGE_KEY } from '@/app/lib/ai/types';

/** 文本内容上限 10000 字符（架构 §5.3） */
const TEXT_MAX_LENGTH = 10_000;

type InputType = 'text' | 'image' | 'platform';

/** 格式化耗时 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}分${secs}秒`;
}

export function SolveForm(): React.JSX.Element {
  const [inputType, setInputType] = React.useState<InputType>('text');
  const [textContent, setTextContent] = React.useState('');
  const [imageBase64, setImageBase64] = React.useState('');
  const [platformUrl, setPlatformUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // 思考过程折叠面板展开状态（默认折叠，避免干扰主流程）
  const [showThinking, setShowThinking] = React.useState(false);
  // 组织回答折叠面板展开状态（默认折叠，避免干扰主流程）
  const [showOrganizing, setShowOrganizing] = React.useState(false);

  const { loading, elapsedMs, thinkingContent, organizingContent, handleSubmit, handleCancel } =
    useJobPolling({ onError: setError });

  // 用 ref 持有最新的 handleSubmit，让 mount effect 只读 ref，避免依赖变化触发重新自动提交
  // （CR1-016：原代码用 eslint-disable-next-line react-hooks/exhaustive-deps 绕过，此处改用 ref 模式）
  const handleSubmitRef = React.useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

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
      void handleSubmitRef.current(problem, true);
    } catch {
      setError('原题目数据读取失败，请重新输入');
    }
  }, [setInputType, setTextContent, setPlatformUrl, setImageBase64, setError]);

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

  // 表单提交：重置折叠面板 + 调用 hook 提交
  const onSubmit = (explicitProblem?: Problem, regenerate?: boolean): void => {
    const problem = explicitProblem ?? buildProblem();
    if (!problem) return;
    setShowThinking(false);
    setShowOrganizing(false);
    void handleSubmit(problem, regenerate);
  };

  return (
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

        {loading && organizingContent && (
          <div className="rounded border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowOrganizing((v) => !v)}
              className="flex w-full items-center gap-2 p-3 text-left text-sm text-foreground hover:bg-muted/50"
              aria-expanded={showOrganizing}
            >
              {showOrganizing ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <PenLine className="h-4 w-4 shrink-0 text-primary" />
              <span>AI 组织回答</span>
              <span className="text-xs text-muted-foreground">
               （{organizingContent.length} 字）
              </span>
            </button>
            {showOrganizing && (
              <div className="max-h-96 overflow-y-auto border-t border-border p-3">
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {organizingContent}
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => onSubmit()}
            disabled={loading}
            className="min-w-32"
          >
            {loading ? '处理中...' : '生成解题方案'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
