// app/solution/actions.ts
// Solution 模块 Server Actions
// - highlightCode: 服务端 Shiki 代码高亮（架构 ADR-07：避免客户端 JS 开销）

'use server';

import { createHighlighter, type Highlighter, type TokensResult } from 'shiki';

import { logger } from '@/app/lib/logging/logger';

/** Shiki 主题（浅色，搭配 bg-muted 背景，避免硬编码颜色值） */
const HIGHLIGHT_THEME = 'github-light' as const;

/** Shiki 语言（C++ 语法高亮 FR-011） */
const HIGHLIGHT_LANG = 'cpp' as const;

/**
 * Shiki highlighter 单例（模块级缓存）
 *
 * 使用 createHighlighter 预加载语言与主题，避免每次 codeToTokens 动态加载
 * （在 Server Action 环境下动态加载可能因 webpack/ESM 解析问题失败）。
 * 首次调用时初始化，后续调用复用 highlighter 实例（同步 codeToTokens，无加载开销）。
 * 初始化失败时重置为 null，允许下次调用重试。
 */
let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: [HIGHLIGHT_LANG],
      themes: [HIGHLIGHT_THEME],
    }).catch((err: unknown) => {
      // 初始化失败时重置，允许下次调用重试（避免 rejected promise 永久缓存）
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

/**
 * @internal 仅供测试重置 highlighter 单例缓存
 * 生产代码不应调用此函数
 *
 * 注：本文件顶部声明 'use server'，Next.js 要求所有导出函数为 async
 * （Server Actions 必须返回 Promise）。本函数标记 @internal 仅测试使用。
 */
export async function __resetHighlighterForTest(): Promise<void> {
  highlighterPromise = null;
}

/**
 * 服务端 Shiki 代码高亮（架构 ADR-07：避免客户端 JS 开销）
 *
 * 将 Shiki 主 bundle 保留在服务端，前端只接收结构化 tokens 数据并渲染为
 * `<span style={{ color }}>`，既满足 NFR-017（禁用 dangerouslySetInnerHTML）
 * 又避免 ~500KB+ 的 Shiki bundle 被推到客户端。
 *
 * 使用 createHighlighter 预加载单例（而非 codeToTokens 单次调用），确保
 * Shiki 初始化在服务端只执行一次，后续调用同步复用 highlighter 实例。
 *
 * @param code C++ 代码文本
 * @returns Shiki tokens 结果（结构化数据），失败时返回 null
 */
export async function highlightCode(code: string): Promise<TokensResult | null> {
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToTokens(code, {
      lang: HIGHLIGHT_LANG,
      theme: HIGHLIGHT_THEME,
    });
  } catch (error) {
    logger.error('Shiki 服务端高亮失败', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
