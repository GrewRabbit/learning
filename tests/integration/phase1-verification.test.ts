// tests/integration/phase1-verification.test.ts
// Phase 1 AI 能力验证 — 真实 API 调用集成测试
//
// 验证标准（spec §9 Phase 1）:
//   1. 单元测试 ✅（已通过，见 __tests__/ 目录）
//   2. 人工抽检：10 道题目 JSON 格式 100% 合法；内容质量人工评分 ≥ 4/5
//
// 本脚本自动化验证「JSON 格式 100% 合法」部分，并输出 AI 响应供人工评分。
//
// 运行方式：npx vitest run tests/integration/phase1-verification.test.ts
// 前置条件：.env.local 已配置真实 API Key

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// 手动加载 .env.local（vitest 不自动加载 Next.js 的 .env.local）
try {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local 不存在，env 变量应已通过其他方式设置
}
import { solutionService } from '@/app/lib/ai/services/solution-service';
import { flowchartService } from '@/app/lib/ai/services/flowchart-service';
import { mindmapService } from '@/app/lib/ai/services/mindmap-service';
import { FlowchartSchema } from '@/app/lib/ai/schemas/flowchart-schema';
import { MindmapSchema } from '@/app/lib/ai/schemas/mindmap-schema';
import { testProblems } from '@/tests/test-problems';

// 选取 3 道题目（基础/中等/进阶各 1 道）进行验证
const selectedProblems = [
  testProblems[0], // P001: 温度转换器 (basic)
  testProblems[3], // P004: 数组统计分析 (medium)
  testProblems[6], // P007: 单链表反转 (advanced)
];

// 每个 API 调用最长等待 180 秒
const API_TIMEOUT = 180_000;

describe('Phase 1 AI 能力验证 — 真实 API 调用', () => {
  for (const problem of selectedProblems) {
    describe(`${problem.id}: ${problem.title} (${problem.difficulty})`, () => {
      let code = '';
      let analysis = '';
      let formatInvalid = false;

      it('Stage 1: solution-service — 标记协议 + 代码/分析生成', async () => {
        const codeChunks: string[] = [];
        const analysisChunks: string[] = [];

        const result = await solutionService.generateStream(
          {
            problem: problem.problem,
            mode: 'normal' as const,
          },
          {
            onCodeChunk: (chunk: string) => codeChunks.push(chunk),
            onAnalysisChunk: (chunk: string) => analysisChunks.push(chunk),
            onFormatInvalid: () => { formatInvalid = true; },
          },
        );

        code = codeChunks.join('');
        analysis = analysisChunks.join('');

        // 自动校验
        expect(result.success).toBe(true);
        expect(formatInvalid).toBe(false);
        expect(code.length).toBeGreaterThan(0);
        expect(analysis.length).toBeGreaterThan(0);
        expect(code).toContain('int main()');

        // 输出供人工评分
        console.log('\n┌─────────────────────────────────────────────');
        console.log(`│ ${problem.id} ${problem.title} — Stage 1: solution`);
        console.log('├─────────────────────────────────────────────');
        console.log('│ 【代码】');
        console.log(code);
        console.log('├─────────────────────────────────────────────');
        console.log('│ 【分析】');
        console.log(analysis);
        console.log('└─────────────────────────────────────────────\n');
      }, API_TIMEOUT);

      it('Stage 2a: flowchart-service — JSON 格式 + Zod 校验', async () => {
        expect(code.length).toBeGreaterThan(0);

        const result = await flowchartService.generate({
          problem: problem.problem,
          code,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        // Zod schema 校验
        const parsed = FlowchartSchema.safeParse(result.data);
        expect(parsed.success).toBe(true);

        // 输出供人工评分
        console.log('\n┌─────────────────────────────────────────────');
        console.log(`│ ${problem.id} ${problem.title} — Stage 2a: flowchart`);
        console.log('├─────────────────────────────────────────────');
        console.log(`│ 节点数: ${result.data!.nodes.length}`);
        console.log(`│ 边数: ${result.data!.edges.length}`);
        console.log('│ 【完整 JSON】');
        console.log(JSON.stringify(result.data, null, 2));
        console.log('└─────────────────────────────────────────────\n');
      }, API_TIMEOUT);

      it('Stage 2b: mindmap-service — JSON 格式 + 递归 Zod 校验', async () => {
        expect(code.length).toBeGreaterThan(0);

        const result = await mindmapService.generate({
          problem: problem.problem,
          code,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        // 递归 Zod schema 校验
        const parsed = MindmapSchema.safeParse(result.data);
        expect(parsed.success).toBe(true);

        // 输出供人工评分
        console.log('\n┌─────────────────────────────────────────────');
        console.log(`│ ${problem.id} ${problem.title} — Stage 2b: mindmap`);
        console.log('├─────────────────────────────────────────────');
        console.log(`│ 根节点: ${result.data!.root.label}`);
        console.log('│ 【完整 JSON】');
        console.log(JSON.stringify(result.data, null, 2));
        console.log('└─────────────────────────────────────────────\n');
      }, API_TIMEOUT);
    });
  }
});
