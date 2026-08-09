// tests/e2e-tests/specs/smoke.spec.ts
// Smoke 测试（testing-standards.md §四：@smoke @fast @no-llm 标签，关键路径快速验证）
// 不依赖 LLM API，仅验证 UI 流程与页面跳转

import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
import { SolvePage } from '../pages/solve-page';

test.describe('Smoke 测试 @smoke @fast @no-llm', () => {
  test('首页加载 + 跳转 /solve', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.heading).toBeVisible();
    await home.clickStart();
    await expect(page).toHaveURL(/\/solve$/);
  });

  test('/solve 页面 UI 元素可见', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await expect(solve.heading).toBeVisible();
    await expect(solve.tabsList).toBeVisible();
    await expect(solve.textTab).toBeVisible();
    await expect(solve.imageTab).toBeVisible();
    await expect(solve.platformTab).toBeVisible();
    await expect(solve.submitButton).toBeVisible();
  });

  test('Tabs 切换功能 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();

    // 默认 text tab 激活
    await expect(solve.textContent).toBeVisible();

    // 切换到 image tab（image-input 为隐藏 input，验证已挂载即可）
    await solve.selectImageTab();
    await expect(solve.imageInput).toBeAttached();

    // 切换到 platform tab
    await solve.selectPlatformTab();
    await expect(solve.platformUrl).toBeVisible();

    // 切换回 text tab
    await solve.selectTextTab();
    await expect(solve.textContent).toBeVisible();
  });

  test('/result 无数据时显示提示 @fast', async ({ page }) => {
    await page.goto('/result');
    // sessionStorage 无数据，应显示提示（等待客户端 hydration + useEffect）
    await expect(page.getByText('未找到解题结果')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: '返回输入页' })).toBeVisible();
  });

  test('浏览器后退/前进导航 @fast', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickStart();
    await expect(page).toHaveURL(/\/solve$/);

    // 后退回首页
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(home.heading).toBeVisible();

    // 前进回 /solve
    await page.goForward();
    await expect(page).toHaveURL(/\/solve$/);
  });

  test('/api/health 响应验证 @fast', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });
});
