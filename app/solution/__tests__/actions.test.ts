// app/solution/__tests__/actions.test.ts
// highlightCode Server Action 单元测试（FR-011，AC-003，架构 ADR-07）
// 覆盖：正常高亮返回 TokensResult、Shiki 异常返回 null

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';
import type { TokensResult } from 'shiki';

// Mock 依赖：shiki codeToTokens + logger（避免加载完整 Shiki bundle）
vi.mock('shiki', () => ({
  codeToTokens: vi.fn(),
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { highlightCode } from '@/app/solution/actions';
import { codeToTokens } from 'shiki';
import { logger } from '@/app/lib/logging/logger';

const mockedCodeToTokens = codeToTokens as MockedFunction<typeof codeToTokens>;

describe('highlightCode Server Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常高亮 → 返回 TokensResult（AC-003）', () => {
    it('should return TokensResult when Shiki 高亮成功', async () => {
      const mockResult: TokensResult = {
        tokens: [[{ content: 'int', offset: 0, color: '#0000ff' }]],
        fg: '#24292e',
        bg: '#ffffff',
        themeName: 'github-light',
      };
      mockedCodeToTokens.mockResolvedValue(mockResult);

      const result = await highlightCode('int main() { return 0; }');

      expect(result).toBe(mockResult);
      expect(result?.tokens).toHaveLength(1);
      expect(result?.tokens[0]).toHaveLength(1);
      expect(result?.tokens[0][0].content).toBe('int');
    });

    it('should call codeToTokens with cpp lang and github-light theme（FR-011）', async () => {
      mockedCodeToTokens.mockResolvedValue({ tokens: [] } as TokensResult);

      await highlightCode('int x = 0;');

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
      mockedCodeToTokens.mockResolvedValue(mockResult);

      const result = await highlightCode('int\nmain');

      expect(result).toBe(mockResult);
      expect(result?.tokens).toHaveLength(2);
    });
  });

  describe('Shiki 异常 → 返回 null（NFR-007 兜底）', () => {
    it('should return null when codeToTokens 抛出异常', async () => {
      mockedCodeToTokens.mockImplementation(() => {
        throw new Error('Shiki 初始化失败');
      });

      const result = await highlightCode('int main() {}');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Shiki 服务端高亮失败',
        expect.objectContaining({ error: 'Shiki 初始化失败' }),
      );
    });

    it('should return null when codeToTokens 抛出非 Error 值', async () => {
      mockedCodeToTokens.mockImplementation(() => {
        throw 'string error';
      });

      const result = await highlightCode('int main() {}');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Shiki 服务端高亮失败',
        expect.objectContaining({ error: 'string error' }),
      );
    });
  });
});
