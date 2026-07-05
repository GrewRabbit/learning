// tests/e2e-tests/specs/solve-image.spec.ts
// 图片上传完整流程测试（testing-standards.md §四：@critical 标签）
// 依赖真实 LLM API + 多模态图片识别；模型不支持图片时验证错误提示（GESP6_MODEL_NOT_SUPPORTED）
//
// 分支策略：用 waitForResponse 拦截 /api/solve 响应后按 body.success 分支断言
//   - 成功（模型支持图片）→ /result 渲染 iframe
//   - 失败（GESP6_MODEL_NOT_SUPPORTED）→ /solve 显示错误提示，未跳转 /result

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';

/** /api/solve POST 响应体最小类型（避免耦合 app 内部类型） */
type SolveApiResponse = {
  success: boolean;
  data?: { jobId?: string };
  error?: { code: string; message: string };
};

/** 测试用 PNG 图片路径（tests/testresources/testpic.png） */
const PNG_PATH = path.join(process.cwd(), 'tests', 'testresources', 'testpic.png');

/** 生成唯一测试 IP（TEST-NET-1 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('图片上传完整流程 @critical', () => {
  // 注入唯一 x-forwarded-for，避免限流干扰（middleware.ts 限流 5 次/分钟/IP）
  test.beforeEach(async ({ page }) => {
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

  /**
   * 提交已上传图片并按响应分支验证（假设图片预览已可见）
   * - POST 立即返回 { jobId }（成功）或 { error }（立即失败，如 GESP6_MODEL_NOT_SUPPORTED）
   * - 成功 → 等待跳转 /result（LLM 调用 3-5 分钟）→ 渲染 iframe（body 非空）
   * - GESP6_MODEL_NOT_SUPPORTED → /solve 显示错误提示，未跳转 /result
   */
  async function submitImageAndVerify(page: Page): Promise<void> {
    const solve = new SolvePage(page);

    // 拦截 /api/solve POST 响应：POST 立即返回 { jobId } 或 { error }
    // 用于判断是否立即失败（如 GESP6_MODEL_NOT_SUPPORTED，图片识别阶段就拒绝）
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/solve') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      solve.submit(),
    ]);
    const body = (await response.json()) as SolveApiResponse;

    if (!body.success) {
      // 立即失败（如 GESP6_MODEL_NOT_SUPPORTED）→ /solve 显示错误提示，未跳转 /result
      await expect(solve.errorMessage).toBeVisible({ timeout: 10_000 });
      expect(
        body.error?.code,
        `预期 GESP6_MODEL_NOT_SUPPORTED，实际：${body.error?.code ?? ''}（${body.error?.message ?? ''}）`,
      ).toBe('GESP6_MODEL_NOT_SUPPORTED');
      await expect(page).not.toHaveURL(/\/result$/);
      return;
    }

    // POST 成功（body.data.jobId）→ 等待任务完成跳转 /result
    // GLM-5.2 thinking 模式 + 图片识别，LLM 调用可能 3-5 分钟
    await expect(page).toHaveURL(/\/result$/, { timeout: 300_000 });
    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await expect(result.iframe).toBeVisible();
    await result.waitForIframeLoaded();
    const frame = result.getIframeFrame();
    expect(frame).not.toBeNull();
    if (frame) {
      await expect(frame.locator('body')).toBeVisible();
      const bodyText = await frame.locator('body').innerText();
      expect(bodyText.length, 'iframe body 应非空').toBeGreaterThan(0);
    }
  }

  test('图片上传完整流程 @critical', async ({ page }) => {
    test.setTimeout(360_000); // 图片识别 + LLM 生成（GLM-5.2 thinking 3-5 分钟）
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    await solve.uploadImage(PNG_PATH);
    // 预览图可见（FileReader → base64 → onChange → 预览渲染完成）
    await expect(solve.imagePreview).toBeVisible();
    await submitImageAndVerify(page);
  });

  test('图片上传后清除重新上传 → 提交 @critical', async ({ page }) => {
    test.setTimeout(360_000);
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    await solve.uploadImage(PNG_PATH);
    await expect(solve.imagePreview).toBeVisible();
    // 清除后预览与清除按钮均卸载
    await solve.clearImage();
    await expect(solve.imagePreview).toHaveCount(0);
    // 重新上传并提交
    await solve.uploadImage(PNG_PATH);
    await expect(solve.imagePreview).toBeVisible();
    await submitImageAndVerify(page);
  });
});
