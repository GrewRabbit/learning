// app/components/problem-input.tsx
// 题目输入区（FR-001/002/003）：文本输入 + 图片上传 + 识别 + 生成解答
// 受控组件：problemText/onProblemTextChange 由父组件 InputSection 持有
// standardAnswer 由父组件传入，用于决定 mode='normal' | 'deep'（FR-005）

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Loader, Send, Sparkles, X } from 'lucide-react';

import { recognizeImage } from '@/app/actions';
import type { ServiceResult } from '@/app/lib/ai/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * 题目输入组件 Props
 */
export interface ProblemInputProps {
  /** 当前题目文本（受控） */
  problemText: string;
  /** 题目文本变更回调 */
  onProblemTextChange: (value: string) => void;
  /** 标准答案（由父组件传入，用于决定生成模式 FR-005） */
  standardAnswer: string;
  /** 字符上限（NFR-010：≤ 10000） */
  maxLength?: number;
}

/** 字符上限默认值（NFR-010） */
const DEFAULT_MAX_LENGTH = 10000;

/** 图片大小上限：10MB（NFR-010） */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/** 允许的图片 MIME 类型（NFR-010） */
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** useActionState 初始状态 */
const INITIAL_ACTION_STATE: ServiceResult<{ text: string }> = {
  success: false,
  error: { code: 'INIT', message: '' },
};

/**
 * 题目输入区组件
 * - 多行文本输入（≤ 10000 字符，超出截断并提示）
 * - 图片上传（拖拽/粘贴/点击），上传后显示缩略图
 * - 「识别」按钮手动触发图片识别（调用 recognizeImage Server Action）
 * - 识别结果回填到题目文本框（可编辑）
 * - 「生成解答」按钮：提交后跳转到 /solution（携带 problem 与可选 standardAnswer）
 */
export function ProblemInput({
  problemText,
  onProblemTextChange,
  standardAnswer,
  maxLength = DEFAULT_MAX_LENGTH,
}: ProblemInputProps): React.JSX.Element {
  const router = useRouter();
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [imageBase64, setImageBase64] = React.useState<string | null>(null);
  const [imageMime, setImageMime] = React.useState<string | null>(null);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // useActionState 配合 recognizeImage Server Action（api-conventions.md 表单处理规范）
  // React 19 useActionState 签名要求 action 接收 (prevState, formData)，故包装一层
  const [actionState, action, isPending] = React.useActionState(
    async (
      _prevState: ServiceResult<{ text: string }>,
      formData: FormData,
    ): Promise<ServiceResult<{ text: string }>> => {
      return recognizeImage(formData);
    },
    INITIAL_ACTION_STATE,
  );

  /** 处理文本输入：超长截断并提示 */
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    if (next.length > maxLength) {
      onProblemTextChange(next.slice(0, maxLength));
    } else {
      onProblemTextChange(next);
    }
  };

  /** 校验图片类型与大小，FileReader 读取为 base64 */
  const handleImageFile = (file: File): void => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      setImageError('仅支持 JPG / PNG / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError('图片大小超过 10MB 上限');
      return;
    }
    setImageError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setImageError('图片读取失败');
        return;
      }
      // result 形如 "data:image/jpeg;base64,xxxx"
      const base64 = result.split(',')[1] ?? '';
      const preview = result;
      setImagePreview(preview);
      setImageBase64(base64);
      setImageMime(file.type);
    };
    reader.onerror = () => {
      setImageError('图片读取失败');
    };
    reader.readAsDataURL(file);
  };

  /** 处理文件选择 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
    e.target.value = '';
  };

  /** 处理拖拽放下 */
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleImageFile(file);
    }
  };

  /** 处理粘贴（仅处理图片） */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleImageFile(file);
          return;
        }
      }
    }
  };

  /** 清除已上传图片 */
  const handleClearImage = (): void => {
    setImagePreview(null);
    setImageBase64(null);
    setImageMime(null);
    setImageError(null);
  };

  /**
   * 触发图片识别（FR-003）
   * 通过隐藏 form + action 提交，由 useActionState 接管状态
   */
  const handleRecognize = (): void => {
    if (!imageBase64 || !imageMime) {
      return;
    }
    // 通过 form requestSubmit 触发 useActionState 绑定的 action
    recognizeFormRef.current?.requestSubmit();
  };

  const recognizeFormRef = React.useRef<HTMLFormElement>(null);

  /**
   * 识别成功后回填到题目文本框（可编辑，FR-003）
   * 仅在 actionState 变化且 success 时回填
   */
  React.useEffect(() => {
    if (actionState.success && actionState.data?.text) {
      const recognized = actionState.data.text;
      onProblemTextChange(recognized);
    }
  }, [actionState, onProblemTextChange]);

  /** 识别错误信息（取最近一次 action 失败） */
  const recognizeError =
    !actionState.success && actionState.error?.code !== 'INIT'
      ? actionState.error?.message ?? null
      : null;

  /**
   * 生成解答（FR-005）
   * - 携带 problem（题目文本）与可选 standardAnswer
   * - 通过 query string 传递给 /solution 页面
   * - standardAnswer 非空时 mode=deep，否则 mode=normal
   */
  const handleGenerate = (): void => {
    if (!problemText.trim()) {
      return;
    }
    const params = new URLSearchParams();
    params.set('problem', problemText);
    if (standardAnswer.trim()) {
      params.set('standardAnswer', standardAnswer);
      params.set('mode', 'deep');
    } else {
      params.set('mode', 'normal');
    }
    router.push(`/solution?${params.toString()}`);
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="problem-text" className="text-base">
          C++ 编程题目
        </Label>
        <Textarea
          id="problem-text"
          value={problemText}
          onChange={handleTextChange}
          onPaste={handlePaste}
          placeholder="请输入或粘贴 C++ 编程题目文本...&#10;支持粘贴图片（自动识别为文本）"
          className="min-h-[200px]"
          maxLength={maxLength}
          aria-label="C++ 编程题目输入"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {problemText.length} / {maxLength}
            {problemText.length >= maxLength && (
              <span className="ml-2 text-destructive">已达上限</span>
            )}
          </span>
          {standardAnswer.trim() && (
            <span className="flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              将以「基于标准答案深度解读」模式生成
            </span>
          )}
        </div>
      </div>

      {/* 图片上传区（拖拽/粘贴/点击，FR-002） */}
      <div className="space-y-2">
        <Label className="text-base">题目图片（可选）</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          onChange={handleFileChange}
          className="hidden"
          aria-label="上传题目图片"
        />
        {imagePreview ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- 缩略图为本地 FileReader 生成的 data URL，无需 next/image 优化 */}
            <img
              src={imagePreview}
              alt="题目图片预览"
              className="max-h-48 rounded-md border border-border"
            />
            <button
              type="button"
              onClick={handleClearImage}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
              aria-label="移除图片"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              'flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:bg-muted',
              dragOver && 'border-primary bg-accent',
            )}
            role="button"
            tabIndex={0}
            aria-label="点击或拖拽上传图片"
          >
            <ImagePlus className="h-8 w-8" />
            <p className="text-sm">点击、拖拽或粘贴上传题目图片</p>
            <p className="text-xs">支持 JPG / PNG / WebP，≤ 10MB</p>
          </div>
        )}

        {imageError && (
          <p className="text-xs text-destructive">{imageError}</p>
        )}

        {/* 识别按钮（FR-003）：useActionState 配合隐藏 form */}
        {imageBase64 && imageMime && (
          <form ref={recognizeFormRef} action={action} className="hidden">
            <input type="hidden" name="imageBase64" value={imageBase64} />
            <input type="hidden" name="mimeType" value={imageMime} />
            <button type="submit" aria-hidden tabIndex={-1}>
              submit
            </button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRecognize}
            disabled={!imageBase64 || isPending}
          >
            {isPending ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isPending ? '识别中...' : '识别图片'}
          </Button>
          {recognizeError && (
            <span className="text-xs text-destructive">{recognizeError}</span>
          )}
        </div>
      </div>

      {/* 生成解答按钮（FR-005） */}
      <div className="flex items-center justify-end border-t border-border pt-4">
        <Button
          type="button"
          size="lg"
          onClick={handleGenerate}
          disabled={!problemText.trim()}
        >
          <Send className="h-4 w-4" />
          生成解答
        </Button>
      </div>
    </section>
  );
}
