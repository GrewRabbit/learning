// tests/e2e-tests/specs/billing.spec.ts
// 计费反馈 E2E（T8，架构 §6 / 实施进度「T8 待启动定义」）
//
// 覆盖：
// - @no-llm 缓存命中计费（AC-011 缓存命中）：提交已缓存旧题（fs 缓存命中，不调 LLM）→
//   轮询 done 响应含 charged=true + balanceRemaining（AC-025 后端透传）→ /result 前端展示计费信息
// - @no-llm 二次获取免费（AC-012）：同一旧题再次提交 → charged=false（免费返回）
// - @llm 新题首次计费（AC-011 缓存未命中）：新题（唯一标识）→ 缓存 miss → 真实 LLM 生成 → charged=true
// - AC-013 用户维度隔离（双账户）：a0000000（storageState）已获取后，a0000003（独立登录）首次获取同题 → 计费
//
// 分层（实施进度 T8 定义）：缓存命中路径标 @no-llm（快、稳、进 test:e2e:no-llm）；
// 仅缓存未命中需真实生成标 @llm。
//
// 运行前提：npm run dev:test 启动 dev server；真实 DB（.env.local DATABASE_URL）；
// 需预登录 storageState（chromium-auth 项目依赖 auth.setup）。
// 双账户场景依赖真实 IDP（a0000003 需已激活），IDP 不可用时该用例 skip。

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';
import { ssoLogin } from '../helpers/sso-login';

/**
 * 洛谷平台 URL（单一可信源，与 solve-platform.spec 同源）
 * 内容：B2002 Hello,World!（最简题）。primary 索引 + content 已在 fs 缓存 →
 * 提交命中缓存不调 LLM，保证 @no-llm。
 */
const LUOGU_URL = fs
  .readFileSync(
    path.join(process.cwd(), 'tests', 'testresources', 'luogo_testurl.md'),
    'utf-8',
  )
  .trim();

/** /api/solve 提交响应（仅断言必要字段） */
type PostResponse = {
  success: boolean;
  data?: { jobId: string };
  error?: { code: string; message: string };
};

/** /api/solve 轮询响应（done 时顶层透出 charged/balanceRemaining，FR-022；cached 在 result 内） */
type PollResponse = {
  success: boolean;
  data?: {
    status: string;
    charged?: boolean;
    balanceRemaining?: number | null;
    result?: { html: string; validated: boolean; cached: boolean };
    error?: { code: string; message: string };
  };
  error?: { code: string; message: string };
};

/** 生成唯一测试 IP（TEST-NET-2 段，避免限流干扰） */
let ipSeq = 0;
function testIp(): string {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
}

/**
 * 通过 API 提交 + 轮询到 done，返回最终轮询响应。
 * 缓存命中（@no-llm 用例）时后台立即完成，无需 LLM。
 */
async function submitAndPoll(
  page: import('@playwright/test').Page,
  content: string,
  inputType: 'text' | 'platform',
  timeoutMs = 30_000,
): Promise<PollResponse> {
  const problem = inputType === 'text' ? { type: 'text' as const, content } : { type: 'platform' as const, content };
  const post = await page.request.post('/api/solve', {
    data: { problem },
    headers: { 'x-forwarded-for': testIp() },
  });
  expect(post.status()).toBe(200);
  const postBody = (await post.json()) as PostResponse;
  expect(postBody.success, `提交失败：${postBody.error?.code ?? ''} ${postBody.error?.message ?? ''}`).toBe(true);
  const jobId = postBody.data?.jobId;
  expect(jobId).toBeTruthy();

  // 轮询 GET 直到 done/error
  const deadline = Date.now() + timeoutMs;
  let last: PollResponse | undefined;
  while (Date.now() < deadline) {
    const res = await page.request.get(`/api/solve?jobId=${jobId}`, {
      headers: { 'x-forwarded-for': testIp() },
    });
    last = (await res.json()) as PollResponse;
    if (last.success && last.data?.status === 'done') {
      return last;
    }
    if (!last.success && (last.error?.code ?? last.data?.error?.code) !== 'GESP6_JOB_NOT_FOUND') {
      return last; // error 态（额度不足/DB 故障等）
    }
    await page.waitForTimeout(1_500);
  }
  throw new Error(`轮询超时（${timeoutMs}ms）：jobId=${jobId}`);
}

test.describe('计费反馈 E2E', () => {
  test.describe('@no-llm 缓存命中计费与免费（AC-011 缓存命中 / AC-012 / AC-025）', () => {
    test('提交已缓存旧题 → 轮询 done 含 charged=true + balanceRemaining，/result 展示计费信息', async ({ page }) => {
      test.setTimeout(60_000);
      const poll = await submitAndPoll(page, LUOGU_URL, 'platform');
      expect(poll.success).toBe(true);
      expect(poll.data?.status).toBe('done');
      expect(poll.data?.result?.cached).toBe(true); // fs 缓存命中，未调 LLM
      expect(poll.data?.charged).toBe(true);
      expect(typeof poll.data?.balanceRemaining).toBe('number');

      // 前端展示：访问 /result 验证 BillingBanner（历史解法已存 sessionStorage）
      const result = new ResultPage(page);
      await result.goto();
      await expect(result.heading).toBeVisible();
      // BillingBanner：已计费/免费 + 剩余额度展示（billing-banner.tsx 文案）
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    });

    test('同一旧题再次提交 → charged=false（免费返回，AC-012）', async ({ page }) => {
      test.setTimeout(60_000);
      const poll = await submitAndPoll(page, LUOGU_URL, 'platform');
      expect(poll.success).toBe(true);
      expect(poll.data?.status).toBe('done');
      expect(poll.data?.charged).toBe(false);
    });
  });

  test.describe('@llm 新题首次计费（AC-011 缓存未命中）', () => {
    test('唯一新题 → 缓存 miss → 真实生成 → done charged=true', async ({ page }) => {
      test.setTimeout(300_000);
      const uniqueContent = `【题目描述】
给定两个整数 a 和 b，输出它们的和。

【输入格式】
一行两个整数 a 和 b。

【输出格式】
一行一个整数，表示 a+b。

【样例输入】
1 2

【样例输出】
3

【测试标识】e2e-billing-new-${Date.now()}`;
      const poll = await submitAndPoll(page, uniqueContent, 'text', 280_000);
      expect(poll.success, `生成失败：${poll.error?.code ?? ''} ${poll.error?.message ?? ''}`).toBe(true);
      expect(poll.data?.status).toBe('done');
      expect(poll.data?.charged).toBe(true);
    });
  });

  test.describe('用户维度隔离（AC-013）', () => {
    test('a0000000 已获取后，a0000003 首次获取同一旧题 → 计费（用户隔离）', async ({ page }) => {
      test.setTimeout(120_000);
      // 前置：a0000000 已获取该旧题（storageState 预登录账户）。若未获取，先提交一次建立。
      const first = await submitAndPoll(page, LUOGU_URL, 'platform');
      if (first.success && first.data?.charged === false) {
        // a0000000 已获取过 → 前置满足
      } else {
        expect(first.success).toBe(true);
      }

      // a0000003 独立登录（真实 IDP）。复用 ssoLogin 但切换账号。
      const context = await page.context().browser()?.newContext({
        storageState: undefined,
      });
      if (!context) {
        test.skip(true, '无法创建独立上下文');
        return;
      }
      const bPage = await context.newPage();
      const prevUser = process.env.SSO_TEST_USERNAME;
      const prevPass = process.env.SSO_TEST_PASSWORD;
      process.env.SSO_TEST_USERNAME = 'a0000003';
      process.env.SSO_TEST_PASSWORD = 'Sin00cean';
      try {
        await ssoLogin(bPage);
      } catch {
        await context.close();
        test.skip(true, 'IDP 登录 a0000003 失败（账户可能未激活或 IDP 不可用）');
        return;
      } finally {
        if (prevUser !== undefined) process.env.SSO_TEST_USERNAME = prevUser;
        if (prevPass !== undefined) process.env.SSO_TEST_PASSWORD = prevPass;
      }

      // a0000003 首次获取同一旧题 → 计费
      const poll = await submitAndPoll(bPage, LUOGU_URL, 'platform');
      await context.close();
      expect(poll.success).toBe(true);
      expect(poll.data?.status).toBe('done');
      expect(poll.data?.charged).toBe(true);
    });
  });
});