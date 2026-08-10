// app/components/auth/session-status.tsx
// 登录状态提示占位组件（架构 §6 模块 M7，本步骤最小实现）
// - 读 sessionStorage 是否有会话标记（登录按钮写入的前端副本），无则提示未登录
// - 不作为受保护信息源（AR1-008：仅 UI 提示；服务端 cookie/中间件才是权威判断）
// - 注：会话标记在登出后仍保留于 sessionStorage，本组件仅作占位提示，后续步骤可对接真实状态源

'use client';

import * as React from 'react';

/** 会话标记键（与 login-button 写入的前端副本一致） */
const SESSION_MARKER_KEY = 'sso_state';

/** 登录状态提示（最小实现：sessionStorage 会话标记存在与否） */
export function SessionStatus(): React.JSX.Element {
  const [hasSessionMarker, setHasSessionMarker] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setHasSessionMarker(sessionStorage.getItem(SESSION_MARKER_KEY) !== null);
  }, []);

  if (hasSessionMarker === null) {
    return <span aria-live="polite">正在检查登录状态…</span>;
  }
  return (
    <span aria-live="polite">{hasSessionMarker ? '已登录' : '未登录'}</span>
  );
}
