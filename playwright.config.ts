// playwright.config.ts
// Playwright 配置（testing-standards.md §四 E2E 测试规范）
// baseURL: http://localhost:3000（复用已运行的 dev server）
//
// 标签策略（与 package.json scripts 配合）：
// - @smoke    ：关键路径烟测（秒级），不依赖 LLM，验证页面加载/导航/UI 元素可见
// - @fast     ：快速 UI/API 校验（秒级），不依赖 LLM，验证输入校验/契约/容错
// - @critical ：完整流程测试（分钟级），依赖真实 LLM API + g++，验证端到端生成
// - @no-llm   ：无需调用模型（@smoke + @fast 的超集，便于按模型依赖过滤）
// - @llm      ：需要调用模型（与 @critical 同集合，语义更直观）
//
// 命令体系（package.json）：
// - test:e2e:smoke    → 仅 @smoke（最快，秒级，PR 前置检查）
// - test:e2e:no-llm   → 仅 @no-llm（@smoke + @fast，约 1 分钟，无需模型，本地迭代）
// - test:e2e:llm      → 仅 @llm（@critical，约 2-3 分钟，依赖 LLM，发布前验证）
// - test:e2e          → 全部（含 @llm，约 3-4 分钟）
// - test:quick        → 单元+集成 + E2E @no-llm（约 1.5 分钟，本地快速反馈）
// - test:full         → 单元+集成 + 全部 E2E（约 4-5 分钟，发布前完整验证）

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-tests/specs',
  outputDir: './tests/e2e-tests/.output',
  fullyParallel: false, // E2E 串行执行，避免 LLM API 限流
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 单 worker，避免并发触发速率限制
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // E2E 测试可能较慢（LLM 调用）
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testDir: './tests/e2e-tests',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // 无认证项目（不依赖 IDP）：
      // - login-wall.spec.ts：登录墙行为断言（首页公开、受保护页 302→/login?returnTo、
      //   /api/solve 401 JSON、/api/sso 白名单豁免），秒级无认证
      // - sso-login.spec.ts：完整 SSO 登录流程测试，自身完成登录，须从无会话态开始
      testMatch: /login-wall\.spec\.ts|sso-login\.spec\.ts/,
    },
    {
      name: 'chromium-auth',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e-tests/.auth/sso-user.json' },
      // 认证后内容断言（依赖真实 IDP storageState）：
      // smoke/navigation（solve/result UI 与导航）、api-contract/platform-input/validation（受保护 API）、
      // image-upload/result-resilience（受保护页面/API 流程）、solve-text/solve-image/solve-platform（@llm 完整流程）
      // billing（计费反馈，@no-llm 缓存命中 + @llm 新题生成 + 双账户隔离）
      testMatch: /smoke\.spec\.ts|navigation\.spec\.ts|api-contract\.spec\.ts|platform-input\.spec\.ts|validation\.spec\.ts|image-upload\.spec\.ts|result-resilience\.spec\.ts|solve-text\.spec\.ts|solve-image\.spec\.ts|solve-platform\.spec\.ts|billing\.spec\.ts/,
    },
  ],
  // webServer（P0-3 启用）：reuseExistingServer 兼顾本地与 CI
  // - 本地：dev server 已运行则复用，行为与原手动启动一致
  // - CI：自动启动 dev server 供 E2E 使用
  // E2E 使用 dev:test（关闭中间件限流 GESP6_RATE_LIMIT_ENABLED=0）：
  // E2E 多 worker 对单 dev server 密集请求，默认 20 次/分/IP 会触发 429
  // 使 /solve 等页面加载返回 JSON 而非页面（navigation/platform-input 等用例假失败）。
  // 手动跑 E2E 也可先自行 npm run dev:test（reuseExistingServer 会复用）。
  webServer: {
    command: 'npm run dev:test',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
