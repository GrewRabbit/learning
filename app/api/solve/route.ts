// app/api/solve/route.ts
// 接入层 Route Handler（架构 §5.3 + §8.2 SSRF 防护 + §5.4 错误码）
// 路径：POST /api/solve
// 职责：Zod 校验 → resolvePlatform 解析 → 调用 Orchestrator → 返回 ServiceResult<Solution>
// 不含业务逻辑（架构 §4.2 编排由 Orchestrator 负责）

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { PLATFORMS } from '@/app/lib/platforms.config';
import { gesp6Orchestrator } from '@/app/lib/ai/services/orchestrator';
import type { Problem, ServiceResult } from '@/app/lib/ai/types';

/** text 输入内容上限（字符数） */
const TEXT_MAX_LENGTH = 10_000;
/** image base64 内容上限（5MB） */
const IMAGE_MAX_LENGTH = 5 * 1024 * 1024;

/**
 * Zod 校验 schema（架构 §5.3）
 *
 * content 校验规则（使用 superRefine 访问 type 字段）：
 * - text: 长度 ≤ 10000 字符
 * - image: 长度 ≤ 5MB（base64 编码后）
 * - platform: 必须匹配 PLATFORMS 中任一 urlPattern（SSRF 防护，架构 §8.2）
 */
const solveRequestSchema = z.object({
  problem: z
    .object({
      type: z.enum(['text', 'image', 'platform']),
      content: z.string(),
    })
    .superRefine((data, ctx) => {
      if (data.type === 'text' && data.content.length > TEXT_MAX_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          message: `text 内容长度不能超过 ${TEXT_MAX_LENGTH} 字符`,
        });
      }
      if (data.type === 'image' && data.content.length > IMAGE_MAX_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          message: `image 内容长度不能超过 ${IMAGE_MAX_LENGTH} 字符`,
        });
      }
      if (data.type === 'platform') {
        // SSRF 防护：urlPattern 强制 ^https:// 开头（架构 §8.2）
        const matched = PLATFORMS.some((p) => p.urlPattern.test(data.content));
        if (!matched) {
          ctx.addIssue({
            code: 'custom',
            message: '内容不合法（platform 类型需为已配置平台的合法 https URL）',
          });
        }
      }
    }),
});

/**
 * 解析 platform 输入的 platform/problemId（架构 §5.3）
 *
 * type !== 'platform' 直接透传；
 * type === 'platform' 遍历 PLATFORMS 匹配 urlPattern，调用 idExtractor 填充字段。
 *
 * 返回 ServiceResult<Problem>，不抛异常（避免被 Route Handler try-catch 捕获为 GESP6_INTERNAL_ERROR）。
 * 理论上 Zod 已拦截非法 URL，此处为双重保险（架构 §5.3 注释）。
 */
function resolvePlatform(problem: Problem): ServiceResult<Problem> {
  if (problem.type !== 'platform') {
    return { success: true, data: problem };
  }
  // 显式 https 校验（SSRF 防护，架构 §8.2）
  if (!problem.content.startsWith('https://')) {
    return {
      success: false,
      error: { code: 'GESP6_INPUT_INVALID', message: '平台 URL 必须为 https://' },
    };
  }
  for (const config of PLATFORMS) {
    if (config.urlPattern.test(problem.content)) {
      const problemId = config.idExtractor(problem.content);
      if (problemId) {
        return {
          success: true,
          data: { ...problem, platform: config.name, problemId },
        };
      }
    }
  }
  return {
    success: false,
    error: { code: 'GESP6_INPUT_INVALID', message: '不支持的平台 URL' },
  };
}

/**
 * POST /api/solve
 *
 * 流程（架构 §5.3）：
 * 1. 解析 JSON body
 * 2. Zod 校验（失败 → 400 GESP6_INPUT_INVALID）
 * 3. resolvePlatform 解析 platform/problemId（失败 → 400 GESP6_INPUT_INVALID）
 * 4. 调用 Orchestrator.solve
 * 5. 返回 ServiceResult<Solution>（成功 200，失败 500）
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 1. 解析 body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'GESP6_INPUT_INVALID', message: '请求体非合法 JSON' },
        },
        { status: 400 },
      );
    }

    // 2. Zod 校验
    const parsed = solveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'GESP6_INPUT_INVALID',
            message: parsed.error.issues[0]?.message ?? '输入校验失败',
          },
        },
        { status: 400 },
      );
    }

    // 3. resolvePlatform 解析
    const resolved = resolvePlatform(parsed.data.problem);
    if (!resolved.success || !resolved.data) {
      return NextResponse.json(resolved, { status: 400 });
    }

    // 4. 调用 Orchestrator
    const result = await gesp6Orchestrator.solve(resolved.data);

    // 5. 返回结果（成功 200，失败 500）
    return NextResponse.json(
      result,
      { status: result.success ? 200 : 500 },
    );
  } catch (error) {
    // 兜底：未预期异常（架构 §4.4 + §5.4 GESP6_INTERNAL_ERROR）
    const message = error instanceof Error ? error.message : '内部错误';
    return NextResponse.json(
      {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message },
      },
      { status: 500 },
    );
  }
}
