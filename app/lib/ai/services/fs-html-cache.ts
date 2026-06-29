// app/lib/ai/services/fs-html-cache.ts
// 文件系统持久化 HtmlCache 实现（架构 §5.1 接口）
//
// 目录结构：
//   {baseDir}/
//     primary/{platform}_{problemId}.json   → PrimaryIndex { contentHash, createdAt }
//     content/{hash前2位}/{hash}.html        → HTML 文件（LLM 原始输出）
//     content/{hash前2位}/{hash}.json        → SolutionMeta { validated, warning, createdAt }
//
// 设计要点：
// 1. 读操作同步（fs.readFileSync）—— 接口签名要求同步返回，单文件读取 1-5ms 可接受
// 2. 写操作 fire-and-forget 异步（不阻塞响应，符合架构 §4.4 写入失败仅记日志不阻断）
// 3. 文件不存在/损坏 → 返回 null（视为缓存未命中，触发 LLM 重新生成）
// 4. 单飞机制保留（in-flight Promise Map），与 DualKeyHtmlCache 一致

import { promises as fsAsync, existsSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';
import type { HtmlCache } from './html-cache';

/** 主 key 前缀（架构 §4.2，与 DualKeyHtmlCache 保持一致） */
const PRIMARY_KEY_PREFIX = 'gesp6:platform:';

/** FsHtmlCache 配置 */
export interface FsHtmlCacheOptions {
  /** 缓存根目录（如 /data/gesp6） */
  baseDir: string;
}

/** 主 key 索引文件结构 */
interface PrimaryIndex {
  contentHash: string;
  createdAt: string;
}

/** 内容 key 元数据文件结构 */
interface SolutionMeta {
  validated: boolean;
  warning?: string;
  createdAt: string;
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
  /** in-flight Promise Map（getOrCompute 单飞，与 DualKeyHtmlCache 一致） */
  private readonly inflight = new Map<string, Promise<ServiceResult<Solution>>>();

  constructor(options: FsHtmlCacheOptions) {
    this.baseDir = options.baseDir;
    this.primaryDir = path.join(this.baseDir, 'primary');
    this.contentDir = path.join(this.baseDir, 'content');
    // 启动时确保目录存在（同步，仅创建一次）
    this.ensureDirSync(this.baseDir);
    this.ensureDirSync(this.primaryDir);
    this.ensureDirSync(this.contentDir);
  }

  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null> {
    try {
      const indexPath = this.getPrimaryIndexPath(platform, problemId);
      const index = this.readJsonSync<PrimaryIndex>(indexPath);
      if (!index) {
        return { success: true, data: null };
      }
      // 通过 contentHash 查内容文件
      return this.getByContentKey(index.contentHash);
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
      const htmlPath = this.getContentHtmlPath(contentHash);
      const metaPath = this.getContentMetaPath(contentHash);
      if (!existsSync(htmlPath) || !existsSync(metaPath)) {
        return { success: true, data: null };
      }
      const html = readFileSync(htmlPath, 'utf-8');
      const meta = this.readJsonSync<SolutionMeta>(metaPath);
      if (!meta) {
        return { success: true, data: null };
      }
      const solution: Solution = {
        html,
        validated: meta.validated,
        warning: meta.warning,
        cached: true,
      };
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
    // fire-and-forget 异步写入（不阻塞响应，架构 §4.4：写入失败仅记日志不阻断）
    void this.writeAsync(primaryKey, contentHash, solution).catch((error) => {
      console.error('[FsHtmlCache.set] 写入失败', error);
    });
  }

  async getOrCompute(
    contentHash: string,
    compute: () => Promise<ServiceResult<Solution>>,
  ): Promise<ServiceResult<Solution>> {
    try {
      // 1. 查内容 key 缓存（命中时返回 cached: true，架构 §4.3）
      const cached = this.getByContentKey(contentHash);
      if (cached.success && cached.data) {
        return { success: true, data: { ...cached.data, cached: true } };
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
            // 计算成功，写入内容 key 文件（primaryKey 由 Orchestrator 在调用 set 时单独处理）
            this.writeContentFiles(contentHash, result.data);
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

  buildPrimaryKey(platform: string, problemId: string): string {
    return `${PRIMARY_KEY_PREFIX}${platform}:${problemId}`;
  }

  // ===== 私有辅助方法 =====

  private ensureDirSync(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** 主 key 索引文件路径：{baseDir}/primary/{platform}_{problemId}.json */
  private getPrimaryIndexPath(platform: string, problemId: string): string {
    return path.join(this.primaryDir, `${platform}_${problemId}.json`);
  }

  /** 内容 HTML 文件路径：{baseDir}/content/{hash前2位}/{hash}.html */
  private getContentHtmlPath(contentHash: string): string {
    const bucket = contentHash.slice(0, 2);
    return path.join(this.contentDir, bucket, `${contentHash}.html`);
  }

  /** 内容元数据文件路径：{baseDir}/content/{hash前2位}/{hash}.json */
  private getContentMetaPath(contentHash: string): string {
    const bucket = contentHash.slice(0, 2);
    return path.join(this.contentDir, bucket, `${contentHash}.json`);
  }

  /** 同步读取 JSON 文件（不存在/损坏返回 null，不抛错） */
  private readJsonSync<T>(filePath: string): T | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      // JSON 解析失败 → 视为缓存未命中（文件损坏，触发 LLM 重新生成）
      return null;
    }
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
      const { platform, problemId } = this.parsePrimaryKey(primaryKey);
      if (platform && problemId) {
        const indexPath = this.getPrimaryIndexPath(platform, problemId);
        const index: PrimaryIndex = {
          contentHash,
          createdAt: new Date().toISOString(),
        };
        await fsAsync.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      }
    }
  }

  /** 同步写内容文件（HTML + meta.json），先确保分桶目录存在 */
  private writeContentFiles(contentHash: string, solution: Solution): void {
    const htmlPath = this.getContentHtmlPath(contentHash);
    const metaPath = this.getContentMetaPath(contentHash);
    const bucketDir = path.dirname(htmlPath);
    this.ensureDirSync(bucketDir);
    fsAsync
      .writeFile(htmlPath, solution.html, 'utf-8')
      .catch((e) => console.error('[FsHtmlCache] HTML 写入失败', e));
    const meta: SolutionMeta = {
      validated: solution.validated,
      warning: solution.warning,
      createdAt: new Date().toISOString(),
    };
    fsAsync
      .writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      .catch((e) => console.error('[FsHtmlCache] meta 写入失败', e));
  }

  /** 解析主 key（gesp6:platform:{platform}:{problemId}） */
  private parsePrimaryKey(primaryKey: string): { platform: string; problemId: string } {
    // 主 key 格式：gesp6:platform:{platform}:{problemId}
    if (!primaryKey.startsWith(PRIMARY_KEY_PREFIX)) {
      return { platform: '', problemId: '' };
    }
    const rest = primaryKey.slice(PRIMARY_KEY_PREFIX.length);
    const sepIndex = rest.indexOf(':');
    if (sepIndex === -1) return { platform: '', problemId: '' };
    return {
      platform: rest.slice(0, sepIndex),
      problemId: rest.slice(sepIndex + 1),
    };
  }
}
