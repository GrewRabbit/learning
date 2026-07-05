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
 * 样例指纹（多候选，提升跨输入类型缓存命中率）
 *
 * 设计背景：单一指纹容错性差，"用户只粘 1 组样例 vs fetcher 抓 3 组样例"
 * 会导致 hash 不同。多候选指纹互补覆盖不同差异场景。
 *
 * 字段说明：
 * - `all`：所有样例块按原文顺序拼接后哈希（容错格式微差异，与原 sampleFp 等价）
 * - `first`：仅第一组样例（前 2 块，输入+输出）拼接后哈希（容错"用户只粘部分样例"）
 *
 * 边界：
 * - 无样例块时 `all === ''` 且 `first === ''`（降级信号，调用方跳过 sample 查询）
 * - 仅 1 个块时 `all` 非空、`first === ''`（无法构成一组样例）
 */
export interface SampleFingerprint {
  readonly all: string;
  readonly first: string;
}

/** 降级信号：无样例块时返回的空指纹（all='', first=''） */
export const EMPTY_SAMPLE_FINGERPRINT: SampleFingerprint = { all: '', first: '' };

/**
 * 提取样例指纹（spec-sample-fingerprint-cache-v1.1 FR-001~FR-004 + 多候选扩展）
 *
 * 用途：作为 contentHash 的补充查询路径，使文本/图片输入方式能命中
 * platform 方式已生成的缓存，减少重复 LLM 调用（NFR-003：零 LLM token）。
 *
 * 提取逻辑（FR-002 + 章节匹配扩展）：
 * 1. 识别"样例"章节范围：以 `^#{2,4}\s` 开头且标题含"样例"二字的行作为章节起始，
 *    连续的"样例 1/样例 2/样例 3"标题合并到同一范围，遇到不含"样例"的标题或文末结束。
 *    若无任何含"样例"的二/三/四级标题，降级为提取全文代码块（兜底）。
 * 2. 在范围内用 `/```[\s\S]*?```/g` 匹配代码块，去除开头 ``` 及可选语言标记
 *    （```cpp、```python、```c 等）和结尾 ```，再 normalizeContent。
 * 3. 多候选哈希：
 *    - `all`：所有块用 `|||` 分隔符拼接后 SHA-256
 *    - `first`：仅前 2 块（第一组样例 输入+输出）用 `|||` 拼接后 SHA-256
 * 4. 兜底：若无代码块，尝试用 "输入：/输出：" 标题模式提取（图片识别输出可能无代码围栏）。
 *
 * 边界（FR-003）：无代码块且无 "输入：/输出：" 模式时返回空指纹（降级信号）。
 * 顺序（FR-004）：多组样例按原文出现顺序拼接，不排序。
 */
export function extractSampleFingerprint(content: string): SampleFingerprint {
  const startTs = Date.now();
  // 第一步：识别"样例"章节范围（FR-002 第一步 + 章节匹配扩展）
  const sampleRange = extractSampleSectionRange(content);
  const usedFallback = sampleRange === content;

  // 第二步：提取代码块（FR-002 第二步）
  let blocks = extractCodeBlocks(sampleRange);
  let usedHeaderFallback = false;

  // 兜底：无代码块时尝试 "输入：/输出：" 模式提取（图片识别输出可能无代码围栏）
  if (blocks.length === 0) {
    const headerBlocks = extractSampleByHeaderPattern(sampleRange);
    if (headerBlocks.length === 0) {
      logger.info('[extractSampleFingerprint] 无代码块且无 输入：/输出： 模式，返回空指纹（降级信号 FR-003）', {
        contentLength: content.length,
        usedFallback,
        elapsedMs: Date.now() - startTs,
      });
      return EMPTY_SAMPLE_FINGERPRINT; // FR-003：无代码块返回空指纹
    }
    blocks = headerBlocks;
    usedHeaderFallback = true;
  }

  // 多候选哈希
  const normalizedBlocks = blocks.map(normalizeContent);
  const all = createHash('sha256').update(normalizedBlocks.join('|||'), 'utf-8').digest('hex');
  // first：仅前 2 块（第一组样例 输入+输出），不足 2 块时为空（无法构成一组样例）
  const first = normalizedBlocks.length >= 2
    ? createHash('sha256').update(normalizedBlocks.slice(0, 2).join('|||'), 'utf-8').digest('hex')
    : '';

  const fingerprint: SampleFingerprint = { all, first };
  logger.info('[extractSampleFingerprint] 提取完成', {
    contentLength: content.length,
    sampleRangeLength: sampleRange.length,
    usedFallback,
    usedHeaderFallback,
    blockCount: blocks.length,
    blocksPreview: blocks.map((b) => b.slice(0, 40)),
    sampleFpAll: all,
    sampleFpAllShort: all.slice(0, 16),
    sampleFpFirst: first,
    sampleFpFirstShort: first ? first.slice(0, 16) : '',
    elapsedMs: Date.now() - startTs,
  });
  return fingerprint;
}

/**
 * 识别"样例"章节范围（FR-002 第一步，内部辅助 + 章节匹配扩展）
 *
 * 匹配规则：
 * 1. 以 `^#{2,4}\s` 开头（二/三/四级标题）且标题含"样例"二字的行作为章节起始，
 *    记录起始标题级别（startLevel）
 * 2. 子级别标题（level > startLevel）不结束范围，无论是否含"样例"
 *    —— 例如起始 `## 输入输出样例 #1`（level=2）下的 `### 输入 #1`（level=3）
 *    属于同一组样例的子标题，不应结束范围
 * 3. 同级或更高级别标题（level ≤ startLevel）且不含"样例"时结束范围
 *    —— 例如起始 `## 样例`（level=2）后的 `## 输出格式`（level=2）应结束范围
 * 4. 若无任何含"样例"的二/三/四级标题，返回全文（兜底降级）
 *
 * 扩展背景：
 * - 洛谷等平台 fetcher 抓取的 markdown 常用 `### 样例 1` 三级标题
 * - 用户手输格式常用 `## 输入输出样例 #1` 起始 + `### 输入 #1`/`### 输出 #1` 子标题
 *   旧逻辑遇 `### 输入 #1`（不含"样例"）即结束，导致无法提取代码块
 */
function extractSampleSectionRange(content: string): string {
  const lines = content.split('\n');
  let startIdx = -1;
  let endIdx = lines.length;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配二/三/四级标题（^#{2,4} 后紧跟空格），捕获级别
    const match = /^(#{2,4})\s/.exec(line);
    if (!match) continue;
    const level = match[1].length;

    if (startIdx === -1) {
      // 还未找到样例章节，检查当前标题是否含"样例"
      if (line.includes('样例')) {
        startIdx = i;
        startLevel = level;
      }
    } else {
      // 已找到样例章节
      // 子级别标题（level > startLevel）属于同一组样例的子标题，不结束范围
      // 同级或更高级别标题（level ≤ startLevel）且不含"样例"时结束范围
      if (level <= startLevel && !line.includes('样例')) {
        endIdx = i;
        break;
      }
    }
  }

  // 无任何含"样例"的标题 → 降级为全文（FR-002 兜底）
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
