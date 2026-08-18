// app/lib/db/daos/solution-dao.ts
// 解法域 DAO（架构 §5.1；DbHtmlCache 数据源 + 导入脚本数据源）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 冲突策略分离（AR1-001，AD-11）：
// - 运行期 upsert*：ON CONFLICT DO UPDATE（覆盖 validated/warning/html，索引指向最新）
// - 导入期 insertIfAbsent*：ON CONFLICT DO NOTHING（DB 已有记录以 DB 为准，跳过并返回 false）
//
// 错误处理边界（架构 §5.1 注释语义）：
// - 读路径返回 ServiceResult：读失败 success=false（DbHtmlCache 视为 miss 降级，§4.2）
// - 写路径 upsert* 返回 Promise<void> / insertIfAbsent* 返回 Promise<boolean>：
//   异常上抛，由调用方 catch（DbHtmlCache.set 记日志不阻断 NFR-007；导入脚本记入失败清单 AR1-013）

import { and, eq } from 'drizzle-orm';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import { getDb } from '@/app/lib/db/connection';
import { classifyDbError } from '@/app/lib/db/errors';
import { primaryIndexes, sampleIndexes, solutions } from '@/app/lib/db/schema';

/**
 * 携带主键 contentHash 的 Solution（架构 §5.1 注：data.contentHash = solutions 表主键值）。
 * Solution 类型将在后续步骤扩展 contentHash 字段（架构 §5.2），届时本别名与其自然合并。
 */
export type SolutionWithHash = Solution & { contentHash: string };

/** 解法表行 → SolutionWithHash（命中视为缓存命中 cached: true，与 FsHtmlCache 读语义一致） */
function toSolutionWithHash(row: {
  contentHash: string;
  html: string;
  validated: boolean;
  warning: string | null;
}): SolutionWithHash {
  return {
    contentHash: row.contentHash,
    html: row.html,
    validated: row.validated,
    warning: row.warning ?? undefined,
    cached: true,
  };
}

/** DAO 异常 → ServiceResult（连接类经 errors.ts 分类；错误信息不含连接串，NFR-005） */
function toErrorResult(error: unknown): ServiceResult<never> {
  const classified = classifyDbError(error, 'generic');
  return classified !== null
    ? { success: false, error: { code: classified.code, message: '数据库暂不可用' } }
    : { success: false, error: { code: 'GESP6_INTERNAL_ERROR', message: '数据库操作失败' } };
}

/** 解法表列选择（contentHash 主键 + 内容元数据） */
const SOLUTION_COLUMNS = {
  contentHash: solutions.contentHash,
  html: solutions.html,
  validated: solutions.validated,
  warning: solutions.warning,
};

export const solutionDao = {
  /** 按内容 hash 查解法（PK 等值命中，FR-011）；未命中 data=null */
  async getByContentHash(contentHash: string): Promise<ServiceResult<SolutionWithHash | null>> {
    try {
      const rows = await getDb()
        .select(SOLUTION_COLUMNS)
        .from(solutions)
        .where(eq(solutions.contentHash, contentHash))
        .limit(1);
      const row = rows[0];
      return row === undefined
        ? { success: true, data: null }
        : { success: true, data: toSolutionWithHash(row) };
    } catch (error) {
      return toErrorResult(error);
    }
  },

  /** 按主 key（platform, problemId）查指向的 contentHash（FR-012）；未命中 data=null */
  async getPrimaryContentHash(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<{ contentHash: string } | null>> {
    try {
      const rows = await getDb()
        .select({ contentHash: primaryIndexes.contentHash })
        .from(primaryIndexes)
        .where(and(eq(primaryIndexes.platform, platform), eq(primaryIndexes.problemId, problemId)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? { success: true, data: null } : { success: true, data: row };
    } catch (error) {
      return toErrorResult(error);
    }
  },

  /** 按样例指纹查指向的 contentHash（FR-013）；未命中 data=null */
  async getBySampleFingerprint(sampleFp: string): Promise<ServiceResult<{ contentHash: string } | null>> {
    try {
      const rows = await getDb()
        .select({ contentHash: sampleIndexes.contentHash })
        .from(sampleIndexes)
        .where(eq(sampleIndexes.sampleFp, sampleFp))
        .limit(1);
      const row = rows[0];
      return row === undefined ? { success: true, data: null } : { success: true, data: row };
    } catch (error) {
      return toErrorResult(error);
    }
  },

  // —— 运行期 upsert（DO UPDATE，DbHtmlCache.set 用，AR1-001；异常上抛）——

  /** 解法 upsert：冲突时更新 html/validated/warning（同 hash 重新生成覆盖元数据） */
  async upsertSolution(contentHash: string, solution: Solution): Promise<void> {
    await getDb()
      .insert(solutions)
      .values({
        contentHash,
        html: solution.html,
        validated: solution.validated,
        warning: solution.warning ?? null,
      })
      .onConflictDoUpdate({
        target: solutions.contentHash,
        set: {
          html: solution.html,
          validated: solution.validated,
          warning: solution.warning ?? null,
        },
      });
  },

  /** 主 key 索引 upsert：冲突时更新 content_hash 指向最新解法 */
  async upsertPrimaryIndex(platform: string, problemId: string, contentHash: string): Promise<void> {
    await getDb()
      .insert(primaryIndexes)
      .values({ platform, problemId, contentHash })
      .onConflictDoUpdate({
        target: [primaryIndexes.platform, primaryIndexes.problemId],
        set: { contentHash },
      });
  },

  /** 样例指纹索引 upsert：冲突时更新 content_hash 指向最新解法 */
  async upsertSampleIndex(sampleFp: string, contentHash: string): Promise<void> {
    await getDb()
      .insert(sampleIndexes)
      .values({ sampleFp, contentHash })
      .onConflictDoUpdate({
        target: sampleIndexes.sampleFp,
        set: { contentHash },
      });
  },

  // —— 导入期 insert-if-absent（DO NOTHING，导入脚本用，AR1-001；异常上抛）——

  /** 解法 insert-if-absent：已存在跳过不覆盖；返回是否新插入（true=新插入/false=已存在跳过） */
  async insertIfAbsentSolution(contentHash: string, solution: Solution): Promise<boolean> {
    const rows = await getDb()
      .insert(solutions)
      .values({
        contentHash,
        html: solution.html,
        validated: solution.validated,
        warning: solution.warning ?? null,
      })
      .onConflictDoNothing({ target: solutions.contentHash })
      .returning({ contentHash: solutions.contentHash });
    return rows.length > 0;
  },

  /** 主 key 索引 insert-if-absent（导入脚本幂等重跑，FR-024） */
  async insertIfAbsentPrimaryIndex(
    platform: string,
    problemId: string,
    contentHash: string,
  ): Promise<boolean> {
    const rows = await getDb()
      .insert(primaryIndexes)
      .values({ platform, problemId, contentHash })
      .onConflictDoNothing({ target: [primaryIndexes.platform, primaryIndexes.problemId] })
      .returning({ platform: primaryIndexes.platform });
    return rows.length > 0;
  },

  /** 样例指纹索引 insert-if-absent（导入脚本幂等重跑，FR-024） */
  async insertIfAbsentSampleIndex(sampleFp: string, contentHash: string): Promise<boolean> {
    const rows = await getDb()
      .insert(sampleIndexes)
      .values({ sampleFp, contentHash })
      .onConflictDoNothing({ target: sampleIndexes.sampleFp })
      .returning({ sampleFp: sampleIndexes.sampleFp });
    return rows.length > 0;
  },
};
