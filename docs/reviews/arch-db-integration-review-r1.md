# 数据库与业务系统整合 架构评审意见 — 第 1 轮

**评审对象**：arch-db-integration-v1.0.md
**评审时间**：2026-08-18
**评审结论**：需修订

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR1-001 | §5.1 solutionDao / §3.2 AD-11 | 导入脚本选 `ON CONFLICT DO NOTHING`（跳过、不更新），但 §5.1 的 `upsertSolution`/`upsertPrimaryIndex`/`upsertSampleIndex` 定义为 `ON CONFLICT DO UPDATE`（指向最新），两者语义矛盾：同一 schema/DAO 无法同时满足"导入跳过"与"运行期更新"。且导入仅跳过不更新时，fs 中已有但 DB 中不同步的旧内容（如 validated 状态差异）无法被修正 | 重要 | 明确两个路径的语义：①运行期（DbHtmlCache.set 等）走 `upsert*`（DO UPDATE）；②导入脚本走独立的 `insertIfAbsent*`（DO NOTHING）DAO 方法或复用同一 DAO 但由脚本传参控制冲突策略。在 §5.1 显式区分「运行期 upsert」与「导入期 insert-if-absent」，避免方法签名与行为歧义 |
| AR1-002 | §5.2 Solution 类型 / §4.1 数据流 | spec FR-029 要求 `Solution` 扩展 `contentHash`（必填）+ `sampleFp`（可选），架构 §5.2 已定义类型，但 §4.1 数据流与 §5.1 `solutionDao.getByContentHash` 返回类型为 `ServiceResult<Solution | null>`（含 sampleFp），而 DbHtmlCache 的 `getByContentKey`（现有 HtmlCache 接口）返回 `ServiceResult<Solution | null>` 不带 sampleFp——DB 缓存路径是否填充 sampleFp 未明确，存在字段落点遗漏 | 重要 | 明确 sampleFp 的填充落点：DbHtmlCache 读取 solutions 表时可关联 sample_indexes/primary_indexes 反查 sampleFp，或声明 sampleFp 仅由 orchestrator 层填充（DB 层返回原始 Solution，sampleFp 由编排层补）。二选一必须与 §4.1 数据流一致 |
| AR1-003 | §6 目录结构 / §11 涉及文件 | 架构 E2E 测试目录写为 `tests/e2e/billing/`，但项目实际 E2E 目录为 `tests/e2e-tests/specs/`（playwright.config.ts `testDir: tests/e2e-tests/specs`，spec 按业务小类分文件），与现状不符 | 重要 | 改为 `tests/e2e-tests/specs/billing.spec.ts`（或 `db-billing.spec.ts`），与现有 12 个 spec 文件命名风格一致；集成测试 `tests/integration-tests/db-billing/` 与现有 `tests/integration-tests/` 扁平文件风格核对（现有为单文件 orchestrator.test.ts，可新建目录或单文件） |
| AR1-004 | §4.1 数据流 / §12 步骤 1 / §9 R-09 | 导入脚本用 `process.loadEnvFile('.env')` 加载环境变量，但项目实际 env 文件为 `.env.local`（`.env` 不存在），`.env.local` 亦被 .gitignore 排除；`loadEnvFile('.env')` 会加载不到 `DATABASE_URL` 而报错 | 重要 | 改为 `process.loadEnvFile('.env.local')`（Node 22 支持相对路径），或统一约定"DB 导入/迁移脚本读取 `.env.local`"，与项目现状（SSO/AI 变量均在 `.env.local`）一致；若后续引入 `.env` 需在 §7.2 环境变量清单中说明优先级 |
| AR1-005 | §4.1 b 完成回调 / §4.2 异常流 | 任务完成回调中"已取消"与"计费"的检查顺序未明确：若用户 POST 后立即 DELETE 取消，但后台 LLM 已返回成功结果，此时是否执行计费？架构只写"result.error.code === GESP6_CANCELLED 或任务已取消 → 丢弃"，未覆盖"结果成功但 job 已取消"的竞态 | 重要 | 明确：进入 settle 前先检查 job 是否已取消（`getJob(id).status === 'cancelled'`），已取消则丢弃结果、不计费不写记录；settle 与取消须在同一临界区判断（或接受"取消后仍可能计费"的已知语义并显式声明），建议采用"settle 前置取消检查"并说明并发窗口 |
| AR1-006 | §4.1 步骤 2 / §5.1 userDao | 建档顺序：`getOrCreateUser` 是否在创建 job 之前执行？若建档 DB 故障且 fail-closed，是否整个 POST 拒绝（不建 job）？已明确（§4.2 行 106），但 §4.1 步骤 2 未标注 fail-open 下 `userId=null` 的后续传递（步骤 4 createJob 是否仍执行） | 建议 | §4.1 步骤 2 补充：fail-open 下 `getOrCreateUser` 返回 `userId=null`，流程继续（createJob 正常执行），settle 阶段跳过 DB（§4.1 b 已体现）；明确"建档失败不阻断解题"仅限 fail-open |
| AR1-007 | §5.3 错误码 / §4.2 | `GESP6_BILLING_INSUFFICIENT_BALANCE` 标注 HTTP 402，但 GET 轮询 error envelope 维持 200——402 仅用于 POST 响应还是仅语义建议？POST 建档/校验失败响应实际状态码未定义 | 建议 | 明确 POST 响应状态码：建档失败 503/500、额度不足 POST 阶段不会出现（计费在后台），402 仅为错误码语义建议不用于实际响应；统一"POST 200 + ServiceResult + 业务错误码"或"POST 4xx/5xx + 错误体"二选一，与现有 route 行为核对 |
| AR1-008 | §7.3 Schema 草案 | `solutions.content_hash` 为 text PK，`billing_records.content_hash` 允许 NULL（recharge 无），但缺少对 `billing_records.content_hash` 的 CHECK 约束说明（consume 必须有、recharge 必须无） | 建议 | 补充 CHECK 约束：`CHECK (type='consume' AND content_hash IS NOT NULL) OR (type='recharge' AND content_hash IS NULL)`，或在 schema 定稿时由 db-modeler 处理（架构中注明该约束需求） |
| AR1-009 | §6 db-html-cache.ts / §8.1 | DbHtmlCache 直接读 DB（无内存 LRU 层），缓存命中路径每次查 DB；性能目标 ≤50ms 可行，但高频题目重复查询 DB 是否可接受？架构未说明 DbHtmlCache 是否叠加内存缓存（现有 DualKeyHtmlCache 的 LRU 逻辑是否复用） | 建议 | 明确 DbHtmlCache 是否保留内存 LRU 前置层（复用 DualKeyHtmlCache 或独立小 LRU）；若不加，需说明命中路径全部走 DB 且依赖连接池的性能可接受性（NFR-001 目标） |
| AR1-010 | §6 daos/ 拆分 | DAO 细分为 6 个文件（user/quota/solution/access/billing/solve-record），部分 DAO 仅 1-2 个方法（access/billing/solve-record 均事务内插入），拆分粒度是否过度？ | 建议 | 评估合并为 3 个 DAO（user+quota / solution+index / access+billing+solve-record 或计费域合并到 billing-service 内），遵循"不为一次性代码做抽象"，但保留按模块分离的清晰性由 db-modeler 定稿时权衡 |
| AR1-011 | §4.3 / §5.1 | 扣费 SQL 中 `balance_after`（余额口径）与 `amount`（单位）语义：`amount` 为 integer 次数（价格默认 1），`balance_after` 为扣费后 free+recharge 之和——文档未统一说明单位与口径，易被误解 | 建议 | §4.3 或 §7.3 明确：`amount`/`balance_after` 均以"次数"为单位（integer），`balance_after` = 扣费后 free_balance + recharge_balance 之和；与 §9 R-11 一致 |
| AR1-012 | §6 / §11 | 目录结构含 `migrations/`（drizzle-kit 输出 + down.sql），但未说明 down.sql 与 drizzle 生成 migration.sql 的版本追踪关系（drizzle 版本表只记录 up，down 手写如何保证回滚一致） | 建议 | 明确 down.sql 的版本追踪方式：与 migration.sql 同目录同前缀、人工维护、回滚时手动执行（不在 drizzle 版本表内追踪）；或采用 drizzle-kit `generate --custom` 自定义迁移模式，二选一 |
| AR1-013 | §12 步骤 10 / NFR-003 | 导入脚本批量 500-1000 行/批，但未说明批量写入事务粒度（整体单事务 or 分批提交）与失败重试策略 | 建议 | 明确导入事务粒度：建议分批提交（每批 500-1000 行一个事务），单批失败记入失败清单后继续下一批，脚本结束汇总报告并非零退出；与 FR-025 一致 |
| AR1-014 | §3.1 / §7.1 | 架构声明"实施前 `npm view` 验证版本"，但未给出具体目标版本号或版本范围，实施时存在不确定性 | 建议 | 给出目标主版本范围（如 drizzle-orm ^0.3x、pg ^8、drizzle-kit ^0.2x、tsx ^4），实施时再精确锁定；与 R-07 一致 |
| AR1-015 | §7.2 环境变量清单 | `.env.local.example` 现状未登记 `GESP6_CACHE_DRIVER`（仅 `.env.local` 有 `GESP6_CACHE_DRIVER=fs`），架构 §7.2 声明"扩展 db 值"，但未列入登记新增行——现有变量登记缺失 | 建议 | §7.2 补充 `GESP6_CACHE_DRIVER` 登记（现默认 memory、.env.local 已设 fs、新增 db 值），保持 .env.local.example 与实际一致 |
| AR1-016 | §4.1 b / AD-08 | 主 key 命中路径（orchestrator.ts L120）提前 return 时，`result.data.contentHash` 为当前请求 hash（Plan B 语义），但该路径缓存返回的 Solution 是否已携带 sampleFp 未明确 | 建议 | 与 AR1-002 一并明确：主 key 命中路径的 contentHash/sampleFp 填充逻辑（当前请求 hash + 由 primary_indexes 反查或或由编排层填充） |
| AR1-017 | §4.3 扣费 SQL | 免费优先两连发 UPDATE 存在理论竞态：①影响 0 行后、②执行前，余额可能被并发修改（如 recharge 事务增加 recharge_balance）——但该窗口不破坏不变量（最终仍免费优先优先扣免费余额），需文档说明 | 建议 | §4.3 或 §9 补充说明：两连发 UPDATE 的竞态窗口不破坏"免费优先 + 余额非负"不变量，仅可能因并发 recharge 导致多扣一次免费余额（结果等价于免费优先），可接受；或改用单条 CASE WHEN 原子更新消除窗口 |
| AR1-018 | §12 步骤 2 | drizzle-kit `generate` 依赖已有 schema 与已连 DB 的 diff，首次迁移在空库执行时需确认 drizzle-kit 能生成初始 DDL（首次生成 snapshot），文档未说明空库首迁流程 | 建议 | 明确首迁流程：`drizzle-kit generate` 基于 schema.ts 生成首个 migration（无需空库 diff），`drizzle-kit migrate` 建表；若采用 `generate --custom` 则手写首迁 SQL |
| AR1-019 | §8.1 / §12 步骤 8 | DbHtmlCache 单飞机制（in-flight Promise Map）保留，但 DB 版本与现有内存版本的单飞粒度（按 contentHash）一致？DB 查询幂等性（无副作用）下单飞是否必要？ | 建议 | 说明 DbHtmlCache 单飞粒度为 contentHash（与现有一致），DB 查询幂等但单飞仍可避免重复查询/写竞争；确认保留 |
| AR1-020 | §5.1 billing-service | `settleSuccessfulSolution` 入参含 `cached`/`validated`（写入 solve_records），但未说明计费判定是否依赖这些字段（应为"不依赖"——仅 userSolutionAccess 判定），需明确 | 建议 | 明确 settle 的计费判定仅依据 userSolutionAccess 唯一约束，`cached`/`validated` 仅透传写入 solve_records，不影响计费与否（与 spec FR-015/FR-017 一致） |
| AR1-021 | §4.1 b / §5.1 | `billingService.settleSuccessfulSolution` 内部写 solve_records，但 route.ts 中 job 完成回调是否还有其它 solveRecords 写入路径（现状无）——需确认不存在双写 | 建议 | 明确 solve_records 仅由 settle 单事务写入（唯一写入点），route 回调不单独写；杜绝双写 |

## 评审总结

本轮评审结论为**需修订**（5 项重要级问题，无阻塞级）。

架构整体质量高：技术选型（Drizzle + pg + drizzle-kit + tsx）与项目契合、依赖兼容性已核对、模块划分（D1~D7）清晰、事务设计（唯一约束 + 条件 UPDATE + 行锁三层防超扣）严谨、FR→架构落点映射完整（33 FR + 12 NFR 全覆盖）、§13 架构边界声明与现有代码一致（orchestrator 成功返回点 3 处，AD-08 覆盖完整；middleware 无 DB 引用；job-store 不入库 / GET 无鉴权 / guard.ts 不改均符合现状）。

核心修订方向（5 个重要级）：
1. **AR1-001**：导入（DO NOTHING）与运行期（upsert DO UPDATE）DAO 语义冲突，需区分两条路径；
2. **AR1-002 / AR1-016**：sampleFp 填充落点在 DbHtmlCache 层缺失（字段落点遗漏）；
3. **AR1-003**：E2E 测试目录与项目实际（tests/e2e-tests/specs/）不符；
4. **AR1-004**：导入脚本 env 加载文件错误（应为 .env.local）；
5. **AR1-005**：settle 与取消竞态检查顺序未明确。

建议 nextjs-architect 修订后升版 v1.1，进入第 2 轮评审。