// app/lib/ai/services/fs-html-cache.ts
// 文件系统持久化 HtmlCache 实现（架构 §5.1 接口 + spec-sample-fingerprint-cache-v1.1 FR-009~FR-012）
//
// 目录结构：
//   {baseDir}/
//     primary/{platform}_{problemId}.json   → PrimaryIndex { contentHash, createdAt }
//     content/{hash前2位}/{hash}.html        → HTML 文件（LLM 原始输出）
//     content/{hash前2位}/{hash}.json        → SolutionMeta { validated, warning, createdAt }
//     sample/{fp前2位}/{fp}.json             → SampleIndex { contentHash, createdAt }（FR-009/FR-010）
//
// 设计要点：
// 1. 读操作同步（fs.readFileSync）—— 接口签名要求同步返回，单文件读取 1-5ms 可接受
// 2. 写操作 fire-and-forget 异步（不阻塞响应，符合架构 §4.4 写入失败仅记日志不阻断）
// 3. 文件不存在/损坏 → 返回 null（视为缓存未命中，触发 LLM 重新生成）
// 4. 单飞机制保留（in-flight Promise Map），与 DualKeyHtmlCache 一致
// 5. sample 索引失效（指向的 content 文件缺失）→ getOrCompute 降级走 compute，
//    compute 成功后 writeSampleIndex 覆盖旧失效索引文件实现自愈（FR-007）

import { promises as fsAsync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import type { HtmlCache } from './html-cache';
import type { SampleFingerprint } from './problem-fetchers/types';
// CR1-002 拆分：路径计算 / 索引结构 / 主 key 工具外移至 fs-paths
import {
  buildPrimaryKey,
  parsePrimaryKey,
  getCandidateFingerprints,
  getPrimaryIndexPath,
  getContentHtmlPath,
  getContentMetaPath,
  getSampleIndexPath,
  type PrimaryIndex,
  type SolutionMeta,
  type SampleIndex,
} from './fs-paths';
// CR1-002 拆分：JSON 文件 IO 工具外移至 fs-json-io
import { ensureDirSync, readJsonSync, writeJsonAsync } from './fs-json-io';

/** FsHtmlCache 配置 */
export interface FsHtmlCacheOptions {
  /** 缓存根目录（如 /data/gesp6） */
  baseDir: string;
}

/**
 * FsHtmlCache：文件系统持久化实现
 *
 * 适用场景：
 * - 调试期需要查看 LLM 实际生成的 HTML（直接 cat 文件即可）
 * - 跨进程持久化（Next.js 重启后缓存不丢失）
 * - 单机部署（多机部署需切换到 DbHtmlCache）
 *
 * 不适用场景：
 * - 高并发写入（同步读 + 串行写文件，QPS 上限约 100）
 * - 多机部署（文件系统不共享）
 */
export class FsHtmlCache implements HtmlCache {
  private readonly baseDir: string;
  private readonly primaryDir: string;
  private readonly contentDir: string;
  /** sample 索引目录（FR-009：{baseDir}/sample） */
  private readonly sampleDir: string;
  /** in-flight Promise Map（getOrCompute 单飞，与 DualKeyHtmlCache 一致） */
  private readonly inflight = new Map<string, Promise<ServiceResult<Solution>>>();

  constructor(options: FsHtmlCacheOptions) {
    this.baseDir = options.baseDir;
    this.primaryDir = path.join(this.baseDir, 'primary');
    this.contentDir = path.join(this.baseDir, 'content');
    this.sampleDir = path.join(this.baseDir, 'sample');
    // 启动时确保目录存在（同步，仅创建一次）
    ensureDirSync(this.baseDir);
    ensureDirSync(this.primaryDir);
    ensureDirSync(this.contentDir);
    ensureDirSync(this.sampleDir);
  }

  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null> {
    try {
      const indexPath = getPrimaryIndexPath(this.primaryDir, platform, problemId);
      const index = readJsonSync<PrimaryIndex>(indexPath);
      if (!index) {
        logger.info('[FsHtmlCache.getByPrimaryKey] primary 索引不存在', {
          platform,
          problemId,
          indexPath,
        });
        return { success: true, data: null };
      }
      logger.info('[FsHtmlCache.getByPrimaryKey] primary 索引命中', {
        platform,
        problemId,
        contentHash: index.contentHash,
        createdAt: index.createdAt,
      });
      // 通过 contentHash 查内容文件
      return this.getByContentKey(index.contentHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[FsHtmlCache.getByPrimaryKey] 读取异常', {
        platform,
        problemId,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `主 key 读取失败：${message}` },
      };
    }
  }

  getByContentKey(contentHash: string): ServiceResult<Solution | null> {
    try {
      const htmlPath = getContentHtmlPath(this.contentDir, contentHash);
      const metaPath = getContentMetaPath(this.contentDir, contentHash);
      if (!existsSync(htmlPath) || !existsSync(metaPath)) {
        logger.info('[FsHtmlCache.getByContentKey] content 文件缺失', {
          contentHash,
          contentHashShort: contentHash.slice(0, 16),
          htmlExists: existsSync(htmlPath),
          metaExists: existsSync(metaPath),
        });
        return { success: true, data: null };
      }
      const html = readFileSync(htmlPath, 'utf-8');
      const meta = readJsonSync<SolutionMeta>(metaPath);
      if (!meta) {
        logger.warn('[FsHtmlCache.getByContentKey] meta 文件损坏', {
          contentHash,
          contentHashShort: contentHash.slice(0, 16),
        });
        return { success: true, data: null };
      }
      const solution: Solution = {
        html,
        validated: meta.validated,
        warning: meta.warning,
        cached: true,
      };
      logger.info('[FsHtmlCache.getByContentKey] content 命中', {
        contentHash,
        contentHashShort: contentHash.slice(0, 16),
        validated: meta.validated,
        htmlLength: html.length,
        createdAt: meta.createdAt,
      });
      return { success: true, data: solution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[FsHtmlCache.getByContentKey] 读取异常', {
        contentHash,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `内容 key 读取失败：${message}` },
      };
    }
  }

  /**
   * 按 sample 指纹查询 contentHash（FR-011）
   *
   * 读取 sample 索引文件，返回 contentHash（不返回 Solution）。
   * 由调用方（getOrCompute）再用 contentHash 查 content 文件。
   * 文件不存在/损坏 → 返回 null（视为索引未建立）。
   */
  getBySampleFingerprint(
    sampleFp: string,
  ): ServiceResult<{ contentHash: string } | null> {
    try {
      const indexPath = getSampleIndexPath(this.sampleDir, sampleFp);
      const index = readJsonSync<SampleIndex>(indexPath);
      if (!index) {
        logger.info('[FsHtmlCache.getBySampleFingerprint] sample 索引不存在', {
          sampleFp,
          sampleFpShort: sampleFp.slice(0, 16),
          indexPath,
        });
        return { success: true, data: null };
      }
      logger.info('[FsHtmlCache.getBySampleFingerprint] sample 索引命中', {
        sampleFp,
        sampleFpShort: sampleFp.slice(0, 16),
        contentHash: index.contentHash,
        contentHashShort: index.contentHash.slice(0, 16),
        createdAt: index.createdAt,
      });
      return { success: true, data: { contentHash: index.contentHash } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[FsHtmlCache.getBySampleFingerprint] 读取异常', {
        sampleFp,
        message,
      });
      return {
        success: false,
        error: {
          code: 'GESP6_SAMPLE_INDEX_READ_FAILED',
          message: `sample 索引读取失败：${message}`,
        },
      };
    }
  }

  set(primaryKey: string | null, contentHash: string, solution: Solution): void {
    logger.info('[FsHtmlCache.set] 写入主 key + content', {
      primaryKey,
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      validated: solution.validated,
      htmlLength: solution.html.length,
    });
    // fire-and-forget 异步写入（不阻塞响应，架构 §4.4：写入失败仅记日志不阻断）
    void this.writeAsync(primaryKey, contentHash, solution).catch((error) => {
      logger.error('[FsHtmlCache.set] 写入失败', {
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
    logger.info('[FsHtmlCache.getOrCompute] 开始三步查询', {
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      sampleFpAll: sampleFp?.all ?? '',
      sampleFpAllShort: sampleFp?.all ? sampleFp.all.slice(0, 16) : '',
      sampleFpFirst: sampleFp?.first ?? '',
      sampleFpFirstShort: sampleFp?.first ? sampleFp.first.slice(0, 16) : '',
      hasSampleFp: candidates.length > 0,
      candidateCount: candidates.length,
      forceRegenerate: Boolean(forceRegenerate),
    });
    try {
      // forceRegenerate：跳过缓存读 + in-flight 复用，直接走 compute + 缓存写
      // 用于 /result 页"重新生成"场景，强制 LLM 重新生成并覆盖现有缓存文件
      if (!forceRegenerate) {
        // 1. 查内容 key 缓存（命中时返回 cached: true，架构 §4.3，FR-007 第 1 步）
        const cached = this.getByContentKey(contentHash);
        if (cached.success && cached.data) {
          logger.info('[FsHtmlCache.getOrCompute] 第 1 步 content 命中，直接返回', {
            contentHash,
            contentHashShort: contentHash.slice(0, 16),
            validated: cached.data.validated,
            elapsedMs: Date.now() - gocStartTs,
          });
          return { success: true, data: { ...cached.data, cached: true } };
        }

        // 2. miss 且 sampleFp 非空 → 遍历多候选指纹查询 sample 索引（FR-007 第 2 步，方案 B）
        //    顺序 [all, first]，任一命中即触发 Plan B 回写并返回
        if (candidates.length > 0) {
          let sampleHit = false;
          for (const fp of candidates) {
            const sampleResult = this.getBySampleFingerprint(fp);
            if (!(sampleResult.success && sampleResult.data)) {
              logger.info('[FsHtmlCache.getOrCompute] 第 2 步 sample 索引未命中', {
                sampleFp: fp,
                sampleFpShort: fp.slice(0, 16),
              });
              continue;
            }
            const contentHash2 = sampleResult.data.contentHash;
            logger.info('[FsHtmlCache.getOrCompute] 第 2 步 sample 索引命中，查 content2', {
              sampleFp: fp,
              sampleFpShort: fp.slice(0, 16),
              contentHash2,
              contentHash2Short: contentHash2.slice(0, 16),
            });
            const content2Result = this.getByContentKey(contentHash2);
            if (content2Result.success && content2Result.data) {
              // 命中：用当前 contentHash 在 content 文件层建立映射（方案 B 核心，FR-007 第 2 步）
              // 写一份当前 contentHash 对应的 content 文件，后续相同 contentHash 请求直接命中 content
              logger.info('[FsHtmlCache.getOrCompute] 第 2 步 content2 命中，Plan B 回写', {
                sampleFp: fp,
                contentHash,
                contentHash2,
                validated: content2Result.data.validated,
              });
              this.writeContentFiles(contentHash, content2Result.data);
              logger.info('[FsHtmlCache.getOrCompute] Plan B 返回（cached: true）', {
                contentHash,
                sampleFp: fp,
                elapsedMs: Date.now() - gocStartTs,
              });
              sampleHit = true;
              return { success: true, data: { ...content2Result.data, cached: true } };
            }
            // 未命中（content 文件缺失/损坏）：该候选索引失效，降级走 compute
            // compute 成功后 writeSampleIndex 会覆盖旧失效索引文件实现自愈（FR-007）
            logger.warn('[FsHtmlCache.getOrCompute] 第 2 步 content2 未命中（索引失效），降级继续查下一候选', {
              sampleFp: fp,
              contentHash2,
            });
          }
          if (!sampleHit) {
            logger.info('[FsHtmlCache.getOrCompute] 第 2 步 所有候选 sample 索引均未命中，降级走 compute', {
              candidateCount: candidates.length,
            });
          }
        }

        // 3. 单飞：检查 in-flight Map（保留现有单飞机制）
        const inflight = this.inflight.get(contentHash);
        if (inflight) {
          logger.info('[FsHtmlCache.getOrCompute] 第 3 步 in-flight 命中，复用 Promise', {
            contentHash,
          });
          return inflight;
        }
      } else {
        logger.info('[FsHtmlCache.getOrCompute] forceRegenerate=true，跳过缓存读，直接走 compute', {
          contentHash,
          sampleFpAll: sampleFp?.all ?? '',
          sampleFpFirst: sampleFp?.first ?? '',
        });
      }

      // 4. 发起计算（FR-007 第 3 步）
      logger.info('[FsHtmlCache.getOrCompute] 第 3 步 发起 compute', {
        contentHash,
        candidateCount: candidates.length,
      });
      const promise = (async () => {
        try {
          const computeStartTs = Date.now();
          const result = await compute();
          logger.info('[FsHtmlCache.getOrCompute] compute 完成', {
            contentHash,
            success: result.success,
            validated: result.data?.validated,
            hasWarning: Boolean(result.data?.warning),
            htmlLength: result.data?.html.length,
            elapsedMs: Date.now() - computeStartTs,
            errorCode: result.error?.code,
          });
          if (result.success && result.data) {
            // 计算成功，写入内容 key 文件（primaryKey 由 Orchestrator 在调用 set 时单独处理）
            this.writeContentFiles(contentHash, result.data);
            // 写入 sample 索引（仅 validated=true，FR-008；多候选全部写入，方案 B）
            if (candidates.length > 0 && result.data.validated) {
              for (const fp of candidates) {
                this.writeSampleIndex(fp, contentHash);
              }
            } else if (candidates.length > 0 && !result.data.validated) {
              logger.warn('[FsHtmlCache.getOrCompute] 跳过 sample 索引写入（validated=false）', {
                contentHash,
                sampleFpAll: sampleFp?.all ?? '',
                sampleFpFirst: sampleFp?.first ?? '',
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
      logger.error('[FsHtmlCache.getOrCompute] 异常', {
        contentHash,
        sampleFpAll: sampleFp?.all ?? '',
        sampleFpFirst: sampleFp?.first ?? '',
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `getOrCompute 失败：${message}` },
      };
    }
  }

  buildPrimaryKey(platform: string, problemId: string): string {
    return buildPrimaryKey(platform, problemId);
  }

  /** 异步写入主 key 索引 + 内容文件（fire-and-forget） */
  private async writeAsync(
    primaryKey: string | null,
    contentHash: string,
    solution: Solution,
  ): Promise<void> {
    // 1. 写内容文件
    this.writeContentFiles(contentHash, solution);

    // 2. 写主 key 索引（仅 platform 输入有 primaryKey）
    if (primaryKey !== null) {
      const { platform, problemId } = parsePrimaryKey(primaryKey);
      if (platform && problemId) {
        const indexPath = getPrimaryIndexPath(this.primaryDir, platform, problemId);
        const index: PrimaryIndex = {
          contentHash,
          createdAt: new Date().toISOString(),
        };
        await writeJsonAsync(indexPath, index);
      }
    }
  }

  /** 同步写内容文件（HTML + meta.json），先确保分桶目录存在 */
  private writeContentFiles(contentHash: string, solution: Solution): void {
    const htmlPath = getContentHtmlPath(this.contentDir, contentHash);
    const metaPath = getContentMetaPath(this.contentDir, contentHash);
    const bucketDir = path.dirname(htmlPath);
    ensureDirSync(bucketDir);
    logger.info('[FsHtmlCache.writeContentFiles] 写入 content 文件', {
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      htmlPath,
      metaPath,
      validated: solution.validated,
      htmlLength: solution.html.length,
    });
    fsAsync
      .writeFile(htmlPath, solution.html, 'utf-8')
      .catch((e) => logger.error('[FsHtmlCache.writeContentFiles] HTML 写入失败', {
        contentHash,
        htmlPath,
        message: e instanceof Error ? e.message : String(e),
      }));
    const meta: SolutionMeta = {
      validated: solution.validated,
      warning: solution.warning,
      createdAt: new Date().toISOString(),
    };
    writeJsonAsync(metaPath, meta)
      .catch((e) => logger.error('[FsHtmlCache.writeContentFiles] meta 写入失败', {
        contentHash,
        metaPath,
        message: e instanceof Error ? e.message : String(e),
      }));
  }

  /**
   * 异步写 sample 索引文件（fire-and-forget，FR-012）
   *
   * 由 getOrCompute 内部在 compute 成功 + validated=true 时调用（FR-008 写入位置）。
   * 写入失败仅记日志，不阻断主流程（架构 §4.4）。
   * sample 索引失效时（指向的 content 文件缺失），compute 成功后本方法会覆盖旧失效索引文件实现自愈（FR-007）。
   */
  private writeSampleIndex(sampleFp: string, contentHash: string): void {
    const indexPath = getSampleIndexPath(this.sampleDir, sampleFp);
    const bucketDir = path.dirname(indexPath);
    ensureDirSync(bucketDir);
    const index: SampleIndex = {
      contentHash,
      createdAt: new Date().toISOString(),
    };
    logger.info('[FsHtmlCache.writeSampleIndex] 写入 sample 索引（FR-008 validated=true 触发）', {
      sampleFp,
      sampleFpShort: sampleFp.slice(0, 16),
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      indexPath,
    });
    writeJsonAsync(indexPath, index)
      .then(() => {
        logger.info('[FsHtmlCache.writeSampleIndex] sample 索引写入成功', {
          sampleFp,
          contentHash,
          indexPath,
        });
      })
      .catch((e) => logger.error('[FsHtmlCache.writeSampleIndex] sample 索引写入失败', {
        sampleFp,
        contentHash,
        indexPath,
        message: e instanceof Error ? e.message : String(e),
      }));
  }
}
