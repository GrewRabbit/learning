# C++ 编程培训辅助系统 架构设计文档

**版本**：v1.1
**状态**：approved
**创建时间**：2026-06-25
**最后更新**：2026-06-25
**对应 spec**：`docs/specs/spec-cpp-training-assistant-v1.0.md`（v1.2, approved）

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-06-25 | 初稿创建，从 spec v1.2 §7-10 提取架构内容并重组为独立文档；补充非功能设计章节与 FR 覆盖性追踪矩阵 | — |
| v1.1 | 2026-06-25 | 根据 r1 评审修订：补充 NFR-014/015 架构落点与 NFR 追踪矩阵（AR1-001/007）；补充 Stage 1 标记部分缺失场景与降级 UI（AR1-002/009）；删除 recognizeImage 多余 revalidatePath 调用（AR1-003）；修正 solution/page.tsx 职责描述（AR1-004）；补充 Route Handler POST try-catch 骨架（AR1-005）；修正模块依赖关系图 M6 位置（AR1-006）；补充 generateStream 设计意图（AR1-008）；补充 solution-tabs.tsx 设计要点（AR1-010）；拆分 CPP_AI_LLM_TIMEOUT 错误码（AR1-011）；补充 validateEnv 缓存机制（AR1-012） | review-r1 |

> **文档说明**：本文档由 `nextjs-architect` 基于 approved spec v1.2 生成，遵循 `docs/AI-Prompt使用规范.md` §4.2.1 架构设计生成 Prompt E 要求。架构内容来源于 spec §7-10，重组为独立架构文档以便走"生成→评审→修订→终审"闭环。本文档为设计文档（非代码文件），内容覆盖 9 个必备章节 + FR 追踪矩阵 + 实施路径，行数超过 500 行属设计文档合理范围（spec §5.3 已确立 spec/架构文档分离原则）。

---

## 1. 架构概述

### 1.1 整体设计思路

本系统为基于 Next.js App Router 的 C++ 编程培训辅助 MVP，采用"前端交互层 + Server Action/Route Handler 接入层 + AI 服务层"三层架构。核心设计为**混合两阶段 AI 编排**：Stage 1 单次调用生成代码+分析（SSE 流式），Stage 2 并行调用生成流程图+思维导图 JSON（一次性推送，独立容错）。非流式操作（图片识别）走标准 Server Action 模式，流式操作（解答生成）作为 dev-workflow.md "优先 Server Actions" 的合理例外，使用 Route Handler + ReadableStream 实现。AI 服务层抽象统一 OpenAI 兼容接口，模型切换通过环境变量配置驱动，服务层预留持久化接口以支持后续扩展。系统无状态、无认证、无数据库，MVP 聚焦 AI 编排与可视化渲染核心能力验证。

### 1.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       浏览器（Client）                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ 题目输入    │  │ 代码展示    │  │ 流程图      │  │ 思维导图   │  │
│  │ +图片上传   │  │ +分析展示   │  │ ReactFlow  │  │ ReactFlow │  │
│  │ (FR-001~005)│  │(FR-011~016)│  │(FR-017~023)│  │(FR-024~029)│  │
│  └─────┬──────┘  └─────▲──────┘  └─────▲──────┘  └─────▲─────┘  │
│        │ FormData        │ SSE           │ SSE           │ SSE    │
│        │ (recognize)     │ (fetch)       │ (fetch)       │        │
└────────┼────────────────┼───────────────┼───────────────┼────────┘
         │                │               │               │
┌────────▼────────────────▼───────────────▼───────────────▼────────┐
│  Server Action 层（非流式）        │  Route Handler 层（流式）      │
│  ┌──────────────────────────┐     │  ┌──────────────────────────┐ │
│  │ recognizeImage            │     │  │ POST /api/solution       │ │
│  │ (app/[locale]/actions.ts) │     │  │ (app/api/solution/...)   │ │
│  │ Zod 验证 + useActionState │     │  │ SSE 流式编排 Stage1+2    │ │
│  │ (FR-003)                  │     │  │ ReadableStream + SSE     │ │
│  └────────────┬──────────────┘     │  └────────────┬─────────────┘ │
└───────────────┼────────────────────┼───────────────┼───────────────┘
                │                    │               │
┌───────────────▼────────────────────▼───────────────▼───────────────┐
│                    AI 服务层（Service Layer）                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ image-       │  │ solution-    │  │ flowchart- │  │ mindmap- │  │
│  │ recognition- │  │ service      │  │ service    │  │ service  │  │
│  │ service      │  │ (Stage1)     │  │ (Stage2)   │  │ (Stage2) │  │
│  └──────────────┘  └──────────────┘  └────────────┘  └──────────┘  │
│  统一 ServiceResult<T> 返回 + Zod schema 校验 LLM 输出 + 单例导出    │
│  clients/llm-client.ts + clients/vision-client.ts（OpenAI 兼容）     │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 关键架构决策（ADR 摘要）

| ADR | 决策 | 背景 | 结论 | 风险 |
|-----|------|------|------|------|
| ADR-01 | SSE 走 Route Handler 而非 Server Action | Server Action 标准模式（useActionState + form action）无法消费流式 ReadableStream | `generateSolution` 用 Route Handler，`recognizeImage` 保留 Server Action | 中：偏离 dev-workflow.md "优先 Server Actions"，已作为合理例外声明 |
| ADR-02 | fetch + ReadableStream 而非 EventSource | 生成解答需 POST 提交题目文本与可选标准答案，EventSource 仅支持 GET | 前端用 fetch + ReadableStream + TextDecoder 解析 SSE | 低：不实现自动重连，由用户手动重试 |
| ADR-03 | 混合两阶段编排（方案 C） | 代码与分析强相关宜合并调用，流程图与思维导图相互独立宜并行 | Stage 1 单次调用 + Stage 2 并行调用 | 中：Stage 1 失败整体中止 |
| ADR-04 | Stage 1 标记分流（`<<<CODE>>>`/`<<<ANALYSIS>>>`） | 单次调用需同时生成代码与分析，且需流式分流推送 | LLM 输出带结构化标记，服务层状态机解析 | 中：LLM 可能不按标记输出，需降级处理 |
| ADR-05 | ReactFlow 复用于流程图与思维导图 | 避免引入第二个图库，降低包体积与学习成本 | 统一使用 @xyflow/react + dagre 布局 | 低：思维导图树形布局需自定义 |
| ADR-06 | OpenAI 兼容 SDK 统一多模型接入 | GLM/DeepSeek/Kimi/Qwen 均提供 OpenAI 兼容接口 | 统一 client + 配置驱动，模型切换不改代码 | 低：各厂商兼容度差异需测试 |
| ADR-07 | Shiki 服务端渲染代码高亮 | 避免客户端 JS 开销，自动转义 HTML 防 XSS | Stage 1 完成后用 Shiki 重新高亮 | 低：流式阶段显示纯文本 |

---

## 2. 模块划分

### 2.1 模块清单

| # | 模块 | 职责 | 覆盖 FR |
|---|------|------|---------|
| M1 | 输入模块 | 题目文本输入、图片上传与识别、标准答案补充、重新生成触发 | FR-001~FR-005 |
| M2 | AI 编排模块 | 混合两阶段编排、SSE 流式输出、Stage 2 并行容错、模型配置 | FR-006~FR-010 |
| M3 | 代码展示模块 | Shiki 语法高亮、行号、复制、流式追加与完成后重高亮 | FR-011~FR-013 |
| M4 | 分析展示模块 | Markdown 渲染、流式追加、标准答案标签 | FR-014~FR-016 |
| M5 | 流程图模块 | ReactFlow 渲染、6 种节点、hover tooltip、回边虚线、缩放平移 | FR-017~FR-023 |
| M6 | 思维导图模块 | ReactFlow 树形布局、3 层默认展开、折叠徽章、详情面板、层级视觉 | FR-024~FR-029 |
| M7 | 整体布局模块 | Tab 切换、流式加载状态 | FR-030~FR-031 |

### 2.2 模块职责与边界

**M1 输入模块**
- 边界：仅负责输入采集与识别触发，不直接调用 AI 模型；通过 Server Action `recognizeImage` 调用图片识别服务
- 输入：用户文本/图片/标准答案文件
- 输出：题目文本字符串、可选标准答案字符串、生成模式标记（普通/基于标准答案深度解读）

**M2 AI 编排模块**
- 边界：编排层不直接渲染 UI，通过 SSE 事件向前端推送产物；调用 4 个 AI 服务但不感知具体模型
- 输入：题目文本、可选标准答案、生成模式
- 输出：SSE 事件流（code-chunk/analysis-chunk/flowchart/mindmap 等）

**M3 代码展示模块**
- 边界：仅消费 `code-chunk` 与 `stage1-done` 事件，不感知 Stage 2
- 输入：SSE code-chunk 事件流
- 输出：高亮代码 HTML（Shiki 服务端渲染）+ 复制按钮

**M4 分析展示模块**
- 边界：仅消费 `analysis-chunk` 事件，不感知 Stage 2
- 输入：SSE analysis-chunk 事件流
- 输出：渲染后 Markdown（react-markdown + remark-gfm）

**M5 流程图模块**
- 边界：仅消费 `flowchart`/`flowchart-error` 事件；回边不参与 dagre 布局计算
- 输入：Flowchart JSON（符合 FlowchartSchema）
- 输出：可交互 ReactFlow 图（hover tooltip、缩放平移、小地图）

**M6 思维导图模块**
- 边界：仅消费 `mindmap`/`mindmap-error` 事件；depth 由前端遍历计算（Schema 不含 depth）
- 输入：Mindmap JSON（符合 MindmapSchema）
- 输出：可交互 ReactFlow 树形图（折叠/展开、详情面板）

**M7 整体布局模块**
- 边界：Tab 容器协调 M3~M6，不感知 AI 编排细节
- 输入：各模块就绪状态
- 输出：Tab 切换 UI + 加载状态

### 2.3 模块依赖关系图

```
                    ┌──────────────────────────┐
                    │  M1 输入模块              │
                    │  (FR-001~005)             │
                    └────────────┬─────────────┘
                                 │ 题目文本 + 标准答案
                                 ▼
                    ┌──────────────────────────┐
                    │  M2 AI 编排模块           │
                    │  (FR-006~010)             │
                    │  Route Handler + SSE      │
                    └────────────┬─────────────┘
                                 │ SSE 事件流
            ┌────────────────────┼────────────────────┬──────────────────┐
            ▼                    ▼                    ▼                  ▼
  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
  │ M3 代码展示      │  │ M4 分析展示      │  │ M5 流程图        │  │ M6 思维导图      │
  │ (FR-011~013)    │  │ (FR-014~016)    │  │ (FR-017~023)    │  │ (FR-024~029)    │
  │ code-chunk      │  │ analysis-chunk  │  │ flowchart       │  │ mindmap         │
  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  M7 整体布局模块          │
                    │  (FR-030~031)             │
                    │  Tab 容器                 │
                    └──────────────────────────┘
```

> **依赖说明**：M3/M4/M5/M6 相互独立，均仅依赖 M2 的 SSE 事件流（四者并列消费，无横向依赖）；M7 依赖 M3~M6 的就绪状态。Stage 2 部分失败时（FR-009），M5 与 M6 互不影响。

---

## 3. 技术选型

### 3.1 技术栈表

| 层 | 技术 | 选型理由 | 覆盖 FR/NFR |
|----|------|---------|-------------|
| 框架 | Next.js App Router | 项目规范已确立 | 全局 |
| UI 组件 | shadcn/ui + Tailwind v4 | 遵循 component-rules.md，语义化 CSS 变量 | FR-030, NFR-013 |
| 图标 | lucide-react | component-rules.md 强制 | FR-018 |
| 流程图渲染 | ReactFlow（@xyflow/react） | 自定义节点、hover 交互、缩放平移 | FR-017, FR-023 |
| 思维导图渲染 | ReactFlow（树形布局） | 复用同一库，避免引入第二个图库（ADR-05） | FR-024 |
| 代码高亮 | Shiki | 服务端渲染，无客户端 JS 开销，自动转义 HTML | FR-011, NFR-017 |
| Markdown 渲染 | react-markdown + remark-gfm | 默认转义，支持表格/列表/代码块 | FR-014, NFR-017 |
| 表单验证 | Zod | code-style.md 强制，同时校验 LLM 输出 | NFR-008 |
| AI 调用 | OpenAI 兼容 SDK | GLM/DeepSeek/Kimi/Qwen 均兼容（ADR-06） | FR-010 |
| 流式输出（SSE） | Route Handler + ReadableStream | SSE 场景对"优先 Server Actions"的合理例外（ADR-01/02） | FR-007 |
| 非流式操作 | Server Action + useActionState | 图片识别等遵循标准 Server Action 模式 | FR-003 |
| 自动布局 | dagre（@dagrejs/dagre） | ReactFlow 节点自动坐标计算 | FR-017, FR-024 |
| 日志 | @/app/lib/logging/logger | dev-workflow.md 日志规范 | NFR-016 |

### 3.2 选型理由（ADR 详述）

**ADR-05 ReactFlow 复用决策**
- 背景：流程图与思维导图均需可交互图渲染，候选方案为 ReactFlow 单库复用 vs 引入第二图库（如 markmap）
- 选项对比：ReactFlow 单库（包体积 +1，学习成本 0，自定义能力强）vs markmap（包体积 +1，学习成本 +1，树形专用但自定义弱）
- 决策：ReactFlow 单库复用，思维导图用 dagre LR 树形布局 + 自定义节点实现折叠徽章
- 已知风险：思维导图折叠后需重算布局，通过 useMemo 缓存 + dagre 重新布局可见节点解决

**ADR-06 OpenAI 兼容 SDK 决策**
- 背景：需支持 GLM/DeepSeek/Kimi/Qwen 四家国产模型切换
- 选项对比：各家原生 SDK（4 套客户端，维护成本高）vs OpenAI 兼容 SDK（1 套客户端，配置驱动）
- 决策：统一 OpenAI 兼容接口，通过 `AI_TEXT_PROVIDER`/`AI_VISION_PROVIDER` 环境变量切换 baseURL 与 apiKey
- 已知风险：各厂商兼容度差异（如 vision 接口参数），需在 Phase 1 验证

---

## 4. 数据流设计

### 4.1 AI 编排流程（混合方案 C，FR-006）

```
用户提交题目（题目文本 + 可选标准答案）
  ↓
Stage 1：代码生成 + 解题分析（单次调用，文本模型，FR-006/007）
  ├─ 输入：题目文本（+可选标准答案）
  ├─ 输出：带结构化标记的文本（见 §4.2 输出协议）
  └─ 流式：SSE 逐 token 推送，服务层解析标记后分流为 code-chunk / analysis-chunk
  ↓ code + analysis 作为上下文
Stage 2：流程图 JSON + 思维导图 JSON（并行调用，文本模型，FR-006/008/009）
  ├─ flowchart-service ──┐
  │  输入：题目+代码       │ 并行（独立容错）
  │  输出：Flowchart JSON  │
  ├─ mindmap-service ─────┘
  │  输入：题目+代码
  │  输出：Mindmap JSON
  └─ 各自一次性推送完整 JSON（失败各自推送 *-error 事件）
  ↓
前端渲染全部产物（Tab 切换，FR-030/031）
```

### 4.2 Stage 1 数据流（含输出协议与状态机，FR-007/013/015）

#### 4.2.1 Stage 1 LLM 输出协议

Stage 1 单次调用需同时生成代码与分析两部分，约定 LLM 输出带结构化标记的文本格式：

```
<<<CODE>>>
{C++ 代码内容}
<<<ANALYSIS>>>
{解题分析 Markdown 内容}
```

#### 4.2.2 服务层状态机解析规则

服务层在 `prompts/solution-prompt.ts` 中定义输出模板，并在流式消费时按标记状态机解析：

1. 服务层维护当前区段状态：`pending` → `code` → `analysis`（单向转换，不可回退）
2. 收到 `<<<CODE>>>` 标记 → 切换为 `code` 状态，后续 token 作为 `code-chunk` 事件推送
3. 收到 `<<<ANALYSIS>>>` 标记 → 切换为 `analysis` 状态，后续 token 作为 `analysis-chunk` 事件推送
4. 标记本身不推送给前端，仅作服务层分隔符
5. 若 LLM 未输出标记（异常情况），服务层将全部内容作为 `analysis-chunk` 推送，记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志，前端代码区显示降级 UI

#### 4.2.3 边界场景处理

| 场景 | 处理策略 |
|------|---------|
| 标记分片 | 服务层维护标记缓冲区。当缓冲区内容可能是标记前缀（如 `<`、`<<`、`<<<`、`<<<C`...）时暂不推送，持续累积直到确认不是任何标记前缀（则作为普通文本推送缓冲区内容并清空）或完整匹配标记（则触发状态切换并清空缓冲区）。标记最大长度按 `<<<ANALYSIS>>>`（15 字符）封顶，缓冲区超过此长度仍未匹配则判定为普通文本 |
| 标记重复 | 仅识别第一次出现的标记并触发状态切换；后续重复出现的标记作为普通文本推送 |
| 标记乱序/嵌套 | 状态机仅允许 `pending→code→analysis` 单向转换。`analysis` 状态后收到 `<<<CODE>>>` 视为普通文本推送；`code` 状态前收到 `<<<ANALYSIS>>>` 视为普通文本推送 |
| 标记全部缺失 | LLM 未输出任何标记。服务层将全部内容作为 `analysis-chunk` 推送，记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志。Stage 1 流结束时 `code` 区段无内容，`stage1-done` 事件携带 `codeEmpty: true`，前端代码区显示降级 UI（见 §4.2.4） |
| 标记部分缺失（仅 CODE 无 ANALYSIS） | LLM 仅输出 `<<<CODE>>>` 未输出 `<<<ANALYSIS>>>`。状态机停在 `code` 状态，后续所有内容作为 `code-chunk` 推送，`analysis` 区段无内容。Stage 1 流结束时 `analysis` 区段为空，`stage1-done` 事件携带 `analysisEmpty: true`，前端分析区显示降级 UI（见 §4.2.4）。服务层记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志 |
| 标记部分缺失（仅 ANALYSIS 无 CODE） | LLM 未输出 `<<<CODE>>>` 但输出了 `<<<ANALYSIS>>>`。`code` 区段无内容，`analysis` 区段有内容。Stage 1 流结束时 `code` 区段为空，`stage1-done` 事件携带 `codeEmpty: true`，前端代码区显示降级 UI（见 §4.2.4）。服务层记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志 |

#### 4.2.4 降级 UI

Stage 1 标记异常（全部缺失或部分缺失）时，服务层在流结束时检测各区段内容，通过 `stage1-done` 事件 data 字段携带 `{ codeEmpty: boolean, analysisEmpty: boolean }` 标志（见 §4.4.1 事件清单），前端据此渲染对应区域的降级 UI：

| 场景 | codeEmpty | analysisEmpty | 代码区 UI | 分析区 UI |
|------|-----------|---------------|----------|----------|
| 标记全部缺失 | true | false | 显示「代码生成异常，请重试」+「重新生成」按钮 | 正常展示（全部内容作为分析推送） |
| 仅 CODE 无 ANALYSIS | false | true | 正常展示 | 显示「分析生成异常，请重试」+「重新生成」按钮 |
| 仅 ANALYSIS 无 CODE | true | false | 显示「代码生成异常，请重试」+「重新生成」按钮 | 正常展示 |
| 标记完整（正常） | false | false | 正常展示（Shiki 高亮） | 正常展示（Markdown 渲染） |

> **降级 UI 实现说明**：「重新生成」按钮复用 M1 输入模块的重新生成触发逻辑（FR-005），用户点击后重新发起 POST `/api/solution` 请求。降级 UI 仅在对应区段无内容时显示，不影响其他区段正常展示。

### 4.3 Stage 2 数据流（并行容错，FR-008/009）

```
Stage 1 完成（stage1-done 事件）
  ↓
Route Handler 并行触发：
  ├─ flowchartService.generate({ problem, code })
  │   ├─ 成功 → 推送 event: flowchart（完整 JSON）
  │   └─ 失败（重试 2 次后）→ 推送 event: flowchart-error
  └─ mindmapService.generate({ problem, code })
      ├─ 成功 → 推送 event: mindmap（完整 JSON）
      └─ 失败（重试 2 次后）→ 推送 event: mindmap-error
  ↓
两者互不影响（独立 try-catch），全部完成后推送 event: done
```

> **JSON 校验失败重试**（NFR-005）：LLM 输出 JSON 通过 Zod 校验失败时自动重试，最多 2 次。重试时附错误信息让模型修正。

### 4.4 SSE 事件流设计（FR-007/008/009）

#### 4.4.1 事件清单

| 事件 | 触发时机 | data 字段格式 | 前端响应 |
|------|---------|--------------|---------|
| `stage1-start` | Stage 1 开始 | `{}` | 显示「正在生成代码与分析...」 |
| `code-chunk` | Stage 1 代码 token | `{ "content": string }` | 逐块追加到代码区（纯文本） |
| `analysis-chunk` | Stage 1 分析 token | `{ "content": string }` | 逐块追加到分析区（实时 Markdown 渲染） |
| `stage1-done` | Stage 1 完成 | `{ "codeEmpty": boolean, "analysisEmpty": boolean }` | 代码区用 Shiki 重新高亮（FR-013）；依据 `codeEmpty`/`analysisEmpty` 标志渲染对应区域降级 UI（见 §4.2.4） |
| `stage2-start` | Stage 2 开始 | `{}` | 显示「正在生成流程图与思维导图...」 |
| `flowchart` | 流程图生成成功 | 完整 Flowchart JSON | 渲染流程图（FR-017~023） |
| `flowchart-error` | 流程图生成失败 | `{ "code": string, "message": string }` | 流程图区显示重试按钮（FR-009） |
| `mindmap` | 思维导图生成成功 | 完整 Mindmap JSON | 渲染思维导图（FR-024~029） |
| `mindmap-error` | 思维导图生成失败 | `{ "code": string, "message": string }` | 思维导图区显示重试按钮（FR-009） |
| `done` | 全部结束（含部分失败） | `{}` | 前端依据已收到事件判断各模块状态 |
| `error` | Stage 1 致命错误 | `{ "code": string, "message": string }` | 整体中止，显示错误提示 |

#### 4.4.2 事件顺序约定

- `event: error`（Stage 1 致命错误）发送后**立即关闭流，不再发送** `event: done`
- 前端依据是否收到 `event: error` 判断是否为致命错误中止：收到 `error` → 致命错误中止；流正常关闭且未收到 `error` → 正常结束（可能含部分失败）
- 正常流程事件顺序：`stage1-start` → `code-chunk`*N → `analysis-chunk`*N → `stage1-done` → `stage2-start` → (`flowchart`|`flowchart-error`) + (`mindmap`|`mindmap-error`) → `done`

#### 4.4.3 断线重连与取消机制

- **断线重连**：POST 请求无法使用 EventSource 自动重连，本系统**不实现自动重连**。前端检测到连接中断（fetch 的 ReadableStream 抛出网络错误或 abort）后，显示「连接中断，请重试」提示，由用户手动重新触发生成
- **AbortController 取消**（FR-031 流式过程可控）：
  - 前端：用户点击「取消生成」时，调用 `AbortController.abort()` 中止 fetch 请求
  - 服务端：Route Handler 通过 `request.signal` 监听 abort 事件，触发时停止 LLM 调用（关闭底层 LLM 流式连接）并关闭 SSE 流，记录 `CPP_AI_GENERATION_CANCELLED`（用户主动取消，info 级别日志）；若为 LLM 调用超时（非用户主动），则记录 `CPP_AI_LLM_TIMEOUT`（error 级别日志）
  - 取消后前端清理流式状态，恢复到可重新生成状态

---

## 5. 接口定义

### 5.1 ServiceResult<T> 统一返回格式（遵循 api-conventions.md）

```typescript
// app/lib/ai/types.ts
export type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;    // MODULE_CATEGORY_SPECIFIC 格式，本系统统一 CPP_ 前缀
    message: string;
  };
};
```

### 5.2 Server Action：recognizeImage（FR-003）

**位置**：`app/[locale]/actions.ts`（首页专属 Server Action，遵循 api-conventions.md "页面专属 Action 放同目录 actions.ts"）

```typescript
// app/[locale]/actions.ts
'use server';

import { z } from 'zod';
import { imageRecognitionService } from '@/app/lib/ai/services/image-recognition-service';
import type { ServiceResult } from '@/app/lib/ai/types';

const recognizeImageSchema = z.object({
  imageBase64: z.string().min(1, '图片数据不能为空'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export async function recognizeImage(
  formData: FormData,
): Promise<ServiceResult<{ text: string }>> {
  try {
    const parsed = recognizeImageSchema.safeParse({
      imageBase64: formData.get('imageBase64'),
      mimeType: formData.get('mimeType'),
    });
    if (!parsed.success) {
      return {
        success: false,
        error: {
          code: 'CPP_INPUT_VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? '输入校验失败',
        },
      };
    }
    // 图片识别结果通过 return 值传回前端（useActionState），无持久化，
    // 故无需 revalidatePath 刷新缓存（api-conventions.md 中 revalidatePath 适用于"数据持久化后刷新缓存"场景）
    const result = await imageRecognitionService.recognize(parsed.data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'CPP_AI_VISION_RECOGNITION_FAILED',
        message: '图片识别失败，请重试',
      },
    };
  }
}
```

> **revalidatePath 说明**（遵循 api-conventions.md）：recognizeImage 通过 `useActionState` 将识别文本以 return 值传回前端，不依赖 Server Component 重新渲染获取数据，且 MVP 无持久化（spec §5.1），故不调用 `revalidatePath`。api-conventions.md Server Action 流程示例中的 `revalidatePath` 适用于"数据持久化后刷新缓存"场景，图片识别不在此列。

> **前端消费**：使用 `useActionState` 配合 `<form action={action}>`，`isPending` 控制识别按钮状态（遵循 api-conventions.md 表单处理规范）。

### 5.3 Route Handler：generateSolution（SSE 流式，FR-006~009）

**位置**：`app/api/solution/route.ts`

#### 5.3.1 请求契约

```typescript
// 请求方法：POST
// 请求头：Content-Type: application/json
// 请求体：
interface SolutionRequestBody {
  problem: string;           // 题目文本，≤ 10000 字符
  standardAnswer?: string;   // 可选标准答案，≤ 20000 字符
  mode: 'normal' | 'deep';   // normal=普通生成，deep=基于标准答案深度解读
}
```

#### 5.3.2 响应契约

```typescript
// 响应头：
// Content-Type: text/event-stream
// Cache-Control: no-cache, no-transform
// Connection: keep-alive
// X-Accel-Buffering: no（禁用代理缓冲）

// 响应体：SSE 事件流（见 §4.4.1 事件清单）
// 每个 SSE 事件格式：
// event: {eventName}\n
// data: {jsonString}\n\n
```

#### 5.3.3 Route Handler 签名

```typescript
// app/api/solution/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { solutionService } from '@/app/lib/ai/services/solution-service';
import { flowchartService } from '@/app/lib/ai/services/flowchart-service';
import { mindmapService } from '@/app/lib/ai/services/mindmap-service';
import { logger } from '@/app/lib/logging/logger';

const solutionRequestSchema = z.object({
  problem: z.string().min(1).max(10000),
  standardAnswer: z.string().max(20000).optional(),
  mode: z.enum(['normal', 'deep']),
});

export async function POST(request: NextRequest): Promise<Response> {
  // 外层 try-catch 兜底：捕获流外异常（如 Zod 验证、ReadableStream 构造过程），返回 HTTP 500
  try {
    // 1. Zod 验证请求体（流外错误 → HTTP 400）
    const json: unknown = await request.json();
    const parsed = solutionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CPP_INPUT_VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? '输入校验失败',
          },
        },
        { status: 400 },
      );
    }

    // 2. 创建 ReadableStream，封装 SSE 编排逻辑（流内错误 → SSE event: error）
    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown): void => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // 3. Stage 1：solutionService.generateStream() → 推送 stage1-start/code-chunk/analysis-chunk/stage1-done
          //    流内异常（LLM 调用失败、超时）由 generateStream 内部捕获并返回 ServiceResult，
          //    Route Handler 据 ServiceResult.success 决定推送 stage1-done 或 event: error
          // 4. Stage 2：并行 flowchartService.generate() + mindmapService.generate()
          //    → 推送 flowchart/mindmap 或 *-error（独立容错，互不影响）
          // 5. 推送 done（或 error 后立即关闭，不再发送 done）
          // 详细实现见开发阶段，此处仅定义异常处理骨架
          throw new Error('契约定义，实现见开发阶段');
        } catch (error) {
          // 流内错误：推送 event: error 后立即关闭流（不再发送 done）
          logger.error('SSE 编排失败', { error });
          send('error', {
            code: 'CPP_INTERNAL_ERROR',
            message: '系统内部错误，请稍后重试',
          });
          controller.close();
        }
      },
    });

    // 6. 通过 request.signal 监听 abort（FR-031 取消生成），触发时停止 LLM 调用并关闭流
    //    实现见开发阶段
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    // 外层兜底：流外异常返回 HTTP 500
    logger.error('Route Handler 流外异常', { error });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CPP_INTERNAL_ERROR',
          message: '系统内部错误，请稍后重试',
        },
      },
      { status: 500 },
    );
  }
}
```

> **SSE Route Handler 错误处理契约**（NFR-007 例外说明）：
> - **流外错误**（HTTP 状态码）：Zod 验证失败 → HTTP 400 + `ServiceResult<T>` 错误体；ReadableStream 构造过程异常 → HTTP 500 + `ServiceResult<T>` 错误体。此类错误发生在 SSE 流建立之前，前端通过 fetch 响应状态码与 JSON 体感知。
> - **流内错误**（SSE 事件）：Stage 1 致命错误（LLM 调用失败、超时）→ 推送 `event: error`（携带 `code`/`message`，遵循 `ServiceResult<T>` 的 `error` 字段结构）后立即关闭流，不再发送 `event: done`；Stage 2 部分失败 → 推送 `flowchart-error`/`mindmap-error`（独立容错，不关闭流，继续推送 `done`）。此类错误发生在 SSE 流建立之后，前端通过事件类型感知。
> - **禁止抛出未捕获异常**：所有异常均被 try-catch 捕获，流内异常转化为 SSE 事件，流外异常转化为 HTTP 状态码。

### 5.4 AI 服务层接口（4 个服务类，遵循 api-conventions.md 单例导出）

#### 5.4.1 ImageRecognitionService（FR-003）

```typescript
// app/lib/ai/services/image-recognition-service.ts
import type { ServiceResult } from '@/app/lib/ai/types';

interface RecognizeInput {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export class ImageRecognitionService {
  /**
   * 识别图片中的编程题目文本
   * @param input 图片数据与 MIME 类型
   * @returns 识别文本
   */
  async recognize(input: RecognizeInput): Promise<ServiceResult<{ text: string }>> {
    // 调用 vision-client（OpenAI 兼容），返回识别文本
    throw new Error('契约定义，实现见开发阶段');
  }
}

export const imageRecognitionService = new ImageRecognitionService();
```

#### 5.4.2 SolutionService（FR-006/007，Stage 1）

```typescript
// app/lib/ai/services/solution-service.ts
import type { ServiceResult } from '@/app/lib/ai/types';

interface GenerateStreamInput {
  problem: string;
  standardAnswer?: string;
  mode: 'normal' | 'deep';
}

interface StreamCallbacks {
  onCodeChunk: (content: string) => void;
  onAnalysisChunk: (content: string) => void;
  onFormatInvalid: () => void;  // 标记缺失时回调，用于记录警告日志
}

export class SolutionService {
  /**
   * 流式生成代码与分析（Stage 1）
   * @param input 题目与模式
   * @param callbacks 流式回调（按标记状态机分流）
   * @returns 完整代码与分析（用于 Stage 2 上下文）
   */
  async generateStream(
    input: GenerateStreamInput,
    callbacks: StreamCallbacks,
  ): Promise<ServiceResult<{ code: string; analysis: string }>> {
    // 调用 llm-client（OpenAI 兼容流式），按 <<<CODE>>>/<<<ANALYSIS>>> 标记状态机分流
    // 标记缺失时调用 onFormatInvalid 并将全部内容作为 analysis 推送
    throw new Error('契约定义，实现见开发阶段');
  }
}

export const solutionService = new SolutionService();
```

> **回调 + 返回值混合设计意图**：`generateStream` 采用回调与返回值并行的设计，两者职责不同：
> - **回调**（`onCodeChunk`/`onAnalysisChunk`）：用于流式推送 chunk，前端实时渲染（FR-007/013/015）。Route Handler 在回调中调用 `controller.enqueue()` 将 chunk 转化为 SSE 事件推送给前端。
> - **返回值**（`ServiceResult<{ code: string; analysis: string }>`）：用于提供完整的代码与分析文本，作为 Stage 2 的上下文输入（FR-006 Stage 2 基于 Stage 1 产物）。Route Handler 在 Stage 1 流式推送完成后，使用返回值触发 Stage 2 的 `flowchartService.generate()`/`mindmapService.generate()` 调用。
>
> 这种设计避免了 Route Handler 重新拼接 chunk 的开销（chunk 已通过回调推送，返回值由服务层内部累积），同时保证 Stage 2 拿到完整上下文。`onFormatInvalid` 回调用于标记缺失时记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志（§4.2.3 边界场景）。

#### 5.4.3 FlowchartService（FR-008，Stage 2）

```typescript
// app/lib/ai/services/flowchart-service.ts
import type { ServiceResult } from '@/app/lib/ai/types';
import type { Flowchart } from '@/app/lib/ai/schemas/flowchart-schema';

interface GenerateInput {
  problem: string;
  code: string;
}

export class FlowchartService {
  /**
   * 生成流程图 JSON（Stage 2，含 Zod 校验与重试）
   * @param input 题目与代码
   * @returns Flowchart JSON（校验失败重试最多 2 次）
   */
  async generate(input: GenerateInput): Promise<ServiceResult<Flowchart>> {
    // 调用 llm-client，输出经 FlowchartSchema 校验，失败重试最多 2 次
    throw new Error('契约定义，实现见开发阶段');
  }
}

export const flowchartService = new FlowchartService();
```

#### 5.4.4 MindmapService（FR-008，Stage 2）

```typescript
// app/lib/ai/services/mindmap-service.ts
import type { ServiceResult } from '@/app/lib/ai/types';
import type { Mindmap } from '@/app/lib/ai/schemas/mindmap-schema';

interface GenerateInput {
  problem: string;
  code: string;
}

export class MindmapService {
  /**
   * 生成思维导图 JSON（Stage 2，含 Zod 校验与重试）
   * @param input 题目与代码
   * @returns Mindmap JSON（校验失败重试最多 2 次）
   */
  async generate(input: GenerateInput): Promise<ServiceResult<Mindmap>> {
    // 调用 llm-client，输出经 MindmapSchema 校验，失败重试最多 2 次
    throw new Error('契约定义，实现见开发阶段');
  }
}

export const mindmapService = new MindmapService();
```

### 5.5 LLM 结构化输出 Schema

#### 5.5.1 FlowchartSchema（FR-017~023）

```typescript
// app/lib/ai/schemas/flowchart-schema.ts
import { z } from 'zod';

export const FlowchartSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['start', 'process', 'decision', 'loop', 'data', 'end']),
    label: z.string(),
    codeRef: z.string().optional(),        // 行号范围字符串，如 "10-15"
    requirementRef: z.string().optional(), // 题目要求编号，如 "R1"
    explanation: z.string(),
  })),
  edges: z.array(z.object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),          // decision 出边标签，如 "是"/"否"
    explanation: z.string().optional(),    // 边路径说明（FR-022 hover tooltip）
    isBackEdge: z.boolean().optional(),    // 回边标记（FR-021 loop 回边虚线）
  })),
});

export type Flowchart = z.infer<typeof FlowchartSchema>;
```

**字段格式约定**：
- `codeRef`：行号范围字符串（如 `"10-15"` 表示第 10-15 行），无对应代码时省略。前端据此在 hover tooltip 中展示对应代码行号（FR-020）
- `requirementRef`：题目要求编号（如 `"R1"`、`"R2"`，由 LLM 根据题目要求自动编号），无对应要求时省略。前端据此渲染节点徽章（FR-019）

**回边判定规则**（FR-021）：
- `isBackEdge: true` 标记循环回边，前端渲染虚线边
- 判定方式：LLM 在生成时对回边显式标记 `isBackEdge: true`；服务层校验时若 `target` 节点在 `source` 节点之前出现（按 nodes 数组顺序），也自动判定为回边并设置该字段
- 回边不参与 dagre 布局计算（避免循环引用导致布局死循环）
- `isBackEdge` 与节点类型无强绑定关系，任何类型的节点出边只要满足条件即为回边

#### 5.5.2 MindmapSchema（FR-024~029，递归类型）

```typescript
// app/lib/ai/schemas/mindmap-schema.ts
import { z } from 'zod';

// 先声明类型，再用 z.ZodType 标注 schema，最后在 children 中通过 z.lazy 递归引用
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

**递归类型说明**：先声明 `MindmapNode` 类型，再用 `z.ZodType<MindmapNode>` 标注 `MindmapNodeSchema`，最后在 `children` 中通过 `z.lazy(() => z.array(MindmapNodeSchema))` 实现递归引用，避免引用未定义标识符。

**层级 depth 说明**：Schema 不含 depth 字段。层级 `depth` 由前端遍历树结构计算（根节点 `depth=0`，逐层 +1），前端根据 depth 控制默认展开（`depth < 3` 展开，FR-025）与视觉样式（FR-029）。

### 5.6 错误码表（CPP_ 前缀，遵循 api-conventions.md）

| 错误码 | 触发场景 | 返回 message 示例 | 覆盖 NFR |
|--------|---------|------------------|----------|
| `CPP_INPUT_VALIDATION_ERROR` | 用户输入未通过 Zod 校验（文本超长、文件类型/大小不符） | 题目文本超过 10000 字符上限 | NFR-008/010 |
| `CPP_AI_VISION_RECOGNITION_FAILED` | 图片识别服务调用失败（模型异常、网络错误） | 图片识别失败，请重试 | NFR-006 |
| `CPP_AI_SOLUTION_GENERATION_FAILED` | Stage 1 代码+分析生成失败（非格式问题） | 解答生成失败，请重试 | NFR-006 |
| `CPP_AI_SOLUTION_FORMAT_INVALID` | Stage 1 LLM 输出未包含 `<<<CODE>>>`/`<<<ANALYSIS>>>` 标记（全部缺失或部分缺失） | 解答格式异常，已降级处理 | NFR-006 |
| `CPP_AI_FLOWCHART_GENERATION_FAILED` | 流程图 JSON 生成失败（重试 2 次后仍失败） | 流程图生成失败，可重试 | NFR-005/006 |
| `CPP_AI_MINDMAP_GENERATION_FAILED` | 思维导图 JSON 生成失败（重试 2 次后仍失败） | 思维导图生成失败，可重试 | NFR-005/006 |
| `CPP_AI_JSON_VALIDATION_FAILED` | LLM 输出 JSON 通过 Zod 校验失败 | 流程图数据格式校验失败 | NFR-005 |
| `CPP_AI_LLM_TIMEOUT` | LLM 调用超时（超过 NFR-001/002 时限，服务端异常） | 模型响应超时，请重试 | NFR-001/002 |
| `CPP_AI_GENERATION_CANCELLED` | 前端取消生成（用户主动点击「取消生成」触发 AbortController.abort） | 已取消生成 | FR-031 |
| `CPP_INTERNAL_ERROR` | 未预期的服务端异常（兜底） | 系统内部错误，请稍后重试 | NFR-007 |

**错误码使用约定**：
- **Server Action**（recognizeImage）：返回 `ServiceResult<T>`，`error.code` 取自上表
- **SSE 流式 Route Handler**（`app/api/solution/route.ts`）：作为 NFR-007 中"返回 `ServiceResult<T>`"要求的合理例外，错误信息通过 SSE 事件（`flowchart-error`/`mindmap-error`/`error`）携带，事件 data 字段中的 `code`/`message` 遵循 `ServiceResult<T>` 的 `error` 字段结构
- **Stage 2 部分失败**：流程图与思维导图各自返回独立错误码，互不影响（FR-009）
- **超时与取消区分**（AR1-011）：`CPP_AI_LLM_TIMEOUT` 仅用于服务端 LLM 调用超时（异常场景，记录 `logger.error`，前端显示"模型响应超时，请重试"）；`CPP_AI_GENERATION_CANCELLED` 仅用于用户主动取消生成（正常用户行为，记录 `logger.info`，前端显示"已取消生成"不视为错误）。两者语义不同，共用错误码会导致日志分析时无法区分且前端 UI 处理不一致

---

## 6. 目录结构

### 6.1 服务层结构（遵循 api-conventions.md 单例导出）

```
app/lib/
  ai/
    services/
      image-recognition-service.ts   # 图片识别服务（多模态，FR-003）
      solution-service.ts            # 代码+分析生成服务（Stage 1，FR-006/007）
      flowchart-service.ts           # 流程图 JSON 生成服务（Stage 2，FR-008）
      mindmap-service.ts             # 思维导图 JSON 生成服务（Stage 2，FR-008）
    schemas/
      flowchart-schema.ts            # FlowchartSchema Zod 定义 + 类型导出（FR-017~023）
      mindmap-schema.ts              # MindmapSchema Zod 定义 + 递归类型（FR-024~029）
    prompts/
      solution-prompt.ts             # 代码+分析 Prompt 模板（含 §4.2 输出协议标记）
      flowchart-prompt.ts            # 流程图 Prompt（含 schema + few-shot，FR-019/020）
      mindmap-prompt.ts              # 思维导图 Prompt
    clients/
      llm-client.ts                  # 统一 OpenAI 兼容客户端（文本模型，ADR-06）
      vision-client.ts               # 视觉模型客户端（多模态）
    config.ts                        # 模型配置（从 env 读取，FR-010）
    types.ts                         # ServiceResult<T> 等共享类型
  env.ts                             # 环境变量验证（validateEnv，spec §10）
  logging/
    logger.ts                        # 应用日志（dev-workflow.md 日志规范，NFR-016）
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

### 6.2 前端组件结构（遵循 component-rules.md / dev-workflow.md）

```
components/
  ui/                               # shadcn/ui 基础组件（Button、Input、Card、Tabs 等）

app/
  api/
    solution/
      route.ts                       # SSE 流式 Route Handler（POST，编排 Stage1+Stage2，FR-006~009）
    health/
      route.ts                       # 健康检查端点（GET，返回 { status, timestamp }，spec §10）
  [locale]/
    layout.tsx                       # 根布局（Server Component，仅渲染，不包含交互逻辑）
    layout-client.tsx                # 布局客户端（Client Component，处理交互；MVP 简化但结构预留）
    actions.ts                       # 首页专属 Server Actions（recognizeImage，FR-003）
    page.tsx                         # 首页（题目输入，FR-001/002）
    components/
      problem-input.tsx              # 题目输入区（文本+图片上传+识别按钮，FR-001~003）
      standard-answer-input.tsx      # 标准答案补充区（可折叠，FR-004/005）
    solution/
      page.tsx                       # 解题结果页（Server Component，渲染壳结构与布局，不参与 SSE 数据获取；数据由 solution-tabs.tsx 通过 fetch 消费）
      components/
        solution-tabs.tsx            # Tab 切换 + 流式状态管理（fetch + ReadableStream + TextDecoder 消费 SSE，FR-030/031）
        code-display.tsx             # 代码展示（Shiki + 复制，FR-011~013）
        analysis-display.tsx         # 分析展示（Markdown，FR-014~016）
        flowchart-display.tsx        # 流程图容器（ReactFlow，FR-017/023）
        flowchart-node.tsx           # 自定义节点（hover tooltip，FR-018~020）
        flowchart-edge.tsx           # 自定义边（hover tooltip + 回边虚线，FR-021/022）
        flowchart-layout.ts          # dagre 布局（回边不参与布局计算，FR-017）
        mindmap-display.tsx          # 思维导图容器 + 折叠状态（FR-024/027）
        mindmap-node.tsx             # 自定义节点（折叠徽章，FR-026/029）
        mindmap-detail-panel.tsx     # 右侧详情面板（FR-028）
        mindmap-layout.ts            # dagre LR 布局 + 折叠过滤（FR-024/025）
```

### 6.3 规范遵循说明

| 规范文件 | 遵循要点 |
|---------|---------|
| `dev/dev-workflow.md` | Server Component 优先；Layout 拆分（layout.tsx + layout-client.tsx）；页面粒度 ≤ 300 行；日志规范（logger/logClientError） |
| `dev/api-conventions.md` | Server Action 位置（页面专属放同目录 actions.ts）；ServiceResult<T> 统一返回；错误码 MODULE_CATEGORY_SPECIFIC 格式（CPP_ 前缀）；服务单例导出 |
| `dev/component-rules.md` | 组件目录结构（components/ui + app/[locale]/.../components）；图标统一 lucide-react；皮肤设计规范（读取 design/happyrabbit/DESIGN.md）；语义化 CSS 变量（禁止 bg-white 等原始值） |
| `global/code-style.md` | 显式返回类型；禁止 any（用 unknown）；import type；@/ 绝对路径；单文件 ≤ 500 行；Zod 验证所有输入 |
| `global/naming-conventions.md` | 文件 kebab-case；组件 PascalCase；服务单例 camelCase；错误码 MODULE_CATEGORY_SPECIFIC |

**Server Action 位置说明**（遵循 api-conventions.md "页面专属 Action 放同目录 actions.ts"）：
- `recognizeImage` 在首页（`app/[locale]/page.tsx`）触发，故放在首页同目录 `app/[locale]/actions.ts`，使用标准 Server Action + `useActionState` 模式
- `generateSolution` 为 SSE 流式操作，改用 Route Handler（`app/api/solution/route.ts`）实现，前端通过 `fetch` + `ReadableStream` 消费（见 §1.3 ADR-01/02）

**solution/page.tsx 数据流说明**（AR1-004）：`app/[locale]/solution/page.tsx` 作为 Server Component 仅渲染初始 HTML 壳结构（布局、Tab 容器占位），**不参与 SSE 流式数据获取**。SSE 流式数据由 `solution-tabs.tsx`（Client Component）在客户端 mount 后发起 `POST /api/solution` 请求，通过 `fetch` + `ReadableStream` + `TextDecoder` 消费 SSE 事件流（见 §5.3 Route Handler 契约）。此设计遵循 dev-workflow.md "Server Component 获取数据后传递给 Client Component 处理交互"——但本场景中 SSE 流式数据无法由 Server Component 获取（Server Component 不支持消费流式响应），故数据获取完全由 Client Component 完成，Server Component 仅负责壳结构渲染。

**Layout 拆分**（遵循 dev-workflow.md）：`layout.tsx`（Server Component）仅渲染不包含交互逻辑，调用 `layout-client.tsx`（Client Component）处理交互（useState、事件监听等）。MVP 阶段 `layout-client.tsx` 可简化，但结构应预留以符合规范。

**皮肤设计规范**（遵循 component-rules.md "生成 UI 时必须读取当前皮肤对应的 design/{skin-name}/DESIGN.md"）：MVP 使用默认皮肤 `happyrabbit`，UI 实现时读取 `design/happyrabbit/DESIGN.md` 获取设计 Token（颜色、字号、圆角、间距等语义变量）。

### 6.4 solution-tabs.tsx 组件设计要点（AR1-010）

`solution-tabs.tsx` 是整个前端编排的核心组件，负责消费 SSE 事件流并协调 M3~M6 四个展示模块的渲染状态。设计要点如下：

#### 6.4.1 SSE 消费流程

```
fetch('/api/solution', { method: 'POST', body, signal })
  → response.body（ReadableStream）
  → TextDecoder 解码为字符串
  → 按 SSE 协议解析（`event:` / `data:` 前缀，`\n\n` 分隔事件）
  → 根据 event 类型分发到对应 state 更新函数
```

- 使用 `TextDecoder` 流式解码，避免一次性读取整个响应体
- 维护解析缓冲区，处理 chunk 边界截断 `event:`/`data:` 行的情况（按 `\n\n` 完整事件分隔符切分，不完整的尾部留在缓冲区等待下一个 chunk）

#### 6.4.2 Tab 就绪状态机（FR-031）

| Tab | 初始状态 | 就绪条件 | 错误条件 |
|-----|---------|---------|---------|
| 代码 | pending | 收到首个 `code-chunk` 或 `stage1-done`（`codeEmpty: false`） | 收到 `stage1-done` 且 `codeEmpty: true` → error（降级 UI） |
| 分析 | pending | 收到首个 `analysis-chunk` 或 `stage1-done`（`analysisEmpty: false`） | 收到 `stage1-done` 且 `analysisEmpty: true` → error（降级 UI） |
| 流程图 | pending | 收到 `flowchart` 事件 → ready | 收到 `flowchart-error` → error（重试按钮） |
| 思维导图 | pending | 收到 `mindmap` 事件 → ready | 收到 `mindmap-error` → error（重试按钮） |

- 状态流转：`pending` → `loading` → `ready` | `error`
- 流式过程中已就绪 Tab 可查看，未就绪 Tab 显示加载状态（FR-031）

#### 6.4.3 部分失败处理（FR-009）

- `flowchart-error`：仅流程图 Tab 切换为 error 状态并显示重试按钮，其他 Tab 不受影响
- `mindmap-error`：仅思维导图 Tab 切换为 error 状态并显示重试按钮，其他 Tab 不受影响
- 重试按钮点击后，单独重新发起该模块的生成请求（需 Route Handler 支持单模块重试端点，或重新发起完整生成——MVP 阶段采用重新发起完整生成，后续可优化为单模块重试）

#### 6.4.4 AbortController 生命周期（FR-031）

- **创建**：用户触发生成时创建 `AbortController` 实例，`signal` 传入 `fetch` 请求
- **取消**：用户点击「取消生成」时调用 `controller.abort()`，fetch 抛出 `AbortError`
- **清理**：捕获 `AbortError` 后清理流式状态（重置 Tab 状态机为 pending、清空已接收的 chunk 数据），恢复到可重新生成状态；记录 `CPP_AI_GENERATION_CANCELLED`（前端通过 `logClientError()` 记录，info 级别）
- **完成**：收到 `done` 或 `error` 事件后，流自然关闭，AbortController 实例可被垃圾回收

---

## 7. 依赖关系

### 7.1 外部依赖（spec §10）

| 依赖 | 说明 | 协议 |
|------|------|------|
| Next.js App Router | 框架（项目规范已确立） | MIT |
| ReactFlow（@xyflow/react） | 流程图与思维导图渲染 | MIT |
| dagre（@dagrejs/dagre） | ReactFlow 节点自动布局 | MIT |
| Shiki | 代码语法高亮（服务端渲染） | MIT |
| react-markdown + remark-gfm | Markdown 渲染 | MIT |
| Zod | 表单与 LLM 输出校验 | MIT |
| OpenAI 兼容 SDK | 多模型统一接入 | MIT |
| shadcn/ui + Tailwind v4 | UI 组件与样式 | MIT |
| lucide-react | 图标 | MIT |
| Node.js 20+ | 运行环境 | — |
| 各模型 API Key | GLM/DeepSeek/Kimi/Qwen，配入 `.env.local` | 商用 |
| 无需数据库 | MVP 无状态 | — |

### 7.2 模块间依赖

| 上游模块 | 下游模块 | 依赖方式 |
|---------|---------|---------|
| M1 输入模块 | M2 AI 编排模块 | 题目文本 + 标准答案通过 POST 请求体传递 |
| M2 AI 编排模块 | M3 代码展示模块 | SSE `code-chunk`/`stage1-done` 事件 |
| M2 AI 编排模块 | M4 分析展示模块 | SSE `analysis-chunk` 事件 |
| M2 AI 编排模块 | M5 流程图模块 | SSE `flowchart`/`flowchart-error` 事件 |
| M2 AI 编排模块 | M6 思维导图模块 | SSE `mindmap`/`mindmap-error` 事件 |
| M3~M6 | M7 整体布局模块 | 各模块就绪状态（用于 Tab 加载状态） |
| Route Handler | solutionService | Stage 1 流式调用 |
| Route Handler | flowchartService + mindmapService | Stage 2 并行调用（独立容错） |
| Server Action recognizeImage | imageRecognitionService | 非流式调用 |

### 7.3 环境变量（spec §10）

```env
# AI 模型配置（FR-010）
AI_VISION_PROVIDER=kimi              # kimi | qwen
AI_VISION_MODEL=kimi-vision
AI_TEXT_PROVIDER=glm                 # glm | deepseek | kimi | qwen
AI_TEXT_MODEL=glm-5.2

# 各厂商 API Key（仅服务端，禁止 NEXT_PUBLIC_ 前缀，NFR-009）
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

**环境变量验证机制**（遵循 env-management.md "推荐在构建前验证必需的环境变量"）：

新增 `app/lib/env.ts`，在 AI 服务层方法内部首次调用时验证必需环境变量，缺失时抛出明确错误（早期失败，避免运行时才报错）：

```typescript
// app/lib/env.ts
const requiredEnvVars = [
  'AI_VISION_PROVIDER',
  'AI_VISION_MODEL',
  'AI_TEXT_PROVIDER',
  'AI_TEXT_MODEL',
] as const;

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

// 模块级缓存标志：首次校验通过后置为 true，后续调用直接 return，避免重复遍历环境变量
let envValidated = false;

export function validateEnv(): void {
  // 缓存命中：已校验通过，直接返回，避免每次 AI 服务调用都重复校验
  if (envValidated) {
    return;
  }

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

  // 校验全部通过后置为 true，后续调用直接 return
  envValidated = true;
}
```

> **调用时机**：`validateEnv()` 在 AI 服务层方法内部首次调用时执行（非模块级调用），确保仅 AI 功能受环境变量缺失影响，不影响健康检查（`/api/health`）等其他端点。具体调用位置为 `image-recognition-service.ts`、`solution-service.ts`、`flowchart-service.ts`、`mindmap-service.ts` 各服务方法的入口处。
>
> **缓存机制说明**（AR1-012）：采用模块级布尔标志 `envValidated` 实现首次执行一次、后续跳过的缓存机制。首次调用时执行完整校验逻辑（遍历 `requiredEnvVars` + 校验对应 provider 的 API Key 与 BASE_URL），校验通过后置 `envValidated = true`；后续调用直接 `return`，避免重复遍历环境变量。该机制基于以下前提：环境变量在 Node.js 进程生命周期内不变（运行时修改 `process.env` 不影响已缓存的校验结果），符合 MVP 单进程部署模型。若未来支持热更新环境变量，需移除缓存或改为可重置标志。

### 7.4 健康检查端点（遵循 deployment-checklist.md）

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

---

## 8. 非功能设计

### 8.1 性能架构

| NFR | 要求 | 架构落点 |
|-----|------|---------|
| NFR-001 | Stage 1 首 token 响应 ≤ 5 秒 | solutionService 流式调用，首 token 立即推送 `code-chunk`；LLM 超时由 `CPP_AI_LLM_TIMEOUT` 错误码标识 |
| NFR-002 | Stage 2 总耗时 ≤ 30 秒 | flowchartService 与 mindmapService 并行调用（Promise.allSettled 模式），各自独立超时控制 |
| NFR-003 | ReactFlow 节点 ≤ 50 时 60fps | dagre 布局计算用 useMemo 缓存；折叠后仅渲染可见节点；ReactFlow 内置虚拟化渲染 |
| NFR-004 | 图片识别响应 ≤ 15 秒 | imageRecognitionService 单次调用，超时由 `CPP_AI_LLM_TIMEOUT` 标识 |

**流式输出性能优化**：
- Stage 1 流式推送避免前端积压：`code-chunk`/`analysis-chunk` 按 token 块推送，前端逐块追加
- Stage 1 完成后用 Shiki 重新高亮（FR-013）：流式阶段显示纯文本避免重复高亮开销
- ReactFlow 折叠后布局重算用 useMemo 缓存（FR-027），避免每次折叠都重算

### 8.2 安全架构

| NFR | 要求 | 架构落点 |
|-----|------|---------|
| NFR-008 | 所有用户输入经 Zod 验证 | Server Action recognizeImage 用 recognizeImageSchema 校验；Route Handler 用 solutionRequestSchema 校验 |
| NFR-009 | API Key 仅存服务端环境变量 | 所有 API Key 无 `NEXT_PUBLIC_` 前缀；通过 `app/lib/env.ts` 验证；客户端组件禁止读取 |
| NFR-010 | 文件/文本大小限制 | 图片：jpg/png/webp，≤ 10MB；标准答案文件：.cpp/.txt/.h/.hpp，≤ 1MB；题目文本 ≤ 10000 字符；标准答案文本 ≤ 20000 字符（Zod max 校验） |
| NFR-017 | LLM 输出防 XSS | 代码通过 Shiki 服务端渲染（自动转义 HTML）；分析通过 react-markdown 渲染（默认转义）；禁止 `dangerouslySetInnerHTML` 直接渲染 LLM 输出 |

**输入验证清单**（遵循 code-style.md "CRITICAL：所有用户输入必须在 Server Actions 中经 Zod 验证"）：
- `recognizeImage`：校验 imageBase64 非空、mimeType 枚举
- `generateSolution`：校验 problem 长度 1~10000、standardAnswer 长度 ≤ 20000、mode 枚举
- 文件上传：前端校验类型与大小，服务端二次校验（NFR-010）

**API Key 安全**：
- 所有 API Key 存 `.env.local`（禁止提交版本控制，遵循 env-management.md）
- 客户端组件无法访问服务端环境变量（Next.js 内置隔离）
- 日志禁止输出 API Key（NFR-016）

### 8.3 可扩展性

| 扩展点 | 当前 MVP | 预留设计 |
|--------|---------|---------|
| 模型切换（FR-010） | GLM/DeepSeek/Kimi/Qwen 配置驱动 | `app/lib/ai/config.ts` 从 env 读取 provider/model，新增模型仅需加 providerKeyMap/providerBaseUrlMap 条目 |
| 持久化（NFR-012） | MVP 无状态 | 服务层预留接口，后续可插入数据库而不改上层逻辑（Route Handler 与 Server Action 调用服务层，不直接操作数据） |
| SSO 集成 | MVP 无认证 | 已有现成 SSO IDP，后续在 middleware.ts 加认证检查（dev-workflow.md 路由保护规范） |
| 国际化 | MVP 仅中文 | 沿用 `[locale]` 路由约定，结构为未来 i18n 预留 |
| 多语言模型 | 国产商用 API | OpenAI 兼容 SDK 统一接口，可扩展接入其他兼容模型 |

### 8.4 可维护性

| NFR | 要求 | 架构落点 |
|-----|------|---------|
| NFR-011 | AI 服务层抽象统一接口，模型切换无需改代码 | 4 个服务类 + 统一 client + config 驱动（ADR-06） |
| NFR-012 | 服务层预留持久化接口 | 服务层方法签名稳定，持久化插入不影响上层 |
| NFR-013 | 遵循 .trae/rules/ 全部规范 | 见 §6.3 规范遵循说明 |
| NFR-016 | AI 服务调用记录应用日志 | logger.info 记录调用开始/结束与耗时，logger.error 记录失败；日志含模型名、耗时、token 用量；禁止输出完整 Prompt 中用户敏感内容；客户端错误用 logClientError() |

**日志规范**（遵循 dev-workflow.md）：

| 场景 | 工具 | 说明 |
|------|------|------|
| 应用日志（AI 服务调用） | `logger.info()` / `logger.error()` | 记录模型名、调用耗时、token 用量；禁止输出用户敏感内容 |
| 审计日志 | `auditLogger.log()` | 仅在 Route Handler / Server Action 层记录 |
| 中间件 | `console` | 禁止 logger（Edge Runtime 限制） |
| 客户端组件 | `logClientError()` | 禁止 logger（Client Runtime 限制） |

### 8.5 兼容性架构（AR1-001）

| NFR | 要求 | 架构落点 |
|-----|------|---------|
| NFR-014 | 支持现代浏览器（Chrome/Firefox/Safari/Edge 最新版） | 技术选型仅使用现代浏览器普遍支持的 Web API，无需 polyfill（见下文 NFR-014 落点详述） |
| NFR-015 | 移动端基本可用（响应式适配，不要求完整移动端体验） | 响应式适配策略，遵循 component-rules.md 移动端断点 `@media (max-width: 767px)`（见下文 NFR-015 落点详述） |

**NFR-014 浏览器兼容性落点详述**：

本系统技术选型所使用的 Web API 与依赖库均兼容 spec §4.5 要求的现代浏览器（Chrome/Firefox/Safari/Edge 最新版），无需引入 polyfill：

| 技术/API | 兼容性说明 |
|---------|-----------|
| `fetch` API | 现代浏览器全量支持（Chrome 42+、Firefox 39+、Safari 10.1+、Edge 14+），用于 SSE 流式请求 |
| `ReadableStream` | 现代浏览器全量支持（Chrome 43+、Firefox 65+、Safari 10.1+、Edge 14+），用于消费 SSE 流式响应 |
| `TextDecoder` | 现代浏览器全量支持（Chrome 38+、Firefox 19+、Safari 10.1+、Edge 14+），用于流式解码 UTF-8 |
| `AbortController` | 现代浏览器全量支持（Chrome 66+、Firefox 57+、Safari 12.1+、Edge 16+），用于取消生成（FR-031） |
| ReactFlow（@xyflow/react） | 官方声明兼容现代浏览器，依赖 ResizeObserver（Chrome 64+、Firefox 69+、Safari 13.1+、Edge 79+） |
| Shiki | 服务端渲染，无客户端 API 兼容性问题 |
| react-markdown + remark-gfm | 基于 React，兼容现代浏览器 |
| shadcn/ui + Tailwind v4 | 基于 CSS 变量与现代 CSS 特性（如 `:has()` 选择器），兼容现代浏览器 |

> **兼容性策略**：MVP 不针对旧版浏览器（如 IE 11、Chrome < 80）做兼容，不引入 polyfill 增加 bundle 体积。若未来需支持旧版浏览器，可按需引入 `whatwg-fetch`、`web-streams-polyfill` 等 polyfill，但需评估 bundle 体积影响。

**NFR-015 移动端响应式适配落点详述**：

遵循 component-rules.md 移动端断点规范（`@media (max-width: 767px)`），采用 CSS 驱动的响应式适配策略（禁止 JS 检测切换布局，遵循 component-rules.md §六布局组件规范）：

| 适配区域 | 桌面端（≥ 768px） | 移动端（< 768px） | 实现方式 |
|---------|------------------|------------------|---------|
| 整体布局 | 多列布局（输入区 + 输出区并列或 Tab 切换） | 单列布局（输入区与输出区垂直堆叠） | CSS Grid + 媒体查询 |
| Tab 切换 | 水平 Tab 标签 | 水平滚动 Tab 标签或下拉选择 | CSS 媒体查询调整 Tab 容器样式 |
| 流程图/思维导图 | 全尺寸 ReactFlow 画布 | 缩小画布高度，保留缩放/平移能力 | CSS 媒体查询调整画布容器高度 |
| 代码展示 | 行号 + 横向滚动 | 行号 + 横向滚动（触控友好） | 复用桌面端样式，增大触控区域 |
| 题目输入区 | 文本框 + 图片上传并排 | 文本框 + 图片上传垂直堆叠 | CSS Flexbox + 媒体查询 |

> **移动端适配原则**（遵循 component-rules.md）：
> - **CSS 驱动**：响应式适配通过 CSS 媒体查询实现，禁止 JS 检测屏幕宽度切换布局组件
> - **基本可用**：NFR-015 要求"移动端基本可用，不要求完整移动端体验"，故仅保证核心功能（输入、生成、查看四项产物）在移动端可用，不优化移动端交互细节（如长按、滑动手势）
> - **语义化样式**：移动端样式调整使用语义化 CSS 变量（如 `--height-input`、`--radius-card`），禁止硬编码像素值

---

## 9. 风险与对策

### 9.1 技术难点与解决方案（从 spec §8 提取）

| # | 难点 | 影响模块 | 解决方案 | 风险等级 |
|---|------|---------|---------|---------|
| 1 | LLM 输出非法 JSON | 流程图/思维导图 | JSON 模式 + Zod 校验 + 失败重试（附错误信息让模型修正，最多 2 次，NFR-005） | 中 |
| 2 | 图片 OCR 误识代码/公式 | 输入模块 | 识别结果回填可编辑 + 用户手动触发识别（FR-003） | 低 |
| 3 | 流程图节点-题目要求映射不准 | 流程图 | Prompt few-shot 示例 + 强制 requirementRef 字段（FR-019） | 中 |
| 4 | SSE 流式输出实现 | 编排层 | Route Handler + ReadableStream，前端 fetch 消费（ADR-01/02） | 中 |
| 5 | Stage 1 代码与分析流式分流 | 编排层 | LLM 输出带 `<<<CODE>>>`/`<<<ANALYSIS>>>` 标记，服务层状态机解析后分流推送（§4.2） | 中 |
| 6 | ReactFlow 折叠后布局重算 | 思维导图 | useMemo 缓存 + dagre 重新布局可见节点（FR-027） | 低 |
| 7 | 多模型 SDK 差异 | 编排层 | 统一 OpenAI 兼容接口 + 配置驱动（ADR-06） | 低 |
| 8 | Stage 2 并行部分失败 | 编排层 | 独立 try-catch + `flowchart-error`/`mindmap-error` 事件 + 前端单独重试按钮（FR-009） | 低 |
| 9 | 流程图/思维导图节点过多性能 | 可视化 | ReactFlow 虚拟化渲染 + 折叠减少节点数（NFR-003） | 低 |
| 10 | Tooltip 被其他节点遮挡 | 流程图 | z-index + pointer-events-none + hover 提升层级 | 低 |
| 11 | 循环引用导致 dagre 布局死循环 | 流程图 | `isBackEdge` 标记回边，回边不参与布局计算（FR-021） | 低 |

### 9.2 架构层面风险（补充）

| # | 风险 | 影响 | 对策 |
|---|------|------|------|
| A1 | SSE 走 Route Handler 偏离 dev-workflow.md "优先 Server Actions" | 规范一致性 | 已在 §1.3 ADR-01 显式声明为合理例外（Server Action 标准模式无法消费流式响应），NFR-007 明确 SSE Route Handler 例外 |
| A2 | Stage 1 标记缺失导致代码区无内容 | 用户体验 | 降级 UI（§4.2.4）：代码区显示「代码生成异常，请重试」+ 重新生成按钮；记录 `CPP_AI_SOLUTION_FORMAT_INVALID` 警告日志 |
| A3 | POST 请求无法自动重连，网络中断需用户手动重试 | 用户体验 | 前端检测中断后显示「连接中断，请重试」提示（§4.4.3）；MVP 接受此限制，后续可考虑加请求 ID + 服务端缓存实现断点续传 |
| A4 | 各厂商 OpenAI 兼容度差异（尤其 vision 接口） | 模型切换 | Phase 1 核心风险前置验证（§11），用 5-10 道真实题目测试各服务输出质量 |
| A5 | LLM 输出 Prompt 注入（用户题目含恶意指令） | 安全 | system prompt 明确输出格式约束；LLM 输出经 Zod schema 校验（仅接受结构化数据）；代码与分析经 Shiki/react-markdown 转义渲染（NFR-017） |
| A6 | 单文件超 500 行（Route Handler 编排逻辑复杂） | 代码规范 | Route Handler 仅做编排，Stage 1/2 逻辑封装在 solutionService/flowchartService/mindmapService；若 Route Handler 仍超限，拆分 `app/api/solution/orchestrator.ts` 辅助模块 |

---

## 10. 覆盖性追踪矩阵

### 10.1 FR 覆盖性追踪矩阵

> 确保每个 spec FR（FR-001~FR-031）都有对应的架构设计落点。

| FR | 描述 | 架构落点 |
|----|------|---------|
| FR-001 | 题目文本输入（≤10000 字符） | §6.2 problem-input.tsx；§5.3 solutionRequestSchema（Zod max 10000）；§8.2 输入验证 |
| FR-002 | 图片上传（拖拽/粘贴/点击） | §6.2 problem-input.tsx；§8.2 文件类型/大小校验（jpg/png/webp ≤10MB） |
| FR-003 | 「识别」按钮触发图片识别 | §5.2 recognizeImage Server Action；§5.4.1 ImageRecognitionService |
| FR-004 | 标准答案补充（文本/文件） | §6.2 standard-answer-input.tsx；§5.3 solutionRequestSchema（standardAnswer ≤20000）；§8.2 文件类型/大小校验 |
| FR-005 | 补充标准答案后重新生成 | §5.3 mode='deep'；§5.4.2 SolutionService.generateStream（mode 参数） |
| FR-006 | 混合两阶段编排 | §4.1 AI 编排流程；§1.3 ADR-03 |
| FR-007 | Stage 1 SSE 流式输出 | §4.2 Stage 1 数据流；§4.4 SSE 事件流；§5.3 Route Handler；§5.4.2 SolutionService.generateStream |
| FR-008 | Stage 2 JSON 一次性推送 | §4.3 Stage 2 数据流；§4.4.1 flowchart/mindmap 事件 |
| FR-009 | Stage 2 独立容错 | §4.3 并行容错；§4.4.1 flowchart-error/mindmap-error 事件；§9.1 #8 |
| FR-010 | 模型环境变量配置 | §7.3 环境变量；§5.4 config.ts；§1.3 ADR-06；§8.3 模型切换扩展点 |
| FR-011 | Shiki 服务端渲染 C++ 语法高亮 | §3.1 技术栈；§6.2 code-display.tsx；§1.3 ADR-07；§8.2 NFR-017 |
| FR-012 | 复制代码按钮 | §6.2 code-display.tsx |
| FR-013 | Stage 1 流式追加 + 完成后 Shiki 重新高亮 | §4.4.1 code-chunk/stage1-done 事件；§6.2 code-display.tsx；§8.1 流式输出性能优化 |
| FR-014 | Markdown 渲染分析 | §3.1 react-markdown + remark-gfm；§6.2 analysis-display.tsx |
| FR-015 | Stage 1 流式追加 Markdown | §4.4.1 analysis-chunk 事件；§6.2 analysis-display.tsx |
| FR-016 | 基于标准答案标签 | §5.3 mode='deep'；§6.2 analysis-display.tsx（顶部标签） |
| FR-017 | ReactFlow 流程图 + dagre 布局 | §3.1 技术栈；§6.2 flowchart-display.tsx/flowchart-layout.tsx；§5.5.1 FlowchartSchema |
| FR-018 | 6 种节点类型 | §6.2 flowchart-node.tsx；spec §7.9 节点类型表（start/process/decision/loop/data/end） |
| FR-019 | 节点 label + requirementRef 徽章 | §5.5.1 FlowchartSchema（requirementRef 字段）；§6.2 flowchart-node.tsx |
| FR-020 | hover 节点 tooltip | §5.5.1 FlowchartSchema（explanation/codeRef/requirementRef）；§6.2 flowchart-node.tsx |
| FR-021 | decision 出边标签 + loop 回边虚线 | §5.5.1 FlowchartSchema（label/isBackEdge）；§6.2 flowchart-edge.tsx；§9.1 #11 |
| FR-022 | hover 边 tooltip | §5.5.1 FlowchartSchema（edges.explanation）；§6.2 flowchart-edge.tsx |
| FR-023 | 缩放/平移/小地图/fitView | §6.2 flowchart-display.tsx（ReactFlow 内置能力） |
| FR-024 | ReactFlow 思维导图 + dagre LR | §3.1 技术栈；§6.2 mindmap-display.tsx/mindmap-layout.tsx；§5.5.2 MindmapSchema |
| FR-025 | 默认展开 3 层 | §5.5.2 depth 由前端计算（depth<3 展开）；§6.2 mindmap-display.tsx |
| FR-026 | 折叠 +N 徽章 | §6.2 mindmap-node.tsx |
| FR-027 | 点击切换展开/折叠 | §6.2 mindmap-display.tsx（折叠状态）；§9.1 #6 |
| FR-028 | 点击节点详情面板 | §6.2 mindmap-detail-panel.tsx |
| FR-029 | 层级视觉区分 | §6.2 mindmap-node.tsx；spec §7.10 层级视觉表 |
| FR-030 | Tab 切换四个输出 | §6.2 solution-tabs.tsx |
| FR-031 | 流式过程中 Tab 加载状态 | §4.4.3 AbortController 取消；§6.2 solution-tabs.tsx（就绪状态管理） |

**FR 覆盖率**：31/31 = 100%

### 10.2 NFR 覆盖性追踪矩阵（AR1-007）

> 确保每个 spec NFR（NFR-001~NFR-017）都有对应的架构设计落点。

| NFR | 描述 | 架构落点 |
|-----|------|---------|
| NFR-001 | Stage 1 首 token 响应 ≤ 5 秒 | §8.1 性能架构（solutionService 流式调用，首 token 立即推送 code-chunk）；§5.6 CPP_AI_LLM_TIMEOUT 错误码 |
| NFR-002 | Stage 2 总耗时 ≤ 30 秒 | §8.1 性能架构（flowchartService 与 mindmapService 并行调用 Promise.allSettled，各自独立超时控制） |
| NFR-003 | ReactFlow 节点 ≤ 50 时 60fps | §8.1 性能架构（dagre 布局 useMemo 缓存；折叠后仅渲染可见节点；ReactFlow 内置虚拟化） |
| NFR-004 | 图片识别响应 ≤ 15 秒 | §8.1 性能架构（imageRecognitionService 单次调用，超时由 CPP_AI_LLM_TIMEOUT 标识） |
| NFR-005 | LLM 输出 JSON 校验失败自动重试，最多 2 次 | §4.3 Stage 2 数据流（JSON 校验失败重试）；§5.4.3/5.4.4 FlowchartService/MindmapService（重试最多 2 次）；§5.6 CPP_AI_JSON_VALIDATION_FAILED 错误码 |
| NFR-006 | Stage 2 部分失败时成功部分正常展示，失败部分显示重试按钮 | §4.3 并行容错；§4.4.1 flowchart-error/mindmap-error 事件；§6.4.3 部分失败处理；§9.1 #8 |
| NFR-007 | Server Action 与非流式 Route Handler 包含 try-catch 返回 ServiceResult<T>；SSE 流式 Route Handler 通过 SSE 事件携带错误信息 | §5.2 recognizeImage try-catch；§5.3.3 Route Handler try-catch 骨架（流外错误 HTTP 状态码 + 流内错误 SSE 事件）；§5.6 错误码使用约定 |
| NFR-008 | 所有用户输入经 Zod 验证 | §5.2 recognizeImageSchema；§5.3.1 solutionRequestSchema；§8.2 输入验证清单 |
| NFR-009 | API Key 仅存服务端环境变量，禁止 NEXT_PUBLIC_ 前缀 | §7.3 环境变量（所有 API Key 无 NEXT_PUBLIC_ 前缀）；§8.2 API Key 安全；§7.3 validateEnv 验证机制 |
| NFR-010 | 文件/文本大小限制 | §5.2 recognizeImageSchema（mimeType 枚举）；§5.3.1 solutionRequestSchema（problem ≤10000、standardAnswer ≤20000）；§8.2 输入验证清单（图片 ≤10MB、标准答案文件 ≤1MB） |
| NFR-011 | AI 服务层抽象统一接口，模型切换无需改代码 | §5.4 AI 服务层接口（4 个服务类）；§1.3 ADR-06；§8.3 模型切换扩展点；§8.4 可维护性 |
| NFR-012 | 服务层预留持久化接口 | §8.3 可扩展性（服务层方法签名稳定，持久化插入不影响上层）；§8.4 可维护性 |
| NFR-013 | 遵循 .trae/rules/ 全部规范 | §6.3 规范遵循说明；§8.4 可维护性 |
| NFR-014 | 支持现代浏览器（Chrome/Firefox/Safari/Edge 最新版） | §8.5 兼容性架构（NFR-014 落点详述：技术选型仅使用现代浏览器普遍支持的 Web API，无需 polyfill） |
| NFR-015 | 移动端基本可用（响应式适配） | §8.5 兼容性架构（NFR-015 落点详述：CSS 驱动响应式适配，遵循 component-rules.md 移动端断点 @media (max-width: 767px)） |
| NFR-016 | AI 服务调用记录应用日志 | §8.4 可维护性（logger.info/logger.error 记录模型名、耗时、token 用量；客户端用 logClientError()）；§6.1 logging/logger.ts |
| NFR-017 | LLM 输出防 XSS | §8.2 安全架构（Shiki 服务端渲染自动转义 HTML；react-markdown 默认转义；禁止 dangerouslySetInnerHTML）；§1.3 ADR-07 |

**NFR 覆盖率**：17/17 = 100%

---

## 11. 实施路径（从 spec §9）

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
| 1 | 单元测试 + 人工抽检 | 10 道题目 JSON 格式 100% 合法；内容质量人工评分 ≥ 4/5 |
| 2 | 端到端手动测试 | 输入→生成→展示全流程无报错；首 token 响应时间 ≤ 5 秒（NFR-001）；流式追加无卡顿（60fps） |
| 3 | 端到端手动测试 | 覆盖 FR-017~FR-029：流程图 hover 显示 tooltip、6 种节点类型视觉区分、decision 出边标签与 loop 回边虚线、缩放/平移/小地图/fitView；思维导图默认展开 3 层、折叠 `+N` 徽章、展开/折叠切换、详情面板联动、层级视觉区分 |
| 4 | `tsc --noEmit` + `npm run lint` + `npm run build` | 全部通过 |
