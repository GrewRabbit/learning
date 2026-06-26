// app/solution/components/code-display.tsx
// 代码展示组件（FR-011/012/013）
// - 流式过程显示纯文本（逐块追加）
// - stage1-done 后调用服务端 Server Action highlightCode 重新高亮（FR-013）
// - 不使用 dangerouslySetInnerHTML，改为渲染 token spans（React 自动转义文本）
//   既满足 NFR-017 又满足"Shiki 服务端渲染"约束（架构 ADR-07）
// - 显示行号
// - 复制代码按钮（FR-012）

'use client';

import * as React from 'react';
import type { TokensResult } from 'shiki';
import { Check, Copy, Loader, RefreshCw } from 'lucide-react';

import { highlightCode } from '@/app/solution/actions';
import { logClientError } from '@/app/lib/logging/logger';
import { Button } from '@/components/ui/button';

/**
 * 代码展示组件 Props
 */
export interface CodeDisplayProps {
  /** 当前累积的代码文本（流式追加） */
  code: string;
  /** Stage 1 是否完成（触发 Shiki 重新高亮 FR-013） */
  isStage1Done: boolean;
  /** Stage 1 完成时 codeEmpty 标志（true 表示代码区为空，需降级 UI） */
  codeEmpty: boolean | null;
  /** 重新生成回调（降级 UI 中「重新生成」按钮触发，FR-005/§4.2.4） */
  onRegenerate: () => void;
}

/**
 * 代码展示组件
 */
export function CodeDisplay({
  code,
  isStage1Done,
  codeEmpty,
  onRegenerate,
}: CodeDisplayProps): React.JSX.Element {
  const [tokensResult, setTokensResult] = React.useState<TokensResult | null>(null);
  const [isHighlighting, setIsHighlighting] = React.useState(false);
  const [highlightError, setHighlightError] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  /**
   * Stage 1 完成后调用服务端 Server Action 重新高亮（FR-013，架构 ADR-07）
   * 仅在 isStage1Done 由 false 变 true 时触发一次，避免重复高亮
   */
  React.useEffect(() => {
    if (!isStage1Done || codeEmpty) {
      return;
    }
    if (tokensResult || isHighlighting) {
      return;
    }
    let cancelled = false;
    setIsHighlighting(true);
    highlightCode(code)
      .then((result) => {
        if (!cancelled) {
          if (result) {
            setTokensResult(result);
            setHighlightError(false);
          } else {
            // 服务端返回 null 表示高亮失败（已记录日志），降级到纯文本
            setHighlightError(true);
          }
        }
      })
      .catch((error) => {
        logClientError('Shiki 高亮调用失败', { error: error instanceof Error ? error.message : String(error) });
        if (!cancelled) {
          setHighlightError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsHighlighting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isStage1Done, codeEmpty, code, tokensResult, isHighlighting]);

  /** 复制代码（FR-012） */
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logClientError('复制代码失败', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** 降级 UI：代码区为空（标记缺失或 LLM 未生成代码，§4.2.4） */
  if (codeEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/30 py-12 text-center">
        <p className="text-sm text-destructive">代码生成异常，请重试</p>
        <Button type="button" variant="outline" size="sm" onClick={onRegenerate}>
          <RefreshCw className="h-4 w-4" />
          重新生成
        </Button>
      </div>
    );
  }

  /** 代码区为空且未流式（初始加载） */
  if (!code && !isStage1Done) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 py-12 text-muted-foreground">
        <Loader className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">正在生成代码...</span>
      </div>
    );
  }

  /** 顶部工具栏：复制按钮 */
  const toolbar = (
    <div className="flex items-center justify-end border-b border-border px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        disabled={!code}
      >
        {copied ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copied ? '已复制' : '复制代码'}
      </Button>
    </div>
  );

  /**
   * 已高亮：渲染 Shiki tokens（FR-011/013）
   * - 不使用 dangerouslySetInnerHTML，改为遍历 tokens 渲染 <span>
   * - React 自动转义 token.content 文本，安全（NFR-017）
   * - token.color 为 Shiki 主题提供的语法着色，属 token 级着色非页面级样式
   */
  if (tokensResult && !highlightError) {
    return (
      <div className="overflow-hidden rounded-md border border-border">
        {toolbar}
        <div className="overflow-auto bg-muted text-sm">
          <pre className="min-w-full p-4 font-mono leading-relaxed">
            <code>
              {tokensResult.tokens.map((line, lineIdx) => (
                <div key={lineIdx} className="table-row">
                  <span
                    className="table-cell select-none pr-4 text-right text-muted-foreground"
                    aria-hidden
                  >
                    {lineIdx + 1}
                  </span>
                  <span className="table-cell whitespace-pre">
                    {line.length === 0 ? (
                      <span> </span>
                    ) : (
                      line.map((token, tokenIdx) => (
                        <span
                          key={tokenIdx}
                          style={
                            token.color
                              ? { color: token.color }
                              : undefined
                          }
                        >
                          {token.content}
                        </span>
                      ))
                    )}
                  </span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      </div>
    );
  }

  /**
   * 流式或高亮失败降级：显示纯文本 + 行号（FR-013 流式追加）
   * 高亮失败时（highlightError）也走此分支，确保用户可读
   */
  const lines = code.split('\n');
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {toolbar}
      <div className="overflow-auto bg-muted p-4 text-sm">
        <pre className="min-w-full font-mono leading-relaxed text-foreground">
          <code>
            {lines.map((line, lineIdx) => (
              <div key={lineIdx} className="table-row">
                <span
                  className="table-cell select-none pr-4 text-right text-muted-foreground"
                  aria-hidden
                >
                  {lineIdx + 1}
                </span>
                <span className="table-cell whitespace-pre">
                  {line || ' '}
                </span>
              </div>
            ))}
          </code>
        </pre>
        {isHighlighting && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader className="h-3 w-3 animate-spin" />
            正在高亮代码...
          </div>
        )}
      </div>
    </div>
  );
}
