// playwright.config.ts
// Playwright 配置（testing-standards.md §四 E2E 测试规范）
// baseURL: http://localhost:3000（复用已运行的 dev server）
// 标签过滤：@smoke / @critical / @fast

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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer: 复用已运行的 dev server（terminal 4）
  // 如需自动启动，取消注释下方配置
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: true,
  //   timeout: 60_000,
  // },
});
