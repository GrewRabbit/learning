// tests/e2e-tests/specs/sso-login.spec.ts
// SSO 真实登录 E2E（testing-standards.md §四 @llm 标签：依赖真实 IDP）
// 依赖：dev server 已配 SSO 环境变量（SSO_ISSUER=https://auth.happyrabbit.top 等）
// 账户：a0000000/Sin00cean（用户提供的测试账户，勿删）
// 运行前提：需以 npm run dev:test 启动 dev server（关闭中间件限流）；playwright.config webServer 已自动使用。
import { test, expect } from '@playwright/test';

const IDP_BASE = 'https://auth.happyrabbit.top';
// 登录页 locale 由 IDP 决定（默认英文），提交按钮文案随 locale 变化
const LOGIN_URL = /\/login(\?|$)/;
// 首次登录需在 IDP 同意授权范围（consent 页按钮文案随 locale 变化）
const CONSENT_URL = /\/consent(\?|$)/;

/** 登录 → （如 IDP 弹出同意页）点击 Allow → 回跳应用 */
async function loginAndConsent(page: import('@playwright/test').Page) {
  const usernameInput = page.locator('input[name="username"]');
  const passwordInput = page.locator('input[name="password"]');
  await expect(usernameInput).toBeVisible({ timeout: 30_000 });
  await usernameInput.fill(process.env.SSO_TEST_USERNAME ?? 'a0000000');
  await passwordInput.fill(process.env.SSO_TEST_PASSWORD ?? 'Sin00cean');
  await page.locator('button[type="submit"]').click();

  // 等待离开 IDP：可能弹 consent（点 Allow）或直接回跳应用；最终回到应用即完成
  await page.waitForURL(
    (url) => url.origin !== 'https://auth.happyrabbit.top',
    { timeout: 30_000 },
  );
  if (page.url().includes('/consent')) {
    await page.getByRole('button', { name: 'Allow' }).click();
    await page.waitForURL(
      (url) => url.origin !== 'https://auth.happyrabbit.top',
      { timeout: 30_000 },
    );
  }
}

test.describe('SSO 真实登录 @llm', () => {
  test('authorize 跳转 IDP → 登录 → 回跳设置会话 cookie', async ({ page }) => {
    test.setTimeout(60_000);

    const response = await page.request.post('/api/sso/authorize', {
      form: {
        code_verifier: 'e9f0b7d1c2a84f3e9d0c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
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

    await page.goto(location);
    await expect(page).toHaveURL(LOGIN_URL, { timeout: 30_000 });

    await loginAndConsent(page);

    // loginAndConsent 已等待离开 IDP（callback 完成后落在应用默认落地页 /solve，OQ-009）
    await page.waitForURL((url) => url.origin === 'http://localhost:3000' && url.pathname === '/solve', {
      timeout: 30_000,
    });

    const cookies = await page.context().cookies();
    const ssoCookies = cookies.filter((c) => c.name.startsWith('sso_'));
    expect(ssoCookies.some((c) => c.name === 'sso_access_token')).toBeTruthy();
    expect(ssoCookies.some((c) => c.name === 'sso_refresh_token')).toBeTruthy();
    expect(ssoCookies.some((c) => c.name === 'sso_id_token')).toBeTruthy();
  });

  test('授权后访问受保护 API /api/solve 返回业务响应而非 302', async ({ page }) => {
    test.setTimeout(60_000);

    const response = await page.request.post('/api/sso/authorize', {
      form: {
        code_verifier: 'e9f0b7d1c2a84f3e9d0c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        state: 'probe-state-0123456789abcdefghijklmnopqrstuvwxyz',
        nonce: 'probe-nonce-0123456789abcdefghijklmnopqrstuvwxyz',
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    await page.goto(response.headers().location);
    await expect(page).toHaveURL(LOGIN_URL, { timeout: 30_000 });

    await loginAndConsent(page);
    await page.waitForURL((url) => url.origin === 'http://localhost:3000' && url.pathname === '/solve', {
      timeout: 30_000,
    });

    const solveResp = await page.request.post('/api/solve', {
      data: { problem: 'https://www.luogu.com.cn/problem/P15800', platform: 'luogu' },
      headers: { 'content-type': 'application/json' },
    });
    expect(solveResp.status()).not.toBe(302);
    expect(solveResp.status()).toBeLessThan(500);
  });
});
