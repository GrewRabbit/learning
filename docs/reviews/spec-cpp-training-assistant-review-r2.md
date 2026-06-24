# C++ 编程培训辅助系统 评审意见 — 第 2 轮

**评审对象**：spec-cpp-training-assistant-v1.0.md（文件内部版本号 v1.1）
**评审时间**：2026-06-25
**评审结论**：需修订

---

## 一、r1 阻塞问题解决核查

| r1 编号 | 问题 | 核查结果 | 说明 |
|---------|------|---------|------|
| R1-001 | MindmapSchema 递归类型未定义 | 已解决 | §7.6 采用"先声明 `MindmapNode` 类型 → `z.ZodType<MindmapNode>` 标注 → `z.lazy(() => z.array(MindmapNodeSchema))` 递归引用"模式，代码可编译，递归说明清晰 |
| R1-002 | SSE 实现机制与规范冲突 | 已解决 | §7.1/7.2/7.8 明确分流：SSE 走 Route Handler（`app/api/solution/route.ts`），非流式走 Server Action；§7.1 说明是对"优先 Server Actions"的合理例外，理由充分 |
| R1-003 | Stage 1 LLM 输出格式缺失 | 基本解决 | §7.3.1 已定义 `<<<CODE>>>`/`<<<ANALYSIS>>>` 标记协议、状态机解析规则、标记缺失降级处理；但标记分片/重复/嵌套等边界场景未覆盖（见 R2-003） |

**r1 阻塞问题解决率**：3/3（其中 R1-003 基本解决但健壮性需进一步加强）。

## 二、r1 重要/建议问题解决核查

| r1 编号 | 问题 | 核查结果 | 说明 |
|---------|------|---------|------|
| R1-004 | FR-AC 对应缺失 | 已解决 | §6 补充 AC-015~AC-019，覆盖 FR-022/023/029/030/031 |
| R1-005 | 错误码定义缺失 | 已解决 | §7.11 新增错误码定义小节，列出 9 个错误码及触发场景（但格式有问题，见 R2-001） |
| R1-006 | FlowchartSchema 回边字段缺失 | 已解决 | §7.6 添加 `isBackEdge: z.boolean().optional()`，并补充回边判定规则说明 |
| R1-007 | 安全限制不完整 | 已解决 | NFR-010 补充标准答案文件上传限制（`.cpp`/`.txt`/`.h`/`.hpp` ≤ 1MB）与文本长度上限（题目 ≤ 10000 字符，标准答案 ≤ 20000 字符） |
| R1-008 | Server Action 位置错误 | 已解决 | §7.8 将 `recognizeImage` 移至 `app/[locale]/actions.ts`（首页同目录） |
| R1-009 | SSE 部分失败事件缺失 | 已解决 | §7.5 补充 `flowchart-error`/`mindmap-error` 事件，互不影响 |
| R1-010 | 环境变量验证缺失 | 已解决 | §10 新增 `app/lib/env.ts` 与 `validateEnv()` 函数（但健壮性不足，见 R2-005） |
| R1-011 | 服务层单例导出未说明 | 已解决 | §7.7 补充单例导出规范说明与正反例 |
| R1-012 | 日志规范缺失 | 已解决 | NFR-016 补充 AI 服务调用日志要求 |
| R1-013 | LLM 输出安全处理未明确 | 已解决 | NFR-017 补充 XSS 防护策略 |
| R1-014 | 文件行数超限 | 已解决 | §5.3 说明拆分计划（但 draft 状态下已超限，见 R2-013） |
| R1-015 | 思维导图 depth 字段未说明 | 已解决 | §7.6 补充 depth 由前端遍历计算的说明 |
| R1-016 | Layout 拆分未提及 | 已解决 | §7.8 补充 `layout.tsx`（Server）+ `layout-client.tsx`（Client）说明 |
| R1-017 | 健康检查端点缺失 | 已解决 | §10 新增 `app/api/health/route.ts` 健康检查端点 |

**r1 重要/建议问题解决率**：14/14（全部已妥善解决，部分修订引入新问题已在 R2 中列出）。

---

## 三、评审维度结论

| 维度 | 结论 | 说明 |
|------|------|------|
| 1. 完整性 | 通过 | r1 修订未引入新的缺失章节或编号断裂；FR-001~FR-031 连续；AC-001~AC-019 连续；NFR-001~NFR-017 连续 |
| 2. 准确性 | 需修订 | 错误码格式不符合 api-conventions.md（R2-001）；SSE Route Handler 与 NFR-007 的 `ServiceResult<T>` 要求存在矛盾（R2-002） |
| 3. 可测试性 | 通过 | 新增 AC-015~AC-019 均可验证 |
| 4. 一致性 | 需修订 | NFR-007 要求所有 Route Handler 返回 `ServiceResult<T>`，但 SSE Route Handler 无法一次性返回（R2-002）；§7.5 `event: error` 与 `event: done` 的关系不清晰（R2-008） |
| 5. 合规性 | 需修订 | 错误码格式违反 api-conventions.md（R2-001）；component-rules.md 合规性说明不足（R2-011） |
| 6. 健壮性 | 需修订 | Stage 1 LLM 输出协议未处理标记分片/重复/嵌套（R2-003）；SSE 实现细节缺失（R2-004） |
| 7. 专业性 | 通过 | 术语使用准确，文档结构清晰 |
| 8. 可操作性 | 需修订 | §9 实施路径验证标准不够具体（R2-010）；SSE 事件数据格式未说明（R2-004） |

---

## 四、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R2-001 | §7.11 错误码定义 | 错误码格式不符合 api-conventions.md 的 `MODULE_CATEGORY_SPECIFIC` 要求。`INPUT_VALIDATION_ERROR` 和 `INTERNAL_ERROR` 缺少 MODULE 前缀（api-conventions.md 示例为 `AUTH_LOGIN_INVALID_CREDENTIALS`、`USER_PROFILE_NOT_FOUND`、`LDAP_BIND_FAILED`，均为 3 段且首段为模块名）。`AI_*` 系列错误码虽有前缀，但 `AI` 作为 MODULE 过于宽泛，无法与项目其他模块错误码区分 | 重要 | 统一使用 `CPP_` 作为 MODULE 前缀（C++ 培训系统），修订为：`CPP_INPUT_VALIDATION_ERROR`、`CPP_AI_VISION_RECOGNITION_FAILED`、`CPP_AI_SOLUTION_GENERATION_FAILED`、`CPP_AI_SOLUTION_FORMAT_INVALID`、`CPP_AI_FLOWCHART_GENERATION_FAILED`、`CPP_AI_MINDMAP_GENERATION_FAILED`、`CPP_AI_JSON_VALIDATION_FAILED`、`CPP_AI_LLM_TIMEOUT`、`CPP_INTERNAL_ERROR`。同步更新 §7.5/§7.11 中所有引用处 |
| R2-002 | §4.2 NFR-007 / §7.1 / §7.11 | NFR-007 要求"所有 Server Action 与 Route Handler 包含 try-catch，返回 `ServiceResult<T>` 格式"，但 SSE 流式 Route Handler（`app/api/solution/route.ts`）是流式响应，无法一次性返回 `ServiceResult<T>`。§7.11 错误码使用约定虽区分了"SSE 事件携带 error.code/error.message"与"Server Action 返回 ServiceResult<T>"，但 NFR-007 表述与 §7.11 存在矛盾，开发实现时会产生歧义 | 重要 | 修订 NFR-007 为："所有 Server Action 与非流式 Route Handler 包含 try-catch，返回 `ServiceResult<T>` 格式；SSE 流式 Route Handler 通过 SSE 事件（`*-error`/`error`）携带错误信息，错误字段格式遵循 `ServiceResult<T>` 的 `error` 字段结构（`{ code, message }`）。禁止抛出未捕获异常。" 并在 §7.5 或 §7.11 补充说明 SSE Route Handler 是 NFR-007 中"返回 `ServiceResult<T>`"要求的合理例外（流式场景） |
| R2-003 | §7.3.1 Stage 1 LLM 输出协议 | 输出协议的健壮性不足，未覆盖以下边界场景：(1) **标记分片**：流式输出时 `<<<CODE>>>` 可能被分到多个 token（如 `<`、`<<CODE`、`>>>`），服务层需要缓冲区机制识别完整标记，spec 未说明；(2) **标记重复**：LLM 重复输出标记（如两次 `<<<CODE>>>`）时如何处理未定义；(3) **标记乱序/嵌套**：LLM 在 `<<<ANALYSIS>>>` 后又输出 `<<<CODE>>>` 时如何处理未定义；(4) **标记缺失降级 UI**：spec 说"全部作为 `analysis-chunk` 推送"，但代码区将为空，前端如何展示未说明 | 重要 | 在 §7.3.1 补充：(1) **缓冲区机制**：服务层维护标记缓冲区，当缓冲区内容可能是标记前缀（如 `<`、`<<`、`<<<`）时暂不推送，直到确认不是标记前缀或完整匹配标记；(2) **标记重复**：仅识别第一次出现的标记，后续重复标记作为普通文本推送；(3) **标记乱序**：状态机仅允许 `pending→code→analysis` 单向转换，`analysis` 状态后收到 `<<<CODE>>>` 视为普通文本；(4) **降级 UI**：标记缺失时代码区显示"代码生成异常，请重试"提示，并允许用户手动触发重试 |
| R2-004 | §7.5 SSE 事件设计 / §7.8 | SSE 实现关键细节缺失：(1) **事件数据格式未说明**：spec 列出了事件类型（如 `event: code-chunk`），但未说明 `data` 字段的具体格式（纯文本？JSON？字段结构？），开发实现时无法确定前后端数据契约；(2) **断线重连未说明**：POST 请求无法使用 EventSource 自动重连，连接中断后如何处理未定义；(3) **AbortController 未说明**：用户取消生成时前端如何中止 fetch、服务端如何停止 LLM 调用未定义 | 重要 | 在 §7.5 补充：(1) **事件数据格式**：明确每个事件的 data 字段格式，如 `code-chunk`/`analysis-chunk` 为 `data: {"content": "..."}\n\n`；`flowchart`/`mindmap` 为 `data: {完整 JSON}\n\n`；`flowchart-error`/`mindmap-error`/`error` 为 `data: {"code": "...", "message": "..."}\n\n`；`stage1-start`/`stage1-done`/`stage2-start`/`done` 为 `data: {}\n\n`；(2) **断线重连**：不自动重连，前端检测到连接中断后显示"连接中断，请重试"提示，由用户手动重新触发生成；(3) **AbortController**：前端通过 `AbortController` 中止 fetch，服务端在 Route Handler 中监听 `request.signal` 的 abort 事件，触发时停止 LLM 调用并关闭流 |
| R2-005 | §10 环境变量验证机制 | `validateEnv()` 健壮性不足：(1) **未验证 BASE_URL**：环境变量列表列出了 `GLM_BASE_URL` 等，但 `validateEnv()` 只校验了 provider 对应的 API Key，未校验 BASE_URL，BASE_URL 缺失会导致运行时才报错；(2) **调用时机表述模糊**：spec 说"首次调用 AI 服务层时执行（模块级调用）"，但模块级调用在模块加载时执行，若环境变量缺失会导致整个应用启动失败，而非仅 AI 功能不可用 | 建议 | (1) 在 `validateEnv()` 中根据 provider 动态校验对应的 BASE_URL（如 `GLM_BASE_URL`、`DEEPSEEK_BASE_URL` 等）；(2) 明确调用时机为"在 AI 服务层方法内部首次调用时执行 `validateEnv()`"（而非模块级调用），确保仅 AI 功能受影响，不影响健康检查等其他端点 |
| R2-006 | §7.6 FlowchartSchema | `codeRef` 和 `requirementRef` 字段格式未说明：(1) `codeRef` 是 `z.string().optional()`，FR-020 要求 hover 节点显示"对应代码行号"，但未说明格式（行号范围如 `"10-15"`？行号数组如 `"[10,11,12]"`？文件名+行号？）；(2) `requirementRef` 是 `z.string().optional()`，FR-019 要求节点显示"对应题目要求"徽章，但未说明格式（要求编号如 `"要求1"`？要求描述？） | 建议 | 在 §7.6 Schema 说明中补充字段格式约定：(1) `codeRef` 格式为行号范围字符串（如 `"10-15"` 表示第 10-15 行），无对应代码时省略；(2) `requirementRef` 格式为题目要求编号（如 `"R1"`、`"R2"`，由 LLM 根据题目要求自动编号），无对应要求时省略。前端据此渲染徽章 |
| R2-007 | §7.9 流程图节点类型 | (1) `end` 节点图标为 `Square`，与 `process` 节点图标相同，仅靠语义色（`--color-destructive`）区分，视觉辨识度不足；(2) `loop` 节点使用 `--color-info` 语义色，但 component-rules.md 的语义色对照表中未出现 `--color-info`，需确认是否为项目定义的语义变量 | 建议 | (1) 将 `end` 节点图标改为 `CircleStop` 或 `Octagon`（lucide-react 提供），与 `process` 节点视觉区分；(2) 确认 `--color-info` 是否在项目皮肤 DESIGN.md 中定义，若未定义则改用已定义的语义色（如 `--color-warning` 或新增 `--color-info` 到皮肤设计规范） |
| R2-008 | §7.5 SSE 事件设计 | `event: error`（Stage 1 致命错误，整体中止）与 `event: done`（全部结束）的关系不清晰：Stage 1 致命错误触发 `event: error` 后，是否还会发送 `event: done`？若不发送，前端如何区分"Stage 1 致命错误"与"连接中断"；若发送，`event: error` 与 `event: done` 的先后顺序与语义重叠需澄清 | 建议 | 明确事件顺序约定：`event: error` 发送后立即关闭流，**不再发送** `event: done`。前端依据是否收到 `event: error` 判断是否为致命错误中止；若流正常关闭且未收到 `event: error`，则视为正常结束（可能含部分失败，由 `flowchart-error`/`mindmap-error` 标识）。在 §7.5 补充此约定 |
| R2-009 | §7.6 FlowchartSchema 回边判定规则 | `isBackEdge` 与 `loop` 节点的关系未澄清：FR-021 要求"loop 回边用虚线"，但回边判定规则说"LLM 显式标记 `isBackEdge: true`"或"target 节点在 source 节点之前出现"。问题是：(1) 是否所有 `loop` 类型节点的出边都是回边？还是只有回到循环起点的边才是回边？(2) `decision` 节点的"否"分支若回到之前的节点，是否也算回边？ | 建议 | 在 §7.6 回边判定规则中补充说明：`isBackEdge` 与节点类型无强绑定关系，任何类型的节点出边只要满足"target 在 source 之前出现"或"LLM 显式标记"即为回边。`loop` 节点的回边是典型场景但非唯一场景，`decision` 节点的回退边也可标记为回边。前端统一依据 `isBackEdge` 渲染虚线 |
| R2-010 | §9 实施路径 各期验证标准 | 验证标准不够具体，难以执行：(1) Phase 1"内容质量人工评分 ≥ 4/5"未说明评分维度与评分人；(2) Phase 2"流式渲染流畅"无量化标准；(3) Phase 3 验证标准未覆盖所有可视化相关 FR | 建议 | (1) Phase 1 补充评分维度：代码正确性（编译通过率）、分析清晰度（逻辑连贯性）、流程图准确性（节点-要求映射准确率）、思维导图完整性（知识点覆盖度），每维度 5 分制，由 2 名评审独立打分取均值；(2) Phase 2 量化标准：首 token 响应时间 ≤ 5 秒（NFR-001），流式追加无卡顿（60fps）；(3) Phase 3 补充覆盖 FR 编号清单（FR-017~FR-029） |
| R2-011 | §7.8 前端组件结构 / §7.9 / §7.10 | component-rules.md 合规性说明不足：(1) **皮肤设计规范**：component-rules.md 要求"生成 UI 时必须读取当前皮肤对应的 `design/{skin-name}/DESIGN.md`"，spec 全文未提及皮肤设计规范，未说明 MVP 使用哪个皮肤；(2) **组件目录结构**：spec 使用 `app/[locale]/components/` 和 `app/[locale]/solution/components/`，未说明是否需要 `components/ui/` 顶层目录（shadcn/ui 基础组件放置位置）；(3) **语义化样式**：§7.10 使用 `bg-primary`、`白色文字`，"白色文字"未使用语义变量（如 `text-primary-foreground`） | 建议 | (1) 在 §7.2 或 §7.8 补充说明：MVP 使用默认皮肤 `happyrabbit`，UI 实现时读取 `design/happyrabbit/DESIGN.md`；(2) 在 §7.8 补充 `components/ui/` 目录用于放置 shadcn/ui 基础组件（Button、Input、Card 等）；(3) §7.10 将"白色文字"改为 `text-primary-foreground`，确认 `bg-primary` 为项目语义化变量 |
| R2-012 | §7.1 系统架构说明 | §7.1 说明选择"fetch + ReadableStream"消费 SSE，但未说明选择理由。R1-002 修订建议中提到"fetch + EventSource"，spec 最终选择 `fetch + ReadableStream`，两者差异未说明。实际上 `EventSource` 仅支持 GET 请求，本场景需 POST 请求（提交题目文本、图片等），故 `fetch + ReadableStream` 是合理选择，但 spec 应显式说明 | 建议 | 在 §7.1 说明中补充选择理由："由于生成解答需通过 POST 请求提交题目文本与可选标准答案，而 `EventSource` API 仅支持 GET 请求，故采用 `fetch` + `ReadableStream` 消费 SSE 流。前端通过 `TextDecoder` 解码流数据，按 SSE 协议（`event:`/`data:` 前缀）解析事件。" |
| R2-013 | §5.3 文档拆分计划 | spec 当前 661 行，已超过 code-style.md 的"单文件 ≤ 500 行"上限。§5.3 说明"spec 状态转为 approved 后拆分"，但 draft 状态下已超限。AI-Prompt使用规范.md §4.1.1 允许"若超出，在'边界与排除项'说明拆分计划"，spec 已说明，但未明确 draft 状态下允许超限 | 建议 | 在 §5.3 补充说明："spec 文档在 draft/in-review 状态下允许超过 500 行上限（因含架构设计章节），approved 后立即拆分为独立架构文档，spec 仅保留 §1~§6 需求部分（预计 ≤ 300 行）。" 以避免与 code-style.md 的行数限制产生歧义 |

---

## 五、评审总结

### 核心问题

本轮评审未发现阻塞级问题，r1 的 3 个阻塞问题均已妥善解决。但发现 **4 个重要级问题**，集中在修订引入的深层技术细节：

1. **错误码格式不合规**（R2-001）：`INPUT_VALIDATION_ERROR` 和 `INTERNAL_ERROR` 缺少 MODULE 前缀，违反 api-conventions.md 的 `MODULE_CATEGORY_SPECIFIC` 格式要求。需统一使用 `CPP_` 前缀。

2. **SSE Route Handler 与 ServiceResult<T> 矛盾**（R2-002）：NFR-007 要求所有 Route Handler 返回 `ServiceResult<T>`，但 SSE 流式 Route Handler 无法一次性返回。需明确 SSE Route Handler 是 NFR-007 的例外，错误信息通过 SSE 事件携带。

3. **Stage 1 LLM 输出协议健壮性不足**（R2-003）：§7.3.1 定义了基本解析规则，但未覆盖标记分片、重复、乱序等边界场景，且标记缺失时代码区为空的降级 UI 未说明。这些是流式实现的关键细节，不补充会导致开发实现歧义。

4. **SSE 实现细节缺失**（R2-004）：事件数据格式、断线重连、AbortController 三项关键细节未说明，前后端数据契约不完整，影响实现可操作性。

### 其他建议问题

9 个建议级问题涵盖：环境变量验证健壮性（R2-005）、Schema 字段格式说明（R2-006/009）、节点图标与语义色（R2-007）、SSE 事件语义（R2-008）、实施路径验证标准（R2-010）、组件规范合规性（R2-011）、技术选型理由（R2-012）、文档行数（R2-013）。

### 修订方向

1. 统一错误码 MODULE 前缀为 `CPP_`（R2-001）
2. 修订 NFR-007，明确 SSE Route Handler 例外（R2-002）
3. 补充 Stage 1 输出协议的边界场景处理（R2-003）
4. 补充 SSE 事件数据格式、断线重连、AbortController（R2-004）
5. 酌情采纳建议级问题（R2-005~R2-013）

### 问题数量统计

- 阻塞：0
- 重要：4
- 建议：9
- 合计：13

### r1 阻塞问题解决核查结果

- R1-001（MindmapSchema 递归类型）：**已解决**
- R1-002（SSE 实现机制）：**已解决**
- R1-003（Stage 1 LLM 输出格式）：**基本解决**，健壮性需进一步加强（见 R2-003）

### 评审结论

**需修订**。虽无阻塞级问题，但存在 4 个重要级问题（错误码格式、SSE 与 ServiceResult 矛盾、LLM 输出协议健壮性、SSE 实现细节），须在修订版 v1.2 中全部解决；9 个建议级问题酌情采纳。修订后进入第 3 轮评审（终审）。
