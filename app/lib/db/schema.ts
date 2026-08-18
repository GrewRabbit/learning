// app/lib/db/schema.ts
// Drizzle schema：数据库与业务系统整合 8 表定稿（docs/architecture/arch-db-integration-schema.md §4）。
// 约定：表名/列名 snake_case（显式列名字符串），对象属性 camelCase；
// bigserial 用 mode:'number'；timestamptz；CHECK 约束使用定稿原文的非限定列名。
// 禁止被 middleware（Edge）/客户端组件引用（架构 §8.2）。

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** §4.1 users —— 用户表（sso_sub UNIQUE 支撑 getOrCreateUser 幂等建档，FR-005/006） */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(), // DEFAULT gen_random_uuid()（PG13+ 内置）
  ssoSub: text('sso_sub').notNull().unique(), // SSO sub 唯一业务标识
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** §4.3 solutions —— 解法内容表（content_hash 全表主键，同 hash 全用户共享，FR-011） */
export const solutions = pgTable('solutions', {
  contentHash: text('content_hash').primaryKey(), // sha256 hex
  html: text('html').notNull(), // 解法 HTML 全文（LLM 原始输出）
  validated: boolean('validated').notNull().default(false), // 是否通过编译验证
  warning: text('warning'), // 验证告警（可空）
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** §4.2 quota_accounts —— 额度账户表（1:1 双列建模，FR-016；双列 CHECK ≥ 0 为不变量兜底，NFR-006） */
export const quotaAccounts = pgTable(
  'quota_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }), // PK + FK，用户删除连带账户
    freeBalance: integer('free_balance').notNull().default(0), // 免费额度（优先扣减）
    rechargeBalance: integer('recharge_balance').notNull().default(0), // 充值额度（付费资产）
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('quota_accounts_free_balance_check', sql`free_balance >= 0`),
    check('quota_accounts_recharge_balance_check', sql`recharge_balance >= 0`),
  ],
);

/** §4.4 primary_indexes —— 主 key 索引表（PK(platform, problem_id)，FR-012） */
export const primaryIndexes = pgTable(
  'primary_indexes',
  {
    platform: text('platform').notNull(), // 平台标识（如 luogu / youdao）
    problemId: text('problem_id').notNull(), // 题目 id（如 P1001）
    contentHash: text('content_hash')
      .notNull()
      .references(() => solutions.contentHash), // FK 防悬空索引
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.platform, table.problemId] })],
);

/** §4.5 sample_indexes —— 样例指纹索引表（sample_fp 唯一，FR-013） */
export const sampleIndexes = pgTable('sample_indexes', {
  sampleFp: text('sample_fp').primaryKey(), // 样例指纹（sha256 hex，all/first 各自一行）
  contentHash: text('content_hash')
    .notNull()
    .references(() => solutions.contentHash),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** §4.6 user_solution_access —— 用户已获取解法表（计费权威，FR-015/FR-017） */
export const userSolutionAccess = pgTable(
  'user_solution_access',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash')
      .notNull()
      .references(() => solutions.contentHash),
    firstAccessedAt: timestamp('first_accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 数据库级唯一权威：存在记录 → 免费；不存在 → 首次获取计费（并发同键插入仅一个成功）
    primaryKey({ columns: [table.userId, table.contentHash] }),
    // 反向索引：管理后台「某解法被哪些用户获取」预留（NFR-009）
    index('idx_user_solution_access_content_hash').on(table.contentHash),
  ],
);

/** §4.7 billing_records —— 计费/充值流水表（AR1-008 成对 CHECK；次数口径 AR1-011） */
export const billingRecords = pgTable(
  'billing_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    contentHash: text('content_hash').references(() => solutions.contentHash), // recharge 无（NULL）；consume 必填（由成对 CHECK 保证）
    type: text('type').notNull(), // 'consume' | 'recharge'
    amount: integer('amount').notNull(), // 消耗/充值次数（正数，FR-020）
    balanceAfter: integer('balance_after').notNull(), // 变更后 free + recharge 之和
    operator: text('operator'), // 人工充值操作人（consume 为 NULL）
    remark: text('remark'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('billing_records_type_check', sql`type IN ('consume', 'recharge')`),
    check('billing_records_amount_check', sql`amount > 0`),
    check('billing_records_balance_after_check', sql`balance_after >= 0`),
    // AR1-008：consume 必须有 content_hash，recharge 必须无
    check(
      'billing_records_type_content_hash_check',
      sql`(type = 'consume' AND content_hash IS NOT NULL) OR (type = 'recharge' AND content_hash IS NULL)`,
    ),
    index('idx_billing_records_user_id_created_at').on(table.userId, table.createdAt),
  ],
);

/** §4.8 solve_records —— 解题记录表（FR-008；job_id 仅溯源不唯一，FR-010） */
export const solveRecords = pgTable(
  'solve_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    jobId: text('job_id').notNull(), // 任务 id（仅溯源，job-store 不入库）
    inputType: text('input_type').notNull(), // 'text' | 'image' | 'platform'
    platform: text('platform'), // 以下 3 项与 platform 输入相关（成对 CHECK）
    problemId: text('problem_id'),
    sampleFp: text('sample_fp'), // 多解法扩展预留（可空）
    contentHash: text('content_hash')
      .notNull()
      .references(() => solutions.contentHash), // 必关联实际获取的解法
    cached: boolean('cached').notNull(), // 本次是否缓存命中（透传，不影响计费）
    validated: boolean('validated').notNull(), // 是否通过编译验证（透传）
    billed: boolean('billed').notNull(), // 本次是否计费（settle 判定结果）
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('solve_records_input_type_check', sql`input_type IN ('text', 'image', 'platform')`),
    // platform 输入：platform/problem_id 成对（两者同 NULL 或同非 NULL）
    check(
      'solve_records_platform_problem_id_check',
      sql`(platform IS NULL AND problem_id IS NULL) OR (platform IS NOT NULL AND problem_id IS NOT NULL)`,
    ),
    index('idx_solve_records_user_id_created_at').on(table.userId, table.createdAt),
    index('idx_solve_records_content_hash').on(table.contentHash),
  ],
);
