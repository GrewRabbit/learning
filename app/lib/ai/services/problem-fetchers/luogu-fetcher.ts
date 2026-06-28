// app/lib/ai/services/problem-fetchers/luogu-fetcher.ts
// 洛谷抓取（架构 §5.1 + §7.1 + §8.2）
//
// 洛谷新架构（2026）：_contentOnly=1 API 已失效，改为 HTML 页面 + lentille-context JSON
// 反爬虫机制：首次请求返回 302 + set-cookie C3VK，需带 cookie 二次请求才返回真实内容
//
// 抓取流程：
//   1. 首次请求（redirect: manual）→ 从 set-cookie 提取 C3VK
//   2. 带 cookie 请求页面 HTML
//   3. cheerio 提取 <script id="lentille-context"> 的 JSON
//   4. 从 data.problem.content 提取题目字段，拼接 markdown

import * as cheerio from 'cheerio';
import type { ServiceResult } from '@/app/lib/ai/types';
import { BaseProblemFetcher, normalizeContent, type FetchResult } from './types';

/** 洛谷 lentille-context 数据结构（仅关心题目内容字段） */
interface LuoguLentilleData {
  data?: {
    problem?: {
      pid?: string;
      name?: string;
      content?: {
        name?: string;
        background?: string;
        description?: string;
        formatI?: string; // 输入格式
        formatO?: string; // 输出格式
        hint?: string;
      };
      samples?: Array<[string, string]>; // [input, output]
    };
  };
}

/** 洛谷抓取超时 */
const LUOGU_TIMEOUT_MS = 10_000;

/** 浏览器 UA（避免被反爬虫拦截） */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class LuoguFetcher extends BaseProblemFetcher {
  protected async doFetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>> {
    try {
      const url = `https://www.luogu.com.cn/problem/${encodeURIComponent(problemId)}`;

      // 第一步：获取 C3VK 反爬虫 cookie
      const cookie = await this.fetchAnticrawlerCookie(url);

      // 第二步：带 cookie 请求页面 HTML
      const html = await this.fetchPageHtml(url, cookie);

      // 第三步：从 HTML 提取 lentille-context JSON
      const data = this.extractLentilleData(html);
      const problem = data?.data?.problem;
      if (!problem) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: '洛谷页面缺少 lentille-context 题目数据',
          },
        };
      }

      // 拼接题目 markdown
      const content = this.buildProblemMarkdown(problem);
      if (!content) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: '洛谷题目内容为空',
          },
        };
      }

      return {
        success: true,
        data: { content: normalizeContent(content), platform, problemId },
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

  /**
   * 第一步：请求获取 C3VK 反爬虫 cookie
   * 洛谷对首次请求返回 302 + set-cookie C3VK，需带此 cookie 二次请求
   */
  private async fetchAnticrawlerCookie(url: string): Promise<string> {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'manual', // 不自动跟随重定向，以便读取 set-cookie
      signal: AbortSignal.timeout(LUOGU_TIMEOUT_MS),
    });
    // Headers.getSetCookie() 在 Node.js 18+ (undici) 可用，返回 string[]
    const setCookies = resp.headers.getSetCookie?.() ?? [];
    const c3vk = setCookies.find((c) => c.startsWith('C3VK='));
    return c3vk ? c3vk.split(';')[0] : '';
  }

  /**
   * 第二步：带 cookie 请求页面 HTML
   * @throws {Error} HTTP 非 2xx 时抛出
   */
  private async fetchPageHtml(url: string, cookie: string): Promise<string> {
    const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
    if (cookie) headers['Cookie'] = cookie;
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(LUOGU_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`洛谷返回 HTTP ${resp.status}`);
    }
    return resp.text();
  }

  /**
   * 第三步：从 HTML 提取 lentille-context JSON
   * 洛谷新架构将题目数据嵌入 <script id="lentille-context" type="application/json">
   */
  private extractLentilleData(html: string): LuoguLentilleData | null {
    const $ = cheerio.load(html);
    const jsonStr = $('#lentille-context').text();
    if (!jsonStr) return null;
    try {
      return JSON.parse(jsonStr) as LuoguLentilleData;
    } catch {
      return null;
    }
  }

  /**
   * 拼接题目 markdown（按八章节结构）
   * 字段映射（洛谷新架构）：
   *   problem.name → 标题
   *   problem.content.background → 题目背景
   *   problem.content.description → 题目描述
   *   problem.content.formatI → 输入格式
   *   problem.content.formatO → 输出格式
   *   problem.content.hint → 说明/提示
   *   problem.samples → 样例 [[input, output], ...]
   */
  private buildProblemMarkdown(
    problem: NonNullable<NonNullable<LuoguLentilleData['data']>['problem']>,
  ): string {
    const c = problem.content;
    const sections: string[] = [];
    if (problem.name) sections.push(`# ${problem.name}`);
    if (c?.background) sections.push(`## 题目背景\n\n${c.background}`);
    if (c?.description) sections.push(`## 题目描述\n\n${c.description}`);
    if (c?.formatI) sections.push(`## 输入格式\n\n${c.formatI}`);
    if (c?.formatO) sections.push(`## 输出格式\n\n${c.formatO}`);
    if (problem.samples && problem.samples.length > 0) {
      const samplesText = problem.samples
        .map(
          ([inp, out], i) =>
            `### 样例 ${i + 1}\n\n输入：\n\`\`\`\n${inp}\n\`\`\`\n\n输出：\n\`\`\`\n${out}\n\`\`\``,
        )
        .join('\n\n');
      sections.push(`## 样例\n\n${samplesText}`);
    }
    if (c?.hint) sections.push(`## 说明/提示\n\n${c.hint}`);
    return sections.join('\n\n');
  }
}

/** 单例导出 */
export const luoguFetcher = new LuoguFetcher();
