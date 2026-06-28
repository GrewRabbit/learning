// app/solve/page.tsx
// 题目输入页（架构 §6 + §4.3 + FR-001/002/003）
// 三种输入方式：文本 / 图片 / 多平台 URL（Tabs 切换）
// 提交后调用 POST /api/solve，结果存 sessionStorage 后跳转 /result

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Problem, ServiceResult, Solution } from '@/app/lib/ai/types';

/** 图片大小上限 5MB（与 Zod schema 一致，架构 §5.3） */
const IMAGE_MAX_SIZE = 5 * 1024 * 1024;
/** 文本内容上限 10000 字符（架构 §5.3） */
const TEXT_MAX_LENGTH = 10_000;

/** sessionStorage 中暂存 Solution 的 key */
export const SOLUTION_STORAGE_KEY = 'gesp6:solution';

type InputType = 'text' | 'image' | 'platform';

export default function SolvePage(): React.JSX.Element {
  const router = useRouter();
  const [inputType, setInputType] = React.useState<InputType>('text');
  const [textContent, setTextContent] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [imageBase64, setImageBase64] = React.useState('');
  const [platformUrl, setPlatformUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 图片上传转 base64
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) {
      setImageBase64('');
      setImageUrl('');
      return;
    }
    if (file.size > IMAGE_MAX_SIZE) {
      setError('图片大小不能超过 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result 格式：data:image/png;base64,xxxx
      // 提取 base64 部分（Zod schema 校验 content 长度，架构 §5.3）
      const base64 = result.split(',')[1] ?? '';
      setImageBase64(base64);
      setImageUrl(result);
    };
    reader.onerror = () => setError('图片读取失败');
    reader.readAsDataURL(file);
  };

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

  // 提交
  const handleSubmit = async (): Promise<void> => {
    setError(null);
    const problem = buildProblem();
    if (!problem) return;

    setLoading(true);
    try {
      const res = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem }),
      });
      const result = (await res.json()) as ServiceResult<Solution>;
      if (!result.success || !result.data) {
        setError(result.error?.message ?? '生成失败');
        return;
      }
      // 存入 sessionStorage，跳转 /result
      sessionStorage.setItem(SOLUTION_STORAGE_KEY, JSON.stringify(result.data));
      router.push('/result');
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          GESP6 解题网页生成器
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成解题讲解网页
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
              <Label htmlFor="image-input">题目图片（jpg/png，≤ 5MB）</Label>
              <Input
                id="image-input"
                type="file"
                accept="image/jpeg,image/png"
                onChange={handleImageChange}
              />
              {imageUrl && (
                <div className="mt-2">
                  {/* 本地预览用 img，next/image 对 data URL 无优化意义 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="题目预览"
                    className="max-h-64 rounded border border-border"
                  />
                </div>
              )}
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

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="min-w-32"
            >
              {loading ? '生成中...' : '生成解题网页'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
