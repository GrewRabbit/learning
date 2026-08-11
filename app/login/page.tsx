// app/login/page.tsx
// 登录入口页（架构 §6 D-005/FR-030，RSC）
// 职责：cookie 级登录态粗检（解码 exp 不验签，FR-016 语义）→ 已登录 302 回跳 returnTo
//       或默认落地页（OQ-009：/solve）；未登录渲染 login-client（returnTo 透传 + 错误提示）

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import {
  ACCESS_TOKEN_COOKIE_NAME,
  DEFAULT_RETURN_TO,
  isSafeReturnTo,
} from '@/app/lib/sso/token-cookie';
import { LoginClient } from './login-client';

/**
 * 解码 JWT payload 的 exp（仅 base64url 解码不验签，与 middleware 同思路，FR-016 粗检语义）
 * 解析失败/缺少 exp → undefined（登录页为公开页，fail-open 渲染登录入口）
 */
function decodeJwtExp(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const base64 = (parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp
      : undefined;
  } catch {
    return undefined;
  }
}

/** 排除与 /login 或 /{locale}/login 规范化相等的回跳目标（FR-030/AR3-001 防死循环） */
function isLoginPath(target: string): boolean {
  const path = target.split(/[?#]/)[0]?.replace(/\/+$/, '') ?? '';
  if (path === '/login') {
    return true;
  }
  // [locale] 未落地前无支持列表，按结构识别一层前缀的 /{locale}/login
  return /^\/[^/]+\/login$/.test(path);
}

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}

export default async function LoginPage({
  searchParams,
}: LoginPageProps): Promise<React.JSX.Element> {
  const params = await searchParams;
  const rawReturnTo = typeof params.returnTo === 'string' ? params.returnTo : '';
  // returnTo 经 FR-023 校验并排除登录页自身（FR-030/AR3-001），非法回退默认落地页（OQ-009）
  const returnTo =
    isSafeReturnTo(rawReturnTo) && !isLoginPath(rawReturnTo) ? rawReturnTo : undefined;

  // 登录态粗检（FR-016 语义：仅解码 exp 不验签，公开页不引入 Node 验签）
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const exp = token !== undefined ? decodeJwtExp(token) : undefined;
  if (exp !== undefined && exp > Math.floor(Date.now() / 1000)) {
    redirect(returnTo ?? DEFAULT_RETURN_TO);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-4 py-8">
      <LoginClient returnTo={returnTo} />
    </main>
  );
}
