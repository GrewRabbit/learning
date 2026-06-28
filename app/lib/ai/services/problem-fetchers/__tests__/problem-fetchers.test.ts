// app/lib/ai/services/problem-fetchers/__tests__/problem-fetchers.test.ts
// ProblemFetcher 单元测试（架构 §5.1 接口 + §7.1 单飞 + §4.1 文本标准化）
// 覆盖 types/normalizeContent、BaseProblemFetcher 单飞、LuoguFetcher、YoudaoFetcher、index 工厂
// mock global.fetch

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BaseProblemFetcher,
  normalizeContent,
  type FetchResult,
} from '../types';
import type { ServiceResult } from '@/app/lib/ai/types';
import { LuoguFetcher, luoguFetcher } from '../luogu-fetcher';
import { YoudaoFetcher, youdaoFetcher } from '../youdao-fetcher';
import { fetchProblem, getProblemFetcher } from '../index';

describe('normalizeContent（§4.1 文本标准化）', () => {
  it('全角空格替换为半角', () => {
    expect(normalizeContent('a\u3000b')).toBe('a b');
  });

  it('多个空白合并为一个空格', () => {
    expect(normalizeContent('a   b\t\tc\n\nd')).toBe('a b c d');
  });

  it('trim 首尾空白', () => {
    expect(normalizeContent('  hello  ')).toBe('hello');
  });

  it('零宽字符保留原样', () => {
    expect(normalizeContent('a\u200Bb')).toBe('a\u200Bb');
  });

  it('同题不同输入方式标准化后一致（架构 §4.1 核心）', () => {
    const a = normalizeContent('Hello\nWorld');
    const b = normalizeContent('  Hello   World  ');
    expect(a).toBe(b);
  });

  it('空字符串返回空字符串', () => {
    expect(normalizeContent('')).toBe('');
  });
});

// 测试单飞基类的 TestFetcher
class TestFetcher extends BaseProblemFetcher {
  public callCount = 0;
  protected async doFetch(
    platform: string,
    problemId: string,
  ): Promise<ServiceResult<FetchResult>> {
    this.callCount++;
    await new Promise((r) => setTimeout(r, 30));
    return {
      success: true,
      data: { content: `fetched-${platform}-${problemId}`, platform, problemId },
    };
  }
}

describe('BaseProblemFetcher 单飞（§7.1）', () => {
  it('相同 key 并发复用同一 Promise（callCount=1）', async () => {
    const fetcher = new TestFetcher();
    const [r1, r2, r3] = await Promise.all([
      fetcher.fetch('luogu', 'P1'),
      fetcher.fetch('luogu', 'P1'),
      fetcher.fetch('luogu', 'P1'),
    ]);
    expect(fetcher.callCount).toBe(1);
    expect(r1.data?.content).toBe('fetched-luogu-P1');
    expect(r2.data?.content).toBe('fetched-luogu-P1');
    expect(r3.data?.content).toBe('fetched-luogu-P1');
  });

  it('不同 key 各自调用 doFetch', async () => {
    const fetcher = new TestFetcher();
    await Promise.all([
      fetcher.fetch('luogu', 'P1'),
      fetcher.fetch('luogu', 'P2'),
    ]);
    expect(fetcher.callCount).toBe(2);
  });

  it('完成后 in-flight 清理（可再次调用 doFetch）', async () => {
    const fetcher = new TestFetcher();
    await fetcher.fetch('luogu', 'P1');
    await fetcher.fetch('luogu', 'P1');
    expect(fetcher.callCount).toBe(2);
  });
});

describe('LuoguFetcher（洛谷新架构：两步请求 + lentille-context）', () => {
  const fetcher = new LuoguFetcher();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** 构造带 lentille-context 的 HTML */
  function buildLuoguHtml(problem: unknown): string {
    return `<html><head><script id="lentille-context" type="application/json">${JSON.stringify({ data: { problem } })}</script></head><body></body></html>`;
  }

  /** mock 两步请求：第一次返回 302+C3VK cookie，第二次返回 HTML */
  function mockTwoStepFetch(html: string, secondStatus = 200): void {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // 第一步：302 + set-cookie C3VK（反爬虫机制）
        return new Response('302 Found', {
          status: 302,
          headers: { 'set-cookie': 'C3VK=f5f701; Max-Age=300; Path=/' },
        });
      }
      // 第二步：返回页面 HTML
      return new Response(html, { status: secondStatus });
    }) as typeof global.fetch;
  }

  it('正常路径：两步请求 + lentille-context 拼接 markdown', async () => {
    const problem = {
      pid: 'P11447',
      name: '测试题',
      content: {
        background: '背景',
        description: '描述',
        formatI: '输入格式',
        formatO: '输出格式',
        hint: '提示',
      },
      samples: [['1 2', '3']],
    };
    mockTwoStepFetch(buildLuoguHtml(problem));
    const result = await fetcher.fetch('luogu', 'P11447');
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('测试题');
    expect(result.data?.content).toContain('描述');
    expect(result.data?.content).toContain('输入格式');
    expect(result.data?.content).toContain('输出格式');
    expect(result.data?.content).toContain('样例 1');
    expect(result.data?.platform).toBe('luogu');
    expect(result.data?.problemId).toBe('P11447');
    // 确认两步请求都被调用
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('第二步 HTTP 404 返回 GESP6_PLATFORM_FETCH_FAILED', async () => {
    mockTwoStepFetch('', 404);
    const result = await fetcher.fetch('luogu', 'P99999');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
    expect(result.error?.message).toContain('404');
  });

  it('HTML 缺少 lentille-context 返回失败', async () => {
    const html = '<html><body>no lentille-context here</body></html>';
    mockTwoStepFetch(html);
    const result = await fetcher.fetch('luogu', 'P1');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
    expect(result.error?.message).toContain('lentille-context');
  });

  it('lentille-context JSON 非法返回失败', async () => {
    const html = `<html><head><script id="lentille-context" type="application/json">{invalid json}</script></head></html>`;
    mockTwoStepFetch(html);
    const result = await fetcher.fetch('luogu', 'P1');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
    expect(result.error?.message).toContain('lentille-context');
  });

  it('fetch 抛出异常返回失败', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network error');
    }) as typeof global.fetch;
    const result = await fetcher.fetch('luogu', 'P1');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
    expect(result.error?.message).toContain('network error');
  });
});

describe('YoudaoFetcher', () => {
  const fetcher = new YoudaoFetcher();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('正常路径提取 .problem-content 内容', async () => {
    const longText = 'x'.repeat(200);
    const html = `<html><body><div class="problem-content">${longText}</div><script>bad()</script></body></html>`;
    global.fetch = vi.fn(
      async () => new Response(html, { status: 200 }),
    ) as typeof global.fetch;
    const result = await fetcher.fetch('youdao', '7997');
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain('x');
    // script 应被移除
    expect(result.data?.content).not.toContain('bad()');
  });

  it('HTTP 500 返回失败', async () => {
    global.fetch = vi.fn(
      async () => new Response('', { status: 500 }),
    ) as typeof global.fetch;
    const result = await fetcher.fetch('youdao', '7997');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
  });

  it('内容过短（<100 字符）所有选择器均不匹配 → 提取失败', async () => {
    const html = `<html><body><div class="problem-content">short</div></body></html>`;
    global.fetch = vi.fn(
      async () => new Response(html, { status: 200 }),
    ) as typeof global.fetch;
    const result = await fetcher.fetch('youdao', '7997');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
  });
});

describe('fetchProblem 工厂（index.ts）', () => {
  it('未配置平台返回 GESP6_PLATFORM_FETCH_FAILED', async () => {
    const result = await fetchProblem('unknown', 'P1');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_PLATFORM_FETCH_FAILED');
    expect(result.error?.message).toContain('unknown');
  });

  it('getProblemFetcher 返回对应 fetcher 单例', () => {
    expect(getProblemFetcher('luogu')).toBe(luoguFetcher);
    expect(getProblemFetcher('youdao')).toBe(youdaoFetcher);
    expect(getProblemFetcher('luogu')).toBeInstanceOf(LuoguFetcher);
    expect(getProblemFetcher('youdao')).toBeInstanceOf(YoudaoFetcher);
  });

  it('getProblemFetcher 未配置平台返回 null', () => {
    expect(getProblemFetcher('unknown')).toBeNull();
  });
});
