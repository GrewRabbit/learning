# GESP6 解题网页生成器架构设计 第 5 轮评审意见

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.6，状态 in-review）
**评审范围**：仅评审 v1.6 新增的 §14 实施路径章节（行 703-803），以及 §14 与 §1-§13 的一致性；§1-§13 在 v1.5 已 approved，仅核查 §14 是否与现有章节冲突
**评审时间**：2026-06-29
**评审结论**：需修订（存在 1 项阻塞级问题）

---

## 一、8 维度检查结论

| # | 维度 | 检查结论 |
|---|------|---------|
| 1 | §14 与 §1-§13 一致性 | 部分不一致：§14.2 Phase 1 引入的 middleware.ts/next.config.ts 在 §6 目录结构未列出；§14.4 映射表未覆盖 §6 的 /api/health；其余依赖关系与 §4.2/§7.1 基本一致 |
| 2 | P0/P1/P2 优先级标签合理性 | 标签定义清晰，"P 表示 Priority 非 Phase"提示充分；映射表基本覆盖架构模块，但 /api/health 端点缺失优先级标签 |
| 3 | 7 阶段实施路径完整性 | Phase 1-7 覆盖所有 P0/P1 项，无循环依赖（通过占位文件打破 Phase 2↔Phase 3 循环）；但占位文件创建时机未明确，存在执行模糊 |
| 4 | 模块依赖关系图正确性 | §14.3 依赖图与 §7.1 基本一致，但 LLMCaller 依赖遗漏 OpenAI SDK 和 models.config.ts；FixedLoopOrchestrator 依赖未包含 models.config.ts |
| 5 | 阶段验收门槛可检查性 | 多数门槛可执行检查（命令/行为），但 Phase 2→3 门槛"7 个接口"与实际 6 个不符；Phase 3→4 门槛"Promise 单飞生效"错误关联 LLMCaller |
| 6 | Phase 1 与 Phase 3 关系处理 | 占位文件策略基本可行，但占位文件创建时机与责任方未明确；"让 Phase 2 通过编译"表述不精确（LLMCaller 运行时 readFile，编译期不依赖文件存在） |
| 7 | 实施附录引用准确性 | **阻塞**：§14.4 表"实施细节文档"列引用 spec-gesp6-impl-p0p1-v1.0.md 的 §2.1/§2.2/§2.3/§3.1.1/§3.1.2/§3.2/§3.3/§3.4/§3.5/§3.6/§3.7 等章节，§14.6 也明确引用该文件并描述状态，但该文件在 docs/specs/ 目录下实际不存在，无法核对引用准确性 |
| 8 | 可实施性 | §14 整体结构清晰，但因附录不存在、占位时机不明、门槛表述错误等问题，开发 agent 无法直接据 §14 编排开发任务，需修订后再实施 |

---

## 二、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR5-001 | §14.4 表"实施细节文档"列 + §14.6 | 实施附录文件 spec-gesp6-impl-p0p1-v1.0.md 实际不存在（docs/specs/ 目录为空，Glob/LS 均未找到）。§14.4 表中 11 个 P0/P1 项引用该附录的 §2.1/§2.2/§2.3/§3.1.1/§3.1.2/§3.2/§3.3/§3.4/§3.5/§3.6/§3.7 章节号无法核对；§14.6 进一步描述附录"当前版本 v1.1（in-review），已完成 r1 评审 + 修订，待 r2 评审"，但文件根本不存在，状态描述不实。导致开发 agent 无法获取代码骨架，§14 实施路径无法落地 | 阻塞 | 三选一：①先创建实施附录文件并补充各章节内容，确保引用章节号实际存在；②若附录尚未生成，在 §14.4/§14.6 中明确标注"附录待生成"，移除具体章节号引用，改为引用架构本身章节（如 §5/§6）；③移除 §14.6 中"当前版本 v1.1（in-review），已完成 r1 评审 + 修订，待 r2 评审"的不实描述，仅保留"文档路径"与"与架构文档关系"说明 |
| AR5-002 | §14.2 Phase 2 阶段输出 + §14.5 Phase 2→3 门槛 | §5.1 定义 7 个核心接口（LLMCaller/HtmlParser/CodeValidator/Orchestrator/ProblemFetcher/ImageRecognizer/HtmlCache），但 §14.2 Phase 2 实际只实现 6 个（Orchestrator 在 Phase 4 实现，见 §14.3）。§14.2 Phase 2 阶段输出"7 个接口单例可独立调用"与 §14.5 Phase 2→3 门槛"7 个接口单例可独立调用"均与 §14.3 Phase 2 实际列出的 6 个接口不一致，会让开发 agent 误以为 Phase 2 要实现 Orchestrator | 重要 | 将 §14.2 Phase 2 阶段输出和 §14.5 Phase 2→3 门槛中的"7 个接口"改为"6 个接口（Orchestrator 除外，Orchestrator 在 Phase 4 实现）" |
| AR5-003 | §14.5 Phase 3→4 门槛 | 门槛描述"LLMCaller.generate 可加载 gesp6-skill.md（Promise 单飞生效）"将"Promise 单飞"与 LLMCaller 关联。但根据 §7.1 和 §8.2，单飞模式存在于 HtmlCache.getOrCompute 与 ProblemFetcher（LuoguFetcher/YoudaoFetcher），LLMCaller 本身无单飞机制。Phase 3 门槛应聚焦 Prompt 加载能力，单飞验收应在 Phase 2（HtmlCache/ProblemFetcher 接口） | 重要 | ①将 Phase 3→4 门槛改为"LLMCaller.generate 可加载 gesp6-skill.md 并返回 LLMOutput"；②将"单飞生效"验收移至 Phase 2→3 门槛，补充"HtmlCache.getOrCompute 与 ProblemFetcher 单飞模式生效（并发同 key 请求复用同一 Promise）" |
| AR5-004 | §14.2 备注 + §14.3 Phase 2 LLMCaller 依赖 | §14.2 备注说明"Phase 2 的 LLMCaller 实现需依赖 Prompt 文件路径，实施时可先用占位文件让 Phase 2 通过编译，Phase 3 再填充 Prompt 文本"，但占位文件应在哪个阶段、由谁创建未明确。§14.2 Phase 1 主要内容（middleware.ts/next.config.ts/platforms.config.ts/models.config.ts/types.ts）未包含创建 Prompt 占位文件；§14.3 Phase 2 又说 LLMCaller 依赖"Phase 3 Prompt 占位"，职责归属不清。若 Phase 2 实施时才创建，则 LLMCaller 实现与占位文件创建职责混淆 | 重要 | 在 §14.2 Phase 1 主要内容中明确增加"创建 Prompt 占位文件（app/lib/ai/prompts/gesp6-skill.md、fix-prompt-template.ts、image-recognition-prompt.md 空文件或 stub）"，或在 §14.2 备注中明确"Phase 2 LLMCaller 实施时由开发者先创建空 Prompt 占位文件，Phase 3 再填充文本" |
| AR5-005 | §14.4 P0/P1/P2 优先级映射表 | §6 目录结构列出 `app/api/health/route.ts`（对应 FR-020），§14.2 Phase 5 也提到"/api/health 验证"，但 §14.4 映射表未单独列出 /api/health 的优先级标签。§14.4 P1 行"接入层 Route Handler"引用"架构 §5.3"，而 §5.3 仅覆盖 /api/solve 的 Route Handler API 与 Zod schema，不包含 /api/health。FR-020 是独立功能需求，应在映射表中有明确落点 | 重要 | 在 §14.4 映射表 P1 项中增加独立行"/api/health 端点 \| Phase 5 \| 架构 §6 + FR-020"，或将 P1"接入层 Route Handler"行修订为"接入层 Route Handler（/api/solve + /api/health）\| Phase 5 \| 架构 §5.3 + §6 + FR-020" |
| AR5-006 | §14.2 Phase 1 vs §6 目录结构 | §14.2 Phase 1 引入 middleware.ts（速率限制，见 §8.2）和 next.config.ts（安全头，见 §14.4 P0），但 §6 目录结构未列出这两个文件路径。dev-workflow.md §五提及 middleware.ts 用于路由保护，但 §6 未明确文件位置，导致 §14 与 §6 不一致，开发 agent 不确定文件应放置何处 | 建议 | 在 §6 目录结构中补充 `middleware.ts`（项目根目录，Next.js 约定）和 `next.config.ts`（项目根目录）的位置说明，与 §14.2 Phase 1 保持一致 |
| AR5-007 | §14.3 Phase 2 LLMCaller 依赖 | §14.3 描述 LLMCaller 依赖"Phase 1 types + Phase 3 Prompt 占位"，但 §7.1 LLMCaller 依赖"OpenAI SDK、gesp6-skill.md、models.config.ts（按环境变量 LLM_MODEL 选取）"。§14.3 漏掉了 OpenAI SDK（运行时必需）和 models.config.ts（模型能力选取）依赖，与 §7.1 不一致 | 建议 | 将 §14.3 LLMCaller 依赖改为"Phase 1 types + models.config.ts + OpenAI SDK + Phase 3 Prompt 占位"，与 §7.1 保持一致 |
| AR5-008 | §14.5 Phase 2→3 门槛 | 门槛只列出"HtmlParser / CodeValidator / HtmlCache 单元测试通过"，但 §14.2 Phase 2 阶段输出说"单元测试通过"暗示所有接口都有单元测试。LLMCaller/ProblemFetcher/ImageRecognizer 涉及外部服务（LLM API/网络/g++），其单元测试（用 mock）未在门槛中明确，开发 agent 不确定是否需要覆盖 | 建议 | 在 Phase 2→3 门槛中补充"LLMCaller（mock OpenAI SDK）/ProblemFetcher（mock fetch）/ImageRecognizer（mock LLMCaller）单元测试通过"，或明确说明这些接口的测试在 Phase 7 集成测试覆盖 |
| AR5-009 | §14.6 实施附录状态描述 | §14.6 描述实施附录"当前版本 v1.1（in-review），已完成 r1 评审 + 修订，待 r2 评审"。一方面文件实际不存在（见 AR5-001），状态描述不实；另一方面架构评审文件不应描述附录的评审状态（附录状态由附录自身维护），职责越界 | 建议 | 移除 §14.6 中附录评审状态描述，仅保留"文档路径"和"与架构文档关系"说明；附录实际生成后由附录自身维护版本与状态 |
| AR5-010 | §14.2 Phase 7 主要内容 vs §14.5 Phase 7 完成门槛 vs §14.3 Phase 7 | §14.2 Phase 7 主要内容"单元测试 + 集成测试 + E2E 测试"，§14.5 Phase 7 完成门槛"单元/集成/E2E 测试全绿"，§14.3 Phase 7 又说"单元测试（依赖 Phase 2 接口）/ 集成测试（依赖 Phase 4 编排层）/ E2E 测试（依赖 Phase 6 前端）"。但 §14.2 Phase 2 阶段输出已要求"单元测试通过"，Phase 7 又列单元测试，职责重叠，开发 agent 不确定单元测试在哪个阶段完成 | 建议 | 明确 Phase 2 单元测试范围（接口层：HtmlParser/CodeValidator/HtmlCache/LLMCaller/ProblemFetcher/ImageRecognizer）与 Phase 7 单元测试范围（编排层：FixedLoopOrchestrator）的边界；或 Phase 7 主要内容改为"集成测试 + E2E 测试 + 编排层单元测试"，避免与 Phase 2 职责重叠 |

---

## 三、问题数量统计

| 严重程度 | 数量 | 编号 |
|---------|------|------|
| 阻塞 | 1 | AR5-001 |
| 重要 | 4 | AR5-002、AR5-003、AR5-004、AR5-005 |
| 建议 | 5 | AR5-006、AR5-007、AR5-008、AR5-009、AR5-010 |
| 合计 | 10 | — |

---

## 四、评审总结

### 4.1 核心问题

本次评审聚焦 v1.6 新增的 §14 实施路径章节。§14 整体结构清晰（7 阶段 + P0/P1/P2 优先级 + 模块依赖图 + 阶段验收门槛），方向正确，但存在 1 项阻塞级问题：

**AR5-001（阻塞）**：§14.4 表"实施细节文档"列与 §14.6 均引用实施附录 `spec-gesp6-impl-p0p1-v1.0.md`，且 §14.6 描述附录"已完成 r1 评审 + 修订，待 r2 评审"，但该文件在 `docs/specs/` 目录下实际不存在。这导致：
- §14.4 表中 11 个 P0/P1 项引用的附录章节号（§2.1/§2.2/§2.3/§3.1.1/§3.1.2/§3.2/§3.3/§3.4/§3.5/§3.6/§3.7）无法核对准确性
- 开发 agent 无法依据 §14 直接获取代码骨架，实施路径无法落地
- §14.6 的附录状态描述不实，违反 P8（版本一致：引用文件路径必须与磁盘实际状态一致）

### 4.2 重要问题

4 项重要问题集中在阶段验收门槛与实施路径的精确性：
- AR5-002：Phase 2→3 门槛"7 个接口"与实际 6 个（Orchestrator 在 Phase 4）不符
- AR5-003：Phase 3→4 门槛"Promise 单飞生效"错误关联 LLMCaller（单飞属 HtmlCache/ProblemFetcher）
- AR5-004：Prompt 占位文件创建时机与责任方未明确
- AR5-005：§14.4 映射表未覆盖 /api/health 端点（FR-020 独立需求）

### 4.3 修订方向

1. **优先解决 AR5-001**：三选一方案（创建附录 / 标注待生成并移除章节号引用 / 移除不实状态描述），建议采用方案②（标注"附录待生成"，引用改为架构本身章节），避免架构文件阻塞于附录生成
2. **修正门槛表述**：AR5-002、AR5-003、AR5-008 统一修正 Phase 2→3 与 Phase 3→4 门槛的接口数量、单飞归属、单元测试覆盖范围
3. **明确占位策略**：AR5-004 在 Phase 1 主要内容中增加创建 Prompt 占位文件
4. **补全映射表**：AR5-005 补充 /api/health 优先级标签

### 4.4 评审结论

**需修订**。存在 1 项阻塞级问题（AR5-001：实施附录文件不存在，引用失效），不满足"通过"条件。修订建议如下：
- 阻塞级问题 AR5-001 必须解决
- 重要级问题 AR5-002 ~ AR5-005 必须解决或给出不解决的理由
- 建议级问题 AR5-006 ~ AR5-010 酌情采纳

修订后版本号更新为 v1.7，进入 r6 评审。
