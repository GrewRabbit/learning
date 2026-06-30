// tests/e2e-tests/specs/solve-platform.spec.ts
// 平台 URL 完整流程测试（testing-standards.md §四：@critical 标签）
// 依赖真实 LLM API + 平台抓取（洛谷 API / 有道小图灵 DOM），验证 platform → /result → iframe 完整链路
// 平台抓取可能因网络失败，测试失败时附说明（不无限重试）

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';

/** /api/solve 响应体最小类型（避免耦合 app 内部类型，仅断言必要字段） */
type SolveApiResponse = {
  success: boolean;
  data?: { html: string; validated: boolean; cached: boolean; warning?: string };
  error?: { code: string; message: string };
};

/**
 * 有道小图灵练习路径 URL（从 tests/testresources/testurl.md 读取，单一可信源）
 * 文件内容为 URL-encoded query string，正则 urlPattern 兼容（idExtractor 仅取 pathname）
 */
const YOUDAO_EXERCISE_URL = fs
  .readFileSync(
    path.join(process.cwd(), 'tests', 'testresources', 'testurl.md'),
    'utf-8',
  )
  .trim();

/** 有道小图灵标准路径 URL（固定题号 7906） */
const YOUDAO_STANDARD_URL = 'https://oj.youdao.com/problem/7906';

/** 洛谷平台 URL（B3614 为简单题，确保抓取成功） */
const LUOGU_URL = 'https://www.luogu.com.cn/problem/B3614';

/** 生成唯一测试 IP（TEST-NET-2 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('平台 URL 完整流程 @critical', () => {
  // 注入唯一 x-forwarded-for，避免限流干扰（middleware.ts 限流 5 次/分钟/IP）
  test.beforeEach(async ({ page }) => {
    ipSeq += 1;
    const ip = `198.51.100.${ipSeq}`;
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
   * 通用：提交平台 URL 并验证 /result 渲染
   *
   * 用 waitForResponse 拦截 /api/solve 响应（submitAndWaitForResult 内置 180s 超时
   * 不足以覆盖平台抓取 + LLM 生成；此处 240s），失败时附 error code/message 便于诊断。
   */
  async function submitPlatformAndVerify(page: Page, url: string): Promise<void> {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectPlatformTab();
    await solve.fillPlatformUrl(url);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/solve') && r.request().method() === 'POST',
        { timeout: 240_000 },
      ),
      solve.submit(),
    ]);
    const body = (await response.json()) as SolveApiResponse;
    expect(
      body.success,
      `平台抓取/LLM 失败（URL=${url}）：${body.error?.code ?? ''} ${body.error?.message ?? ''}`,
    ).toBeTruthy();

    await expect(page).toHaveURL(/\/result$/, { timeout: 30_000 });
    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await expect(result.iframe).toBeVisible();
    await result.waitForIframeLoaded();

    const frame = result.getIframeFrame();
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    // body 非空
    await expect(frame.locator('body')).toBeVisible();
    const bodyText = await frame.locator('body').innerText();
    expect(bodyText.length, 'iframe body 应非空').toBeGreaterThan(0);

    // Mermaid SVG 或代码块（任一存在即可）
    // - 代码块为静态 HTML，必然存在（硬保证）
    // - SVG 为 CDN 异步渲染，网络失败时回退到代码块断言（任务约束：放宽断言）
    let svgVisible = false;
    try {
      await expect(frame.locator('svg').first()).toBeVisible({ timeout: 15_000 });
      svgVisible = true;
    } catch {
      svgVisible = false;
    }
    const codeBlockCount =
      (await frame.locator('pre').count()) + (await frame.locator('code').count());
    expect(
      svgVisible || codeBlockCount > 0,
      'iframe 内应存在 Mermaid SVG 或代码块',
    ).toBeTruthy();
  }

  test('有道小图灵练习路径完整流程 @critical', async ({ page }) => {
    test.setTimeout(240_000); // 平台抓取 + LLM 生成（4 分钟超时）
    await submitPlatformAndVerify(page, YOUDAO_EXERCISE_URL);
  });

  test('有道小图灵标准路径完整流程 @critical', async ({ page }) => {
    test.setTimeout(240_000);
    await submitPlatformAndVerify(page, YOUDAO_STANDARD_URL);
  });

  test('洛谷平台完整流程 @critical', async ({ page }) => {
    test.setTimeout(240_000);
    await submitPlatformAndVerify(page, LUOGU_URL);
  });
});
