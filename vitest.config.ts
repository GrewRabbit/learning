// vitest.config.ts
// Vitest 配置（testing-standards.md §一 单元测试工具）
// 替代原 jest.config.ts，路径别名 @/* -> ./*

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
