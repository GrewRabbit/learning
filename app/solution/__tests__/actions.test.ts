// app/solution/__tests__/actions.test.ts
// highlightCode Server Action 单元测试（FR-011，AC-003，架构 ADR-07）
// 覆盖：正常高亮返回 TokensResult、Shiki 异常返回 null

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';
import type { TokensResult, Highlighter } from 'shiki';

// Mock 依赖：shiki createHighlighter + logger（避免加载完整 Shiki bundle）
vi.mock('shiki', () => ({
  createHighlighter: vi.fn(),
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { highlightCode, __resetHighlighterForTest } from '@/app/solution/actions';
import { createHighlighter } from 'shiki';
import { logger } from '@/app/lib/logging/logger';

const mockedCreateHighlighter = createHighlighter as MockedFunction<typeof createHighlighter>;

/**
 * 构造 mock highlighter 实例（带 codeToTokens 方法）
 */
function mockHighlighter(
  codeToTokensImpl: (code: string, options: { lang: string; theme: string }) => TokensResult,
): Highlighter {
  return {
    codeToTokens: vi.fn(codeToTokensImpl),
  } as unknown as Highlighter;
}

describe('highlightCode Server Action', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 重置 highlighter 单例缓存，确保每个测试独立
    await __resetHighlighterForTest();
  });

  describe('正常高亮 → 返回 TokensResult（AC-003）', () => {
    it('should return TokensResult when Shiki 高亮成功', async () => {
      const mockResult: TokensResult = {
        tokens: [[{ content: 'int', offset: 0, color: '#0000ff' }]],
        fg: '#24292e',
        bg: '#ffffff',
        themeName: 'github-light',
      };
      const highlighter = mockHighlighter(() => mockResult);
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      const result = await highlightCode('int main() { return 0; }');

      expect(result).toBe(mockResult);
      expect(result?.tokens).toHaveLength(1);
      expect(result?.tokens[0]).toHaveLength(1);
      expect(result?.tokens[0][0].content).toBe('int');
    });

    it('should call createHighlighter with cpp lang and github-light theme（FR-011）', async () => {
      const highlighter = mockHighlighter(() => ({ tokens: [] } as TokensResult));
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      await highlightCode('int x = 0;');

      expect(mockedCreateHighlighter).toHaveBeenCalledTimes(1);
      expect(mockedCreateHighlighter).toHaveBeenCalledWith({
        langs: ['cpp'],
        themes: ['github-light'],
      });
    });

    it('should call highlighter.codeToTokens with cpp lang and github-light theme', async () => {
      const highlighter = mockHighlighter(() => ({ tokens: [] } as TokensResult));
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      await highlightCode('int x = 0;');

      const mockedCodeToTokens = highlighter.codeToTokens as MockedFunction<typeof highlighter.codeToTokens>;
      expect(mockedCodeToTokens).toHaveBeenCalledTimes(1);
      expect(mockedCodeToTokens).toHaveBeenCalledWith('int x = 0;', {
        lang: 'cpp',
        theme: 'github-light',
      });
    });

    it('should handle multi-line code', async () => {
      const mockResult: TokensResult = {
        tokens: [
          [{ content: 'int', offset: 0, color: '#0000ff' }],
          [{ content: 'main', offset: 5, color: '#000000' }],
        ],
        themeName: 'github-light',
      };
      const highlighter = mockHighlighter(() => mockResult);
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      const result = await highlightCode('int\nmain');

      expect(result).toBe(mockResult);
      expect(result?.tokens).toHaveLength(2);
    });

    it('should reuse highlighter instance across calls（单例缓存）', async () => {
      const highlighter = mockHighlighter(() => ({ tokens: [] } as TokensResult));
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      await highlightCode('int x;');
      await highlightCode('int y;');

      // createHighlighter 只调用一次（单例缓存），第二次复用
      expect(mockedCreateHighlighter).toHaveBeenCalledTimes(1);
      // codeToTokens 调用两次
      const mockedCodeToTokens = highlighter.codeToTokens as MockedFunction<typeof highlighter.codeToTokens>;
      expect(mockedCodeToTokens).toHaveBeenCalledTimes(2);
    });
  });

  describe('Shiki 异常 → 返回 null（NFR-007 兜底）', () => {
    it('should return null when createHighlighter 抛出异常', async () => {
      mockedCreateHighlighter.mockRejectedValue(new Error('Shiki 初始化失败'));

      const result = await highlightCode('int main() {}');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Shiki 服务端高亮失败',
        expect.objectContaining({ error: 'Shiki 初始化失败' }),
      );
    });

    it('should return null when highlighter.codeToTokens 抛出异常', async () => {
      const highlighter = mockHighlighter(() => {
        throw new Error('codeToTokens 失败');
      });
      mockedCreateHighlighter.mockResolvedValue(highlighter);

      const result = await highlightCode('int main() {}');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Shiki 服务端高亮失败',
        expect.objectContaining({ error: 'codeToTokens 失败' }),
      );
    });

    it('should return null when createHighlighter throws non-Error value', async () => {
      mockedCreateHighlighter.mockRejectedValue('string error');

      const result = await highlightCode('int main() {}');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Shiki 服务端高亮失败',
        expect.objectContaining({ error: 'string error' }),
      );
    });

    it('should allow retry after createHighlighter failure（缓存重置）', async () => {
      // 第一次失败
      mockedCreateHighlighter.mockRejectedValueOnce(new Error('首次失败'));
      const result1 = await highlightCode('int x;');
      expect(result1).toBeNull();

      // 第二次重试（highlighterPromise 被重置后允许重新创建）
      const highlighter = mockHighlighter(() => ({ tokens: [] } as TokensResult));
      mockedCreateHighlighter.mockResolvedValue(highlighter);
      const result2 = await highlightCode('int y;');
      expect(result2).not.toBeNull();
      expect(mockedCreateHighlighter).toHaveBeenCalledTimes(2);
    });
  });
});
