// app/api/solution/__tests__/route.test.ts
// SSE Route Handler 单元测试（架构 §5.3，FR-006~009，AC-019）
// 覆盖：Zod 验证失败、正常流式、非流式 fallback 降级、Stage 1 致命错误、abort 取消、流外异常

import { vi, describe, it, expect, beforeEach, type MockedFunction } from 'vitest';
import { NextRequest } from 'next/server';
import type { ServiceResult } from '@/app/lib/ai/types';

// Mock 依赖：solutionService + logger（禁止真实 AI 调用）
vi.mock('@/app/lib/ai/services/solution-service', () => ({
  solutionService: {
    generateStream: vi.fn(),
  },
}));

vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/solution/route';
import { solutionService } from '@/app/lib/ai/services/solution-service';
import { logger } from '@/app/lib/logging/logger';

const mockedGenerateStream = solutionService.generateStream as MockedFunction<
  typeof solutionService.generateStream
>;

/** SSE 事件结构 */
interface SSEEvent {
  event: string;
  data: string;
}

/** generateStream 返回值类型（用于构造 mock 返回值） */
type GenerateStreamResult = ServiceResult<{
  code: string;
  analysis: string;
  fallback?: boolean;
}>;

/**
 * 读取 SSE 流并解析为事件列表
 * 按 `event: {name}\ndata: {json}\n\n` 格式解析（架构 §4.4.1 事件格式）
 */
async function readSSEEvents(response: Response): Promise<SSEEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SSEEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.trim()) continue;
      let evtName = '';
      let dataStr = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) {
          evtName = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataStr += line.slice(6);
        }
      }
      if (evtName) {
        events.push({ event: evtName, data: dataStr });
      }
    }
  }
  return events;
}

/** 构造 NextRequest（含 JSON body 与可选 signal） */
function createRequest(body: unknown, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/solution', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** 解析 SSE 事件的 data 字段为指定类型 */
function parseData<T>(event: SSEEvent | undefined): T {
  if (!event) throw new Error('事件不存在');
  return JSON.parse(event.data) as T;
}

describe('POST /api/solution - SSE Route Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Zod 验证失败 → HTTP 400（NFR-008）', () => {
    it('should return 400 when problem 为空', async () => {
      const response = await POST(createRequest({ problem: '', mode: 'normal' }));

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CPP_INPUT_VALIDATION_ERROR');
    });

    it('should return 400 when problem 超过 10000 字符上限', async () => {
      const response = await POST(
        createRequest({ problem: 'a'.repeat(10001), mode: 'normal' }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('CPP_INPUT_VALIDATION_ERROR');
    });

    it('should return 400 when standardAnswer 超过 20000 字符上限', async () => {
      const response = await POST(
        createRequest({
          problem: '题目',
          standardAnswer: 'a'.repeat(20001),
          mode: 'normal',
        }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('CPP_INPUT_VALIDATION_ERROR');
    });

    it('should return 400 when mode 为非法值', async () => {
      const response = await POST(createRequest({ problem: '题目', mode: 'invalid' }));

      expect(response.status).toBe(400);
      const body = (await response.json()) as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('CPP_INPUT_VALIDATION_ERROR');
    });

    it('should not call generateStream when validation fails', async () => {
      await POST(createRequest({ problem: '', mode: 'normal' }));
      expect(mockedGenerateStream).not.toHaveBeenCalled();
    });
  });

  describe('正常流式生成（FR-007，AC-019）', () => {
    it('should send 完整 SSE 事件序列 when 流式生成成功', async () => {
      mockedGenerateStream.mockImplementation(async (_input, callbacks) => {
        callbacks.onCodeChunk('代码片段1');
        callbacks.onCodeChunk('代码片段2');
        callbacks.onAnalysisChunk('分析片段1');
        callbacks.onAnalysisChunk('分析片段2');
        return {
          success: true,
          data: { code: '代码片段1代码片段2', analysis: '分析片段1分析片段2' },
        };
      });

      const response = await POST(createRequest({ problem: '求两数之和', mode: 'normal' }));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');

      const events = await readSSEEvents(response);
      const names = events.map((e) => e.event);
      expect(names).toEqual([
        'stage1-start',
        'code-chunk',
        'code-chunk',
        'analysis-chunk',
        'analysis-chunk',
        'stage1-done',
        'stage2-start',
        'done',
      ]);

      // stage1-done 携带 codeEmpty/analysisEmpty 标志（FR-013，均非空）
      const stage1Done = events.find((e) => e.event === 'stage1-done');
      const doneData = parseData<{ codeEmpty: boolean; analysisEmpty: boolean }>(stage1Done);
      expect(doneData.codeEmpty).toBe(false);
      expect(doneData.analysisEmpty).toBe(false);
    });

    it('should pass problem/standardAnswer/mode to generateStream（AC-011 deep 模式）', async () => {
      mockedGenerateStream.mockResolvedValue({
        success: true,
        data: { code: '代码', analysis: '分析' },
      });

      await POST(
        createRequest({
          problem: '复杂题目',
          standardAnswer: '标准答案',
          mode: 'deep',
        }),
      );

      expect(mockedGenerateStream).toHaveBeenCalledTimes(1);
      expect(mockedGenerateStream).toHaveBeenCalledWith(
        { problem: '复杂题目', standardAnswer: '标准答案', mode: 'deep' },
        expect.objectContaining({
          onCodeChunk: expect.any(Function),
          onAnalysisChunk: expect.any(Function),
          onFormatInvalid: expect.any(Function),
        }),
        expect.any(AbortSignal),
      );
    });

    it('should set codeEmpty=true when 代码为空', async () => {
      mockedGenerateStream.mockImplementation(async (_input, callbacks) => {
        callbacks.onAnalysisChunk('仅有分析');
        return { success: true, data: { code: '', analysis: '仅有分析' } };
      });

      const response = await POST(createRequest({ problem: '题目', mode: 'normal' }));
      const events = await readSSEEvents(response);
      const stage1Done = events.find((e) => e.event === 'stage1-done');
      const doneData = parseData<{ codeEmpty: boolean; analysisEmpty: boolean }>(stage1Done);
      expect(doneData.codeEmpty).toBe(true);
      expect(doneData.analysisEmpty).toBe(false);
    });
  });

  describe('非流式 fallback 降级（架构 §4.2.3）', () => {
    it('should resend stage1-start when fallback=true 通知前端清空', async () => {
      mockedGenerateStream.mockResolvedValue({
        success: true,
        data: { code: '完整代码', analysis: '完整分析', fallback: true },
      });

      const response = await POST(createRequest({ problem: '题目', mode: 'normal' }));
      const events = await readSSEEvents(response);
      const names = events.map((e) => e.event);

      // stage1-start 被发送两次（首次 + fallback 重发通知前端清空已接收的部分内容）
      expect(names.filter((n) => n === 'stage1-start')).toHaveLength(2);
      expect(names).toEqual([
        'stage1-start',
        'stage1-start',
        'code-chunk',
        'analysis-chunk',
        'stage1-done',
        'stage2-start',
        'done',
      ]);

      // fallback 推送的 code-chunk / analysis-chunk 携带完整内容
      const codeChunk = events.find((e) => e.event === 'code-chunk');
      expect(parseData<{ content: string }>(codeChunk).content).toBe('完整代码');

      const analysisChunk = events.find((e) => e.event === 'analysis-chunk');
      expect(parseData<{ content: string }>(analysisChunk).content).toBe('完整分析');
    });

    it('should skip code-chunk when fallback 代码为空', async () => {
      mockedGenerateStream.mockResolvedValue({
        success: true,
        data: { code: '', analysis: '仅分析', fallback: true },
      });

      const response = await POST(createRequest({ problem: '题目', mode: 'normal' }));
      const events = await readSSEEvents(response);
      const names = events.map((e) => e.event);

      expect(names).toEqual([
        'stage1-start',
        'stage1-start',
        'analysis-chunk',
        'stage1-done',
        'stage2-start',
        'done',
      ]);

      const stage1Done = events.find((e) => e.event === 'stage1-done');
      const doneData = parseData<{ codeEmpty: boolean; analysisEmpty: boolean }>(stage1Done);
      expect(doneData.codeEmpty).toBe(true);
      expect(doneData.analysisEmpty).toBe(false);
    });
  });

  describe('Stage 1 致命错误（架构 §4.4.2）', () => {
    it('should send error event and close stream when generateStream 失败', async () => {
      mockedGenerateStream.mockResolvedValue({
        success: false,
        error: {
          code: 'CPP_AI_SOLUTION_GENERATION_FAILED',
          message: '解答生成失败，请重试',
        },
      });

      const response = await POST(createRequest({ problem: '题目', mode: 'normal' }));
      const events = await readSSEEvents(response);
      const names = events.map((e) => e.event);

      // 致命错误：stage1-start → error → 流关闭（不再发送 done，架构 §4.4.2）
      expect(names).toEqual(['stage1-start', 'error']);
      expect(names).not.toContain('done');
      expect(names).not.toContain('stage1-done');

      const errorEvent = events.find((e) => e.event === 'error');
      const errorData = parseData<{ code: string; message: string }>(errorEvent);
      expect(errorData.code).toBe('CPP_AI_SOLUTION_GENERATION_FAILED');
      expect(errorData.message).toBe('解答生成失败，请重试');
    });

    it('should use default code/message when error 字段缺失', async () => {
      mockedGenerateStream.mockResolvedValue({ success: false });

      const response = await POST(createRequest({ problem: '题目', mode: 'normal' }));
      const events = await readSSEEvents(response);
      const errorEvent = events.find((e) => e.event === 'error');
      const errorData = parseData<{ code: string; message: string }>(errorEvent);

      expect(errorData.code).toBe('CPP_AI_SOLUTION_GENERATION_FAILED');
      expect(errorData.message).toBe('解答生成失败，请重试');
    });
  });

  describe('abort 取消（FR-031，架构 §4.4.3）', () => {
    it('should close stream without done when user aborts', async () => {
      // 使用 deferred 控制 generateStream 的返回时机
      let resolveGenerateStream!: (value: GenerateStreamResult) => void;
      mockedGenerateStream.mockReturnValue(
        new Promise<GenerateStreamResult>((resolve) => {
          resolveGenerateStream = resolve;
        }),
      );

      const controller = new AbortController();
      const response = await POST(
        createRequest({ problem: '题目', mode: 'normal' }, controller.signal),
      );

      // 此时 stage1-start 已入队，generateStream 正在等待
      controller.abort();
      // 解析 generateStream（aborted 后会被短路，仍需 resolve 避免悬挂 Promise）
      resolveGenerateStream({
        success: true,
        data: { code: '代码', analysis: '分析' },
      });

      const events = await readSSEEvents(response);
      const names = events.map((e) => e.event);

      // 仅 stage1-start（abort 前已发送），无 done（流被 abort 关闭）
      expect(names).toEqual(['stage1-start']);
      expect(names).not.toContain('done');

      // 验证取消日志（架构 §4.4.3：info 级别 CPP_AI_GENERATION_CANCELLED）
      expect(logger.info).toHaveBeenCalledWith('用户取消生成', {
        code: 'CPP_AI_GENERATION_CANCELLED',
      });
    });
  });

  describe('流外异常 → HTTP 500（NFR-007）', () => {
    it('should return HTTP 500 when request.json() 失败', async () => {
      const request = new NextRequest('http://localhost/api/solution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = (await response.json()) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CPP_INTERNAL_ERROR');
      expect(body.error.message).toBe('系统内部错误，请稍后重试');
      expect(mockedGenerateStream).not.toHaveBeenCalled();
    });
  });
});
