# 一次性数据导入脚本设计（数据库与业务系统整合）

**日期**：2026-08-18 ｜ **状态**：approved ｜ **版本**：v1.0
**需求依据**：`docs/specs/spec-db-integration-v1.0.md`（v1.2，FR-023~026、AC-021~024）
**架构依据**：`docs/architecture/arch-db-integration-v1.0.md`（v1.1，AD-11/AD-12、AR1-001/AR1-013、§5.1 insertIfAbsent*、§8.1 分批提交）
**Schema 依据**：`docs/architecture/arch-db-integration-schema.md`（v1.0，8 表 DDL 定稿）
**实际核对**：`app/lib/ai/services/fs-html-cache.ts`、`fs-paths.ts`、`data/gesp6/` 真实样例（primary 22 个 / content 108 html + 108 json / sample 9 个，与 AC-021 基线一致）

---

## 1. 导入总览

- **目标脚本**：`scripts/migrate-fs-cache-to-db.ts`（spec §9 / 架构 §6，D6 数据导入工具）
- **运行命令**：`npm run db:import`（=`tsx scripts/migrate-fs-cache-to-db.ts`，架构 §3.2；tsx 为 devDep，AD-12）
- **数据源**：`data/gesp6/`（根目录可被 `GESP6_CACHE_FS_DIR` 覆盖，默认 `path.resolve(process.cwd(), 'data/gesp6')`，与 FsHtmlCache 一致）
- **目标**：`gesp6_billing` 库的 3 张缓存表（`solutions` / `primary_indexes` / `sample_indexes`）
- **当前规模**（导入前脚本实际扫描数为准，AC-021 比对依据）：

  | 源目录 | 文件 | 数量 |
  |--------|------|------|
  | `content/{h2}/{hash}.html` | HTML 全文 | 108 |
  | `content/{h2}/{hash}.json` | SolutionMeta | 108（与 html 成对） |
  | `primary/{platform}_{problemId}.json` | PrimaryIndex | 22 |
  | `sample/{fp2}/{fp}.json` | SampleIndex | 9 |

- **导入顺序**：**先 `solutions`、后 `primary_indexes`/`sample_indexes`**（索引表 `content_hash` 有 FK→solutions，必须先有内容行）。

## 2. 导入映射表（fs 文件 → DB 表/字段）

### 2.1 `content/` → `solutions`

fs 路径规则（fs-paths.ts `getContentHtmlPath`/`getContentMetaPath`）：`{baseDir}/content/{hash前2位}/{hash}.html` 与 `{hash}.json`，**文件名即完整 hash**（hash 从文件名 base 提取，勿用路径拼接截取）。

| fs 数据 | DB 列 | 转换/取值规则 |
|---------|-------|--------------|
| 文件名（去 `.html`/`.json` 后缀） | `solutions.content_hash` | PK，sha256 hex 64 字符 |
| `{hash}.html` 文件全文 | `solutions.html` | `fs.readFile(..., 'utf-8')`，text NOT NULL |
| `{hash}.json` → `meta.validated` | `solutions.validated` | boolean 必填；缺失/类型错误 → 计入失败清单 |
| `{hash}.json` → `meta.warning` | `solutions.warning` | 可选；缺失 → NULL（真实样例全部无此字段） |
| `{hash}.json` → `meta.createdAt` | `solutions.created_at` | ISO 字符串直接写入 timestamptz；缺失/非法 → 兜底 `now()` 并记 WARN（不阻塞） |

**成对校验**（FR-025a）：以 hash 为键，html 与 json **必须同时存在且可读**——仅一侧存在、json 无法解析、validated 缺失均计入失败清单，该 hash **整体跳过**（solutions 行要求 html+validated 齐备）。

### 2.2 `primary/` → `primary_indexes`

fs 路径规则（`getPrimaryIndexPath`）：`{baseDir}/primary/{platform}_{problemId}.json`，**文件名以首个 `_` 分割**为 platform 与 problemId（防御性解析，见 §7 不一致处第 3 条）。

| fs 数据 | DB 列 | 转换/取值规则 |
|---------|-------|--------------|
| 文件名 `_` 左侧 | `primary_indexes.platform` | 如 `luogu`/`youdao`；解析为空 → 失败清单 |
| 文件名 `_` 右侧 | `primary_indexes.problem_id` | 如 `P1001`/`13`；解析为空 → 失败清单 |
| JSON → `contentHash` | `primary_indexes.content_hash` | 必填（string）；缺失/非字符串 → 失败清单 |
| JSON → `createdAt` | `primary_indexes.created_at` | 缺失/非法 → 兜底 `now()` + WARN |

### 2.3 `sample/` → `sample_indexes`

fs 路径规则（`getSampleIndexPath`）：`{baseDir}/sample/{fp前2位}/{fp}.json`，**文件名即指纹**（hash 从文件名 base 提取）。

| fs 数据 | DB 列 | 转换/取值规则 |
|---------|-------|--------------|
| 文件名（去 `.json` 后缀） | `sample_indexes.sample_fp` | PK，sha256 hex；all/first 指纹各自一行 |
| JSON → `contentHash` | `sample_indexes.content_hash` | 必填（string）；缺失/非字符串 → 失败清单 |
| JSON → `createdAt` | `sample_indexes.created_at` | 缺失/非法 → 兜底 `now()` + WARN |

### 2.4 悬空索引语义（FK 约束影响）

索引 JSON 指向的 `contentHash` 在 `content/` 下**无对应文件**（fs 允许的失效索引，FR-007 自愈场景）→ 导入时 `primary_indexes`/`sample_indexes` 违反 FK→solutions → **该索引行计入失败清单、跳过**（不落悬空行），脚本非零退出，修复后重跑补导。与 fs 查询语义对齐：DB 中索引必指向存在的解法，不存在即查不到 → 缓存 miss 走 LLM（AC-024 语义一致）。

## 3. 脚本结构设计（伪代码）

> 风格：显式返回类型、禁 any、`ServiceResult` 语义复用（api-conventions）、错误码 `GESP6_MIGRATION_VALIDATION_FAILED` 语义（FR-033）。

```ts
// scripts/migrate-fs-cache-to-db.ts
// 一次性导入：data/gesp6/ 存量缓存 → PostgreSQL（D6，FR-023~026）
// 运行：npm run db:import（= tsx scripts/migrate-fs-cache-to-db.ts）
// 退出码：0 = 全部导入成功（含 skipped）；非 0 = 存在失败（GESP6_MIGRATION_VALIDATION_FAILED 语义）
// 说明：以下为结构伪代码；实施时按架构 §6 补全 import——
//   drizzle 表对象（solutions/primaryIndexes/sampleIndexes，来自 @/app/lib/db/schema.ts）、
//   DbTx 类型、SolutionMeta（来自 fs-paths.ts 既有类型）、printScanStat/printReport 等输出工具

import { promises as fs } from 'fs';
import path from 'path';
import { getDbConfig } from '@/app/lib/db/config';    // 惰性校验 DATABASE_URL（AD-07）
import { getPool } from '@/app/lib/db/connection';    // 单例连接池（D1）

/** 一条导入失败记录（明细报告用） */
interface ImportFailure {
  source: string;      // 相对源路径（如 content/0e/xxx.json）
  reason: string;      // 失败原因（成对缺失/解析失败/FK 违反/IO 异常）
}

/** 批次统计（报告用） */
interface BatchStat {
  scanned: number;
  imported: number;    // 实际新插入
  skipped: number;     // DO NOTHING 命中（已存在）
  failed: number;
}

function loadEnv(): void {
  // AD-12/AR1-004：与项目现状一致，Node 22 内置加载 .env.local；失败仅告警（继续尝试连接）
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local 缺失时依赖进程环境变量（CI/部署注入），不阻断
  }
}

async function scanContentDir(baseDir: string): Promise<{
  pairs: Array<{ contentHash: string; htmlPath: string; meta: SolutionMeta; createdAt: string }>;
  failures: ImportFailure[];
}> {
  // 1. 递归遍历 content/ 下所有 *.html 与 *.json，以文件名（去后缀）为 hash 键
  // 2. 成对校验：缺 html / 缺 json / json 解析失败 / validated 非 boolean → failures，跳过该 hash
  // 3. createdAt 缺失/非法 → 兜底 now() 并记 WARN
  // 返回 pairs 与 failures；空目录不报错（导入 0 行）
}

async function scanPrimaryDir(baseDir: string): Promise<{
  indexes: Array<{ platform: string; problemId: string; contentHash: string; createdAt: string }>;
  failures: ImportFailure[];
}> {
  // 1. 遍历 primary/*.json，文件名以 indexOf('_') 首个下划线分割（见 §7 不一致处第 3 条）
  // 2. 任一侧为空 / JSON 解析失败 / contentHash 缺失 → failures，跳过该索引
}

async function scanSampleDir(baseDir: string): Promise<{
  indexes: Array<{ sampleFp: string; contentHash: string; createdAt: string }>;
  failures: ImportFailure[];
}> {
  // 1. 遍历 sample/{fp2}/{fp}.json，文件名（去后缀）即 sampleFp
  // 2. JSON 解析失败 / contentHash 缺失 → failures，跳过该索引
}

/** 批量导入（每批 ≤ 500 行一个事务；DO NOTHING 幂等，AD-11/AR1-001） */
async function importBatch<T extends { contentHash: string }>(
  rows: T[],
  insert: (tx: DbTx, batch: T[]) => Promise<{ inserted: number }>,
): Promise<{ imported: number; failed: number; failures: ImportFailure[] }> {
  // 按 batchSize=500 切块（NFR-003/AR1-013），每块 db.transaction：
  //   insert(tx, batch) → INSERT ... ON CONFLICT DO NOTHING，返回实际插入行数（imported）
  //   catch：该批计入 failed 与 failures（含 FK 违反的悬空索引行），**继续下一批**（FR-025c）
  // 注：DO NOTHING 命中数 = batch.length - inserted（skipped），用于报告
}

async function main(): Promise<number> {
  // —— 0. 环境与连接 ——
  loadEnv();
  const config = getDbConfig();                 // DATABASE_URL 缺失 → 抛错 → 退出码 1
  const baseDir = process.env.GESP6_CACHE_FS_DIR
    ?? path.resolve(process.cwd(), 'data/gesp6');

  // —— 1. 扫描 + 成对校验（FR-025a），输出扫描统计（AC-021 比对依据）——
  const content = await scanContentDir(baseDir);
  const primary = await scanPrimaryDir(baseDir);
  const sample = await scanSampleDir(baseDir);
  printScanStat({ content: content.pairs.length, primary: primary.indexes.length, sample: sample.indexes.length });

  // —— 2. 分批导入（顺序固定：solutions → primary_indexes → sample_indexes，FK 依赖）——
  const db = drizzle(getPool());
  const rSolutions = await importBatch(content.pairs, async (tx, batch) => {
    return tx.insert(solutions).values(
      batch.map((p) => ({ contentHash: p.contentHash, html: p.html, validated: p.meta.validated, warning: p.meta.warning ?? null, createdAt: p.createdAt })),
    ).onConflictDoNothing().run();               // insertIfAbsentSolution 语义（§5）
  });
  const rPrimary = await importBatch(primary.indexes, async (tx, batch) => {
    return tx.insert(primaryIndexes).values(batch).onConflictDoNothing().run();  // insertIfAbsentPrimaryIndex
  });
  const rSample = await importBatch(sample.indexes, async (tx, batch) => {
    return tx.insert(sampleIndexes).values(batch).onConflictDoNothing().run();   // insertIfAbsentSampleIndex
  });

  // —— 3. 汇总报告（FR-025b）——
  printReport([
    { table: 'solutions', stat: rSolutions },
    { table: 'primary_indexes', stat: rPrimary },
    { table: 'sample_indexes', stat: rSample },
  ]);
  for (const f of [...content.failures, ...primary.failures, ...sample.failures, ...rSolutions.failures, ...rPrimary.failures, ...rSample.failures]) {
    console.error(`[failure] ${f.source}: ${f.reason}`);   // 失败明细，便于修复后重跑（FR-025c）
  }

  // —— 4. 退出码（FR-025c/AC-023）——
  const scanFailures = [...content.failures, ...primary.failures, ...sample.failures];
  const importFailures = [...rSolutions.failures, ...rPrimary.failures, ...rSample.failures];
  return scanFailures.length + importFailures.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
```

**报告输出示例**（供 AC-021 比对）：

```
[scan] content: html=108 json=108 paired=108 broken=0
[scan] primary: scanned=22
[scan] sample: scanned=9
[solutions]       scanned=108 imported=108 skipped=0 failed=0
[primary_indexes] scanned=22  imported=22  skipped=0 failed=0
[sample_indexes]  scanned=9   imported=9   skipped=0 failed=0
[result] exit=0
```

## 4. 幂等性 / 可重跑 / 失败报告（FR-023~026、AC-021~024）

| 需求 | 设计 |
|------|------|
| 幂等可重复执行（FR-024/AC-022） | 全表走 `ON CONFLICT DO NOTHING`（insertIfAbsent*）：重跑时已存在行全部 **skipped**，不产生重复数据；不 TRUNCATE、不删除源数据（FR-026/spec §8.5） |
| 损坏数据不阻断其余导入（FR-025c/AC-023） | 扫描期损坏（成对缺失/json 解析失败/validated 缺失）与导入期失败（FK 违反/IO 异常）均记入失败清单，**继续处理后续文件/批次**，最后统一报告 + 非零退出码 |
| 修复后重跑（FR-024/FR-025c） | 失败项修复后（如补齐配对 meta、清理悬空索引源文件）直接重跑：已成功行 skipped、失败行重新尝试，只补差量 |
| 报告（FR-025b） | 每表 scanned/imported/skipped/failed 四计数 + 失败明细（source + reason）；扫描统计打印供与 fs 实际文件数比对（AC-021，当前基线 108/22/9 以脚本实际扫描为准） |
| 退出码（FR-033） | 任一失败 → `process.exit(1)`（`GESP6_MIGRATION_VALIDATION_FAILED` 语义）；全成功（含 skipped）→ 0 |
| 批量与事务（NFR-003/AR1-013） | 每批 ≤ 500 行一个事务；单批失败只记该批失败、继续下一批；分钟级完成（108+22+9 行规模远低于瓶颈） |
| 与线上并发写隔离（R-02） | 导入在维护窗口执行或接受幂等重跑补导；导入完成后才切换 `GESP6_CACHE_DRIVER=db`（R-03 统一部署步骤） |

## 5. 冲突策略：导入期 insertIfAbsent\* 与运行期 upsert\* 的区分（AD-11/AR1-001）

| 维度 | 导入期（脚本） | 运行期（DbHtmlCache.set） |
|------|---------------|--------------------------|
| DAO 方法 | `insertIfAbsentSolution` / `insertIfAbsentPrimaryIndex` / `insertIfAbsentSampleIndex` | `upsertSolution` / `upsertPrimaryIndex` / `upsertSampleIndex` |
| SQL 语义 | `INSERT ... ON CONFLICT DO NOTHING`（返回是否新插入） | `INSERT ... ON CONFLICT DO UPDATE`（覆盖） |
| 冲突处理 | **跳过已存在**，计数 skipped；DB 已有记录以 DB 为准 | 更新现有行（upsertSolution 刷 validated/warning；upsertPrimaryIndex/upsertSampleIndex 更新 content_hash 指向最新） |
| 数据性质 | 导入源为**静态基线**（导入时点的 fs 快照） | 运行期数据为**动态权威**（forceRegenerate/Plan B 回写持续维护） |
| 覆盖风险 | 导入若 DO UPDATE 会覆盖运行期已更新的 validated 状态（如降级返回后修正） | 无 |

**区分理由（AR1-001）**：导入只做「存量补录」，不得反向覆盖运行期已由 `DbHtmlCache.set` 维护的最新状态；运行期 upsert 保证缓存始终指向最新内容（forceRegenerate 覆盖、sample 索引自愈等）。导入与运行期无并发竞态：导入在维护窗口执行（R-02），导入完成后 fs 停用、运行期写全部走 DB（FR-026）。

## 6. 校验清单（导入前检查项）

- [ ] **DBA 前置完成**：`gesp6_billing` 库与 `gesp6_app` 账号已建（schema 文档 §3 步骤 1–6），`psql` 用连接串可连通
- [ ] **迁移已执行**：`\dt` 确认 8 张表 + 索引 + 约束存在（含 `user_solution_access` 唯一约束、`billing_records` 成对 CHECK）；`drizzle-kit migrate` 重复执行验证幂等（AC-003）
- [ ] **账号权限**：`gesp6_app` 对 3 张缓存表具备 INSERT/SELECT（实际以导入运行为准；FK 关联的 solutions 为同一账号操作，无跨账号授权需求）
- [ ] **备份**：`pg_dump gesp6_billing` 全量备份（FR-026 建议，支持整体回滚；导入本身幂等，备份为二次保障）
- [ ] **fs 数据完整性**：`data/gesp6/` 存在且可读；`content/` html/json 成对、`primary/`、`sample/` 文件可解析；记录预扫描数量与 AC-021 基线（108/22/9）比对
- [ ] **维护窗口**：确认导入期间无线上 fs 写入（R-02）；或接受脚本幂等重跑补导
- [ ] **环境**：`.env.local` 含 `DATABASE_URL`（AR1-004）；`GESP6_CACHE_FS_DIR` 指向真实缓存根（缺省 `data/gesp6`）
- [ ] **驱动切换时机**：`GESP6_CACHE_DRIVER` 导入期间**保持现状**（fs/memory），导入完成且校验通过后，按统一部署步骤切 `db`（R-03：先 `db:migrate` → `db:import` → 全部实例同步切换）

## 7. 与架构草案不一致处（导入相关，交叉引用 schema 文档 §8）

| # | 发现 | 判定/处理 |
|---|------|----------|
| 1 | 架构 §7.3 标题「7 表」实际列出 8 表 | 定稿 8 表，导入目标为其中 3 张缓存表（详见 schema 文档 §8-1） |
| 2 | fs `SolutionMeta` 真实样例无 `warning` 字段（类型定义可选） | 导入按缺省 NULL 写入 `solutions.warning`（schema 文档 §8-2） |
| 3 | `primary/` 文件名 `{platform}_{problemId}.json` 以 `_` 连接，架构草案未定义解析规则 | 脚本按**首个 `_`** 分割（`indexOf('_')`，非 `split('_')[0]`，防御 problemId 含 `_` 的未来数据）；分割结果任一侧为空 → 失败清单（schema 文档 §8-3） |
| 4 | 索引 JSON 可指向 content 不存在的 hash（fs 失效索引，FR-007 自愈语义） | 因 `primary_indexes`/`sample_indexes` 的 FK→solutions 约束，悬空索引导入失败计入失败清单；与 fs 语义对齐（DB 无悬空索引），见 §2.4 |