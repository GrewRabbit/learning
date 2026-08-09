// tests/e2e-tests/specs/validation.spec.ts
// 输入校验测试（testing-standards.md §四：@fast @no-llm 标签）
// 验证前端校验逻辑，不调用 LLM API

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';

/** 生成唯一测试 IP（TEST-NET-1 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('输入校验 @fast @no-llm', () => {
  test.beforeEach(async ({ page }) => {
    // 注入唯一 x-forwarded-for，避免限流干扰（middleware.ts 限流 5 次/分钟/IP）
    ipSeq += 1;
    const ip = `192.0.2.${ipSeq}`;
    await page.route('**/api/solve', async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-forwarded-for': ip,
        },
      });
    });
  });

  test('空文本提交 → 显示错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.submit();
    await expect(solve.errorMessage).toBeVisible();
    await expect(solve.errorMessage).toContainText('请输入题目内容');
  });

  test('空 URL 提交 → 显示错误', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.submit();
    await expect(solve.errorMessage).toBeVisible();
    await expect(solve.errorMessage).toContainText('请输入题目 URL');
  });

  test('字符计数显示 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent('测试内容');
    await expect(solve.charCount).toContainText('4 / 10000 字符');
  });

  test('文本超长提交 → 显示错误 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    // 10001 字符（超过 10000 上限）
    await solve.fillTextContent('a'.repeat(10_001));
    await solve.submit();
    await expect(solve.errorMessage).toBeVisible();
    await expect(solve.errorMessage).toContainText('文本内容不能超过 10000 字符');
  });

  test('平台 http:// URL 提交 → 显示错误 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('http://www.luogu.com.cn/problem/P1001');
    await solve.submit();
    // 前端不校验 http/https，由 API 返回 GESP6_INPUT_INVALID
    await expect(solve.errorMessage).toBeVisible({ timeout: 15_000 });
    await expect(solve.errorMessage).toContainText('https');
  });

  test('平台非支持域名提交 → 显示错误 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://example.com/problem/1');
    await solve.submit();
    await expect(solve.errorMessage).toBeVisible({ timeout: 15_000 });
    await expect(solve.errorMessage).toContainText('不合法');
  });

  test('合法洛谷 URL 格式 → 前端不报错 @fast', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl('https://www.luogu.com.cn/problem/P999999');
    // 仅验证前端无错误（不点击提交，避免触发真实抓取与 LLM）
    await expect(solve.errorMessage).toHaveCount(0);
  });
});
