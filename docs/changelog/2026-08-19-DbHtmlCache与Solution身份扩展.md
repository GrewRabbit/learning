# DbHtmlCache 缓存驱动与 Solution 身份字段扩展

**日期**：2026-08-19
**类型**：新增
**影响范围**：`app/lib/ai/`（缓存层 + 编排层）、`app/lib/job-store.ts`、相关测试

## 变更背景

数据库与业务系统整合（arch-db-integration-v1.0）实施步骤 6（类型与编排扩展）与步骤 8（DbHtmlCache）：route 层计费（T5）需要 `Solution` 携带 `contentHash`/`sampleFp` 身份标识（FR-029/AD-08）；导入完成后 PostgreSQL 成为缓存权威源，需要 `DbHtmlCache` 接入现有 HtmlCache 切换机制（AD-06/FR-014），Orchestrator 零依赖注入改动（§13.5）。

## 变更内容

### Solution 身份字段与编排填充（步骤 6，AD-08/AC-027）

- `Solution` 类型新增 `contentHash: string`（必填，FR-029）与 `sampleFp?: string`（可选，多解法 spec 预留）
- 新增 `BILLING_INFO_STORAGE_KEY` 常量（`'gesp6:billing-info'`，sessionStorage 键，供 /solve→/result 传递 charged/balanceRemaining，FR-022/AD-09；值命名与 `SOLUTION_STORAGE_KEY='gesp6:solution'` 同模式）
- Orchestrator 两分支（solvePlatform/solveTextOrImage）在 getOrCompute 返回后经 `fillSolutionIdentity` 统一填充（compute 成功/Plan B/降级/fix-loop 全覆盖）：
  - compute 路径：contentHash = 本次请求 `computeContentHash(normalizedContent)`；sampleFp = `all || first || undefined`（Plan B 场景记当前请求 hash，用户维度计费语义 spec §8.8）
  - 主 key 命中提前 return 路径：contentHash = 缓存携带值（DbHtmlCache 按 solutions 表主键返回）；sampleFp 置 undefined（无指纹上下文，solve_records.sample_fp 为 NULL）
  - compute/fix-loop 内部构造点同步携带 contentHash（独立调用方语义完整）
- `JobRecord` 新增 `charged: boolean` / `balanceRemaining: number | null`；`completeJob` 第三参数 `billing` 为**可选**（未传保持 charged=false/balanceRemaining=null），route.ts 现有调用无需修改即可编译，T5 落地时传真实值

### DbHtmlCache（步骤 8，AD-06/FR-014/AR1-009）

- 新增 `app/lib/ai/services/db-html-cache.ts` 实现 HtmlCache 接口，`GESP6_CACHE_DRIVER=db` 分支接入单例（保留 memory/fs）
- 内部三个独立 LRU 前置层（primary/content/sample，max=100、ttl=1h，与 DualKeyHtmlCache 一致）；读路径 LRU→DAO、写路径 set 双写 LRU+DB（DB 为权威源）
- **HtmlCache 接口读方法 Promise 化**：`getByPrimaryKey`/`getByContentKey`/`getBySampleFingerprint` 签名改为 `Promise<ServiceResult<...>>`（DbHtmlCache 读 PostgreSQL 必须异步，同步签名无法承载）；DualKeyHtmlCache/FsHtmlCache 实现体逻辑不变仅 async 化，orchestrator 主 key 前置检查加 await；`set` 保持 void（fire-and-forget，与 FsHtmlCache 同模式）
- 读失败（DAO success=false/异常）视为 miss 降级走 LLM（FR-014b/AC-010a，不算 DB 故障）；写失败仅记日志不阻断（NFR-007）
- Plan B 关键语义（终审观察 3）：sample 命中返回前以当前请求 contentHash `upsertSolution` 落 solutions 行（DO UPDATE 幂等，确保 T5 settle 写 user_solution_access 的 FK→solutions 不断裂）+ `upsertSampleIndex(当前fp, 当前contentHash)` + LRU 回写；索引失效仅清理 LRU（DB 无删除 API，后续写入自愈）
- 单飞 in-flight Map（key=contentHash）；compute 成功 validated=true 才写 sample 索引（FR-008 对齐）；set 内解析主 key（`gesp6:platform:` 前缀，复用 fs-paths.parsePrimaryKey），解析失败仅记日志跳过 primary 索引写入

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `app/lib/ai/services/db-html-cache.ts` | 新增 | DbHtmlCache 实现（LRU 前置层 + DAO + 单飞） |
| `app/lib/ai/services/__tests__/db-html-cache.test.ts` | 新增 | 单测 26 例（全 mock solutionDao，零真实 DB） |
| `app/lib/ai/types.ts` | 修改 | Solution 扩展 + BILLING_INFO_STORAGE_KEY |
| `app/lib/ai/services/html-cache.ts` | 修改 | 接口读方法 Promise 化 + DualKeyHtmlCache async 化 + 单例 db 分支 |
| `app/lib/ai/services/fs-html-cache.ts` | 修改 | 读方法 async 化 + getOrCompute 内部 await + getByContentKey 读携带 contentHash |
| `app/lib/ai/services/orchestrator.ts` | 修改 | fillSolutionIdentity 统一填充 + 主 key 检查 await |
| `app/lib/ai/services/fix-loop.ts` | 修改 | 构造点携带 contentHash |
| `app/lib/job-store.ts` | 修改 | JobRecord 计费字段 + completeJob 可选 billing 参数 |
| `tests/integration-tests/orchestrator.test.ts` | 修改 | 读方法 await 适配 + 新增 AC-027 三路径填充断言（3 例） |
| `app/lib/ai/services/__tests__/`（html-cache/fs-html-cache/orchestrator/logging-pipeline）、`app/lib/__tests__/job-store.test.ts`、`app/api/solve/__tests__/route.test.ts` | 修改 | Promise 化连锁适配 + T6 用例（AD-08 填充、completeJob billing） |

## 配置 / 环境变量变化

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `GESP6_CACHE_DRIVER` | `memory` | 新增 `db` 值（已于 T1 登记 `.env.local.example`；切换 db 需先 db:migrate + db:import，R-03） |

## 验证方式

- [x] 类型检查：`npm run type-check`（0 错误）
- [x] Lint：`npm run lint`（0 警告）
- [x] 单元测试：`npm run test:unit`（666 passed / 4 skipped，含 DbHtmlCache 26 例）
- [x] 集成测试：`npm run test:integration`（18 passed，含 AC-027 新增 3 例）

## 后续影响 / 注意事项

- HtmlCache 接口读方法已 Promise 化：后续新增实现（如测试替身）须返回 Promise；外部调用须 await
- Plan B 命中时若 DB 写失败（记 ERROR 日志），当前 contentHash 在 DB 无 solutions 行，T5 settle 的 FK 插入会失败——与 NFR-007 同域 DB 故障场景，靠日志排查
- `GESP6_CACHE_DRIVER=db` 的 E2E 验证（AC-008/AC-009/AC-024）依赖导入脚本（T10）完成后再切
- Orchestrator 依赖注入零改动保持（仅依赖 HtmlCache 接口，§13.5）
