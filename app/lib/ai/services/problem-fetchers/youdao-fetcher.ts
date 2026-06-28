// app/lib/ai/services/problem-fetchers/youdao-fetcher.ts
// 有道小图灵 cheerio DOM 抓取（架构 §5.1 + §7.1 + §8.2）
// URL：https://oj.youdao.com/problem/{problemId}
// cheerio 解析 HTML DOM，提取题目内容

import * as cheerio from 'cheerio';
import type { ServiceResult } from '@/app/lib/ai/types';
import { BaseProblemFetcher, normalizeContent, type FetchResult } from './types';

/** 有道 DOM 抓取超时 */
const YOUDAO_TIMEOUT_MS = 10_000;
/** 题目内容长度上限（架构 §8.2：超过 100KB 截断并记日志） */
const CONTENT_MAX_BYTES = 100 * 1024;

export class YoudaoFetcher extends BaseProblemFetcher {
  protected async doFetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>> {
    try {
      const url = `https://oj.youdao.com/problem/${encodeURIComponent(problemId)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'gesp6-web-html/1.0' },
        signal: AbortSignal.timeout(YOUDAO_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: `有道小图灵返回 HTTP ${response.status}`,
          },
        };
      }

      const html = await response.text();

      // 长度截断（架构 §8.2 SSRF 防护：解析后的题目内容长度上限 100KB）
      const truncatedHtml =
        html.length > CONTENT_MAX_BYTES
          ? html.slice(0, CONTENT_MAX_BYTES)
          : html;
      if (html.length > CONTENT_MAX_BYTES) {
        console.warn(
          `[YoudaoFetcher] 题目 HTML 超过 100KB，已截断（problemId=${problemId}）`,
        );
      }

      const content = this.extractContent(truncatedHtml, problemId);
      if (!content) {
        return {
          success: false,
          error: {
            code: 'GESP6_PLATFORM_FETCH_FAILED',
            message: '有道小图灵 DOM 解析失败，未提取到题目内容',
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
          message: `有道小图灵抓取失败：${message}`,
        },
      };
    }
  }

  /**
   * 用 cheerio 从 HTML 提取题目内容
   * 注：具体选择器需根据有道小图灵页面实际结构调整，此处为通用实现
   */
  private extractContent(html: string, problemId: string): string {
    const $ = cheerio.load(html);

    // 移除脚本和样式
    $('script, style').remove();

    // 尝试常见题目内容选择器
    const selectors = [
      '.problem-content',
      '.problem-statement',
      '.problem-detail',
      '.question-content',
      'article',
      'main',
    ];

    for (const selector of selectors) {
      const $el = $(selector).first();
      if ($el.length > 0 && $el.text().trim().length > 100) {
        return $el.text();
      }
    }

    // 回退：提取 body 文本
    const bodyText = $('body').text();
    if (bodyText.trim().length > 100) {
      console.warn(
        `[YoudaoFetcher] 未匹配到题目专用选择器，回退到 body 文本（problemId=${problemId}）`,
      );
      return bodyText;
    }

    return '';
  }
}

/** 单例导出 */
export const youdaoFetcher = new YoudaoFetcher();
