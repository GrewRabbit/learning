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

/**
 * 缓存命中测试专用题目（A×B Problem，与 SAMPLE_PROBLEM 内容不同 → content hash 不同）
 *
 * 为何不直接复用 SAMPLE_PROBLEM：本 spec 串行执行，test 1 已将 SAMPLE_PROBLEM 写入
 * 缓存（GESP6_CACHE_DRIVER=fs 时为磁盘持久化、无 TTL），导致缓存命中测试的"首次提交"
 * 也命中缓存，无法验证"新生成 → 来自缓存"的完整迁移。使用独立题目保证首次提交为 miss。
 *
 * 末尾追加唯一运行标识（Date.now()）：FsHtmlCache 无 TTL，dev server 重启后缓存仍在，
 * 唯一标识保证每次运行的首次提交均为 miss（避免重跑命中旧缓存）。
 */
const CACHE_TEST_PROBLEM_PREFIX = `【题目描述】
给定两个整数 a 和 b，输出它们的乘积。

【输入格式】
一行，包含两个整数 a 和 b，以空格分隔。

【输出格式】
一行，包含一个整数，表示 a × b 的值。

【样例输入】
3 4

【样例输出】
12

【数据范围】
1 ≤ a, b ≤ 1000

【测试标识】
run-`;

/** 生成唯一测试 IP（TEST-NET-3 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('文本输入完整流程 @critical', () => {
  // 注入唯一 x-forwarded-for，避免限流干扰（middleware.ts 限流 20 次/分钟/IP，P0 调整后阈值）
  test.beforeEach(async ({ page }) => {
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

  test('缓存命中：首次新生成 → 重新生成 → 再次提交来自缓存 @critical', async ({ page }) => {
    test.setTimeout(240_000); // 首次提交调用 LLM 可能较慢（4 分钟超时）

    // 唯一标识：避免 FsHtmlCache 无 TTL 导致重跑命中旧缓存
    const uniqueProblem = `${CACHE_TEST_PROBLEM_PREFIX}${Date.now()}`;

    // 第一次提交：应未命中缓存 → statusText 显示"新生成"
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(uniqueProblem);
    await solve.submitAndWaitForResult();

    await expect(page).toHaveURL(/\/result$/);
    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await expect(result.statusText).toBeVisible({ timeout: 10_000 });
    await expect(result.statusText).toContainText('新生成');

    // 点击"重新生成"返回 /solve
    await result.regenerateButton.click();
    await expect(page).toHaveURL(/\/solve$/);

    // 再次提交相同内容 → 应命中缓存 → statusText 显示"来自缓存"
    // 注意：FsHtmlCache 写入为 fire-and-forget 异步，此处导航 + 填表耗时足以让落盘完成
    const solve2 = new SolvePage(page);
    await expect(solve2.heading).toBeVisible(); // 等待 /solve hydration 完成
    await solve2.fillTextContent(uniqueProblem);

    // 用 waitForResponse 拦截 /api/solve 响应，超时 60s（缓存命中应秒级返回）
    // 避免偶发 miss + LLM 超时时卡满 submitAndWaitForResult 的 180s 硬编码超时
    // 批量跑 @critical 时累积 LLM 调用多，偶发触发 LLM 服务方限流，导致 miss 后 LLM 超时
    const [response2] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/solve') && r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      solve2.submit(),
    ]);
    const body2 = (await response2.json()) as {
      success: boolean;
      data?: { cached?: boolean };
      error?: { code: string; message: string };
    };

    // 缓存命中应秒级返回且 success=true + cached=true
    expect(body2.success, `第二次提交应成功，实际错误：${body2.error?.message ?? ''}`).toBe(true);
    expect(body2.data?.cached, '第二次提交应命中缓存（cached=true）').toBe(true);

    await expect(page).toHaveURL(/\/result$/);
    const result2 = new ResultPage(page);
    await expect(result2.heading).toBeVisible();
    await expect(result2.statusText).toBeVisible({ timeout: 10_000 });
    await expect(result2.statusText).toContainText('来自缓存');
  });

  test('iframe 内容深度验证：关键词 / 代码块 / Mermaid SVG @critical', async ({ page }) => {
    test.setTimeout(240_000); // SAMPLE_PROBLEM 可能未缓存（孤立运行），LLM 调用预留 4 分钟

    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(SAMPLE_PROBLEM);
    await solve.submitAndWaitForResult();

    await expect(page).toHaveURL(/\/result$/);
    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await expect(result.iframe).toBeVisible();
    await result.waitForIframeLoaded();

    const frame = result.getIframeFrame();
    expect(frame).not.toBeNull();
    if (!frame) {
      return;
    }

    // 1. body 文本包含关键解题内容（至少一个关键词）
    await expect(frame.locator('body')).toBeVisible();
    const bodyText = await frame.locator('body').innerText();
    const keywords = ['代码', '样例', 'include', '输入', '输出'];
    const hasKeyword = keywords.some((k) => bodyText.includes(k));
    expect(
      hasKeyword,
      `iframe body 应包含关键词之一：${keywords.join(' / ')}；实际内容前 200 字：${bodyText.slice(0, 200)}`,
    ).toBeTruthy();

    // 2. 存在代码块（<pre> 或 <code>）—— 静态 HTML，必然存在
    const preCount = await frame.locator('pre').count();
    const codeCount = await frame.locator('code').count();
    expect(
      preCount + codeCount,
      'iframe 内应存在 <pre> 或 <code> 代码块',
    ).toBeGreaterThan(0);

    // 3. Mermaid 渲染的 SVG —— mermaid.min.js 从 jsDelivr CDN 异步加载渲染
    //    网络/CDN 失败时不阻塞测试（任务约束 §验证标准：断言过严可放宽，不要求必须 SVG）
    try {
      await expect(frame.locator('svg').first()).toBeVisible({ timeout: 15_000 });
    } catch {
      // CDN 不可达：Mermaid 未渲染为 SVG，跳过此项断言（不阻塞 @critical 测试）
    }
  });
});
