// app/lib/ai/services/problem-fetchers/index.ts
// ProblemFetcher 工厂（架构 §5.1 + §6 + §7.1）
// 按 platforms.config.ts 路由：LuoguFetcher（API）/ YoudaoFetcher（cheerio DOM）

import { PLATFORMS } from '@/app/lib/platforms.config';
import type { ServiceResult } from '@/app/lib/ai/types';
import { luoguFetcher } from './luogu-fetcher';
import { youdaoFetcher } from './youdao-fetcher';
import type { ProblemFetcher, FetchResult } from './types';

export type { ProblemFetcher, FetchResult } from './types';
export { normalizeContent } from './types';

/**
 * 按 platforms.config.ts 路由到对应 fetcher
 *
 * @param platform 平台名（如 'luogu' | 'youdao'）
 * @param problemId 题号（如 'P11447' | '7997'）
 * @returns ServiceResult<FetchResult>，平台未配置返回 GESP6_PLATFORM_FETCH_FAILED
 */
export async function fetchProblem(
  platform: string,
  problemId: string,
): Promise<ServiceResult<FetchResult>> {
  // 在 PLATFORMS 中查找匹配的配置
  const config = PLATFORMS.find((p) => p.name === platform);
  if (!config) {
    return {
      success: false,
      error: {
        code: 'GESP6_PLATFORM_FETCH_FAILED',
        message: `未配置的平台：${platform}`,
      },
    };
  }

  // 按 fetcherType 路由
  const fetcher: ProblemFetcher =
    config.fetcherType === 'luogu-api' ? luoguFetcher : youdaoFetcher;

  return fetcher.fetch(platform, problemId);
}

/**
 * 工厂函数：获取指定平台的 fetcher 单例
 */
export function getProblemFetcher(platform: string): ProblemFetcher | null {
  const config = PLATFORMS.find((p) => p.name === platform);
  if (!config) return null;
  return config.fetcherType === 'luogu-api' ? luoguFetcher : youdaoFetcher;
}
