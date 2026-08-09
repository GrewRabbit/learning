// tests/e2e-tests/specs/solve-text.spec.ts
// 文本输入完整流程测试（testing-standards.md §四：@critical @llm 标签）
// 依赖真实 LLM API + g++ 环境，验证 /solve → /result → iframe 渲染完整链路

import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';
import { extractSampleFingerprint } from '@/app/lib/ai/services/problem-fetchers/types';

/**
 * 简单测试题目：从 tests/testresources/luogo_testtext.md 读取（单一可信源）
 * 内容：洛谷 B2002 Hello,World!（最简题，控制 token 消耗）
 */
const SAMPLE_PROBLEM = fs.readFileSync(
  path.join(process.cwd(), 'tests', 'testresources', 'luogo_testtext.md'),
  'utf-8',
);

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

/**
 * B2002 Hello,World! 题目文本（用户手输格式，spec §7.3 E2E 测试输入）
 *
 * 直接复用 tests/testresources/luogo_testtext.md（与 SAMPLE_PROBLEM 同源），
 * extractSampleFingerprint 返回 all=3c527f43...，对应 sample 索引已存在
 * （由此前 platform 方式提交生成），text 方式提交可命中缓存。
 *
 * 依赖：
 * - data/gesp6/sample/3c/3c527f43*.json（sample 索引，platform 方式提交时写入）
 * - 若 sample 索引被清理，需先用 URL 方式提交一次 B2002 生成 sample 索引
 */

/**
 * 检查 B2002 sample 索引是否存在（spec §7.3 前置条件）
 *
 * 通过计算 B2002 题目文本的 sampleFp（all 候选），检查对应的 sample 索引文件是否存在。
 * sample 索引在 platform 方式提交 + validated=true 时由 getOrCompute 内部写入。
 * 若 sample 索引不存在（sample 索引功能上线前的缓存或缓存被清理），E2E 测试需 skip。
 */
function hasB2002SampleIndex(): boolean {
  try {
    const text = fs.readFileSync(
      path.join(process.cwd(), 'tests', 'testresources', 'luogo_testtext.md'),
      'utf-8',
    );
    const { all: sampleFp } = extractSampleFingerprint(text);
    if (!sampleFp) return false;
    const sampleIndexPath = path.join(
      process.cwd(),
      'data/gesp6/sample',
      sampleFp.slice(0, 2),
      `${sampleFp}.json`,
    );
    return fs.existsSync(sampleIndexPath);
  } catch {
    return false;
  }
}

/** 生成唯一测试 IP（TEST-NET-3 段，避免与其他 spec 文件冲突） */
let ipSeq = 0;

test.describe('文本输入完整流程 @critical @llm', () => {
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
    test.setTimeout(360_000); // GLM-5.2 thinking 模式 LLM 调用可能 3-5 分钟

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
    test.setTimeout(360_000);

    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(SAMPLE_PROBLEM);
    await solve.submitAndWaitForResult();

    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await result.regenerateButton.click();
    // 跳转后 URL 为 /solve?regenerate=true，正则需兼容 query string
    await expect(page).toHaveURL(/\/solve(\?|$)/);
  });

  test('缓存命中：首次新生成 → 返回再次提交 → 来自缓存 @critical', async ({ page }) => {
    test.setTimeout(720_000); // 首次提交调用 LLM 可能较慢（GLM-5.2 thinking 可能生成数万字思考过程，5-10 分钟）

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

    // 点击"返回"按钮跳转 /solve（不自动提交，与"重新生成"按钮区分）
    // "重新生成"按钮跳转 /solve?regenerate=true 会自动提交且跳过缓存读，无法验证缓存命中
    await result.returnButton.click();
    await expect(page).toHaveURL(/\/solve$/);

    // 再次提交相同内容 → 应命中缓存 → 秒级跳转 /result
    // 注意：FsHtmlCache 写入为 fire-and-forget 异步，此处导航 + 填表耗时足以让落盘完成
    const solve2 = new SolvePage(page);
    await expect(solve2.heading).toBeVisible(); // 等待 /solve hydration 完成
    await solve2.fillTextContent(uniqueProblem);
    await solve2.submit();

    // 缓存命中应秒级跳转 /result，超时 60s 快速失败（避免 miss + LLM 超时卡满 180s）
    // 注意：轮询模式下 POST 只返回 { jobId }，cached 字段在 GET 响应的 result 中，
    //       无法通过拦截 POST 响应验证 cached，改为等待跳转后验证 statusText
    await expect(page).toHaveURL(/\/result$/, { timeout: 60_000 });

    const result2 = new ResultPage(page);
    await expect(result2.heading).toBeVisible();
    await expect(result2.statusText).toBeVisible({ timeout: 10_000 });
    await expect(result2.statusText).toContainText('来自缓存');
  });

  test('iframe 内容深度验证：关键词 / 代码块 / Mermaid SVG @critical', async ({ page }) => {
    test.setTimeout(360_000); // SAMPLE_PROBLEM 可能未缓存（孤立运行），LLM 调用预留 6 分钟

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

  test('B2002 文本输入命中 platform 方式已生成缓存 @critical', async ({ page }) => {
    // 前置条件：B2002 sample 索引必须存在（spec §7.3）
    // sample 索引在 platform 方式提交 + validated=true 时由 getOrCompute 写入。
    // 若 sample 索引被清理，需先用 URL 方式提交一次 B2002 生成。
    const hasIndex = hasB2002SampleIndex();
    if (!hasIndex) {
      console.warn(
        '[E2E Skip] B2002 sample 索引不存在。' +
          '需先用 URL 方式提交一次 B2002 生成 sample 索引（spec §7.3：若缓存被清理需先用 URL 方式提交一次生成缓存）。',
      );
    }
    test.skip(
      !hasIndex,
      'B2002 sample 索引不存在（spec §7.3：需先用 URL 方式提交一次生成缓存）',
    );

    test.setTimeout(120_000); // 缓存命中应秒级返回，预留 2 分钟超时

    const solve = new SolvePage(page);
    await solve.goto();
    await solve.fillTextContent(SAMPLE_PROBLEM); // B2002 Hello,World! 题目文本

    // 轮询模式下 POST 只返回 { jobId }，cached 字段在 GET 响应的 result 中，
    // 无法通过拦截 POST 响应验证 cached，改为等待跳转后验证 statusText（与"缓存命中"测试一致）
    await solve.submit();

    // 缓存命中应秒级跳转 /result，超时 60s 快速失败
    await expect(page).toHaveURL(/\/result$/, { timeout: 60_000 });

    const result = new ResultPage(page);
    await expect(result.heading).toBeVisible();
    await expect(result.statusText).toBeVisible({ timeout: 10_000 });
    // spec §7.3：statusText 含"来自缓存"
    await expect(result.statusText).toContainText('来自缓存');
  });
});
