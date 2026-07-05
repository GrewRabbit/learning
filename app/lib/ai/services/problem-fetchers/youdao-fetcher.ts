// app/lib/ai/services/problem-fetchers/youdao-fetcher.ts
// 有道小图灵 cheerio DOM 抓取（架构 §5.1 + §7.1 + §8.2）
// URL：https://oj.youdao.com/problem/{problemId}
// cheerio 解析 HTML DOM，提取题目内容

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ServiceResult } from '@/app/lib/ai/types';
import { BaseProblemFetcher, type FetchResult } from './types';

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

      // 返回原始 markdown，由 orchestrator 统一 normalize
      // 保留换行结构让 extractSampleFingerprint 能识别"## 样例"章节标题（架构 §4.2）
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
          message: `有道小图灵抓取失败：${message}`,
        },
      };
    }
  }

  /**
   * 用 cheerio 从 HTML 提取题目内容
   *
   * 优先用有道小图灵专用选择器（CSS Modules 类名带 hash 后缀），
   * 回退到通用选择器，最终回退到 body 文本。
   */
  private extractContent(html: string, problemId: string): string {
    const $ = cheerio.load(html);

    // 移除脚本和样式
    $('script, style').remove();

    // 1. 有道小图灵专用选择器（CSS Modules 类名形如 QuestionDetail_section__{hash}）
    const youdaoContent = this.extractYoudaoContent($);
    if (youdaoContent && youdaoContent.trim().length > 50) {
      return youdaoContent;
    }

    // 2. 通用选择器回退
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

    // 3. 最终回退：body 文本
    const bodyText = $('body').text();
    if (bodyText.trim().length > 100) {
      console.warn(
        `[YoudaoFetcher] 未匹配到题目专用选择器，回退到 body 文本（problemId=${problemId}）`,
      );
      return bodyText;
    }

    return '';
  }

  /**
   * 有道小图灵专用提取（CSS Modules 类名带 hash 后缀）
   *
   * DOM 结构：每个 section 含 h3 标题 + 可选内容
   * - 题目描述/输入描述/输出描述/提示：SSR 内容可能为空（客户端 JS 渲染）
   * - 样例：含 QuestionDetail_examples 子结构（输入/输出 display）
   *
   * 样例格式化为 markdown 代码块，确保 extractSampleFingerprint 能提取 sampleFp。
   * 输入为"无"也是有效值（有些题目只有输出），不跳过。
   */
  private extractYoudaoContent($: cheerio.CheerioAPI): string {
    const $sections = $('section[class*="QuestionDetail_section"]');
    if ($sections.length === 0) {
      return '';
    }

    const parts: string[] = [];

    $sections.each((_, section: AnyNode) => {
      const $section = $(section);
      const title = $section
        .find('h3[class*="QuestionDetail_title"]')
        .first()
        .text()
        .trim();

      if (!title) return;

      // 样例 section：提取 examples 并格式化为代码块
      if (title.includes('样例')) {
        const sampleMarkdown = this.extractYoudaoExamples($, $section);
        if (sampleMarkdown) {
          parts.push(`## ${title}\n\n${sampleMarkdown}`);
        } else {
          parts.push(`## ${title}`);
        }
        return;
      }

      // 其他 section：提取文本内容（移除标题后）
      const content = $section
        .clone()
        .children('h3')
        .remove()
        .end()
        .text()
        .trim();
      if (content) {
        parts.push(`## ${title}\n\n${content}`);
      } else {
        // 内容为空（客户端 JS 渲染），只保留标题
        parts.push(`## ${title}`);
      }
    });

    return parts.join('\n\n');
  }

  /**
   * 提取有道小图灵样例并格式化为 markdown 代码块
   *
   * DOM 结构：
   * <div class="QuestionDetail_examples">
   *   <div class="QuestionDetail_examples_header"><span>输入</span><span>复制</span></div>
   *   <div class="QuestionDetail_examples_display">{输入内容}</div>
   *   <div class="QuestionDetail_examples_header"><span>输出</span></div>
   *   <div class="QuestionDetail_examples_display">{输出内容}</div>
   * </div>
   *
   * 注意：输入为"无"也是有效值（有些题目只有输出），不跳过。
   * 成对提取 header[0]+display[0]、header[1]+display[1]...
   */
  private extractYoudaoExamples(
    $: cheerio.CheerioAPI,
    $section: cheerio.Cheerio<AnyNode>,
  ): string {
    const $examples = $section
      .find('div[class*="QuestionDetail_examples"]')
      .first();
    if ($examples.length === 0) return '';

    const $headers = $examples.find(
      'div[class*="QuestionDetail_examples_header"]',
    );
    const $displays = $examples.find(
      'div[class*="QuestionDetail_examples_display"]',
    );

    const samples: string[] = [];
    const pairCount = Math.min($headers.length, $displays.length);

    for (let i = 0; i < pairCount; i++) {
      // header 内首个 span 为"输入"/"输出"标签，"复制"按钮在第二个 span
      const label = $headers.eq(i).find('span').first().text().trim();
      const value = $displays.eq(i).text().trim();
      if (label) {
        samples.push(`### ${label}\n\n\`\`\`\n${value}\n\`\`\``);
      }
    }

    return samples.join('\n\n');
  }
}

/** 单例导出 */
export const youdaoFetcher = new YoudaoFetcher();
