# 数据库 Schema 定稿与迁移方案（数据库与业务系统整合）

**日期**：2026-08-18 ｜ **状态**：approved ｜ **版本**：v1.0
**需求依据**：`docs/specs/spec-db-integration-v1.0.md`（v1.2，approved）
**架构依据**：`docs/architecture/arch-db-integration-v1.0.md`（v1.1，approved）——§7.3 Schema 草案、§4.3 扣费 SQL 语义、§5.1 DAO 接口、AD-03/AD-11、AR1-008/AR1-011
**实际核对**：`app/lib/ai/services/fs-html-cache.ts`、`fs-paths.ts`、`data/gesp6/` 真实样例（primary 22 个 / content 108 html + 108 json / sample 9 个）

---

## 1. 定稿总览与表数量判定

**判定：8 张表**，非架构 §7.3 标题所写「7 表」。

依据：
1. spec §3.0「实体关系总览」明确列出 8 个实体（users / quotaAccounts / solutions / primaryIndexes / sampleIndexes / userSolutionAccess / billingRecords / solveRecords）。
2. spec FR-008 强制要求 `solveRecords` 记录每次成功解题行为（含 jobId/inputType/cached/validated/billed）。
3. 架构 §7.3 表格本身实际列出了 8 行（含 `solve_records`），「7 表」为标题笔误，未影响任何决策。

> 详见 §8「与架构草案不一致处」第 1 条。本定稿以实体清单与表格内容为准。

| # | 表 | 职责 | 关键约束 |
|---|----|------|---------|
| 1 | `users` | 用户（SSO sub 唯一业务标识） | `sso_sub` UNIQUE |
| 2 | `quota_accounts` | 额度账户（免费 + 充值双列，1:1） | `user_id` PK+FK、双列 CHECK ≥ 0 |
| 3 | `solutions` | 解法内容全文与元数据 | `content_hash` PK |
| 4 | `primary_indexes` | 主 key 索引 | PK(platform, problem_id) |
| 5 | `sample_indexes` | 样例指纹索引 | `sample_fp` PK |
| 6 | `user_solution_access` | 用户已获取解法（**计费权威**） | PK(user_id, content_hash) |
| 7 | `billing_records` | 计费/充值流水 | type CHECK + 成对 CHECK |
| 8 | `solve_records` | 解题记录 | input_type CHECK + 平台成对 CHECK |

## 2. 数据库版本与环境要求

- PostgreSQL **≥ 13**：`gen_random_uuid()` 为内置核心函数（PG13 起），无需 `CREATE EXTENSION pgcrypto`。
- 编码 UTF8（建库步骤指定）；全部表默认位于 `public` schema（单 schema，不引入多 schema）。
- 应用通过 `DATABASE_URL` 连接（仅 `.env.local`/部署 secret，禁硬编码）；驱动 pg + ORM Drizzle（架构 §3.1，AD-01）。

## 3. 建库前置步骤（DBA 完整清单）

> 本清单即 spec FR-004a 的「新建库相关步骤」**完整清单**。**必须先于**迁移/导入执行；以下操作在数据库服务器上以具备 CREATEDB 权限的 DBA 账号（如 `postgres`）执行。

### 步骤 1：确认版本

```sql
SELECT version();  -- 要求 PostgreSQL >= 13（gen_random_uuid 内置）
```

### 步骤 2：创建应用数据库

```sql
CREATE DATABASE gesp6_billing
  WITH ENCODING 'UTF8'
       TEMPLATE template0
       CONNECTION LIMIT -1;
```

> 说明：排序/区域（LC_COLLATE/LC_CTYPE）不显式指定，沿用服务器默认模板（UTF8 下通常为 C.UTF-8 或 en_US.UTF-8）；若服务器默认非 UTF8 兼容，可在 CREATE 语句中追加 `LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`（按实际服务器可用 locale 调整）。数据库命名建议 `gesp6_billing`（业务名 `gesp6` + 用途 `billing`；如未来与其它库隔离，可按 `gesp6_<域>` 命名）。

### 步骤 3：创建最小权限应用账号

```sql
-- 仅该库权限，禁止超级用户；密码用自预设强密码替换占位符（要求 ≥16 位、含大小写与数字，且避开 @ : / # ? % 等 URL 特殊字符，见步骤 6 说明）
CREATE ROLE gesp6_app LOGIN PASSWORD '<REPLACE_WITH_STRONG_PASSWORD>';
REVOKE ALL ON DATABASE gesp6_billing FROM PUBLIC;   -- 收窄 PUBLIC 默认权限
GRANT CONNECT ON DATABASE gesp6_billing TO gesp6_app;
```

### 步骤 4：库内 schema 权限

```sql
-- 切换到 gesp6_billing 库后执行（psql: \c gesp6_billing）
REVOKE ALL ON SCHEMA public FROM PUBLIC;            -- PG15+ 默认已收紧；PG13/14 执行此句加固
GRANT CREATE, USAGE ON SCHEMA public TO gesp6_app;  -- CREATE：迁移建表所需（FR-004a 最小化：仅本库 public schema）
-- 默认权限加固：约定迁移/导入/运行期统一使用 gesp6_app 连接（表 owner 即 gesp6_app）；
-- 以下语句兜底未来以其它角色建表的场景，保证 gesp6_app 对表/序列具备 DML 权限
ALTER DEFAULT PRIVILEGES FOR ROLE gesp6_app IN SCHEMA public GRANT ALL ON TABLES TO gesp6_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gesp6_app IN SCHEMA public GRANT ALL ON SEQUENCES TO gesp6_app;
```

> 权限边界说明：`gesp6_app` 拥有本库 `public` schema 的 CREATE（迁移建表）与表/序列 DML（SELECT/INSERT/UPDATE/DELETE）；**不授予**超级用户、**不授予** `postgres` 库以外的任何库权限、**不授予** TRUNCATE（导入/回滚不依赖 TRUNCATE，运维清库走 DBA）。如需进一步拆分「迁移账号/运行账号」，属运维加固选项，本期不做（架构 FR-004a 单应用账号语义）。

### 步骤 5：验证连接

```bash
psql "postgres://gesp6_app:<REPLACE_WITH_STRONG_PASSWORD>@<DB_HOST>:5432/gesp6_billing" -c '\dt'
# 预期输出：Did not find any relations.（空库，8 表待迁移创建）
```

### 步骤 6：配置连接串并写入环境

连接串格式（密码为步骤 3 创建账号时使用的同一预设密码，含 URL 特殊字符时需做 URL 编码）：

```
postgres://gesp6_app:<REPLACE_WITH_STRONG_PASSWORD>@<DB_HOST>:5432/gesp6_billing
示例：postgres://gesp6_app:<REPLACE_WITH_STRONG_PASSWORD>@db.example.com:5432/gesp6_billing
```

将连接串写入 `/var/learning/.env.local`（仅本机，权限 600，禁进版本库）：

```
DATABASE_URL=postgres://gesp6_app:<REPLACE_WITH_STRONG_PASSWORD>@<DB_HOST>:5432/gesp6_billing
```

并登记变量名至 `.env.local.example`（架构 §7.2，值留空，AC-030）。

---

## 4. 表 DDL 定稿（8 表）

> 以下 DDL 为 schema 定稿（语义等价于 `drizzle-kit generate` 的预期输出）。实施时以 `app/lib/db/schema.ts`（Drizzle schema 定义）为准，经 `drizzle-kit generate` 产出迁移 SQL；如生成产物与本文存在表达差异（如默认值表达式写法），以生成产物 + 人工 review 为准（§5 首迁流程）。

### 4.1 users —— 用户表

```sql
CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- 内部用户 id（计费/记录关联键）
  sso_sub    text NOT NULL UNIQUE,                        -- SSO sub 唯一业务标识（FR-005）
  created_at timestamptz NOT NULL DEFAULT now()
);
```

设计说明：`sso_sub UNIQUE` 支撑 `getOrCreateUser` 的 `ON CONFLICT DO NOTHING` 幂等建档（FR-006/AC-005，并发 10 请求仅 1 条）；`id` 为内部 UUID，对外不暴露；登录不查询本表（认证仍走 SSO，NFR-008）。

### 4.2 quota_accounts —— 额度账户表

```sql
CREATE TABLE quota_accounts (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_balance     integer NOT NULL DEFAULT 0 CHECK (free_balance >= 0),      -- 免费额度（赠送，优先扣减）
  recharge_balance integer NOT NULL DEFAULT 0 CHECK (recharge_balance >= 0),  -- 充值额度（付费资产）
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

设计说明：
- 双列建模（FR-016 定稿）：单列无法区分来源、无法实现「免费优先」；`free_balance` 优先扣减、充值保留（spec §8.6）。
- 双列 `CHECK (>= 0)` 为余额不变量提供 DB 级兜底（应用层单条 CASE WHEN UPDATE 已保证不出现负数，NFR-006 第二道防线）。
- 1:1 关系：`user_id` 同时为 PK 与 FK；`ON DELETE CASCADE`（用户删除连带账户；当前无删除路径，为未来管理后台预留，与「不主动清理」原则不冲突）。
- 新用户初始免费额度由应用层在建档事务中按 `GESP6_FREE_QUOTA_INITIAL`（默认 5）插入（架构 §5.1 userDao），DB 默认 0 仅为兜底。
- `updated_at`：扣费/充值 UPDATE 时由应用显式刷新为 `now()`（§4.3 语义补全，不引入 DB trigger，遵循代码简洁原则）。

### 4.3 solutions —— 解法内容表

```sql
CREATE TABLE solutions (
  content_hash text PRIMARY KEY,                    -- sha256 hex（computeContentHash(normalizedContent)）
  html         text NOT NULL,                       -- 解法 HTML 全文（LLM 原始输出）
  validated    boolean NOT NULL DEFAULT false,      -- 是否通过编译验证（GESP6_VALIDATE 语义）
  warning      text,                                -- 验证告警（可选）
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

设计说明：`content_hash` 为全表主键（FR-011），同一 hash 只存一份、全用户共享；`html` 存全文（text 无长度上限，现有文件 ~17KB/篇）；`validated=false` 的降级返回仍落库（按首次获取计费，FR-015 降级行）；`warning` 可空（fs 样例 meta 多数无此字段）。

### 4.4 primary_indexes —— 主 key 索引表

```sql
CREATE TABLE primary_indexes (
  platform     text NOT NULL,                       -- 平台标识（如 luogu / youdao）
  problem_id   text NOT NULL,                       -- 题目 id（如 P1001）
  content_hash text NOT NULL REFERENCES solutions(content_hash),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, problem_id)                -- 与现有 PrimaryIndex 精确查询语义一致（FR-012）
);
```

设计说明：PK(platform, problem_id) 支撑按主 key 精确查询（架构 §5.1 `getPrimaryContentHash`）；`content_hash NOT NULL FK→solutions` 保证索引不悬空；导入时悬空索引（指向缺失 content）违反 FK → 计入失败清单（与 FR-007 索引失效自愈语义对齐，见导入文档 §4）。

### 4.5 sample_indexes —— 样例指纹索引表

```sql
CREATE TABLE sample_indexes (
  sample_fp    text PRIMARY KEY,                    -- 样例指纹（sha256 hex，all/first 各自一行）
  content_hash text NOT NULL REFERENCES solutions(content_hash),
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

设计说明：`sample_fp` 唯一（FR-013）；多候选指纹 [all, first] 查询路径保留（两个指纹分别命中各自行，语义与 fs `getCandidateFingerprints` 一致）；同 primary，FK 防止悬空索引。

### 4.6 user_solution_access —— 用户已获取解法表（计费权威）

```sql
CREATE TABLE user_solution_access (
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash      text NOT NULL REFERENCES solutions(content_hash),
  first_accessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_hash)               -- 计费判定唯一权威（FR-017）
);

CREATE INDEX idx_user_solution_access_content_hash ON user_solution_access (content_hash);
```

设计说明：
- PK(user_id, content_hash) 是「用户是否已获取该解法」的**数据库级唯一权威**：存在记录 → 免费；不存在 → 首次获取计费（FR-015/FR-017）。并发同键插入仅一个成功（AC-015 三层防超扣的第 ① 层，架构 §4.3）。
- `ON CONFLICT DO NOTHING` 幂等插入（settle 事务第一步）。
- `first_accessed_at` = 首次计费时点（DEFAULT now()，插入即生效）。
- 反向索引 `idx_user_solution_access_content_hash`：管理后台「某解法被哪些用户获取」与级联删除检查预留（NFR-009 关联键复用）；当前无查询路径，成本极低（索引列为 FK 引用检查所需）。

### 4.7 billing_records —— 计费/充值流水表

```sql
CREATE TABLE billing_records (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  content_hash  text REFERENCES solutions(content_hash),      -- recharge 无（NULL）；consume 必填
  type          text NOT NULL CHECK (type IN ('consume', 'recharge')),
  amount        integer NOT NULL CHECK (amount > 0),           -- 「次数」口径（AR1-011），正数（FR-020）
  balance_after integer NOT NULL CHECK (balance_after >= 0),   -- 扣费/充值后 free+recharge 之和（R-11）
  operator      text,                                          -- 人工充值操作人标识（FR-020）
  remark        text,                                          -- 备注
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (                                                      -- AR1-008：consume 必须有 content_hash，recharge 必须无
    (type = 'consume'   AND content_hash IS NOT NULL) OR
    (type = 'recharge'  AND content_hash IS NULL)
  )
);

CREATE INDEX idx_billing_records_user_id_created_at ON billing_records (user_id, created_at);
```

设计说明：
- 成对 CHECK（AR1-008）在 DB 层固化「consume 有 content_hash / recharge 无 content_hash」口径，杜绝人工充值误带 hash。
- `amount`/`balance_after` 均为 integer「次数」单位（价格默认 1，AR1-011）；`balance_after` = 扣费后 `free_balance + recharge_balance` 之和（架构 §4.3/R-11）。
- `amount > 0`：consume 扣正数、recharge 充正数（FR-020「amount 为正数」）。
- `balance_after >= 0`：余额不变量兜底（与 quota 双列 CHECK 呼应）。
- `content_hash` FK 允许 NULL（recharge 场景），consume 场景由成对 CHECK 保证非空。
- `operator`/`remark` 仅 recharge 使用（consume 由系统写入，可 NULL）——不追加「recharge 必填 operator」CHECK，人工管理入口尚未实现，避免过度约束（实施时如需可后续迁移追加）。

### 4.8 solve_records —— 解题记录表

```sql
CREATE TABLE solve_records (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  job_id       text NOT NULL,                                  -- 仅溯源（job-store 不入库，FR-010）
  input_type   text NOT NULL CHECK (input_type IN ('text', 'image', 'platform')),
  platform     text,                                           -- 以下 3 项为 platform 输入特有
  problem_id   text,
  sample_fp    text,                                           -- 多解法扩展预留（可空，主 key 命中无指纹上下文）
  content_hash text NOT NULL REFERENCES solutions(content_hash),
  cached       boolean NOT NULL,                               -- 本次是否缓存命中（透传，不影响计费）
  validated    boolean NOT NULL,                               -- 是否通过编译验证（透传）
  billed       boolean NOT NULL,                               -- 本次是否计费（settle 判定结果）
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (                                                      -- platform 输入：platform/problem_id 成对
    (platform IS NULL AND problem_id IS NULL) OR
    (platform IS NOT NULL AND problem_id IS NOT NULL)
  )
);

CREATE INDEX idx_solve_records_user_id_created_at ON solve_records (user_id, created_at);
CREATE INDEX idx_solve_records_content_hash ON solve_records (content_hash);
```

设计说明：
- 字段对齐 FR-008 全量需求；`cached`/`validated` 仅透传写入，**不影响计费判定**（计费仅以 user_solution_access 为权威，AR1-020）。
- `job_id` 不唯一、不加 FK（job-store 不入库，仅溯源；UUID 防猜测语义在 route 层）。
- `content_hash NOT NULL FK→solutions`：解题记录必关联实际获取的解法。
- `platform/problem_id` 成对 CHECK：text/image 输入两者 NULL、platform 输入两者非空（数据质量约束，db-modeler 定稿权限内）。
- `sample_fp` 可空：主 key 命中路径无指纹上下文（AD-08 说明），多解法扩展后按需填充。
- `idx_solve_records_user_id_created_at`（用户历史）、`idx_solve_records_content_hash`（解法热度/管理后台）对齐架构 §7.3 索引要求。
- 唯一写入点：`billingService.settleSuccessfulSolution` 单事务内（AR1-021，route 回调不单独写）。

## 5. 迁移方案（drizzle-kit）

### 5.1 drizzle.config.ts

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',                       // 架构 §3.1（AD-01）
  schema: './app/lib/db/schema.ts',            // Drizzle schema 定义（8 表 + 索引 + 约束，本文 §4 语义等价物）
  out: './app/lib/db/migrations',              // 迁移产物输出目录（架构 §6）
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',       // 运行时读 env，禁硬编码（FR-001/NFR-011）
  },
  strict: true,
  verbose: true,
});
```

> drizzle-kit 以 `tsx`/Node 加载本配置；本地执行前确保 `.env.local` 已含 `DATABASE_URL`（Node 22 可经 `process.loadEnvFile('.env.local')` 预加载，或由 npm script 内联，与导入脚本 AD-12 一致）。

### 5.2 命令与目录结构

```bash
npx drizzle-kit generate   # 基于 schema.ts diff 生成迁移（首迁：空库 → 全量建表 SQL）
npx drizzle-kit migrate    # 执行未应用的迁移 + 版本追踪（幂等，AC-003）
```

```
app/lib/db/migrations/
└── {timestamp}_init/                  # 首次迁移（drizzle-kit generate 产出，如 20260818T000000_init/）
    ├── migration.sql                  # up：8 表 + 索引 + 约束 DDL（drizzle 自动生成）
    ├── snapshot.json                  # schema 快照（drizzle diff 依据，勿手改）
    └── down.sql                       # 人工手写回滚脚本（FR-004b/AR1-012，见 §5.4）
```

### 5.3 版本追踪表 `__drizzle_migrations`

- `drizzle-kit migrate` 自动创建版本追踪表（默认名 `__drizzle_migrations`；PG 方言新版 migrate 默认置于 `drizzle` schema，旧版 journal 方案建于 `public`——可在 drizzle.config.ts 的 `migrations` 选项自定义表名/schema，本期用默认）。
- 记录已应用迁移的 hash 与时间；再次执行已应用的迁移自动跳过（AC-003「同一迁移跑两次不报错」）。
- `__drizzle_migrations` 由 drizzle 自管，**不手改**。

### 5.4 down.sql 人工回滚约定

- 每次 `generate` 后人工编写同目录 `down.sql`（内容为该迁移逆操作，如 `DROP TABLE ... CASCADE`）。
- **不纳入** `drizzle-kit migrate` 自动执行（人工回滚用，AR1-012）；回滚时由 DBA 执行：`psql "$DATABASE_URL" -f app/lib/db/migrations/{timestamp}_xxx/down.sql`，随后可手动删除该迁移的 `__drizzle_migrations` 记录（或整体重建）。
- 原则：`up`（migrate）可重复执行、`down`（人工）单向回滚，回滚后如需重放先修复问题再 migrate。

### 5.5 程序化 migrate（部署路径）

架构 §6 `app/lib/db/migrate.ts`（可选路径，供部署编排调用，与 CLI 二选一）：

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getPool } from './connection';

export async function runMigrations(): Promise<void> {
  const db = drizzle(getPool());
  await migrate(db, { migrationsFolder: './app/lib/db/migrations' });
}
```

### 5.6 首迁流程（完整步骤）

1. **DBA 前置**：执行 §3 步骤 1–6（建库、建账号、验证连通、配置连接串）——**必须先于一切迁移**。
2. 编写 `app/lib/db/schema.ts`（§4 定稿的 8 表语义）。
3. `npx drizzle-kit generate` → 产出 `{timestamp}_init/{migration.sql, snapshot.json}`；人工 review 生成 SQL 与 §4 定稿一致。
4. 人工编写同目录 `down.sql`。
5. `npx drizzle-kit migrate` → 建 8 表 + 索引 + 约束 + `__drizzle_migrations`；**重复执行一次验证幂等**（AC-003）。
6. 验证：`psql ... -c '\dt'` 确认 8 表；`\d user_solution_access` 确认唯一约束。
7. 执行一次性导入（见 `arch-db-integration-import.md`）。
8. 迁移与导入分离（FR-004c）：先迁移建表、后导入数据，两条命令独立执行。

## 6. 表关系图与关联键预留

```
users (id) ──────── 1:1 ──────── quota_accounts (user_id PK/FK, free_balance, recharge_balance)
   │
   ├── 1:N ──────── user_solution_access (user_id, content_hash) ── 计费权威唯一约束 PK(user_id, content_hash)
   │                     │
   ├── 1:N ──────── billing_records (user_id, content_hash?, type consume/recharge)
   │                     │
   └── 1:N ──────── solve_records (user_id, content_hash, job_id 溯源)

solutions (content_hash PK)
   │ 1:N（被引用）
   ├──< primary_indexes (platform, problem_id) → content_hash    [PK(platform, problem_id)]
   ├──< sample_indexes  (sample_fp) → content_hash               [PK(sample_fp)]
   ├──< user_solution_access → content_hash
   ├──< billing_records (consume) → content_hash
   └──< solve_records → content_hash
```

**关联键预留（NFR-009）**：`userId`（users.id）、`contentHash`（solutions.content_hash）、`sampleFp`（sample_indexes.sample_fp）为跨实体标准关联字段——

| 预留键 | 已关联实体 | 未来复用场景 |
|--------|-----------|-------------|
| `userId` | quota_accounts / user_solution_access / billing_records / solve_records | 套餐、管理后台（用户查询）、历史列表页 |
| `contentHash` | primary/sample 索引、access、billing(consume)、solve_records | 多解法按解法计费（spec-multi-solution-v1.0）、成本报表 |
| `sampleFp` | sample_indexes PK、solve_records.sample_fp | 多解法按题聚合、指纹失效自愈 |

## 7. 字段口径表（全字段一览）

> 类型口径：`timestamptz` 存 UTC；`amount`/`balance_after`/`free_balance`/`recharge_balance` 均为「次数」integer（价格默认 1，AR1-011）；hash 类（content_hash/sample_fp/sso_sub）为 text（sha256 hex 64 字符 / SSO sub 可变长）。

| 表 | 列 | 类型 | 可空 | 默认 | 约束 | 含义 |
|----|----|------|:----:|------|------|------|
| users | id | uuid | 否 | gen_random_uuid() | PK | 内部用户 id |
| users | sso_sub | text | 否 | — | UNIQUE | SSO sub 唯一业务标识 |
| users | created_at | timestamptz | 否 | now() | — | 建档时间 |
| quota_accounts | user_id | uuid | 否 | — | PK、FK→users(id) CASCADE | 账户归属用户 |
| quota_accounts | free_balance | integer | 否 | 0 | CHECK ≥ 0 | 免费额度（优先扣减） |
| quota_accounts | recharge_balance | integer | 否 | 0 | CHECK ≥ 0 | 充值额度（付费资产） |
| quota_accounts | updated_at | timestamptz | 否 | now() | — | 最近扣费/充值时间 |
| solutions | content_hash | text | 否 | — | PK | 解法内容哈希（sha256 hex） |
| solutions | html | text | 否 | — | — | 解法 HTML 全文 |
| solutions | validated | boolean | 否 | false | — | 是否通过编译验证 |
| solutions | warning | text | 是 | — | — | 验证告警（可选） |
| solutions | created_at | timestamptz | 否 | now() | — | 首次落库时间 |
| primary_indexes | platform | text | 否 | — | PK 组 | 平台标识（luogu/youdao…） |
| primary_indexes | problem_id | text | 否 | — | PK 组 | 题目 id（P1001…） |
| primary_indexes | content_hash | text | 否 | — | FK→solutions(content_hash) | 指向的解法 |
| primary_indexes | created_at | timestamptz | 否 | now() | — | 索引建立时间 |
| sample_indexes | sample_fp | text | 否 | — | PK | 样例指纹（sha256 hex） |
| sample_indexes | content_hash | text | 否 | — | FK→solutions(content_hash) | 指向的解法 |
| sample_indexes | created_at | timestamptz | 否 | now() | — | 索引建立时间 |
| user_solution_access | user_id | uuid | 否 | — | PK 组、FK→users(id) CASCADE | 获取者 |
| user_solution_access | content_hash | text | 否 | — | PK 组、FK→solutions(content_hash) | 已获取解法 |
| user_solution_access | first_accessed_at | timestamptz | 否 | now() | — | 首次获取（计费）时点 |
| billing_records | id | bigserial | 否 | — | PK | 流水 id |
| billing_records | user_id | uuid | 否 | — | FK→users(id) | 归属用户 |
| billing_records | content_hash | text | **是** | — | FK；consume 必填 / recharge 必 NULL（CHECK） | 关联解法（consume 场景） |
| billing_records | type | text | 否 | — | CHECK IN ('consume','recharge') | 流水类型 |
| billing_records | amount | integer | 否 | — | CHECK > 0 | 消耗/充值次数（正数） |
| billing_records | balance_after | integer | 否 | — | CHECK ≥ 0 | 变更后 free+recharge 之和 |
| billing_records | operator | text | 是 | — | — | 人工充值操作人（consume 为 NULL） |
| billing_records | remark | text | 是 | — | — | 备注 |
| billing_records | created_at | timestamptz | 否 | now() | — | 流水时间 |
| solve_records | id | bigserial | 否 | — | PK | 记录 id |
| solve_records | user_id | uuid | 否 | — | FK→users(id) | 解题用户 |
| solve_records | job_id | text | 否 | — | — | 任务 id（仅溯源，不唯一） |
| solve_records | input_type | text | 否 | — | CHECK IN ('text','image','platform') | 输入类型 |
| solve_records | platform | text | 是 | — | 与 problem_id 成对（CHECK） | 平台（platform 输入） |
| solve_records | problem_id | text | 是 | — | 与 platform 成对（CHECK） | 题目 id（platform 输入） |
| solve_records | sample_fp | text | 是 | — | — | 样例指纹（多解法预留） |
| solve_records | content_hash | text | 否 | — | FK→solutions(content_hash) | 本次实际获取的解法 |
| solve_records | cached | boolean | 否 | — | — | 是否缓存命中（透传） |
| solve_records | validated | boolean | 否 | — | — | 是否通过验证（透传） |
| solve_records | billed | boolean | 否 | — | — | 本次是否计费 |
| solve_records | created_at | timestamptz | 否 | now() | — | 解题成功时间 |

## 8. 与架构草案不一致处清单

| # | 发现 | 判定 | 处理 |
|---|------|------|------|
| 1 | 架构 §7.3 标题写「7 表」，表格实际列出 **8 张表**（含 solve_records）；spec §3.0 实体总览亦为 8 实体、FR-008 强制要求 solve_records | 标题笔误，非决策变更 | 定稿 8 表（§1），遵循表格实体清单与 FR-008 |
| 2 | fs 的 `SolutionMeta` 实际样例（content/*.json）仅含 `validated`/`createdAt`，`warning` 字段在全部样例中缺失（类型定义中为可选） | 与草案 `warning text`（可空）**兼容，无冲突** | solutions.warning 保持可空，导入按缺省 NULL 处理 |
| 3 | primary 索引文件名为 `{platform}_{problemId}.json`（`_` 连接），草案未定义文件名解析规则 | 无冲突（当前 platform∈{luogu,youdao}、problemId 均不含 `_`），但解析须防御性处理 | 导入脚本按**首个 `_`** 分割文件名（见导入文档 §2），并在脚本中校验分割结果非空 |
| 4 | 架构 §4.3 扣费 UPDATE 未提及刷新 `quota_accounts.updated_at`（草案含该列） | 语义补全，不偏离 | 定稿在扣费/充值 UPDATE 中显式 `SET updated_at = now()`（§4.2） |
| 5 | 架构 §5.1 DAO 建议 4 个文件（user/solution/access/billing），本任务仅产出 schema 与脚本设计，不落 DAO 代码 | 属实施范围 | DAO 文件粒度按架构 AR1-010 约束（4 个）执行，本文档不涉及 |