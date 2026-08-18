// app/lib/db/__tests__/config.test.ts
// getDbConfig() 单元测试（AC-002：惰性校验 + 默认值 + 覆盖 + 容错）
//
// 测试隔离：getDbConfig 带模块级缓存，用 vi.resetModules() + 动态 import
// 每个用例获取全新模块实例，避免缓存串扰；vi.stubEnv 隔离环境变量。
// 注意：测试中仅使用占位 URL，不出现真实连接串。

import { describe, test, expect, afterEach, vi } from 'vitest';

/** 占位连接串（非真实凭据，仅满足非空校验） */
const PLACEHOLDER_URL = 'postgres://placeholder@example.invalid:5432/placeholder';

/** 重置模块缓存并重新加载被测模块（每用例独立模块实例） */
async function loadFreshConfig(): Promise<typeof import('@/app/lib/db/config')> {
  vi.resetModules();
  return await import('@/app/lib/db/config');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDbConfig 惰性校验（AD-07）', () => {
  test('DATABASE_URL 未设置时抛错，错误信息含 GESP6_DB_UNAVAILABLE 且不打印 URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getDbConfig } = await loadFreshConfig();
    expect(() => getDbConfig()).toThrowError(/GESP6_DB_UNAVAILABLE/);
  });

  test('DATABASE_URL 为空白字符串时同样抛错', async () => {
    vi.stubEnv('DATABASE_URL', '   ');
    const { getDbConfig } = await loadFreshConfig();
    expect(() => getDbConfig()).toThrowError(/GESP6_DB_UNAVAILABLE/);
  });

  test('校验失败不缓存：先缺失后配置可成功获取', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getDbConfig } = await loadFreshConfig();
    expect(() => getDbConfig()).toThrowError(/GESP6_DB_UNAVAILABLE/);

    vi.stubEnv('DATABASE_URL', PLACEHOLDER_URL);
    expect(() => getDbConfig()).not.toThrow();
  });
});

describe('getDbConfig 池/超时变量（AC-002）', () => {
  test('未配置（空值）时使用默认值 2/10/5000/5000', async () => {
    vi.stubEnv('DATABASE_URL', PLACEHOLDER_URL);
    vi.stubEnv('GESP6_DB_POOL_MIN', '');
    vi.stubEnv('GESP6_DB_POOL_MAX', '');
    vi.stubEnv('GESP6_DB_STATEMENT_TIMEOUT_MS', '');
    vi.stubEnv('GESP6_DB_CONNECT_TIMEOUT_MS', '');

    const { getDbConfig } = await loadFreshConfig();
    const config = getDbConfig();
    expect(config).toEqual({
      url: PLACEHOLDER_URL,
      poolMin: 2,
      poolMax: 10,
      statementTimeoutMs: 5000,
      connectTimeoutMs: 5000,
    });
  });

  test('环境变量覆盖默认值生效', async () => {
    vi.stubEnv('DATABASE_URL', PLACEHOLDER_URL);
    vi.stubEnv('GESP6_DB_POOL_MIN', '3');
    vi.stubEnv('GESP6_DB_POOL_MAX', '20');
    vi.stubEnv('GESP6_DB_STATEMENT_TIMEOUT_MS', '8000');
    vi.stubEnv('GESP6_DB_CONNECT_TIMEOUT_MS', '3000');

    const { getDbConfig } = await loadFreshConfig();
    const config = getDbConfig();
    expect(config.poolMin).toBe(3);
    expect(config.poolMax).toBe(20);
    expect(config.statementTimeoutMs).toBe(8000);
    expect(config.connectTimeoutMs).toBe(3000);
  });

  test('非法数字回退默认值', async () => {
    vi.stubEnv('DATABASE_URL', PLACEHOLDER_URL);
    vi.stubEnv('GESP6_DB_POOL_MIN', 'abc');
    vi.stubEnv('GESP6_DB_POOL_MAX', '-5');
    vi.stubEnv('GESP6_DB_STATEMENT_TIMEOUT_MS', '12.7');
    vi.stubEnv('GESP6_DB_CONNECT_TIMEOUT_MS', '1e3');

    const { getDbConfig } = await loadFreshConfig();
    const config = getDbConfig();
    expect(config.poolMin).toBe(2);
    expect(config.poolMax).toBe(10);
    expect(config.statementTimeoutMs).toBe(5000);
    expect(config.connectTimeoutMs).toBe(5000);
  });
});

describe('getDbConfig 模块级缓存', () => {
  test('校验通过后缓存解析结果：后续 env 变更不影响已缓存配置', async () => {
    vi.stubEnv('DATABASE_URL', PLACEHOLDER_URL);
    const { getDbConfig } = await loadFreshConfig();

    const first = getDbConfig();
    vi.stubEnv('GESP6_DB_POOL_MAX', '99');
    const second = getDbConfig();

    expect(second).toBe(first);
    expect(second.poolMax).toBe(10);
  });
});
