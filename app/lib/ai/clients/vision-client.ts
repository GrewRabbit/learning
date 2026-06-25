// app/lib/ai/clients/vision-client.ts
// 视觉模型客户端（多模态，OpenAI 兼容接口）
// 用于图片识别（FR-003），在 messages 中传入 image_url 类型（base64 data URL）

import OpenAI from 'openai';
import { getVisionConfig } from '@/app/lib/ai/config';

/**
 * 多模态消息内容类型
 */
type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * 多模态消息
 */
export interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | VisionContentPart[];
}

/**
 * 视觉模型客户端（多模态）
 * 根据 config.ts 的 provider 配置动态构造 baseURL 和 apiKey
 * 支持 Kimi Vision / 通义千问 VL 等兼容 OpenAI 接口的多模态模型
 */
export class VisionClient {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (this.client === null) {
      const config = getVisionConfig();
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: 30000,
        maxRetries: 0,
      });
    }
    return this.client;
  }

  /**
   * 非流式调用视觉模型
   * @param messages 多模态消息数组（含 image_url）
   * @returns 完整响应文本
   */
  async chat(messages: VisionMessage[]): Promise<string> {
    const config = getVisionConfig();
    const client = this.getClient();
    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: false,
    });
    return response.choices[0]?.message?.content ?? '';
  }
}

export const visionClient = new VisionClient();
