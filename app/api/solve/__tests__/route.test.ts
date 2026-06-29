// app/api/solve/__tests__/route.test.ts
// Route Handler 单元测试（架构 §5.3 + §8.2 SSRF 防护 + §5.4 错误码）
// mock Orchestrator 模块，测试接入层校验与响应码

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';

// mock Orchestrator 模块（避免真实 LLM/g++ 调用）
vi.mock('@/app/lib/ai/services/orchestrator', () => ({
  gesp6Orchestrator: {
    solve: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  },
}));

import { POST } from '../route';
import { gesp6Orchestrator } from '@/app/lib/ai/services/orchestrator';

const mockSolve = gesp6Orchestrator.solve as ReturnType<typeof vi.fn>;

const successSolution: Solution = {
  html: '<html>test</html>',
  validated: true,
  cached: false,
};

const successResult: ServiceResult<Solution> = {
  success: true,
  data: successSolution,
};

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function parseResponse(response: Response): Promise<{
  status: number;
  body: ServiceResult<Solution>;
}> {
  const status = response.status;
  const body = (await response.json()) as ServiceResult<Solution>;
  return { status, body };
}

describe('POST /api/solve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSolve.mockResolvedValue(successResult);
  });

  describe('text 输入', () => {
    it('合法输入 + Orchestrator 成功 → 200', async () => {
      const res = await POST(createRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data?.html).toBe('<html>test</html>');
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'text',
        content: '题目内容',
      });
    });

    it('内容超长（> 10000 字符）→ 400 GESP6_INPUT_INVALID', async () => {
      const longContent = 'a'.repeat(10_001);
      const res = await POST(createRequest({
        problem: { type: 'text', content: longContent },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('内容恰为 10000 字符 → 200（边界值）', async () => {
      const content = 'a'.repeat(10_000);
      const res = await POST(createRequest({
        problem: { type: 'text', content },
      }));
      const { status } = await parseResponse(res);
      expect(status).toBe(200);
    });
  });

  describe('image 输入', () => {
    it('合法 base64 + Orchestrator 成功 → 200', async () => {
      const res = await POST(createRequest({
        problem: { type: 'image', content: 'base64data' },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'image',
        content: 'base64data',
      });
    });
  });

  describe('platform 输入', () => {
    it('洛谷 URL → resolvePlatform 填充 platform/problemId → 200', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://www.luogu.com.cn/problem/P11447',
        },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'platform',
        content: 'https://www.luogu.com.cn/problem/P11447',
        platform: 'luogu',
        problemId: 'P11447',
      });
    });

    it('有道小图灵 URL → resolvePlatform 填充 platform/problemId → 200', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7997',
        },
      }));
      const { status } = await parseResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'platform',
        content: 'https://oj.youdao.com/problem/7997',
        platform: 'youdao',
        problemId: '7997',
      });
    });

    it('有道小图灵标准 URL 带 query string → 提取 problemId → 200', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7906?from=problems',
        },
      }));
      const { status } = await parseResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'platform',
        content: 'https://oj.youdao.com/problem/7906?from=problems',
        platform: 'youdao',
        problemId: '7906',
      });
    });

    it('有道小图灵 exercise 路径 → 提取倒数第二段为 problemId → 200', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1',
        },
      }));
      const { status } = await parseResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'platform',
        content: 'https://oj.youdao.com/exercise/7/48/4924/1',
        platform: 'youdao',
        problemId: '4924',
      });
    });

    it('有道小图灵 exercise 路径带中文 query → 提取 problemId → 200', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1?title=简单排序',
        },
      }));
      const { status } = await parseResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith({
        type: 'platform',
        content: 'https://oj.youdao.com/exercise/7/48/4924/1?title=简单排序',
        platform: 'youdao',
        problemId: '4924',
      });
    });

    it('未配置平台 URL → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'https://example.com/problem/1',
        },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('http:// 非 https → 400（Zod 拦截，SSRF 防护）', async () => {
      const res = await POST(createRequest({
        problem: {
          type: 'platform',
          content: 'http://www.luogu.com.cn/problem/P11447',
        },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });
  });

  describe('请求体异常', () => {
    it('请求体非 JSON → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createRequest('not-json'));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(body.error?.message).toContain('JSON');
    });

    it('缺少 problem 字段 → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createRequest({ foo: 'bar' }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('type 非合法枚举 → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createRequest({
        problem: { type: 'invalid', content: 'x' },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
    });
  });

  describe('Orchestrator 异常', () => {
    it('Orchestrator 返回失败 → 500', async () => {
      mockSolve.mockResolvedValue({
        success: false,
        error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
      });
      const res = await POST(createRequest({
        problem: { type: 'text', content: '题目' },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('GESP6_LLM_TIMEOUT');
    });

    it('Orchestrator 抛异常 → 500 GESP6_INTERNAL_ERROR', async () => {
      mockSolve.mockRejectedValue(new Error('未预期异常'));
      const res = await POST(createRequest({
        problem: { type: 'text', content: '题目' },
      }));
      const { status, body } = await parseResponse(res);
      expect(status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('GESP6_INTERNAL_ERROR');
      expect(body.error?.message).toContain('未预期异常');
    });
  });
});
