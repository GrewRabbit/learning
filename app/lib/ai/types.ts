// app/lib/ai/types.ts
// AI 服务层共享类型定义（架构 §5.1）

/**
 * 服务层统一返回格式（遵循 api-conventions.md）
 */
export type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string; // MODULE_CATEGORY_SPECIFIC 格式，本系统统一 CPP_ 前缀
    message: string;
  };
};

/**
 * 聊天消息（文本模型）
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 流式输出 chunk
 */
export interface StreamChunk {
  content: string;
}

/**
 * 判断是否为 LLM 超时错误
 * OpenAI SDK 超时抛出 APIConnectionTimeoutError（架构 §5.6 CPP_AI_LLM_TIMEOUT）
 */
export function isLlmTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'APIConnectionTimeoutError' ||
      error.message.toLowerCase().includes('timeout')
    );
  }
  return false;
}

/**
 * 判断是否为用户主动取消（AbortError）
 * 当 AbortSignal 被 abort 时，底层 fetch/OpenAI SDK 抛出 name === 'AbortError' 的错误
 * 用于区分超时（timeout，error 级别）与用户取消（cancelled，info 级别）（架构 §4.4.3）
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
