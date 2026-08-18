// app/lib/db/connection.ts
// 连接池与 Drizzle 实例单例（架构 AD-02 / §5.1；FR-002/FR-003）
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。
//
// 设计要点：
// - 惰性建立：模块顶层不建连不查询，首次 getPool()/getDb() 才创建（FR-003）
// - statement_timeout 经 pg startup packet 下发服务端，无需应用层 SET（AD-02）
// - 多实例各自维护独立池（共享同一库），进程内单例
// - pg Pool 无 min 预热参数（按需建连）：getDbConfig 的 poolMin 仅保留配置语义，
//   Pool 不使用、不预热连接（符合 FR-003 惰性语义）

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDbConfig } from './config';

/** Drizzle node-postgres 数据库实例类型（供 DAO 类型标注） */
export type Db = NodePgDatabase<Record<string, never>>;

/** 底层连接类型：池（getPool 返回）或池中租借的单连接（事务/独占查询用） */
export type DbClient = pg.Pool | pg.PoolClient;

/** Drizzle 事务回调签名（拆两级别名：嵌套 Parameters 索引会触发 esbuild 解析错误） */
type DbTransactionCallback = Parameters<Db['transaction']>[0];

/** Drizzle 事务回调参数类型（DAO 事务内方法以 tx: DbTx 注入，架构 §5.1） */
export type DbTx = Parameters<DbTransactionCallback>[0];

/** 模块级单例（进程内唯一；创建失败不缓存，下次调用重试） */
let pool: pg.Pool | undefined;
let db: Db | undefined;

/** 获取 pg 连接池单例（惰性创建；DATABASE_URL 未配置时首次调用抛 GESP6_DB_UNAVAILABLE 语义错误） */
export function getPool(): pg.Pool {
  if (pool === undefined) {
    const config = getDbConfig();
    pool = new pg.Pool({
      connectionString: config.url,
      max: config.poolMax,
      // 空闲连接回收：30s 后关闭空闲连接（避免长期占用连接数）
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: config.connectTimeoutMs,
      // 服务端语句超时（startup packet 下发，AD-02；超时由服务端取消，错误 code 57014）
      statement_timeout: config.statementTimeoutMs,
    });
  }
  return pool;
}

/** 获取 Drizzle 实例单例（复用同一 Pool；供非事务 DAO 方法使用） */
export function getDb(): Db {
  if (db === undefined) {
    db = drizzle(getPool());
  }
  return db;
}
