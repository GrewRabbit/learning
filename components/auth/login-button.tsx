// app/components/auth/login-button.tsx
// 登录入口按钮（架构 §6 模块 M7，AR1-008：仅 UI 入口，不接业务逻辑状态）
// - 生成 PKCE code_verifier(≥43) + code_challenge=SHA256、state(≥32)、nonce(≥32)
//   （lib/sso/pkce.ts 同构实现，'use client' 可用）
// - 写入 sessionStorage（code_verifier/state/nonce/returnTo，前端副本；服务端 cookie 为权威，AR1-003 双写）
// - 动态构造 form POST /api/sso/authorize（隐藏字段走 body，敏感值不落 URL，FR-003）
// - returnTo 取当前路径（usePathname）或 props 传入（同源相对路径，FR-023）

'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from '@/app/lib/sso/pkce';

/** sessionStorage 键名（前端副本；服务端状态 cookie 为权威） */
const SESSION_KEYS = ['sso_code_verifier', 'sso_state', 'sso_nonce', 'sso_returnTo'] as const;

interface LoginButtonProps {
  /** 登录成功后的同源回跳路径（默认取当前路径；须为 / 开头同源相对路径） */
  returnTo?: string;
  /** 按钮尺寸（默认 default；Header 等紧凑场景传 xs） */
  size?: 'default' | 'sm' | 'lg' | 'xs' | 'icon';
  children?: React.ReactNode;
}

/** 追加隐藏字段到动态表单（name/value 均走 body，不落 URL） */
function appendHiddenField(form: HTMLFormElement, name: string, value: string): void {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

/** 登录入口按钮：点击后生成 PKCE/state/nonce → 写 sessionStorage → 提交 /api/sso/authorize */
export function LoginButton({ returnTo, size, children }: LoginButtonProps): React.JSX.Element {
  const pathname = usePathname();
  const [isPending, setIsPending] = React.useState(false);

  const handleLogin = async (): Promise<void> => {
    if (isPending) {
      return;
    }
    setIsPending(true);
    try {
      // 生成 PKCE/CSRF/防重放参数（FR-002；同构实现，浏览器环境可直接调用）
      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = await generateState();
      const nonce = await generateNonce();
      const target = returnTo ?? pathname ?? '/';

      // 写 sessionStorage 前端副本（AR1-003 双写；服务端 cookie 为权威副本）
      const payload: Record<string, string> = {
        sso_code_verifier: codeVerifier,
        sso_state: state,
        sso_nonce: nonce,
        sso_returnTo: target,
      };
      for (const key of SESSION_KEYS) {
        sessionStorage.setItem(key, payload[key]);
      }

      // 动态构造 form POST /api/sso/authorize（隐藏字段走 body，敏感值不落 URL，FR-003）
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/sso/authorize';
      form.style.display = 'none';
      appendHiddenField(form, 'code_verifier', codeVerifier);
      appendHiddenField(form, 'code_challenge', codeChallenge);
      appendHiddenField(form, 'state', state);
      appendHiddenField(form, 'nonce', nonce);
      appendHiddenField(form, 'returnTo', target);
      document.body.appendChild(form);
      form.submit();
    } catch {
      // 生成失败（如非安全环境）：还原按钮可用状态，不跳转
      setIsPending(false);
    }
  };

  return (
    <Button type="button" onClick={handleLogin} disabled={isPending} size={size}>
      {children ?? '登录'}
    </Button>
  );
}
