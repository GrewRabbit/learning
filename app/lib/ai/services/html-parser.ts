// app/lib/ai/services/html-parser.ts
// HtmlParser 实现（架构 §5.1 接口 + §4.2 解析规则）
// 解析 LLM 输出的 <<<META>>>{...}<<<HTML>>>... 双段格式
// 失败返回 GESP6_LLM_FORMAT_ERROR（完整链路见 §4.4）
//
// 实现说明（架构 §4.2 状态机规则的简化）：
//   本架构 §1.2 决策"不流式"，LLM 输出为完整字符串，标记不会跨 chunk 分片。
//   因此采用 indexOf 方案替代流式状态机缓冲区，核心规则仍符合 §4.2：
//   - 标记缺失（无 META）→ 解析失败
//   - 标记缺失（无 HTML）→ 降级返回空 HTML
//   - 标记重复：indexOf 返回首次匹配位置（仅识别首次）
//   - 标记乱序：在 META 之后找 HTML，html 状态后若再出现 <<<META>>> 视为 HTML 内容

import type { ServiceResult, Meta } from '@/app/lib/ai/types';

/** HtmlParser 接口（架构 §5.1） */
export interface HtmlParser {
  parseMetaAndHtml(raw: string): ServiceResult<{ meta: Meta; html: string }>;
}

/** 标记常量 */
const META_MARKER = '<<<META>>>';
const HTML_MARKER = '<<<HTML>>>';
/** 解析失败错误码（架构 §5.4） */
const FORMAT_ERROR_CODE = 'GESP6_LLM_FORMAT_ERROR';

/**
 * HtmlParser 实现
 */
export class StateMachineHtmlParser implements HtmlParser {
  parseMetaAndHtml(raw: string): ServiceResult<{ meta: Meta; html: string }> {
    // 找首个 <<<META>>> 标记（标记重复仅识别首次）
    const metaIdx = raw.indexOf(META_MARKER);
    if (metaIdx === -1) {
      // 无 META 标记 → 解析失败（架构 §4.2：触发 §4.4 格式重试）
      return {
        success: false,
        error: {
          code: FORMAT_ERROR_CODE,
          message: 'LLM 输出缺少 <<<META>>> 标记，格式不合规',
        },
      };
    }

    const afterMeta = raw.slice(metaIdx + META_MARKER.length);

    // 在 META 之后找首个 <<<HTML>>> 标记
    const htmlIdx = afterMeta.indexOf(HTML_MARKER);
    const metaRaw = htmlIdx === -1 ? afterMeta : afterMeta.slice(0, htmlIdx);
    const htmlRaw = htmlIdx === -1 ? '' : afterMeta.slice(htmlIdx + HTML_MARKER.length);

    // 解析 META JSON
    const meta = this.parseMeta(metaRaw);
    if (meta === null) {
      return {
        success: false,
        error: {
          code: FORMAT_ERROR_CODE,
          message: 'LLM 输出 <<<META>>> 内容非合法 JSON 或缺少 code/samples 字段',
        },
      };
    }

    // htmlIdx === -1 时 htmlRaw 为空字符串（架构 §4.2：HTML 缺失降级返回空 HTML）
    return { success: true, data: { meta, html: htmlRaw } };
  }

  /**
   * 解析 META JSON（架构 §5.2 Meta 类型）
   * @returns Meta 或 null（解析失败）
   */
  private parseMeta(metaRaw: string): Meta | null {
    const trimmed = metaRaw.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (typeof obj !== 'object' || obj === null) {
        return null;
      }
      const meta = obj as Record<string, unknown>;
      if (typeof meta.code !== 'string') {
        return null;
      }
      if (!Array.isArray(meta.samples)) {
        return null;
      }
      const samples = meta.samples.map((s) => {
        const sample = s as Record<string, unknown>;
        return {
          input: String(sample.input ?? ''),
          expectedOutput: String(sample.expectedOutput ?? ''),
        };
      });
      return { code: meta.code, samples };
    } catch {
      return null;
    }
  }
}

/** 单例导出（api-conventions.md） */
export const htmlParser = new StateMachineHtmlParser();
