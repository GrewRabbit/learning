// app/api/solve/__tests__/route.test.ts
// Route Handler 单元测试（架构 §5.3 + §8.2 SSRF 防护 + §5.4 错误码）
// mock Orchestrator 模块，测试接入层校验与响应码
//
// 轮询模式：POST 立即返回 jobId，GET 查询任务状态

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServiceResult, Solution } from '@/app/lib/ai/types';

// mock Orchestrator 模块（避免真实 LLM/g++ 调用）
vi.mock('@/app/lib/ai/services/orchestrator', () => ({
  gesp6Orchestrator: {
    solve: vi.fn() as unknown as ReturnType<typeof vi.fn>,
  },
}));

// mock M5 认证守卫（避免真实 JWT 验签；默认放行，认证失败用例单独覆盖）
vi.mock('@/app/lib/auth/guard', () => ({
  requireAuth: vi.fn(),
}));

import { POST, GET, DELETE } from '../route';
import { gesp6Orchestrator } from '@/app/lib/ai/services/orchestrator';
import { requireAuth } from '@/app/lib/auth/guard';

const mockSolve = gesp6Orchestrator.solve as ReturnType<typeof vi.fn>;
const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;

/** 默认认证成功结果（sub 仅用于日志） */
const authSuccessResult = {
  success: true,
  data: { sub: 'user-123', iss: 'https://idp.example.com', aud: 'test-client', exp: 9_999_999_999, iat: 9_999_999_999 },
};

const successSolution: Solution = {
  html: '<html>test</html>',
  validated: true,
  cached: false,
};

const successResult: ServiceResult<Solution> = {
  success: true,
  data: successSolution,
};

/** POST 响应体类型 */
interface PostResponseBody {
  success: boolean;
  data?: { jobId: string };
  error?: { code: string; message: string };
}

/** GET 响应体类型 */
interface GetResponseBody {
  success: boolean;
  data?: {
    status: 'processing' | 'done';
    result?: Solution;
    thinkingContent?: string;
    organizingContent?: string;
  };
  error?: { code: string; message: string };
}

function createPostRequest(body: unknown): Request {
  return new Request('http://localhost/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function createGetRequest(jobId: string): Request {
  return new Request(`http://localhost/api/solve?jobId=${encodeURIComponent(jobId)}`, {
    method: 'GET',
  });
}

async function parsePostResponse(response: Response): Promise<{
  status: number;
  body: PostResponseBody;
}> {
  const status = response.status;
  const body = (await response.json()) as PostResponseBody;
  return { status, body };
}

async function parseGetResponse(response: Response): Promise<{
  status: number;
  body: GetResponseBody;
}> {
  const status = response.status;
  const body = (await response.json()) as GetResponseBody;
  return { status, body };
}

/** 等待所有 pending microtask（包括 Orchestrator.solve 后台 promise 链）resolve */
async function flushMicrotasks(): Promise<void> {
  // 双重 await 确保后台 .then/.catch 链都执行完毕
  await Promise.resolve();
  await Promise.resolve();
}

describe('POST /api/solve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSolve.mockResolvedValue(successResult);
    mockRequireAuth.mockResolvedValue(authSuccessResult);
  });

  describe('认证（M5 requireAuth）', () => {
    it('无有效会话（AUTH_SESSION_INVALID）→ 401，不进入业务逻辑', async () => {
      mockRequireAuth.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_SESSION_INVALID', message: '登录会话无效，请重新登录' },
      });
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('AUTH_SESSION_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('access_token 已过期（AUTH_TOKEN_EXPIRED）→ 401', async () => {
      mockRequireAuth.mockResolvedValue({
        success: false,
        error: { code: 'AUTH_TOKEN_EXPIRED', message: '登录已过期，请重新登录' },
      });
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('认证通过 → 正常流程（requireAuth 在 Zod 校验之前执行）', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockRequireAuth).toHaveBeenCalledTimes(1);
      expect(mockSolve).toHaveBeenCalled();
    });
  });

  describe('text 输入', () => {
    it('合法输入 + Orchestrator 成功 → 200 返回 jobId', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(typeof body.data?.jobId).toBe('string');
      expect(body.data?.jobId.length).toBeGreaterThan(0);
      // Orchestrator.solve 在后台被调用（不阻塞响应），第二参数为取消检查闭包
      expect(mockSolve).toHaveBeenCalledWith(
        { type: 'text', content: '题目内容' },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('内容超长（> 10000 字符）→ 400 GESP6_INPUT_INVALID', async () => {
      const longContent = 'a'.repeat(10_001);
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: longContent },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('内容恰为 10000 字符 → 200（边界值）', async () => {
      const content = 'a'.repeat(10_000);
      const res = await POST(createPostRequest({
        problem: { type: 'text', content },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
    });
  });

  describe('image 输入', () => {
    it('合法 base64 + Orchestrator 成功 → 200 返回 jobId', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'image', content: 'base64data' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(typeof body.data?.jobId).toBe('string');
      expect(mockSolve).toHaveBeenCalledWith(
        { type: 'image', content: 'base64data' },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });
  });

  describe('regenerate（重新生成）', () => {
    it('regenerate=true → orchestrator.solve 第 4 参数为 true（跳过缓存读）', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
        regenerate: true,
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        { type: 'text', content: '题目内容' },
        expect.any(Function),
        expect.any(Function),
        true,
      );
    });

    it('regenerate=false → orchestrator.solve 第 4 参数为 false（正常缓存读）', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
        regenerate: false,
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        { type: 'text', content: '题目内容' },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('regenerate 缺省 → orchestrator.solve 第 4 参数为 false', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'text', content: '题目内容' },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        { type: 'text', content: '题目内容' },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });
  });

  describe('platform 输入', () => {
    it('洛谷 URL → resolvePlatform 填充 platform/problemId → 200 返回 jobId', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://www.luogu.com.cn/problem/P11447',
        },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        {
          type: 'platform',
          content: 'https://www.luogu.com.cn/problem/P11447',
          platform: 'luogu',
          problemId: 'P11447',
        },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('有道小图灵 URL → resolvePlatform 填充 platform/problemId → 200', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7997',
        },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7997',
          platform: 'youdao',
          problemId: '7997',
        },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('有道小图灵标准 URL 带 query string → 提取 problemId → 200', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7906?from=problems',
        },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        {
          type: 'platform',
          content: 'https://oj.youdao.com/problem/7906?from=problems',
          platform: 'youdao',
          problemId: '7906',
        },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('有道小图灵 exercise 路径 → 提取倒数第二段为 problemId → 200', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1',
        },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1',
          platform: 'youdao',
          problemId: '4924',
        },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('有道小图灵 exercise 路径带中文 query → 提取 problemId → 200', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1?title=简单排序',
        },
      }));
      const { status } = await parsePostResponse(res);
      expect(status).toBe(200);
      expect(mockSolve).toHaveBeenCalledWith(
        {
          type: 'platform',
          content: 'https://oj.youdao.com/exercise/7/48/4924/1?title=简单排序',
          platform: 'youdao',
          problemId: '4924',
        },
        expect.any(Function),
        expect.any(Function),
        false,
      );
    });

    it('未配置平台 URL → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'https://example.com/problem/1',
        },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('http:// 非 https → 400（Zod 拦截，SSRF 防护）', async () => {
      const res = await POST(createPostRequest({
        problem: {
          type: 'platform',
          content: 'http://www.luogu.com.cn/problem/P11447',
        },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });
  });

  describe('请求体异常', () => {
    it('请求体非 JSON → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createPostRequest('not-json'));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(body.error?.message).toContain('JSON');
    });

    it('缺少 problem 字段 → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createPostRequest({ foo: 'bar' }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
      expect(mockSolve).not.toHaveBeenCalled();
    });

    it('type 非合法枚举 → 400 GESP6_INPUT_INVALID', async () => {
      const res = await POST(createPostRequest({
        problem: { type: 'invalid', content: 'x' },
      }));
      const { status, body } = await parsePostResponse(res);
      expect(status).toBe(400);
      expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
    });
  });
});

describe('GET /api/solve（轮询查询）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSolve.mockResolvedValue(successResult);
    // GET 本身不走认证，但其内部通过 POST 创建任务 → 需放行守卫
    mockRequireAuth.mockResolvedValue(authSuccessResult);
  });

  it('缺少 jobId → 400 GESP6_INPUT_INVALID', async () => {
    const req = new Request('http://localhost/api/solve', { method: 'GET' });
    const res = await GET(req);
    const { status, body } = await parseGetResponse(res);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
  });

  it('不存在的 jobId → 404 GESP6_JOB_NOT_FOUND', async () => {
    const res = await GET(createGetRequest('nonexistent-job-id'));
    const { status, body } = await parseGetResponse(res);
    expect(status).toBe(404);
    expect(body.error?.code).toBe('GESP6_JOB_NOT_FOUND');
  });

  it('Orchestrator 成功 → GET 返回 status=done + result', async () => {
    // 1. POST 创建任务
    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 2. 等待后台 Orchestrator 完成
    await flushMicrotasks();

    // 3. GET 查询 → 应为 done
    const getRes = await GET(createGetRequest(jobId));
    const { status, body } = await parseGetResponse(getRes);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe('done');
    expect(body.data?.result?.html).toBe('<html>test</html>');
    expect(body.data?.result?.validated).toBe(true);
  });

  it('Orchestrator 返回失败 → GET 返回 error', async () => {
    mockSolve.mockResolvedValue({
      success: false,
      error: { code: 'GESP6_LLM_TIMEOUT', message: '超时' },
    });

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    await flushMicrotasks();

    const getRes = await GET(createGetRequest(jobId));
    const { body } = await parseGetResponse(getRes);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('GESP6_LLM_TIMEOUT');
    expect(body.error?.message).toBe('超时');
  });

  it('Orchestrator 抛异常 → GET 返回 GESP6_INTERNAL_ERROR', async () => {
    mockSolve.mockRejectedValue(new Error('未预期异常'));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    await flushMicrotasks();

    const getRes = await GET(createGetRequest(jobId));
    const { body } = await parseGetResponse(getRes);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('GESP6_INTERNAL_ERROR');
    expect(body.error?.message).toContain('未预期异常');
  });

  it('GET 在 Orchestrator 仍在处理时 → 返回 status=processing', async () => {
    // 让 solve 永远 pending（不 resolve 也不 reject）
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 不等待后台完成，直接查询
    const getRes = await GET(createGetRequest(jobId));
    const { status, body } = await parseGetResponse(getRes);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe('processing');
  });

  it('POST 传入 onChunk 回调 → reasoning 片段累积到 thinkingContent，content 片段累积到 organizingContent', async () => {
    // 让 solve 永远 pending，确保任务处于 processing 状态
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 从 mock 调用参数中提取 onChunk 回调（第 3 个参数）
    const solveCallArgs = mockSolve.mock.calls[mockSolve.mock.calls.length - 1];
    const onChunk = solveCallArgs[2] as (chunk: { type: string; text: string }) => void;
    expect(typeof onChunk).toBe('function');

    // 模拟 LLM 流式输出：reasoning 片段累积到 thinkingContent，content 片段累积到 organizingContent
    onChunk({ type: 'reasoning', text: '思考片段1' });
    onChunk({ type: 'reasoning', text: '思考片段2' });
    onChunk({ type: 'content', text: '回答片段' });

    // GET 查询 → thinkingContent 仅含 reasoning，organizingContent 仅含 content
    const getRes = await GET(createGetRequest(jobId));
    const { body } = await parseGetResponse(getRes);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe('processing');
    expect(body.data?.thinkingContent).toBe('思考片段1思考片段2');
    expect(body.data?.organizingContent).toBe('回答片段');
  });

  it('processing 状态下无 thinking/organizing 内容 → GET 返回空字符串', async () => {
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 未调用 onChunk，thinkingContent 与 organizingContent 均为空字符串
    const getRes = await GET(createGetRequest(jobId));
    const { body } = await parseGetResponse(getRes);
    expect(body.data?.thinkingContent).toBe('');
    expect(body.data?.organizingContent).toBe('');
  });

  it('GESP6_THINKING_DISPLAY_ENABLED=false → solve 第 3 参数为 undefined（不累积思考过程与组织回答）', async () => {
    vi.stubEnv('GESP6_THINKING_DISPLAY_ENABLED', 'false');
    mockSolve.mockReturnValue(new Promise(() => {}));

    try {
      const postRes = await POST(createPostRequest({
        problem: { type: 'text', content: '题目' },
      }));
      const { body: postBody } = await parsePostResponse(postRes);
      const jobId = postBody.data!.jobId;

      // solve 第 3 参数（onChunk）应为 undefined
      const solveCallArgs = mockSolve.mock.calls[mockSolve.mock.calls.length - 1];
      expect(solveCallArgs[2]).toBeUndefined();

      // onChunk 未被传入，从源头阻止 thinkingContent 与 organizingContent 累积
      const getRes = await GET(createGetRequest(jobId));
      const { body } = await parseGetResponse(getRes);
      expect(body.data?.thinkingContent).toBe('');
      expect(body.data?.organizingContent).toBe('');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('任务被取消后 GET → 返回 GESP6_CANCELLED', async () => {
    // 让 solve 永远 pending（不 resolve 也不 reject）
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 取消任务
    const deleteRes = await DELETE(createGetRequest(jobId));
    const { status: deleteStatus, body: deleteBody } = await parseGetResponse(deleteRes);
    expect(deleteStatus).toBe(200);
    expect(deleteBody.success).toBe(true);

    // GET 查询 → 应返回 cancelled
    const getRes = await GET(createGetRequest(jobId));
    const { body: getBody } = await parseGetResponse(getRes);
    expect(getBody.success).toBe(false);
    expect(getBody.error?.code).toBe('GESP6_CANCELLED');
  });
});

describe('DELETE /api/solve?jobId=xxx（取消任务）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSolve.mockResolvedValue(successResult);
    // DELETE 本身不走认证，但其内部通过 POST 创建任务 → 需放行守卫
    mockRequireAuth.mockResolvedValue(authSuccessResult);
  });

  it('缺少 jobId → 400 GESP6_INPUT_INVALID', async () => {
    const req = new Request('http://localhost/api/solve', { method: 'DELETE' });
    const res = await DELETE(req);
    const { status, body } = await parseGetResponse(res);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('GESP6_INPUT_INVALID');
  });

  it('不存在的 jobId → 404 GESP6_JOB_NOT_FOUND', async () => {
    const res = await DELETE(createGetRequest('nonexistent-job-id'));
    const { status, body } = await parseGetResponse(res);
    expect(status).toBe(404);
    expect(body.error?.code).toBe('GESP6_JOB_NOT_FOUND');
  });

  it('取消 processing 任务 → 200 success', async () => {
    // 让 solve 永远 pending，确保任务处于 processing 状态
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    const deleteRes = await DELETE(createGetRequest(jobId));
    const { status, body } = await parseGetResponse(deleteRes);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('取消已完成的任务 → 404（无法取消）', async () => {
    // 1. 创建任务并等待完成
    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;
    await flushMicrotasks();

    // 2. 任务已完成，取消应返回 404
    const deleteRes = await DELETE(createGetRequest(jobId));
    const { status, body } = await parseGetResponse(deleteRes);
    expect(status).toBe(404);
    expect(body.error?.code).toBe('GESP6_JOB_NOT_FOUND');
  });

  it('重复取消同一任务 → 第二次 404', async () => {
    mockSolve.mockReturnValue(new Promise(() => {}));

    const postRes = await POST(createPostRequest({
      problem: { type: 'text', content: '题目' },
    }));
    const { body: postBody } = await parsePostResponse(postRes);
    const jobId = postBody.data!.jobId;

    // 第一次取消 → 200
    const deleteRes1 = await DELETE(createGetRequest(jobId));
    const { status: status1 } = await parseGetResponse(deleteRes1);
    expect(status1).toBe(200);

    // 第二次取消 → 404（已是 cancelled 状态）
    const deleteRes2 = await DELETE(createGetRequest(jobId));
    const { status: status2 } = await parseGetResponse(deleteRes2);
    expect(status2).toBe(404);
  });
});
