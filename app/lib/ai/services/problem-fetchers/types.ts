// app/lib/ai/services/problem-fetchers/types.ts
// ProblemFetcher 接口 + 单飞基类 + 文本标准化（架构 §5.1 + §7.1 + §4.1）
// 样例指纹提取（spec-sample-fingerprint-cache-v1.1 FR-001~FR-004）

import { createHash } from 'crypto';
import { logger } from '@/app/lib/logging/logger';
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

/**
 * 提取样例指纹（spec-sample-fingerprint-cache-v1.1 FR-001~FR-004）
 *
 * 用途：作为 contentHash 的补充查询路径，使文本/图片输入方式能命中
 * platform 方式已生成的缓存，减少重复 LLM 调用（NFR-003：零 LLM token）。
 *
 * 提取逻辑（FR-002）：
 * 1. 识别"样例"章节范围：以 `^## ` 开头且标题含"样例"二字的行作为章节起始，
 *    到下一个 `^## ` 标题或文末。若无任何含"样例"的二级标题，降级为提取全文代码块（兜底）。
 * 2. 在范围内用 `/```[\s\S]*?```/g` 匹配代码块，去除开头 ``` 及可选语言标记
 *    （```cpp、```python、```c 等）和结尾 ```，再 normalizeContent，
 *    用 `|||` 分隔符拼接，最后 SHA-256。
 * 3. 兜底：若无代码块，尝试用 "输入：/输出：" 标题模式提取（图片识别输出可能无代码围栏）。
 *
 * 边界（FR-003）：无代码块且无 "输入：/输出：" 模式时返回空字符串 `''`（降级信号，调用方跳过 sample 查询）。
 * 顺序（FR-004）：多组样例按原文出现顺序拼接，不排序。
 */
export function extractSampleFingerprint(content: string): string {
  const startTs = Date.now();
  // 第一步：识别"样例"章节范围（FR-002 第一步）
  const sampleRange = extractSampleSectionRange(content);
  const usedFallback = sampleRange === content;

  // 第二步：提取代码块 + 标准化 + 拼接 + hash（FR-002 第二步）
  let blocks = extractCodeBlocks(sampleRange);
  let usedHeaderFallback = false;

  // 兜底：无代码块时尝试 "输入：/输出：" 模式提取（图片识别输出可能无代码围栏）
  if (blocks.length === 0) {
    const headerBlocks = extractSampleByHeaderPattern(sampleRange);
    if (headerBlocks.length === 0) {
      logger.info('[extractSampleFingerprint] 无代码块且无 输入：/输出： 模式，返回空字符串（降级信号 FR-003）', {
        contentLength: content.length,
        usedFallback,
        elapsedMs: Date.now() - startTs,
      });
      return ''; // FR-003：无代码块返回空字符串
    }
    blocks = headerBlocks;
    usedHeaderFallback = true;
  }

  const joined = blocks.map(normalizeContent).join('|||');
  const sampleFp = createHash('sha256').update(joined, 'utf-8').digest('hex');
  logger.info('[extractSampleFingerprint] 提取完成', {
    contentLength: content.length,
    sampleRangeLength: sampleRange.length,
    usedFallback,
    usedHeaderFallback,
    blockCount: blocks.length,
    blocksPreview: blocks.map((b) => b.slice(0, 40)),
    sampleFp,
    sampleFpShort: sampleFp.slice(0, 16),
    elapsedMs: Date.now() - startTs,
  });
  return sampleFp;
}

/**
 * 识别"样例"章节范围（FR-002 第一步，内部辅助）
 *
 * 匹配规则：以 `^## ` 开头且标题含"样例"二字的行作为章节起始，
 * 到下一个 `^## ` 标题或文末。若无任何含"样例"的二级标题，返回全文（兜底降级）。
 */
function extractSampleSectionRange(content: string): string {
  const lines = content.split('\n');
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 仅匹配二级标题（^## 后紧跟空格，避免误匹配 ### 三级标题）
    if (/^## /.test(line)) {
      if (startIdx === -1) {
        // 还未找到样例章节，检查当前标题是否含"样例"
        if (line.includes('样例')) {
          startIdx = i;
        }
      } else {
        // 已找到样例章节，遇到下一个 `## ` 标题即结束
        endIdx = i;
        break;
      }
    }
  }

  // 无任何含"样例"的二级标题 → 降级为全文（FR-002 兜底）
  if (startIdx === -1) {
    return content;
  }

  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * 提取代码块内容（FR-002 第二步，内部辅助）
 *
 * 在范围内用 `/```[\s\S]*?```/g` 匹配代码块，去除开头 ``` 及可选语言标记
 * （```cpp、```python、```c 等）和结尾 ```，返回代码块内容数组（保留原文出现顺序，FR-004）。
 */
function extractCodeBlocks(range: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(range)) !== null) {
    const raw = match[0];
    // 去除开头 ``` 及可选语言标记（```cpp、```python、```c 等）
    const withoutStart = raw.replace(/^```[a-zA-Z0-9]*\n?/, '');
    // 去除结尾 ```
    const cleaned = withoutStart.replace(/\n?```$/, '');
    blocks.push(cleaned);
  }
  return blocks;
}

/**
 * 按 "输入：/输出：" 标题模式提取样例内容（extractCodeBlocks 的兜底方案）
 *
 * 用途：图片识别输出可能不含 ``` 代码围栏，而是用 "输入：" "输出：" 标题分隔。
 * 此函数按标题模式提取内容，确保图片输入也能生成与代码块路径一致的样例指纹。
 *
 * 匹配规则：
 * 1. 匹配 `^(输入|输出)(样例)?\s*[：:]` 开头的行作为内容块起始（支持同行内容如 "输入：5 2"）
 * 2. 内容持续到下一个 "输入：/输出：" 标题、`## `/`### `/`#### ` 章节头、或文末
 * 3. 不匹配 "输入格式："/"输出格式："（因为 "格式" 不在可选 "样例" 范围内）
 *
 * 顺序：按原文出现顺序返回（FR-004），与 extractCodeBlocks 一致。
 */
function extractSampleByHeaderPattern(range: string): string[] {
  const lines = range.split('\n');
  const blocks: string[] = [];
  let currentBlock: string[] | null = null;

  const headerPattern = /^(输入|输出)(样例)?\s*[：:]\s*(.*)$/;
  const sectionHeaderPattern = /^#{2,4}\s/;

  for (const line of lines) {
    const match = line.match(headerPattern);

    if (match) {
      // 结束上一个块，开始新块
      if (currentBlock !== null) {
        blocks.push(currentBlock.join('\n'));
      }
      currentBlock = [];
      // 同行内容（如 "输入：5 2"）
      const inlineContent = match[3];
      if (inlineContent) {
        currentBlock.push(inlineContent);
      }
    } else if (sectionHeaderPattern.test(line)) {
      // 章节头结束当前块
      if (currentBlock !== null) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = null;
      }
    } else if (currentBlock !== null) {
      currentBlock.push(line);
    }
  }
  // 推入最后一个块
  if (currentBlock !== null) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}
