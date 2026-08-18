# 数据库与业务系统整合 评审意见 — 第 1 轮

**评审对象**：spec-db-integration-v1.0.md
**评审时间**：2026-08-18
**评审结论**：需修订

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R1-001 | §3.5 FR-015 表格、§6.5 AC-020 | 计费规则表将 forceRegenerate 场景描述为"生成的新解法（新 contentHash）"，但实际代码（orchestrator.ts 第 152/262 行）中 contentHash 由题目标准化内容计算（`computeContentHash(normalizedContent)`），forceRegenerate 仅跳过缓存读强制重生成（第 249 行注释"跳过缓存读 + in-flight 复用，直接走 compute + 缓存写"），**不会产生新 contentHash**；且 spec-multi-solution-v1.0 也未定义多解法如何产生不同 contentHash。AC-020 依赖"新 contentHash"前提，按当前实现无法通过 | 重要 | 明确跨 spec 协调点：新解法 contentHash 的计算方式（如 hash 输入追加 variant/算法摘要）由多解法 spec 定义，本 spec 的计费规则依赖该定义；或在本 spec 中显式声明"forceRegenerate 产生新 contentHash 的前提由多解法 spec 保证，若未落地则 AC-020 暂缓验证" |
| R1-002 | §3.8 FR-031、§4.5 NFR-011、§6.8 AC-030、§9 | 多处引用 `.env.example`，但项目实际文件为 `.env.local.example`（已 glob 验证 `.env.example` 不存在），现有 SSO/AI 变量均登记在 `.env.local.example` | 重要 | 全文统一改为 `.env.local.example`（与现状一致），或明确决策"新建 `.env.example` 并迁移现有登记"后统一引用 |
| R1-003 | §3.5 FR-015 | 计费规则表仅覆盖"任务失败/取消/未返回解法不计费"，未定义 **validated=false 的降级返回**（orchestrator.ts 中解析失败返回原始 HTML、g++ 不可用降级两条路径均返回有内容但 validated=false 的 Solution）是否计费。按"用户×解法"口径用户确实获取了内容，但内容未验证 | 重要 | 补充规则：降级返回视为成功获取、按首次获取计费（与缓存命中未获取过仍计费口径一致）；或声明降级结果不计费并在 FR-015 表格中显式列出，二选一必须明确 |
| R1-004 | §3.5 FR-016 | 同时声明"扣减顺序建议免费额度优先"与"具体余额建模方式——单余额列或双列——由 db-modeler 决策"，二者互斥：单余额列无法区分免费/充值来源，无法实现"免费优先"扣减 | 重要 | 明确建模约束：实现"免费优先"必须双列（freeBalance/rechargeBalance）或单列+来源标记；将"单列或双列待定"改为"双列（或等价来源标记），由 db-modeler 定具体列结构" |
| R1-005 | §6.6 AC-021 | 验收条件引用"88 个 content 分桶数据全量校验"。已核验：`data/gesp6/content/` 下确实存在 **88 个分桶目录**，但分桶目录数 ≠ 文件数（实际 html 文件 108 个、primary 22 个、sample 9 个）。"88 分桶"表述易被误读为文件数，导入脚本的测试数据来源未定义 | 重要 | 删除"88 分桶"表述，改为"与文件系统实际文件数一致（以导入前 fs 扫描计数为准）"；并明确导入脚本的测试数据来源（生产数据快照/测试夹具） |
| R1-006 | §6.4 AC-010、§4.3 NFR-007 | AC-010"DB 查询异常时解题降级为 LLM 生成"与 fail-closed 默认策略的交互未定义：若 DB 完全不可用，任务会在计费阶段以 DB 错误码失败而非成功返回；"缓存读失败降级"仅在缓存表故障而计费表正常时才能成功返回，测试无法构造该隔离场景 | 重要 | 明确故障隔离语义：缓存读失败（solutions 表异常）→ miss 降级 LLM；计费/建档 DB 不可用 → fail-closed 拒绝。AC-010 改为"模拟缓存查询失败（计费可用）时降级 LLM 成功返回；模拟计费 DB 不可用时任务以 DB 错误码结束" |
| R1-007 | §3.1 FR-001、§4.4 NFR-010 | FR-001"引入 PostgreSQL 数据库驱动/ORM 依赖"与 NFR-010"不绑定 ORM/驱动选型"存在表述张力（FR-001 暗示二选一） | 建议 | FR-001 改为"引入 PostgreSQL 访问依赖（驱动或 ORM，具体选型由架构阶段按 NFR-010 决策）" |
| R1-008 | §3.0 实体关系总览 | quotaAccounts 已列"免费余额、充值余额"（双列定稿），与 FR-016"单列或双列待定"不一致 | 建议 | §3.0 标注"余额建模待定（单列/双列），见 FR-016"，或与 R1-004 修订后保持一致 |
| R1-009 | §3.2 FR-007、§9 | "鉴权守卫与用户记录关联"落点不明确：guard.ts 未列入 §9 涉及文件；result 页（requireAuthPage 场景）如何取得 userId/余额未定义 | 建议 | 明确：guard.ts 不改，关联逻辑在 route.ts 闭包中经 getOrCreateUser(sub) 完成；result 页计费信息数据来源为轮询响应（sessionStorage 传递），无需 requireAuthPage 关联用户 |
| R1-010 | §3.5 FR-022 | 轮询 done 响应携带 charged/balanceRemaining 的响应结构未定义（放 job.result 内还是 data 顶层），GET /api/solve 响应契约需明确 | 建议 | 定义响应结构草案，如 data 顶层新增 `charged: boolean`、`balanceRemaining: number`（与 result 平级），并同步 §9 job-store.ts 的 JobRecord 扩展说明 |
| R1-011 | §3.7 FR-027/FR-028 | GET /api/solve 轮询当前无鉴权（route.ts GET 无 requireAuth），spec 未讨论该现状是否维持 | 建议 | 在 §5.1 或 FR-027 中声明"轮询维持现状（jobId 为随机 UUID 防猜测），鉴权化列后续" |
| R1-012 | §9 涉及文件 | 缺 env.ts 落点（DB 环境变量是否扩展 validateEnv 校验）与测试文件落点（AC 对应的单测/集成测试/E2E 文件） | 建议 | 补充 env.ts 变更说明（DATABASE_URL 惰性校验、不强制启动预连，与 FR-003 一致）；补充测试文件预估（如 app/lib/billing/__tests__、tests/integration-tests/db-billing 等） |
| R1-013 | §3.7 FR-029、§8.3 | 与 spec-multi-solution-v1.0 的 Solution 扩展字段不一致（多解法 spec：sampleFp 必填 + variant 必填；本 spec：contentHash 必填 + sampleFp 可选），"架构阶段协调"未给出合并后形态 | 建议 | 在 §8.3 补充合并后的 Solution 类型草案（如 `{ html, validated, warning?, cached, contentHash, sampleFp?, variant? }`），供架构阶段直接采用 |
| R1-014 | §5.2 已知限制与风险 | 风险清单遗漏：a) fail-open 降级期间获取的解法未记录 userSolutionAccess，恢复后用户再次请求会被重复计费；b) 导入脚本与线上服务并发（导入期间新解法写入 fs 可能漏导）；c) 多实例部署时 driver 切换需所有实例同步（环境变量变更的部署步骤） | 建议 | §5.2 补充三条风险及缓解：a) 声明 fail-open 仅应急、接受重复计费风险；b) 导入前停写或导入后重跑幂等脚本；c) 切换 driver 作为部署步骤统一执行 |
| R1-015 | §6.7 AC-026 | fail-open 验证条件"放行且记 WARN 日志"未定义放行期间的行为边界（是否写 solveRecords、是否返回 charged 字段） | 建议 | 补充 fail-open 语义：放行、不计费、不写 billingRecords/userSolutionAccess，solveRecords 可写（billed=false），charged 返回 false |

## 评审总结

本轮评审结论为**需修订**。spec 整体质量较高：模板章节齐全（背景/用户故事/FR/NFR/边界/AC/技术决策/涉及文件），FR-001~033、AC-001~030、NFR-001~012 编号连续，用户原始需求（用户×解法计费、首次获取计费、缓存命中未获取过仍计费、已获取免费、多解法单独计费、并发防超扣、免费额度+人工充值、一次性导入、多实例、SSO 不变）全部覆盖，错误码命名合规，§8 技术决策记录充分。

核心修订方向（6 个重要级问题）：
1. **计费口径与代码事实对齐**：forceRegenerate 不产生新 contentHash（R1-001）、validated=false 降级结果计费规则缺失（R1-003）、免费优先与余额建模互斥（R1-004）——这三项直接影响计费核心规则的可实现性；
2. **验收条件可验证性**：AC-020 依赖不成立的前提（R1-001）、AC-021 数字表述易误读（R1-005）、AC-010 与 fail-closed 交互未定义（R1-006）；
3. **环境变量文件引用错误**：.env.example 应为 .env.local.example（R1-002）。

建议 spec-generator 按上述问题修订后升版 v1.1，进入第 2 轮评审。