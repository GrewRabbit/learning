# 数据库与业务系统整合 技术架构 v1.1

**日期**：2026-08-18 ｜ **状态**：approved ｜ **版本**：v1.1
**需求来源**：`docs/specs/spec-db-integration-v1.0.md`（v1.2，approved）——唯一需求依据
**参考架构**：`docs/architecture/arch-sso-v1.3.md`（仅参考结构风格与决策标注法，不照搬内容）
**前置核对**：package.json（Next.js 15.1.6 / TS ^5.7.3 / zod ^3.24.1 / Node 22 类型）、现有 HtmlCache 接口、job-store、route.ts、guard.ts、env.ts、middleware.ts（Edge 禁 DB）均已对齐

**变更记录**：

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.1 | 2026-08-18 | 根据 r1 架构评审修订：DAO 冲突策略区分、sampleFp 填充落点、E2E/env 路径修正、settle 取消竞态 | review-r1 |

## 1. 架构概述

### 1.1 目标

引入 PostgreSQL 作为业务数据权威源（用户/解题记录/解法缓存/计费额度四类数据），以数据库事务保证多实例下计费与额度的原子一致性；`DbHtmlCache` 作为 `GESP6_CACHE_DRIVER=db` 分支接入现有 HtmlCache 切换机制（Orchestrator 零改动）；一次性脚本将 `data/gesp6/` 存量缓存导入数据库。

### 1.2 核心架构决策表

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| AD-01 | ORM/驱动 | **Drizzle ORM + node-postgres（pg）**（§3.1） | TS 原生 schema-first 类型推导、轻量无引擎二进制、pg Pool 成熟、与 zod 风格契合、满足 NFR-010 |
| AD-02 | 连接管理 | 单例连接池、惰性建立（首次使用触发）、`statement_timeout` 服务端超时 + `connectionTimeoutMillis` 连接超时；多实例各自维护独立池（共享同一库） | FR-002/FR-003；pg Pool 经 startup packet 下发 `statement_timeout`，无需 SET |
| AD-03 | 迁移方案 | drizzle-kit 生成 up 迁移 + 每目录手写 `down.sql`（人工回滚）+ `__drizzle_migrations` 版本追踪；迁移与导入脚本分离（FR-004c） | FR-004；drizzle-kit 迁移可重复执行（AC-003）；down 由人工执行不纳入自动 migrate |
| AD-04 | 计费事务 | `billingService.settleSuccessfulSolution` 单事务完成：access 唯一约束插入 → 免费优先 CASE WHEN 条件 UPDATE（单条原子，§4.3）→ billingRecords → solveRecords；事务隔离 READ COMMITTED | FR-009/FR-018/NFR-006；唯一约束 + 条件 UPDATE + 行锁保证并发防超扣（AC-015） |
| AD-05 | 用户建档 | `getOrCreateUser(sub)` 幂等：`INSERT users ON CONFLICT (sso_sub) DO NOTHING` + quota 初始化同事务，并发仅一条 | FR-006/AC-004/AC-005 |
| AD-06 | 缓存驱动 | `DbHtmlCache` 实现现有 `HtmlCache` 接口；读失败降级 miss（不算 DB 故障），写失败仅日志，单飞保留；`GESP6_CACHE_DRIVER=db` 分支接入单例 | FR-011~014/NFR-007；Orchestrator 零改动（spec §8.4） |
| AD-07 | DB env 校验 | 新增独立 `getDbConfig()`（`app/lib/db/config.ts`）**惰性校验** `DATABASE_URL`；不并入 `validateEnv()`（不强制启动预连） | FR-003/FR-031/NFR-011；启动不依赖 DB（NFR-008），未配置时仅 DB 相关请求报错（AC-001） |
| AD-08 | contentHash/sampleFp 填充 | `Solution.contentHash` 权威填充点 = Orchestrator 两个 solve 分支**所有成功返回路径**（含主 key 命中提前 return）返回前统一填充；`sampleFp` 同由 Orchestrator 返回前统一填充（与 contentHash 一并，DbHtmlCache 层不填充，AR1-002/016） | FR-029/AC-027；覆盖缓存命中、Plan B、compute 降级全部成功路径；Plan B 场景须记**当前请求 hash**（用户维度计费语义，spec §8.8） |
| AD-09 | 计费信息回传 | `JobRecord` 扩展 `charged`/`balanceRemaining`，`completeJob` 签名扩展，GET 轮询 done 响应顶层透出 | FR-022/AC-025/AC-026 |
| AD-10 | 前端反馈 | 轮询 done 时 `use-job-polling.ts` 将 charged/balanceRemaining 写入 sessionStorage → `/result` 展示；`balanceRemaining=null` 显示「额度暂不可用」 | FR-030 |
| AD-11 | 导入冲突策略 | 导入走独立 `insertIfAbsentSolution`/`insertIfAbsentPrimaryIndex`/`insertIfAbsentSampleIndex` DAO 方法（`ON CONFLICT DO NOTHING`，跳过已存在并报告 skipped 计数，脚本可重跑），与运行期 `upsertSolution`/`upsertPrimaryIndex`/`upsertSampleIndex`（DO UPDATE）语义分离（§5.1，AR1-001） | FR-024；导入源为静态基线，DB 中已存在的记录以 DB 为准（运行期 upsert 已维护 validated 状态），导入跳过不覆盖；全量对账列后续（非本期） |
| AD-12 | 导入脚本运行 | `scripts/migrate-fs-cache-to-db.ts` 经 `tsx`（devDep）运行，`process.loadEnvFile('.env.local')` 加载连接串（与项目现状一致：SSO/AI 变量均在 `.env.local`，`.env` 不存在，AR1-004） | FR-023；Node 22 内置加载，零新增运行时依赖 |

### 1.3 边界（不实现，依据 spec §5）

`job-store` 不入库（FR-010/spec §8.1）；GET 轮询无鉴权维持现状（FR-027）；`guard.ts` 不改动（FR-007，仅返回 SSO claims）；middleware.ts 禁引用任何 DB env/模块（FR-031/AC-028）；在线支付/自助充值/管理后台/`userSolutionAccess` 历史页不做；Redis 限流不做；`FsHtmlCache` 与 `data/gesp6/` 保留（FR-026/spec §8.5）；不删除 `env.ts` 既有分组校验。

## 2. 模块划分

| 模块 | 名称 | 运行时 | 职责 | 对应 FR |
|------|------|--------|------|---------|
| D1 | DB 基础设施层 | Node | 连接池单例（惰性）、DB env 配置、schema 定义、迁移执行、DAO、DB 错误分类 | FR-001~004、FR-011~013、FR-032/033 |
| D2 | 计费服务 | Node | `settleSuccessfulSolution`（原子计费+记录）、`rechargeBalance`、余额查询、额度不足/DB 故障分类 | FR-015~022 |
| D3 | DB 缓存驱动 | Node | `DbHtmlCache` 实现 HtmlCache 接口；html-cache.ts 单例新增 `db` 分支 | FR-011~014 |
| D4 | 业务整合层 | Node | route.ts 建档+完成回调整合；job-store 扩展；Solution/orchestrator 扩展 | FR-005~010、FR-027~029 |
| D5 | 前端反馈 | 浏览器 | 轮询透出计费信息至 sessionStorage；result 页展示 | FR-022、FR-030 |
| D6 | 数据导入工具 | Node（脚本） | fs 扫描/成对校验/批量导入/报告/退出码 | FR-023~026 |
| D7 | 配置与环境 | Node | `db/config.ts` 惰性校验、`.env.local.example` 登记 | FR-031、NFR-011 |

**依赖关系**：`D4 → D2 → D1`（route 调 billing 调 DAO）；`D3 → D1`（DbHtmlCache 调 DAO）；`D6 → D1`（脚本直连 DAO/连接池，**不走** D2 计费）；`D5 → D4`（HTTP 轮询契约）；`D7` 被 D1 引用（独立模块，不反向依赖 env.ts）；middleware/guard.ts/客户端组件均不引用 D1~D3、D7（AC-028）。

## 3. 技术选型

### 3.1 ORM/驱动决策

| 项 | 决策 | 版本 | 备选 | 理由 |
|----|------|------|------|------|
| ORM | **Drizzle ORM** | 目标 `drizzle-orm ^0.3x`（实施前 `npm view drizzle-orm versions` 验证存在性并精确锁定；drizzle-kit 配套，AR1-014） | Prisma | ① TS 原生 schema 定义直接推导类型，无代码生成步骤，与项目 zod/TS 风格契合（NFR-010）；② 无 Prisma 引擎二进制，构建/部署零额外产物；③ 事务（`db.transaction`）与 pg 连接池一等支持；④ 轻量，与「不为一次性场景做抽象」原则一致 |
| 驱动 | **node-postgres（pg）** | 目标 `pg ^8`（`npm view pg versions` 验证，AR1-014） | postgres.js | Pool 配置完备：`max/min`、`connectionTimeoutMillis`、`statement_timeout`（经 startup packet 下发，服务端强制，非应用层 SET） |
| 迁移 | drizzle-kit | 目标 `drizzle-kit ^0.2x`（devDep，AR1-014） | node-pg-migrate | `generate` 自动 diff 生成 up SQL + 时间戳目录 + `__drizzle_migrations` 版本表 + 可重复执行（AC-003）；down 手写满足 FR-004b |
| 脚本运行 | tsx | 目标 `tsx ^4`（devDep，AR1-014） | Node type-stripping | Node 22 运行 TS 脚本稳定（drizzle.config.ts 亦需 TS 读取） |

**兼容性核对**：`@types/node ^22`（Node 22）、Next.js 15.1.6（App Router，Route Handler 为 Node runtime）、TS ^5.7.3 —— drizzle-orm/pg/tsx 均要求 Node ≥ 18，兼容；**禁止**在 middleware（Edge）与客户端 import 任何 DB 模块（§8.2）。

### 3.2 依赖变更

运行时新增：`drizzle-orm`、`pg`；dev 新增：`drizzle-kit`、`tsx`、`@types/pg`。npm scripts 新增：`db:migrate`（`drizzle-kit migrate`）、`db:generate`（`drizzle-kit generate`）、`db:import`（`tsx scripts/migrate-fs-cache-to-db.ts`）。

## 4. 数据流设计

### 4.1 正常流（POST /api/solve → 轮询 done）

```
客户端 → POST /api/solve
  1. requireAuth(req) → AccessTokenClaims{ sub }         失败 → 401（AUTH_* 现状不变，guard.ts 不改）
  2. getOrCreateUser(sub) → users.id（+quota 初始化）     失败 → 见 §4.2（建档失败；fail-open 放行时 userId=null，流程继续，步骤 4 createJob 正常执行，settle 阶段跳过 DB，AR1-006）
  3. Zod 校验 + resolvePlatform（现状不变）
  4. createJob() → jobId（现状不变）
  5. 后台 gesp6Orchestrator.solve(problem, ...)（不 await）
  6. 立即返回 { jobId }
后台 .then(result)：
  a. result.error.code === GESP6_CANCELLED 或任务已取消 → 丢弃（现状不变）
  b. result.success && result.data →
     · 前置取消检查（AR1-005）：getJob(jobId).status === 'cancelled' → 丢弃结果、不计费不写记录（§4.2 竞态行）
     · userId 非空：billingService.settleSuccessfulSolution({ userId, contentHash: result.data.contentHash,
        jobId, inputType, platform?, problemId?, sampleFp: result.data.sampleFp, cached, validated })
        （contentHash/sampleFp 均由 orchestrator 返回前统一填充，AD-08，AR1-002/016）
        └ 单事务：INSERT user_solution_access ON CONFLICT DO NOTHING
           ├ 未插入（已获取过）→ 写 solveRecords(billed=false) → SELECT 余额 → COMMIT
           │   → { charged: false, balanceRemaining }
            └ 插入成功（首次）→ 单条 CASE WHEN 条件 UPDATE 免费优先（§4.3，AR1-017）
               ├ 更新 0 行 → 额度不足 → ROLLBACK（含 access 插入）→ 抛 InsufficientBalance
               ├ 成功 → SELECT 新余额 → INSERT billing_records(consume, balanceAfter)
               │        → INSERT solve_records(billed=true) → COMMIT → { charged: true, balanceRemaining }
     · userId 为 null（fail-open 建档放行）→ 不调 DB → { charged: false, balanceRemaining: null }
     → completeJob(jobId, result.data, { charged, balanceRemaining })
  c. result 失败 → failJob(result.error)（现状不变，不写 DB）
  d. 计费失败 → 额度不足：failJob(GESP6_BILLING_INSUFFICIENT_BALANCE)，不写 solveRecords
                DB 故障：fail-closed → failJob(GESP6_DB_UNAVAILABLE / GESP6_BILLING_DB_UNAVAILABLE)
                         fail-open  → completeJob(jobId, result.data, { charged:false, balanceRemaining:null }) + WARN
客户端 → GET /api/solve?jobId → done 响应：
  { success:true, data:{ status:'done', result, charged, balanceRemaining, thinkingContent, organizingContent } }
  （charged/balanceRemaining 与 result 平级，FR-022；GET 维持无鉴权）
客户端 → use-job-polling done 分支 → sessionStorage 写 charged/balanceRemaining（新 key BILLING_INFO_STORAGE_KEY）→ /result 展示
```

### 4.2 异常流

| 异常 | 检测点 | 处理 | 错误码 |
|------|--------|------|--------|
| `DATABASE_URL` 未配置 / 连接失败 / 连接超时 / 语句超时（建档路径） | POST 步骤 2 | fail-closed：拒绝，不创建 job、不触发 LLM（AC-001）；fail-open：放行 `userId=null` | `GESP6_DB_UNAVAILABLE`（503） |
| 建档连接正常但非约束冲突异常 | POST 步骤 2 | 拒绝 | `GESP6_USER_CREATE_FAILED`（500） |
| 并发首次建档同 sub | POST 步骤 2 | `ON CONFLICT DO NOTHING` 幂等，仅 1 条（AC-005） | 无（成功） |
| 额度不足（首次获取但余额 0） | 后台 b 事务 | 回滚，任务 error 结束，不返回解法、不写 solveRecords（AC-016/017） | `GESP6_BILLING_INSUFFICIENT_BALANCE`（402 仅语义建议，POST 不实际返回；GET error envelope 200，AR1-007） |
| 计费/记录依赖 DB 不可用 | 后台 b 事务 | fail-closed：任务 error；fail-open：放行不计费不写任何 DB 记录（AC-026） | `GESP6_BILLING_DB_UNAVAILABLE` / `GESP6_DB_UNAVAILABLE`（503） |
| 扣费事务失败（非额度不足、非连接类） | 后台 b 事务 | 任务 error | `GESP6_BILLING_DEDUCT_FAILED`（500） |
| 缓存读失败（solutions/primary/sample DAO 异常） | DbHtmlCache 读 | 视为 miss 降级走 LLM（**不算 DB 故障**，不触发 fail-closed/fail-open 判定，AC-010a） | 无（内部降级） |
| 缓存写失败 | DbHtmlCache.set | 仅记日志不阻断主流程（NFR-007） | 无 |
| 任务失败/取消/未返回解法 | 后台 | 不写 solveRecords、不计费（FR-015/FR-021、AC-007） | 现状错误码 |
| 完成回调时 job 已取消（结果已成功返回） | 后台 b 前置 | 进入 settle 前检查 `getJob(jobId).status === 'cancelled'`，已取消则丢弃结果、不计费不写 solveRecords（AR1-005） | 无（丢弃） |
| 并发同 (user, contentHash) 完成回调 | 后台 b 事务 | 唯一约束冲突方判定「已获取」免费返回，仅计费 1 次（AC-015） | 无（成功） |

**settle 与取消的并发窗口语义**（AR1-005）：取消检查与取消处理同在 route 层（job-store 为内存 Map，同步读写），同一事件循环 tick 内无交错；窗口仅存在于「检查通过后、settle 事务执行期间」到达的取消——该取消不撤销已产生的计费（计费以完成回调时点为准，FR-021），取消语义以 settle 检查时点为准。

### 4.3 扣费 SQL 语义（FR-018 定稿，db-modeler 按此实现）

单位口径（AR1-011）：`amount`/`balance_after` 均以「次数」为单位的 integer（价格默认 1），`balance_after` = 扣费后 `free_balance + recharge_balance` 之和（与 §9 R-11 一致）。

```
BEGIN; -- READ COMMITTED（默认）
INSERT INTO user_solution_access (user_id, content_hash) VALUES ($1,$2)
  ON CONFLICT (user_id, content_hash) DO NOTHING RETURNING user_id;  -- 0 行 → 已获取，免费
-- 单条 CASE WHEN 原子判定「免费优先」（AR1-017）：同一行快照内求值，无两连发 UPDATE 竞态窗口
UPDATE quota_accounts SET
  free_balance = CASE WHEN free_balance >= $price THEN free_balance - $price ELSE free_balance END,
  recharge_balance = CASE
    WHEN free_balance >= $price THEN recharge_balance            -- 免费额度已覆盖本次扣减，充值不动
    WHEN recharge_balance >= $price THEN recharge_balance - $price
    ELSE recharge_balance END
  WHERE user_id=$1 AND (free_balance >= $price OR recharge_balance >= $price);  -- 0 行 → 额度不足 → ROLLBACK（access 插入一并回滚）
SELECT free_balance, recharge_balance FROM quota_accounts WHERE user_id=$1;  -- balanceAfter = 两列之和（次数口径）
INSERT INTO billing_records (user_id, content_hash, type, amount, balance_after, ...) VALUES (..., 'consume', $price, $balanceAfter);
INSERT INTO solve_records (...);                                       -- billed=true/false 按判定
COMMIT;
```

**并发防超扣机制**（NFR-006，三层）：① `(user_id, content_hash)` 唯一约束——并发同键插入仅一个成功（PostgreSQL 语句级唯一检测，后执行者阻塞后报冲突）；② 单条 CASE WHEN 条件 UPDATE（`WHERE col >= price` 或等价判定）——余额永不为负，且免费优先判定在同一行快照内原子完成，消除「① 0 行后 ② 执行前余额被并发修改」的窗口（该窗口即使存在也不破坏不变量，现由单条 SQL 直接消除）；③ 同一 `quota_accounts` 行的行锁——并发扣减串行化。隔离级别 READ COMMITTED 足够（无脏读/幻读需求，唯一约束与条件更新已保证不变量）。`balanceAfter` 在事务内 SELECT（已持行锁，读一致）。

## 5. 接口定义

### 5.1 服务层约定

遵循 api-conventions.md：方法返回 `ServiceResult<T>`、不抛未捕获异常（`InsufficientBalanceError` 等业务异常在事务内捕获并转 ServiceResult）、统一单例导出、`@/` 绝对路径、禁 any。

```typescript
// @/app/lib/db/config.ts（D7）— 惰性校验 + 模块级缓存；DATABASE_URL 缺失仅本函数抛错
export function getDbConfig(): DbConfig;   // { url, poolMin, poolMax, statementTimeoutMs, connectTimeoutMs }

// @/app/lib/db/connection.ts（D1）— 单例池，惰性建立（首次 query 才连接）
export function getPool(): Pool;           // 多实例各自独立池；进程内唯一

// @/app/lib/db/daos/user-dao.ts（D1）
export const userDao = {
  getOrCreateUser(sub: string, freeQuotaInitial: number): Promise<ServiceResult<{ userId: string }>>;
  // 事务：INSERT users ON CONFLICT DO NOTHING → INSERT quota_accounts ON CONFLICT DO NOTHING → SELECT id
};

// @/app/lib/db/daos/quota-dao.ts（D1）— 账户域，建议并入 user-dao（文件粒度按 AR1-010 由 db-modeler 定稿）；仅事务内调用（tx 注入）
export const quotaDao = {
  deductFreeFirst(userId: string, price: number, tx: DbTx): Promise<'free' | 'recharge' | 'insufficient'>;  // 单条 CASE WHEN 语义（§4.3）
  getBalance(userId: string, tx: DbTx): Promise<{ freeBalance: number; rechargeBalance: number }>;
  addRecharge(userId: string, amount: number, tx: DbTx): Promise<void>;
};

// @/app/lib/db/daos/solution-dao.ts（D1）— DbHtmlCache 数据源
// 读路径返回原始 Solution：contentHash 由 solutions 表主键天然携带；sampleFp 不在 DB 层填充，
// 由 orchestrator 返回前统一填充（AD-08，AR1-002）
export const solutionDao = {
  getByContentHash(contentHash: string): Promise<ServiceResult<Solution | null>>;    // data.contentHash = 表主键值
  getPrimaryContentHash(platform: string, problemId: string): Promise<ServiceResult<{ contentHash: string } | null>>;
  getBySampleFingerprint(sampleFp: string): Promise<ServiceResult<{ contentHash: string } | null>>;
  // —— 运行期 upsert（DO UPDATE，DbHtmlCache.set 用，AR1-001）——
  upsertSolution(contentHash: string, solution: Solution): Promise<void>;            // ON CONFLICT DO UPDATE(validated/warning)
  upsertPrimaryIndex(platform: string, problemId: string, contentHash: string): Promise<void>; // DO UPDATE 指向最新
  upsertSampleIndex(sampleFp: string, contentHash: string): Promise<void>;           // DO UPDATE 指向最新
  // —— 导入期 insert-if-absent（DO NOTHING，导入脚本用，AR1-001）——
  insertIfAbsentSolution(contentHash: string, solution: Solution): Promise<boolean>; // 返回是否新插入（false=已存在跳过）
  insertIfAbsentPrimaryIndex(platform: string, problemId: string, contentHash: string): Promise<boolean>;
  insertIfAbsentSampleIndex(sampleFp: string, contentHash: string): Promise<boolean>;
};

// @/app/lib/db/daos/access-dao.ts + billing-dao.ts（D1）— 事务内插入（billing-dao 承担 billing_records 与
// solve_records 写入），见 §4.3；最终文件粒度按 AR1-010 由 db-modeler 定稿（建议 4 个 DAO，禁 6 个细粒度）

// @/app/lib/billing/billing-service.ts（D2，单例）
export class BillingService {
  settleSuccessfulSolution(p: {
    userId: string; contentHash: string; jobId: string; inputType: 'text'|'image'|'platform';
    platform?: string; problemId?: string; sampleFp?: string; cached: boolean; validated: boolean;
  }): Promise<ServiceResult<{ charged: boolean; balanceRemaining: number | null }>>;
  // 单事务（§4.1 b）；计费判定仅依据 userSolutionAccess 唯一约束（FR-015/FR-017），cached/validated 仅透传
  // 写入 solve_records、不影响计费与否（AR1-020）；solve_records 唯一写入点为本方法（AR1-021，route 回调不单独写）
  // 额度不足 → GESP6_BILLING_INSUFFICIENT_BALANCE；DB 故障 → 连接类 GESP6_DB_UNAVAILABLE /
  // 计费域 GESP6_BILLING_DB_UNAVAILABLE / 其他 GESP6_BILLING_DEDUCT_FAILED
  rechargeBalance(p: { userId: string; amount: number; operator: string; remark?: string }): Promise<ServiceResult<{ balanceRemaining: number }>>;
  // 人工充值（FR-020）：UPDATE recharge_balance += amount + INSERT billing_records(type=recharge)，单事务；本期无管理页，预留入口
}
export const billingService = new BillingService();
```

### 5.2 既有接口扩展

```typescript
// @/app/lib/ai/types.ts（D4）
export type Solution = {
  html: string; validated: boolean; warning?: string; cached: boolean;
  contentHash: string;   // 必填（FR-029，Orchestrator 返回前填充，AD-08）
  sampleFp?: string;     // 可选（多解法 spec 引入，落地后按需必填）
};
// 新增 BILLING_INFO_STORAGE_KEY（sessionStorage 键，供 /solve → /result 传递 charged/balanceRemaining）

// @/app/lib/job-store.ts（D4）
export interface JobRecord { /* 现状字段 */ charged: boolean; balanceRemaining: number | null; }
export function completeJob(id: string, result: Solution,
  billing: { charged: boolean; balanceRemaining: number | null }): void;  // FR-022
// GET done 响应顶层透出 charged/balanceRemaining（route.ts）

// @/app/lib/ai/services/orchestrator.ts（D4）
// solvePlatform / solveTextOrImage 两分支在最终 return 前：result.success && result.data 时
// 统一填充 result.data.contentHash 与 result.data.sampleFp（AD-08，含主 key 命中提前 return 路径）：
// - compute/Plan B/降级路径：contentHash = 本次请求 computeContentHash(normalizedContent) 值；
//   sampleFp = extractSampleFingerprint(rawContent) 值（两值现状均已持有，直接透传）
// - 主 key 命中路径：contentHash = 缓存携带值（DbHtmlCache 按 solutions 表主键返回，与缓存内容一致，
//   无需重算）；sampleFp 无指纹上下文保持 undefined（solve_records.sample_fp 为 NULL）
```

### 5.3 错误码全集（FR-033，`MODULE_CATEGORY_SPECIFIC`）

| 错误码 | 场景 | HTTP |
|--------|------|------|
| `GESP6_BILLING_INSUFFICIENT_BALANCE` | 额度不足，拒绝解题（提示「余额不足，请联系管理员充值」） | 402（仅错误码语义建议，POST 不实际返回 402——计费在后台回调；GET 轮询 error envelope 维持 200，AR1-007） |
| `GESP6_BILLING_DB_UNAVAILABLE` | 计费事务 DB 不可用（fail-closed） | 503 |
| `GESP6_BILLING_DEDUCT_FAILED` | 扣费事务失败（非额度不足、非连接类） | 500 |
| `GESP6_DB_UNAVAILABLE` | 通用 DB 连接失败/超时（含建档路径、DATABASE_URL 未配置） | 503 |
| `GESP6_USER_CREATE_FAILED` | 建档失败（连接正常但非约束冲突） | 500 |
| `GESP6_MIGRATION_VALIDATION_FAILED` | 导入校验失败（脚本，非零退出码） | — |

**透出规则**：服务层返回 `ServiceResult<T>` 携带上述 code。**POST /api/solve**：建档失败直接响应对应 HTTP 状态码（503/500）；额度不足不会在 POST 阶段出现（计费在后台完成回调，POST 时 contentHash 未知，FR-027 不做余额预检），402 仅为错误码语义建议、不用于 POST 实际响应；其余校验失败维持现状（`AUTH_*`/`GESP6_INPUT_INVALID` 等）。**GET 轮询**：一律 200 + envelope 透出 `{ success:false, error:{ code, message } }`（后台完成回调失败经 `failJob` 写入 JobRecord；前端 onError 展示 message，不破坏现有轮询契约，AR1-007）。

## 6. 目录结构

遵循 dev 规则（`@/` 绝对路径、kebab-case、单文件 ≤500 行）：

```
app/lib/
├── db/                                   # D1（新增）
│   ├── config.ts                         # getDbConfig()：惰性校验 + 模块级缓存（D7 落点，不并入 env.ts）
│   ├── connection.ts                     # getPool()：单例 Pool（min/max/statement_timeout/connectTimeout）
│   ├── schema.ts                         # Drizzle schema：7 张表 + 索引 + 约束（§7.3，db-modeler 定稿）
│   ├── errors.ts                         # DB 错误分类：isDbUnavailable(err) → GESP6_DB_UNAVAILABLE 家族
│   ├── migrate.ts                        # 程序化 migrate（drizzle-orm/node-postgres/migrator），供部署调用
│   ├── migrations/                       # drizzle-kit 输出：{timestamp}_xxx/{migration.sql, snapshot.json, down.sql}
│   ├── daos/                             # user/solution/access/billing 四 DAO（§5.1；粒度建议 AR1-010）
│   │   └── __tests__/                    # 单测（全 mock，无 DB）
│   └── __tests__/                        # config/connection/errors 单测
├── billing/                              # D2（新增）
│   ├── billing-service.ts                # settleSuccessfulSolution / rechargeBalance（单例）
│   └── __tests__/                        # 单测（DAO mock；并发语义用 mock 断言唯一约束路径）
├── ai/
│   ├── types.ts                          # 修改：Solution + contentHash/sampleFp、BILLING_INFO_STORAGE_KEY
│   └── services/
│       ├── db-html-cache.ts              # 新增：DbHtmlCache 实现 HtmlCache（D3）
│       ├── html-cache.ts                 # 修改：单例 driver 分支加 'db'
│       └── orchestrator.ts               # 修改：返回前统一填充 contentHash/sampleFp（AD-08，AR1-002）
├── job-store.ts                          # 修改：JobRecord + completeJob 签名（FR-022）
app/api/solve/route.ts                    # 修改：建档（§4.1 步骤2）+ 完成回调 settle（§4.1 b）+ 失败处理
app/solve/hooks/use-job-polling.ts        # 修改：done 分支写 BILLING_INFO_STORAGE_KEY（D5，spec §9 补充落点）
app/result/page.tsx                       # 修改：charged/balanceRemaining 展示 + 额度不足提示（D5）
scripts/migrate-fs-cache-to-db.ts         # 新增：一次性导入脚本（D6）
drizzle.config.ts                         # 新增：schema/out/dialect/dbCredentials.url（运行时读 env，禁硬编码）
package.json                              # 修改：§3.2 依赖与 scripts
.env.local.example                        # 修改：登记 §7.2 全部新变量
tests/integration-tests/db-billing.test.ts # 新增：计费与降级链路集成测试（AC-010/011~019/025/026 服务与链路层；与现有 orchestrator.test.ts 扁平风格一致；服务层用例用 DAO 测试替身 mock 注入，AC-015 并发唯一性等真实 DB 行为走真实库，禁止全 mock 掩盖唯一约束验证）
tests/e2e-tests/specs/billing.spec.ts       # 新增：计费 E2E（@llm 分级；与现有 12 个 spec 命名风格一致，AR1-003）；@no-llm 用例走缓存命中路径覆盖 AC-011 缓存命中/AC-012 免费返回，仅缓存未命中场景归 @llm；登录与余额隔离策略见实施进度「T8 待启动定义」
```

**目录约定说明**：① DB 模块整体置于 `app/lib/db/`，**禁止**被 middleware（Edge）、客户端组件引用（AC-028，评审卡点）；② `db/config.ts` 独立于 `env.ts`（AD-07），避免 `validateEnv()` 全量校验引入 DATABASE_URL 必填（破坏 NFR-008 启动不依赖 DB）；③ DAO 建议合并为 4 个文件（AR1-010：user/solution/access/billing，粒度由 db-modeler 定稿权衡，**禁止** 6 个细粒度拆分）；④ `down.sql` 与 drizzle 生成的 `migration.sql` 同目录同前缀共存（{timestamp}_xxx/），**不**纳入 drizzle migrate 自动执行（人工回滚用，FR-004b/AR1-012）。

## 7. 依赖关系

### 7.1 运行时依赖（新增 2 项）+ dev 依赖（新增 3 项）

| 包 | 版本约束 | 用途 |
|----|----------|------|
| `drizzle-orm` | `^0.3x`（实施前 `npm view drizzle-orm versions` 精确锁定，AR1-014） | schema/查询/事务/程序化 migrate（node-postgres migrator） |
| `pg` | `^8`（实施前 `npm view pg versions` 精确锁定，AR1-014） | 连接池（Pool：max/min/connectionTimeoutMillis/statement_timeout/idleTimeoutMillis） |
| `drizzle-kit` | `^0.2x`（devDep） | `generate`（up + snapshot）/ `migrate`（版本追踪） |
| `tsx` | `^4`（devDep） | 运行导入脚本与 drizzle.config.ts |
| `@types/pg` | `^8`（devDep） | pg 类型 |

### 7.2 环境变量清单（.env.local.example 登记）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | 无（必填，仅 `.env.local`/部署 secret） | `postgres://user:password@host:port/dbname`，禁硬编码/禁打印（NFR-005）；项目现状 env 文件为 `.env.local`（`.env` 不存在），导入/迁移脚本经 `process.loadEnvFile('.env.local')` 读取（AR1-004） |
| `GESP6_DB_POOL_MIN` | `2` | 池最小连接（FR-002） |
| `GESP6_DB_POOL_MAX` | `10` | 池最大连接（NFR-002） |
| `GESP6_DB_STATEMENT_TIMEOUT_MS` | `5000` | 语句超时（服务端 statement_timeout，FR-002） |
| `GESP6_DB_CONNECT_TIMEOUT_MS` | `5000` | 连接超时（connectionTimeoutMillis，FR-002） |
| `GESP6_FREE_QUOTA_INITIAL` | `5` | 新用户赠送免费额度（FR-016；架构定默认值，可配置） |
| `GESP6_SOLUTION_PRICE` | `1` | 单次计费消耗额度（FR-016） |
| `GESP6_BILLING_DEGRADE_OPEN` | `0` | `1` 显式开启 fail-open（NFR-007，应急开关） |
| `GESP6_CACHE_DRIVER` | `memory` | 现状 `.env.local` 已设 `fs`（未登记于 `.env.local.example`）；本期登记新增 `db` 值（FR-014，AR1-015） |

**校验规则（AD-07）**：`DATABASE_URL` 等 DB 变量由 `getDbConfig()` 惰性校验（首次 DB 访问触发），缺失仅 DB 相关请求报 `GESP6_DB_UNAVAILABLE`（AC-001）；启动不预连（FR-003）；**middleware（Edge）禁引用**（FR-031）；无 `NEXT_PUBLIC_` 前缀变量。

### 7.3 Schema 草案（7 表，db-modeler 定稿 DDL/类型/索引）

| 表 | 关键列与约束 |
|----|-------------|
| `users` | `id uuid PK default gen_random_uuid()`、`sso_sub text UNIQUE NOT NULL`、`created_at timestamptz` |
| `quota_accounts` | `user_id uuid PK FK→users`、`free_balance int NOT NULL DEFAULT 0`、`recharge_balance int NOT NULL DEFAULT 0`、`updated_at`（双列建模，FR-016；integer 次数单位，价格默认 1） |
| `solutions` | `content_hash text PK`、`html text NOT NULL`、`validated boolean NOT NULL`、`warning text`、`created_at` |
| `primary_indexes` | `platform text`、`problem_id text`、`content_hash text NOT NULL FK→solutions`、`created_at`；`PK(platform, problem_id)` |
| `sample_indexes` | `sample_fp text PK`、`content_hash text NOT NULL FK→solutions`、`created_at` |
| `user_solution_access` | `user_id uuid FK`、`content_hash text FK`、`first_accessed_at timestamptz`；`PK(user_id, content_hash)`（计费权威唯一约束） |
| `billing_records` | `id bigserial PK`、`user_id uuid FK`、`content_hash text NULL`（recharge 无）、`type text CHECK IN ('consume','recharge')`、`amount int NOT NULL`（正数）、`balance_after int NOT NULL`、`operator text NULL`、`remark text`、`created_at`；`IDX(user_id, created_at)`；**CHECK 约束需求**（AR1-008，DDL 由 db-modeler 定稿）：`(type='consume' AND content_hash IS NOT NULL) OR (type='recharge' AND content_hash IS NULL)`；`amount`/`balance_after` 次数口径（AR1-011） |
| `solve_records` | `id bigserial PK`、`user_id uuid FK`、`job_id text NOT NULL`（仅溯源，job-store 不入库）、`input_type text CHECK IN ('text','image','platform')`、`platform/problem_id/sample_fp`、`content_hash text NOT NULL FK`、`cached/validated/billed boolean NOT NULL`、`created_at`；`IDX(user_id, created_at)`、`IDX(content_hash)` |

**关联键预留（NFR-009）**：`userId`、`contentHash`、`sampleFp` 为跨实体标准关联字段，多解法/套餐/管理后台直接复用。

## 8. 非功能设计

### 8.1 性能（NFR-001~003）

contentHash 等值查询走 PK（solutions/primary/sample 均主键或复合主键命中，µs~ms 级），连接池复用免建连开销，命中路径 ≤50ms 目标可达成；DbHtmlCache 内部叠加**独立小 LRU 前置层**（max=100、ttl=1h，配置与现有 DualKeyHtmlCache 一致，AR1-009）承接高频热题重复查询，`set` 时双写（LRU+DB），数据库仍为权威源（LRU 仅性能层，缓存陈旧语义与现有实现一致）；单飞粒度按 contentHash（in-flight Promise Map，与现有实现一致——DB 查询幂等，但单飞可避免并发重复查/写竞争，AR1-019）；池默认 max=10（NFR-002）；导入**分批提交**（每批 500–1000 行一个事务，单批失败记入失败清单后继续下一批，AR1-013，NFR-003 分钟级完成）；任务为异步轮询，缓存命中延迟不阻塞用户响应。

### 8.2 安全（NFR-004~006、FR-031/032）

① 全部查询经 Drizzle 参数绑定，**禁止字符串拼接 SQL**（含 sub/platform/problemId/contentHash/sampleFp，AC-029 注入单测）；② `DATABASE_URL` 不打印日志、错误日志仅 code+分类不落连接串（NFR-005，`errors.ts` 分类时不携带 URL）；③ Edge/客户端禁引用 DB 模块与 env（AC-028 评审卡点，middleware 现状不 import db 任何文件）；④ 额度扣减原子性由 DB 层保证（唯一约束+条件 UPDATE+事务，NFR-006），应用层校验为第二道（settle 前置 `userId` 非空校验）；⑤ `.env.local` 不进版本库（gitignore 已排除）、新变量登记 `.env.local.example`（AC-030）；⑥ 迁移执行按最小权限账号（仅应用库权限，FR-004a）。

### 8.3 可用性（NFR-007/008）

**故障隔离语义**：缓存读失败（solutions/primary/sample DAO 异常）→ 视为 miss 降级 LLM（不算 DB 故障，AC-010a）；计费/建档/记录依赖的 DB 不可用 → 默认 **fail-closed**（`GESP6_DB_UNAVAILABLE` / `GESP6_BILLING_DB_UNAVAILABLE`），`GESP6_BILLING_DEGRADE_OPEN=1` 显式开启 fail-open（放行不计费、不写任何 DB 记录、WARN 日志、`charged=false`/`balanceRemaining=null`，AC-026）；DB 故障不影响 SSO 认证/静态页/登录（认证不依赖 DB，NFR-008）。

### 8.4 可观测性

logger 打点覆盖：建档（sub→userId）、settle 各判定分支（已获取/首次/额度不足）、balanceAfter、fail-open 放行（WARN）、缓存读 miss 原因、导入扫描/导入/跳过/失败计数；审计沿用现有 audit-logger（spec §5「不做 DB 级审计表」）。

## 9. 风险与对策

| # | 风险 | 等级 | 对策 |
|---|------|------|------|
| R-01 | 数据库单点 → 解题主流程不可用 | 高（接受） | fail-closed 默认 + `GESP6_BILLING_DEGRADE_OPEN` 应急开关；HA 列后续（spec §7 一致） |
| R-02 | 导入与线上并发写 fs → 漏导 | 中 | 维护窗口执行 + 脚本幂等可重跑补导（FR-024） |
| R-03 | 多实例 `GESP6_CACHE_DRIVER=db` 切换不同步 | 中 | driver 切换作为统一部署步骤（先 `db:migrate` → `db:import` → 全部实例同步切 db） |
| R-04 | fail-open 期间不写记录 → 恢复后同 contentHash 重复计费 | 中（接受） | 应急开关语义 + WARN 日志；恢复后不补录（spec §5.2 一致） |
| R-05 | 并发扣费竞态（超扣/重复扣费） | 高 | 唯一约束 + 条件 UPDATE + 行锁（§4.3，AC-015 并发验证） |
| R-06 | 计费口径误解（缓存命中不收费） | 中 | FR-015 规则表 + AC-011 双路径验证 + settle 以 userSolutionAccess 为唯一权威 |
| R-07 | Drizzle/pg 版本兼容或依赖审计拒绝 | 低 | 实施步骤 1 `npm view` 验证 + 锁定主版本；备选 node-pg-migrate（仅迁移层替换，DAO 不变） |
| R-08 | 事务跨服务边界扩散（route 直拼事务） | 中 | 事务封装在 billingService 单一服务内（§4.1 b），DAO 仅收 `tx` 注入，route 不感知事务 |
| R-09 | 导入脚本 env 加载失败（DATABASE_URL 缺失） | 低 | `process.loadEnvFile('.env.local')`（与项目现状一致，AR1-004）+ 缺失报错退出（非零） |
| R-10 | GET 轮询跨实例 job 404 | 中（现状） | sticky session + 用户重试；根治列后续（spec §5.2 一致，本期不改） |
| R-11 | `balanceAfter` 双列口径误解 | 低 | 明确 `balance_after` = 扣费后 free+recharge 之和（§4.3）；单测断言 |
| R-12 | 金额单位（integer）未来需小数 | 低 | 次数模型（价格默认 1）；未来变更走新迁移（down.sql 回滚） |

## 10. FR→架构落点映射

| FR | 落点 |
|----|------|
| FR-001 | §3.1（drizzle-orm+pg）、§7.2（DATABASE_URL） |
| FR-002 | §3.1（pg Pool）、§5.1 connection/getDbConfig、§7.2（4 个池变量） |
| FR-003 | AD-02/AD-07（惰性 + 错误码）、§5.3、§8.3 |
| FR-004 | AD-03（drizzle-kit + down.sql + 分离）、§6 migrations/、§7.3、D6 导入脚本分离 |
| FR-005 | §7.3 users.sso_sub UNIQUE |
| FR-006 | AD-05（getOrCreateUser ON CONFLICT DO NOTHING）、§4.1 步骤2、§5.1 userDao |
| FR-007 | §1.3 边界（guard.ts 不改）、§4.1 步骤2（route 闭包建档）、AD-10（result 经轮询响应展示） |
| FR-008 | §7.3 solve_records、§4.1 b（settle 同事务写入） |
| FR-009 | AD-04（settle 单事务）、§4.1 b |
| FR-010 | §1.3 边界（job-store 不入库）、§7.3 job_id 仅溯源 |
| FR-011 | §7.3 solutions、§5.1 solutionDao.upsertSolution |
| FR-012 | §7.3 primary_indexes、§5.1 solutionDao |
| FR-013 | §7.3 sample_indexes、§5.1 solutionDao |
| FR-014 | AD-06（DbHtmlCache + db 分支）、§6 db-html-cache.ts |
| FR-015 | AD-04（userSolutionAccess 权威）、§4.3、§9 R-06 |
| FR-016 | §7.3 quota_accounts 双列、§7.2 免费额度/价格变量、§4.3 免费优先 |
| FR-017 | §7.3 user_solution_access PK(user_id, content_hash)、§4.3 |
| FR-018 | §4.3（唯一约束+条件 UPDATE+billingRecords）、AD-04 |
| FR-019 | §4.2、§5.3（GESP6_BILLING_INSUFFICIENT_BALANCE + 文案） |
| FR-020 | §5.1 rechargeBalance、§7.3 billing_records type=recharge |
| FR-021 | §4.1 b、§4.2（计费时点与失败语义） |
| FR-022 | AD-09（JobRecord/completeJob/GET 透出）、§4.1 轮询响应 |
| FR-023 | AD-12（db:import 脚本读 .env.local）、§6 scripts/、§8.1 分批提交 |
| FR-024 | AD-11（insertIfAbsent* DO NOTHING 幂等，§5.1）、§4.2 导入异常流 |
| FR-025 | D6 成对校验/分批提交/失败清单/非零退出码（AR1-013）、§5.3 GESP6_MIGRATION_VALIDATION_FAILED |
| FR-026 | AD-11/§1.3（FsHtmlCache 保留）、R-03（统一切换步骤） |
| FR-027 | §4.1 步骤2（建档+不做余额预检）、§1.3（GET 无鉴权现状）、§5.3 建档错误码 |
| FR-028 | §4.1 b（settle 顺序：计费→记录→completeJob）、§4.2 失败分支 |
| FR-029 | AD-08（contentHash/sampleFp 统一填充）、§5.2 orchestrator/types |
| FR-030 | AD-10（sessionStorage 传递 + result 展示）、§6 use-job-polling/result 页 |
| FR-031 | AD-07（db/config.ts 惰性校验）、§8.2（Edge 禁引用） |
| FR-032 | §8.2（参数化 + AC-029 注入单测） |
| FR-033 | §5.3（6 个错误码 + ServiceResult 透出） |
| NFR-001/002/003 | §8.1 |
| NFR-004/005/006 | §8.2 |
| NFR-007/008 | §8.3 |
| NFR-009/010 | §7.3 关联键 / §3.1 选型决策 |
| NFR-011/012 | §7.2 登记 / 实施步骤 12（changelog） |

## 11. 涉及文件清单（spec §9 全覆盖 + 架构补充）

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `package.json` | 修改 | §3.2 依赖 + db:migrate/db:generate/db:import scripts |
| `app/lib/db/` | 新增 | config/connection/schema/errors/migrate/migrations/daos（四 DAO，§6/§5.1，AR1-010） |
| `app/lib/billing/` | 新增 | billing-service.ts + __tests__ |
| `app/lib/ai/services/db-html-cache.ts` | 新增 | DbHtmlCache（AD-06） |
| `app/lib/ai/services/html-cache.ts` | 修改 | 单例 `db` 分支 |
| `app/lib/ai/types.ts` | 修改 | Solution.contentHash/sampleFp + BILLING_INFO_STORAGE_KEY |
| `app/lib/ai/services/orchestrator.ts` | 修改 | 返回前统一填充 contentHash/sampleFp（AD-08，AR1-002/016） |
| `app/lib/job-store.ts` | 修改 | JobRecord/completeJob 扩展（FR-022） |
| `app/api/solve/route.ts` | 修改 | 建档 + settle 回调 + 失败处理（§4.1） |
| `app/solve/hooks/use-job-polling.ts` | 修改 | **架构补充落点**：done 分支写计费信息至 sessionStorage（spec §9 仅列 result 页，数据传递必经此 hook） |
| `app/result/page.tsx` | 修改 | 计费反馈展示（FR-030） |
| `scripts/migrate-fs-cache-to-db.ts` | 新增 | 一次性导入脚本（D6） |
| `app/lib/env.ts` | 修改 | **经 AD-07 决策**：DB 变量不并入 validateEnv（惰性校验移至 db/config.ts），本文件无实质改动，留档说明 |
| `.env.local.example` | 修改 | 登记 §7.2 全部新变量 |
| `drizzle.config.ts` | 新增 | drizzle-kit 配置（url 运行时读 env） |
| `app/lib/db/__tests__/`、`app/lib/billing/__tests__/`、`tests/integration-tests/db-billing.test.ts`、`tests/e2e-tests/specs/billing.spec.ts` | 新增 | 测试落点（集成/E2E 覆盖 AC-010~019/025/026，覆盖边界与既有单测分工见实施进度「T8 待启动定义」；AC-010 用 DAO 测试替身 mock 注入，非真实 DB 故障注入；AC-015 并发唯一性须真实库；路径与现有 spec 风格一致，AR1-003） |
| `middleware.ts` / `app/lib/auth/guard.ts` | **不改** | Edge 禁 DB / guard 仅返回 SSO claims（FR-007/FR-031） |

## 12. 实施指导

**前置**：本架构为唯一实施依据；每步 TDD + type-check + lint；实施前 `npm view drizzle-orm/pg/drizzle-kit/tsx versions` 验证存在性（R-07）。

| 步骤 | 任务 | 模块 | 说明/验收 |
|------|------|------|-----------|
| 1 | 依赖 + D7 | D7 | 安装 §3.2 依赖；`db/config.ts`（惰性校验）；`.env.local.example` 登记 §7.2 |
| 2 | schema + 迁移 | D1 | `schema.ts` 7 表 + `drizzle.config.ts`；`drizzle-kit generate` 基于 schema.ts 生成首个迁移（空库无需 diff，产出 snapshot+up SQL，AR1-018）+ 手写同目录 `down.sql`（人工维护/人工回滚，不进 drizzle 版本表，AR1-012）；`drizzle-kit migrate` 建表（AC-003 重复执行验证） |
| 3 | 连接 + 错误分类 | D1 | `connection.ts`（单例池/惰性/超时）；`errors.ts`（isDbUnavailable）；单测 |
| 4 | DAO | D1 | 四 DAO（§5.1，粒度按 AR1-010 由 db-modeler 定稿）+ 单测（全 mock）；`userDao.getOrCreateUser` 并发幂等断言（AC-005 语义）；导入 `insertIfAbsent*`（DO NOTHING）与运行期 `upsert*`（DO UPDATE）冲突策略分离断言（AR1-001） |
| 5 | 计费服务 | D2 | `settleSuccessfulSolution`/`rechargeBalance` + 单测（DAO mock 断言唯一约束/额度不足/单条 CASE WHEN 免费优先判定分支，AR1-017） |
| 6 | 类型与编排 | D4 | Solution 扩展 + orchestrator 返回前统一填充 contentHash/sampleFp（AC-027，AR1-002）+ job-store 扩展 + 单测 |
| 7 | route 整合 | D4 | 建档 + settle 前置取消检查（AR1-005）+ settle 回调 + fail-closed/fail-open 分支（AC-001/AC-010b/AC-025/AC-026）+ 单测 |
| 8 | DbHtmlCache | D3 | `db-html-cache.ts` + `html-cache.ts` db 分支 + 单测（AC-008/009/010a） |
| 9 | 前端反馈 | D5 | `use-job-polling.ts` 写 sessionStorage + result 页展示（AC-025 前端、FR-030） |
| 10 | 导入脚本 | D6 | 读 `.env.local`（AD-12，AR1-004）；扫描统计/成对校验/分批提交（每批 500–1000 行一事务，单批失败记入失败清单继续下一批，AR1-013）/`insertIfAbsent*` DO NOTHING/汇总报告/非零退出码（AC-021/022/023/024） |
| 11 | 集成/E2E | 测试 | `tests/integration-tests/db-billing.test.ts`（单文件，DAO 替身；AC-015 并发唯一性走真实库）+ `tests/e2e-tests/specs/billing.spec.ts`（@no-llm 走缓存命中，@llm 仅缓存未命中；分层与登录/余额隔离见实施进度「T8 待启动定义」；与现有 spec 命名风格一致，AR1-003） |
| 12 | 部署与文档 | 全局 | `db:migrate` → `db:import` → 同步切 `GESP6_CACHE_DRIVER=db`（R-03）；按 changelog 规范记录（NFR-012） |

## 13. 架构边界声明（硬约束）

1. **job-store 不入库**：任务瞬时状态仍为内存 Map（FR-010/spec §8.1），`solve_records.job_id` 仅溯源。
2. **GET 轮询无鉴权维持现状**：`jobId` 为随机 UUID 防猜测，鉴权化列「后续」（FR-027）。
3. **guard.ts 不改动**：仅返回 SSO claims（含 sub），用户关联在 route 闭包经 `getOrCreateUser(sub)` 完成（FR-007）。
4. **middleware.ts 不接触 DB**：Edge Runtime 无 Node 驱动，禁 import db 模块与引用 DB env（FR-031/AC-028）。
5. **Orchestrator 依赖注入零改动**：仅依赖 `HtmlCache` 接口与 `GESP6_CACHE_DRIVER` 切换（spec §8.4）。
6. **fail-open 不写任何 DB 记录**：`billingRecords`/`userSolutionAccess`/`solveRecords` 均不写（NFR-007/AC-026）。
7. **导入不删除源数据**：`FsHtmlCache` 代码与 `data/gesp6/` 保留（FR-026/spec §8.5）。