// tests/e2e-tests/specs/platform-input.spec.ts
// 平台 URL 输入测试（testing-standards.md §四：@fast 标签）
// 不依赖 LLM，仅测试平台 URL 输入 UI 与前端/接口校验

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';

/** 生成唯一测试 IP（TEST-NET-3 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('平台 URL 输入测试 @fast', () => {
  test.beforeEach(async ({ page }) => {
    // 注入唯一 x-forwarded-for，避免限流干扰（middleware.ts 限流 5 次/分钟/IP）
    ipSeq += 1;
    const ip = `203.0.113.${ipSeq}`;
    await page.route('**/api/solve', async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-forwarded-for': ip,
        },
      });
    });
  });

  test('切换到 platform tab → URL 输入框可见', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await expect(solve.platformUrlInput).toBeVisible();
  });

  test('输入洛谷合法 URL → 前端无错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://www.luogu.com.cn/problem/P1001');
    // 仅验证前端无错误（不点击提交，避免触发真实抓取与 LLM）
    await expect(solve.errorMessage).toHaveCount(0);
  });

  test('输入有道小图灵标准 URL → 前端无错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://oj.youdao.com/problem/7906');
    await expect(solve.errorMessage).toHaveCount(0);
  });

  test('输入有道小图灵练习 URL → 前端无错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://oj.youdao.com/exercise/7/48/4924/1?title=测试');
    await expect(solve.errorMessage).toHaveCount(0);
  });

  test('输入 http:// URL → 提交后显示错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('http://www.luogu.com.cn/problem/P1001');
    await solve.submit();
    // 前端不校验 http/https，由 API 返回 GESP6_INPUT_INVALID，前端显示 message
    await expect(solve.errorMessage).toBeVisible({ timeout: 15_000 });
    await expect(solve.errorMessage).toContainText('https');
  });

  test('输入非支持平台 URL → 提交后显示错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://example.com/problem/1');
    await solve.submit();
    await expect(solve.errorMessage).toBeVisible({ timeout: 15_000 });
    await expect(solve.errorMessage).toContainText('不合法');
  });
});
