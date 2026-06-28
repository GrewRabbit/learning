// app/lib/ai/services/__tests__/smoke-runtime.test.ts
// 运行时烟测（需手动启用：RUN_SMOKE=1 npx vitest run smoke-runtime）
// 验证接口在真实环境下的端到端可用性
// 默认 skip，不影响 npm test

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 手动加载 .env.local（vitest 不自动加载 Next.js 环境变量）
beforeAll(() => {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // .env.local 不存在，跳过
  }
});

// 默认 skip，RUN_SMOKE=1 时启用
const describeSmoke = process.env.RUN_SMOKE ? describe : describe.skip;

describeSmoke('运行时烟测', () => {
  it('烟测 1: CodeValidator 真实编译 A+B', async () => {
    const { codeValidator } = await import('../code-validator');
    const code = `#include <iostream>
int main() {
  int a, b;
  std::cin >> a >> b;
  std::cout << a + b;
  return 0;
}`;
    const result = await codeValidator.validate(code, [
      { input: '1 2', expectedOutput: '3' },
      { input: '10 20', expectedOutput: '30' },
    ]);
    expect(result.success).toBe(true);
    expect(result.data?.compiled).toBe(true);
    expect(result.data?.passed).toBe(true);
    console.log('[烟测 1] CodeValidator 通过：', result.data);
  }, 30_000);

  it('烟测 2: LLMCaller 真实 API 调用（deepseek）', async () => {
    const { llmCaller } = await import('../llm-caller');
    const result = await llmCaller.generate({
      prompt: '你是一个助手。请只回答数字，不要其他内容。',
      problem: { type: 'text', content: '1+1=?' },
    });
    console.log('[烟测 2] LLMCaller success:', result.success);
    if (result.success) {
      console.log('[烟测 2] LLM raw:', result.data?.raw?.slice(0, 200));
      expect(result.data?.raw).toBeDefined();
      expect(result.data!.raw.length).toBeGreaterThan(0);
    } else {
      console.log('[烟测 2] LLM error:', result.error);
      // 网络错误不阻断烟测（记录但不 fail，便于离线环境跑）
      console.warn('[烟测 2] LLM 调用失败，可能是网络或 API Key 问题');
    }
  }, 60_000);

  it('烟测 3: ProblemFetcher 洛谷抓取 P1000（两步请求 + lentille-context）', async () => {
    const { fetchProblem } = await import('../problem-fetchers');
    const result = await fetchProblem('luogu', 'P1000');
    console.log('[烟测 3] fetchProblem success:', result.success);
    if (result.success) {
      console.log('[烟测 3] content (前 300 字):', result.data?.content.slice(0, 300));
      expect(result.data?.content.length).toBeGreaterThan(0);
    } else {
      console.log('[烟测 3] error:', result.error);
      // 网络抓取失败不阻断烟测
      console.warn('[烟测 3] 洛谷抓取失败，可能是网络问题');
    }
  }, 30_000);

  it('烟测 4: ImageRecognizer 模型能力检查（deepseek-v4-flash 已登记）', async () => {
    const { imageRecognizer } = await import('../image-recognizer');
    const result = await imageRecognizer.recognize('fake-base64-data');
    console.log('[烟测 4] ImageRecognizer result:', result);
    // models.config.ts 已登记 deepseek-v4-flash（supportsImage=true），不再前置拒绝
    // 但 fake-base64 数据可能导致 LLM 调用失败，或 prompt 文件为占位内容
    if (result.success) {
      console.log('[烟测 4] 识别成功（意外，因 fake-base64）');
    } else {
      console.log('[烟测 4] 失败：', result.error?.code, result.error?.message);
      // 不应再是 GESP6_MODEL_NOT_SUPPORTED
      expect(result.error?.code).not.toBe('GESP6_MODEL_NOT_SUPPORTED');
    }
  });
});
