// app/lib/logging/logger.ts
// 应用日志（dev-workflow.md 日志规范，NFR-016）

type LogLevel = 'info' | 'error' | 'warn' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * 应用日志工具
 * - 应用日志使用 logger.info() / logger.error()
 * - 中间件禁止使用 logger（Edge Runtime 限制），改用 console
 * - 客户端组件禁止使用 logger（Client Runtime 限制），改用 logClientError()
 * - 禁止输出 API Key、用户密码、完整数据库错误栈等敏感信息
 */
export const logger = {
  info(message: string, context?: LogContext): void {
    console.log(formatLog('info', message, context));
  },

  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context));
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context));
  },

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(formatLog('debug', message, context));
    }
  },
};
