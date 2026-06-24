# C++ 编程培训辅助系统 需求规格与设计文档

**版本**：v1.0
**状态**：draft
**创建时间**：2026-06-25
**最后更新**：2026-06-25

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-06-25 | 初稿创建，含需求规格与架构设计 | — |

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

- **FR-001**：提供多行文本输入框，支持 C++ 编程题目文本输入
- **FR-002**：支持图片上传（拖拽/粘贴/点击），上传后显示缩略图
- **FR-003**：提供「识别」按钮，手动触发图片识别（通义千问 VL / Kimi Vision），识别结果回填到题目文本框供用户编辑修正
- **FR-004**：生成解答后，若用户不满意，可展开「标准答案」补充区，通过文本粘贴或上传 `.cpp`/`.txt` 文件补充标准答案
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
- **NFR-007**：所有 Server Action 包含 try-catch，返回 `ServiceResult<T>` 格式，禁止抛出未捕获异常

### 4.3 安全

- **NFR-008**：所有用户输入经 Zod 验证（文件类型/大小/文本长度）
- **NFR-009**：API Key 仅存服务端环境变量，禁止 `NEXT_PUBLIC_` 前缀
- **NFR-010**：图片上传限制类型（jpg/png/webp）与大小（≤ 10MB），识别后不持久化

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

---

## 7. 架构设计

### 7.1 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器（Client）                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 题目输入  │  │ 代码展示  │  │ 流程图    │  │ 思维导图 │ │
│  │ +图片上传 │  │ +分析展示 │  │ ReactFlow│  │ReactFlow│ │
│  └─────┬────┘  └──────────┘  └──────────┘  └─────────┘ │
│        │ FormData / SSE                                     │
└────────┼────────────────────────────────────────────────┘
         │
┌────────▼─────────────────────────────────────────────────┐
│              Next.js Server Actions 层                    │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ 题目识别 Action  │  │ 解题生成 Action（SSE 流式）   │  │
│  │ Zod 验证输入     │  │ 编排 AI 服务层               │  │
│  └────────┬────────┘  └──────────────┬───────────────┘  │
└───────────┼──────────────────────────┼──────────────────┘
            │                          │
┌───────────▼──────────────────────────▼──────────────────┐
│                    AI 服务层（Service Layer）             │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ 图片识别    │  │ 代码+分析   │  │ 图表 JSON 生成     │  │
│  │ Vision 模型 │  │ 文本模型    │  │ 文本模型           │  │
│  └────────────┘  └────────────┘  └───────────────────┘  │
│  统一 ServiceResult<T> 返回 + Zod schema 校验 LLM 输出    │
└─────────────────────────────────────────────────────────┘
```

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
| 流式输出 | Server Actions + ReadableStream（SSE） | 逐步呈现生成结果 |
| 自动布局 | dagre（@dagrejs/dagre） | ReactFlow 节点自动坐标计算 |

### 7.3 AI 编排流程（混合方案 C）

```
用户提交题目
  ↓
Stage 1：代码生成 + 解题分析（单次调用，文本模型）
  ├─ 输入：题目文本（+可选标准答案）
  ├─ 输出：{ code, analysis }
  └─ 流式：SSE 逐 token 推送
  ↓ code + analysis 作为上下文
Stage 2：流程图 JSON + 思维导图 JSON（并行调用，文本模型）
  ├─ 流程图服务 ──┐
  │  输入：题目+代码  │ 并行
  │  输出：Flowchart │
  ├─ 思维导图服务 ──┘
  │  输入：题目+代码
  │  输出：Mindmap
  └─ 各自一次性推送完整 JSON
  ↓
前端渲染全部产物
```

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
event: flowchart         → 推送完整流程图 JSON（一次性）
event: mindmap           → 推送完整思维导图 JSON（一次性）
event: done              → 全部完成
event: error             → 错误信息（含错误码）
```

### 7.6 LLM 结构化输出 Schema

#### 流程图 Schema

```typescript
const FlowchartSchema = z.object({
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
  })),
});
```

#### 思维导图 Schema

```typescript
const MindmapSchema = z.object({
  root: z.object({
    id: z.string(),
    label: z.string(),
    explanation: z.string(),
    children: z.array(z.lazy(() => MindmapNode)).optional(),
  }),
});
```

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
    solution-prompt.ts             # 代码+分析的 Prompt 模板
    flowchart-prompt.ts            # 流程图 Prompt（含 schema + few-shot）
    mindmap-prompt.ts              # 思维导图 Prompt
  clients/
    llm-client.ts                  # 统一 OpenAI 兼容客户端
    vision-client.ts               # 视觉模型客户端
  config.ts                        # 模型配置（从 env 读取）
```

### 7.8 前端组件结构

> 注：沿用项目 `[locale]` 路由约定，MVP 仅实现 `zh` 单语言，结构为未来 i18n 预留。

```
app/[locale]/
  page.tsx                          # 首页（题目输入）
  components/
    problem-input.tsx               # 题目输入区（文本+图片上传+识别按钮）
    standard-answer-input.tsx       # 标准答案补充区（可折叠）
  solution/
    page.tsx                        # 解题结果页
    components/
      solution-tabs.tsx             # Tab 切换 + 流式状态管理
      code-display.tsx              # 代码展示（Shiki + 复制）
      analysis-display.tsx          # 分析展示（Markdown）
      flowchart-display.tsx         # 流程图容器
      flowchart-node.tsx            # 自定义节点（hover tooltip）
      flowchart-edge.tsx            # 自定义边（hover tooltip）
      flowchart-layout.ts           # dagre 布局
      mindmap-display.tsx           # 思维导图容器 + 折叠状态
      mindmap-node.tsx              # 自定义节点（折叠徽章）
      mindmap-detail-panel.tsx      # 右侧详情面板
      mindmap-layout.ts             # dagre LR 布局 + 折叠过滤
    actions.ts                      # generateSolution / recognizeImage Server Actions
```

### 7.9 流程图节点类型

| type | 图标（lucide） | 形状 | 语义色 |
|------|---------------|------|--------|
| start | `Play` | 圆角矩形 | `--color-success` |
| process | `Square` | 矩形 | `--color-primary` |
| decision | `GitBranch` | 菱形 | `--color-warning` |
| loop | `Repeat` | 矩形（虚线边） | `--color-info` |
| data | `Database` | 平行四边形 | `--color-muted` |
| end | `Square` | 圆角矩形 | `--color-destructive` |

### 7.10 思维导图层级视觉

| depth | 样式 |
|-------|------|
| 0（根） | 较大字号，`bg-primary`，白色文字 |
| 1 | 中等字号，`bg-card`，加粗边框 |
| 2 | 标准字号，`bg-muted`，普通边框 |
| 3+（默认折叠） | 同 depth 2，折叠时显示 `+N` 徽章 |

---

## 8. 技术难点与解决方案

| # | 难点 | 影响模块 | 解决方案 | 风险 |
|---|------|---------|---------|------|
| 1 | LLM 输出非法 JSON | 流程图/思维导图 | JSON 模式 + Zod 校验 + 失败重试（附错误信息让模型修正） | 中 |
| 2 | 图片 OCR 误识代码/公式 | 输入模块 | 识别结果回填可编辑 + 用户手动触发识别 | 低 |
| 3 | 流程图节点-题目要求映射不准 | 流程图 | Prompt few-shot 示例 + 强制 requirementRef 字段 | 中 |
| 4 | SSE 在 Server Action 中实现 | 编排层 | ReadableStream 返回 + 前端 fetch 消费 | 中 |
| 5 | ReactFlow 折叠后布局重算 | 思维导图 | useMemo 缓存 + dagre 重新布局可见节点 | 低 |
| 6 | 多模型 SDK 差异 | 编排层 | 统一 OpenAI 兼容接口 + 配置驱动 | 低 |
| 7 | Stage 2 并行部分失败 | 编排层 | 独立 try-catch + 前端单独重试按钮 | 低 |
| 8 | 流程图/思维导图节点过多性能 | 可视化 | ReactFlow 虚拟化渲染 + 折叠减少节点数 | 低 |
| 9 | Tooltip 被其他节点遮挡 | 流程图 | z-index + pointer-events-none + hover 提升层级 | 低 |
| 10 | 循环引用导致 dagre 布局死循环 | 流程图 | 回边单独标记不参与布局计算 | 低 |

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
| 1 | 单元测试 + 人工抽检 | 10 道题目 JSON 格式 100% 合法，内容质量人工评分 ≥ 4/5 |
| 2 | 端到端手动测试 | 输入→生成→展示全流程无报错，流式渲染流畅 |
| 3 | 端到端手动测试 | 流程图 hover 显示 tooltip，思维导图展开/折叠正常，详情面板联动 |
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
