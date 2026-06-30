// app/lib/ai/services/__tests__/code-validator-concurrency.test.ts
// CodeValidator 并发限制测试（P1 修复：COMPILE_MAX_CONCURRENT=2）
// 专门验证 compileLimiter 单例是否正确包裹 validate
//
// 策略：mock child_process 让编译慢速返回，避免依赖真实 g++ 与真实编译耗时
// 现有 code-validator.test.ts 用真实 g++ 跑真实编译，与本文件互补：
//   - code-validator.test.ts 验证编译逻辑正确性
//   - 本文件验证并发限制包裹行为

import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock child_process（让 execFile 慢速返回，模拟编译耗时）
// 签名与真实 execFile 一致：(cmd, args, opts, cb)
// 必须用 vi.hoisted 提升 mock 变量，避免 vi.mock 工厂引用未初始化的顶层变量
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
    ) => {
      // 默认立即返回 g++ 可用 + 编译成功
      cb(null, '', '');
    },
  ),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
  // spawn 仅在 runSample 调用，本测试无样例不涉及
  spawn: vi.fn(),
}));

// mock fs/promises（避免真实文件操作与临时目录创建）
vi.mock('fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/test-mock-xxx'),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { GppCodeValidator } from '../code-validator';

describe('GppCodeValidator 全局并发限制（P1 修复：COMPILE_MAX_CONCURRENT=2）', () => {
  let validator: GppCodeValidator;

  beforeEach(() => {
    validator = new GppCodeValidator();
    mockExecFile.mockReset();
  });

  it('3 个并发 validate，同时 in-flight 编译数不超过 2', async () => {
    let inflight = 0;
    let maxInflight = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
      ) => {
        // checkGppAvailable 调用：g++ --version
        if (args[0] === '--version') {
          cb(null, 'g++ 11.0', '');
          return;
        }
        // 编译调用：慢速返回（50ms）
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        setTimeout(() => {
          inflight--;
          cb(null, '', '');
        }, 50);
      },
    );

    const code = 'int main(){return 0;}';
    // 并发 3 个 validate 调用
    const promises = Array.from({ length: 3 }, () => validator.validate(code, []));
    await Promise.all(promises);

    // COMPILE_MAX_CONCURRENT=2，maxInflight 不应超过 2
    expect(maxInflight).toBeLessThanOrEqual(2);
    // 至少 2 个并发（验证限制起作用，而非完全串行）
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  it('第 3 个调用排队等待，总耗时 > 2 个批次', async () => {
    // 单次编译 50ms，3 个并发因 max=2，至少 2 批：50ms + 50ms ≈ 100ms
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === '--version') {
          cb(null, 'g++ 11.0', '');
          return;
        }
        setTimeout(() => cb(null, '', ''), 50);
      },
    );

    const start = Date.now();
    const code = 'int main(){return 0;}';
    const promises = Array.from({ length: 3 }, () => validator.validate(code, []));
    await Promise.all(promises);
    const elapsed = Date.now() - start;

    // 3 任务 max=2 → 至少 2 批 → 总耗时 ≥ 80ms（允许 30ms 调度容差）
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('checkGppAvailable 不受并发限制（立即返回）', async () => {
    // 即使编译被慢速 mock，g++ --version 应立即返回
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
      ) => {
        if (args[0] === '--version') {
          cb(null, 'g++ 11.0', '');
          return;
        }
        // 编译调用：永远不返回（验证 checkGppAvailable 不受并发限制）
        // 若 checkGppAvailable 被并发限制阻塞，本测试会超时
        // 但实际 checkGppAvailable 在 validate 入口先执行，不进 compileLimiter
        setTimeout(() => cb(null, '', ''), 1000);
      },
    );

    const start = Date.now();
    const result = await validator.validate('int main(){}', []);
    const elapsed = Date.now() - start;

    // validate 内部会等编译完成（1000ms），但 checkGppAvailable 部分应 < 50ms
    // 总耗时约 1000ms（编译等待），但应 < 1500ms（说明 checkGppAvailable 没被阻塞）
    expect(elapsed).toBeLessThan(1500);
    expect(result.success).toBe(true);
  });

  it('g++ 不可用时不进入并发限制（直接返回错误）', async () => {
    // g++ --version 报错 → checkGppAvailable 返回 false
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
      ) => {
        cb(new Error('command not found: g++'), '', '');
      },
    );

    const result = await validator.validate('int main(){}', []);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GESP6_COMPILE_ENV_ERROR');
  });
});
