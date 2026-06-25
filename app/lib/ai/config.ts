// app/lib/ai/config.ts
// 模型配置（从 env 读取，架构 §7.3，FR-010）

import {
  validateEnv,
  getProviderKeyName,
  getProviderBaseUrlName,
} from '@/app/lib/env';

/**
 * 模型配置（provider/model/apiKey/baseUrl）
 */
export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

/**
 * 获取文本模型配置（代码生成、流程图、思维导图）
 * 调用前会先执行 validateEnv() 确保环境变量已配置
 */
export function getTextConfig(): ModelConfig {
  validateEnv();
  const provider = process.env.AI_TEXT_PROVIDER;
  const model = process.env.AI_TEXT_MODEL;
  if (!provider || !model) {
    throw new Error('AI_TEXT_PROVIDER or AI_TEXT_MODEL not configured');
  }
  const apiKeyName = getProviderKeyName(provider);
  const baseUrlName = getProviderBaseUrlName(provider);
  if (!apiKeyName || !baseUrlName) {
    throw new Error(`Unknown text provider: ${provider}`);
  }
  const apiKey = process.env[apiKeyName];
  const baseUrl = process.env[baseUrlName];
  if (!apiKey || !baseUrl) {
    throw new Error(`Missing API Key or BASE_URL for text provider: ${provider}`);
  }
  return { provider, model, apiKey, baseUrl };
}

/**
 * 获取视觉模型配置（图片识别）
 * 调用前会先执行 validateEnv() 确保环境变量已配置
 */
export function getVisionConfig(): ModelConfig {
  validateEnv();
  const provider = process.env.AI_VISION_PROVIDER;
  const model = process.env.AI_VISION_MODEL;
  if (!provider || !model) {
    throw new Error('AI_VISION_PROVIDER or AI_VISION_MODEL not configured');
  }
  const apiKeyName = getProviderKeyName(provider);
  const baseUrlName = getProviderBaseUrlName(provider);
  if (!apiKeyName || !baseUrlName) {
    throw new Error(`Unknown vision provider: ${provider}`);
  }
  const apiKey = process.env[apiKeyName];
  const baseUrl = process.env[baseUrlName];
  if (!apiKey || !baseUrl) {
    throw new Error(`Missing API Key or BASE_URL for vision provider: ${provider}`);
  }
  return { provider, model, apiKey, baseUrl };
}
