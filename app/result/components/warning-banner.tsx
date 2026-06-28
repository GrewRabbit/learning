// app/result/components/warning-banner.tsx
// 警告横幅（架构 §4.3 + FR-019）
// validated: false 时显示"代码未通过验证，仅供参考"

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface WarningBannerProps {
  /** 警告信息（来自 Solution.warning） */
  warning?: string;
}

/**
 * WarningBanner：validated=false 时顶部显示警告横幅
 *
 * 使用语义色变量 --color-warning（component-rules.md 禁止原始色值）
 */
export function WarningBanner({
  warning,
}: WarningBannerProps): React.JSX.Element | null {
  if (!warning) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warning/30 p-3 text-sm"
      style={{
        backgroundColor: 'hsl(var(--color-warning) / 0.1)',
        color: 'hsl(var(--color-warning))',
      }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>
        <p className="font-medium">代码未通过验证，仅供参考</p>
        <p className="mt-1 text-xs opacity-80">{warning}</p>
      </div>
    </div>
  );
}
