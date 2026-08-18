// tests/e2e-tests/helpers/sso-login.ts
// SSO 真实登录共享 helper：供 sso-login.spec.ts（@llm 流程测试）与 auth.setup.ts（storageState 预登录）复用

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const IDP_BASE = 'https://auth.happyrabbit.top';
// 登录页 locale 由 IDP 决定（默认英文），提交按钮文案随 locale 变化
export const LOGIN_URL = /\/login(\?|$)/;
// 首次登录需在 IDP 同意授权范围（consent 页按钮文案随 locale 变化）
export const CONSENT_URL = /\/consent(\?|$)/;

export const SSO_VERIFIER =
  'e9f0b7d1c2a84f3e9d0c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8';
export const SSO_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** 发起 authorize（302 到 IDP 授权端点）并返回 location */
export async function startAuthorize(page: Page): Promise<string> {
  const response = await page.request.post('/api/sso/authorize', {
    form: {
      code_verifier: SSO_VERIFIER,
      code_challenge: SSO_CHALLENGE,
      state: 'probe-state-0123456789abcdefghijklmnopqrstuvwxyz',
      nonce: 'probe-nonce-0123456789abcdefghijklmnopqrstuvwxyz',
    },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location = response.headers().location;
  // 应用 302 到 IDP 授权端点（用户未登录时 IDP 再 302 到登录页）
  expect(location).toMatch(new RegExp(`^${IDP_BASE.replace('.', '\\.')}/api/sso/authorize`));
  expect(location).toContain('client_id=client_bc8ab3c7cac38c59876336ec9a2f036f');
  expect(location).toContain('code_challenge_method=S256');
  return location;
}

/** 登录 → （如 IDP 弹出同意页）点击 Allow → 回到应用 */
export async function loginAndConsent(page: Page): Promise<void> {
  const usernameInput = page.locator('input[name="username"]');
  const passwordInput = page.locator('input[name="password"]');
  await expect(usernameInput).toBeVisible({ timeout: 30_000 });
  await usernameInput.fill(process.env.SSO_TEST_USERNAME ?? 'a0000000');
  await passwordInput.fill(process.env.SSO_TEST_PASSWORD ?? 'Sin00cean');
  await page.locator('button[type="submit"]').click();

  // 等待离开 IDP：可能弹 consent（点 Allow）或直接回跳应用；最终回到应用即完成
  await page.waitForURL((url) => url.origin !== IDP_BASE, { timeout: 30_000 });
  if (page.url().includes('/consent')) {
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL((url) => url.origin !== IDP_BASE, { timeout: 30_000 });
  }
}

/** 完整登录流程：authorize → 登录 → consent → 回到应用默认落地页（/solve，OQ-009） */
export async function ssoLogin(page: Page): Promise<void> {
  const location = await startAuthorize(page);
  await page.goto(location);
  await expect(page).toHaveURL(LOGIN_URL, { timeout: 30_000 });
  await loginAndConsent(page);
  await page.waitForURL(
    (url) => url.origin === 'http://localhost:3000' && url.pathname === '/solve',
    { timeout: 30_000 },
  );
}
