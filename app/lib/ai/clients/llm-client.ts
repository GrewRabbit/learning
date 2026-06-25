// app/lib/ai/clients/llm-client.ts
// 统一 OpenAI 兼容客户端（文本模型，ADR-06）
// 使用 openai npm 包，支持流式与非流式调用

import OpenAI from 'openai';
import type { ChatMessage, StreamChunk } from '@/app/lib/ai/types';
import { getTextConfig } from '@/app/lib/ai/config';

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
   * 流式调用文本模型
   * @param messages 聊天消息数组
   * @returns 流式 chunk 异步迭代器
   */
  async *chatStream(messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
    const config = getTextConfig();
    const client = this.getClient();
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? '';
      if (content) {
        yield { content };
      }
    }
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
      messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: false,
    });
    return response.choices[0]?.message?.content ?? '';
  }
}

export const llmClient = new LlmClient();
