#!/usr/bin/env node
// scripts/dev.mjs
// 开发服务器启动器：参数透传给 next dev，并支持 --test 关闭中间件限流（等价 dev:test）。
//
// 用法：
//   npm run dev             # 正常开发（默认限流 20 次/分/IP）
//   npm run dev -- --test   # 测试模式：关闭限流（等价 npm run dev:test，供 E2E 密集请求）
//
// 背景：middleware.ts 限流 20 次/分/IP，E2E 多 spec 密集请求会 429 假失败。
// dev:test 通过 env 关闭限流；--test 标志使 npm run dev 也能一键进入测试模式。
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
// 直接解析 next 入口，避免依赖 npm 注入的 node_modules/.bin PATH（手动 node scripts/dev.mjs 亦可运行）
const nextBin = require.resolve('next/dist/bin/next');

const args = process.argv.slice(2);
const testIndex = args.indexOf('--test');
if (testIndex !== -1) {
  args.splice(testIndex, 1);
  process.env.GESP6_RATE_LIMIT_ENABLED = '0';
  process.env.GESP6_RATE_LIMIT_MAX = '100000';
}

const child = spawn(process.execPath, [nextBin, 'dev', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});