// app/lib/ai/services/code-validator.ts
// CodeValidator 实现（架构 §5.1 接口 + §4.2 样例比对 + §8.2 g++ 沙箱）
// g++ 编译 + 样例 stdin/stdout 比对，失败返回失败样例信息

import { execFile, spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { ServiceResult, Sample, ValidationResult } from '@/app/lib/ai/types';
import { ConcurrencyLimiter } from './concurrency-limiter';

/** CodeValidator 接口（架构 §5.1） */
export interface CodeValidator {
  validate(code: string, samples: Sample[]): Promise<ServiceResult<ValidationResult>>;
}

/** g++ 编译超时（秒） */
const COMPILE_TIMEOUT_MS = 10_000;
/** 样例运行超时（秒） */
const RUN_TIMEOUT_MS = 5_000;
/** g++ 环境不可用错误码（架构 §5.4） */
const COMPILE_ENV_ERROR_CODE = 'GESP6_COMPILE_ENV_ERROR';
/**
 * g++ 编译全局并发上限（P1 修复）
 * 设为 2 的原因：
 * - g++ 编译是 CPU 密集型操作，过多并发会耗尽 CPU
 * - 单核服务器 2 个并发编译已接近上限（每个编译最多 10s CPU）
 * - 多核服务器可适当调高（通过环境变量 GESP6_COMPILE_CONCURRENCY 配置）
 */
const COMPILE_MAX_CONCURRENT = Number(process.env.GESP6_COMPILE_CONCURRENCY) || 2;
/** g++ 编译全局并发限制器（模块级单例） */
const compileLimiter = new ConcurrencyLimiter(COMPILE_MAX_CONCURRENT);

/**
 * CodeValidator 实现
 *
 * g++ 沙箱（架构 §8.2）：
 * - 临时目录（mktemp -d，编译后 rm -rf）
 * - 超时 10s
 * - ulimit：-t 10（CPU 10s）+ -v 262144（虚拟内存 256MB）+ -n 64（文件描述符）+ -u 1（单进程）
 * - 通过 child_process.execFile 调用，包裹在 ulimit 子 shell 中
 *
 * 样例比对策略（架构 §4.2）：
 * - 默认严格比对；trimEnabled=true 时 trim() 后比对（忽略末尾空白字符）
 * - 部分失败：所有失败样例均携带进入修正循环
 */
export class GppCodeValidator implements CodeValidator {
  /**
   * 检测 g++ 是否可用
   * g++ 不可用时 Orchestrator 应跳过编译验证降级返回（§4.4），此处返回错误码供 Orchestrator 判断
   */
  async validate(
    code: string,
    samples: Sample[],
  ): Promise<ServiceResult<ValidationResult>> {
    // 检测 g++ 可用性（不受并发限制，仅快速检查）
    const gppAvailable = await this.checkGppAvailable();
    if (!gppAvailable) {
      return {
        success: false,
        error: {
          code: COMPILE_ENV_ERROR_CODE,
          message: 'g++ 编译器不可用，无法执行代码验证',
        },
      };
    }

    // 全局并发限制（P1 修复：避免 g++ 编译耗尽 CPU）
    return compileLimiter.run(() => this.validateInternal(code, samples));
  }

  /**
   * 实际的编译 + 样例运行逻辑（在并发限制内执行）
   */
  private async validateInternal(
    code: string,
    samples: Sample[],
  ): Promise<ServiceResult<ValidationResult>> {
    let workDir: string | null = null;
    try {
      // 创建临时目录
      workDir = await mkdtemp(path.join(tmpdir(), 'gesp6-compile-'));
      const sourcePath = path.join(workDir, 'solution.cpp');
      const binaryPath = path.join(workDir, 'solution');

      // 写入源代码
      await writeFile(sourcePath, code, 'utf-8');

      // 编译（含 ulimit 沙箱）
      const compileResult = await this.compile(sourcePath, binaryPath);
      if (!compileResult.success) {
        return {
          success: true,
          data: {
            compiled: false,
            passed: false,
            errors: [compileResult.error ?? '编译失败'],
            trimEnabled: false,
          },
        };
      }

      // 运行样例
      const trimEnabled = false; // 默认严格比对（架构 §4.2）
      const failures: NonNullable<ValidationResult['failures']> = [];
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const runResult = await this.runSample(binaryPath, sample.input);
        if (!runResult.success) {
          failures.push({
            sampleIndex: i,
            input: sample.input,
            expected: sample.expectedOutput,
            actual: `运行失败：${runResult.error}`,
          });
          continue;
        }
        const actual = runResult.output;
        const expected = sample.expectedOutput;
        const passed = trimEnabled
          ? actual.trim() === expected.trim()
          : actual === expected;
        if (!passed) {
          failures.push({
            sampleIndex: i,
            input: sample.input,
            expected,
            actual,
          });
        }
      }

      return {
        success: true,
        data: {
          compiled: true,
          passed: failures.length === 0,
          errors: [],
          trimEnabled,
          failures: failures.length > 0 ? failures : undefined,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: true,
        data: {
          compiled: false,
          passed: false,
          errors: [`验证过程异常：${message}`],
          trimEnabled: false,
        },
      };
    } finally {
      // 清理临时目录
      if (workDir) {
        try {
          await rm(workDir, { recursive: true, force: true });
        } catch {
          // 清理失败仅记日志，不阻断（架构 §4.4 思路）
        }
      }
    }
  }

  /**
   * 检测 g++ 是否可用
   */
  private async checkGppAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        'g++',
        ['--version'],
        { timeout: 3_000 },
        (error) => {
          resolve(!error);
        },
      );
    });
  }

  /**
   * 编译 C++ 源代码（含 ulimit 沙箱）
   */
  private async compile(
    sourcePath: string,
    binaryPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // ulimit 沙箱（架构 §8.2）：
      // -t 10: CPU 10s
      // -v 262144: 虚拟内存 256MB
      // -n 64: 文件描述符
      // -u 1: 单进程（防 fork bomb）
      const ulimitPrefix = 'ulimit -t 10 -v 262144 -n 64 -u 1;';
      const cmd = `${ulimitPrefix} g++ "${sourcePath}" -o "${binaryPath}" -std=c++17 -O2`;
      execFile(
        'bash',
        ['-c', cmd],
        { timeout: COMPILE_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              error: stderr || error.message,
            });
            return;
          }
          resolve({ success: true });
        },
      );
    });
  }

  /**
   * 运行单个样例（spawn + stdin 写入，execFile 不支持 input 字段）
   */
  private async runSample(
    binaryPath: string,
    stdin: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(
        'bash',
        ['-c', `ulimit -t 10 -v 262144 -n 64 -u 1; "${binaryPath}"`],
        { timeout: RUN_TIMEOUT_MS },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      child.on('error', (error: Error) => {
        resolve({ success: false, output: '', error: error.message });
      });
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          resolve({
            success: false,
            output: '',
            error: stderr || `退出码 ${code}`,
          });
          return;
        }
        resolve({ success: true, output: stdout });
      });
      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}

/** 单例导出（api-conventions.md） */
export const codeValidator = new GppCodeValidator();
