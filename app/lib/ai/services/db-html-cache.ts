// app/lib/ai/services/db-html-cache.ts
// 数据库持久化 HtmlCache 实现（AD-06/FR-014/Step 8；架构 §8.1 AR1-009）
//
// 数据流：LRU 前置层（性能层）→ solutionDao（PostgreSQL 权威源）
// - 三个独立 LRU（primary/content/sample），max=100、ttl=1h，与 DualKeyHtmlCache 配置一致（AR1-009）
// - 读路径：LRU → DAO；写路径 set 双写 LRU + DB（数据库为权威源，LRU 仅性能层）
// - 读失败（DAO success=false / 异常）→ 视为 miss 降级走 LLM（FR-014b/AC-010a，不算 DB 故障，§4.2）
// - 写失败 → 仅记日志不阻断主流程（NFR-007）
// - 单飞：in-flight Promise Map（key=contentHash，AR1-019），与 DualKeyHtmlCache 一致
//
// Plan B 关键差异（终审观察 3）：sample 命中返回前，须以「当前请求 contentHash」落 solutions 行
// （upsertSolution DO UPDATE 幂等）+ sample 索引指向当前 contentHash——确保 T5 settle 写
// user_solution_access（FK→solutions）时当前 contentHash 在 DB 有行，FK 不断裂；
// 对齐 DualKeyHtmlCache 的 LRU 回写与 sample 索引写入语义。
//
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2，仅由 html-cache.ts 单例按 driver 构造）。

import { LRUCache } from 'lru-cache';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';
import type { HtmlCache } from './html-cache';
import type { SampleFingerprint } from './problem-fetchers/types';
// 复用 FsHtmlCache 的主 key 构造/解析与多候选指纹提取（纯函数，无副作用）
import {
  buildPrimaryKey,
  parsePrimaryKey,
  getCandidateFingerprints,
} from './fs-paths';

export class DbHtmlCache implements HtmlCache {
  /** 主 key（gesp6:platform:{p}:{id}）→ Solution */
  private readonly primaryCache: LRUCache<string, Solution>;
  /** contentHash → Solution */
  private readonly contentCache: LRUCache<string, Solution>;
  /** sample 指纹 → contentHash */
  private readonly sampleCache: LRUCache<string, string>;
  /** in-flight Promise Map（getOrCompute 单飞，key=contentHash） */
  private readonly inflight = new Map<string, Promise<ServiceResult<Solution>>>();

  constructor() {
    this.primaryCache = new LRUCache<string, Solution>({
      max: 100,
      ttl: 60 * 60 * 1000, // 1 小时（AR1-009：与 DualKeyHtmlCache 一致）
    });
    this.contentCache = new LRUCache<string, Solution>({
      max: 100,
      ttl: 60 * 60 * 1000,
    });
    this.sampleCache = new LRUCache<string, string>({
      max: 100,
      ttl: 60 * 60 * 1000,
    });
  }

  async getByPrimaryKey(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<Solution | null>> {
    const key = this.buildPrimaryKey(platform, problemId);
    try {
      // 1. LRU 前置层
      const lruHit = this.primaryCache.get(key);
      if (lruHit) {
        logger.info('[DbHtmlCache.getByPrimaryKey] LRU 命中', { platform, problemId });
        return { success: true, data: lruHit };
      }
      // 2. DB 索引：primary_indexes → contentHash
      const indexResult = await solutionDao.getPrimaryContentHash(platform, problemId);
      if (!indexResult.success) {
        // 读失败视为 miss（FR-014b，不算 DB 故障；orchestrator 不命中继续抓取）
        logger.error('[DbHtmlCache.getByPrimaryKey] 索引读取失败，视为 miss', {
          platform,
          problemId,
          errorCode: indexResult.error?.code,
        });
        return { success: false, error: indexResult.error };
      }
      if (!indexResult.data) {
        logger.info('[DbHtmlCache.getByPrimaryKey] 索引未命中', { platform, problemId });
        return { success: true, data: null };
      }
      // 3. contentHash → Solution
      const solutionResult = await this.lookupContent(indexResult.data.contentHash);
      if (!solutionResult.success) {
        logger.error('[DbHtmlCache.getByPrimaryKey] content 读取失败，视为 miss', {
          platform,
          problemId,
          errorCode: solutionResult.error?.code,
        });
        return { success: false, error: solutionResult.error };
      }
      if (!solutionResult.data) {
        // 索引失效（solutions 行缺失）：返回 null，后续写入自愈（无删除 API，§4.2）
        logger.warn('[DbHtmlCache.getByPrimaryKey] 索引指向的 content 缺失（索引失效）', {
          platform,
          problemId,
          contentHash: indexResult.data.contentHash,
        });
        return { success: true, data: null };
      }
      this.primaryCache.set(key, solutionResult.data);
      logger.info('[DbHtmlCache.getByPrimaryKey] DB 命中', {
        platform,
        problemId,
        validated: solutionResult.data.validated,
      });
      return { success: true, data: solutionResult.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DbHtmlCache.getByPrimaryKey] 读取异常，视为 miss', {
        platform,
        problemId,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_DB_UNAVAILABLE', message: '主 key 读取失败' },
      };
    }
  }

  async getByContentKey(contentHash: string): Promise<ServiceResult<Solution | null>> {
    return this.lookupContent(contentHash);
  }

  async getBySampleFingerprint(
    sampleFp: string,
  ): Promise<ServiceResult<{ contentHash: string } | null>> {
    try {
      // 1. LRU 前置层
      const lruHit = this.sampleCache.get(sampleFp);
      if (lruHit) {
        return { success: true, data: { contentHash: lruHit } };
      }
      // 2. DB 索引：sample_indexes → contentHash（读失败视为 miss，FR-014b）
      const result = await solutionDao.getBySampleFingerprint(sampleFp);
      if (!result.success) {
        logger.error('[DbHtmlCache.getBySampleFingerprint] 读取失败，视为 miss', {
          sampleFp,
          sampleFpShort: sampleFp.slice(0, 16),
          errorCode: result.error?.code,
        });
        return { success: false, error: result.error };
      }
      if (result.data) {
        this.sampleCache.set(sampleFp, result.data.contentHash);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DbHtmlCache.getBySampleFingerprint] 读取异常，视为 miss', {
        sampleFp,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_DB_UNAVAILABLE', message: 'sample 索引读取失败' },
      };
    }
  }

  set(primaryKey: string | null, contentHash: string, solution: Solution): void {
    // LRU 同步双写（primary + content）
    this.contentCache.set(contentHash, solution);
    if (primaryKey !== null) {
      this.primaryCache.set(primaryKey, solution);
    }
    logger.info('[DbHtmlCache.set] 写入（LRU 已写，DB fire-and-forget）', {
      primaryKey,
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      validated: solution.validated,
      htmlLength: solution.html.length,
    });
    // DB 权威写：fire-and-forget 异步（不阻塞响应，架构 §4.4/NFR-007 写失败仅记日志）
    void this.writeThrough(primaryKey, contentHash, solution).catch((error) => {
      logger.error('[DbHtmlCache.set] DB 写入失败（不阻断主流程）', {
        primaryKey,
        contentHash,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
    sampleFp?: SampleFingerprint,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>> {
    const gocStartTs = Date.now();
    const candidates = getCandidateFingerprints(sampleFp);
    logger.info('[DbHtmlCache.getOrCompute] 开始三步查询', {
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      hasSampleFp: candidates.length > 0,
      candidateCount: candidates.length,
      forceRegenerate: Boolean(forceRegenerate),
    });
    try {
      if (!forceRegenerate) {
        // 1. 查内容（LRU → DB；读失败视为 miss 继续走后续步骤，FR-014b）
        const contentResult = await this.lookupContent(contentHash);
        if (contentResult.success && contentResult.data) {
          logger.info('[DbHtmlCache.getOrCompute] 第 1 步 content 命中，直接返回', {
            contentHash,
            validated: contentResult.data.validated,
            elapsedMs: Date.now() - gocStartTs,
          });
          return { success: true, data: { ...contentResult.data, cached: true } };
        }

        // 2. miss 且多候选指纹非空 → 依次查 sample 索引（LRU → DB，顺序 [all, first]）
        if (candidates.length > 0) {
          for (const fp of candidates) {
            const sampleResult = await this.getBySampleFingerprint(fp);
            if (!(sampleResult.success && sampleResult.data)) {
              logger.info('[DbHtmlCache.getOrCompute] 第 2 步 sample 索引未命中', {
                sampleFp: fp,
                sampleFpShort: fp.slice(0, 16),
              });
              continue;
            }
            const contentHash2 = sampleResult.data.contentHash;
            logger.info('[DbHtmlCache.getOrCompute] 第 2 步 sample 索引命中，查 content2', {
              sampleFp: fp,
              contentHash2,
              contentHash2Short: contentHash2.slice(0, 16),
            });
            const content2Result = await this.lookupContent(contentHash2);
            if (content2Result.success && content2Result.data) {
              // Plan B 命中：以当前 contentHash 落库 + 索引指向当前 hash + LRU 回写
              // （终审观察 3：upsertSolution 确保当前 hash 有 solutions 行，T5 settle FK 不断裂）
              logger.info('[DbHtmlCache.getOrCompute] 第 2 步 content2 命中，Plan B 回写', {
                sampleFp: fp,
                contentHash,
                contentHash2,
                validated: content2Result.data.validated,
              });
              try {
                await solutionDao.upsertSolution(contentHash, content2Result.data);
                await solutionDao.upsertSampleIndex(fp, contentHash);
              } catch (error) {
                // 回写失败不阻断返回（NFR-007；FK 风险记日志供排查）
                logger.error('[DbHtmlCache.getOrCompute] Plan B 回写失败（不阻断返回）', {
                  sampleFp: fp,
                  contentHash,
                  contentHash2,
                  message: error instanceof Error ? error.message : String(error),
                });
              }
              this.contentCache.set(contentHash, content2Result.data);
              this.sampleCache.set(fp, contentHash);
              logger.info('[DbHtmlCache.getOrCompute] Plan B 返回（cached: true）', {
                contentHash,
                sampleFp: fp,
                elapsedMs: Date.now() - gocStartTs,
              });
              return { success: true, data: { ...content2Result.data, cached: true } };
            }
            // 索引失效：LRU 清理并继续下一候选（DB 侧无删除 API，由后续写入自愈）
            logger.warn('[DbHtmlCache.getOrCompute] 第 2 步 content2 未命中（索引失效），清理 LRU 并继续', {
              sampleFp: fp,
              contentHash2,
            });
            this.sampleCache.delete(fp);
          }
          logger.info('[DbHtmlCache.getOrCompute] 第 2 步 所有候选 sample 索引均未命中，降级走 compute', {
            candidateCount: candidates.length,
          });
        }

        // 3. 单飞：in-flight 复用（key=contentHash，AR1-019）
        const inflight = this.inflight.get(contentHash);
        if (inflight) {
          logger.info('[DbHtmlCache.getOrCompute] 第 3 步 in-flight 命中，复用 Promise', {
            contentHash,
          });
          return inflight;
        }
      } else {
        logger.info('[DbHtmlCache.getOrCompute] forceRegenerate=true，跳过缓存读，直接走 compute', {
          contentHash,
        });
      }

      // 4. 发起计算
      logger.info('[DbHtmlCache.getOrCompute] 第 3 步 发起 compute', {
        contentHash,
        candidateCount: candidates.length,
      });
      const promise = (async () => {
        try {
          const computeStartTs = Date.now();
          const result = await compute();
          logger.info('[DbHtmlCache.getOrCompute] compute 完成', {
            contentHash,
            success: result.success,
            validated: result.data?.validated,
            htmlLength: result.data?.html.length,
            elapsedMs: Date.now() - computeStartTs,
            errorCode: result.error?.code,
          });
          if (result.success && result.data) {
            // LRU 写（primaryKey 由 Orchestrator 调用 set 时单独处理，与 DualKeyHtmlCache 分工一致）
            this.contentCache.set(contentHash, result.data);
            // DB 权威写；写失败不阻断（NFR-007）
            try {
              await solutionDao.upsertSolution(contentHash, result.data);
              // sample 索引仅 validated=true 写入（FR-008 对齐；多候选全部写入）
              if (candidates.length > 0 && result.data.validated) {
                for (const fp of candidates) {
                  this.sampleCache.set(fp, contentHash);
                  await solutionDao.upsertSampleIndex(fp, contentHash);
                }
              } else if (candidates.length > 0 && !result.data.validated) {
                logger.warn('[DbHtmlCache.getOrCompute] 跳过 sample 索引写入（validated=false）', {
                  contentHash,
                  candidateCount: candidates.length,
                });
              }
            } catch (error) {
              logger.error('[DbHtmlCache.getOrCompute] compute 结果写库失败（不阻断主流程）', {
                contentHash,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return result;
        } finally {
          // 清理 in-flight（无论成功失败）
          this.inflight.delete(contentHash);
        }
      })();

      this.inflight.set(contentHash, promise);
      return promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DbHtmlCache.getOrCompute] 异常', { contentHash, message });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `getOrCompute 失败：${message}` },
      };
    }
  }

  buildPrimaryKey(platform: string, problemId: string): string {
    return buildPrimaryKey(platform, problemId);
  }

  /**
   * content 查询内部 helper：LRU → DAO（DAO 命中写 LRU）
   *
   * DAO 读失败返回 { success: false, error }（调用方视为 miss 降级，FR-014b）
   */
  private async lookupContent(contentHash: string): Promise<ServiceResult<Solution | null>> {
    const lruHit = this.contentCache.get(contentHash);
    if (lruHit) {
      return { success: true, data: lruHit };
    }
    const result = await solutionDao.getByContentHash(contentHash);
    if (!result.success) {
      logger.error('[DbHtmlCache.lookupContent] 读取失败，视为 miss', {
        contentHash,
        contentHashShort: contentHash.slice(0, 16),
        errorCode: result.error?.code,
      });
      return { success: false, error: result.error };
    }
    if (result.data) {
      this.contentCache.set(contentHash, result.data);
    }
    return result;
  }

  /**
   * DB 权威写：solutions + primary 索引（set 的 fire-and-forget 内部实现）
   *
   * primaryKey 按 gesp6:platform:{platform}:{problemId} 前缀解析；
   * 解析失败仅记日志跳过 primary 索引写入（solutions 行仍写，不影响 content 语义）
   */
  private async writeThrough(
    primaryKey: string | null,
    contentHash: string,
    solution: Solution,
  ): Promise<void> {
    await solutionDao.upsertSolution(contentHash, solution);
    if (primaryKey !== null) {
      const { platform, problemId } = parsePrimaryKey(primaryKey);
      if (platform && problemId) {
        await solutionDao.upsertPrimaryIndex(platform, problemId, contentHash);
      } else {
        logger.warn('[DbHtmlCache.writeThrough] 主 key 解析失败，跳过 primary 索引写入', {
          primaryKey,
          contentHash,
        });
      }
    }
  }
}
