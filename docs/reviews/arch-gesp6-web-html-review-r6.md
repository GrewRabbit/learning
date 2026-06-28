# GESP6 解题网页生成器架构设计 第 6 轮评审意见

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.7，状态 in-review）
**评审范围**：核查 v1.7 对 r5 评审意见（AR5-001~AR5-010 共 10 项）的修订是否到位，以及 v1.7 是否引入新问题；§1-§13 在 v1.5 已 approved，仅核查 §14 + §6 新增内容
**评审时间**：2026-06-29
**评审结论**：需修订（存在 1 项重要问题）

---

## 一、r5 修订到位性逐项核查表

| 编号 | r5 严重程度 | r5 问题摘要 | v1.7 修订位置 | 核查结论 | 核查依据 |
|------|------------|------------|--------------|---------|---------|
| AR5-001 | 阻塞 | §14.4 表"实施细节文档"列 + §14.6 引用不存在的实施附录 spec-gesp6-impl-p0p1-v1.0.md，且 §14.6 描述附录"v1.1（in-review），已完成 r1 评审 + 修订，待 r2 评审"状态不实 | §14.4 表头改为"实施细节参考（架构本身章节）"，11 个 P0/P1 项均改为引用 §5/§6/§8 等；§14.6 移除不实状态描述，改为"当前状态：待生成" | **已解决** | ①§14.4 表格列名已变更，所有项引用架构本身章节（如 §5.2 ModelConfig + §6、§5.1 + §6 + §7.1 等），无附录章节号引用；②§14.6 当前状态明确为"待生成（不在本架构文档 approved 的阻塞路径上）"，移除了"v1.1（in-review）/r1/r2"等不实描述；③经 Glob 验证 docs/specs/ 目录确无附录文件，"待生成"描述与磁盘状态一致 |
| AR5-002 | 重要 | §14.2 Phase 2 阶段输出 + §14.5 Phase 2→3 门槛称"7 个接口"，与 §14.3 Phase 2 实际 6 个（Orchestrator 在 Phase 4）不一致 | §14.2 Phase 2 阶段输出改为"6 个接口，Orchestrator 在 Phase 4"；§14.5 Phase 2→3 门槛改为"6 个接口单例可独立调用（...Orchestrator 在 Phase 4）" | **已解决** | ①§14.2 Phase 2 阶段输出明确"6 个接口，Orchestrator 在 Phase 4"；②§14.5 Phase 2→3 门槛列举 6 个接口名称并标注"Orchestrator 在 Phase 4"；③与 §14.3 Phase 2 列出的 6 个模块一致 |
| AR5-003 | 重要 | §14.5 Phase 3→4 门槛"Promise 单飞生效"错误关联 LLMCaller（单飞属 HtmlCache/ProblemFetcher） | Phase 3→4 门槛改为"LLMCaller.generate 可加载实际 gesp6-skill.md 文本并返回 LLMOutput（mock OpenAI SDK 验证）"；Phase 2→3 门槛补充"HtmlCache.getOrCompute 与 ProblemFetcher 单飞模式生效" | **已解决** | ①Phase 3→4 门槛已移除"Promise 单飞生效"，聚焦 Prompt 加载能力；②Phase 2→3 门槛补充"HtmlCache.getOrCompute 与 ProblemFetcher 单飞模式生效（并发同 key 请求复用同一 Promise）"，与 §7.1/§8.2 单飞归属一致 |
| AR5-004 | 重要 | §14.2 Phase 1 主要内容未包含创建 Prompt 占位文件，占位文件创建时机与责任方不清 | §14.2 Phase 1 主要内容增加"Prompt 占位文件（gesp6-skill.md、fix-prompt-template.ts、image-recognition-prompt.md 空文件）"；备注补充占位策略说明 | **已解决** | ①§14.2 Phase 1 主要内容明确列出 3 个 Prompt 占位文件；②§14.5 Phase 1→2 门槛补充"3 个 Prompt 占位文件存在"作为可检查条件；③备注说明 Phase 1 创建为主、Phase 2 兜底（详见 AR6-003 关于表述歧义的建议） |
| AR5-005 | 重要 | §14.4 P0/P1/P2 映射表未覆盖 /api/health 端点（FR-020 独立需求） | §14.4 表格新增独立行"接入层 /api/health 端点（FR-020） | Phase 5 | §6 目录结构 + FR-020" | **已解决** | ①§14.4 表格 P1 项已新增 /api/health 独立行，引用 §6 + FR-020；②与 §14.2 Phase 5"/api/health 端点（FR-020）"一致；③与 §14.5 Phase 5→6 门槛"GET /api/health 返回 200（FR-020）"一致 |
| AR5-006 | 建议 | §6 目录结构未列出 middleware.ts / next.config.ts 等项目根目录文件位置 | §6 目录结构后新增"项目根目录文件（AR5-006 补充，Next.js 约定位置）"小节，列出 middleware.ts / next.config.ts / tsconfig.json / package.json / tailwind.config.ts | **已解决** | ①§6 已补充项目根目录文件清单，含 middleware.ts（P0，速率限制）+ next.config.ts（P0，安全头）；②与 §14.2 Phase 1 引入的文件一致；③与 §14.4 P0 项引用一致 |
| AR5-007 | 建议 | §14.3 LLMCaller 依赖遗漏 OpenAI SDK 和 models.config.ts，与 §7.1 不一致 | §14.3 Phase 2 LLMCaller 依赖改为"Phase 1 types + models.config.ts + OpenAI SDK + Phase 3 Prompt 占位，与 §7.1 一致" | **已解决** | ①§14.3 LLMCaller 依赖已补充 models.config.ts + OpenAI SDK；②显式标注"与 §7.1 一致"；③与 §7.1"LLMCaller 依赖 OpenAI SDK, gesp6-skill.md, models.config.ts"一致 |
| AR5-008 | 建议 | §14.5 Phase 2→3 门槛仅列 HtmlParser/CodeValidator/HtmlCache 单元测试，未明确 LLMCaller/ProblemFetcher/ImageRecognizer 测试要求 | Phase 2→3 门槛补充"LLMCaller（mock OpenAI SDK）/ProblemFetcher（mock fetch）/ImageRecognizer（mock LLMCaller）单元测试通过" | **已解决** | ①Phase 2→3 门槛已补充 3 个涉及外部服务的接口单元测试说明，明确 mock 策略；②与 §14.2 Phase 2 阶段输出"接口层单元测试通过"一致；③与 AR5-010 修订的 Phase 2 单元测试范围一致 |
| AR5-009 | 建议 | §14.6 描述附录评审状态"v1.1（in-review），已完成 r1 评审 + 修订，待 r2 评审"，职责越界且文件不存在 | §14.6 移除附录评审状态描述，改为"当前状态：待生成（不在本架构文档 approved 的阻塞路径上）"；补充"生成时机：本架构文档 approved 后，由 nextjs-spec-generator 按 §4.1 spec 生成流程单独生成与评审" | **已解决** | ①§14.6 已移除"v1.1/r1/r2"等评审状态描述；②改为"待生成"，与磁盘状态一致；③明确附录生成后由附录自身维护版本与状态，不再越界 |
| AR5-010 | 建议 | §14.2 Phase 2 与 Phase 7 均列单元测试，职责重叠，开发 agent 不确定单元测试在哪阶段完成 | §14.2 备注新增"单元测试职责边界（AR5-010 修订）：Phase 2 单元测试覆盖接口层（6 个接口，外部服务用 mock）；Phase 7 单元测试覆盖编排层（FixedLoopOrchestrator），与 Phase 2 不重叠" | **部分解决** | ①§14.2 备注已明确 Phase 2（接口层）vs Phase 7（编排层）单元测试职责边界；②但 §14.5 Phase 4→5 门槛仍保留"编排层单元测试通过"，与"Phase 7 单元测试覆盖编排层"矛盾（详见 AR6-001）；③AR5-010 修订本身方向正确，但未同步更新 Phase 4→5 门槛，引入新不一致 |

**r5 修订到位性统计**：
- 已解决：9 项（AR5-001 ~ AR5-009）
- 部分解决：1 项（AR5-010：职责边界已明确，但未同步修正 Phase 4→5 门槛，引入新不一致）
- 未解决：0 项

---

## 二、v1.7 新引入问题检查

### 2.1 检查方法

1. 逐行比对 v1.7 §14 + §6 新增内容与 r5 评审意见修订建议的对应关系
2. 核查修订过程中是否产生新的引用失效、新的章节间不一致、新的模糊表述
3. 通过 Glob/Read 工具验证关键事实（如 /api/health 是否已存在、docs/specs/ 目录状态）

### 2.2 关键事实核查

| 核查项 | 方法 | 结果 |
|--------|------|------|
| /api/health 是否已存在 | Glob `app/api/health/**` + Read route.ts | **已存在**，返回 `{ status: 'ok', timestamp: string }`，符合 FR-020。§14.3 Phase 5"Route Handler /api/health（已存在，仅验证）"描述准确 |
| 实施附录是否存在 | Glob `docs/specs/**` | **不存在**，docs/specs/ 目录为空。§14.6"待生成"描述准确 |
| package.json 技术选型 | Read package.json | cheerio ^1.2.0、lru-cache ^11.5.1、openai ^4.77.0、zod ^3.24.1 均已安装，与 §3.1 技术栈一致 |

### 2.3 新引入问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR6-001 | §14.5 Phase 4→5 门槛 vs §14.2 AR5-010 修订备注 | **新不一致**：§14.5 Phase 4→5 门槛要求"FixedLoopOrchestrator.solve() 端到端可调用（mock LLM，真实 g++ 验证）；**编排层单元测试通过**"，但 §14.2 AR5-010 修订备注明确"**Phase 7 单元测试覆盖编排层**（FixedLoopOrchestrator），与 Phase 2 不重叠"。两处对"编排层单元测试归属阶段"表述矛盾：Phase 4→5 门槛要求进入 Phase 5 前编排层单元测试已通过，但 AR5-010 修订说编排层单元测试在 Phase 7 完成。开发 agent 无法判断编排层单元测试应在 Phase 4 还是 Phase 7 编写，Phase 4→5 门槛若严格执行会阻塞进入 Phase 5（因编排层单元测试按 AR5-010 应在 Phase 7 才写） | 重要 | 二选一：①若编排层单元测试归属 Phase 7（与 AR5-010 一致），将 Phase 4→5 门槛中"编排层单元测试通过"移除，改为"FixedLoopOrchestrator.solve() 端到端可调用（mock LLM，真实 g++ 验证）"，编排层单元测试统一在 Phase 7 完成并验收；②若 Phase 4 需要编排层基础测试（如端到端可调用的冒烟测试），将 Phase 4→5 门槛改为"FixedLoopOrchestrator.solve() 端到端可调用（mock LLM，真实 g++ 验证）；编排层冒烟测试通过（端到端调用验证，非完整单元测试）"，并相应调整 AR5-010 修订备注为"Phase 4 冒烟测试覆盖编排层端到端调用；Phase 7 单元测试覆盖编排层完整逻辑（含异常分支），与 Phase 2 不重叠"。推荐方案①，与 AR5-010 修订意图一致 |
| AR6-002 | §14.6 "架构文档自包含的实施指引"列表 | **遗漏**：§14.6 列出架构文档自包含的实施指引清单（§5.1/§5.2/§5.3/§5.4/§6/§7.1/§14.2/§14.3/§14.5），但遗漏 §14.4（P0/P1/P2 优先级映射表）。§14.4 定义了 P0/P1/P2 项与实施阶段、架构章节的映射关系，是开发 agent 编排任务优先级的关键依据，应纳入自包含指引清单 | 建议 | 在 §14.6"架构文档自包含的实施指引"列表中补充"- §14.4 P0/P1/P2 优先级映射（实施项与阶段、架构章节对照）" |
| AR6-003 | §14.2 备注（Phase 1 与 Phase 3 关系） | **表述歧义**：备注第一句"Prompt 占位文件在 Phase 1 创建"，第二句"Phase 2 LLMCaller 实施时由开发者创建空 Prompt 占位文件（若 Phase 1 未创建）"。两句对占位文件创建时机表述不一致——Phase 1 主要内容已明确列出占位文件，备注又说"若 Phase 1 未创建"由 Phase 2 创建，开发 agent 不确定 Phase 1 是否必须创建占位文件。虽然可理解为"Phase 1 为主、Phase 2 兜底"，但表述不够清晰 | 建议 | 将备注第一句明确为"Prompt 占位文件**必须**在 Phase 1 创建（空文件或 stub，让 LLMCaller 在 Phase 2 编译通过）"，移除"Phase 2 LLMCaller 实施时由开发者创建空 Prompt 占位文件（若 Phase 1 未创建）"的兜底表述；或保留兜底但改为"**若 Phase 1 遗漏**，Phase 2 LLMCaller 实施时须先补建空 Prompt 占位文件再编码"，明确 Phase 1 为唯一创建时机、Phase 2 仅为遗漏补救 |

### 2.4 新引入问题统计

| 严重程度 | 数量 | 编号 |
|---------|------|------|
| 阻塞 | 0 | — |
| 重要 | 1 | AR6-001 |
| 建议 | 2 | AR6-002、AR6-003 |
| 合计 | 3 | — |

---

## 三、§14 整体一致性检查

| 检查项 | 检查结论 |
|--------|---------|
| §14.2 / §14.3 / §14.4 / §14.5 接口数量一致 | ✅ 一致：Phase 2 均为 6 个接口（HtmlParser/CodeValidator/HtmlCache/LLMCaller/ProblemFetcher/ImageRecognizer），Orchestrator 在 Phase 4（第 7 个接口） |
| §14.2 Phase 5 与 §14.3 Phase 5 / §14.5 Phase 5→6 门槛一致 | ✅ 一致：/api/solve + /api/health 均在 Phase 5；门槛要求 POST /api/solve 返回 ServiceResult、GET /api/health 返回 200 |
| §14.4 P0/P1/P2 映射与 §14.2 Phase 阶段一致 | ✅ 一致：P0 项均在 Phase 1，P1 项分布在 Phase 1-7，P2 项在 MVP 后 |
| §14.5 Phase 1→2 门槛与 §14.2 Phase 1 输出一致 | ✅ 一致：5 个配置/类型文件（middleware/next.config/platforms.config/models.config/types）+ 3 个 Prompt 占位文件 |
| §14.5 Phase 2→3 门槛与 §14.2 Phase 2 输出一致 | ✅ 一致：6 个接口单例 + 接口层单元测试（含 mock）+ 单飞模式生效 |
| §14.5 Phase 4→5 门槛与 AR5-010 修订备注一致 | ❌ **不一致**：Phase 4→5 门槛要求"编排层单元测试通过"，AR5-010 修订说"Phase 7 单元测试覆盖编排层"（详见 AR6-001） |
| §14.6 附录描述与磁盘状态一致 | ✅ 一致：附录"待生成"，docs/specs/ 目录确无该文件 |
| §14.3 /api/health"已存在"描述与磁盘状态一致 | ✅ 一致：app/api/health/route.ts 已存在，返回 { status, timestamp } |
| §6 项目根目录文件与 §14.2 Phase 1 一致 | ✅ 一致：middleware.ts / next.config.ts 均在 §6 与 §14.2 Phase 1 中列出 |

---

## 四、可实施性评估

| 评估项 | 结论 |
|--------|------|
| 开发 agent 能否据 v1.7 §14 直接编排开发任务 | **基本可以**，但 AR6-001 会造成编排层单元测试时机困惑 |
| Phase 1-7 依赖关系是否清晰无循环 | ✅ 清晰：Phase 1→2→3→4→5→6→7 单向依赖，Phase 2↔Phase 3 循环已由占位文件打破 |
| 阶段验收门槛是否可执行检查 | ✅ 多数可执行（tsc/lint/接口调用/单飞验证），仅 AR6-001 影响门槛一致性 |
| P0/P1/P2 优先级是否覆盖所有实施项 | ✅ 覆盖：P0（3 项）+ P1（11 项）+ P2（3 项），含 /api/health 独立项 |
| 架构文档自包含性（无需依赖附录） | ✅ §5 + §6 + §7.1 + §14.2/§14.3/§14.5 提供完整实施指引，仅 §14.4 未列入指引清单（AR6-002） |

---

## 五、问题数量统计

| 严重程度 | r5 遗留 | v1.7 新引入 | 合计 |
|---------|---------|------------|------|
| 阻塞 | 0 | 0 | 0 |
| 重要 | 0 | 1（AR6-001） | 1 |
| 建议 | 0 | 2（AR6-002、AR6-003） | 2 |
| 合计 | 0 | 3 | 3 |

---

## 六、评审总结

### 6.1 r5 修订到位性

v1.7 对 r5 评审意见的修订整体到位：10 项问题中 9 项已完全解决，1 项部分解决（AR5-010）。阻塞级问题 AR5-001（实施附录引用失效）已彻底解决——§14.4 改为引用架构本身章节，§14.6 移除不实状态描述，开发 agent 可据架构文档自身完成实施，不再阻塞于附录生成。

### 6.2 核心问题

v1.7 修订过程中引入 1 项重要级新问题：

**AR6-001（重要）**：AR5-010 修订新增"Phase 7 单元测试覆盖编排层"的职责边界说明，但未同步更新 §14.5 Phase 4→5 门槛中既有的"编排层单元测试通过"表述。两处对编排层单元测试的归属阶段产生矛盾，开发 agent 无法判断编排层单元测试应在 Phase 4 还是 Phase 7 编写。该问题不影响架构设计本身的正确性，但影响实施路径的可执行性。

### 6.3 修订方向

1. **优先解决 AR6-001**：统一编排层单元测试归属阶段。推荐方案①——Phase 4→5 门槛移除"编排层单元测试通过"，编排层单元测试统一在 Phase 7 完成，与 AR5-010 修订意图一致
2. **建议采纳 AR6-002**：§14.6 自包含指引清单补充 §14.4
3. **建议采纳 AR6-003**：§14.2 备注明确 Phase 1 为 Prompt 占位文件唯一创建时机

### 6.4 评审结论

**需修订**。存在 1 项重要级问题（AR6-001：编排层单元测试归属阶段矛盾），不满足"通过"条件。修订建议如下：
- 重要级问题 AR6-001 必须解决
- 建议级问题 AR6-002、AR6-003 酌情采纳

修订后版本号更新为 v1.8，进入 r7 评审（或若无新阻塞/重要问题，可进入 §4.2.4 终审）。

### 6.5 是否可进入终审（§4.2.4）

**否**。存在 1 项重要级问题未解决，需修订为 v1.8 后重新评审。待 AR6-001 解决且无新阻塞/重要问题，方可进入 §4.2.4 终审。
