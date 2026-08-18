// tests/e2e-tests/specs/navigation.spec.ts
// 导航测试（testing-standards.md §四：@smoke @fast @no-llm 标签）
// 验证页面间跳转、直接访问、无数据态导航
// 运行前提：需以 npm run dev:test 启动 dev server（关闭中间件限流）；playwright.config webServer 已自动使用。
// 手动起服务若用 npm run dev，默认 20 次/分/IP 限流会使 /solve 等页面返回 429 JSON 导致本用例假失败。

import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home-page';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';

test.describe('导航测试 @smoke @fast @no-llm', () => {
  test('首页 "开始使用" 按钮跳转 /solve', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.clickStart();
    await expect(page).toHaveURL(/\/solve$/);
  });

  test('直接访问 /solve 可用', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await expect(solve.heading).toBeVisible();
    await expect(solve.tabsList).toBeVisible();
    await expect(solve.submitButton).toBeVisible();
  });

  test('直接访问 /result 显示无数据提示', async ({ page }) => {
    const result = new ResultPage(page);
    await result.goto();
    // 等待 hydration + useEffect 完成（sessionStorage 无数据）
    await expect(result.noDataText).toBeVisible({ timeout: 10_000 });
    await expect(result.backToSolveLink).toBeVisible();
  });

  test('/solve 页面 header 文案验证', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await expect(solve.heading).toHaveText('信奥赛 C++ 解题专家');
    await expect(page.getByText('输入题目，AI 自动生成解题讲解方案')).toBeVisible();
  });

  test('/result 无数据时 "返回输入页" 链接跳转 /solve', async ({ page }) => {
    const result = new ResultPage(page);
    await result.goto();
    await expect(result.backToSolveLink).toBeVisible({ timeout: 10_000 });
    await result.backToSolveLink.click();
    await expect(page).toHaveURL(/\/solve$/);
  });
});
