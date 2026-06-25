// app/lib/env.ts
// 环境变量验证（架构 §7.3，含模块级缓存机制 envValidated）

const requiredEnvVars = [
  'AI_VISION_PROVIDER',
  'AI_VISION_MODEL',
  'AI_TEXT_PROVIDER',
  'AI_TEXT_MODEL',
] as const;

const providerKeyMap: Record<string, string> = {
  glm: 'GLM_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'KIMI_API_KEY',
  qwen: 'QWEN_API_KEY',
};

const providerBaseUrlMap: Record<string, string> = {
  glm: 'GLM_BASE_URL',
  deepseek: 'DEEPSEEK_BASE_URL',
  kimi: 'KIMI_BASE_URL',
  qwen: 'QWEN_BASE_URL',
};

// 模块级缓存标志：首次校验通过后置为 true，后续调用直接 return，避免重复遍历环境变量（AR1-012）
let envValidated = false;

/**
 * 验证必需的环境变量
 * 首次调用执行完整校验，通过后置 envValidated = true；后续调用直接 return
 * 调用时机：AI 服务层方法内部首次调用时执行（非模块级调用）
 */
export function validateEnv(): void {
  // 缓存命中：已校验通过，直接返回
  if (envValidated) {
    return;
  }

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const visionProvider = process.env.AI_VISION_PROVIDER;
  const textProvider = process.env.AI_TEXT_PROVIDER;
  const visionKey = providerKeyMap[visionProvider ?? ''];
  const textKey = providerKeyMap[textProvider ?? ''];
  const visionBaseUrl = providerBaseUrlMap[visionProvider ?? ''];
  const textBaseUrl = providerBaseUrlMap[textProvider ?? ''];

  if (visionKey && !process.env[visionKey]) {
    throw new Error(`Missing API Key for vision provider: ${visionProvider}`);
  }
  if (textKey && !process.env[textKey]) {
    throw new Error(`Missing API Key for text provider: ${textProvider}`);
  }
  if (visionBaseUrl && !process.env[visionBaseUrl]) {
    throw new Error(`Missing BASE_URL for vision provider: ${visionProvider}`);
  }
  if (textBaseUrl && !process.env[textBaseUrl]) {
    throw new Error(`Missing BASE_URL for text provider: ${textProvider}`);
  }

  // 校验全部通过后置为 true，后续调用直接 return
  envValidated = true;
}

/**
 * 重置环境变量校验缓存（仅用于测试场景）
 */
export function resetEnvValidation(): void {
  envValidated = false;
}

/**
 * 获取 provider 对应的 API Key 环境变量名
 */
export function getProviderKeyName(provider: string): string | undefined {
  return providerKeyMap[provider];
}

/**
 * 获取 provider 对应的 BASE_URL 环境变量名
 */
export function getProviderBaseUrlName(provider: string): string | undefined {
  return providerBaseUrlMap[provider];
}
