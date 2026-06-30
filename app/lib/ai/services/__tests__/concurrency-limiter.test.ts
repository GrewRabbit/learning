// app/lib/ai/services/__tests__/concurrency-limiter.test.ts
// ConcurrencyLimiter 单元测试（P1 修复）
// 验证并发上限、FIFO 队列、错误传播、唤醒机制

import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyLimiter } from '../concurrency-limiter';

describe('ConcurrencyLimiter', () => {
  it('并发数不超过上限', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxActive = 0;

    const task = async (delay: number): Promise<void> => {
      maxActive = Math.max(maxActive, limiter.getActiveCount());
      await new Promise((r) => setTimeout(r, delay));
    };

    // 同时启动 3 个任务（max=2，第 3 个应排队）
    await Promise.all([
      limiter.run(() => task(50)),
      limiter.run(() => task(50)),
      limiter.run(() => task(50)),
    ]);

    expect(maxActive).toBe(2);
  });

  it('FIFO 顺序执行排队任务', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];

    const task = async (id: number, delay: number): Promise<number> => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(id);
      return id;
    };

    const results = await Promise.all([
      limiter.run(() => task(1, 30)),
      limiter.run(() => task(2, 30)),
      limiter.run(() => task(3, 30)),
    ]);

    // 验证结果正确
    expect(results).toEqual([1, 2, 3]);
    // 验证执行顺序（FIFO）
    expect(order).toEqual([1, 2, 3]);
  });

  it('任务完成后唤醒队列中下一个', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let secondStarted = false;

    const task1 = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 50));
    };
    const task2 = async (): Promise<void> => {
      secondStarted = true;
    };

    // 同时启动 2 个任务（max=1，第 2 个应排队）
    const p1 = limiter.run(task1);
    const p2 = limiter.run(task2);

    // 此时 task2 应未启动（排队中）
    expect(secondStarted).toBe(false);
    expect(limiter.getQueueLength()).toBe(1);

    await p1;
    // task1 完成后应唤醒 task2
    await p2;

    expect(secondStarted).toBe(true);
    expect(limiter.getActiveCount()).toBe(0);
    expect(limiter.getQueueLength()).toBe(0);
  });

  it('任务抛错时不影响后续任务执行', async () => {
    const limiter = new ConcurrencyLimiter(1);

    const failingTask = async (): Promise<string> => {
      throw new Error('task failed');
    };
    const successTask = async (): Promise<string> => 'success';

    // 第一个任务抛错
    await expect(limiter.run(failingTask)).rejects.toThrow('task failed');
    // 第二个任务应正常执行
    const result = await limiter.run(successTask);
    expect(result).toBe('success');
  });

  it('getActiveCount 与 getQueueLength 正确反映状态', async () => {
    const limiter = new ConcurrencyLimiter(2);

    expect(limiter.getActiveCount()).toBe(0);
    expect(limiter.getQueueLength()).toBe(0);

    // 启动 2 个任务（占满并发），用可控 resolve 避免自动完成
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();
    const resolve3 = vi.fn();
    const task1 = new Promise<void>((r) => {
      resolve1.mockImplementation(r);
    });
    const task2 = new Promise<void>((r) => {
      resolve2.mockImplementation(r);
    });
    const task3 = new Promise<void>((r) => {
      resolve3.mockImplementation(r);
    });

    const p1 = limiter.run(() => task1.then(() => 'r1'));
    const p2 = limiter.run(() => task2.then(() => 'r2'));

    // 等待任务进入运行状态
    await new Promise((r) => setTimeout(r, 10));

    expect(limiter.getActiveCount()).toBe(2);
    expect(limiter.getQueueLength()).toBe(0);

    // 启动第 3 个任务（应排队）
    const p3 = limiter.run(() => task3.then(() => 'r3'));
    await new Promise((r) => setTimeout(r, 10));

    expect(limiter.getActiveCount()).toBe(2);
    expect(limiter.getQueueLength()).toBe(1);

    // 完成 task1 → task3 应被唤醒 → active 仍为 2
    resolve1();
    await p1;
    await new Promise((r) => setTimeout(r, 10));

    expect(limiter.getActiveCount()).toBe(2);
    expect(limiter.getQueueLength()).toBe(0);

    // 完成剩余任务
    resolve2();
    resolve3();
    await p2;
    await p3;

    expect(limiter.getActiveCount()).toBe(0);
  });

  it('maxConcurrent=1 时串行执行', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const executionLog: string[] = [];

    const task = async (id: string, delay: number): Promise<string> => {
      executionLog.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, delay));
      executionLog.push(`${id}-end`);
      return id;
    };

    await Promise.all([
      limiter.run(() => task('a', 20)),
      limiter.run(() => task('b', 20)),
      limiter.run(() => task('c', 20)),
    ]);

    // 串行：a-start → a-end → b-start → b-end → c-start → c-end
    expect(executionLog).toEqual([
      'a-start',
      'a-end',
      'b-start',
      'b-end',
      'c-start',
      'c-end',
    ]);
  });
});
