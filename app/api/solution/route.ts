// app/api/solution/route.ts
// SSE 流式 Route Handler（FR-006~009，架构 §5.3）
// 混合两阶段 AI 编排：Stage 1 流式生成代码+分析，Stage 2 预留骨架（Phase 3 实现）
// 错误处理契约（架构 §5.3，NFR-007）：
//   - 流外错误（HTTP 状态码）：Zod 验证失败 → HTTP 400；其他异常 → HTTP 500
//   - 流内错误（SSE 事件）：Stage 1 致命错误 → event: error 后立即关闭流，不再发送 done
//   - 禁止抛出未捕获异常

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { solutionService } from '@/app/lib/ai/services/solution-service';
import { flowchartService } from '@/app/lib/ai/services/flowchart-service';
import { mindmapService } from '@/app/lib/ai/services/mindmap-service';
import { logger } from '@/app/lib/logging/logger';

/**
 * 请求体 Zod 校验 Schema（架构 §5.3.1，NFR-008/010）
 * - problem：题目文本，1~10000 字符
 * - standardAnswer：可选标准答案，≤ 20000 字符
 * - mode：生成模式，normal=普通生成，deep=基于标准答案深度解读
 */
const solutionRequestSchema = z.object({
  problem: z
    .string()
    .min(1, '题目文本不能为空')
    .max(10000, '题目文本超过 10000 字符上限'),
  standardAnswer: z
    .string()
    .max(20000, '标准答案超过 20000 字符上限')
    .optional(),
  mode: z.enum(['normal', 'deep']),
});

/**
 * POST /api/solution
 * SSE 流式编排 Stage 1 + Stage 2（架构 §5.3，FR-006~009）
 *
 * @param request NextRequest，包含 JSON 请求体与 signal（用于取消生成，FR-031）
 * @returns SSE 流式响应（流外错误返回 JSON + HTTP 状态码）
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    // 1. Zod 验证请求体（流外错误 → HTTP 400，架构 §5.3）
    const json: unknown = await request.json();
    const parsed = solutionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CPP_INPUT_VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? '输入校验失败',
          },
        },
        { status: 400 },
      );
    }

    const { problem, standardAnswer, mode } = parsed.data;

    // 2. 创建 ReadableStream，封装 SSE 编排逻辑（流内错误 → SSE event: error）
    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        const encoder = new TextEncoder();
        // aborted：用户主动取消标志（FR-031）；closed：流关闭标志（防止重复 close）
        let aborted = false;
        let closed = false;

        /**
         * 推送 SSE 事件（架构 §4.4.1 事件格式：event: {name}\ndata: {json}\n\n）
         * 取消或关闭后静默跳过，避免向已关闭的 controller enqueue
         */
        const send = (event: string, data: unknown): void => {
          if (aborted || closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        /**
         * 关闭流（幂等，重复调用安全）
         */
        const closeStream = (): void => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // controller 已关闭或处于 errored 状态，忽略
          }
        };

        /**
         * 用户主动取消回调（FR-031，架构 §4.4.3）
         * 触发时关闭 SSE 流并记录 info 级别日志（CPP_AI_GENERATION_CANCELLED）
         * 注意：request.signal 同时透传给 solutionService.generateStream，
         *       abort 时底层 LLM 流式连接会被真正关闭（停止 token 消耗）；
         *       onAbort 负责 SSE 流的快速关闭，两者协同满足架构 §4.4.3
         */
        const onAbort = (): void => {
          if (aborted) return;
          aborted = true;
          logger.info('用户取消生成', {
            code: 'CPP_AI_GENERATION_CANCELLED',
          });
          closeStream();
        };

        request.signal.addEventListener('abort', onAbort);

        try {
          // 3. Stage 1：solutionService.generateStream()（架构 §4.2，FR-006/007）
          //    回调中通过 controller.enqueue 推送 SSE 事件（架构 §5.4.2 回调 + 返回值混合设计）
          //    透传 request.signal：abort 时服务层停止 LLM 调用并返回取消结果（架构 §4.4.3）
          send('stage1-start', {});

          const result = await solutionService.generateStream(
            { problem, standardAnswer, mode },
            {
              onCodeChunk: (content: string) => send('code-chunk', { content }),
              onAnalysisChunk: (content: string) => send('analysis-chunk', { content }),
              onFormatInvalid: () => {
                // 标记缺失，服务层已记录 CPP_AI_SOLUTION_FORMAT_INVALID 警告日志，
                // Route Handler 无需额外处理（架构 §4.2.3）
              },
            },
            request.signal,
          );

          // 用户已取消：不再推送任何事件，直接返回（onAbort 已关闭流）
          if (aborted) {
            return;
          }

          // Stage 1 致命错误：推送 event: error 后立即关闭流（不再发送 done，架构 §4.4.2）
          if (!result.success) {
            send('error', {
              code: result.error?.code ?? 'CPP_AI_SOLUTION_GENERATION_FAILED',
              message: result.error?.message ?? '解答生成失败，请重试',
            });
            closeStream();
            return;
          }

          // Stage 1 完成：推送 stage1-done，携带 codeEmpty/analysisEmpty 标志（架构 §4.4.1，FR-013）
          const code = result.data?.code ?? '';
          const analysis = result.data?.analysis ?? '';

          // 非流式降级：服务层未通过回调推送 chunk（避免与流式部分内容重复），
          // Route Handler 重发 stage1-start 通知前端清空已接收的部分内容，再推送完整内容
          if (result.data?.fallback) {
            send('stage1-start', {});
            if (code) {
              send('code-chunk', { content: code });
            }
            if (analysis) {
              send('analysis-chunk', { content: analysis });
            }
          }

          send('stage1-done', {
            codeEmpty: code.length === 0,
            analysisEmpty: analysis.length === 0,
          });

          // 4. Stage 2：流程图 + 思维导图并行生成（架构 §4.3，FR-008/009）
          //    独立容错：任一失败不影响另一个（Promise.allSettled 保证两者都执行完）
          //    服务层内部已 try-catch 返回 ServiceResult，allSettled 兜底防意外抛出
          send('stage2-start', {});

          const [flowchartSettled, mindmapSettled] = await Promise.allSettled([
            flowchartService.generate({ problem, code }),
            mindmapService.generate({ problem, code }),
          ]);

          // 流程图结果：成功推送完整 JSON，失败推送 flowchart-error（FR-009）
          if (
            flowchartSettled.status === 'fulfilled' &&
            flowchartSettled.value.success
          ) {
            send('flowchart', flowchartSettled.value.data);
          } else {
            const failedResult =
              flowchartSettled.status === 'fulfilled'
                ? flowchartSettled.value
                : null;
            send('flowchart-error', {
              code: failedResult?.error?.code ?? 'CPP_AI_FLOWCHART_GENERATION_FAILED',
              message: failedResult?.error?.message ?? '流程图生成失败，可重试',
            });
          }

          // 思维导图结果：成功推送完整 JSON，失败推送 mindmap-error（FR-009）
          if (
            mindmapSettled.status === 'fulfilled' &&
            mindmapSettled.value.success
          ) {
            send('mindmap', mindmapSettled.value.data);
          } else {
            const failedResult =
              mindmapSettled.status === 'fulfilled' ? mindmapSettled.value : null;
            send('mindmap-error', {
              code: failedResult?.error?.code ?? 'CPP_AI_MINDMAP_GENERATION_FAILED',
              message: failedResult?.error?.message ?? '思维导图生成失败，可重试',
            });
          }

          send('done', {});
          closeStream();
        } catch (error) {
          // 用户已取消：onAbort 已处理，不再推送错误事件
          if (aborted) {
            return;
          }
          // 流内异常兜底：推送 event: error 后立即关闭流（不再发送 done）
          logger.error('SSE 编排失败', {
            error: error instanceof Error ? error.message : String(error),
          });
          send('error', {
            code: 'CPP_INTERNAL_ERROR',
            message: '系统内部错误，请稍后重试',
          });
          closeStream();
        } finally {
          request.signal.removeEventListener('abort', onAbort);
        }
      },
    });

    // 6. 返回 SSE 流式响应（架构 §5.3.2 响应头契约）
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    // 外层兜底：流外异常（如 request.json() 解析失败、ReadableStream 构造异常）返回 HTTP 500
    logger.error('Route Handler 流外异常', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CPP_INTERNAL_ERROR',
          message: '系统内部错误，请稍后重试',
        },
      },
      { status: 500 },
    );
  }
}
