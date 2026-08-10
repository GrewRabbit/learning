// app/components/auth/logout-button.tsx
// 登出入口按钮（架构 §6 模块 M7，AR2-007：form POST /api/sso/logout）
// - method=post + action=/api/sso/logout（仅 POST 端点，GET → 405）
// - 可选隐藏字段 post_logout_redirect_uri（props 传入，默认不传；须命中服务端白名单，FR-022）
// - 纯 UI 入口：无业务状态依赖，登出编排由服务端完成（AR1-008）

'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

interface LogoutButtonProps {
  /** 登出后回跳路径（可选，默认不传；须在服务端白名单内，FR-022/OQ-007 默认仅 '/'） */
  postLogoutRedirectUri?: string;
  children?: React.ReactNode;
}

/** 登出入口：form POST /api/sso/logout（隐藏字段走 body，不落 URL） */
export function LogoutButton({
  postLogoutRedirectUri,
  children,
}: LogoutButtonProps): React.JSX.Element {
  return (
    <form method="post" action="/api/sso/logout">
      {postLogoutRedirectUri ? (
        <input type="hidden" name="post_logout_redirect_uri" value={postLogoutRedirectUri} />
      ) : null}
      <Button type="submit">{children ?? '退出登录'}</Button>
    </form>
  );
}
