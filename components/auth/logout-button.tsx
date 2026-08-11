// app/components/auth/logout-button.tsx
// 登出入口按钮（架构 §6 模块 M7，AR2-007：form POST /api/sso/logout）
// - method=post + action=/api/sso/logout（仅 POST 端点，GET → 405）
// - 默认携带隐藏字段 post_logout_redirect_uri='/'（service 白名单，FR-022/OQ-007）：
//   服务端据此返回 end_session 自动提交页，IDP 全局登出后回跳我方首页 '/'；
//   可传参覆盖（须命中服务端白名单），传空串/undefined 则不携带
// - 纯 UI 入口：无业务状态依赖，登出编排由服务端完成（AR1-008）

'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

interface LogoutButtonProps {
  /**
   * 登出后回跳路径（默认 '/'，OQ-007 白名单；在服务端白名单内则触发 end_session 回跳，
   * 传空串 / undefined 则不携带该字段，走本地登出 200 响应）
   */
  postLogoutRedirectUri?: string;
  children?: React.ReactNode;
}

const DEFAULT_LOGOUT_REDIRECT_URI = '/';

/** 登出入口：form POST /api/sso/logout（隐藏字段走 body，不落 URL） */
export function LogoutButton({
  postLogoutRedirectUri = DEFAULT_LOGOUT_REDIRECT_URI,
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
