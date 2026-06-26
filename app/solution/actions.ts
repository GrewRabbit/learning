// app/solution/actions.ts
// Solution 模块 Server Actions
// - highlightCode: 服务端 Shiki 代码高亮（架构 ADR-07：避免客户端 JS 开销）

'use server';

import { codeToTokens } from 'shiki';
import type { TokensResult } from 'shiki';

import { logger } from '@/app/lib/logging/logger';

/** Shiki 主题（浅色，搭配 bg-muted 背景，避免硬编码颜色值） */
const HIGHLIGHT_THEME = 'github-light' as const;

/** Shiki 语言（C++ 语法高亮 FR-011） */
const HIGHLIGHT_LANG = 'cpp' as const;

/**
 * 服务端 Shiki 代码高亮（架构 ADR-07：避免客户端 JS 开销）
 *
 * 将 Shiki 主 bundle 保留在服务端，前端只接收结构化 tokens 数据并渲染为
 * `<span style={{ color }}>`，既满足 NFR-017（禁用 dangerouslySetInnerHTML）
 * 又避免 ~500KB+ 的 Shiki bundle 被推到客户端。
 *
 * @param code C++ 代码文本
 * @returns Shiki tokens 结果（结构化数据），失败时返回 null
 */
export async function highlightCode(code: string): Promise<TokensResult | null> {
  try {
    const result = await codeToTokens(code, {
      lang: HIGHLIGHT_LANG,
      theme: HIGHLIGHT_THEME,
    });
    return result;
  } catch (error) {
    logger.error('Shiki 服务端高亮失败', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
