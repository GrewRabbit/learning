# C++ 编程培训辅助系统 需求规格与设计文档

**版本**：v1.2
**状态**：approved
**创建时间**：2026-06-25
**最后更新**：2026-06-25

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-06-25 | 初稿创建，含需求规格与架构设计 | — |
| v1.1 | 2026-06-25 | 根据 r1 评审修订：修复 MindmapSchema 递归类型；SSE 改 Route Handler；补充 Stage 1 输出协议；补充 AC-015~019；新增错误码定义；FlowchartSchema 补充回边字段；补充文件/文本安全限制；修正 recognizeImage 位置；补充 SSE 部分失败事件；补充环境变量验证；采纳建议级问题 | review-r1 |
| v1.2 | 2026-06-25 | 根据 r2 评审修订：错误码统一加 CPP_ 前缀（R2-001）；NFR-007 明确 SSE Route Handler 例外（R2-002）；Stage 1 输出协议补充标记分片/重复/乱序/降级 UI 处理（R2-003）；SSE 补充事件数据格式/断线重连/AbortController（R2-004）；采纳全部建议级问题 R2-005~R2-013 | review-r2 |

---

## 1. 背景与目标

### 1.1 背景

C++ 编程教学与学习中，学生面对一道编程题目时，往往需要理解题目要求、掌握解题思路、学习涉及的 C++ 知识点。传统教学依赖教师一对一讲解，效率有限。借助大语言模型的代码生成与知识组织能力，可构建一个辅助系统，自动生成解题代码、思路分析、可视化流程图与知识点思维导图，帮助学生系统性理解题目。

### 1.2 目标

构建一个基于 Next.js 的 C++ 编程培训辅助系统 MVP，实现：

- 输入 C++ 编程题目（文本或截图识别）
- 自动生成 C++ 代码解答与解题思路分析
- 生成可交互的解题流程图（节点标注与题目要求的对应关系，hover 显示解释）
- 生成可交互的知识点思维导图（层级展开/折叠，点击查看详情）
- 支持补充标准答案后基于标准答案深度解读重新生成

### 1.3 关键约束（已确认）

| 约束 | 决策 |
|------|------|
| AI 模型 | 国产商用 API（GLM/DeepSeek/Kimi/通义千问），多模型可配置切换 |
| 使用场景 | MVP 原型，SSO 后续集成（已有现成 SSO IDP） |
| 代码执行 | 不执行，仅生成展示 |
| 持久化 | MVP 无状态，服务层预留接口 |
| 图片识别 | 多模态模型（Kimi Vision / 通义千问 VL） |
| 文本/代码生成 | 纯文本模型（GLM-5.2 / DeepSeek / Kimi / Qwen），配置驱动 |

---

## 2. 用户故事

- **作为学生**，我想要输入一道 C++ 编程题目，系统自动生成解答代码与思路分析，以便我理解解题方法。
- **作为学生**，我想要上传题目截图自动识别为文本，以便快速输入题目而无需手动抄写。
- **作为学生**，我想要看到解题流程图，hover 节点查看该部分代码如何实现题目要求，以便理解程序执行逻辑。
- **作为学生**，我想要看到知识点思维导图，展开/折叠层级并点击查看知识点在本题中的应用，以便系统性学习相关 C++ 知识。
- **作为学生/教师**，我想要在生成结果不满意时补充标准答案，系统基于标准答案重新深度解读，以便获得更精准的分析。

---

## 3. 功能需求

### 3.1 输入模块

- **FR-001**：提供多行文本输入框，支持 C++ 编程题目文本输入，文本长度上限 ≤ 10000 字符（超出前端截断并提示）
- **FR-002**：支持图片上传（拖拽/粘贴/点击），上传后显示缩略图
- **FR-003**：提供「识别」按钮，手动触发图片识别（通义千问 VL / Kimi Vision），识别结果回填到题目文本框供用户编辑修正
- **FR-004**：生成解答后，若用户不满意，可展开「标准答案」补充区，通过文本粘贴（长度上限 ≤ 20000 字符）或上传 `.cpp`/`.txt`/`.h`/`.hpp` 文件（大小 ≤ 1MB）补充标准答案
- **FR-005**：补充标准答案后点击「重新生成」，系统切换为「基于标准答案深度解读」模式重新生成全部产物

### 3.2 AI 编排模块

- **FR-006**：采用混合两阶段编排：
  - Stage 1：单次调用生成 C++ 代码 + 解题分析（强相关，合并调用）
  - Stage 2：并行调用生成流程图 JSON + 思维导图 JSON（相互独立，基于 Stage 1 产物）
- **FR-007**：Stage 1 文本通过 SSE 流式输出（逐 token 推送代码与分析）
- **FR-008**：Stage 2 JSON 各自一次性推送完整数据（JSON 无法逐 token 流式）
- **FR-009**：Stage 2 两个调用独立容错，流程图失败不影响思维导图展示，反之亦然
- **FR-010**：各任务使用的模型通过环境变量配置，支持 GLM/DeepSeek/Kimi/Qwen 切换

### 3.3 输出模块 — C++ 代码展示

- **FR-011**：使用 Shiki 服务端渲染 C++ 语法高亮，显示行号
- **FR-012**：提供「复制代码」按钮
- **FR-013**：Stage 1 流式推送时，代码区逐块追加显示（纯文本），Stage 1 完成后用 Shiki 重新高亮

### 3.4 输出模块 — 解题分析展示

- **FR-014**：使用 Markdown 渲染分析内容（react-markdown + remark-gfm，支持表格/列表/代码块）
- **FR-015**：Stage 1 流式推送时，分析区逐块追加 Markdown 文本并实时渲染
- **FR-016**：若基于标准答案生成，顶部显示「基于标准答案深度解读」标签

### 3.5 输出模块 — 交互式流程图

- **FR-017**：使用 ReactFlow（@xyflow/react）渲染流程图，dagre 自动布局（从上到下）
- **FR-018**：6 种节点类型（start/process/decision/loop/data/end），各有图标与语义色
- **FR-019**：每个节点显示 label 与 requirementRef 徽章（标注对应题目要求）
- **FR-020**：hover 节点时显示 tooltip，包含 explanation（如何实现题目需求）、codeRef（对应代码行号）、requirementRef
- **FR-021**：decision 节点出边标注 label（如「是」「否」），loop 回边用虚线
- **FR-022**：hover 边时显示 explanation 路径说明
- **FR-023**：支持缩放/平移/小地图（MiniMap）/自适应视口（fitView）

### 3.6 输出模块 — 交互式知识点思维导图

- **FR-024**：使用 ReactFlow 渲染思维导图，dagre 树形布局（从左到右）
- **FR-025**：默认展开 3 层（depth 0/1/2 可见），第 4 层起默认折叠
- **FR-026**：折叠节点显示 `+N` 徽章（N = 隐藏子节点数），视觉高亮提示可展开
- **FR-027**：点击有子节点的节点切换展开/折叠，折叠后重新计算布局
- **FR-028**：点击任意节点，右侧详情面板滑入显示该知识点的 label 与 explanation（在本题中的应用方式）
- **FR-029**：层级视觉区分（depth 0 根节点最大且高亮，逐级递减）

### 3.7 整体输出布局

- **FR-030**：四个输出（代码/分析/流程图/思维导图）通过 Tab 切换
- **FR-031**：流式生成过程中，已就绪的 Tab 可查看，未就绪的 Tab 显示加载状态

---

## 4. 非功能需求

### 4.1 性能

- **NFR-001**：Stage 1（代码+分析）流式输出首 token 响应时间 ≤ 5 秒
- **NFR-002**：Stage 2（流程图+思维导图并行）总耗时 ≤ 30 秒
- **NFR-003**：ReactFlow 节点数 ≤ 50 时渲染流畅（60fps）
- **NFR-004**：图片识别响应时间 ≤ 15 秒

### 4.2 可靠性

- **NFR-005**：LLM 输出 JSON 格式校验失败时自动重试，最多 2 次
- **NFR-006**：Stage 2 部分失败时，成功部分正常展示，失败部分显示「生成失败，可重试」按钮
- **NFR-007**：所有 Server Action 与非流式 Route Handler 包含 try-catch，返回 `ServiceResult<T>` 格式；SSE 流式 Route Handler（`app/api/solution/route.ts`）通过 SSE 事件（`*-error`/`error`）携带错误信息，错误字段格式遵循 `ServiceResult<T>` 的 `error` 字段结构（`{ code, message }`）。禁止抛出未捕获异常
- **NFR-016**：AI 服务调用记录应用日志（`logger.info` 记录调用开始/结束与耗时，`logger.error` 记录失败），日志内容包含模型名、调用耗时、token 用量（如可获取），禁止日志输出完整 Prompt 中的用户敏感内容；客户端错误统一用 `logClientError()`

### 4.3 安全

- **NFR-008**：所有用户输入经 Zod 验证（文件类型/大小/文本长度）
- **NFR-009**：API Key 仅存服务端环境变量，禁止 `NEXT_PUBLIC_` 前缀
- **NFR-010**：图片上传限制类型（jpg/png/webp）与大小（≤ 10MB），识别后不持久化；标准答案文件上传限制类型（`.cpp`/`.txt`/`.h`/`.hpp`）与大小（≤ 1MB）；题目文本长度上限 ≤ 10000 字符，标准答案文本长度上限 ≤ 20000 字符
- **NFR-017**：LLM 输出的代码通过 Shiki 服务端渲染（自动转义 HTML），分析通过 react-markdown 渲染（默认转义），禁止使用 `dangerouslySetInnerHTML` 直接渲染 LLM 输出

### 4.4 可维护性

- **NFR-011**：AI 服务层抽象统一接口，模型切换通过环境变量配置，无需改代码
- **NFR-012**：服务层预留持久化接口，后续可插入数据库而不改上层逻辑
- **NFR-013**：遵循项目 `.trae/rules/` 全部规范（代码风格、组件规范、API 约定等）

### 4.5 兼容性

- **NFR-014**：支持现代浏览器（Chrome/Firefox/Safari/Edge 最新版）
- **NFR-015**：移动端基本可用（响应式适配，不要求完整移动端体验）

---

## 5. 边界与排除项

### 5.1 MVP 不做

- **不做**用户认证与账号系统（SSO 后续集成，已有现成 IDP）
- **不做**数据持久化与历史记录（MVP 无状态，服务层预留接口）
- **不做**C++ 代码在线执行与运行结果返回
- **不做**多语言国际化（MVP 仅中文）
- **不做**高并发与配额控制（单用户原型）
- **不做**流程图/思维导图的导出（图片/PDF 导出后续考虑）

### 5.2 范围边界

- 图片识别仅处理编程题目截图，不处理手写代码或复杂公式
- 流程图/思维导图由 LLM 生成 JSON 数据，前端渲染，**不**让 LLM 生成 SVG/HTML
- 标准答案为可选输入，不提供时系统自行生成解答

### 5.3 文档拆分计划

- 本 spec 当前含 §7~§10 架构设计章节，修订后行数已超 500 行上限
- spec 文档在 draft/in-review 状态下允许超过 500 行上限（因含架构设计章节），approved 后立即拆分为独立架构文档，本 spec 仅保留 §1~§6 需求部分（预计 ≤ 300 行）
- 拆分遵循 spec-workflow.md 中"spec 与架构设计分离"原则，架构文档独立走"生成→评审→修订→终审"闭环

---

## 6. 验收标准

- [ ] AC-001：文本输入 C++ 题目，点击生成，能在 30 秒内获得代码、分析、流程图、思维导图四项产物
- [ ] AC-002：上传题目截图，点击「识别」按钮，识别文本回填到文本框可编辑
- [ ] AC-003：代码区显示 Shiki 语法高亮 + 行号，可复制
- [ ] AC-004：分析区 Markdown 正确渲染（标题/列表/表格/代码块）
- [ ] AC-005：流程图节点有 6 种类型视觉区分，hover 节点显示 tooltip（含 explanation/codeRef/requirementRef）
- [ ] AC-006：流程图 decision 节点出边有「是/否」标签，loop 回边为虚线
- [ ] AC-007：思维导图默认展开 3 层，第 4 层折叠且显示 `+N` 徽章
- [ ] AC-008：点击思维导图节点切换展开/折叠，右侧详情面板显示知识点说明
- [ ] AC-009：补充标准答案后重新生成，分析区显示「基于标准答案深度解读」标签
- [ ] AC-010：Stage 2 部分失败时，成功部分正常展示，失败部分有重试按钮
- [ ] AC-011：通过环境变量切换模型（如 GLM→DeepSeek），功能正常无需改代码
- [ ] AC-012：`npx tsc --noEmit` 无类型错误
- [ ] AC-013：`npm run lint` 无警告
- [ ] AC-014：`npm run build` 成功
- [ ] AC-015：hover 流程图边时显示 explanation tooltip（路径说明）
- [ ] AC-016：流程图支持缩放/平移/小地图（MiniMap）/自适应视口（fitView）
- [ ] AC-017：思维导图根节点与子节点视觉层级区分（字号/背景逐级递减，depth 0 最大且高亮）
- [ ] AC-018：四个输出（代码/分析/流程图/思维导图）通过 Tab 切换查看
- [ ] AC-019：流式生成过程中，已就绪 Tab 可查看，未就绪 Tab 显示加载状态

---

## 7. 架构设计

### 7.1 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器（Client）                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 题目输入  │  │ 代码展示  │  │ 流程图    │  │ 思维导图 │ │
│  │ +图片上传 │  │ +分析展示 │  │ ReactFlow│  │ReactFlow│ │
│  └─────┬────┘  └─────▲────┘  └─────▲────┘  └────▲────┘ │
│        │ FormData      │ SSE        │ SSE         │ SSE  │
│        │ (recognize)   │ (fetch)    │ (fetch)     │      │
└────────┼──────────────┼────────────┼─────────────┼──────┘
         │              │            │             │
┌────────▼──────────────▼────────────▼─────────────▼──────┐
│  Server Action 层（非流式）  │  Route Handler 层（流式）  │
│  ┌─────────────────────┐    │  ┌──────────────────────┐ │
│  │ recognizeImage       │    │  │ POST /api/solution   │ │
│  │ (app/[locale]/       │    │  │ (SSE 流式编排 AI)    │ │
│  │  actions.ts)         │    │  │ Stage1+Stage2        │ │
│  │ Zod 验证 + useAction │    │  │ ReadableStream       │ │
│  │ State                │    │  │ + SSE 事件           │ │
│  └──────────┬───────────┘    │  └──────────┬───────────┘ │
└─────────────┼────────────────┼─────────────┼─────────────┘
              │                │             │
┌─────────────▼────────────────▼─────────────▼─────────────┐
│                    AI 服务层（Service Layer）             │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ 图片识别    │  │ 代码+分析   │  │ 图表 JSON 生成     │  │
│  │ Vision 模型 │  │ 文本模型    │  │ 文本模型           │  │
│  └────────────┘  └────────────┘  └───────────────────┘  │
│  统一 ServiceResult<T> 返回 + Zod schema 校验 LLM 输出    │
└─────────────────────────────────────────────────────────┘
```

> **SSE 走 Route Handler 的说明**：dev-workflow.md 要求"优先 Server Actions，避免 API Routes"，但 Server Action 标准模式（useActionState + form action）无法消费流式 ReadableStream。SSE 流式输出（generateSolution）作为该规范的合理例外，使用 Route Handler（`app/api/solution/route.ts`）实现，前端用 `fetch` + `ReadableStream` 消费；非流式操作（recognizeImage）保留标准 Server Action 模式。
>
> **fetch + ReadableStream 选择理由**：生成解答需通过 POST 请求提交题目文本与可选标准答案，而 `EventSource` API 仅支持 GET 请求，故采用 `fetch` + `ReadableStream` 消费 SSE 流。前端通过 `TextDecoder` 解码流数据，按 SSE 协议（`event:`/`data:` 前缀）解析事件。

### 7.2 技术栈

| 层 | 技术 | 选型理由 |
|----|------|---------|
| 框架 | Next.js App Router | 项目规范已确立 |
| UI 组件 | shadcn/ui + Tailwind v4 | 遵循组件规范，语义化 CSS 变量 |
| 图标 | lucide-react | 项目规范强制 |
| 流程图渲染 | ReactFlow（@xyflow/react） | 自定义节点、hover 交互、缩放平移 |
| 思维导图渲染 | ReactFlow（树形布局） | 复用同一库，避免引入第二个图库 |
| 代码高亮 | Shiki | 服务端渲染，无客户端 JS 开销 |
| 表单验证 | Zod | 项目规范强制，同时校验 LLM 输出 |
| AI 调用 | OpenAI 兼容 SDK | GLM/DeepSeek/Kimi/Qwen 均兼容 |
| 流式输出（SSE） | Route Handler + ReadableStream | SSE 场景对"优先 Server Actions"的合理例外，Server Action 标准模式无法消费流式响应 |
| 非流式操作 | Server Action + useActionState | 图片识别等非流式操作遵循标准 Server Action 模式 |
| 自动布局 | dagre（@dagrejs/dagre） | ReactFlow 节点自动坐标计算 |

### 7.3 AI 编排流程（混合方案 C）

```
用户提交题目
  ↓
Stage 1：代码生成 + 解题分析（单次调用，文本模型）
  ├─ 输入：题目文本（+可选标准答案）
  ├─ 输出：带结构化标记的文本（见 §7.3.1 输出协议）
  └─ 流式：SSE 逐 token 推送，服务层解析标记后分流为 code-chunk / analysis-chunk
  ↓ code + analysis 作为上下文
Stage 2：流程图 JSON + 思维导图 JSON（并行调用，文本模型）
  ├─ 流程图服务 ──┐
  │  输入：题目+代码  │ 并行
  │  输出：Flowchart │
  ├─ 思维导图服务 ──┘
  │  输入：题目+代码
  │  输出：Mindmap
  └─ 各自一次性推送完整 JSON（失败各自推送 *-error 事件）
  ↓
前端渲染全部产物
```

#### 7.3.1 Stage 1 LLM 输出协议

Stage 1 单次调用需同时生成代码与分析两部分，为支持流式分流推送，约定 LLM 输出带结构化标记的文本格式：

```
<<<CODE>>>
{C++ 代码内容}
<<<ANALYSIS>>>
{解题分析 Markdown 内容}
```

**解析规则**（服务层在 `prompts/solution-prompt.ts` 中定义输出模板，并在流式消费时按标记状态机解析）：

1. 服务层维护当前区段状态：`pending` → `code` → `analysis`（单向转换，不可回退）
2. 收到 `<<<CODE>>>` 标记 → 切换为 `code` 状态，后续 token 作为 `code-chunk` 事件推送
3. 收到 `<<<ANALYSIS>>>` 标记 → 切换为 `analysis` 状态，后续 token 作为 `analysis-chunk` 事件推送
4. 标记本身不推送给前端，仅作服务层分隔符
5. 若 LLM 未输出标记（异常情况），服务层将全部内容作为 `analysis-chunk` 推送，并记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志，前端代码区显示降级 UI（见下文"降级 UI"）

**边界场景处理**：

| 场景 | 处理策略 |
|------|---------|
| **标记分片** | 服务层维护标记缓冲区。当缓冲区内容可能是标记前缀（如 `<`、`<<`、`<<<`、`<<<C`、`<<<CO`...）时暂不推送，持续累积直到确认不是任何标记前缀（则作为普通文本推送缓冲区内容并清空）或完整匹配标记（则触发状态切换并清空缓冲区）。标记最大长度按 `<<<ANALYSIS>>>`（15 字符）封顶，缓冲区超过此长度仍未匹配则判定为普通文本 |
| **标记重复** | 仅识别第一次出现的标记并触发状态切换；后续重复出现的标记作为普通文本推送（如 `code` 状态下再次出现 `<<<CODE>>>`，作为代码内容推送） |
| **标记乱序/嵌套** | 状态机仅允许 `pending→code→analysis` 单向转换。`analysis` 状态后收到 `<<<CODE>>>` 视为普通文本推送；`code` 状态前收到 `<<<ANALYSIS>>>` 视为普通文本推送（跳过状态切换） |

**降级 UI**：标记缺失（LLM 未输出任何标记）时，代码区无内容，前端在代码区显示「代码生成异常，请重试」提示，并提供「重新生成」按钮供用户手动触发重试；分析区正常展示（全部内容作为分析推送）。

**Prompt 模板要求**（`prompts/solution-prompt.ts`）：在 system prompt 中明确要求 LLM 严格按上述标记格式输出，并提供 few-shot 示例。

### 7.4 模型分配

| 任务 | 模型类型 | 具体模型（可配置） |
|------|---------|------------------|
| 图片识别 | 多模态 | Kimi Vision / 通义千问 VL |
| 代码生成 + 分析 | 纯文本 | GLM-5.2 / DeepSeek / Kimi / Qwen |
| 流程图 JSON | 纯文本 | GLM-5.2 / DeepSeek / Kimi / Qwen |
| 思维导图 JSON | 纯文本 | GLM-5.2 / DeepSeek / Kimi / Qwen |

### 7.5 SSE 事件设计

```
event: stage1-start      → 前端显示「正在生成代码与分析...」
event: code-chunk        → 逐块追加代码到代码区
event: analysis-chunk    → 逐块追加分析到分析区
event: stage1-done       → 代码与分析完成
event: stage2-start      → 前端显示「正在生成流程图与思维导图...」
event: flowchart         → 推送完整流程图 JSON（一次性，成功时）
event: flowchart-error   → 流程图生成失败（携带 error.code 与 error.message，前端对流程图区显示重试按钮）
event: mindmap           → 推送完整思维导图 JSON（一次性，成功时）
event: mindmap-error     → 思维导图生成失败（携带 error.code 与 error.message，前端对思维导图区显示重试按钮）
event: done              → 全部结束（含部分失败，前端依据已收到事件判断各模块状态）
event: error             → Stage 1 致命错误（携带 error.code 与 error.message，整体中止）
```

**事件数据格式（data 字段契约）**：

| 事件 | data 字段格式 | 示例 |
|------|--------------|------|
| `stage1-start` / `stage1-done` / `stage2-start` / `done` | 空对象 `{}` | `data: {}\n\n` |
| `code-chunk` / `analysis-chunk` | `{ "content": string }`，content 为本次追加的文本块 | `data: {"content":"#include <iostream>"}\n\n` |
| `flowchart` / `mindmap` | 完整 JSON 对象（符合 §7.6 Schema） | `data: {"nodes":[...],"edges":[...]}\n\n` |
| `flowchart-error` / `mindmap-error` / `error` | `{ "code": string, "message": string }`，遵循 `ServiceResult<T>` 的 `error` 字段结构 | `data: {"code":"CPP_AI_FLOWCHART_GENERATION_FAILED","message":"流程图生成失败，可重试"}\n\n` |

**事件顺序约定**（R2-008 澄清）：

- `event: error`（Stage 1 致命错误）发送后**立即关闭流，不再发送** `event: done`
- 前端依据是否收到 `event: error` 判断是否为致命错误中止：收到 `error` → 致命错误中止；流正常关闭且未收到 `error` → 正常结束（可能含部分失败，由 `flowchart-error`/`mindmap-error` 标识）
- 正常流程事件顺序：`stage1-start` → `code-chunk`*N → `analysis-chunk`*N → `stage1-done` → `stage2-start` → (`flowchart`|`flowchart-error`) + (`mindmap`|`mindmap-error`) → `done`

**部分失败处理**：Stage 2 两个调用独立容错（FR-009），`flowchart-error` 与 `mindmap-error` 互不影响。`event: done` 表示编排结束（无论成功或部分失败），前端根据是否收到 `flowchart`/`mindmap` 事件或对应 `*-error` 事件决定各区域展示成功内容或重试按钮。`event: error` 仅用于 Stage 1 致命错误导致整体无法继续的场景。

**断线重连策略**：POST 请求无法使用 `EventSource` 自动重连，本系统**不实现自动重连**。前端检测到连接中断（fetch 的 ReadableStream 抛出网络错误或 abort）后，显示「连接中断，请重试」提示，由用户手动重新触发生成（重新发起 POST 请求）。

**AbortController 取消机制**：

- 前端：用户点击「取消生成」时，调用 `AbortController.abort()` 中止 fetch 请求
- 服务端：Route Handler 通过 `request.signal` 监听 abort 事件，触发时停止 LLM 调用（关闭底层 LLM 流式连接）并关闭 SSE 流，记录 `CPP_AI_LLM_TIMEOUT` 或中断日志
- 取消后前端清理流式状态，恢复到可重新生成状态

### 7.6 LLM 结构化输出 Schema

#### 流程图 Schema

```typescript
import { z } from 'zod';

export const FlowchartSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['start', 'process', 'decision', 'loop', 'data', 'end']),
    label: z.string(),
    codeRef: z.string().optional(),
    requirementRef: z.string().optional(),
    explanation: z.string(),
  })),
  edges: z.array(z.object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    explanation: z.string().optional(),
    isBackEdge: z.boolean().optional(),
  })),
});

export type Flowchart = z.infer<typeof FlowchartSchema>;
```

> **字段格式约定**：
> - `codeRef`：行号范围字符串（如 `"10-15"` 表示第 10-15 行），无对应代码时省略。前端据此在 hover tooltip 中展示对应代码行号
> - `requirementRef`：题目要求编号（如 `"R1"`、`"R2"`，由 LLM 根据题目要求自动编号），无对应要求时省略。前端据此渲染节点徽章
>
> **回边判定规则**：`isBackEdge: true` 标记循环回边（FR-021 要求 loop 回边用虚线渲染）。判定方式：LLM 在生成时对回边显式标记 `isBackEdge: true`；服务层校验时若 `target` 节点在 `source` 节点之前出现（按 nodes 数组顺序），也自动判定为回边并设置该字段。前端依据 `isBackEdge` 渲染虚线边，且回边不参与 dagre 布局计算（避免循环引用导致布局死循环）。
>
> **`isBackEdge` 与节点类型关系**：`isBackEdge` 与节点类型无强绑定关系，任何类型的节点出边只要满足"target 在 source 之前出现"或"LLM 显式标记"即为回边。`loop` 节点的回边是典型场景但非唯一场景，`decision` 节点的回退边（如"否"分支回到之前的节点）也可标记为回边。前端统一依据 `isBackEdge` 渲染虚线，不依据节点类型判断。

#### 思维导图 Schema

```typescript
import { z } from 'zod';

export type MindmapNode = {
  id: string;
  label: string;
  explanation: string;
  children?: MindmapNode[];
};

export const MindmapNodeSchema: z.ZodType<MindmapNode> = z.object({
  id: z.string(),
  label: z.string(),
  explanation: z.string(),
  children: z.lazy(() => z.array(MindmapNodeSchema)).optional(),
});

export const MindmapSchema = z.object({
  root: MindmapNodeSchema,
});

export type Mindmap = z.infer<typeof MindmapSchema>;
```

> **递归类型说明**：先声明 `MindmapNode` 类型，再用 `z.ZodType<MindmapNode>` 标注 `MindmapNodeSchema`，最后在 `children` 中通过 `z.lazy(() => z.array(MindmapNodeSchema))` 实现递归引用，避免引用未定义标识符。
>
> **层级 depth 说明**：Schema 不含 depth 字段。层级 `depth` 由前端遍历树结构计算（根节点 `depth=0`，逐层 +1），前端根据 depth 控制默认展开（`depth < 3` 展开，见 FR-025）与视觉样式（见 §7.10）。

### 7.7 服务层结构

```
app/lib/ai/
  services/
    image-recognition-service.ts   # 图片识别（多模态）
    solution-service.ts            # 代码+分析生成
    flowchart-service.ts           # 流程图 JSON 生成
    mindmap-service.ts             # 思维导图 JSON 生成
  schemas/
    flowchart-schema.ts            # Zod schema + 类型导出
    mindmap-schema.ts
  prompts/
    solution-prompt.ts             # 代码+分析的 Prompt 模板（含 §7.3.1 输出协议标记）
    flowchart-prompt.ts            # 流程图 Prompt（含 schema + few-shot）
    mindmap-prompt.ts              # 思维导图 Prompt
  clients/
    llm-client.ts                  # 统一 OpenAI 兼容客户端
    vision-client.ts               # 视觉模型客户端
  config.ts                        # 模型配置（从 env 读取）
```

> **单例导出规范**（遵循 api-conventions.md）：各服务以单例方式导出，禁止懒加载函数式导出。
>
> ```typescript
> // ✅ 正确：直接导出单例
> export const solutionService = new SolutionService();
> export const flowchartService = new FlowchartService();
> export const mindmapService = new MindmapService();
> export const imageRecognitionService = new ImageRecognitionService();
>
> // ❌ 错误：懒加载函数
> export function getSolutionService() { return new SolutionService(); }
> ```

### 7.8 前端组件结构

> 注：沿用项目 `[locale]` 路由约定，MVP 仅实现 `zh` 单语言，结构为未来 i18n 预留。
>
> **皮肤设计规范**（遵循 component-rules.md"生成 UI 时必须读取当前皮肤对应的 `design/{skin-name}/DESIGN.md`"）：MVP 使用默认皮肤 `happyrabbit`，UI 实现时读取 `design/happyrabbit/DESIGN.md` 获取设计 Token（颜色、字号、圆角、间距等语义变量）。

```
components/
  ui/                               # shadcn/ui 基础组件（Button、Input、Card、Tabs 等，遵循 component-rules.md）
app/
  api/
    solution/
      route.ts                       # SSE 流式 Route Handler（POST，编排 Stage1+Stage2）
    health/
      route.ts                       # 健康检查端点（GET，返回 { status, timestamp }）
  [locale]/
    layout.tsx                       # 根布局（Server Component，仅渲染，不包含交互逻辑）
    layout-client.tsx                # 布局客户端（Client Component，处理交互；MVP 可简化但结构预留）
    actions.ts                       # 首页专属 Server Actions（recognizeImage）
    page.tsx                         # 首页（题目输入）
    components/
      problem-input.tsx              # 题目输入区（文本+图片上传+识别按钮）
      standard-answer-input.tsx      # 标准答案补充区（可折叠）
    solution/
      page.tsx                       # 解题结果页
      components/
        solution-tabs.tsx            # Tab 切换 + 流式状态管理（fetch 消费 SSE）
        code-display.tsx             # 代码展示（Shiki + 复制）
        analysis-display.tsx         # 分析展示（Markdown）
        flowchart-display.tsx        # 流程图容器
        flowchart-node.tsx           # 自定义节点（hover tooltip）
        flowchart-edge.tsx           # 自定义边（hover tooltip + 回边虚线）
        flowchart-layout.ts          # dagre 布局（回边不参与布局计算）
        mindmap-display.tsx          # 思维导图容器 + 折叠状态
        mindmap-node.tsx             # 自定义节点（折叠徽章）
        mindmap-detail-panel.tsx     # 右侧详情面板
        mindmap-layout.ts            # dagre LR 布局 + 折叠过滤
```

> **Server Action 位置说明**（遵循 api-conventions.md"页面专属 Action 放同目录 actions.ts"）：
> - `recognizeImage` 在首页（`app/[locale]/page.tsx`）触发，故放在首页同目录 `app/[locale]/actions.ts`，使用标准 Server Action + `useActionState` 模式
> - `generateSolution` 为 SSE 流式操作，改用 Route Handler（`app/api/solution/route.ts`）实现，前端通过 `fetch` + `ReadableStream` 消费（见 §7.1 说明）
>
> **Layout 拆分**（遵循 dev-workflow.md）：`layout.tsx`（Server Component）仅渲染不包含交互逻辑，调用 `layout-client.tsx`（Client Component）处理交互（useState、事件监听等）。MVP 阶段 `layout-client.tsx` 可简化，但结构应预留以符合规范。

### 7.9 流程图节点类型

| type | 图标（lucide） | 形状 | 语义色 |
|------|---------------|------|--------|
| start | `Play` | 圆角矩形 | `--color-success` |
| process | `Square` | 矩形 | `--color-primary` |
| decision | `GitBranch` | 菱形 | `--color-warning` |
| loop | `Repeat` | 矩形（虚线边） | `--color-info` |
| data | `Database` | 平行四边形 | `--color-muted` |
| end | `CircleStop` | 圆角矩形 | `--color-destructive` |

> **图标区分说明**：`end` 节点使用 `CircleStop` 图标（与 `process` 的 `Square` 视觉区分），配合 `--color-destructive` 语义色，确保终止节点辨识度。
>
> **`--color-info` 语义变量说明**：`--color-info` 用于 `loop` 节点（循环/信息提示场景）。该变量需在 `design/happyrabbit/DESIGN.md` 皮肤设计规范中定义；若皮肤未定义，则降级使用 `--color-warning`。实现时需先读取皮肤 DESIGN.md 确认变量存在性。

### 7.10 思维导图层级视觉

| depth | 样式 |
|-------|------|
| 0（根） | 较大字号，`bg-primary`，`text-primary-foreground` |
| 1 | 中等字号，`bg-card`，加粗边框 |
| 2 | 标准字号，`bg-muted`，普通边框 |
| 3+（默认折叠） | 同 depth 2，折叠时显示 `+N` 徽章 |

> **语义化样式说明**（遵循 component-rules.md）：所有颜色均使用语义变量（`bg-primary`、`text-primary-foreground`、`bg-card`、`bg-muted`），禁止使用 `bg-white`/`text-white` 等原始值。`bg-primary` 与 `text-primary-foreground` 为项目语义化变量，定义于 `design/happyrabbit/DESIGN.md`。

### 7.11 错误码定义

遵循 api-conventions.md 错误码格式 `MODULE_CATEGORY_SPECIFIC`（全大写，下划线分隔，首段为模块名）。本系统模块前缀统一为 `CPP_`（C++ 培训系统），所有 Server Action 与 Route Handler 返回 `ServiceResult<T>` 时使用以下错误码：

| 错误码 | 触发场景 | 返回 message 示例 |
|--------|---------|------------------|
| `CPP_INPUT_VALIDATION_ERROR` | 用户输入未通过 Zod 校验（文本超长、文件类型/大小不符） | 题目文本超过 10000 字符上限 |
| `CPP_AI_VISION_RECOGNITION_FAILED` | 图片识别服务调用失败（模型异常、网络错误） | 图片识别失败，请重试 |
| `CPP_AI_SOLUTION_GENERATION_FAILED` | Stage 1 代码+分析生成失败（非格式问题） | 解答生成失败，请重试 |
| `CPP_AI_SOLUTION_FORMAT_INVALID` | Stage 1 LLM 输出未包含 `<<<CODE>>>`/`<<<ANALYSIS>>>` 标记 | 解答格式异常，已降级处理 |
| `CPP_AI_FLOWCHART_GENERATION_FAILED` | 流程图 JSON 生成失败（重试 2 次后仍失败） | 流程图生成失败，可重试 |
| `CPP_AI_MINDMAP_GENERATION_FAILED` | 思维导图 JSON 生成失败（重试 2 次后仍失败） | 思维导图生成失败，可重试 |
| `CPP_AI_JSON_VALIDATION_FAILED` | LLM 输出 JSON 通过 Zod 校验失败 | 流程图数据格式校验失败 |
| `CPP_AI_LLM_TIMEOUT` | LLM 调用超时（超过 NFR-001/002 时限）或前端取消生成 | 模型响应超时，请重试 |
| `CPP_INTERNAL_ERROR` | 未预期的服务端异常（兜底） | 系统内部错误，请稍后重试 |

> **错误码使用约定**：
> - **Server Action**（recognizeImage）：返回 `ServiceResult<T>`，`error.code` 取自上表
> - **SSE 流式 Route Handler**（`app/api/solution/route.ts`）：作为 NFR-007 中"返回 `ServiceResult<T>`"要求的合理例外（流式场景无法一次性返回），错误信息通过 SSE 事件（`flowchart-error`/`mindmap-error`/`error`）携带，事件 data 字段中的 `code`/`message` 遵循 `ServiceResult<T>` 的 `error` 字段结构（见 §7.5 事件数据格式契约）
> - **Stage 2 部分失败**：流程图与思维导图各自返回独立错误码，互不影响（FR-009）

---

## 8. 技术难点与解决方案

| # | 难点 | 影响模块 | 解决方案 | 风险 |
|---|------|---------|---------|------|
| 1 | LLM 输出非法 JSON | 流程图/思维导图 | JSON 模式 + Zod 校验 + 失败重试（附错误信息让模型修正） | 中 |
| 2 | 图片 OCR 误识代码/公式 | 输入模块 | 识别结果回填可编辑 + 用户手动触发识别 | 低 |
| 3 | 流程图节点-题目要求映射不准 | 流程图 | Prompt few-shot 示例 + 强制 requirementRef 字段 | 中 |
| 4 | SSE 流式输出实现 | 编排层 | Route Handler + ReadableStream，前端 fetch 消费（Server Action 标准模式无法消费流式响应） | 中 |
| 5 | Stage 1 代码与分析流式分流 | 编排层 | LLM 输出带 `<<<CODE>>>`/`<<<ANALYSIS>>>` 标记，服务层状态机解析后分流推送（见 §7.3.1） | 中 |
| 6 | ReactFlow 折叠后布局重算 | 思维导图 | useMemo 缓存 + dagre 重新布局可见节点 | 低 |
| 7 | 多模型 SDK 差异 | 编排层 | 统一 OpenAI 兼容接口 + 配置驱动 | 低 |
| 8 | Stage 2 并行部分失败 | 编排层 | 独立 try-catch + `flowchart-error`/`mindmap-error` 事件 + 前端单独重试按钮 | 低 |
| 9 | 流程图/思维导图节点过多性能 | 可视化 | ReactFlow 虚拟化渲染 + 折叠减少节点数 | 低 |
| 10 | Tooltip 被其他节点遮挡 | 流程图 | z-index + pointer-events-none + hover 提升层级 | 低 |
| 11 | 循环引用导致 dagre 布局死循环 | 流程图 | `isBackEdge` 标记回边，回边不参与布局计算 | 低 |

---

## 9. 实施路径

### Phase 1：AI 能力验证（核心风险前置）

- 搭建 AI 服务层骨架（统一 client + config）
- 实现 solution-service（代码+分析生成）
- 实现 flowchart-service + Zod schema 验证
- 实现 mindmap-service + Zod schema 验证
- 实现 image-recognition-service（图片识别）
- **验证**：用 5-10 道真实 C++ 题目测试各服务输出质量
- **里程碑**：AI 输出质量达标，JSON 格式稳定

### Phase 2：基础 UI + 文本输出

- 项目脚手架（Next.js + Tailwind + shadcn/ui）
- 题目输入页（文本输入 + 图片上传手动识别）
- SSE 流式接收 + 代码/分析展示（Shiki + Markdown）
- 标准答案补充 + 重新生成
- **验证**：端到端跑通「输入→生成代码与分析→展示」
- **里程碑**：核心文本流程可用

### Phase 3：可视化输出

- ReactFlow 集成 + dagre 布局
- 流程图自定义节点 + hover tooltip + 徽章
- 思维导图树形布局 + 3 层默认展开 + 折叠
- 思维导图详情面板
- Tab 切换整合四个输出
- **验证**：流程图/思维导图交互完整，hover/click 符合预期
- **里程碑**：完整功能可用

### Phase 4：打磨与扩展预留

- 错误处理与重试 UI
- 加载状态与空状态
- 响应式适配（移动端基本可用）
- 服务层接口预留（为后续持久化/SSO 集成）
- **验证**：构建 + 类型检查 + Lint 通过
- **里程碑**：MVP 完成，可交付

### 各期验证标准

| Phase | 验证方式 | 通过标准 |
|-------|---------|---------|
| 1 | 单元测试 + 人工抽检 | 10 道题目 JSON 格式 100% 合法；内容质量人工评分 ≥ 4/5（评分维度：代码正确性=编译通过率、分析清晰度=逻辑连贯性、流程图准确性=节点-要求映射准确率、思维导图完整性=知识点覆盖度，每维度 5 分制，由 2 名评审独立打分取均值） |
| 2 | 端到端手动测试 | 输入→生成→展示全流程无报错；首 token 响应时间 ≤ 5 秒（NFR-001）；流式追加无卡顿（60fps） |
| 3 | 端到端手动测试 | 覆盖 FR-017~FR-029：流程图 hover 显示 tooltip（FR-020/022）、6 种节点类型视觉区分（FR-018）、decision 出边标签与 loop 回边虚线（FR-021）、缩放/平移/小地图/fitView（FR-023）；思维导图默认展开 3 层（FR-025）、折叠 `+N` 徽章（FR-026）、展开/折叠切换（FR-027）、详情面板联动（FR-028）、层级视觉区分（FR-029） |
| 4 | `tsc --noEmit` + `npm run lint` + `npm run build` | 全部通过 |

---

## 10. 依赖与前置条件

| 依赖 | 说明 |
|------|------|
| 各模型 API Key | GLM/DeepSeek/Kimi/Qwen 的 API Key，配入 `.env.local` |
| Node.js 20+ | Next.js 运行环境 |
| ReactFlow（@xyflow/react） | 开源 MIT 协议，免费版足够 MVP |
| dagre（@dagrejs/dagre） | 开源 MIT 协议，自动布局 |
| Shiki | 开源 MIT 协议，代码高亮 |
| 无需数据库 | MVP 无状态 |

### 环境变量

```env
# AI 模型配置
AI_VISION_PROVIDER=kimi              # kimi | qwen
AI_VISION_MODEL=kimi-vision
AI_TEXT_PROVIDER=glm                 # glm | deepseek | kimi | qwen
AI_TEXT_MODEL=glm-5.2

# 各厂商 API Key（仅服务端，禁止 NEXT_PUBLIC_ 前缀）
GLM_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
QWEN_API_KEY=

# 各厂商 API Base URL（OpenAI 兼容）
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
DEEPSEEK_BASE_URL=https://api.deepseek.com
KIMI_BASE_URL=https://api.moonshot.cn/v1
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 环境变量验证机制

遵循 env-management.md"推荐在构建前验证必需的环境变量"建议，新增 `app/lib/env.ts`，在 AI 服务层方法内部首次调用时验证必需环境变量，缺失时抛出明确错误（早期失败，避免运行时才报错）：

```typescript
// app/lib/env.ts
const requiredEnvVars = [
  'AI_VISION_PROVIDER',
  'AI_VISION_MODEL',
  'AI_TEXT_PROVIDER',
  'AI_TEXT_MODEL',
] as const;

// 根据 provider 动态校验对应 API Key 与 BASE_URL
const providerKeyMap: Record<string, string> = {
  glm: 'GLM_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'KIMI_API_KEY',
  qwen: 'QWEN_API_KEY',
};

const providerBaseUrlMap: Record<string, string> = {
  glm: 'GLM_BASE_URL',
  deepseek: 'DEEPSEEK_BASE_URL',
  kimi: 'KIMI_BASE_URL',
  qwen: 'QWEN_BASE_URL',
};

export function validateEnv(): void {
  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  const visionProvider = process.env.AI_VISION_PROVIDER;
  const textProvider = process.env.AI_TEXT_PROVIDER;
  const visionKey = providerKeyMap[visionProvider ?? ''];
  const textKey = providerKeyMap[textProvider ?? ''];
  const visionBaseUrl = providerBaseUrlMap[visionProvider ?? ''];
  const textBaseUrl = providerBaseUrlMap[textProvider ?? ''];
  if (visionKey && !process.env[visionKey]) {
    throw new Error(`Missing API Key for vision provider: ${visionProvider}`);
  }
  if (textKey && !process.env[textKey]) {
    throw new Error(`Missing API Key for text provider: ${textProvider}`);
  }
  if (visionBaseUrl && !process.env[visionBaseUrl]) {
    throw new Error(`Missing BASE_URL for vision provider: ${visionProvider}`);
  }
  if (textBaseUrl && !process.env[textBaseUrl]) {
    throw new Error(`Missing BASE_URL for text provider: ${textProvider}`);
  }
}
```

> **调用时机**：`validateEnv()` 在 AI 服务层方法内部首次调用时执行（非模块级调用），确保仅 AI 功能受环境变量缺失影响，不影响健康检查（`/api/health`）等其他端点。具体调用位置为 `image-recognition-service.ts`、`solution-service.ts`、`flowchart-service.ts`、`mindmap-service.ts` 各服务方法的入口处（首次调用时执行一次，后续调用跳过）。

### 健康检查端点

新增 `app/api/health/route.ts` 健康检查端点（遵循 deployment-checklist.md），用于部署后验证服务可用性：

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
```

- 路径：`GET /api/health`
- 返回：`{ status: 'ok', timestamp: string }`
- 用途：部署后验证服务可用性，不依赖外部服务（AI 模型、数据库）
