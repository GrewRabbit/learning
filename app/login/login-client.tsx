// app/login/login-client.tsx
// 登录入口页交互（架构 §6 D-005/FR-030，'use client'）
// 职责：returnTo 透传（RSC 已校验）+ 登录按钮（复用 login-button）+ 登录错误提示（FR-026 脱敏）

'use client';

import * as React from 'react';

import { LoginButton } from '@/components/auth/login-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';

interface LoginClientProps {
  /** 登录成功后的同源回跳路径（RSC 侧经 isSafeReturnTo 校验并排除登录页自身，FR-023/FR-030） */
  returnTo?: string;
}

/**
 * 登录入口页主体：错误仅展示安全通用文案，不展示原始 error.message（FR-026 脱敏）
 */
export function LoginClient({ returnTo }: LoginClientProps): React.JSX.Element {
  const [errorCode, setErrorCode] = React.useState<string | null>(null);

  // 读取 URL 中登录流程失败回跳的错误码（FR-030③；回调失败当前返回 JSON envelope，提示位预留）
  React.useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code !== null && code.length > 0) {
      setErrorCode(code);
    }
  }, []);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center space-y-4 text-center">
        <Logo size="lg" />
        <CardTitle>登录</CardTitle>
        <CardDescription>登录后即可使用 AI 解题服务</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <LoginButton returnTo={returnTo}>登录</LoginButton>
        {errorCode !== null && (
          <p role="alert" className="text-sm text-destructive">
            登录失败（{errorCode}），请重新尝试
          </p>
        )}
      </CardContent>
    </Card>
  );
}
