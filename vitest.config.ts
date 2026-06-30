// vitest.config.ts
// Vitest 配置（testing-standards.md §一 单元测试工具 + §三 集成测试）
// 替代原 jest.config.ts，路径别名 @/* -> ./*
//
// include 覆盖两类测试：
// - 单元测试：**/__tests__/**/*.test.ts（与被测代码同位）
// - 集成测试：tests/integration-tests/**/*.test.ts（testing-standards.md §三）
//
// coverage（P0-1）：
// - provider: v8（@vitest/coverage-v8）
// - 仅度量业务逻辑（app/lib/**），排除测试/类型/配置/页面入口
// - 不设硬性阈值门禁（先建立度量基线，避免现有未度量代码触发 CI 失败）

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      '**/__tests__/**/*.test.ts',
      'tests/integration-tests/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next'],
    // 全局测试配置（testing-standards.md §二，P1-4）
    // setup.ts 统一环境变量默认值 + afterEach 清理 mock
    setupFiles: ['./app/lib/ai/services/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      // 仅度量核心业务逻辑层，排除测试/类型/配置/页面入口/组件
      include: ['app/lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        'app/**/*.test.ts',
        'app/**/__tests__/**',
        'app/**/types.ts',
        'app/**/*.config.ts',
        'app/lib/ai/prompts/**',
        'app/lib/ai/data/**',
      ],
      // 不设 thresholds：先建立覆盖率基线，待基线稳定后再设门禁
      reportOnFailure: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
