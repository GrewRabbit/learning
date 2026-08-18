// app/lib/db/errors.ts
// DB 错误分类（架构 §4.2 连接类故障集合 / §5.3 错误码全集 / NFR-005 不携带连接串）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。

/** pg 连接类错误码集合（Node errno + PostgreSQL SQLSTATE，架构 §4.2） */
const DB_UNAVAILABLE_CODES = new Set([
  // Node 网络层 errno（pg Client 连接失败/中断）
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  // PostgreSQL SQLSTATE
  '28P01', // invalid_password：口令认证失败（连接不可用类）
  '28000', // invalid_authorization_specification：pg_hba 拒绝 / 角色不存在
  '57P01', // admin_shutdown：服务端关闭连接
  '57P03', // cannot_connect_now：数据库仍在启动/恢复
  '53300', // too_many_connections：连接数耗尽
  '57014', // query_canceled：statement_timeout 触发取消
]);

/**
 * 连接/语句超时类错误 message 特征
 *
 * pg 的 connectionTimeoutMillis 超时不携带 SQLSTATE errno，仅 message
 * （如 "timeout expired when trying to connect"）；连接中断为
 * "Connection terminated unexpectedly"；语句超时在 SQLSTATE 被上层包装
 * 丢失时兜底匹配 "canceling statement due to statement timeout"（57014）。
 * 仅匹配连接/超时语义，避免误伤业务错误。
 */
const DB_UNAVAILABLE_MESSAGE_PATTERN =
  /timeout expired when trying to connect|connection timeout|connection terminated|statement timeout/i;

/** 从 unknown 收窄读取 pg 错误对象 code 字段（errno 或 SQLSTATE）；非字符串返回 undefined */
function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * 判定是否连接类 DB 故障（→ GESP6_DB_UNAVAILABLE 家族，架构 §5.3）
 *
 * 覆盖：pg 错误 code（errno/SQLSTATE）、getDbConfig 抛出的 DATABASE_URL
 * 未配置错误（message 含 GESP6_DB_UNAVAILABLE）、连接/语句超时类 Error message。
 */
export function isDbUnavailable(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code !== undefined && DB_UNAVAILABLE_CODES.has(code)) {
    return true;
  }
  if (error instanceof Error) {
    // getDbConfig 惰性校验抛出的配置缺失错误（config.ts，AD-07）
    if (error.message.includes('GESP6_DB_UNAVAILABLE')) {
      return true;
    }
    return DB_UNAVAILABLE_MESSAGE_PATTERN.test(error.message);
  }
  return false;
}

/** 判定是否 pg 唯一约束冲突（SQLSTATE 23505，如并发建档/并发 access 插入） */
export function isUniqueViolation(error: unknown): boolean {
  return getErrorCode(error) === '23505';
}

/** 判定是否 pg 外键约束冲突（SQLSTATE 23503，如索引指向不存在的 solutions 行） */
export function isForeignKeyViolation(error: unknown): boolean {
  return getErrorCode(error) === '23503';
}

/** 错误归类域：generic 通用（建档/缓存）/ billing 计费事务（架构 §5.1） */
export type DbErrorDomain = 'billing' | 'generic';

/**
 * 将连接类 DB 故障映射为域内错误码（架构 §5.3）
 *
 * - generic 域 → GESP6_DB_UNAVAILABLE（503）
 * - billing 域 → GESP6_BILLING_DB_UNAVAILABLE（503）
 * - 非连接类错误返回 null：本函数仅做分类、不吞错，由调用方归类
 *   （如 billing 域其余错误由 billing-service 归为 GESP6_BILLING_DEDUCT_FAILED）
 */
export function classifyDbError(error: unknown, domain: DbErrorDomain): { code: string } | null {
  if (!isDbUnavailable(error)) {
    return null;
  }
  return {
    code: domain === 'billing' ? 'GESP6_BILLING_DB_UNAVAILABLE' : 'GESP6_DB_UNAVAILABLE',
  };
}
