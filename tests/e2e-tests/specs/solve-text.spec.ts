// tests/e2e-tests/specs/solve-text.spec.ts
// 文本输入完整流程测试（testing-standards.md §四：@critical 标签）
// 依赖真实 LLM API + g++ 环境，验证 /solve → /result → iframe 渲染完整链路

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';

/** 简单测试题目：A+B Problem（GESP 一级典型题） */
const SAMPLE_PROBLEM = `【题目描述】
给定两个整数 a 和 b，输出它们的和。

【输入格式】
一行，包含两个整数 a 和 b，以空格分隔。

【输出格式】
一行，包含一个整数，表示 a + b 的值。

【样例输入】
1 2

【样例输出】
3

【数据范围】
1 ≤ a, b ≤ 1000`;

test.describe('文本输入完整流程 @critical', () => {
  test('提交文本题目 → /result 渲染 iframe', async ({ page }) => {
    test.setTimeout(180_000); // LLM 调用可能较慢，3 分钟超时

    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(SAMPLE_PROBLEM);
    await solve.submitAndWaitForResult();

    // 验证跳转到 /result
    await expect(page).toHaveURL(/\/result$/);

    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();

    // 验证状态文本（来自缓存 或 新生成）
    await expect(result.statusText).toBeVisible({ timeout: 10_000 });

    // 验证 iframe 渲染
    await expect(result.iframe).toBeVisible();
    await result.waitForIframeLoaded();

    // 验证 iframe 内有内容（body 存在且非空）
    const frame = result.getIframeFrame();
    expect(frame).not.toBeNull();
    if (frame) {
      await expect(frame.locator('body')).toBeVisible();
      const bodyText = await frame.locator('body').innerText();
      // LLM 生成的 HTML 应包含解题内容（非空）
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });

  test('重新生成按钮跳转 /solve', async ({ page }) => {
    test.setTimeout(180_000);

    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(SAMPLE_PROBLEM);
    await solve.submitAndWaitForResult();

    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await result.regenerateButton.click();
    await expect(page).toHaveURL(/\/solve$/);
  });
});
