// app/lib/ai/services/code-validator.ts
// CodeValidator 实现（架构 §5.1 接口 + §4.2 样例比对 + §8.2 g++ 沙箱）
// g++ 编译 + 样例 stdin/stdout 比对，失败返回失败样例信息

import { execFile, spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { logger } from '@/app/lib/logging/logger';
import type { ServiceResult, Sample, ValidationResult } from '@/app/lib/ai/types';
import { ConcurrencyLimiter } from './concurrency-limiter';

/** CodeValidator 接口（架构 §5.1） */
export interface CodeValidator {
  validate(code: string, samples: Sample[]): Promise<ServiceResult<ValidationResult>>;
}

/**
 * g++ 二进制名（CR1-013 修复）
 * 默认 g++-13（GESP 官方要求 g++ 13.2.0），可通过 GESP6_GPP_BINARY 环境变量覆盖
 * 以适配 g++-12/g++-14 或不同包名（如 g++）的部署环境
 */
const GPP_BINARY = process.env.GESP6_GPP_BINARY ?? 'g++-13';

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
    const validateStartTs = Date.now();
    logger.info('[CodeValidator.validate] 开始验证', {
      codeLength: code.length,
      codeLineCount: code.split('\n').length,
      samplesCount: samples.length,
    });

    // 检测 g++ 可用性（不受并发限制，仅快速检查）
    const gppCheckTs = Date.now();
    const gppAvailable = await this.checkGppAvailable();
    logger.info(`[CodeValidator.validate] ${GPP_BINARY} 可用性检查`, {
      available: gppAvailable,
      elapsedMs: Date.now() - gppCheckTs,
    });
    if (!gppAvailable) {
      logger.warn(`[CodeValidator.validate] ${GPP_BINARY} 不可用，跳过验证`, {
        codeLength: code.length,
      });
      return {
        success: false,
        error: {
          code: COMPILE_ENV_ERROR_CODE,
          message: `${GPP_BINARY} 编译器不可用，无法执行代码验证`,
        },
      };
    }

    // 全局并发限制（P1 修复：避免 g++ 编译耗尽 CPU）
    const result = await compileLimiter.run(() => this.validateInternal(code, samples));
    logger.info('[CodeValidator.validate] 验证完成', {
      compiled: result.data?.compiled,
      passed: result.data?.passed,
      failuresCount: result.data?.failures?.length,
      errorsCount: result.data?.errors?.length,
      errorCode: result.error?.code,
      totalElapsedMs: Date.now() - validateStartTs,
    });
    return result;
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
      logger.info('[CodeValidator.validateInternal] 临时目录已创建', {
        workDir,
        sourcePath,
        binaryPath,
      });

      // 写入源代码
      await writeFile(sourcePath, code, 'utf-8');

      // 编译（含 ulimit 沙箱）
      const compileResult = await this.compile(sourcePath, binaryPath);
      if (!compileResult.success) {
        logger.warn('[CodeValidator.validateInternal] 编译失败', {
          sourcePath,
          error: compileResult.error,
          errorPreview: compileResult.error?.slice(0, 500),
        });
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
      logger.info('[CodeValidator.validateInternal] 编译成功', {
        sourcePath,
        binaryPath,
      });

      // 运行样例
      const trimEnabled = false; // 默认严格比对（架构 §4.2）
      const failures: NonNullable<ValidationResult['failures']> = [];
      logger.info('[CodeValidator.validateInternal] 开始运行样例', {
        samplesCount: samples.length,
        trimEnabled,
      });
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const runStartTs = Date.now();
        const runResult = await this.runSample(binaryPath, sample.input);
        const runElapsedMs = Date.now() - runStartTs;
        if (!runResult.success) {
          logger.warn('[CodeValidator.validateInternal] 样例运行失败', {
            sampleIndex: i,
            runElapsedMs,
            error: runResult.error,
            inputPreview: sample.input.slice(0, 100),
          });
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
          logger.warn('[CodeValidator.validateInternal] 样例比对失败', {
            sampleIndex: i,
            runElapsedMs,
            inputPreview: sample.input.slice(0, 100),
            expectedPreview: expected.slice(0, 100),
            actualPreview: actual.slice(0, 100),
            expectedLength: expected.length,
            actualLength: actual.length,
          });
          failures.push({
            sampleIndex: i,
            input: sample.input,
            expected,
            actual,
          });
        } else {
          logger.info('[CodeValidator.validateInternal] 样例通过', {
            sampleIndex: i,
            runElapsedMs,
          });
        }
      }

      logger.info('[CodeValidator.validateInternal] 样例运行完成', {
        totalSamples: samples.length,
        passedCount: samples.length - failures.length,
        failedCount: failures.length,
      });

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
      logger.error('[CodeValidator.validateInternal] 验证过程异常', {
        message,
        workDir,
      });
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
        } catch (error) {
          // 清理失败仅记日志，不阻断（架构 §4.4 思路）
          logger.warn('[CodeValidator.validateInternal] 临时目录清理失败', {
            workDir,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * 检测 g++ 是否可用
   *
   * GESP 官方要求 g++ 13.2.0，本项目通过 ubuntu-toolchain-r/test PPA 安装 g++-13（GPP_BINARY 默认值）。
   * 若 g++ 不可用，Orchestrator 应跳过编译验证降级返回（§4.4）。
   */
  private async checkGppAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        GPP_BINARY,
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
    const compileStartTs = Date.now();
    return new Promise((resolve) => {
      // ulimit 沙箱（架构 §8.2）：
      // -t 10: CPU 10s
      // -v 262144: 虚拟内存 256MB
      // -n 64: 文件描述符
      // -u 1: 单进程（防 fork bomb）
      const ulimitPrefix = 'ulimit -t 10 -v 262144 -n 64 -u 1;';
      // GESP 官方编译环境：g++ 13.2.0，编译选项 -O2 -std=c++11 -DONLINE_JUDGE
      // -std=c++11：与 GESP 官方一致，避免 LLM 生成 c++14/17 特性导致官方环境编译失败
      // -DONLINE_JUDGE：定义 ONLINE_JUDGE 宏（GESP 官方要求）
      const cmd = `${ulimitPrefix} ${GPP_BINARY} "${sourcePath}" -o "${binaryPath}" -O2 -std=c++11 -DONLINE_JUDGE`;
      logger.info(`[CodeValidator.compile] 调用 ${GPP_BINARY} 编译`, {
        sourcePath,
        binaryPath,
        timeoutMs: COMPILE_TIMEOUT_MS,
      });
      execFile(
        'bash',
        ['-c', cmd],
        { timeout: COMPILE_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          const elapsedMs = Date.now() - compileStartTs;
          if (error) {
            logger.warn('[CodeValidator.compile] g++ 编译失败', {
              sourcePath,
              elapsedMs,
              errorMessage: error.message,
              stderr: stderr ? stderr.slice(0, 500) : '',
            });
            resolve({
              success: false,
              error: stderr || error.message,
            });
            return;
          }
          logger.info('[CodeValidator.compile] g++ 编译成功', {
            sourcePath,
            binaryPath,
            elapsedMs,
          });
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
