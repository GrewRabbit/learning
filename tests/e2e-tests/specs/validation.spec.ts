// tests/e2e-tests/specs/validation.spec.ts
// 输入校验测试（testing-standards.md §四：@fast 标签）
// 验证前端校验逻辑，不调用 LLM API

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';

test.describe('输入校验 @fast', () => {
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
});
