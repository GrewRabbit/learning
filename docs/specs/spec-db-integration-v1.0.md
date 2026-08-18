# 数据库与业务系统整合 需求规格文档

**版本**：v1.2
**状态**：approved
**创建时间**：2026-08-18
**最后更新**：2026-08-18

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-08-18 | 初稿创建 | — |
| v1.1 | 2026-08-18 | 根据 r1 评审修订：计费口径与代码事实对齐（forceRegenerate/降级返回/余额建模）、验收条件可验证性、环境变量文件引用纠正 | review-r1 |
| v1.2 | 2026-08-18 | 根据 r2 评审修订：修正跨 spec 依赖声明、统一 fail-open 语义、明确测试注入方式等；文件名沿用 v1.0（遵循 spec-workflow「禁止新建版本文件」约束，版本号以文件内为准） | review-r2 |

---

## 1. 背景与目标

### 1.1 背景

当前系统（Next.js 15.1.6 App Router）无数据库、无 ORM、无 DB 驱动：

- 解题缓存为文件系统（`data/gesp6/` 的 primary/content/sample），多实例不共享；内存 LRU 为默认驱动（`GESP6_CACHE_DRIVER` 切换）。
- 无任何用户级计费、配额、次数限制；唯一防滥用是 [middleware.ts](file:///var/learning/middleware.ts) 的 IP 级内存限流（20 次/分/IP，注释明确多实例不共享）。
- SSO 认证不依赖数据库（middleware Edge 粗检 + [guard.ts](file:///var/learning/app/lib/auth/guard.ts) Node 验签），用户唯一标识为 SSO `sub`，目前仅用于日志关联。
- 数据库服务器已具备，本 spec 仅规划「新建库相关步骤」与业务系统整合方案，不涉及本机安装。

### 1.2 问题

1. 无法回答「谁在什么时间解了哪道题、用了哪种解法」——无用户维度数据。
2. 无计费与额度控制，AI 生成成本无法按用户分摊或限制。
3. 文件系统缓存与内存限流均不跨实例共享，无法支撑多实例部署形态。
4. 未来业务（多解法、套餐、管理后台）无数据底座。

### 1.3 目标

- 引入 PostgreSQL 作为业务数据权威源，落地四类数据：**用户**、**解题记录**、**解法内容缓存**、**计费与额度**。
- 建立按「用户 × 解法」的计费模型（首次获取计费、已获取免费、缓存命中未获取过仍计费），以数据库事务保证多实例下的原子性与一致性。
- 将现有文件缓存**一次性导入** PostgreSQL，导入后数据库成为缓存权威源，文件系统缓存停用（保留代码与数据以支持回退）。
- Schema 设计预留未来业务扩展（多解法、人工充值管理入口等）。

### 1.4 非目标（详见 §5）

- 不做在线支付、不做用户自助充值页面。
- 不做 Redis 限流改造（计费/额度以 DB 保证跨实例一致，IP 限流维持现状）。
- 不改变 SSO 认证机制（认证不依赖数据库）。

---

## 2. 用户故事

- **US-001**：作为学生，我希望首次获取某道题的一种解法时系统自动扣除 1 次额度，以便系统按我的使用量计费。
- **US-002**：作为学生，我希望再次查看已获取过的同一解法时免费返回、不重复扣费，以便反复学习不产生额外成本。
- **US-003**：作为学生，我希望同一道题的多种解法（不同算法思路）各自单独计费，以便我只为实际获取的新解法付费。
- **US-004**：作为学生，我希望额度用尽时系统明确提示「余额不足，请联系管理员充值」，以便我知道如何补充额度。
- **US-005**：作为管理员，我希望通过人工操作（直接改库或预留管理入口）为用户充值并留下充值记录，以便额度管理可追溯。
- **US-006**：作为运维，我希望上线时把现有 `data/gesp6/` 缓存一次性导入数据库，以便旧题不重复调用 LLM 生成、避免成本浪费。
- **US-007**：作为运维，我希望多实例部署下计费与额度以数据库为权威、跨实例一致，以便扩容不影响计费正确性。
- **US-008**：作为学生，我提交一个缓存已存在但我从未获取过的解法时，系统仍计费 1 次，以便计费口径以「用户是否获取过」为准而非以缓存是否命中为准。

---

## 3. 功能需求

### 3.0 实体关系总览

| 实体 | 关键字段（需求粒度） | 关系 |
|------|---------------------|------|
| `users`（用户） | `id`、`ssoSub`（唯一）、`createdAt` | 1:1 `quotaAccounts`；1:N `solveRecords` / `userSolutionAccess` / `billingRecords` |
| `quotaAccounts`（额度账户） | `userId`（唯一）、`freeBalance`（免费余额）、`rechargeBalance`（充值余额）、`updatedAt`（具体列结构/类型由 db-modeler 定稿，见 FR-016） | N:1 `users` |
| `solutions`（解法内容） | `contentHash`（唯一）、`html`、`validated`、`warning`、`createdAt` | 1:N `userSolutionAccess` / `solveRecords`；被 `primaryIndexes` / `sampleIndexes` 引用 |
| `primaryIndexes`（主 key 索引） | `platform`、`problemId`、`contentHash`、`createdAt`；唯一 `(platform, problemId)` | N:1 `solutions` |
| `sampleIndexes`（样例指纹索引） | `sampleFp`（唯一）、`contentHash`、`createdAt` | N:1 `solutions` |
| `userSolutionAccess`（用户已获取解法） | `userId`、`contentHash`、`firstAccessedAt`；唯一 `(userId, contentHash)` | N:1 `users` / `solutions` |
| `billingRecords`（计费/充值流水） | `id`、`userId`、`contentHash`、`type`（consume/recharge）、`amount`、`balanceAfter`、`operator`、`remark`、`createdAt` | N:1 `users` |
| `solveRecords`（解题记录） | `id`、`userId`、`jobId`、`inputType`、`platform`、`problemId`、`sampleFp`、`contentHash`、`cached`、`validated`、`billed`、`createdAt` | N:1 `users` |

**关联要点**：一道题（`sampleFp` 或 `platform+problemId`）可关联多个解法（多解法扩展），每个解法以 `contentHash` 唯一标识；「用户 × 解法」的获取关系由 `userSolutionAccess` 唯一约束承载，是计费判定（是否首次获取）的数据库级权威。

### 3.1 数据库连接与基础设施

- **FR-001**：引入 PostgreSQL 访问依赖（驱动或 ORM，具体选型由架构阶段按 NFR-010 决策），提供仅服务端可用的数据库连接模块；连接串通过环境变量 `DATABASE_URL` 提供（格式 `postgres://user:password@host:port/dbname`），禁止硬编码。
- **FR-002**：连接模块须使用连接池（池最小/最大连接数可通过 `GESP6_DB_POOL_MIN` / `GESP6_DB_POOL_MAX` 配置，提供默认值）；支持语句超时（`GESP6_DB_STATEMENT_TIMEOUT_MS`）与连接超时（`GESP6_DB_CONNECT_TIMEOUT_MS`）配置；多实例部署共享同一数据库实例，池为每实例独立维护。
- **FR-003**：数据库连接失败/超时不得导致进程崩溃：相关业务返回明确错误码（见 FR-033）并记录错误日志；连接采用惰性建立（首次使用触发），启动阶段不强制预连。
- **FR-004**：规划「新建库相关步骤」与 schema 版本管理：a) 在数据库服务器创建应用数据库与最小权限应用账号（仅该库权限）；b) 提供迁移机制（migrations 目录 + 版本追踪），迁移可重复执行、可回滚（down 迁移）、版本可查询；c) 迁移与数据导入脚本分离（先迁移建表，后导入数据）；d) 具体 DDL、字段类型、索引由 `nextjs-db-modeler` 在架构设计阶段产出，本 spec 不定义。

### 3.2 用户表与 SSO sub 关联

- **FR-005**：`users` 表以 SSO `sub` 为唯一业务标识（唯一约束），记录 `ssoSub` 与创建时间；登录本身不查询数据库（认证仍走现有 SSO 机制）。
- **FR-006**：首次鉴权成功后自动建档（`getOrCreateUser(sub)`）：用户不存在则插入，已存在则返回现有记录；多实例并发首次建档须幂等——依赖 `ssoSub` 唯一约束 + 冲突忽略（如 `ON CONFLICT DO NOTHING`），并发下仅产生一条记录。
- **FR-007**：鉴权守卫（`requireAuth` / `requireAuthPage`）返回值（含 `sub`）与内部用户记录关联：**`guard.ts` 不改动**（仅返回 SSO claims），关联逻辑在 route.ts 闭包内经 `getOrCreateUser(sub)` 完成（FR-006），取得内部 `users.id` 供计费、记录等业务使用；result 页（`requireAuthPage` 场景）**不直接关联用户记录**，其计费信息（是否计费、剩余额度）来自轮询响应（FR-022）经 sessionStorage 传递展示（FR-030）；鉴权本身失败语义不变（现有 `AUTH_*` 错误码）。

### 3.3 解题记录

- **FR-008**：`solveRecords` 表记录每次**成功**的解题行为，字段需求：用户 `id`、`jobId`（关联 job-store，仅作溯源）、输入类型（text/image/platform）、`platform`/`problemId`（platform 输入）、`sampleFp`、`contentHash`（本次实际获取的解法）、`cached`（是否缓存命中）、`validated`（是否通过编译验证）、`billed`（本次是否计费）、创建时间。
- **FR-009**：解题记录在任务成功完成时写入（route 层 `.then` 回调，与计费同一事务或紧邻写入）；任务失败/取消/被丢弃不写解题记录。
- **FR-010**：`job-store`（内存任务队列）**本期不入库**，维持现状（判断与理由见 §8.1；多实例下轮询跨实例的风险与缓解见 §5.2）。

### 3.4 解法内容缓存表

- **FR-011**：`solutions` 表对应现有 `content/` 文件：`contentHash` 唯一主键，存 `html` 全文与元数据（`validated`、`warning`、`createdAt`）；同一 `contentHash` 只存一份，供所有用户共享。
- **FR-012**：`primaryIndexes` 表对应现有 `primary/` 索引：`(platform, problemId)` 唯一，指向 `contentHash`（行为与现有 `PrimaryIndex` 一致：解析主 key 后精确查询）。
- **FR-013**：`sampleIndexes` 表对应现有 `sample/` 索引：`sampleFp` 唯一，指向 `contentHash`（行为与现有 `SampleIndex` 一致：多候选指纹 [all, first] 查询路径保留）。
- **FR-014**：新增 `DbHtmlCache` 实现现有 `HtmlCache` 接口（[html-cache.ts](file:///var/learning/app/lib/ai/services/html-cache.ts)），通过 `GESP6_CACHE_DRIVER=db` 切换（保留 `memory`/`fs` 分支）：a) 单飞机制（in-flight Promise Map）保留在 `DbHtmlCache` 内部；b) 读写语义与现有实现对齐——读失败（DB 异常/记录缺失）视为缓存未命中降级走 LLM，写失败仅记日志不阻断主流程；c) 导入完成后数据库为缓存权威源，Orchestrator 层不改动（仅依赖注入驱动切换）。

### 3.5 计费与额度

- **FR-015**：计费口径（核心规则，必须无歧义执行）：

  | 场景 | 是否计费 |
  |------|---------|
  | 用户**首次**获取某解法（`contentHash`，无论缓存是否命中） | 计费 1 次 |
  | 解法已存在（缓存命中）但**当前用户未获取过** | 计费 1 次 |
  | 用户**已获取过**该 `contentHash` | 免费返回，不重复计费 |
  | 同一道题多种解法（不同 `contentHash`） | **每种解法对该用户单独计费** |
  | `validated=false` 的降级返回（HTML 解析失败返回原始 HTML / g++ 编译不可用降级，均返回有内容的 `Solution`） | 视为成功获取到解法内容，按首次获取计费（与「缓存命中但未获取过仍计费」口径一致） |
  | `forceRegenerate`（当前单解法实现） | 仅跳过缓存读强制重新生成，**不产生新 `contentHash`**（`contentHash` 由 `computeContentHash(normalizedContent)` 计算）；同一 `contentHash` 重复生成**不重复计费** |
  | 多解法落地后（spec-multi-solution-v1.0）：同一题产生**不同 `contentHash`** 的新解法 | 用户对每个新 `contentHash` 的**首次获取**各自计费（即使旧解法已获取） |
  | 任务失败 / 取消 / 未返回解法 | 不计费 |

  > 依赖声明：多解法 spec（spec-multi-solution-v1.0）当前仅假设同一题可对应多个 `contentHash`（`contentHashes` 数组，元素含 `contentHash`/`createdAt`/`variant`），**未定义**不同 `contentHash` 的产生机制（当前 `computeContentHash(normalizedContent)` 对同一题必然产生相同 hash）；本 spec 计费规则依赖「多解法最终以不同 `contentHash` 存在」这一约定，该约定的实现（如 hash 输入追加 variant/算法摘要）需在多解法 spec 后续工作中明确，**本 spec 不定义该机制**。该约定落地前，当前单解法实现下 `forceRegenerate` 不改变 `contentHash`、重复生成不重复计费（对应 AC-020 的当前实现验证，见 §6.5 与 §7 风险表）。

- **FR-016**：额度账户（`quotaAccounts`）：每用户一个账户，由「免费额度 + 充值额度」构成；余额建模**明确为双列（`freeBalance` + `rechargeBalance`）或等价来源标记**（单列无法区分来源、无法实现免费优先），具体列结构/类型由 db-modeler 在架构阶段定稿；新用户建档时赠送固定免费次数（`GESP6_FREE_QUOTA_INITIAL` 环境变量配置，提供默认值）；扣减顺序**固定免费额度优先**（充值额度保留）；每次计费消耗额度数由 `GESP6_SOLUTION_PRICE` 配置（默认 1）。
- **FR-017**：`userSolutionAccess` 表以 `(userId, contentHash)` 唯一约束记录「用户已获取解法」；计费判定以该表为唯一权威（存在记录 → 免费；不存在 → 首次获取，计费）。
- **FR-018**：扣费必须原子、防超扣/重复扣费，多实例并发安全，由数据库保证（单个事务内完成）：a) 尝试插入 `userSolutionAccess(userId, contentHash)`（唯一约束冲突 → 已获取过，免费返回，不扣费）；b) 插入成功（首次）→ 条件更新额度余额，**免费额度优先扣减**（`UPDATE ... SET <免费余额列> = <免费余额列> - price WHERE userId = ? AND (<免费余额列> >= price)`，免费余额不足时再尝试扣充值余额；具体列名与单条 UPDATE 实现方式由 db-modeler 按 FR-016 双列建模定稿；影响行数为 0 → 额度不足，回滚拒绝）；c) 写入 `billingRecords`（type=consume，记录 `amount`、扣费后余额）与本次解题的 `billed=true`。
- **FR-019**：额度不足时拒绝本次解题：任务以错误结束，返回错误码 `GESP6_BILLING_INSUFFICIENT_BALANCE`，提示文案明确「余额不足，请联系管理员充值」；拒绝须发生在返回解法之前（不产生解题结果）。
- **FR-020**：人工充值：`billingRecords` 支持 type=recharge 记录（`amount` 为正数、`operator` 操作人标识、`remark` 备注、时间）；充值流程为人工操作——可直接操作数据库，或预留管理入口（本 spec 不强制实现管理页面）；充值须原子更新额度余额与流水。
- **FR-021**：计费时点与失败语义：计费在任务**成功完成**时执行（route 层 `.then` 回调，见 FR-028）；任务失败/取消不计费；计费事务失败——额度不足 → 任务以 `GESP6_BILLING_INSUFFICIENT_BALANCE` 结束、不返回解法；DB 故障 → 按 NFR-007 降级（fail-closed 拒绝并以 `GESP6_DB_UNAVAILABLE` / `GESP6_BILLING_DB_UNAVAILABLE` 结束、不返回解法；fail-open 放行、不计费、不写 DB 记录）。
- **FR-022**：计费信息随结果回传前端：轮询 done 响应在 `data` 顶层新增两个字段（与 `result` 平级）——`charged: boolean`（本次是否计费）与 `balanceRemaining: number | null`（计费后剩余额度；fail-open 放行期间 DB 不可用无法读取余额，返回 `null`）；前端据此展示（见 FR-030）。响应结构草案：`{ success: true, data: { status: 'done', result: Solution, charged: boolean, balanceRemaining: number | null, thinkingContent, organizingContent } }`（`JobRecord` 扩展见 §9）。

### 3.6 一次性数据导入

- **FR-023**：提供独立导入脚本（如 `npm run db:import`），将 `data/gesp6/` 现有缓存一次性导入数据库：`content/{hash前2位}/{hash}.html` + `.json` → `solutions`；`primary/{platform}_{problemId}.json` → `primaryIndexes`；`sample/{fp前2位}/{fp}.json` → `sampleIndexes`。
- **FR-024**：导入须幂等、可重复执行：重复导入不产生重复数据（冲突策略如 `ON CONFLICT DO NOTHING` 或先清空后导入，由架构师决策）；已存在数据以文件内容为准覆盖或跳过，保证脚本可修复后重跑。
- **FR-025**：导入须校验并输出报告：a) html 与 meta 文件成对校验（缺失/损坏计入失败清单）；b) 统计各表导入/跳过/失败数量；c) 存在损坏数据时其余数据继续导入，脚本以非零退出码结束并输出失败明细，便于修复后重跑。
- **FR-026**：导入完成且校验通过后，将 `GESP6_CACHE_DRIVER` 切换为 `db`，数据库成为缓存权威源，文件系统缓存停用；`data/gesp6/` 数据与 `FsHtmlCache` 代码**保留**（不删除，支持故障回退切换）；导入前建议做数据库备份以支持整体回滚。

### 3.7 业务整合点

- **FR-027**：`POST /api/solve` 整合：`requireAuth` 通过后执行 `getOrCreateUser(sub)`（FR-006）取得内部用户 id；建档失败的错误码判定边界（fail-closed 默认）：连接/DB 不可用 → `GESP6_DB_UNAVAILABLE`（503），连接正常但建档失败（约束冲突按 FR-006 幂等处理，其余异常）→ `GESP6_USER_CREATE_FAILED`（500），与 AC-001 一致；fail-open 开启时建档失败放行、不返回错误码（NFR-007）；**不做余额预检**——理由：POST 阶段 `contentHash` 未知（platform 输入需抓取后标准化才能计算），无法判定「已获取免费」场景，预检余额会误伤已获取过解法的零余额用户；最终计费以任务完成时的原子扣费为准（FR-018/FR-021）。`GET /api/solve` 轮询**维持现状**（无鉴权、`jobId` 为随机 UUID 防猜测），鉴权化列「后续」（见 §5.1）。
- **FR-028**：任务完成回调（`gesp6Orchestrator.solve().then`）整合，顺序：a) 成功 → 携带 `contentHash` 执行原子计费（FR-018）→ 写 `solveRecords`（FR-009）→ `completeJob`（结果含计费信息）；b) 计费失败——额度不足 → `failJob` 返回 `GESP6_BILLING_INSUFFICIENT_BALANCE`、不写解题记录；DB 故障 → 按 NFR-007 降级策略：fail-closed 下 `failJob` 返回 `GESP6_DB_UNAVAILABLE` / `GESP6_BILLING_DB_UNAVAILABLE`、不写解题记录，fail-open 下放行、不写任何 DB 记录、`completeJob` 携带 `charged=false` 与 `balanceRemaining=null`（FR-022）。
- **FR-029**：`Solution` 类型（[types.ts](file:///var/learning/app/lib/ai/types.ts)）扩展：新增 `contentHash`（必填）与 `sampleFp`（可选），由 Orchestrator 在返回结果前填充（compute 路径与缓存路径的 hash 均为已知值）；此扩展是 route 层计费/记录的前提，与 `spec-multi-solution-v1.0` 的 `Solution` 扩展方向一致，架构阶段协调合并实施。
- **FR-030**：前端计费反馈：结果页展示本次是否计费与剩余额度（数据来源 FR-022）；`balanceRemaining` 为 `null`（fail-open 放行期间）时展示「额度暂不可用」替代具体数值；额度不足时展示 `GESP6_BILLING_INSUFFICIENT_BALANCE` 错误与「联系管理员充值」提示，不破坏已展示的历史解法。

### 3.8 权限与安全

- **FR-031**：环境变量管理：`DATABASE_URL` 等 DB 相关变量仅存于 `.env`（不进版本库）或部署平台 secret；仅 Node 服务端读取；**middleware（Edge Runtime）禁止引用 DB 环境变量**（Edge 内联环境变量有泄露风险，且无 Node 驱动）；`GESP6_*` 新变量统一登记 `.env.local.example`。
- **FR-032**：SQL 注入防护：所有数据库查询必须参数化（驱动占位符/ORM 参数绑定），禁止字符串拼接 SQL；用户输入（含 `sub`、`platform`、`problemId`、`contentHash`、`sampleFp`）一律经参数绑定传入。
- **FR-033**：完整错误码清单（命名遵循 `MODULE_CATEGORY_SPECIFIC`）：

  | 错误码 | 场景 | 建议 HTTP |
  |--------|------|-----------|
  | `GESP6_BILLING_INSUFFICIENT_BALANCE` | 额度不足，拒绝解题 | 402 |
  | `GESP6_BILLING_DB_UNAVAILABLE` | 计费依赖的 DB 不可用（fail-closed） | 503 |
  | `GESP6_BILLING_DEDUCT_FAILED` | 扣费事务失败（非额度不足） | 500 |
  | `GESP6_DB_UNAVAILABLE` | 通用 DB 连接失败/超时（含建档路径连接不可用） | 503 |
  | `GESP6_USER_CREATE_FAILED` | 用户自动建档失败（连接正常但非约束冲突的异常） | 500 |
  | `GESP6_MIGRATION_VALIDATION_FAILED` | 数据导入校验失败（脚本） | 非零退出码 |

---

## 4. 非功能需求

### 4.1 性能

- **NFR-001**：缓存命中路径（`DbHtmlCache` 查询）对解题链路的额外延迟目标 ≤ 50ms（精确 `contentHash` 等值查询 + 索引）；任务为异步轮询模式，命中路径延迟不阻塞用户响应。
- **NFR-002**：连接池大小（默认 `GESP6_DB_POOL_MAX=10`）须覆盖并发解题量，避免每次请求新建连接；池由单例模块管理，跨请求复用。
- **NFR-003**：数据导入采用批量写入（批次建议 500–1000 行），全量导入（现有 content/primary/sample 文件规模）在分钟级完成。

### 4.2 安全

- **NFR-004**：所有 DB 访问参数化（FR-032），代码评审与测试双重把关。
- **NFR-005**：敏感信息防护：连接串不打印日志（含密码脱敏）；`DATABASE_URL` 不硬编码、不进版本库。
- **NFR-006**：额度扣减原子性由 DB 层保证（事务 + 条件更新 + 唯一约束），应用层校验为第二道防线（FR-018）。

### 4.3 可用性

- **NFR-007**：DB 故障隔离语义与降级策略（默认 **fail-closed**）：
  - **缓存读失败（`DbHtmlCache` 任一查询异常：`solutions` / `primaryIndexes` / `sampleIndexes`）**：视为缓存 miss，降级走 LLM 生成（维持现有 `HtmlCache` 读失败语义，不视为 DB 故障）；缓存写失败仅记日志不阻断主流程。
  - **计费/建档/解题记录依赖的 DB 不可用（`users` / `quotaAccounts` / `userSolutionAccess` / `billingRecords` / `solveRecords` 等读写异常）**：fail-closed 拒绝解题，返回 `GESP6_DB_UNAVAILABLE` / `GESP6_BILLING_DB_UNAVAILABLE`；可通过 `GESP6_BILLING_DEGRADE_OPEN=1` **显式**开启 fail-open（放行但不计费，且**不写任何 DB 记录**——`solveRecords` 与计费表同库，DB 不可用时本就无法写入；记 WARN 日志，仅作应急，风险见 §5.2）。
- **NFR-008**：DB 故障不影响 SSO 认证、静态页面与登录流程（认证不依赖 DB）。

### 4.4 可扩展性

- **NFR-009**：schema 为未来业务预留关联键：`userId`、`contentHash`、`sampleFp` 作为跨实体关联标准字段，多解法、套餐、管理后台可直接复用。
- **NFR-010**：本 spec 不绑定 ORM/驱动选型，只约束接口、语义与行为，具体技术选型由架构阶段决策。

### 4.5 合规性

- **NFR-011**：环境变量不硬编码（.env + 部署平台注入），新变量登记 `.env.local.example`。
- **NFR-012**：实施阶段的结构化修改按 [changelog.md](file:///var/learning/.opencode/rules/global/changelog.md) 规范在 `docs/changelog/` 记录更新日志。

---

## 5. 边界与排除项

### 5.1 不做

- **不做**在线支付与用户自助充值页面（充值为人工操作：直接改库或预留管理入口，管理页面列「后续」）。
- **不做**Redis 限流改造（IP 级限流维持内存 Map；计费/额度由 DB 保证跨实例一致，注释「精确限流需 Redis」维持现状）。
- **不做**用户登录/注册（SSO 已覆盖，认证不依赖 DB）。
- **不做** `job-store` 入库（判断与理由见 §8.1）。
- **不做** `GET /api/solve` 轮询的鉴权化（维持现状：无鉴权，`jobId` 为随机 UUID 防猜测；鉴权化列「后续」，见 FR-027）。
- **不做**管理后台页面（用户/额度/流水查询、充值操作）——预留数据模型，页面列「后续」。
- **不做**「用户已获取解法」历史列表页面（数据已落 `userSolutionAccess`，展示列「后续」）。
- **不做** DB 级审计日志（沿用现有 `audit-logger` 打点，不新建审计表）。
- **不做**解法内容清理/归档策略（维持现有「不主动清理被替换 content」语义）。
- **不做**读写分离、分库分表、DB 高可用集群（单库权威源，HA 列「后续」）。
- **不删除** `FsHtmlCache` 代码与 `data/gesp6/` 数据（导入后停用，保留回退能力）。

### 5.2 已知限制与风险

- **多实例下 job-store 轮询跨实例**：GET 轮询可能路由到未持有该 job 的实例而返回 404（用户重试即可）；缓解：负载均衡器对 `/api/solve` 开启会话保持（sticky session）；根治（Redis/DB job store）列「后续」。
- **任务完成时才扣费**：额度不足的用户仍会触发 LLM 生成（浪费一次调用）后才收到拒绝——已通过「缓存命中场景不调 LLM」与拒绝语义缓解，完全避免需在 POST 阶段可知 contentHash，超出本期范围。
- **fail-open 期间不写任何 DB 记录**：降级期间（计费/建档 DB 不可用）获取的解法不写 `solveRecords`/`userSolutionAccess`/`billingRecords`（`solveRecords` 与计费表同库、DB 不可用时本就无法写入），该期间解题行为无记录可查，DB 恢复后用户再次请求同一 `contentHash` 会被**重复计费**。缓解：fail-open 仅作应急开关，接受该风险；恢复后不补录历史访问（避免补录引入新的不一致）。
- **导入与线上并发写**：导入脚本执行期间，线上服务仍可能写入新的 fs 缓存文件，导致漏导。缓解：导入在维护窗口执行（暂停写入）或依赖脚本幂等可重跑（FR-024）补导。
- **多实例 driver 切换需同步**：`GESP6_CACHE_DRIVER=db` 为环境变量，多实例部署时须所有实例同步切换，否则部分实例仍走 fs 导致缓存行为不一致。缓解：driver 切换作为统一部署步骤执行（见 §9 部署注意）。

---

## 6. 验收标准

### 6.1 基础设施

- [ ] **AC-001**：未配置 `DATABASE_URL` 时，解题请求返回 `GESP6_DB_UNAVAILABLE`（503），且不触发 LLM 调用。
- [ ] **AC-002**：`GESP6_DB_POOL_MAX` / `GESP6_DB_STATEMENT_TIMEOUT_MS` 等配置可覆盖默认值（配置读取单测验证）。
- [ ] **AC-003**：迁移机制可重复执行（同一迁移跑两次不报错），版本可查询。

### 6.2 用户建档

- [ ] **AC-004**：SSO 用户首次发起解题后，`users` 表出现一条 `ssoSub` 唯一记录；再次请求复用该记录（不新增）。
- [ ] **AC-005**：并发 10 个相同 `sub` 的首次请求，`users` 表仅产生 1 条记录（唯一约束生效）。

### 6.3 解题记录

- [ ] **AC-006**：解题成功后 `solveRecords` 写入一条记录，含 `contentHash`、`cached`、`billed` 字段且与结果一致。
- [ ] **AC-007**：任务失败/取消不写 `solveRecords`。

### 6.4 缓存

- [ ] **AC-008**：`GESP6_CACHE_DRIVER=db` 时，缓存命中直接返回（不调 LLM，日志无 compute 记录），数据来源为数据库。
- [ ] **AC-009**：`primaryIndexes` 与 `sampleIndexes` 查询结果指向正确的 `contentHash`，且与导入前文件系统索引一致。
- [ ] **AC-010**：故障隔离验证（通过 DAO 层测试替身构造：mock/依赖注入模拟指定 DAO 抛错，非真实 DB 故障注入）：a) 仅 `solutions` 表查询异常（计费相关 DAO 正常）→ 解题降级为 LLM 生成并成功返回，不抛未处理异常；b) 计费/建档 DAO 不可用（模拟 `quotaAccounts` 相关 DAO 抛错）→ 任务以 `GESP6_DB_UNAVAILABLE` / `GESP6_BILLING_DB_UNAVAILABLE` 错误结束。

### 6.5 计费与额度

- [ ] **AC-011**：用户首次获取某解法（缓存命中、缓存未命中、`validated=false` 降级返回三种场景各验证一次）扣 1 次额度，生成 1 条 type=consume 流水，`userSolutionAccess` 新增记录。
- [ ] **AC-012**：同一用户再次获取同一 `contentHash` 免费，不扣费、无新增流水。
- [ ] **AC-013**：用户 A 已获取某 `contentHash` 后，用户 B 首次获取同一 `contentHash` → B 计费（用户维度隔离）。
- [ ] **AC-014**：同一题两种解法（不同 `contentHash`）→ 用户各计费一次（累计 2 次）。
- [ ] **AC-015**：并发 10 个请求（同一用户、同一 `contentHash`）→ 仅计费 1 次（唯一约束 + 事务生效）。
- [ ] **AC-016**：余额为 0 时请求新解法 → 任务失败返回 `GESP6_BILLING_INSUFFICIENT_BALANCE`，不返回解法。
- [ ] **AC-017**：余额恰好等于价格时扣费成功、余额为 0；后续新解法请求被拒（AC-016）。
- [ ] **AC-018**：人工充值（type=recharge，含 operator/remark）后余额按金额增加，流水完整。
- [ ] **AC-019**：新用户建档后获得 `GESP6_FREE_QUOTA_INITIAL` 次免费额度。
- [ ] **AC-020**：当前单解法实现下，同一用户对同一 `contentHash` 重复执行 `forceRegenerate`（如连续重新生成两次）不重复计费（仅首次计费 1 次）；「多解法产生新 `contentHash` 后首次获取计费」列为 spec-multi-solution-v1.0 落地后的关联验收（见 §7 风险表跨 spec 依赖行）。

### 6.6 数据导入

- [ ] **AC-021**：导入脚本执行后，`solutions` / `primaryIndexes` / `sampleIndexes` 记录数与导入前 fs 实际扫描的文件数一致（脚本输出扫描统计供比对）。当前 `data/gesp6/` 实际规模：`content/` 下 108 个 `.html` 文件、`primary/` 22 个索引文件、`sample/` 9 个索引文件（以导入前脚本实际扫描计数为准，不依赖目录数）。
- [ ] **AC-022**：重复执行导入脚本不产生重复数据（幂等）。
- [ ] **AC-023**：人为制造损坏数据（如删除某 html 的配对 meta）后导入，脚本报告该文件并跳过，其余导入成功，退出码非 0。
- [ ] **AC-024**：导入完成后切换 `GESP6_CACHE_DRIVER=db`，提交导入过的旧题直接缓存命中（不重新生成）。

### 6.7 业务整合

- [ ] **AC-025**：正常路径（DB 可用）下，`POST /api/solve` → 轮询 done 的响应包含 `charged` 与 `balanceRemaining` 字段，且与 DB 流水一致；fail-open 放行场景（`charged=false`、`balanceRemaining=null`）由 AC-026 覆盖。
- [ ] **AC-026**：fail-closed（默认）下模拟 DB 不可用 → 解题拒绝返回 `GESP6_DB_UNAVAILABLE`；设置 `GESP6_BILLING_DEGRADE_OPEN=1` 后放行且记 WARN 日志，放行期间：不计费、**不写任何 DB 记录**（`billingRecords` / `userSolutionAccess` / `solveRecords` 均不写，DB 不可用时本就无法写入）、轮询 done 响应 `charged=false`、`balanceRemaining=null`（前端显示「额度暂不可用」）。
- [ ] **AC-027**：`Solution` 类型含 `contentHash` 字段，Orchestrator 所有成功返回路径均填充。

### 6.8 安全

- [ ] **AC-028**：代码评审确认无客户端代码（含 Client Component、Edge middleware）import 数据库连接模块或引用 `DATABASE_URL`。
- [ ] **AC-029**：所有 DB 查询参数化（代码评审 + 注入尝试单测，如 `contentHash` 传 `'; DROP TABLE...` 不产生副作用）。
- [ ] **AC-030**：git 检查确认 `.env`（含 `DATABASE_URL`）未被提交，`.env.local.example` 已登记全部新增变量。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| 数据库成为单点 | DB 故障时解题主流程不可用 | NFR-007 fail-closed 默认 + `GESP6_BILLING_DEGRADE_OPEN` 应急开关；HA 列后续 |
| 导入数据不一致（meta 缺失/损坏） | 缓存记录不完整 | FR-025 成对校验 + 失败报告 + 脚本可重跑修复 |
| 并发扣费竞态（超扣/重复扣费） | 计费口径被破坏 | FR-018 唯一约束 + 事务条件更新，DB 为权威（AC-015 并发验证） |
| 计费口径误解（缓存命中不收费） | 收入/额度管控失效 | FR-015 规则表显式声明「缓存命中但未获取过仍计费」，AC-011 双路径验证 |
| 多实例 job 轮询丢失 | 用户偶发「任务不存在」 | §5.2：LB sticky session 缓解 + 用户重试；DB/Redis job store 列后续 |
| 跨 spec 依赖：多解法「不同 `contentHash`」的机制未落地（spec-multi-solution-v1.0 仅假设 `contentHashes` 数组、未定义产生机制） | 本 spec「新 `contentHash` 首次获取计费」规则无触发场景 | 本 spec 仅定义计费规则对「多解法最终以不同 `contentHash` 存在」这一约定的依赖，该约定的实现（如 hash 输入追加 variant/算法摘要）需在多解法 spec 后续工作中明确、本 spec 不定义；当前单解法实现下 `forceRegenerate` 不改变 `contentHash`，AC-020 仅验证「重复生成不重复计费」，多解法计费验证列为关联验收（待多解法 spec 落地） |

---

## 8. 技术决策记录

### 8.1 为什么 `job-store` 本期不入库

- 任务生命周期短（30 分钟 TTL）、状态频繁变更，入库需配套状态机与清理任务，超出本期范围。
- 任务结果的事实（谁、何时、解了哪题、哪个解法、是否计费）由 `solveRecords` + `billingRecords` 持久化，job 仅承载瞬时轮询状态。
- 多实例轮询问题通过 sticky session + 用户重试缓解（§5.2），根治方案（DB/Redis job store）列后续。

### 8.2 为什么计费放在「任务完成回调」而非 POST 预检/预授权

- POST 阶段 `contentHash` 未知（platform 输入需抓取后标准化），无法判定「已获取免费」场景；预检余额会误伤零余额的已获取用户。
- 任务完成时以原子事务扣费（FR-018），语义以 DB 为准；代价是额度不足的用户会先触发一次 LLM 调用——缓存命中场景不调 LLM，且拒绝明确（FR-019），可接受。
- 备选方案（Orchestrator 注入 BillingGate，在 compute 前预检）侵入更大，改变 Orchestrator 接口与职责边界，如评审认为浪费不可接受可升级采用。

### 8.3 为什么 `Solution` 必须扩展 `contentHash`

- 现有 `Solution = { html, validated, warning?, cached }` 不携带 hash，route 层无法获知本次解法标识，计费与记录无从谈起。
- Orchestrator 在 compute 与缓存两条路径均已持有 `contentHash`，填充成本极低；与 `spec-multi-solution-v1.0` 的 `Solution` 扩展（`sampleFp`/`variant`）方向一致，合并实施避免重复改类型。
- 合并后的 `Solution` 类型草案（供架构阶段直接采用）：

  ```typescript
  export type Solution = {
    html: string;
    validated: boolean;
    warning?: string;
    cached: boolean;
    contentHash: string; // 本 spec 必填（计费/记录前提）
    sampleFp?: string;   // 多解法 spec 引入，落地后按需必填
    variant?: number;    // 多解法 spec 引入，落地后按需必填
  };
  ```

### 8.4 为什么 `DbHtmlCache` 实现现有 `HtmlCache` 接口

- Orchestrator 只依赖 `HtmlCache` 接口（`htmlCache` 单例按 `GESP6_CACHE_DRIVER` 切换），新增 `db` 分支即可让缓存权威源切到数据库，Orchestrator 层零改动，符合注释中预留的 `DbHtmlCache` 扩展点。

### 8.5 为什么导入后保留 `FsHtmlCache` 与 `data/gesp6/`

- 导入是一次性操作，切换后若发现数据/性能问题可快速回退 `GESP6_CACHE_DRIVER=fs`；删除代码与数据是单向操作，不符合可回退原则。

### 8.6 为什么扣减顺序固定「免费额度优先」

- 充值额度是用户付费资产，免费额度是赠送资产；先消耗赠送额度符合用户预期，且不引入可配置性（遵循代码简洁原则，不为一次性场景做配置）。

### 8.7 为什么默认 fail-closed

- 计费与额度是核心业务约束，静默免费（fail-open）会破坏计费口径且无记录可查；降级为显式配置（`GESP6_BILLING_DEGRADE_OPEN`）由运维在应急时决策，默认安全。

### 8.8 为什么计费以 `contentHash` 为单位而非题目

- 同一道题未来支持多解法（每个解法独立 `contentHash`），「用户已获取该题」无法回答「用户是否已获取该解法」；以 `contentHash` 为单位天然支持多解法按解法独立计费，且与缓存键一致。

---

## 9. 涉及文件（预估）

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `package.json` | 修改 | 新增 PostgreSQL 驱动/ORM 依赖 |
| `app/lib/db/`（连接池、迁移、DAO 等） | 新增 | 数据库基础设施层（结构由架构师定） |
| `app/lib/billing/`（计费服务） | 新增 | 原子计费、额度、流水、解题记录写入 |
| `app/lib/ai/services/db-html-cache.ts` | 新增 | `DbHtmlCache` 实现 `HtmlCache` 接口 |
| `app/lib/ai/services/html-cache.ts` | 修改 | 单例新增 `GESP6_CACHE_DRIVER=db` 分支 |
| `app/lib/ai/types.ts` | 修改 | `Solution` 扩展 `contentHash`/`sampleFp`（与多解法 spec 协调） |
| `app/lib/ai/services/orchestrator.ts` | 修改 | 返回结果前填充 `contentHash` |
| `app/lib/job-store.ts` | 修改 | `JobRecord` 承载计费结果：`completeJob` 扩展携带 `charged`/`balanceRemaining`（fail-open 放行时 `balanceRemaining=null`），GET 轮询 done 响应顶层透出（FR-022） |
| `app/api/solve/route.ts` | 修改 | 建档 + 计费 + 解题记录写入 + 计费失败处理 |
| `app/result/page.tsx` | 修改 | 计费反馈展示（是否计费、剩余额度，数据经 sessionStorage 来自轮询响应） |
| `scripts/migrate-fs-cache-to-db.ts` | 新增 | 一次性数据导入脚本（含导入前 fs 扫描统计输出，AC-021 比对依据） |
| `app/lib/env.ts` | 修改 | `DATABASE_URL` 等 DB 变量登记与**惰性校验**（首次使用触发，不强制启动预连，与 FR-003 一致；延续现有 `validateEnv` 模式或新增独立校验函数，由架构师决策） |
| `.env.local.example` | 修改 | 登记新增环境变量（`DATABASE_URL`、`GESP6_DB_POOL_MIN/MAX`、`GESP6_DB_STATEMENT_TIMEOUT_MS`、`GESP6_DB_CONNECT_TIMEOUT_MS`、`GESP6_FREE_QUOTA_INITIAL`、`GESP6_SOLUTION_PRICE`、`GESP6_BILLING_DEGRADE_OPEN` 等） |
| `app/lib/billing/__tests__/`、`app/lib/db/__tests__/`、`tests/integration-tests/db-billing/`、`tests/e2e/billing/` 等 | 新增 | 计费/额度/导入/降级策略的单元与集成/E2E 测试落点（对应 AC-010~AC-030，具体目录结构与用例清单由测试专家在实施阶段细化）；AC-010 的单表故障隔离验证通过 DAO 层测试替身（mock/依赖注入模拟指定 DAO 抛错）完成，不依赖真实 DB 故障注入 |

---

## 10. 后续工作（非本期范围）

- 在线支付与用户自助充值。
- 管理后台（用户/额度/流水查询、充值操作入口）。
- 「用户已获取解法」历史列表页面。
- DB/Redis 化 job store（根治多实例轮询问题）。
- IP 限流的 Redis 化改造。
- LLM 成本核算报表（基于 `solveRecords` + `billingRecords`）。
- 数据库高可用与读写分离。
