// app/lib/ai/services/__tests__/setup.ts
// 全局测试配置（testing-standards.md §二，P1-4）
//
// 作用：
// 1. 统一环境变量默认值（避免各测试文件重复设置 + 不依赖 .env.local）
//    个别测试可用 vi.stubEnv 覆盖
// 2. 全局 afterEach 清理 mock 调用记录（不重置 implementation）
//
// 注意：llm-caller.test.ts / route.test.ts 等通过 vi.mock 替换整个模块，
// stubEnv 的值不影响它们（mock 模块不走真实 config.ts 读 env 逻辑）。

import { vi, afterEach } from 'vitest';

// 环境变量默认值（AI 配置）
vi.stubEnv('AI_TEXT_PROVIDER', 'deepseek');
vi.stubEnv('AI_TEXT_MODEL', 'deepseek-test');
vi.stubEnv('AI_VISION_PROVIDER', 'qwen');
vi.stubEnv('AI_VISION_MODEL', 'qwen-test');
vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
vi.stubEnv('QWEN_API_KEY', 'test-key');
vi.stubEnv('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com');

// 全局清理：每个测试后清理 mock 调用记录
// clearAllMocks 仅清理 calls/results，不重置 implementation（用 resetAllMocks 才重置）
afterEach(() => {
  vi.clearAllMocks();
});
