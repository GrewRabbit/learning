# C++ 编程培训辅助系统 评审意见 — 第 1 轮

**评审对象**：spec-cpp-training-assistant-v1.0.md
**评审时间**：2026-06-25
**评审结论**：需修订

---

## 一、评审维度结论

| 维度 | 结论 | 说明 |
|------|------|------|
| 1. 完整性 | 通过 | 模板必备章节齐全（变更记录/背景与目标/用户故事/功能需求/非功能需求/边界与排除项/验收标准）；FR-001~FR-031 连续；AC-001~AC-014 连续 |
| 2. 准确性 | 需修订 | SSE 流式输出在 Server Action 中的实现方式与 dev-workflow.md 规范存在冲突，未明确落地机制（R1-002） |
| 3. 可测试性 | 需修订 | 现有 AC 均可测试，但 FR-022/023/029/030/031 缺少对应 AC（R1-004） |
| 4. 边界清晰度 | 通过 | §5 明确列出 6 项"不做"和 3 项范围边界，边界清晰 |
| 5. 合规性 | 需修订 | MindmapSchema 代码示例引用未定义的 `MindmapNode`（R1-001）；错误码定义缺失（R1-005）；FlowchartSchema 缺少回边标记字段（R1-006） |
| 6. 一致性 | 需修订 | 多数 FR 有对应 AC，但 5 个 FR 缺 AC（R1-004）；图片识别 Server Action 位置与触发页面不一致（R1-008） |
| 7. 安全性 | 需修订 | API Key 管理合规；但标准答案文件上传缺少安全限制（R1-007）；LLM 输出安全处理未明确（R1-013） |
| 8. 逻辑清晰度 | 需修订 | AI 编排流程整体清晰，但 Stage 1 LLM 输出格式未明确，无法实现代码与分析的流式分流（R1-003）；SSE 事件缺少 Stage 2 部分失败事件（R1-009） |
| 9. 表述准确性 | 通过 | 术语使用准确，文档结构清晰，便于阅读 |

---

## 二、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R1-001 | §7.6 思维导图 Schema | MindmapSchema 代码示例中 `children: z.array(z.lazy(() => MindmapNode)).optional()` 引用了未定义的 `MindmapNode`，会导致 TypeScript 编译错误，误导开发实现 | 阻塞 | 先定义递归类型 `MindmapNodeSchema: z.ZodType<MindmapNode>`，再组合为 `MindmapSchema`。示例：`export const MindmapNodeSchema: z.ZodType<MindmapNode> = z.object({ id: z.string(), label: z.string(), explanation: z.string(), children: z.lazy(() => z.array(MindmapNodeSchema)).optional() }); export const MindmapSchema = z.object({ root: MindmapNodeSchema });`，并同步导出 `MindmapNode` 类型 |
| R1-002 | §7.2 技术栈 / §7.1 系统架构 / §7.5 SSE 事件设计 | 技术栈表中"流式输出 \| Server Actions + ReadableStream（SSE）"与 dev-workflow.md"优先 Server Actions，避免 API Routes"及 api-conventions.md 中 Server Action 标准模式（useActionState + form action）存在冲突。Server Action 返回 ReadableStream 时前端不能用 useActionState，需手动 fetch 消费，spec 未明确这一机制 | 阻塞 | 明确分流策略：(1) SSE 流式输出（generateSolution）使用 Route Handler（如 `app/api/solution/route.ts`）实现，前端用 fetch + EventSource 消费；(2) 非流式操作（recognizeImage）用标准 Server Action + useActionState。在 §7.2 技术栈表和 §7.8 组件结构中同步更新，说明 SSE 走 Route Handler 是对"优先 Server Actions"规范的合理例外（流式场景） |
| R1-003 | §3.2 FR-006/FR-007 / §7.5 SSE 事件设计 | FR-006 要求"单次调用生成代码+分析"，FR-007 要求"逐 token 推送代码与分析"，§7.5 设计了 `code-chunk` 和 `analysis-chunk` 两个事件，但 spec 未明确 LLM 单次调用的输出格式如何区分代码部分与分析部分，前端无法实现分流 | 阻塞 | 在 §7.3 或 §7.6 补充 Stage 1 LLM 输出协议：明确 LLM 输出带结构化标记的文本（如 `<<<CODE>>>\n...\n<<<ANALYSIS>>>\n...`），服务层流式解析标记后分别推送 `code-chunk` 和 `analysis-chunk` 事件；或在 prompts/solution-prompt.ts 中定义输出模板，并在 spec 中说明解析规则 |
| R1-004 | §6 验收标准 | 5 个 FR 缺少对应 AC：FR-022（hover 边显示 explanation）、FR-023（缩放/平移/小地图/自适应视口）、FR-029（层级视觉区分）、FR-030（Tab 切换）、FR-031（流式 Tab 状态） | 重要 | 补充 AC-015~AC-019 覆盖上述 FR：AC-015 hover 流程图边显示 explanation tooltip；AC-016 流程图支持缩放/平移/小地图/自适应视口；AC-017 思维导图根节点与子节点视觉层级区分（字号/背景递减）；AC-018 四个输出通过 Tab 切换；AC-019 流式生成中已就绪 Tab 可查看、未就绪 Tab 显示加载状态 |
| R1-005 | §4.2 可靠性 / §7 架构设计 | NFR-007 要求返回 `ServiceResult<T>` 格式，但 spec 全文未定义任何具体错误码，违反 api-conventions.md"错误码格式 MODULE_CATEGORY_SPECIFIC"要求 | 重要 | 在 §7 新增"错误码定义"小节，列出关键错误码：`AI_VISION_RECOGNITION_FAILED`、`AI_SOLUTION_GENERATION_FAILED`、`AI_FLOWCHART_GENERATION_FAILED`、`AI_MINDMAP_GENERATION_FAILED`、`AI_JSON_VALIDATION_FAILED`、`AI_LLM_TIMEOUT`、`INPUT_VALIDATION_ERROR`，并说明各错误的触发场景与返回 message |
| R1-006 | §7.6 流程图 Schema | FR-021 要求"loop 回边用虚线"，但 FlowchartSchema 的 edges 定义缺少标记回边的字段，前端无法识别哪些边是回边并渲染虚线 | 重要 | 在 edges schema 中添加 `isBackEdge: z.boolean().optional()` 字段（或 `style: z.enum(['solid', 'dashed']).optional()`），并在 §7.9 或 §7.6 说明回边判定规则（如 target 在 source 之前出现则为回边） |
| R1-007 | §3.1 FR-004 / §4.3 安全 NFR-010 | FR-004 允许"上传 .cpp/.txt 文件补充标准答案"，但 NFR-010 仅规定图片上传限制（jpg/png/webp ≤ 10MB），未规定标准答案文件上传的类型与大小限制；FR-001 文本输入也未规定长度上限 | 重要 | 在 NFR-010 补充：标准答案文件上传限制为 `.cpp`/`.txt`/`.h`/`.hpp`，大小 ≤ 1MB；题目文本长度上限（如 ≤ 10000 字符）；标准答案文本长度上限（如 ≤ 20000 字符）。在 FR-001/FR-004 中同步标注长度限制 |
| R1-008 | §7.8 前端组件结构 | `recognizeImage` 放在 `app/[locale]/solution/actions.ts`，但图片识别在首页（`app/[locale]/page.tsx`）触发，首页不在 solution 目录下，违反 api-conventions.md"页面专属 Action 放同目录 actions.ts"约定 | 重要 | 将 `recognizeImage` 移至 `app/[locale]/actions.ts`（首页同目录），`generateSolution` 保留在 `app/[locale]/solution/actions.ts`（或改为 Route Handler，见 R1-002）。更新 §7.8 组件结构说明 |
| R1-009 | §7.5 SSE 事件设计 | FR-009 要求"Stage 2 两个调用独立容错"，但 §7.5 的 SSE 事件仅有单一 `event: error`，无法表达"流程图失败但思维导图成功"的部分失败场景，前端无法对失败部分单独显示重试按钮 | 重要 | 补充部分失败事件：`event: flowchart-error`（携带错误码与 message，前端对流程图区显示重试按钮）、`event: mindmap-error`（同理）；或将 `event: error` 改为携带 `module` 字段（`flowchart`/`mindmap`/`stage1`）区分失败模块。`event: done` 仍表示全部已结束（含部分失败） |
| R1-010 | §10 依赖与前置条件 / 环境变量 | spec 列出环境变量但未要求验证机制，违反 env-management.md"推荐在构建前验证必需的环境变量"建议。若 API Key 缺失，运行时才报错，不利于早期发现 | 重要 | 在 §10 补充：新增 `app/lib/env.ts`，启动时验证必需环境变量（`AI_VISION_PROVIDER`、`AI_VISION_MODEL`、`AI_TEXT_PROVIDER`、`AI_TEXT_MODEL`、对应 provider 的 API Key 与 BASE_URL），缺失时抛出明确错误 |
| R1-011 | §7.7 服务层结构 | api-conventions.md 要求"服务层单例导出 `export const userService = new UserService()`"，spec 未说明各 AI 服务的导出方式 | 建议 | 在 §7.7 服务层结构说明中补充："各服务以单例方式导出，如 `export const solutionService = new SolutionService()`，禁止懒加载函数式导出" |
| R1-012 | §4 非功能需求 / §7 架构设计 | dev-workflow.md 要求日志规范（应用日志用 logger、客户端用 logClientError），spec 未提及 AI 服务调用的日志记录要求，不利于排查 LLM 调用问题 | 建议 | 补充 NFR：AI 服务调用记录应用日志（logger.info 记录调用开始/结束与耗时，logger.error 记录失败），日志内容包含模型名、调用耗时、token 用量（如可获取），禁止日志输出完整 Prompt 中的用户敏感内容；客户端错误用 logClientError |
| R1-013 | §4.3 安全 | LLM 生成的代码与分析内容会展示给用户，spec 未明确 XSS 防护策略。虽 Shiki 服务端渲染与 react-markdown 默认转义，但应显式声明 | 建议 | 在 NFR 中补充：LLM 输出的代码通过 Shiki 服务端渲染（自动转义 HTML），分析通过 react-markdown 渲染（默认转义），禁止使用 `dangerouslySetInnerHTML` 直接渲染 LLM 输出 |
| R1-014 | 整个文件 | spec 文件当前 483 行，接近 500 行上限。本轮修订需新增 AC、错误码、环境变量验证等内容，修订后大概率超限 | 建议 | 方案一：将 §7~§10 架构设计内容拆分为独立架构设计文档（`docs/architecture/arch-cpp-training-assistant-v1.0.md`），spec 仅保留 §1~§6 需求部分；方案二：在 §5 边界与排除项说明"架构设计章节将在 approved 后拆分为独立架构文档"。推荐方案一，符合 spec-workflow.md 中 spec 与架构设计分离的原则 |
| R1-015 | §7.6 思维导图 Schema | FR-025/FR-029 涉及层级（depth）概念，但 MindmapSchema 无层级字段，未说明层级如何获取 | 建议 | 在 §7.6 Schema 说明中注明："层级 depth 由前端遍历树结构计算（根节点 depth=0），不需要 schema 字段；前端根据 depth 控制默认展开（depth<3 展开）与视觉样式" |
| R1-016 | §7.8 前端组件结构 | dev-workflow.md 要求 Layout 拆分为 `layout.tsx`（Server）+ `layout-client.tsx`（Client），spec 未提及 layout 结构 | 建议 | 在 §7.8 补充 `app/[locale]/layout.tsx`（Server Component，仅渲染）与 `app/[locale]/layout-client.tsx`（Client Component，处理交互）的说明，MVP 阶段 layout-client 可简化但结构应预留 |
| R1-017 | §10 依赖与前置条件 | deployment-checklist.md 提到健康检查端点（`/api/health`），spec 未提及。虽 MVP 不做高并发，但健康检查有助于部署验证 | 建议 | 在 §10 补充（可选）：新增 `/api/health` 健康检查端点，返回 `{ status: 'ok', timestamp }`，用于部署后验证服务可用性 |

---

## 三、评审总结

### 核心问题

本轮评审发现 **3 个阻塞级问题**，均集中在架构设计的可落地性：

1. **MindmapSchema 代码错误**（R1-001）：递归类型 `MindmapNode` 未定义，代码示例无法编译，会直接误导开发实现。

2. **SSE 实现机制未明确**（R1-002）：spec 选择"Server Actions + ReadableStream"实现 SSE，但与项目规范"优先 Server Actions"及 Server Action 标准模式（useActionState + form action）冲突。需明确 SSE 走 Route Handler（合理例外）还是 Server Action 返回 Response（前端手动 fetch），并说明与非流式操作的分工。

3. **Stage 1 LLM 输出格式缺失**（R1-003）：FR-006 要求单次调用生成代码+分析，FR-007 要求流式分流推送，但 spec 未定义 LLM 输出如何区分代码与分析部分，导致 `code-chunk` 与 `analysis-chunk` 事件无法实现分流。这是核心功能的实现缺口。

### 其他重要问题

- **FR-AC 对应缺失**（R1-004）：5 个 FR 无对应 AC，验收标准不完整。
- **错误码定义缺失**（R1-005）：违反 api-conventions.md 错误码规范。
- **Schema 字段缺失**（R1-006）：FlowchartSchema 无法支持回边虚线渲染。
- **安全限制不完整**（R1-007）：标准答案文件上传与文本输入缺少限制。
- **Server Action 位置错误**（R1-008）：recognizeImage 与触发页面不在同目录。
- **SSE 部分失败事件缺失**（R1-009）：无法支持 FR-009 独立容错的前端展示。
- **环境变量验证缺失**（R1-010）：运行时才报错，不利于早期发现。

### 修订方向

1. 修复 MindmapSchema 递归类型定义（R1-001）
2. 明确 SSE 走 Route Handler，非流式走 Server Action，更新技术栈表与组件结构（R1-002、R1-008）
3. 补充 Stage 1 LLM 输出协议与解析规则（R1-003）
4. 补充 AC-015~AC-019 覆盖遗漏 FR（R1-004）
5. 新增错误码定义小节（R1-005）
6. 补充 FlowchartSchema 回边字段（R1-006）
7. 补充标准答案文件与文本输入安全限制（R1-007）
8. 补充 SSE 部分失败事件（R1-009）
9. 补充环境变量验证机制（R1-010）
10. 酌情采纳建议级问题（R1-011~R1-017）

### 问题数量统计

- 阻塞：3
- 重要：7
- 建议：7
- 合计：17

### 评审结论

**需修订**。存在 3 个阻塞级问题，须在修订版 v1.1 中全部解决；7 个重要级问题须解决或给出不解决的理由；7 个建议级问题酌情采纳。修订后进入第 2 轮评审。
