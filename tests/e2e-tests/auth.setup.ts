// tests/e2e-tests/auth.setup.ts
// SSO 预登录 setup：真实 IDP 登录一次，保存 storageState 供 @fast @no-llm 契约测试复用
// 依赖：dev server 已配 SSO 环境变量 + 测试账户 a0000000/Sin00cean（勿删，需先邮件激活）
import { test as setup } from '@playwright/test';
import { ssoLogin } from './helpers/sso-login';
import { setBalance } from './helpers/billing-db';

const AUTH_FILE = 'tests/e2e-tests/.auth/sso-user.json';

// 计费预置（团队约定：涉及计费的测试提前调整余额，防止中途因余额不足中断）：
// storageState 共享账户 a0000000 供整轮 chromium-auth 用例（@llm 解题会真实扣费）使用，
// 每轮运行前将免费额度置为充足值。fail-soft：DB 不可用时仅告警不阻断登录
// （无计费的纯 UI 用例仍可运行）。
const TEST_SHARED_BALANCE = 1000;

setup('SSO 真实登录并保存会话', async ({ page }) => {
  setup.setTimeout(60_000);
  await ssoLogin(page);
  await page.context().storageState({ path: AUTH_FILE });
  await setBalance('a0000000', TEST_SHARED_BALANCE);
});
