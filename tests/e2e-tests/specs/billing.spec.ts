// tests/e2e-tests/specs/billing.spec.ts
// 计费反馈 E2E（T8，架构 §6 / 实施进度「T8 待启动定义」）
//
// 覆盖：
// - @no-llm 缓存命中计费（AC-011 缓存命中 + AC-025 后端透传 + 前端展示）：提交已缓存旧题
//   （fs/db 缓存命中，不调 LLM）→ /result 横幅「本次已计费 + 剩余额度」
// - @no-llm 二次获取免费（AC-012）：同一旧题再次提交 → 横幅「本次免费（已获取过的解法）」
// - @llm 新题首次计费（AC-011 缓存未命中）：唯一新题 → 缓存 miss → 真实 LLM 生成 → 已计费
// - @no-llm AC-013 用户维度隔离：a0000000 已获取后，a0000003 首次获取同题 → 计费
// - @no-llm 余额不足（FR-019 / AC-016 前端链路）：a0000000 余额置 0 + 清 access → 缓存命中
//   首次计费 → 扣费不足 → /solve 错误提示「余额不足」且不返回解法；afterAll 恢复余额
//
// 幂等（对齐 T8 定义「前置重置余额 + 专用测试 hash 隔离」）：
// - beforeAll 经 node 端直连 DB 重置两个测试账户：清 billing_records/solve_records/
//   user_solution_access + 重置 quota_accounts（free_balance=1000 大值），保证每次 run
//   从已知余额与「未获取」态起步，AC-011/012/013 的 charged 断言稳定可复现；
//   同时避免本 spec 耗尽共享账户额度导致同轮后续 @llm 用例余额不足中断
// - 测试题固定用已缓存 B2002（primary 索引 + solutions 内容已在库），缓存命中不调 LLM
//
// 运行前提：npm run dev:test 启动 dev server；真实 DB（.env.local DATABASE_URL）；
// 需预登录 storageState（chromium-auth 项目依赖 auth.setup，IDP 可达时自动生成）。
// AC-013 场景依赖真实 IDP（a0000003 需已激活），IDP 不可用时该用例 skip。
//
// 串行依赖（重要）：测试 2（AC-012 免费）依赖测试 1 建立的 a0000000 的
// user_solution_access 副作用（服务端状态）。Playwright fullyParallel=false 下
// 同文件内默认串行，workers>1 也仅跨文件并行，故成立；但不要改为 parallel 模式，
// 也不要单独 --grep 测试 2（会因前置 access 缺失而假红）。
// 测试 4（AC-013）前置自行重置换入 a0000000 access，不依赖测试 1 副作用，可独立运行。
// 测试 5（余额不足）置于文件末尾，前置清 a0000000 access + 余额置 0，afterAll 恢复余额，
// 不影响本文件其余用例；同轮后续 @llm 解题用例（solve-text/image/platform）仅依赖余额充足，
// 不依赖 access 语义，故可安全运行。

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { SolvePage } from '../pages/solve-page';
import { ResultPage } from '../pages/result-page';
import { ssoLogin } from '../helpers/sso-login';
import { setBalance, clearUserAccess } from '../helpers/billing-db';

/** 洛谷平台 URL（单一可信源；B2002 已缓存 → 提交命中缓存不调 LLM） */
const LUOGU_URL = fs
  .readFileSync(
    path.join(process.cwd(), 'tests', 'testresources', 'luogo_testurl.md'),
    'utf-8',
  )
  .trim();

/** 计费横幅断言定位器（正常态 role="status"，额度不足 role="alert"）
 * 排除 #__next-route-announcer__ 与 Next.js dev 模式 Static indicator toast
 * （nextjs-toast，同为 role="status"，否则 strict mode 定位到 2 个元素导致断言失败）。
 */
function billingBanner(page: Page): ReturnType<Page['locator']> {
  return page.locator(
    '[role="status"]:not(#__next-route-announcer__):not(.nextjs-toast)',
  );
}

/** 重置测试账户（清计费相关子表 + 重置额度），供 beforeAll 幂等使用
 * 免费额度重置为 RESET_BALANCE（大值）而非 5：billing 各用例只断言「本次已计费/免费」与
 * 「剩余额度」文案，不校验具体数值；大值重置避免本 spec 把共享账户 a0000000 额度耗尽，
 * 导致同轮后续 @llm 解题用例（solve-text/image/platform）中途余额不足中断。
 */
const RESET_BALANCE = 1000;

async function resetTestAccount(sub: string): Promise<void> {
  let envLoaded = false;
  try {
    process.loadEnvFile('.env.local');
    envLoaded = true;
  } catch {
    envLoaded = true; // 无 .env.local 则依赖进程 env
  }
  void envLoaded;
  if (!process.env.DATABASE_URL) {
    throw new Error('billing.spec 前置：DATABASE_URL 未配置，无法重置测试账户余额');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query<{ id: string }>('SELECT id FROM users WHERE sso_sub = $1', [sub]);
    const userId = user.rows[0]?.id;
    if (userId) {
      await client.query('DELETE FROM billing_records WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM solve_records WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_solution_access WHERE user_id = $1', [userId]);
      await client.query(
        'UPDATE quota_accounts SET free_balance = $2, recharge_balance = 0 WHERE user_id = $1',
        [userId, RESET_BALANCE],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** 生成唯一测试 IP（TEST-NET-2 段，避免限流干扰） */
let ipSeq = 0;
function testIp(): string {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
}

/** 经 /solve UI 提交并等待跳转 /result（真实轮询写 sessionStorage，AC-025 前端链路） */
async function submitViaUi(page: Page): Promise<void> {
  const solve = new SolvePage(page);
  await solve.goto();
  await solve.selectPlatformTab();
  await solve.fillPlatformUrl(LUOGU_URL);
  await page.route('**/api/solve', async (route) => {
    await route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': testIp() } });
  });
  await solve.submitAndWaitForResult();
}

test.describe('计费反馈 E2E', () => {
  test.beforeAll(async () => {
    // 幂等前置：重置两个测试账户（a0000000 / a0000003），保证每 run 从已知状态起步
    await resetTestAccount('a0000000');
    await resetTestAccount('a0000003');
  });

  test.describe('@no-llm 缓存命中计费与免费（AC-011 缓存命中 / AC-012 / AC-025）', () => {
    test('提交已缓存旧题 → /result 横幅「本次已计费 + 剩余额度」', async ({ page }) => {
      test.setTimeout(90_000);
      await submitViaUi(page);
      const result = new ResultPage(page);
      await expect(result.heading).toBeVisible({ timeout: 10_000 });
      const banner = billingBanner(page);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText('本次已计费');
      await expect(banner).toContainText('剩余额度');
    });

    test('同一旧题再次提交 → 横幅「本次免费（已获取过的解法）」', async ({ page }) => {
      test.setTimeout(90_000);
      await submitViaUi(page);
      const result = new ResultPage(page);
      await expect(result.heading).toBeVisible({ timeout: 10_000 });
      const banner = billingBanner(page);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText('本次免费');
    });
  });

  test.describe('@llm 新题首次计费（AC-011 缓存未命中）', () => {
    test('唯一新题 → 缓存 miss → 真实生成 → 横幅「本次已计费」', async ({ page }) => {
      test.setTimeout(300_000);
      const uniqueContent = `【题目描述】
给定两个整数 a 和 b，输出它们的差。

【输入格式】
一行两个整数 a 和 b。

【输出格式】
一行一个整数，表示 a-b。

【样例输入】
5 2

【样例输出】
3

【测试标识】e2e-billing-new-${Date.now()}`;
      const solve = new SolvePage(page);
      await solve.goto();
      await solve.selectTextTab();
      await solve.fillTextContent(uniqueContent);
      await page.route('**/api/solve', async (route) => {
        await route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': testIp() } });
      });
      // 缓存 miss → LLM 生成（submitAndWaitForResult 内置 600s 等待）
      await solve.submitAndWaitForResult();
      const result = new ResultPage(page);
      await expect(result.heading).toBeVisible({ timeout: 10_000 });
      const banner = billingBanner(page);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText('本次已计费');
    });
  });

  test.describe('@no-llm 用户维度隔离（AC-013）', () => {
    test('a0000000 已获取后，a0000003 首次获取同一旧题 → 计费', async ({ page }) => {
      test.setTimeout(180_000);
      // 前置：独立重置 a0000000（清除测试 1/2 已建立的 access），使本提交计费并重新建立
      // access——不依赖测试 1 副作用，单跑该用例同样成立。
      await resetTestAccount('a0000000');
      await submitViaUi(page);
      const firstBanner = billingBanner(page);
      await expect(firstBanner).toContainText('本次已计费', { timeout: 15_000 });

      // a0000003 独立上下文登录（真实 IDP）
      const browser = page.context().browser();
      if (!browser) {
        test.skip(true, '无法创建独立上下文');
        return;
      }
      const context = await browser.newContext({ storageState: undefined });
      const bPage = await context.newPage();
      // 临时切换账号（env 注入，S3 修复：undefined 时 delete 恢复）
      const prevUser = process.env.SSO_TEST_USERNAME;
      const prevPass = process.env.SSO_TEST_PASSWORD;
      process.env.SSO_TEST_USERNAME = process.env.SSO_TEST_USERNAME_2 ?? 'a0000003';
      process.env.SSO_TEST_PASSWORD = process.env.SSO_TEST_PASSWORD_2 ?? 'Sin00cean';
      try {
        await ssoLogin(bPage);
      } catch {
        await context.close();
        test.skip(true, 'IDP 登录 a0000003 失败（账户可能未激活或 IDP 不可用）');
        return;
      } finally {
        if (prevUser === undefined) delete process.env.SSO_TEST_USERNAME;
        else process.env.SSO_TEST_USERNAME = prevUser;
        if (prevPass === undefined) delete process.env.SSO_TEST_PASSWORD;
        else process.env.SSO_TEST_PASSWORD = prevPass;
      }

      // a0000003 首次获取同一旧题 → 计费（缓存命中，B2002 已在库）
      await submitViaUi(bPage);
      const bBanner = billingBanner(bPage);
      await expect(bBanner).toContainText('本次已计费', { timeout: 15_000 });
      await context.close();
    });
  });

  test.describe('@no-llm 余额不足（FR-019 / AC-016 前端反馈链路）', () => {
    test('余额为 0 提交旧题 → 缓存命中但首次获取 → 扣费不足 → /solve 提示「余额不足」且不返回解法', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      // 前置构造：清 a0000000 对 B2002 的 access（变回「首次获取」）+ 余额置 0，
      // 使缓存命中 + settle 首次计费时触发 GESP6_BILLING_INSUFFICIENT_BALANCE（FR-019）。
      await clearUserAccess('a0000000');
      await setBalance('a0000000', 0);

      const solve = new SolvePage(page);
      await solve.goto();
      await solve.selectPlatformTab();
      await solve.fillPlatformUrl(LUOGU_URL);
      await page.route('**/api/solve', async (route) => {
        await route.continue({
          headers: { ...route.request().headers(), 'x-forwarded-for': testIp() },
        });
      });
      await solve.submit();

      // 余额不足：任务失败，前端停留在 /solve 展示错误（不跳 /result、不返回解法）
      await expect(solve.errorMessage).toBeVisible({ timeout: 30_000 });
      await expect(solve.errorMessage).toContainText('余额不足');
      await expect(page).toHaveURL(/\/solve$/);
    });

    test.afterAll(async () => {
      // 恢复共享账户余额（access 状态不恢复亦安全：后续 @llm 解题用例只断言结果内容，
      // 不依赖 a0000000 的「已获取/免费」语义），避免同轮后续用例因余额不足中断。
      await setBalance('a0000000', RESET_BALANCE);
    });
  });
});
