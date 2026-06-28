// app/lib/ai/services/problem-fetchers/types.ts
// ProblemFetcher 接口 + 单飞基类 + 文本标准化（架构 §5.1 + §7.1 + §4.1）

import type { ServiceResult } from '@/app/lib/ai/types';

/** ProblemFetcher 返回的标准化题目内容 */
export type FetchResult = {
  content: string;     // 标准化后的题目内容（§4.1 文本标准化规则）
  platform: string;
  problemId: string;
};

/** ProblemFetcher 接口（架构 §5.1） */
export interface ProblemFetcher {
  fetch(platform: string, problemId: string): Promise<ServiceResult<FetchResult>>;
}

/**
 * 单飞基类（架构 §7.1 + §8.2：相同平台+题号并发复用同一抓取 Promise）
 *
 * 子类实现 doFetch，单飞逻辑由基类在 fetch 中处理。
 * in-flight Promise Map key 为 `${platform}:${problemId}`。
 */
export abstract class BaseProblemFetcher implements ProblemFetcher {
  private readonly inflight = new Map<string, Promise<ServiceResult<FetchResult>>>();

  async fetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>> {
    const key = `${platform}:${problemId}`;
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        return await this.doFetch(platform, problemId);
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /** 子类实现具体抓取逻辑（不含单飞） */
  protected abstract doFetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>>;
}

/**
 * 文本标准化（架构 §4.1 文本标准化规则）
 *
 * 规则：
 * 1. \u3000 全角空格替换为半角空格
 * 2. \s+（含空格/制表符/换行/回车）合并为单个空格
 * 3. 零宽字符（\u200B 等）保留原样
 * 4. trim 首尾空白
 *
 * 用途：
 * - platform 抓取后标准化
 * - text 输入直接标准化
 * - image 识别为文本后标准化
 * 保证"同题不同输入方式"命中同一内容 key（架构 §4.1）
 */
export function normalizeContent(raw: string): string {
  return raw
    .replace(/\u3000/g, ' ')       // 全角空格 → 半角
    .replace(/\s+/g, ' ')           // 多个空白合并为一个空格
    .trim();
}
