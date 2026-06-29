// app/lib/ai/services/html-cache.ts
// HtmlCache 实现（架构 §5.1 接口 + §7.1 双 key + getOrCompute 单飞）
// 双 key：主 key gesp6:platform:{p}:{id} + 内容 key gesp6:content:{sha256}
// 单飞：getOrCompute 内部 in-flight Promise Map，相同 contentHash 并发复用同一 Promise

import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import { FsHtmlCache } from './fs-html-cache';

/** HtmlCache 接口（架构 §5.1） */
export interface HtmlCache {
  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null>;
  getByContentKey(contentHash: string): ServiceResult<Solution | null>;
  set(primaryKey: string | null, contentHash: string, solution: Solution): void;
  getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
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
  }

  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null> {
    try {
      const key = this.buildPrimaryKey(platform, problemId);
      const solution = this.primaryCache.get(key) ?? null;
      return { success: true, data: solution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      return { success: true, data: solution };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: { code: 'GESP6_INTERNAL_ERROR', message: `内容 key 读取失败：${message}` },
      };
    }
  }

  set(primaryKey: string | null, contentHash: string, solution: Solution): void {
    // 写操作返回 void（架构 §4.4：缓存写入失败仅记日志不阻断）
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
      console.error('[HtmlCache.set] 写入失败', error);
    }
  }

  async getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
  ): Promise<ServiceResult<Solution>> {
    try {
      // 1. 查内容 key 缓存（命中时返回 cached: true，架构 §4.3）
      const contentKey = this.buildContentKey(contentHash);
      const cached = this.contentCache.get(contentKey);
      if (cached) {
        return { success: true, data: { ...cached, cached: true } };
      }

      // 2. 单飞：检查 in-flight Map
      const inflight = this.inflight.get(contentHash);
      if (inflight) {
        return inflight;
      }

      // 3. 发起计算
      const promise = (async () => {
        try {
          const result = await compute();
          if (result.success && result.data) {
            // 计算成功，写入内容 key（primaryKey 由 Orchestrator 在调用 set 时单独处理）
            this.contentCache.set(contentKey, result.data);
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
