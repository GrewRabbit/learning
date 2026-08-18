// app/lib/db/migrate.ts
// 程序化迁移执行入口（架构 §5.5/§6；`npm run db:migrate` 实际执行体）。
//
// 背景（为何不走 `drizzle-kit migrate` CLI）：
// drizzle migrator 无条件先执行 `CREATE SCHEMA IF NOT EXISTS <schema>`，而 PostgreSQL
// 对该语句即使在目标 schema 已存在时也执行库级 CREATE 权限检查；应用账号 gesp6_app 按
// FR-004a 最小权限仅持有 public schema 的 CREATE/USAGE（无库级 CREATE）→ 语句被拒
// （CLI 在此场景下还会静默退出 1，错误输出被 renderWithTask 的 process.exit 截断）。
//
// 处理：RestrictedSchemaEnsurePool 仅将「目标 schema 已存在」的 CREATE SCHEMA IF NOT
// EXISTS 语句短路为空结果（语义等价 no-op），其余语句原样透传；版本表
// （public.__drizzle_migrations，与 drizzle.config.ts 的 migrations 选项一致）、
// 事务应用与幂等簿记全部由 drizzle 官方 migrator 完成（AC-003 语义不变）。

import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDbConfig } from './config';

// Node 22 内置：预加载 .env.local（npm scripts 固定从项目根运行；已有进程变量优先）
try {
  process.loadEnvFile('.env.local');
} catch {
  /* 缺失时依赖进程环境变量 */
}

/** 版本表位置（必须与 drizzle.config.ts 的 migrations 选项保持一致） */
const MIGRATIONS_SCHEMA = 'public';
const MIGRATIONS_TABLE = '__drizzle_migrations';
/** 迁移产物目录（npm scripts 从项目根运行） */
const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'app/lib/db/migrations');

/** 仅匹配 migrator 生成的 schema 确保语句（sql.identifier 输出形如 "public"） */
const SCHEMA_ENSURE_PATTERN = /^CREATE SCHEMA IF NOT EXISTS "([^"]+)"\s*;?$/;

const EMPTY_QUERY_RESULT: pg.QueryResult = {
  rows: [],
  rowCount: 0,
  oid: 0,
  command: 'CREATE SCHEMA',
  fields: [],
};

function matchSchemaEnsureStatement(text: string): string | null {
  const matched = SCHEMA_ENSURE_PATTERN.exec(text.trim());
  return matched !== null ? matched[1] : null;
}

/** 从 unknown 行收窄布尔字段（避免库类型 any 逃逸） */
function rowBooleanField(row: unknown, field: string): boolean {
  if (typeof row !== 'object' || row === null || !(field in row)) {
    return false;
  }
  return (row as Record<string, unknown>)[field] === true;
}

/** 受限账号适配池：schema 已存在时短路 CREATE SCHEMA IF NOT EXISTS，其余透传 */
class RestrictedSchemaEnsurePool extends pg.Pool {
  private readonly ensuredSchemas = new Set<string>();

  private async schemaExists(schema: string): Promise<boolean> {
    if (this.ensuredSchemas.has(schema)) {
      return true;
    }
    const result = await super.query(
      'SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists',
      [schema],
    );
    const exists = rowBooleanField(result.rows[0], 'exists');
    if (exists) {
      this.ensuredSchemas.add(schema);
    }
    return exists;
  }

  override query(
    queryTextOrConfig: string | pg.QueryConfig,
    valuesOrCallback?: unknown,
  ): Promise<pg.QueryResult> {
    const text =
      typeof queryTextOrConfig === 'string' ? queryTextOrConfig : queryTextOrConfig.text;
    const schema = matchSchemaEnsureStatement(text);

    // 仅拦截 promise 形式的 schema 确保语句；callback 形式与业务语句原样透传
    if (schema !== null && typeof valuesOrCallback !== 'function') {
      return this.schemaExists(schema).then((exists) => {
        if (exists) {
          return EMPTY_QUERY_RESULT;
        }
        return typeof queryTextOrConfig === 'string'
          ? super.query(queryTextOrConfig, valuesOrCallback as unknown[])
          : super.query(queryTextOrConfig);
      });
    }

    return typeof queryTextOrConfig === 'string'
      ? super.query(queryTextOrConfig, valuesOrCallback as unknown[])
      : super.query(queryTextOrConfig);
  }
}

/** 执行未应用的迁移（幂等，AC-003）；供 CLI 与部署编排调用 */
export async function runMigrations(): Promise<void> {
  const config = getDbConfig();
  const pool = new RestrictedSchemaEnsurePool({ connectionString: config.url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    const applied = await pool.query(
      `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
    );
    const appliedRow: unknown = applied.rows[0];
    const appliedCount =
      typeof appliedRow === 'object' && appliedRow !== null && 'count' in appliedRow
        ? String((appliedRow as Record<string, unknown>).count)
        : '0';
    console.log(`[db-migrate] 迁移执行完成（幂等），版本表已应用记录数：${appliedCount}`);
  } finally {
    await pool.end();
  }
}

// CLI 直跑判定（tsx 下 process.argv[1] 为本文件路径；被 import 时不触发）
const isDirectRun = process.argv[1] !== undefined && process.argv[1].endsWith('migrate.ts');
if (isDirectRun) {
  runMigrations().catch((error: unknown) => {
    console.error('[db-migrate] 失败:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
