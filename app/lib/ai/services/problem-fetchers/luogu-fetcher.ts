// app/lib/ai/services/problem-fetchers/luogu-fetcher.ts
// 洛谷 API 抓取（架构 §5.1 + §7.1）
// API：https://www.luogu.com.cn/problem/{problemId}?_contentOnly=1
// 返回 JSON，含题目 markdown 内容

import type { ServiceResult } from '@/app/lib/ai/types';
import { BaseProblemFetcher, normalizeContent, type FetchResult } from './types';

/** 洛谷 API 响应结构（仅关心题目内容字段） */
interface LuoguApiResponse {
  currentProblem?: {
    pid?: string;
    title?: string;
    background?: string;
    description?: string;
    inputFormat?: string;
    outputFormat?: string;
    samples?: Array<[string, string]>; // [input, output]
    hint?: string;
  };
  status?: number;
}

/** 洛谷 API 抓取超时 */
const LUOGU_TIMEOUT_MS = 10_000;

export class LuoguFetcher extends BaseProblemFetcher {
  protected async doFetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>> {
    try {
      const url = `https://www.luogu.com.cn/problem/${encodeURIComponent(problemId)}?_contentOnly=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'gesp6-web-html/1.0' },
        signal: AbortSignal.timeout(LUOGU_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: `洛谷 API 返回 HTTP ${response.status}`,
          },
        };
      }

      const data = (await response.json()) as LuoguApiResponse;
      const problem = data.currentProblem;
      if (!problem) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: '洛谷 API 响应缺少 currentProblem 字段',
          },
        };
      }

      // 拼接题目 markdown（按八章节结构）
      const sections: string[] = [];
      if (problem.title) sections.push(`# ${problem.title}`);
      if (problem.background) sections.push(`## 题目背景\n\n${problem.background}`);
      if (problem.description) sections.push(`## 题目描述\n\n${problem.description}`);
      if (problem.inputFormat) sections.push(`## 输入格式\n\n${problem.inputFormat}`);
      if (problem.outputFormat) sections.push(`## 输出格式\n\n${problem.outputFormat}`);
      if (problem.samples && problem.samples.length > 0) {
        const samplesText = problem.samples
          .map(([inp, out], i) => `### 样例 ${i + 1}\n\n输入：\n\`\`\`\n${inp}\n\`\`\`\n\n输出：\n\`\`\`\n${out}\n\`\`\``)
          .join('\n\n');
        sections.push(`## 样例\n\n${samplesText}`);
      }
      if (problem.hint) sections.push(`## 说明/提示\n\n${problem.hint}`);

      const content = normalizeContent(sections.join('\n\n'));

      return {
        success: true,
        data: { content, platform, problemId },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'GESP6_PLATFORM_FETCH_FAILED',
          message: `洛谷抓取失败：${message}`,
        },
      };
    }
  }
}

/** 单例导出 */
export const luoguFetcher = new LuoguFetcher();
