// app/result/components/loading-animation.tsx
// loading 动画（架构 §4.3 + FR-018）
// 生成期间显示动画提示

import * as React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingAnimationProps {
  /** 是否显示 */
  loading: boolean;
  /** 提示文案 */
  message?: string;
}

/**
 * LoadingAnimation：生成期间显示动画
 *
 * 使用语义色变量（component-rules.md 禁止原始色值）
 */
export function LoadingAnimation({
  loading,
  message = '正在生成解题方案，请稍候...',
}: LoadingAnimationProps): React.JSX.Element | null {
  if (!loading) return null;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
