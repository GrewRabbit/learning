// app/api/solve/route.ts
// 接入层 Route Handler（架构 §5.3 + §8.2 SSRF 防护 + §5.4 错误码 + §4.1 建档/计费整合）
// 路径：POST /api/solve（提交任务）+ GET /api/solve?jobId=xxx（轮询状态）
// 职责：认证 → Zod 校验 → resolvePlatform 解析 → 用户建档（FR-027）→ 创建后台任务 → 返回 jobId；
//       完成回调内原子计费 settle → completeJob/failJob（FR-028）
// 不含业务逻辑（架构 §4.2 编排由 Orchestrator 负责；计费事务封装在 BillingService）
//
// 与架构 §4.1 步骤顺序的差异说明：架构为「认证 → 建档 → Zod」，本实现为「认证 → Zod → resolvePlatform
// → 建档 → createJob」——建档置于全部输入校验通过之后，避免非法输入白白触发 DB 建档往返；
// 「建档失败不建 job、不触发 LLM」（AC-001）与所有 FR/AC 语义不变。

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { PLATFORMS } from '@/app/lib/platforms.config';
import { gesp6Orchestrator } from '@/app/lib/ai/services/orchestrator';
import { logger } from '@/app/lib/logging/logger';
import { requireAuth } from '@/app/lib/auth/guard';
import { userDao } from '@/app/lib/db/daos/user-dao';
import { createJob, failJob, cancelJob, getJob, appendThinkingChunk, appendOrganizingChunk } from '@/app/lib/job-store';
import type { Problem, ServiceResult, LLMChunk } from '@/app/lib/ai/types';
import { settleAndCompleteJob, isBillingDegradeOpen } from './settle-callback';

/** text 输入内容上限（字符数） */
const TEXT_MAX_LENGTH = 10_000;
/** image base64 内容上限（5MB） */
const IMAGE_MAX_LENGTH = 5 * 1024 * 1024;
/** 新用户建档赠送免费次数默认值（GESP6_FREE_QUOTA_INITIAL，FR-016） */
const FREE_QUOTA_INITIAL_DEFAULT = 5;

/**
 * 新用户免费额度初始值（FR-016）：GESP6_FREE_QUOTA_INITIAL 解析，
 * 非正整数容错回退默认（与 billing-service.getPrice 同模式）。
 * 模块级函数每次读取，便于运行时切换与测试 stubEnv。
 */
function getFreeQuotaInitial(): number {
  const parsed = Number(process.env.GESP6_FREE_QUOTA_INITIAL);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : FREE_QUOTA_INITIAL_DEFAULT;
}

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
  /**
   * 可选，true 时强制 LLM 重新生成（跳过缓存读），生成后覆盖现有缓存映射。
   * 用于 /result 页"重新生成"场景：同一题目重新提交给大模型。
   */
  regenerate: z.boolean().optional(),
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
 * 流程（轮询模式）：
 * 1. 认证（M5 requireAuth，本地 JWT 验签，失败 → 401）
 * 2. 解析 JSON body
 * 3. Zod 校验（失败 → 400 GESP6_INPUT_INVALID）
 * 4. resolvePlatform 解析 platform/problemId（失败 → 400 GESP6_INPUT_INVALID）
 * 5. 用户建档 getOrCreateUser(sub)（FR-027；DB 不可用 → 503 GESP6_DB_UNAVAILABLE，
 *    其余失败 → 500 GESP6_USER_CREATE_FAILED；fail-open 开启时放行 userId=null）
 * 6. 创建 jobId，后台启动 Orchestrator.solve（完成回调内 settle 计费，FR-028）
 * 7. 立即返回 { success: true, data: { jobId } }
 *
 * 客户端通过 GET /api/solve?jobId=xxx 轮询任务状态。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const requestStartTs = Date.now();
  try {
    // 0. 认证（M5，架构 §5.2 requireAuth）
    // 受保护操作，Zod 校验之前执行；失败 → 401（AUTH_TOKEN_EXPIRED / AUTH_SESSION_INVALID）
    const auth = await requireAuth(req);
    if (!auth.success) {
      const code = auth.error?.code ?? 'AUTH_SESSION_INVALID';
      logger.warn('[SolveRoute] 认证失败', {
        code,
        elapsedMs: Date.now() - requestStartTs,
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code,
            message: auth.error?.message ?? '登录会话无效，请重新登录',
          },
        },
        { status: 401 },
      );
    }
    // sub 仅用于日志关联（不泄露敏感值）
    const authSub = auth.data?.sub;

    // 1. 解析 body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      logger.warn('[SolveRoute] 请求体非合法 JSON', { elapsedMs: Date.now() - requestStartTs });
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
      logger.warn('[SolveRoute] Zod 校验失败', {
        issue: parsed.error.issues[0]?.message,
        elapsedMs: Date.now() - requestStartTs,
      });
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

    const problem = parsed.data.problem;
    const regenerate = parsed.data.regenerate === true;
    logger.info('[SolveRoute] 收到请求', {
      type: problem.type,
      contentLength: problem.content.length,
      contentPreview: problem.content.slice(0, 80),
      regenerate,
      sub: authSub,
    });

    // 3. resolvePlatform 解析
    const resolved = resolvePlatform(problem);
    if (!resolved.success || !resolved.data) {
      logger.warn('[SolveRoute] resolvePlatform 失败', {
        type: problem.type,
        error: resolved.error?.code,
        elapsedMs: Date.now() - requestStartTs,
      });
      return NextResponse.json(resolved, { status: 400 });
    }

    if (problem.type === 'platform') {
      logger.info('[SolveRoute] platform 解析完成', {
        platform: resolved.data.platform,
        problemId: resolved.data.problemId,
      });
    }

    // 4. 用户建档（FR-027/FR-006）：requireAuth 的 sub → 内部 users.id（+额度账户初始化），
    //    供完成回调计费使用。置于全部输入校验通过后（顺序差异见文件头注释）。
    if (!authSub) {
      // 理论不可达（requireAuth 成功必携带 claims），仅 TS 类型收窄（不信任 ServiceResult 可选字段）
      logger.error('[SolveRoute] 认证成功但缺少 sub（理论不可达）');
      return NextResponse.json(
        { success: false, error: { code: 'GESP6_INTERNAL_ERROR', message: '认证信息异常' } },
        { status: 500 },
      );
    }
    let userId: string | null = null;
    const userCreated = await userDao.getOrCreateUser(authSub, getFreeQuotaInitial());
    if (userCreated.success && userCreated.data) {
      userId = userCreated.data.userId;
      logger.info('[SolveRoute] 用户建档完成', {
        userId,
        elapsedMs: Date.now() - requestStartTs,
      });
    } else if (isBillingDegradeOpen()) {
      // fail-open（AR1-006/NFR-007）：建档失败放行，userId=null，完成回调跳过 settle（不计费不写记录）
      logger.warn('[SolveRoute] 建档失败，fail-open 放行', {
        code: userCreated.error?.code,
        sub: authSub,
        elapsedMs: Date.now() - requestStartTs,
      });
    } else if (userCreated.error?.code === 'GESP6_DB_UNAVAILABLE') {
      // fail-closed（默认，AC-001）：拒绝请求，不创建 job、不触发 LLM
      logger.error('[SolveRoute] 建档失败（DB 不可用）', {
        code: userCreated.error.code,
        elapsedMs: Date.now() - requestStartTs,
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'GESP6_DB_UNAVAILABLE',
            message: userCreated.error.message,
          },
        },
        { status: 503 },
      );
    } else {
      // 连接正常但建档失败（非约束冲突，FR-006 幂等冲突已在 DAO 内消化）
      logger.error('[SolveRoute] 建档失败', {
        code: userCreated.error?.code,
        elapsedMs: Date.now() - requestStartTs,
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: userCreated.error?.code ?? 'GESP6_USER_CREATE_FAILED',
            message: userCreated.error?.message ?? '用户建档失败',
          },
        },
        { status: 500 },
      );
    }

    // 5. 创建 jobId，后台启动处理（不 await）
    const jobId = createJob();
    const resolvedProblem = resolved.data;
    logger.info('[SolveRoute] 任务已派发', {
      jobId,
      type: problem.type,
      elapsedMs: Date.now() - requestStartTs,
    });

    // 取消检查闭包：供 orchestrator 在修正循环每轮开始前检查
    const shouldAbort = (): boolean => {
      const job = getJob(jobId);
      return job?.status === 'cancelled';
    };

    // 思考过程与组织回答展示开关（环境变量配置，默认开启）
    // 关闭时 onChunk 为 undefined，从源头不累积 thinkingContent/organizingContent，前端面板自然不展示
    const thinkingDisplayEnabled = process.env.GESP6_THINKING_DISPLAY_ENABLED !== 'false';

    // 流式回调：将 reasoning_content 累积到 thinkingContent（思考过程面板），
    // 将 content 累积到 organizingContent（组织回答面板）。
    // 思考阶段（reasoning）结束后进入回答阶段（content），前端通过 organizingContent 是否有内容判定切换面板。
    const onChunk: ((chunk: LLMChunk) => void) | undefined = thinkingDisplayEnabled
      ? (chunk: LLMChunk): void => {
          if (chunk.type === 'reasoning') {
            appendThinkingChunk(jobId, chunk.text);
          } else if (chunk.type === 'content') {
            appendOrganizingChunk(jobId, chunk.text);
          }
        }
      : undefined;

    // 后台执行（不阻塞响应）
    gesp6Orchestrator
      .solve(resolvedProblem, shouldAbort, onChunk, regenerate)
      .then(async (result) => {
        // 任务已被取消 → 丢弃结果（cancelJob 已更新状态，无需 completeJob/failJob）
        if (result.error?.code === 'GESP6_CANCELLED') {
          logger.info('[SolveRoute] 任务已取消，丢弃计算结果', { jobId });
          return;
        }
        // 计算完成但任务已被取消（竞态：计算和取消同时发生）
        if (result.success && result.data) {
          // 前置取消检查（AR1-005）：进入 settle 前检查，已取消则丢弃结果、不计费不写记录
          const job = getJob(jobId);
          if (job?.status === 'cancelled') {
            logger.info('[SolveRoute] 任务完成但已被取消，丢弃结果', { jobId });
            return;
          }
          // 计费分支（FR-028，含 fail-open 三态与 failJob 语义）提取于 ./settle-callback
          await settleAndCompleteJob(jobId, userId, resolvedProblem, result.data);
        } else {
          failJob(jobId, result.error ?? {
            code: 'GESP6_INTERNAL_ERROR',
            message: '解题失败',
          });
        }
      })
      .catch((error: unknown) => {
        // 兜底：async 回调内（含 settle await）抛出的未预期异常（不悬挂 promise）
        const message = error instanceof Error ? error.message : '内部错误';
        failJob(jobId, { code: 'GESP6_INTERNAL_ERROR', message });
      });

    // 6. 立即返回 jobId
    return NextResponse.json({
      success: true,
      data: { jobId },
    });
  } catch (error) {
    // 兜底：未预期异常（架构 §4.4 + §5.4 GESP6_INTERNAL_ERROR）
    const message = error instanceof Error ? error.message : '内部错误';
    logger.error('[SolveRoute] 未预期异常', {
      message,
      elapsedMs: Date.now() - requestStartTs,
    });
    return NextResponse.json(
      {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message },
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/solve?jobId=xxx
 *
 * 轮询查询任务状态：
 * - processing → { success: true, data: { status: 'processing', thinkingContent, organizingContent } }
 * - done → { success: true, data: { status: 'done', result: Solution, charged, balanceRemaining,
 *           thinkingContent, organizingContent } }（charged/balanceRemaining 与 result 平级，FR-022）
 * - error → { success: false, error: { code, message } }（含 GESP6_BILLING_*，envelope 维持 200，AR1-007）
 * - cancelled → { success: false, error: { code: 'GESP6_CANCELLED', message: '任务已取消' } }
 * - 不存在 → 404
 *
 * thinkingContent：GLM-5.x thinking 模式下的 reasoning_content 累积（思考过程面板）。
 * organizingContent：GLM-5.x thinking 模式下的 content 累积（组织回答面板）。
 * 前端在 processing/done 状态下展示两个折叠面板：先思考过程，思考结束后开始组织回答。
 */
export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: { code: 'GESP6_INPUT_INVALID', message: '缺少 jobId 参数' } },
      { status: 400 },
    );
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: 'GESP6_JOB_NOT_FOUND', message: '任务不存在或已过期' } },
      { status: 404 },
    );
  }

  if (job.status === 'done' && job.result) {
    return NextResponse.json({
      success: true,
      data: {
        status: 'done',
        result: job.result,
        // 计费信息顶层透出（FR-022/AR1-007）：与 result 平级；
        // balanceRemaining=null 表示额度暂不可用（fail-open 放行期间，FR-030）
        charged: job.charged,
        balanceRemaining: job.balanceRemaining,
        thinkingContent: job.thinkingContent,
        organizingContent: job.organizingContent,
      },
    });
  }

  if (job.status === 'error' && job.error) {
    return NextResponse.json({
      success: false,
      error: job.error,
    });
  }

  if (job.status === 'cancelled') {
    return NextResponse.json({
      success: false,
      error: { code: 'GESP6_CANCELLED', message: '任务已取消' },
    });
  }

  // processing：返回当前累积的思考过程与组织回答内容，供前端实时展示
  return NextResponse.json({
    success: true,
    data: {
      status: 'processing',
      thinkingContent: job.thinkingContent,
      organizingContent: job.organizingContent,
    },
  });
}

/**
 * DELETE /api/solve?jobId=xxx
 *
 * 取消任务（用户主动取消或超时放弃时调用）：
 * - 仅 processing 状态的任务可取消
 * - 取消后 orchestrator 在修正循环下一轮检查时中止，避免浪费后续 AI 调用
 * - 已完成/已失败/已取消的任务返回 404
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: { code: 'GESP6_INPUT_INVALID', message: '缺少 jobId 参数' } },
      { status: 400 },
    );
  }

  logger.info('[SolveRoute] 收到取消请求', { jobId });
  const cancelled = cancelJob(jobId);
  if (!cancelled) {
    return NextResponse.json(
      { success: false, error: { code: 'GESP6_JOB_NOT_FOUND', message: '任务不存在或已完成，无法取消' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, data: { cancelled: true } });
}
