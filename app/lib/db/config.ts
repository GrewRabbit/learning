// app/lib/db/config.ts
// D7 配置与环境（架构 AD-07）：DB 环境变量惰性校验 + 模块级缓存。
// 独立于 app/lib/env.ts 的 validateEnv()——启动不依赖 DB（NFR-008），
// DATABASE_URL 缺失时仅 DB 相关请求在首次访问时抛错（AC-001）。

export interface DbConfig {
  /** PostgreSQL 连接串（仅 .env.local / 部署 secret 提供，禁止打印，NFR-005） */
  url: string;
  /** 连接池最小连接数（GESP6_DB_POOL_MIN，默认 2） */
  poolMin: number;
  /** 连接池最大连接数（GESP6_DB_POOL_MAX，默认 10，NFR-002） */
  poolMax: number;
  /** 服务端语句超时毫秒（GESP6_DB_STATEMENT_TIMEOUT_MS，默认 5000） */
  statementTimeoutMs: number;
  /** 连接超时毫秒（GESP6_DB_CONNECT_TIMEOUT_MS，默认 5000） */
  connectTimeoutMs: number;
}

const DEFAULT_POOL_MIN = 2;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** 模块级缓存：首次校验通过后缓存解析结果（进程内复用；校验失败不缓存） */
let cachedConfig: DbConfig | undefined;

/** 解析正整数字符串；未设置/空白/非法（非纯正整数或 ≤0）回退默认值 */
function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '' || !/^\d+$/.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 ? parsed : fallback;
}

/** 惰性获取 DB 配置（架构 §5.1 签名）；DATABASE_URL 缺失抛错（GESP6_DB_UNAVAILABLE 语义） */
export function getDbConfig(): DbConfig {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    // 错误码语义 GESP6_DB_UNAVAILABLE（架构 §5.3）；错误信息不携带连接串（NFR-005）
    throw new Error(
      'GESP6_DB_UNAVAILABLE: DATABASE_URL 未配置（请在 .env.local 或部署 secret 中提供数据库连接串）',
    );
  }

  cachedConfig = {
    url,
    poolMin: parsePositiveIntEnv(process.env.GESP6_DB_POOL_MIN, DEFAULT_POOL_MIN),
    poolMax: parsePositiveIntEnv(process.env.GESP6_DB_POOL_MAX, DEFAULT_POOL_MAX),
    statementTimeoutMs: parsePositiveIntEnv(
      process.env.GESP6_DB_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    connectTimeoutMs: parsePositiveIntEnv(
      process.env.GESP6_DB_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
  };
  return cachedConfig;
}
