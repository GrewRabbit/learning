// app/lib/db/__tests__/connection.test.ts
// getPool/getDb 单元测试（FR-002/FR-003：单例、惰性建连、Pool 参数来自 getDbConfig；全 mock）

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDbConfig } from '@/app/lib/db/config';

/** 已创建的 Fake Pool 实例（断言构造次数与参数） */
const poolInstances: Array<{ options: Record<string, unknown> }> = [];

// mock pg：Pool 构造器仅记录参数并返回占位实例，绝不建连
vi.mock('pg', () => {
  const FakePool = vi.fn().mockImplementation((options: Record<string, unknown>) => {
    const instance = { options, end: vi.fn().mockResolvedValue(undefined) };
    poolInstances.push(instance);
    return instance;
  });
  return { default: { Pool: FakePool } };
});

// mock getDbConfig：固定配置（测试不读真实 env）
vi.mock('@/app/lib/db/config', () => ({
  getDbConfig: vi.fn((): import('@/app/lib/db/config').DbConfig => ({
    url: 'postgres://placeholder@example.invalid:5432/placeholder',
    poolMin: 2,
    poolMax: 10,
    statementTimeoutMs: 5000,
    connectTimeoutMs: 3000,
  })),
}));

/** 重置模块缓存并重新加载被测模块（connection 有模块级单例，需每用例全新实例） */
async function loadFreshConnection(): Promise<typeof import('@/app/lib/db/connection')> {
  vi.resetModules();
  return await import('@/app/lib/db/connection');
}

beforeEach(() => {
  poolInstances.length = 0;
});

describe('getPool 单例与惰性（FR-002/FR-003）', () => {
  test('模块加载不建连；首次 getPool 才创建 Pool；两次调用返回同一实例', async () => {
    const { getPool } = await loadFreshConnection();
    expect(poolInstances).toHaveLength(0); // 惰性：import 本身不构造 Pool

    const first = getPool();
    const second = getPool();
    expect(first).toBe(second);
    expect(poolInstances).toHaveLength(1);
  });

  test('Pool 构造参数来自 getDbConfig（AD-02：statement_timeout 经 startup packet 下发）', async () => {
    const { getPool } = await loadFreshConnection();
    getPool();

    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0].options).toEqual({
      connectionString: 'postgres://placeholder@example.invalid:5432/placeholder',
      max: 10, // config.poolMax（NFR-002）；pg Pool 无 min 参数（惰性建连，FR-003）
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3000, // config.connectTimeoutMs
      statement_timeout: 5000, // config.statementTimeoutMs
    });
  });

  test('getDbConfig 抛错时 getPool 抛错且不创建 Pool；配置恢复后可重试（失败不缓存）', async () => {
    const { getPool } = await loadFreshConnection();
    vi.mocked(getDbConfig).mockImplementationOnce(() => {
      throw new Error('GESP6_DB_UNAVAILABLE: DATABASE_URL 未配置');
    });

    expect(() => getPool()).toThrowError(/GESP6_DB_UNAVAILABLE/);
    expect(poolInstances).toHaveLength(0);

    // 默认 mock 配置生效（mockImplementationOnce 已耗尽）→ 重试成功
    expect(() => getPool()).not.toThrow();
    expect(poolInstances).toHaveLength(1);
  });
});

describe('getDb 单例', () => {
  test('两次调用返回同一实例，且复用同一 Pool（Pool 仅构造一次）', async () => {
    const { getDb, getPool } = await loadFreshConnection();
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
    expect(poolInstances).toHaveLength(1);
    expect(getPool()).toBe(poolInstances[0]);
  });
});
