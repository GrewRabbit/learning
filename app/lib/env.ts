// app/lib/env.ts
// 环境变量验证（架构 §7.3，含模块级缓存机制 envValidated）
// SSO 分组校验（架构 §7.2，SSO 集成步骤 1，模块 M8，AR1-010）

import { logger } from '@/app/lib/logging/logger';

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

  // SSO 分组校验（架构 §7.2，SSO 集成步骤 1，模块 M8）
  validateSsoEnvVars();

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

// ---------------------------------------------------------------------------
// SSO 环境变量（架构 §7.2，SSO 集成步骤 1，模块 M8）
// 浏览器可见（NEXT_PUBLIC_ 前缀，无敏感值）与服务端（Node 层）两组
// ---------------------------------------------------------------------------

/** NEXT_PUBLIC_SSO_SCOPE 默认值（空格分隔，必含 openid + offline_access） */
const DEFAULT_SSO_SCOPE = 'openid profile email groups offline_access' as const;

/** ID_TOKEN_VERIFY_MODE 默认值：strict 拒登 / soft 记日志 */
const DEFAULT_ID_TOKEN_VERIFY_MODE = 'strict' as const;

/** SSO_REFRESH_TOKEN_MAX_AGE_DAYS 默认值（refresh_token cookie 持久化天数） */
const DEFAULT_SSO_REFRESH_TOKEN_MAX_AGE_DAYS = 30;

/** SSO_RETRY_MAX 默认值（IDP 调用重试上限） */
const DEFAULT_SSO_RETRY_MAX = 3;

/**
 * 解析后的 SSO 环境变量配置
 * 供后续步骤 lib/sso/config.ts 复用（SSO 集成步骤 1）
 */
export interface SsoEnvConfig {
  /** 服务端 issuer（SSO_ISSUER，Discovery/iss 校验契约，必填含 mock 模式） */
  issuer: string;
  /** 服务端 client_id（SSO_CLIENT_ID，Node 侧权威，必填） */
  clientId: string;
  /** 服务端 client_secret（SSO_CLIENT_SECRET，mock 模式可缺省；仅 Node 层引用，Edge 禁引用） */
  clientSecret?: string;
  /** id_token 验证模式（ID_TOKEN_VERIFY_MODE，默认 strict：strict 拒登 / soft 记日志） */
  idTokenVerifyMode: 'strict' | 'soft';
  /** refresh_token cookie 持久化天数（SSO_REFRESH_TOKEN_MAX_AGE_DAYS，默认 30） */
  refreshTokenMaxAgeDays: number;
  /** mock IDP 开关（SSO_MOCK_ENABLED='1' 启用，默认关闭） */
  mockEnabled: boolean;
  /** IDP 调用重试上限（SSO_RETRY_MAX，默认 3） */
  retryMax: number;
  /** 浏览器可见：IDP issuer（NEXT_PUBLIC_SSO_ISSUER） */
  publicIssuer?: string;
  /** 浏览器可见：client_id（NEXT_PUBLIC_SSO_CLIENT_ID） */
  publicClientId?: string;
  /** 浏览器可见：回调地址（NEXT_PUBLIC_SSO_REDIRECT_URI） */
  publicRedirectUri?: string;
  /** 浏览器可见：请求 scope（NEXT_PUBLIC_SSO_SCOPE，必含 openid + offline_access） */
  scope: string;
}

/**
 * 读取必填服务端环境变量（仅 getSsoEnv 内部使用，校验已在 validateSsoEnvVars 完成）
 */
function requireSsoEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * SSO 环境变量分组校验（架构 §7.2，AR1-010 mock 分支）
 * - 任何模式：NEXT_PUBLIC_SSO_CLIENT_SECRET 存在即抛错（敏感值禁止暴露到浏览器）
 * - 常规模式（SSO_MOCK_ENABLED 非 '1'）：SSO_CLIENT_SECRET、SSO_ISSUER、SSO_CLIENT_ID 均必填
 * - mock 模式（SSO_MOCK_ENABLED='1'）：SSO_CLIENT_SECRET 可缺省（缺失记警告日志），SSO_ISSUER / SSO_CLIENT_ID 仍必填
 * - 浏览器可见 NEXT_PUBLIC_* 变量在构建期内联、服务端读取不可靠，仅对缺失记警告、不强制（SSO_CLIENT_SECRET 除外）
 * - NEXT_PUBLIC_SSO_SCOPE 存在时必含 openid + offline_access，缺失使用默认值
 */
function validateSsoEnvVars(): void {
  // 任何模式：禁止以 NEXT_PUBLIC_ 前缀暴露敏感值（架构 §7.2 FR-024）
  if (process.env.NEXT_PUBLIC_SSO_CLIENT_SECRET) {
    throw new Error(
      'Environment variable NEXT_PUBLIC_SSO_CLIENT_SECRET is forbidden: ' +
        'SSO_CLIENT_SECRET must not be exposed to the browser (NEXT_PUBLIC_ prefix)',
    );
  }

  const mockEnabled = process.env.SSO_MOCK_ENABLED === '1';
  const missing: string[] = [];

  // SSO_ISSUER：必填（含 mock 模式，Discovery/iss 校验契约不变）
  if (!process.env.SSO_ISSUER) {
    missing.push('SSO_ISSUER');
  }
  // SSO_CLIENT_ID：服务端必填（Node 侧权威）
  if (!process.env.SSO_CLIENT_ID) {
    missing.push('SSO_CLIENT_ID');
  }
  // SSO_CLIENT_SECRET：常规模式必填；mock 模式可缺省（AR1-010）
  if (!process.env.SSO_CLIENT_SECRET && !mockEnabled) {
    missing.push('SSO_CLIENT_SECRET');
  } else if (!process.env.SSO_CLIENT_SECRET && mockEnabled) {
    logger.warn('SSO_CLIENT_SECRET 未配置（mock 模式允许缺省）', { mode: 'mock' });
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable: ${missing.join(', ')}`);
  }

  // NEXT_PUBLIC_SSO_SCOPE：存在时必含 openid + offline_access（缺失走默认值）
  const scope = process.env.NEXT_PUBLIC_SSO_SCOPE;
  if (scope !== undefined) {
    const tokens = scope.split(/\s+/).filter((token) => token.length > 0);
    if (!tokens.includes('openid') || !tokens.includes('offline_access')) {
      throw new Error(
        'Environment variable NEXT_PUBLIC_SSO_SCOPE must include openid and offline_access',
      );
    }
  }
}

/**
 * 获取解析后的 SSO 环境变量配置（SSO 集成步骤 1，模块 M8）
 * 每次调用先执行 SSO 分组校验，供后续步骤 lib/sso/config.ts 复用
 */
export function getSsoEnv(): SsoEnvConfig {
  validateSsoEnvVars();

  const mockEnabled = process.env.SSO_MOCK_ENABLED === '1';

  // ID_TOKEN_VERIFY_MODE：默认 strict，仅支持 strict / soft
  const idTokenVerifyModeRaw =
    process.env.ID_TOKEN_VERIFY_MODE ?? DEFAULT_ID_TOKEN_VERIFY_MODE;
  if (idTokenVerifyModeRaw !== 'strict' && idTokenVerifyModeRaw !== 'soft') {
    throw new Error(
      `Invalid environment variable ID_TOKEN_VERIFY_MODE: ${idTokenVerifyModeRaw} (expected strict or soft)`,
    );
  }

  // SSO_REFRESH_TOKEN_MAX_AGE_DAYS：默认 30，需为正整数
  const refreshTokenMaxAgeDaysRaw = process.env.SSO_REFRESH_TOKEN_MAX_AGE_DAYS;
  const refreshTokenMaxAgeDays =
    refreshTokenMaxAgeDaysRaw === undefined
      ? DEFAULT_SSO_REFRESH_TOKEN_MAX_AGE_DAYS
      : Number(refreshTokenMaxAgeDaysRaw);
  if (!Number.isInteger(refreshTokenMaxAgeDays) || refreshTokenMaxAgeDays <= 0) {
    throw new Error(
      `Invalid environment variable SSO_REFRESH_TOKEN_MAX_AGE_DAYS: ${refreshTokenMaxAgeDaysRaw} (expected positive integer)`,
    );
  }

  // SSO_RETRY_MAX：默认 3，需为正整数
  const retryMaxRaw = process.env.SSO_RETRY_MAX;
  const retryMax = retryMaxRaw === undefined ? DEFAULT_SSO_RETRY_MAX : Number(retryMaxRaw);
  if (!Number.isInteger(retryMax) || retryMax <= 0) {
    throw new Error(
      `Invalid environment variable SSO_RETRY_MAX: ${retryMaxRaw} (expected positive integer)`,
    );
  }

  return {
    issuer: requireSsoEnv('SSO_ISSUER'),
    clientId: requireSsoEnv('SSO_CLIENT_ID'),
    clientSecret: process.env.SSO_CLIENT_SECRET,
    idTokenVerifyMode: idTokenVerifyModeRaw,
    refreshTokenMaxAgeDays,
    mockEnabled,
    retryMax,
    publicIssuer: process.env.NEXT_PUBLIC_SSO_ISSUER,
    publicClientId: process.env.NEXT_PUBLIC_SSO_CLIENT_ID,
    publicRedirectUri: process.env.NEXT_PUBLIC_SSO_REDIRECT_URI,
    scope: process.env.NEXT_PUBLIC_SSO_SCOPE ?? DEFAULT_SSO_SCOPE,
  };
}