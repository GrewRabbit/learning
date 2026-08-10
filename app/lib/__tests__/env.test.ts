// app/lib/__tests__/env.test.ts
// env.ts 单元测试：SSO 环境变量分组校验（架构 §7.2，SSO 集成步骤 1，模块 M8，AR1-010）
// 注意：validateEnv 存在模块级缓存（envValidated），每个用例 beforeEach 必须 resetEnvValidation()

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateEnv,
  resetEnvValidation,
  getProviderKeyName,
  getProviderBaseUrlName,
  getSsoEnv,
} from '../env';

// mock logger，避免测试输出噪音（模式与 app/lib/__tests__/job-store.test.ts 一致）
vi.mock('@/app/lib/logging/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 仅管理 SSO 相关环境变量，不动全局 AI stub（避免破坏 app/lib/ai/services/__tests__/setup.ts）
const SSO_ENV_KEYS = [
  'SSO_ISSUER',
  'SSO_CLIENT_ID',
  'SSO_CLIENT_SECRET',
  'SSO_MOCK_ENABLED',
  'ID_TOKEN_VERIFY_MODE',
  'SSO_REFRESH_TOKEN_MAX_AGE_DAYS',
  'SSO_RETRY_MAX',
  'NEXT_PUBLIC_SSO_ISSUER',
  'NEXT_PUBLIC_SSO_CLIENT_ID',
  'NEXT_PUBLIC_SSO_REDIRECT_URI',
  'NEXT_PUBLIC_SSO_SCOPE',
  'NEXT_PUBLIC_SSO_CLIENT_SECRET',
] as const;

// 记录每个 key 在用例开始前的原始值，afterEach 恢复，保证用例间隔离
const originalValues = new Map<string, string | undefined>();

function setSsoEnv(key: string, value: string | undefined): void {
  if (!originalValues.has(key)) {
    originalValues.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function restoreSsoEnv(): void {
  for (const [key, value] of originalValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalValues.clear();
}

/** 搭建常规模式（SSO_MOCK_ENABLED='0'）合法 SSO 环境 */
function setupValidSsoEnv(): void {
  setSsoEnv('SSO_ISSUER', 'https://sso.example.com');
  setSsoEnv('SSO_CLIENT_ID', 'web-client');
  setSsoEnv('SSO_CLIENT_SECRET', 'test-client-secret');
  setSsoEnv('SSO_MOCK_ENABLED', '0');
  setSsoEnv('NEXT_PUBLIC_SSO_CLIENT_SECRET', undefined);
}

beforeEach(() => {
  resetEnvValidation();
  originalValues.clear();
  setupValidSsoEnv();
});

afterEach(() => {
  restoreSsoEnv();
});

describe('SSO 校验：常规模式', () => {
  it('缺少 SSO_CLIENT_SECRET → validateEnv 抛错', () => {
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    expect(() => validateEnv()).toThrow('SSO_CLIENT_SECRET');
  });

  it('缺少 SSO_ISSUER → validateEnv 抛错', () => {
    setSsoEnv('SSO_ISSUER', undefined);
    expect(() => validateEnv()).toThrow('SSO_ISSUER');
  });

  it('缺少 SSO_CLIENT_ID → validateEnv 抛错', () => {
    setSsoEnv('SSO_CLIENT_ID', undefined);
    expect(() => validateEnv()).toThrow('SSO_CLIENT_ID');
  });

  it('NEXT_PUBLIC_SSO_CLIENT_SECRET 存在 → validateEnv 抛错（禁敏感值暴露）', () => {
    setSsoEnv('NEXT_PUBLIC_SSO_CLIENT_SECRET', 'leaked-secret');
    expect(() => validateEnv()).toThrow('NEXT_PUBLIC_SSO_CLIENT_SECRET');
  });

  it('NEXT_PUBLIC_SSO_SCOPE 缺少 offline_access → validateEnv 抛错', () => {
    setSsoEnv('NEXT_PUBLIC_SSO_SCOPE', 'openid profile');
    expect(() => validateEnv()).toThrow('offline_access');
  });

  it('合法环境 → validateEnv 不抛错，且缓存生效（再次调用跳过校验）', () => {
    expect(() => validateEnv()).not.toThrow();
    // 缓存命中：清空 SSO 变量后再次调用仍通过（envValidated=true）
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    setSsoEnv('SSO_ISSUER', undefined);
    expect(() => validateEnv()).not.toThrow();
  });
});

describe('SSO 校验：mock 模式（SSO_MOCK_ENABLED=1，AR1-010）', () => {
  it('缺少 SSO_CLIENT_SECRET → 不抛错（记警告）', () => {
    setSsoEnv('SSO_MOCK_ENABLED', '1');
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    expect(() => validateEnv()).not.toThrow();
  });

  it('缺少 SSO_ISSUER → 仍抛错（即使 mock 模式）', () => {
    setSsoEnv('SSO_MOCK_ENABLED', '1');
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    setSsoEnv('SSO_ISSUER', undefined);
    expect(() => validateEnv()).toThrow('SSO_ISSUER');
  });

  it('NEXT_PUBLIC_SSO_CLIENT_SECRET 存在 → 仍抛错（任何模式均禁止）', () => {
    setSsoEnv('SSO_MOCK_ENABLED', '1');
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    setSsoEnv('NEXT_PUBLIC_SSO_CLIENT_SECRET', 'leaked-secret');
    expect(() => validateEnv()).toThrow('NEXT_PUBLIC_SSO_CLIENT_SECRET');
  });
});

describe('getSsoEnv：默认值与解析（SSO 集成步骤 1）', () => {
  it('常规模式返回解析后的配置（默认值生效）', () => {
    const env = getSsoEnv();
    expect(env).toEqual({
      issuer: 'https://sso.example.com',
      clientId: 'web-client',
      clientSecret: 'test-client-secret',
      idTokenVerifyMode: 'strict',
      refreshTokenMaxAgeDays: 30,
      mockEnabled: false,
      retryMax: 3,
      publicIssuer: undefined,
      publicClientId: undefined,
      publicRedirectUri: undefined,
      scope: 'openid profile email groups offline_access',
    });
  });

  it('解析数字型变量 / mock 开关 / 显式 scope', () => {
    setSsoEnv('SSO_MOCK_ENABLED', '1');
    setSsoEnv('ID_TOKEN_VERIFY_MODE', 'soft');
    setSsoEnv('SSO_REFRESH_TOKEN_MAX_AGE_DAYS', '45');
    setSsoEnv('SSO_RETRY_MAX', '5');
    setSsoEnv('NEXT_PUBLIC_SSO_SCOPE', 'openid profile email groups offline_access');
    setSsoEnv('NEXT_PUBLIC_SSO_ISSUER', 'https://sso.example.com');

    const env = getSsoEnv();
    expect(env.mockEnabled).toBe(true);
    expect(env.idTokenVerifyMode).toBe('soft');
    expect(env.refreshTokenMaxAgeDays).toBe(45);
    expect(env.retryMax).toBe(5);
    expect(env.scope).toBe('openid profile email groups offline_access');
    expect(env.publicIssuer).toBe('https://sso.example.com');
  });

  it('mock 模式缺 SSO_CLIENT_SECRET → clientSecret 为 undefined', () => {
    setSsoEnv('SSO_MOCK_ENABLED', '1');
    setSsoEnv('SSO_CLIENT_SECRET', undefined);
    const env = getSsoEnv();
    expect(env.clientSecret).toBeUndefined();
  });

  it('ID_TOKEN_VERIFY_MODE 非法值 → 抛错', () => {
    setSsoEnv('ID_TOKEN_VERIFY_MODE', 'bogus');
    expect(() => getSsoEnv()).toThrow('ID_TOKEN_VERIFY_MODE');
  });

  it('SSO_REFRESH_TOKEN_MAX_AGE_DAYS 非正整数 → 抛错', () => {
    setSsoEnv('SSO_REFRESH_TOKEN_MAX_AGE_DAYS', 'abc');
    expect(() => getSsoEnv()).toThrow('SSO_REFRESH_TOKEN_MAX_AGE_DAYS');
  });

  it('SSO_RETRY_MAX 非正整数 → 抛错', () => {
    setSsoEnv('SSO_RETRY_MAX', '0');
    expect(() => getSsoEnv()).toThrow('SSO_RETRY_MAX');
  });
});

describe('原有 AI 校验（回归兼容）', () => {
  it('getProviderKeyName / getProviderBaseUrlName 保持兼容', () => {
    expect(getProviderKeyName('deepseek')).toBe('DEEPSEEK_API_KEY');
    expect(getProviderBaseUrlName('qwen')).toBe('QWEN_BASE_URL');
    expect(getProviderKeyName('unknown')).toBeUndefined();
  });
});