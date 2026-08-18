# 数据库与业务系统整合 评审意见 — 第 2 轮

**评审对象**：spec-db-integration-v1.0.md（文件内版本 v1.1）
**评审时间**：2026-08-18
**评审结论**：需修订

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R2-001 | §3.5 FR-015 依赖声明 | 声称「同一题产生不同 contentHash 的机制由 spec-multi-solution-v1.0 定义」与事实不符：经全文核验，该 spec 未定义该机制——FR-002 仅假设 `contentHashes` 数组含多个 hash（`{ contentHash, createdAt, variant }`），未说明多解法时 contentHash 如何不同（当前 `computeContentHash(normalizedContent)` 对同一题必然产生相同 hash） | 重要 | 修订依赖声明：a) 如实说明 spec-multi-solution-v1.0 仅假设多解法对应多个 contentHash、未定义产生机制；b) 本 spec 的计费规则仅依赖「多解法最终会以不同 contentHash 存在」这一约定，该约定的落地（hash 输入追加 variant/算法摘要等）需在多解法 spec 或本 spec 的后续工作中明确；c) 明确当前单解法实现下 forceRegenerate 不改变 contentHash、不重复计费（已解决），避免读者误以为依赖已成立 |
| R2-002 | §6.7 AC-026 | fail-open 断言「solveRecords 可写但 billed=false」与 NFR-007 触发前提矛盾：NFR-007 定义 fail-open 触发场景为「计费/建档依赖的 DB 不可用」，而 solveRecords 与计费表同属一个数据库——计费 DB 不可用时 solveRecords 同样无法写入；此外 fail-open 时 `balanceRemaining` 取值未定义（无法从 DB 读取余额） | 重要 | 修订 fail-open 语义：a) 计费/建档 DB 不可用时**一律不写任何 DB 记录**（含 solveRecords，避免与 NFR-007 触发前提矛盾）；b) `charged=false`、`balanceRemaining` 在 fail-open 下返回 `null`（前端显示"额度暂不可用"）或保持请求前已知值，需明确取值；c) 若确实希望 fail-open 时写 solveRecords（用于流量观测），则需将触发前提改为「仅计费表异常而 solveRecords 可用」的部分故障场景，并在 NFR-007 区分两类故障，二选一必须自洽 |
| R2-003 | §6.4 AC-010 | 单表故障（仅 solutions 表/仅 quotaAccounts 表异常）注入方式未明确，真实 DB 难以构造此类隔离故障，测试可行性存疑 | 建议 | 明确 AC-010 的验证手段为 DAO 层测试替身（mock/依赖注入模拟指定 DAO 抛错），非真实 DB 故障注入；在 §9 测试文件落点中补充对应单测说明 |
| R2-004 | §3.7 FR-027 / §6.1 AC-001 | AC-001 断言未配置 `DATABASE_URL` 返回 `GESP6_DB_UNAVAILABLE`（503），但 FR-027 仅说「用户建档失败返回明确错误码」，未限定 `GESP6_DB_UNAVAILABLE`（503）与 `GESP6_USER_CREATE_FAILED`（500）的判定边界（哪类失败归 503、哪类归 500） | 建议 | 在 FR-027 或错误码表中明确：连接/DB 不可用 → `GESP6_DB_UNAVAILABLE`（503）；连接正常但建档失败（如约束冲突以外异常）→ `GESP6_USER_CREATE_FAILED`（500），保证 AC-001 与 FR-027 一致 |
| R2-005 | §4.3 NFR-007 | 缓存读失败分类仅列 `solutions` 表，`primaryIndexes` / `sampleIndexes` 查询异常未归类，存在语义空洞（这三种索引查询都属缓存读路径） | 建议 | NFR-007 将缓存读失败统一定义为「`DbHtmlCache` 任一查询（solutions / primaryIndexes / sampleIndexes）异常 → miss 降级 LLM 生成」，与 FR-014 的降级语义对齐 |
| R2-006 | 文件命名 | 文件名为 `spec-db-integration-v1.0.md` 但文件内版本为 v1.1，文件名与文件内版本不一致；工作流规定「禁止新建版本文件、始终在原文件修订」，但未说明文件名是否随 minor 更新 | 建议 | 在「变更记录」中注明文件名沿用 v1.0（遵循 spec-workflow「禁止新建版本文件」约束，文件名不随修订更新，版本号以文件内为准）；或在后续版本修订时统一文件名为 `spec-db-integration-v1.1.md` 并同步规范说明，二选一明确即可 |

## R1 各条复核结论

| R1 编号 | 严重程度 | 复核结论 |
|---------|---------|---------|
| R1-001 | 重要 | 已解决（AC-020 改为当前单解法验证 + 多解法列为关联验收；遗留 R2-001 依赖声明不实） |
| R1-002 | 重要 | 已解决（全文 `.env.example` → `.env.local.example`，grep 无残留；`data/gesp6` 实测 content 108 html 成对、primary 22、sample 9，与修订一致） |
| R1-003 | 重要 | 已解决（FR-015 新增 validated=false 降级返回计费行；AC-011 三场景验证） |
| R1-004 | 重要 | 已解决（FR-016/§3.0/FR-018 双列 freeBalance+rechargeBalance 自洽，无「单列待定」残留） |
| R1-005 | 重要 | 已解决（AC-021 改为 fs 实际扫描计数比对，注明 108/22/9，删除「88 分桶」；实测数字准确） |
| R1-006 | 重要 | 已解决（NFR-007 故障隔离语义明确；遗留 R2-003 测试注入方式未明确） |
| R1-007 | 建议 | 已采纳 |
| R1-008 | 建议 | 已采纳 |
| R1-009 | 建议 | 已采纳 |
| R1-010 | 建议 | 已采纳 |
| R1-011 | 建议 | 已采纳 |
| R1-012 | 建议 | 已采纳 |
| R1-013 | 建议 | 已采纳 |
| R1-014 | 建议 | 已采纳 |
| R1-015 | 建议 | 主体已解决（AC-026 行为边界补充）；遗留 R2-002（solveRecords 可写与触发前提矛盾、balanceRemaining 未定义） |

## 评审总结

本轮评审结论为**需修订**（2 个重要级问题）。第 1 轮 15 条问题已全部解决/采纳，其中遗留 3 个衍生问题（R2-001 依赖声明不实、R2-002 fail-open 语义矛盾、R2-003 测试注入方式）+ 3 个新发现问题（R2-004~R2-006）。

核心修订方向：
1. **R2-001**：修正跨 spec 依赖声明，如实说明 spec-multi-solution-v1.0 未定义 contentHash 产生机制；
2. **R2-002**：统一 fail-open 语义——计费 DB 不可用时一律不写 DB 记录、`balanceRemaining` 返回 `null`，或明确区分两类故障；
3. 其余为建议级（R2-003~R2-006），酌情采纳。

建议 spec-generator 修订后升版 v1.2，进入第 3 轮评审（或经总调度评估后直接收尾）。