# C++ 编程培训辅助系统 架构设计评审意见 — 第 1 轮

**评审对象**：`docs/architecture/arch-cpp-training-assistant-v1.0.md`（v1.0, draft, 1072 行）
**对应 spec**：`docs/specs/spec-cpp-training-assistant-v1.0.md`（v1.2, approved）
**评审时间**：2026-06-25
**评审结论**：需修订

---

## 一、评审维度结论

| # | 维度 | 结论 | 摘要 |
|---|------|------|------|
| 1 | Spec 覆盖性 | 通过（FR）/ 需修订（NFR） | FR-001~FR-031 覆盖率 100%，追踪矩阵准确；但 NFR-014/015 缺少架构落点 |
| 2 | 技术选型合理性 | 通过 | 7 个 ADR 决策合理，与 spec §7.2 一致，无过度设计或设计不足 |
| 3 | 模块划分 | 通过（含建议） | M1~M7 边界清晰、单一职责、依赖关系正确；依赖关系图 M6 位置表述待修正 |
| 4 | 数据流设计 | 需修订 | Stage 1/2 正常流与异常流覆盖完整，SSE 事件流设计完整；但 Stage 1 标记"部分缺失"场景未覆盖 |
| 5 | 接口定义 | 需修订 | Server Action/服务类/Schema/错误码整体规范；但 revalidatePath 路径有误、Route Handler 缺 try-catch 契约 |
| 6 | 目录结构 | 通过 | 符合 .trae/rules/dev/ 规范，@/ 绝对路径导入，服务层/组件层目录合理 |
| 7 | 非功能设计 | 需修订 | 性能/安全/可扩展性整体周全；但 NFR-014/015 无落点 |
| 8 | 风险识别 | 通过 | 11 项技术难点 + 6 项架构风险识别全面，对策可行 |
| 9 | 合规性 | 通过 | 代码示例符合 code-style.md（显式返回类型、import type、无 any）；命名符合 naming-conventions.md；1072 行超限属设计文档合理范围 |
| 10 | 可实施性 | 需修订 | 整体可实施，但 solution/page.tsx 职责描述有误，部分契约不够详细 |

---

## 二、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR1-001 | §8 非功能设计 | NFR-014（浏览器兼容性 Chrome/Firefox/Safari/Edge 最新版）与 NFR-015（移动端响应式适配）在架构设计中完全没有落点。§8.1 性能架构仅覆盖 NFR-001~004，§8.2 安全架构仅覆盖 NFR-008/009/010/017，§8.3 可扩展性仅覆盖模型切换/持久化/SSO/国际化，§8.4 可维护性仅覆盖 NFR-011/012/013/016。NFR-014/015 作为 spec approved 的非功能需求，架构文档应明确落点 | 重要 | 在 §8 新增"兼容性架构"小节（或并入 §8.1/8.3），说明：①NFR-014 落点——技术选型仅使用现代浏览器普遍支持的 API（fetch、ReadableStream、AbortController），ReactFlow/Shiki 等依赖均兼容现代浏览器，无需 polyfill；②NFR-015 落点——响应式适配策略（断点、布局调整方向），引用 component-rules.md 移动端断点 `@media (max-width: 767px)` |
| AR1-002 | §4.2.3 边界场景处理 | Stage 1 标记分流仅覆盖"标记缺失"（全部缺失）的降级 UI（§4.2.4），未覆盖"标记部分缺失"的边界场景：①LLM 只输出 `<<<CODE>>>` 未输出 `<<<ANALYSIS>>>`——状态机停在 `code` 状态，后续所有内容作为 code 推送，分析区无内容；②LLM 未输出 `<<<CODE>>>` 但输出了 `<<<ANALYSIS>>>`——代码区无内容，分析区有内容。这两种场景下用户会看到空白区域且无降级提示 | 重要 | 在 §4.2.3 边界场景处理表格新增"标记部分缺失"行，并在 §4.2.4 降级 UI 补充：①仅 CODE 标记无 ANALYSIS 标记——代码区正常展示，分析区显示「分析生成异常，请重试」+ 重新生成按钮；②仅 ANALYSIS 标记无 CODE 标记——分析区正常展示，代码区显示「代码生成异常，请重试」+ 重新生成按钮。服务层在 Stage 1 流结束时检测各区段是否有内容，无内容时推送对应的降级提示事件 |
| AR1-003 | §5.2 recognizeImage Server Action | `revalidatePath('/[locale]')` 存在两个问题：①路径错误——`/[locale]` 是动态路由段模式，revalidatePath 需要实际路径（如 `/zh`）或使用 `revalidatePath('/', 'page')` 形式，字面量 `'/[locale]'` 不会匹配任何实际路径；②场景不必要——recognizeImage 通过 return 值将识别文本传回前端（useActionState），不依赖 Server Component 重新渲染，revalidatePath 调用本身不必要。api-conventions.md 示例中的 revalidatePath 适用于"数据持久化后刷新缓存"场景，图片识别无持久化 | 重要 | 删除 recognizeImage 中的 `revalidatePath('/[locale]')` 调用，并在代码注释或 §5.2 说明中注明"图片识别结果通过 return 值传回前端，无需 revalidatePath 刷新缓存（无持久化）"。若保留 revalidatePath 以备未来扩展，改为 `revalidatePath('/', 'page')` 并说明用途 |
| AR1-004 | §6.2 目录结构 / §10 FR-031 追踪 | `app/[locale]/solution/page.tsx` 标注为"解题结果页（Server Component，数据获取）"，但 SSE 流式数据由客户端 `solution-tabs.tsx` 通过 fetch + ReadableStream 消费，Server Component 不参与流式数据获取。当前描述会误导开发 agent 认为 page.tsx 需要获取 SSE 数据。实际上 page.tsx 仅渲染壳结构（布局、Tab 容器），数据获取完全由 Client Component 完成 | 重要 | 修正 §6.2 目录结构中 `solution/page.tsx` 的注释为"解题结果页（Server Component，渲染壳结构与布局，不参与 SSE 数据获取；数据由 solution-tabs.tsx 通过 fetch 消费）"。同时在 §6.3 规范遵循说明或 §5.3 Route Handler 契约附近补充数据流说明：page.tsx 渲染初始 HTML 壳，solution-tabs.tsx 在客户端 mount 后发起 POST /api/solution 请求消费 SSE 流 |
| AR1-005 | §5.3.3 Route Handler 签名 | `POST` 方法实现仅展示 `throw new Error('契约定义，实现见开发阶段')`，未体现 try-catch 结构。NFR-007 要求"所有 Server Action 与非流式 Route Handler 包含 try-catch，返回 ServiceResult<T>；SSE 流式 Route Handler 通过 SSE 事件携带错误信息"。虽然注释提到"详细实现见开发阶段"，但作为契约定义应展示编排逻辑的异常处理骨架，特别是：①Zod 验证失败如何返回 400；②Stage 1 致命错误如何通过 `event: error` 推送后关闭流；③ReadableStream 构造过程中的异常如何兜底 | 重要 | 在 §5.3.3 Route Handler 签名中补充 try-catch 骨架伪代码（非完整实现），至少包含：①Zod 验证失败 → 返回 `NextResponse.json({ success: false, error: { code: 'CPP_INPUT_VALIDATION_ERROR', message } }, { status: 400 })`；②ReadableStream start/pull 逻辑用 try-catch 包裹，捕获异常时推送 `event: error` 并关闭流；③外层 try-catch 兜底返回 500。明确说明 SSE Route Handler 的错误处理契约：流内错误走 SSE 事件，流外错误（如 Zod 验证失败）走 HTTP 状态码 |
| AR1-006 | §2.3 模块依赖关系图 | 图中 M6 思维导图模块被绘制在 M5 流程图模块下方，通过 `▲` 箭头指向 M5，视觉上呈现 M6 依赖 M5 的错觉。实际上 M3/M4/M5/M6 相互独立，均仅依赖 M2 的 SSE 事件流（§2.3 依赖说明已正确文字描述"M3~M6 相互独立"）。图示与文字描述不一致，可能误导开发 agent 对模块耦合度的理解 | 建议 | 修正 §2.3 模块依赖关系图，将 M6 思维导图模块与 M3/M4/M5 并排展示在同一层级，均通过箭头从 M2 指向，体现四者并列独立消费 SSE 事件流的关系 |
| AR1-007 | §10 FR 覆盖性追踪矩阵 | 架构文档仅有 FR 追踪矩阵（§10），缺少 NFR 追踪矩阵。虽然 §8 非功能设计章节有部分 NFR 落点，但分散在各小节，不便于开发 agent 快速核对 NFR 覆盖完整性。结合 AR1-001，NFR-014/015 的遗漏部分原因即在于缺少集中追踪 | 建议 | 在 §10 FR 追踪矩阵之后新增"NFR 覆盖性追踪矩阵"小节，表格格式：NFR 编号 | 描述 | 架构落点（章节引用）。覆盖 NFR-001~NFR-017 全部 17 项，确保每项 NFR 都有明确落点或标注"MVP 暂不实现" |
| AR1-008 | §5.4.2 SolutionService.generateStream | `generateStream` 方法既通过 `callbacks` 推送流式 chunk，又通过返回值 `ServiceResult<{ code: string; analysis: string }>` 返回完整结果。这种"回调 + 返回值"的混合设计意图未明确说明，开发 agent 可能困惑为何不只用回调或只用返回值 | 建议 | 在 §5.4.2 补充设计意图说明："generateStream 采用回调 + 返回值混合设计：回调用于流式推送 chunk（前端实时渲染），返回值用于提供完整代码与分析文本（作为 Stage 2 的上下文输入）。Route Handler 在 Stage 1 流式推送完成后，使用返回值触发 Stage 2 的 flowchartService/mindmapService 调用" |
| AR1-009 | §4.2.4 降级 UI / §9.1 难点 5 | §4.2.4 仅定义了"标记全部缺失"的降级 UI，未定义"标记部分缺失"（AR1-002）的前端 UI 处理。同时 §9.1 难点 5 仅描述服务层状态机解析，未涉及前端如何感知部分缺失并渲染降级 UI 的机制 | 建议 | 结合 AR1-002 的修订，在 §4.2.4 或 §4.4 SSE 事件设计中补充：服务层在 Stage 1 流结束时检测各区段内容，若某区段无内容，推送特定的降级提示事件（如 `code-empty`/`analysis-empty`），前端据此渲染对应区域的降级 UI。或在 `stage1-done` 事件 data 字段中携带 `{ codeEmpty: boolean, analysisEmpty: boolean }` 标志，前端据此判断 |
| AR1-010 | §6.2 solution-tabs.tsx | `solution-tabs.tsx` 标注为"Tab 切换 + 流式状态管理（fetch 消费 SSE）"，但作为整个前端编排的核心组件，缺少详细设计说明：①如何用 fetch + ReadableStream + TextDecoder 解析 SSE 事件；②如何管理 4 个 Tab 的就绪状态（FR-031）；③如何处理 Stage 2 部分失败（flowchart-error/mindmap-error）时的 Tab 状态；④如何处理 AbortController 取消（FR-031）后的状态清理。开发 agent 仅凭当前描述难以直接编码 | 建议 | 在 §6.2 或新增 §5.x 小节补充 solution-tabs.tsx 的组件设计要点：①SSE 消费流程（fetch → ReadableStream → TextDecoder → 按 `event:`/`data:` 解析 → 分发到对应 state）；②Tab 就绪状态机（pending → loading → ready/error）；③部分失败处理（flowchart-error 时流程图 Tab 显示 error 状态 + 重试按钮，其他 Tab 不受影响）；④AbortController 生命周期（生成时创建，取消/完成时清理） |
| AR1-011 | §5.6 错误码表 | `CPP_AI_LLM_TIMEOUT` 错误码同时覆盖"LLM 调用超时"和"前端取消生成"两个场景。但前者是服务端超时（NFR-001/002 时限），后者是用户主动取消（FR-031），两者语义不同：超时是异常，取消是正常用户行为。共用错误码会导致日志分析时无法区分，且前端 UI 处理可能不同（超时显示"模型响应超时，请重试"，取消显示"已取消生成"） | 建议 | 拆分为两个错误码：①`CPP_AI_LLM_TIMEOUT`——仅用于 LLM 调用超时（服务端），message "模型响应超时，请重试"；②`CPP_AI_GENERATION_CANCELLED`——用于前端取消生成（用户主动），message "已取消生成"。或在 §5.6 错误码使用约定中明确：取消场景不记录为 error 级别日志，仅记录 info 级别，且前端不显示错误提示 |
| AR1-012 | §7.3 环境变量验证机制 | `validateEnv()` 声明"在 AI 服务层方法内部首次调用时执行（非模块级调用），首次调用时执行一次，后续调用跳过"，但未说明如何实现"首次执行一次，后续跳过"的缓存机制。当前 `validateEnv` 函数每次调用都会遍历环境变量并校验，无缓存标志位 | 建议 | 在 §7.3 补充 validateEnv 的缓存机制实现说明，例如：①模块级布尔标志 `let envValidated = false`，validateEnv 首次执行校验后置为 true，后续调用直接 return；②或使用单例模式封装 EnvValidator 类，构造时校验一次。给出伪代码示例说明缓存机制 |

---

## 三、评审总结

### 3.1 整体评价

架构文档整体质量较高，9 个必备章节完整，FR 覆盖率 100%，7 个 ADR 决策合理且有据可查，技术选型与 spec §7.2 一致，代码示例符合 code-style.md 与 naming-conventions.md 规范。Stage 1 标记分流机制（含标记分片/重复/乱序边界场景）、SSE 事件流设计（含断线重连/AbortController 取消）、Stage 2 并行容错等核心数据流设计较为健壮。1072 行超 500 行限制属设计文档合理范围（spec §5.3 已确立 spec/架构文档分离原则），不视为问题。

### 3.2 核心问题

本轮评审发现 **5 项重要级问题**，集中在以下三个方面：

1. **NFR 覆盖不完整**（AR1-001）：NFR-014/015 完全无架构落点，且缺少 NFR 追踪矩阵（AR1-007）。虽然 FR 覆盖率 100%，但 NFR 作为 spec approved 的需求同样需要架构落点。

2. **Stage 1 标记分流边界场景遗漏**（AR1-002/AR1-009）：仅覆盖"标记全部缺失"的降级 UI，未覆盖"标记部分缺失"（只有 CODE 无 ANALYSIS，或反之）的场景。这会导致用户在某些 LLM 输出异常情况下看到空白区域且无降级提示。

3. **接口契约细节问题**（AR1-003/AR1-004/AR1-005）：recognizeImage 的 revalidatePath 路径错误且场景不必要；solution/page.tsx 职责描述与 SSE 流式架构矛盾；Route Handler POST 方法契约缺少 try-catch 骨架。这些问题会直接影响开发 agent 的可实施性。

### 3.3 修订方向

建议 nextjs-architect 在修订时：
1. 补充 NFR-014/015 架构落点 + NFR 追踪矩阵
2. 补充 Stage 1 标记部分缺失的边界场景处理与降级 UI
3. 修正 recognizeImage 的 revalidatePath 问题
4. 修正 solution/page.tsx 职责描述
5. 补充 Route Handler POST 方法的 try-catch 契约骨架
6. 酌情采纳建议级问题（AR1-006~AR1-012）

### 3.4 问题数量统计

| 严重程度 | 数量 |
|---------|------|
| 阻塞 | 0 |
| 重要 | 5 |
| 建议 | 7 |
| **合计** | **12** |

由于存在重要级问题，评审结论为 **需修订**。修订后进入第 2 轮评审（r2）。
