// drizzle.config.ts
// drizzle-kit 配置（docs/architecture/arch-db-integration-schema.md §5.1）。
// dialect/schema/out/dbCredentials 按定稿；url 运行时读 env，禁硬编码（FR-001/NFR-011）。

// Node 22 内置：预加载 .env.local 供 CLI 读取 DATABASE_URL（与 AD-12 一致）；
// 已存在的进程环境变量优先（loadEnvFile 不覆盖）；文件缺失时依赖进程环境变量。
try {
  process.loadEnvFile('.env.local');
} catch {
  /* 缺失时依赖进程环境变量 */
}

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './app/lib/db/schema.ts',
  out: './app/lib/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // 版本表位置：drizzle-kit 0.31 默认建在 "drizzle" schema，但应用账号 gesp6_app 按
  // FR-004a 最小权限仅持有 public schema 的 CREATE/USAGE（CREATE SCHEMA drizzle 会
  // permission denied）。定稿 §5.3 允许经 migrations 选项自定义，故置于 public schema。
  // 注意：后续程序化 migrate（app/lib/db/migrate.ts）须使用相同 schema/table 保持一致。
  migrations: {
    schema: 'public',
    table: '__drizzle_migrations',
  },
  strict: true,
  verbose: true,
});
