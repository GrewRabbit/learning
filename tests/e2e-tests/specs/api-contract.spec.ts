// tests/e2e-tests/specs/api-contract.spec.ts
// API 契约测试（testing-standards.md §四：@fast 标签）
// 直接测试 /api/solve 和 /api/health 的接口契约，不依赖 LLM
// 使用 page.request (APIRequestContext) 发送 HTTP 请求，不经过浏览器
//
// 限流处理：middleware.ts 对 /api/* 限流 5 次/分钟/IP。
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

test.describe('API 契约测试 @fast', () => {
  test('GET /api/health 返回 200 + {status, timestamp}', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });

  test('POST /api/solve 缺少 problem 字段 → 400 + GESP6_INPUT_INVALID', async ({ request }) => {
    const response = await request.post('/api/solve', {
      data: {},
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
    expect(body.error.message).toBeTruthy();
  });

  test('POST /api/solve type 非法值 → 400', async ({ request }) => {
    const response = await request.post('/api/solve', {
      data: { problem: { type: 'unknown', content: 'test' } },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve text 超长（10001 字符）→ 400', async ({ request }) => {
    const response = await request.post('/api/solve', {
      data: { problem: { type: 'text', content: 'a'.repeat(10_001) } },
      headers: { 'x-forwarded-for': testIp() },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as SolveErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GESP6_INPUT_INVALID');
  });

  test('POST /api/solve platform http:// URL → 400', async ({ request }) => {
    const response = await request.post('/api/solve', {
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

  test('POST /api/solve platform 不支持平台 → 400', async ({ request }) => {
    const response = await request.post('/api/solve', {
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

  test('POST /api/solve 非法 JSON 语法 → 400 + 提示非合法 JSON', async ({ request }) => {
    // request.post 的 data 字符串会被当作 JSON 值序列化（非 raw body），
    // 因此用 request.fetch + Buffer 发送 raw body，触发 req.json() 的 SyntaxError，
    // 覆盖 route.ts 的 JSON 解析 catch 分支（返回 message 含 "JSON"）
    const response = await request.fetch('/api/solve', {
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

  test('POST /api/solve 合法洛谷 URL 但题号不存在 → 非 400 + ServiceResult 格式', async ({ request }) => {
    // P999999 不存在：通过 Zod 校验（非 400），抓取失败应返回 500
    // 仅验证通过校验层 + 响应符合 ServiceResult 结构（不验证成功）
    test.setTimeout(30_000);
    const response = await request.post('/api/solve', {
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

  test('所有错误响应均包含 {success:false, error:{code, message}} 结构', async ({ request }) => {
    // 抽取代表性错误用例验证结构一致性
    const cases = [
      { data: {}, desc: 'missing problem' },
      { data: { problem: { type: 'bad', content: '' } }, desc: 'bad type' },
      { data: { problem: { type: 'platform', content: 'https://nope.example/x' } }, desc: 'bad platform' },
    ];
    for (const c of cases) {
      const response = await request.post('/api/solve', {
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
});
