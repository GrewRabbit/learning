// app/lib/ai/services/html-cache.ts
// HtmlCache 实现（架构 §5.1 接口 + §7.1 双 key + getOrCompute 单飞）
// 双 key：主 key gesp6:platform:{p}:{id} + 内容 key gesp6:content:{sha256}
// 单飞：getOrCompute 内部 in-flight Promise Map，相同 contentHash 并发复用同一 Promise

import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import { FsHtmlCache } from './fs-html-cache';

/** HtmlCache 接口（架构 §5.1 + spec-sample-fingerprint-cache-v1.1 FR-005~FR-008） */
export interface HtmlCache {
  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null>;
  getByContentKey(contentHash: string): ServiceResult<Solution | null>;
  /**
   * 按 sample 指纹查询 contentHash（FR-005）
   *
   * 返回 sample 指纹指向的 contentHash（不返回 Solution，由调用方再用 contentHash 查 content）。
   * 未命中返回 null；读失败返回 success=false。
   */
  getBySampleFingerprint(
    sampleFp: string,
  ): ServiceResult<{ contentHash: string } | null>;
  set(primaryKey: string | null, contentHash: string, solution: Solution): void;
  /**
   * getOrCompute（架构 §5.1 + FR-006/FR-007/FR-008）
   *
   * 查询顺序（FR-007）：
   * 1. 查 contentCache[contentHash] → 命中返回（cached: true）
   * 2. miss 且 sampleFp 非空 → 查 sampleCache[sampleFp]：
   *    - 命中拿到 contentHash2 → 查 contentCache[contentHash2]：
   *      - 命中：用当前 contentHash 在 contentCache 建立映射（方案 B），返回（cached: true）
   *      - 未命中（sample 索引失效）：视为失效，降级走 compute
   *    - miss → 走 compute
   * 3. 调 compute → 写 contentCache[contentHash] +（若 sampleFp 非空且 validated=true）写 sampleCache[sampleFp]=contentHash
   *
   * @param sampleFp 可选 sample 指纹（FR-006），空字符串/undefined 时跳过 sample 查询路径
   * @param forceRegenerate 可选，true 时跳过步骤 1-2（缓存读 + in-flight 复用），直接走 compute + 缓存写
   *        用于 /result 页"重新生成"场景：强制 LLM 重新生成并覆盖现有缓存映射
   */
  getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
    sampleFp?: string,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>>;
  /** 构造主 key（架构 §4.2：gesp6:platform:{platform}:{problemId}） */
  buildPrimaryKey(platform: string, problemId: string): string;
}

/** 主 key 前缀（架构 §4.2） */
const PRIMARY_KEY_PREFIX = 'gesp6:platform:';
/** 内容 key 前缀（架构 §4.2） */
const CONTENT_KEY_PREFIX = 'gesp6:content:';

/**
 * HtmlCache 双 key 实现（架构 §7.1）
 *
 * 内部维护两个 LRUCache 实例：
 * - primaryCache: 主 key → Solution（仅 platform 输入有主 key）
 * - contentCache: 内容 key → Solution（所有输入方式共享）
 *
 * set 时：
 * - primaryKey 非 null：同时写入 primaryCache + contentCache
 * - primaryKey 为 null（text/image 输入）：仅写 contentCache
 *
 * 单飞（架构 §5.1 注释）：
 * - getOrCompute 内部维护 in-flight Promise Map（key 为 contentHash）
 * - 相同 contentHash 的并发请求复用同一 Promise
 * - getByPrimaryKey/getByContentKey 为纯读操作，不维护 in-flight Map
 */
export class DualKeyHtmlCache implements HtmlCache {
  private readonly primaryCache: LRUCache<string, Solution>;
  private readonly contentCache: LRUCache<string, Solution>;
  /**
   * sample 指纹 → contentHash 索引（FR-013）
   *
   * 与现有 LRU 配置一致：max=100, ttl=1h。
   * value 为裸 contentHash（不含 gesp6:content: 前缀），使用时需经 buildContentKey 拼接。
   */
  private readonly sampleCache: LRUCache<string, string>;
  /** in-flight Promise Map（getOrCompute 单飞） */
  private readonly inflight = new Map<string, Promise<ServiceResult<Solution>>>();

  constructor() {
    this.primaryCache = new LRUCache<string, Solution>({
      max: 100,
      ttl: 60 * 60 * 1000, // 1 小时（架构 §8.1）
    });
    this.contentCache = new LRUCache<string, Solution>({
      max: 100,
      ttl: 60 * 60 * 1000,
    });
    this.sampleCache = new LRUCache<string, string>({
      max: 100,
      ttl: 60 * 60 * 1000, // FR-013：与现有 LRU 配置一致
    });
  }

  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null> {
    try {
      const key = this.buildPrimaryKey(platform, problemId);
      const solution = this.primaryCache.get(key) ?? null;
      logger.info('[DualKeyHtmlCache.getByPrimaryKey] 查询', {
        platform,
        problemId,
        primaryKey: key,
        hit: solution !== null,
        validated: solution?.validated,
      });
      return { success: true, data: solution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DualKeyHtmlCache.getByPrimaryKey] 读取异常', {
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
      const key = this.buildContentKey(contentHash);
      const solution = this.contentCache.get(key) ?? null;
      logger.info('[DualKeyHtmlCache.getByContentKey] 查询', {
        contentHash,
        contentHashShort: contentHash.slice(0, 16),
        hit: solution !== null,
        validated: solution?.validated,
      });
      return { success: true, data: solution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DualKeyHtmlCache.getByContentKey] 读取异常', {
        contentHash,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `内容 key 读取失败：${message}` },
      };
    }
  }

  getBySampleFingerprint(
    sampleFp: string,
  ): ServiceResult<{ contentHash: string } | null> {
    try {
      const contentHash = this.sampleCache.get(sampleFp) ?? null;
      if (contentHash === null) {
        logger.info('[DualKeyHtmlCache.getBySampleFingerprint] 未命中', {
          sampleFp,
          sampleFpShort: sampleFp.slice(0, 16),
        });
        return { success: true, data: null };
      }
      logger.info('[DualKeyHtmlCache.getBySampleFingerprint] 命中', {
        sampleFp,
        sampleFpShort: sampleFp.slice(0, 16),
        contentHash,
        contentHashShort: contentHash.slice(0, 16),
      });
      return { success: true, data: { contentHash } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[DualKeyHtmlCache.getBySampleFingerprint] 读取异常', {
        sampleFp,
        message,
      });
      return {
        success: false,
        error: {
          code: 'GESP6_SAMPLE_INDEX_READ_FAILED',
          message: `sample 指纹读取失败：${message}`,
        },
      };
    }
  }

  set(primaryKey: string | null, contentHash: string, solution: Solution): void {
    // 写操作返回 void（架构 §4.4：缓存写入失败仅记日志不阻断）
    logger.info('[DualKeyHtmlCache.set] 写入', {
      primaryKey,
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      validated: solution.validated,
      htmlLength: solution.html.length,
    });
    try {
      const contentKey = this.buildContentKey(contentHash);
      this.contentCache.set(contentKey, solution);
      if (primaryKey !== null) {
        // primaryKey 参数已是完整主 key（由 Orchestrator 调用 buildPrimaryKey 拼接后传入）
        // 此处直接使用，不再拼接
        this.primaryCache.set(primaryKey, solution);
      }
    } catch (error) {
      // 仅记日志，不抛出（架构 §4.4）
      logger.error('[DualKeyHtmlCache.set] 写入失败', {
        primaryKey,
        contentHash,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
    sampleFp?: string,
    forceRegenerate?: boolean,
  ): Promise<ServiceResult<Solution>> {
    const gocStartTs = Date.now();
    logger.info('[DualKeyHtmlCache.getOrCompute] 开始三步查询', {
      contentHash,
      contentHashShort: contentHash.slice(0, 16),
      sampleFp: sampleFp ?? '',
      sampleFpShort: sampleFp ? sampleFp.slice(0, 16) : '',
      hasSampleFp: Boolean(sampleFp),
      forceRegenerate: Boolean(forceRegenerate),
    });
    try {
      const contentKey = this.buildContentKey(contentHash);

      // forceRegenerate：跳过缓存读 + in-flight 复用，直接走 compute + 缓存写
      // 用于 /result 页"重新生成"场景，强制 LLM 重新生成并覆盖现有缓存
      if (!forceRegenerate) {
        // 1. 查内容 key 缓存（命中时返回 cached: true，架构 §4.3，FR-007 第 1 步）
        const cached = this.contentCache.get(contentKey);
        if (cached) {
          logger.info('[DualKeyHtmlCache.getOrCompute] 第 1 步 content 命中，直接返回', {
            contentHash,
            validated: cached.validated,
            elapsedMs: Date.now() - gocStartTs,
          });
          return { success: true, data: { ...cached, cached: true } };
        }

        // 2. miss 且 sampleFp 非空 → 查 sampleCache（FR-007 第 2 步，方案 B）
        if (sampleFp) {
          const contentHash2 = this.sampleCache.get(sampleFp);
          if (contentHash2) {
            logger.info('[DualKeyHtmlCache.getOrCompute] 第 2 步 sample 索引命中，查 content2', {
              sampleFp,
              contentHash2,
              contentHash2Short: contentHash2.slice(0, 16),
            });
            const contentKey2 = this.buildContentKey(contentHash2);
            const solution = this.contentCache.get(contentKey2);
            if (solution) {
              // 命中：用当前 contentHash 在 contentCache 建立映射（方案 B 核心，FR-007 第 2 步）
              // 后续相同 contentHash 请求直接命中 contentCache，避免重复走 sample 查询路径
              logger.info('[DualKeyHtmlCache.getOrCompute] 第 2 步 content2 命中，Plan B 回写', {
                sampleFp,
                contentHash,
                contentHash2,
                validated: solution.validated,
              });
              this.contentCache.set(contentKey, solution);
              logger.info('[DualKeyHtmlCache.getOrCompute] Plan B 返回（cached: true）', {
                contentHash,
                sampleFp,
                elapsedMs: Date.now() - gocStartTs,
              });
              return { success: true, data: { ...solution, cached: true } };
            }
            // 未命中（content 文件缺失/损坏）：sample 索引失效，清理并降级走 compute（FR-007 自愈）
            logger.warn('[DualKeyHtmlCache.getOrCompute] 第 2 步 content2 未命中（索引失效），降级走 compute', {
              sampleFp,
              contentHash2,
            });
            this.sampleCache.delete(sampleFp);
          } else {
            logger.info('[DualKeyHtmlCache.getOrCompute] 第 2 步 sample 索引未命中', {
              sampleFp,
            });
          }
        }

        // 3. 单飞：检查 in-flight Map（保留现有单飞机制）
        const inflight = this.inflight.get(contentHash);
        if (inflight) {
          logger.info('[DualKeyHtmlCache.getOrCompute] 第 3 步 in-flight 命中，复用 Promise', {
            contentHash,
          });
          return inflight;
        }
      } else {
        logger.info('[DualKeyHtmlCache.getOrCompute] forceRegenerate=true，跳过缓存读，直接走 compute', {
          contentHash,
          sampleFp: sampleFp ?? '',
        });
      }

      // 4. 发起计算（FR-007 第 3 步）
      logger.info('[DualKeyHtmlCache.getOrCompute] 第 3 步 发起 compute', {
        contentHash,
        sampleFp: sampleFp ?? '',
      });
      const promise = (async () => {
        try {
          const computeStartTs = Date.now();
          const result = await compute();
          logger.info('[DualKeyHtmlCache.getOrCompute] compute 完成', {
            contentHash,
            success: result.success,
            validated: result.data?.validated,
            hasWarning: Boolean(result.data?.warning),
            htmlLength: result.data?.html.length,
            elapsedMs: Date.now() - computeStartTs,
            errorCode: result.error?.code,
          });
          if (result.success && result.data) {
            // 计算成功，写入内容 key（primaryKey 由 Orchestrator 在调用 set 时单独处理）
            this.contentCache.set(contentKey, result.data);
            // 写入 sample 索引（仅 validated=true，FR-008；sample 索引由 getOrCompute 内部写入）
            if (sampleFp && result.data.validated) {
              this.sampleCache.set(sampleFp, contentHash);
              logger.info('[DualKeyHtmlCache.getOrCompute] sample 索引已写入', {
                sampleFp,
                contentHash,
              });
            } else if (sampleFp && !result.data.validated) {
              logger.warn('[DualKeyHtmlCache.getOrCompute] 跳过 sample 索引写入（validated=false）', {
                contentHash,
                sampleFp,
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
      logger.error('[DualKeyHtmlCache.getOrCompute] 异常', {
        contentHash,
        sampleFp,
        message,
      });
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `getOrCompute 失败：${message}` },
      };
    }
  }

  /**
   * 构造主 key（架构 §4.2：gesp6:platform:{platform}:{problemId}）
   * 供 Orchestrator 调用 set 时拼接 primaryKey 参数
   */
  buildPrimaryKey(platform: string, problemId: string): string {
    return `${PRIMARY_KEY_PREFIX}${platform}:${problemId}`;
  }

  /**
   * 构造内容 key（架构 §4.2：gesp6:content:{sha256}）
   */
  private buildContentKey(contentHash: string): string {
    return `${CONTENT_KEY_PREFIX}${contentHash}`;
  }
}

/**
 * 单例导出（api-conventions.md）
 *
 * 通过环境变量切换实现：
 * - `GESP6_CACHE_DRIVER=fs`：启用文件系统持久化（FsHtmlCache），LLM 生成的 HTML 落盘到 `GESP6_CACHE_FS_DIR`
 * - 其他/未设置：默认内存 LRU 缓存（DualKeyHtmlCache），重启即丢失
 *
 * FsHtmlCache 适用场景：调试期查看 LLM 实际输出 HTML、跨进程持久化
 * DualKeyHtmlCache 适用场景：开发期快速迭代、单元测试
 */
export const htmlCache: HtmlCache = (() => {
  const driver = process.env.GESP6_CACHE_DRIVER ?? 'memory';
  if (driver === 'fs') {
    // 默认路径为项目内 /var/learning/data/gesp6（/data 在容器内常为只读）
    // 可通过 GESP6_CACHE_FS_DIR 覆盖
    const baseDir = process.env.GESP6_CACHE_FS_DIR ?? '/var/learning/data/gesp6';
    return new FsHtmlCache({ baseDir });
  }
  return new DualKeyHtmlCache();
})();

/**
 * 计算标准化题目内容的 SHA-256 hash（架构 §4.2）
 * 供 Orchestrator 调用，作为 contentHash 参数传入 HtmlCache 方法
 */
export function computeContentHash(normalizedContent: string): string {
  return createHash('sha256').update(normalizedContent, 'utf-8').digest('hex');
}
