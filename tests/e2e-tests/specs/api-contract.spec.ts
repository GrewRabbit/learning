// tests/e2e-tests/specs/api-contract.spec.ts
// API 契约测试（testing-standards.md §四：@fast 标签）
// 直接测试 /api/solve 和 /api/health 的接口契约，不依赖 LLM
// 使用 page.request (APIRequestContext) 发送 HTTP 请求，不经过浏览器
//
// 限流处理：middleware.ts 对 /api/* 限流 5 次/分钟/IP。
// 运行前提：需以 npm run dev:test 启动 dev server（关闭中间件限流）；playwright.config webServer 已自动使用。
// 手动起服务若用 npm run dev，默认 20 次/分/IP 限流会导致本用例假失败。
// 本文件发起多次 POST，通过 x-forwarded-for 注入唯一 IP 避免限流干扰，
// 真实校验逻辑（Zod + resolvePlatform）仍在路由层执行。

import { test, expect } from '@playwright/test';

/** /api/solve 错误响应结构（ServiceResult 失败态） */
type SolveErrorResponse = {
  success: false;
  error: { code: string; message: string };
};

/** 生成唯一测试 IP（TEST-NET-2 段，避免与真实 IP 冲突） */
let ipSeq = 0;
function testIp(): string {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
}

test.describe('API 契约测试 @fast @no-llm', () => {
  test('GET /api/health 返回 200 + {status, timestamp}', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });

  test('POST /api/solve 缺少 problem 字段 → 400 + GESP6_INPUT_INVALID', async ({ page }) => {
    const response = await page.request.post('/api/solve', {
      data: {},
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
    expect(body.error.message).toBeTruthy();
  });

  test('POST /api/solve type 非法值 → 400', async ({ page }) => {
    const response = await page.request.post('/api/solve', {
      data: { problem: { type: 'unknown', content: 'test' } },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve text 超长（10001 字符）→ 400', async ({ page }) => {
    const response = await page.request.post('/api/solve', {
      data: { problem: { type: 'text', content: 'a'.repeat(10_001) } },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve platform http:// URL → 400', async ({ page }) => {
    const response = await page.request.post('/api/solve', {
      data: {
        problem: { type: 'platform', content: 'http://www.luogu.com.cn/problem/P1001' },
      },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve platform 不支持平台 → 400', async ({ page }) => {
    const response = await page.request.post('/api/solve', {
      data: {
        problem: { type: 'platform', content: 'https://example.com/problem/1' },
      },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve 非法 JSON 语法 → 400 + 提示非合法 JSON', async ({ page }) => {
    // page.request.post 的 data 字符串会被当作 JSON 值序列化（非 raw body），
    // 因此用 page.request.fetch + Buffer 发送 raw body，触发 req.json() 的 SyntaxError，
    // 覆盖 route.ts 的 JSON 解析 catch 分支（返回 message 含 "JSON"）
    const response = await page.request.fetch('/api/solve', {
      method: 'POST',
      data: Buffer.from('{invalid json'),
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
    expect(body.error.message).toContain('JSON');
  });

  test('POST /api/solve 合法洛谷 URL 但题号不存在 → 非 400 + ServiceResult 格式', async ({ page }) => {
    // P999999 不存在：通过 Zod 校验（非 400），抓取失败应返回 500
    // 仅验证通过校验层 + 响应符合 ServiceResult 结构（不验证成功）
    test.setTimeout(30_000);
    const response = await page.request.post('/api/solve', {
      data: {
        problem: { type: 'platform', content: 'https://www.luogu.com.cn/problem/P999999' },
      },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).not.toBe(400);
    const body = (await response.json()) as {
      success: boolean;
      error?: { code: string; message: string };
    };
    expect(typeof body.success).toBe('boolean');
    if (!body.success) {
      expect(body.error?.code).toBeTruthy();
      expect(body.error?.message).toBeTruthy();
    }
  });

  test('所有错误响应均包含 {success:false, error:{code, message}} 结构', async ({ page }) => {
    // 抽取代表性错误用例验证结构一致性
    const cases = [
      { data: {}, desc: 'missing problem' },
      { data: { problem: { type: 'bad', content: '' } }, desc: 'bad type' },
      { data: { problem: { type: 'platform', content: 'https://nope.example/x' } }, desc: 'bad platform' },
    ];
    for (const c of cases) {
      const response = await page.request.post('/api/solve', {
        data: c.data,
        headers: { 'x-forwarded-for': testIp() },
      });
      expect(response.status()).toBe(400);
      const body = (await response.json()) as SolveErrorResponse;
      expect(body.success).toBe(false);
      expect(typeof body.error.code).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });

  test('GET /api/solve 缺少 jobId → 400 + GESP6_INPUT_INVALID', async ({ page }) => {
    const response = await page.request.get('/api/solve');
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('GET /api/solve 不存在的 jobId → 404 + GESP6_JOB_NOT_FOUND', async ({ page }) => {
    const response = await page.request.get('/api/solve?jobId=nonexistent-job-id-12345');
    expect(response.status()).toBe(404);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_JOB_NOT_FOUND');
  });
});

test.describe('DELETE /api/solve?jobId=xxx（取消任务） @fast @no-llm', () => {
  test('DELETE 缺少 jobId → 400 + GESP6_INPUT_INVALID', async ({ page }) => {
    const response = await page.request.delete('/api/solve');
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
    expect(body.error.message).toContain('jobId');
  });

  test('DELETE 不存在的 jobId → 404 + GESP6_JOB_NOT_FOUND', async ({ page }) => {
    const response = await page.request.delete('/api/solve?jobId=nonexistent-job-id-67890');
    expect(response.status()).toBe(404);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_JOB_NOT_FOUND');
  });

  test('POST 创建任务 → DELETE 取消 → GET 返回 GESP6_CANCELLED', async ({ page }) => {
    // 端到端取消流程：POST 立即返回 jobId（后台 LLM 调用未完成）→ DELETE 取消 → GET 确认已取消
    // 依赖：POST 必须立即返回 jobId（不阻塞等待 LLM），且后台任务尚未完成
    // 竞态处理：若后台任务在 DELETE 前已完成/失败，DELETE 返回 404 → 测试跳过（不视为失败）
    test.setTimeout(30_000);

    // 1. POST 创建任务（使用长文本延长 LLM 处理时间，降低竞态概率）
    const postResponse = await page.request.post('/api/solve', {
      data: {
        problem: {
          type: 'text',
          content: '请详细分析以下算法的时间复杂度：' + 'a'.repeat(500),
        },
      },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(postResponse.status()).toBe(200);
    const postBody = (await postResponse.json()) as { success: true; data: { jobId: string } };
    expect(postBody.success).toBe(true);
    expect(postBody.data.jobId).toBeTruthy();
    const jobId = postBody.data.jobId;

    // 2. 立即 DELETE 取消任务（job 应仍处于 processing 状态）
    const deleteResponse = await page.request.delete(`/api/solve?jobId=${jobId}`);
    const deleteStatus = deleteResponse.status();

    if (deleteStatus === 404) {
      // 竞态：后台任务在 DELETE 前已完成/失败（LLM 未配置或超快失败）
      // 此情况不是契约违反，跳过后续断言
      test.skip(true, '后台任务在 DELETE 前已结束（竞态），跳过取消流程验证');
      return;
    }

    expect(deleteStatus).toBe(200);
    const deleteBody = (await deleteResponse.json()) as { success: true; data: { cancelled: boolean } };
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.data.cancelled).toBe(true);

    // 3. GET 查询状态 → 应返回 GESP6_CANCELLED
    const getResponse = await page.request.get(`/api/solve?jobId=${jobId}`);
    const getBody = (await getResponse.json()) as SolveErrorResponse;
    expect(getBody.success).toBe(false);
    expect(getBody.error.code).toBe('GESP6_CANCELLED');
  });

  test('DELETE 已取消的任务 → 404（cancelJob 仅允许 processing → cancelled）', async ({ page }) => {
    // 重复取消：第一次取消成功后，第二次应返回 404（状态已变为 cancelled，非 processing）
    test.setTimeout(30_000);

    // 1. POST 创建任务
    const postResponse = await page.request.post('/api/solve', {
      data: {
        problem: {
          type: 'text',
          content: '请详细分析以下算法的空间复杂度：' + 'b'.repeat(500),
        },
      },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(postResponse.status()).toBe(200);
    const postBody = (await postResponse.json()) as { success: true; data: { jobId: string } };
    const jobId = postBody.data.jobId;

    // 2. 第一次 DELETE（应成功或 404 若竞态）
    const firstDelete = await page.request.delete(`/api/solve?jobId=${jobId}`);
    if (firstDelete.status() === 404) {
      test.skip(true, '后台任务在 DELETE 前已结束（竞态），跳过重复取消验证');
      return;
    }
    expect(firstDelete.status()).toBe(200);

    // 3. 第二次 DELETE（应返回 404，因为状态已是 cancelled）
    const secondDelete = await page.request.delete(`/api/solve?jobId=${jobId}`);
    expect(secondDelete.status()).toBe(404);
    const secondBody = (await secondDelete.json()) as SolveErrorResponse;
    expect(secondBody.success).toBe(false);
    expect(secondBody.error.code).toBe('GESP6_JOB_NOT_FOUND');
  });
});
