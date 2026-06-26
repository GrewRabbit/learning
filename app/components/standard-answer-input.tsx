// app/components/standard-answer-input.tsx
// 标准答案补充区（FR-004/005）：可折叠、文本粘贴 + 文件上传
// 受控组件：value/onChange 由父组件 InputSection 持有，便于「生成解答」按钮读取

'use client';

import * as React from 'react';
import { ChevronDown, FileCode, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { logClientError } from '@/app/lib/logging/logger';
import { cn } from '@/lib/utils';

/**
 * 标准答案输入组件 Props
 */
export interface StandardAnswerInputProps {
  /** 当前标准答案文本（受控） */
  value: string;
  /** 标准答案变更回调 */
  onChange: (value: string) => void;
  /** 字符上限（NFR-010：≤ 20000） */
  maxLength?: number;
  /** 文件大小上限（字节，NFR-010：≤ 1MB） */
  maxFileSizeBytes?: number;
  /** 允许的文件扩展名（NFR-010：.cpp/.txt/.h/.hpp） */
  allowedExtensions?: readonly string[];
}

/** 文件大小上限默认值：1MB（NFR-010） */
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** 允许的文件扩展名默认值（NFR-010） */
const DEFAULT_ALLOWED_EXTENSIONS = ['.cpp', '.txt', '.h', '.hpp'] as const;

/** 字符上限默认值（NFR-010） */
const DEFAULT_MAX_LENGTH = 20000;

/**
 * 标准答案补充区（可折叠，默认折叠）
 * - 文本粘贴：Textarea，≤ 20000 字符（超出截断并提示）
 * - 文件上传：.cpp/.txt/.h/.hpp，≤ 1MB，读取文件内容回填到 Textarea
 */
export function StandardAnswerInput({
  value,
  onChange,
  maxLength = DEFAULT_MAX_LENGTH,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE,
  allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
}: StandardAnswerInputProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /** 处理文本输入：超长截断并提示 */
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value;
    if (next.length > maxLength) {
      setErrorMessage(`标准答案长度上限为 ${maxLength} 字符，已截断`);
      onChange(next.slice(0, maxLength));
    } else {
      setErrorMessage(null);
      onChange(next);
    }
  };

  /** 校验文件类型与大小，读取内容回填 Textarea */
  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    if (!allowedExtensions.includes(ext)) {
      setErrorMessage(
        `不支持的文件类型：${ext}，仅支持 ${allowedExtensions.join(' / ')}`,
      );
      e.target.value = '';
      return;
    }

    if (file.size > maxFileSizeBytes) {
      setErrorMessage(
        `文件大小超过 ${(maxFileSizeBytes / 1024 / 1024).toFixed(1)}MB 上限`,
      );
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      if (text.length > maxLength) {
        setErrorMessage(`文件内容超过 ${maxLength} 字符上限，已截断`);
        onChange(text.slice(0, maxLength));
      } else {
        setErrorMessage(null);
        onChange(text);
      }
    } catch (error) {
      logClientError('标准答案文件读取失败', { error });
      setErrorMessage('文件读取失败，请重试');
    } finally {
      // 重置 input value 允许重复选择同一文件
      e.target.value = '';
    }
  };

  /** 清空标准答案 */
  const handleClear = (): void => {
    onChange('');
    setErrorMessage(null);
  };

  /** 触发文件选择 */
  const handleUploadClick = (): void => {
    fileInputRef.current?.click();
  };

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        <span>
          标准答案补充（可选）
          {value.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              已填写 {value.length} 字符
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            isExpanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            补充标准答案后，「生成解答」将切换为「基于标准答案深度解读」模式重新生成全部产物（FR-005）。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUploadClick}
            >
              <Upload className="h-4 w-4" />
              上传文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={allowedExtensions.join(',')}
              onChange={handleFileChange}
              className="hidden"
              aria-label="上传标准答案文件"
            />
            <span className="text-xs text-muted-foreground">
              支持 {allowedExtensions.join(' / ')}，≤ {(maxFileSizeBytes / 1024 / 1024).toFixed(1)}MB
            </span>
            {value.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
              >
                <X className="h-4 w-4" />
                清空
              </Button>
            )}
          </div>

          <Textarea
            value={value}
            onChange={handleTextChange}
            placeholder="粘贴标准答案文本，或上传 .cpp / .txt / .h / .hpp 文件..."
            className="min-h-[160px] font-mono"
            maxLength={maxLength}
            aria-label="标准答案文本输入"
          />

          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                'text-muted-foreground',
                value.length > maxLength * 0.9 && 'text-destructive',
              )}
            >
              {value.length} / {maxLength}
            </span>
            {errorMessage ? (
              <span className="flex items-center gap-1 text-destructive">
                <FileCode className="h-3 w-3" />
                {errorMessage}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
