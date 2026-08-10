// app/lib/sso/config.ts
// SSO 运行配置读取（架构 §11，SSO 集成步骤 2，模块 M8）
// 将 env.ts 的 getSsoEnv() 解析结果映射为 SsoConfig，模块级缓存（首次调用后缓存）

import { getSsoEnv } from '@/app/lib/env';
import type { SsoConfig } from './types';

// 模块级缓存：首次调用后缓存，后续直接复用，避免重复解析环境变量
let cachedConfig: SsoConfig | null = null;

/**
 * 登出后重定向白名单（OQ-007 默认方案 A：仅首页 '/'）
 * 集中定义于 config.ts（FR-022 客户端注册 postLogoutRedirectUris 的服务端等价物）；
 * 后续对接 IDP 注册值时可在此扩展
 */
export const LOGOUT_REDIRECT_WHITELIST: string[] = ['/'];

/**
 * 获取 SSO 运行配置（模块级缓存）
 * 首次调用触发 getSsoEnv() 的 SSO 分组校验与环境变量解析，之后返回缓存副本
 */
export function getSsoConfig(): SsoConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const env = getSsoEnv();
  cachedConfig = {
    issuer: env.issuer,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    idTokenVerifyMode: env.idTokenVerifyMode,
    refreshTokenMaxAgeDays: env.refreshTokenMaxAgeDays,
    mockEnabled: env.mockEnabled,
    retryMax: env.retryMax,
    scope: env.scope,
    publicIssuer: env.publicIssuer,
    publicClientId: env.publicClientId,
    publicRedirectUri: env.publicRedirectUri,
    logoutRedirectWhitelist: LOGOUT_REDIRECT_WHITELIST,
  };
  return cachedConfig;
}