// tests/e2e-tests/auth.setup.ts
// SSO 预登录 setup：真实 IDP 登录一次，保存 storageState 供 @fast @no-llm 契约测试复用
// 依赖：dev server 已配 SSO 环境变量 + 测试账户 a0000000/Sin00cean（勿删，需先邮件激活）
import { test as setup } from '@playwright/test';
import { ssoLogin } from './helpers/sso-login';

const AUTH_FILE = 'tests/e2e-tests/.auth/sso-user.json';

setup('SSO 真实登录并保存会话', async ({ page }) => {
  setup.setTimeout(60_000);
  await ssoLogin(page);
  await page.context().storageState({ path: AUTH_FILE });
});
