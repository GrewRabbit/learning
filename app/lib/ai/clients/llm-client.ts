// app/lib/ai/clients/llm-client.ts
// 统一 OpenAI 兼容客户端（文本模型）
// 使用 openai npm 包，非流式调用（新架构无流式决策，§1.2）

import OpenAI from 'openai';
import { getTextConfig } from '@/app/lib/ai/config';

/**
 * 聊天消息（新架构 LLMInput.history 元素类型）
 * role 使用字面量联合类型，避免 any / unknown，并保证可直接传给
 * OpenAI ChatCompletionMessageParam（discriminated union 按字面量匹配）。
 */
type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/**
 * 统一 OpenAI 兼容客户端（文本模型）
 * 根据 config.ts 的 provider 配置动态构造 baseURL 和 apiKey
 * 支持 GLM/DeepSeek/Kimi/Qwen 等兼容 OpenAI 接口的模型
 */
export class LlmClient {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (this.client === null) {
      const config = getTextConfig();
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: 60000,
        maxRetries: 0,
      });
    }
    return this.client;
  }

  /**
   * 非流式调用文本模型
   * @param messages 聊天消息数组
   * @returns 完整响应文本
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    const config = getTextConfig();
    const client = this.getClient();
    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      stream: false,
    });
    return response.choices[0]?.message?.content ?? '';
  }
}

export const llmClient = new LlmClient();
