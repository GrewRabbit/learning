// tests/e2e-tests/specs/login-wall.spec.ts
// 全站登录墙（v1.3，arch-sso-dataflow.md §4.1.3 / spec-sso-auth-v1.3.md AC-035~038 / FR-016/FR-028/FR-029）
// 验证 middleware 登录墙行为：公开白名单放行、受保护页面 302 → /login?returnTo、
// 受保护 API 401 JSON AUTH_SESSION_INVALID、/api/sso 白名单链路不被登录墙阻挡。
// 本 spec 全程「无认证」：不登录、不依赖 IDP（仅断言 authorize 302 目标为 IDP，不跟随，maxRedirects: 0）；
// 由 playwright.config.ts chromium 项目（无 storageState）运行（拆分流式，用户裁决）。
// 运行前提：需以 npm run dev:test 启动 dev server（关闭中间件限流）；playwright.config webServer 已自动使用。
import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
// 仅取常量（PKCE 示例值，镜像 sso-login 的 startAuthorize 表单；不 import 登录流程函数）
import { SSO_VERIFIER, SSO_CHALLENGE } from '../helpers/sso-login';

test.describe('登录墙 @smoke @no-llm', () => {
  test('首页 / 公开可访问（无需登录）', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.heading).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('/login 登录入口页可达（200，入口元素可见）', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('登录后即可使用 AI 解题服务')).toBeVisible();
  });

  test('未认证访问 /solve → 302 至 /login?returnTo=%2Fsolve', async ({ page }) => {
    await page.goto('/solve');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fsolve$/);
    // 落在登录页而非被放行或拦截：登录入口可见
    await expect(page.getByText('登录后即可使用 AI 解题服务')).toBeVisible();
  });

  test('未认证访问 /result → 302 至 /login?returnTo=%2Fresult', async ({ page }) => {
    await page.goto('/result');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fresult$/);
  });

  test('未认证 GET /api/solve → 401 JSON AUTH_SESSION_INVALID（非 HTML 登录页，FR-016）', async ({ request }) => {
    const response = await request.get('/api/solve');
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_SESSION_INVALID');
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('/api/health 未认证可访问（200，运维探活豁免）', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
  });

  test('/api/sso/authorize 不受登录墙阻挡：POST → 302 到 IDP（AC-035 /api/sso 白名单）', async ({ request }) => {
    const response = await request.post('/api/sso/authorize', {
      form: {
        code_verifier: SSO_VERIFIER,
        code_challenge: SSO_CHALLENGE,
        state: 'probe-state-0123456789abcdefghijklmnopqrstuvwxyz',
        nonce: 'probe-nonce-0123456789abcdefghijklmnopqrstuvwxyz',
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = response.headers()['location'] ?? '';
    expect(location).toContain('auth.happyrabbit.top');
    expect(location).toContain('code_challenge_method=S256');
  });
});
