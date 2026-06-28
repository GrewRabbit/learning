# GESP6 解题网页生成器（Web HTML 架构）v1.5

**版本**：v1.5
**状态**：approved
**创建时间**：2026-06-28
**最后更新时间**：2026-06-29
**作者**：总调度 agent（基于方案 D+ 讨论结论）

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-06-28 | 初稿创建（基于方案 D+） | — |
| v1.1 | 2026-06-29 | r1 评审修订（21 项） | review-r1 |
| v1.2 | 2026-06-29 | r2 评审修订（12 项） | review-r2 |
| v1.3 | 2026-06-29 | 输入模块改造（多平台题号 + 双 key 缓存 + 二级检索） | — |
| v1.4 | 2026-06-29 | r3 评审修订（15 项）+ 删除比对内容 | review-r3 |
| v1.5 | 2026-06-29 | r4 评审修订（5 项），approved | review-r4 |

---

## 1. 架构概述

### 1.1 背景与目标

本架构为面向**非开发者用户**的 GESP6 解题网页生成器，用户在 Web 页面提交 C++ 编程题，系统输出与 `workZone/gesp-nested-reward` 同等质量的解题 HTML（含八章节、Mermaid 流程图、思维导图、口诀、样例模拟等）。

**核心目标**：复刻 skill + 提示词模式下的输出质量；以 Next.js 网站形态对外提供服务；为未来 Agent API 集成预留接口。

### 1.2 核心架构决策

| 决策项 | 选择 | 理由 |
|-------|------|------|
| LLM 调用模式 | 单次多模态调用 + 固定流程修正循环 | 复刻 skill 长上下文一致性优势 |
| 输出载体 | 完整 HTML 字符串 | LLM 对视觉有完全控制权 |
| 前端渲染 | iframe srcDoc | 保留完整 HTML 结构，Mermaid 与交互隔离工作 |
| 编译验证 | g++ + 样例测试 + 失败重试 | 保证代码正确性 |
| Prompt 资产 | 外部文件运行时读取 | 更新不改代码 |
| 元数据提取 | LLM 附带 `<<<META>>>`/`<<<HTML>>>` 双段 | 程序确定性解析 |
| 流式 | 不流式，1-3 分钟 loading | 用户已确认可接受 |
| 多平台题号 | 声明式 `platforms.config.ts` + ProblemFetcher 接口 | 新增平台仅改配置不改代码 |
| 缓存策略 | 双 key（主 key `gesp6:platform:{p}:{id}` + 内容 key `gesp6:content:{sha256}`） | 主 key 加速同 URL 二次查询，内容 key 实现跨输入方式复用 |
| 图片输入 | 多模态 LLM 识别为文本后走内容 key 缓存 | 模型不支持时前置拒绝，避免无效 LLM 调用 |

---

## 2. 模块划分

### 2.1 模块清单

| 模块 | 职责 | 类型 |
|------|------|------|
| 输入模块 | 前端输入页 + Zod schema（支持文本/图片/多平台 URL） | 前端 + Zod schema |
| 平台配置（`platforms.config.ts`） | 声明式平台列表（洛谷/有道等），含 `urlPattern`/`idExtractor`/`fetcherType` | 服务端配置 |
| 模型配置（`models.config.ts`） | 声明式 LLM 模型能力（`supportsImage`/`supportsTool`） | 服务端配置 |
| 题目抓取模块（ProblemFetcher） | 按 `platforms.config.ts` 路由：洛谷 API、有道 cheerio DOM；各实现启用单飞 | 服务端服务 |
| 图片识别模块（ImageRecognizer） | 多模态 LLM 调用，图片识别为标准化文本（仅识别不解题），供内容 key hash | 服务端服务 |
| 缓存模块（HtmlCache） | 双 key：主 key `gesp6:platform:{p}:{id}` + 内容 key `gesp6:content:{sha256}`；含单飞 | 服务端服务 |
| 编排模块（Orchestrator） | 协调抓取/识别、双 key 缓存查询、LLM 调用、解析、验证、修正循环 | 服务端核心 |
| LLM 调用模块（LLMCaller） | 封装 LLM SDK 调用，加载 skill Prompt | 服务端服务 |
| HTML 解析模块（HtmlParser） | 状态机解析 `<<<META>>>`/`<<<HTML>>>` 双段 | 服务端服务 |
| 编译验证模块（CodeValidator） | g++ 编译 + 样例 stdin/stdout 比对 | 服务端服务 |
| 渲染模块（HtmlRenderer） | iframe srcDoc 渲染 + loading + 警告横幅 | 前端组件 |

> Route Handler（`app/api/solve/route.ts`）为接入层，负责 Zod 校验后调用 Orchestrator，不属于任何单一模块。

### 2.2 模块依赖关系

```
输入模块 → Route Handler
              │
              ├─ (platform URL) → 题目抓取模块（按 platforms.config.ts 路由）
              │                      ├─ LuoguFetcher   → API 抓取 Markdown（单飞）
              │                      └─ YoudaoFetcher  → cheerio DOM 解析（单飞）
              │                      → 获取标准化题目内容
              │
              ├─ (image, 模型 supportsImage=true) → 图片识别模块（ImageRecognizer）
              │                                       → 多模态 LLM 识别为文本
              │                                       → 标准化文本
              │
              └─ (text) → 直接标准化文本
                            │
                            ↓
              缓存模块（单一节点，承载 读/写 两种操作，双 key）
                ├─ [读] 主 key 命中（仅 platform 输入） → Route Handler → 渲染模块
                ├─ [读] 内容 key 命中（所有输入方式）   → Route Handler → 渲染模块
                └─ [读] 均未命中 → 编排模块
                                    ├─ → LLM 调用模块
                                    ├─ → HTML 解析模块
                                    ├─ → 编译验证模块（失败回流 LLM）
                                    └─ [写] 回流到同一缓存模块
                                              ├─ platform 输入：写主 key + 内容 key
                                              └─ text/image 输入：仅写内容 key
                                              → Route Handler → 渲染模块
```

**关键说明**：
1. 缓存模块在依赖图中**仅出现一次**（单一节点），`[读]`/`[写]` 标注的是操作类型而非独立节点；编排成功后通过 `[写]` 回流到同一缓存模块完成持久化。
2. platform 输入的主 key 检查前置到抓取之前——主 key `gesp6:platform:{platform}:{problemId}` 仅依赖 platform+problemId（由 URL 解析得到，无需抓取），可在 ProblemFetcher 抓取前检查并直接命中返回，避免相同 URL 二次请求仍触发网络抓取；内容 key 基于"标准化题目内容"的 SHA-256 hash，平台 URL 须先抓取、图片须先识别为文本，才能与文本输入共享同一内容缓存（见 §4.2 步骤 1）。
3. 双 key 查询顺序：主 key（仅 platform 输入有，`gesp6:platform:{platform}:{problemId}`）→ 内容 key（`gesp6:content:{sha256}`）→ LLM 生成；主 key 命中省去抓取与 hash 计算，内容 key 命中实现跨平台/跨输入方式复用。

---

## 3. 技术选型

### 3.1 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Next.js | 15.x | App Router |
| 语言 | TypeScript | 5.x | 严格模式 |
| 输入校验 | Zod | 3.x | 题目输入校验 |
| LLM SDK | OpenAI 兼容 SDK | latest | 调用 GLM/Kimi/Qwen 等 |
| 编译器 | g++ | 13+ | C++ 编译验证 |
| 缓存 | lru-cache | 11.x | HTML 内存缓存 |
| DOM 解析 | cheerio | 1.x | 有道小图灵页面 DOM 抓取 |
| UI | lucide-react + shadcn/ui | latest | 输入页 UI |
| Mermaid | mermaid.js | latest | iframe 内由 LLM 生成的 HTML 引入 |

### 3.2 依赖变更与待新增清单

| 类型 | 依赖 | 说明 |
|------|------|------|
| **删除** | reactflow, dagre, @reactflow/dagre-layout, shiki, react-markdown, remark-gfm | 本架构不使用可视化图/语法高亮/Markdown 渲染库 |
| **保留** | next, react, react-dom, zod, lucide-react, @/components/ui/* (shadcn) | 基础栈 |
| **新增** | lru-cache, cheerio | HTML 缓存；有道小图灵 DOM 解析 |

**待新增依赖清单**（实施阶段需先执行）：
```bash
npm install lru-cache@^11.0.0 cheerio@^1.0.0
```

---

## 4. 数据流设计

### 4.1 输入数据流

```
用户在 /solve 页面提交
  ├─ 文本输入 → 标准化文本（trim + 去多余空白 + 统一换行符 \n）
  │              → SHA-256 hash → 查内容 key 缓存
  │                ├─ 命中 → 直接返回已生成 HTML（不调用 LLM）
  │                └─ 未命中 → 进入 §4.2 编排（LLM 解题）
  │
  ├─ 图片上传 → base64 编码 → 检测当前模型 supportsImage
  │              ├─ 不支持 → UI 提示"当前模型不支持图片，请使用题号或文本输入"（返回 GESP6_MODEL_NOT_SUPPORTED）
  │              └─ 支持   → 调用多模态 LLM 识别图片为文本（轻量调用，仅识别不解题，独立预处理步骤）
  │                          → 标准化文本 → SHA-256 hash → 查内容 key 缓存
  │                ├─ 命中 → 返回已生成 HTML（省去解题 LLM 调用，跨输入方式复用）
  │                └─ 未命中 → 进入 §4.2 编排（用识别文本作为题目内容）
  │
  └─ 多平台 URL 输入（如 https://www.luogu.com.cn/problem/P11447、https://oj.youdao.com/problem/7997）
                 → platforms.config.ts 匹配 urlPattern → idExtractor 提取 platform+problemId（仅 URL 解析，无需抓取）
                 → 检查主 key `gesp6:platform:{platform}:{problemId}` → 命中直接返回（不抓取、不调用 LLM）
                 → 未命中 → ProblemFetcher 抓取（单飞，LuoguFetcher API / YoudaoFetcher cheerio DOM）→ 标准化 → SHA-256 hash
                 → 查内容 key → 命中返回 + 回填主 key（§4.2 步骤 1）/ 未命中进入 §4.2 编排
```

**前置处理说明**：
1. **文本标准化规则**（所有输入方式产生的文本统一适用）：trim 首尾空白 + 多个连续空白字符合并为一个 + 统一换行符为 `\n`，保证"同题不同输入方式"命中同一内容 key。**Unicode 空白边界**：使用 `\s+`（含空格/制表符 `\t`/换行 `\n`/回车 `\r`）合并为单个空格；`\u3000` 全角空格单独替换为半角空格后再合并；零宽字符（`\u200B` 等）不视为空白，保留原样。
2. **图片二级检索**：图片先经多模态 LLM 识别为文本后标准化 hash，"同题用图片输入 vs 文本输入"可复用同一份解题 HTML。**图片输入 LLM 调用次数**：缓存未命中时为 2-6 次（1 次图片识别预处理 + 1 生成 + 最多 1 格式重试 + 最多 3 修正）。"单次多模态调用"决策（§1.2）指生成阶段为单次调用，图片识别为独立预处理步骤，不冲突。
3. **多平台主 key 前置检查**：平台 URL 输入先解析 URL 提取 platform+problemId（无需网络抓取），检查主 key `gesp6:platform:{platform}:{problemId}` 命中则直接返回（不抓取），未命中才抓取标准化后查内容 key；抓取失败返回 `GESP6_PLATFORM_FETCH_FAILED`，不进入缓存与编排。

### 4.2 编排数据流（核心）

```
1. 输入预处理与双 key 缓存检查
   - **platform 输入主 key 前置检查**（无需网络抓取）：解析 URL 提取 platform+problemId → 检查主 key `gesp6:platform:{platform}:{problemId}` → 命中则直接返回 HTML（**不抓取、不调用 LLM**）→ 未命中进入"前置标准化"
   - **前置标准化**：所有输入先转为"标准化题目内容"（§4.1 文本标准化规则）。
     · platform URL：ProblemFetcher 抓取（单飞，失败返回 GESP6_PLATFORM_FETCH_FAILED）；image：ImageRecognizer 识别（模型不支持返回 GESP6_MODEL_NOT_SUPPORTED）；text：直接使用原文
   - **内容 key 查询**：
     · platform 输入：主 key 未命中后，抓取+标准化 → 查内容 key `gesp6:content:{sha256(标准化内容)}`
       ├─ 命中 → 返回 HTML + Orchestrator 调用 `htmlCache.set(primaryKey, contentHash, solution)` 回填主 key（primaryKey 由 platform+problemId 拼接），使后续同 URL 请求命中主 key（跨平台/跨输入方式复用）
       └─ 未命中 → 进入步骤 2
     · text/image 输入：直接查内容 key → 命中返回 / 未命中进入步骤 2

2. LLM 生成调用（第 1 次）
   - 输入：[skill Prompt 全文] + [题目内容（标准化文本）]
   - 输出：`<<<META>>>{...}<<<HTML>>><!DOCTYPE html>...`

3. HTML 解析（状态机，规则见下方"状态机解析规则"）
   ├─ 解析失败（无 META 标记）→ 触发 §4.4 格式重试（独立配额，**仅生成阶段 1 次**，不进入修正循环）。格式重试成功后回步骤 3 重新解析；编译/样例失败仍可进步骤 5 修正循环（配额不变最多 3 次）
   └─ 解析成功 → 进入步骤 4
   > **格式重试作用范围**：格式重试配额（1 次）仅作用于生成阶段（步骤 2→3 首次解析失败）；修正循环阶段（步骤 5 回到步骤 3）的 LLM 输出若格式不合规，直接降级返回 `{ success: true, data: { html: 原始HTML, validated: false, warning: '修正输出格式不合规' } }`，不消耗修正循环配额，不额外触发格式重试

4. 编译验证
   ├─ g++ 编译 META.code
   │   ├─ 失败 → 携带错误信息进入步骤 5（修正）
   │   └─ 通过 → 用 samples 跑样例（比对策略见下方"样例比对策略"）
   └─ 样例比对
       ├─ 全部通过 → 进入步骤 6（成功返回）
       └─ 有失败 → 携带所有失败样例进入步骤 5（修正）

5. LLM 修正调用（第 k 次修正，k = 1, 2, 3，即修正循环最多 3 次）
   - 输入：[原 HTML] + [META] + [错误信息/失败样例] + [要求"仅输出 META 块（含修正后的 code），HTML 块保持原文不变"]
   - 输出：新的 `<<<META>>>` + `<<<HTML>>>`
   - 回到步骤 3

6. 成功返回
   - **双 key 写入**：platform 输入写主 key `gesp6:platform:{platform}:{problemId}` + 内容 key `gesp6:content:{sha256}`；text/image 输入仅写内容 key。sha256 = SHA-256(标准化题目内容)
   - 写入缓存 → 返回 HTML + validated: true

7. 3 次修正后仍失败（累计 4 次 LLM 调用：1 生成 + 3 修正）
   - 返回当前 HTML + validated: false + warning（不写入缓存，避免缓存错误结果）
```

**状态机解析规则**（HtmlParser 实现）：
- 状态转换：`pending` → `meta` → `html`（单向不可回退）
- 标记分片：维护标记缓冲区（最大长度 11，按 `<<<HTML>>>` 长度封顶），超长未匹配则视为普通文本
- 标记重复：仅识别首次，后续作为普通文本
- 标记乱序：`html` 状态后收到 `<<<META>>>` 视为普通文本
- 标记缺失：无 META → 触发 §4.4 格式重试；无 HTML → 降级返回空 HTML + warning

**样例比对策略**（CodeValidator 实现）：
- 默认严格比对，可选择"忽略末尾空白字符"（`trim()` 后比对）
- 失败样例信息格式：`{ sampleIndex: number; input: string; expected: string; actual: string }`
- 部分失败：所有失败样例均携带进入修正循环，Prompt 中列出全部失败样例

### 4.3 输出数据流

```
Route Handler 返回 ServiceResult<Solution>
  → 前端 <iframe srcDoc={html}> 渲染
  ├─ validated: false → 顶部显示警告横幅
  └─ loading 期间显示动画
```

### 4.4 异常流

| 异常场景 | 处理策略 |
|---------|---------|
| LLM 调用超时（>120s） | 中止，返回 504 + ServiceResult 错误体（GESP6_LLM_TIMEOUT） |
| LLM 输出格式不合规（无 META 标记） | **完整链路**：①HtmlParser.parseMetaAndHtml 解析失败 → 返回 `GESP6_LLM_FORMAT_ERROR`；②Orchestrator 触发格式重试（**独立于修正循环配额**，仅 1 次）；③格式重试成功 → 回步骤 3 重新解析，正常进入步骤 4，编译/样例失败仍可进步骤 5 修正循环（配额不变最多 3 次）；④格式重试仍失败 → Orchestrator 降级返回 `{ success: true, data: { html: 原始HTML, validated: false, warning: 'LLM 输出格式不合规，已降级返回原始 HTML', cached: false } }`（**不再使用 GESP6_LLM_FORMAT_ERROR**）。最坏累计 LLM 调用 5 次（1 生成 + 1 格式重试 + 3 修正） |
| g++ 环境不可用 | 跳过编译验证，返回 HTML + warning"未通过代码验证" |
| 平台抓取失败（洛谷 API / 有道 DOM） | 返回 400 + ServiceResult 错误体（GESP6_PLATFORM_FETCH_FAILED），提示用户改用文本输入 |
| 模型不支持图片 | 返回 400 + ServiceResult 错误体（GESP6_MODEL_NOT_SUPPORTED），提示用户切换模型或改用题号/文本输入 |
| 缓存写入失败 | 仅记日志，不阻断返回（HtmlCache.set 返回 void 的合理性依据，见 §5.1） |

---

## 5. 接口定义

### 5.1 核心接口抽象（7 个，读操作均返回 ServiceResult<T>）

所有接口遵循 api-conventions.md `ServiceResult<T> = { success: boolean; data?: T; error?: { code: string; message: string } }` 统一返回格式，错误码取自 §5.4。**读操作均返回 ServiceResult\<T\>，写操作 `set` 返回 void（见 §4.4，缓存写入失败仅记日志不阻断返回，为 ServiceResult 规范的合理例外）。**

```typescript
interface LLMCaller {
  generate(input: LLMInput): Promise<ServiceResult<LLMOutput>>;
}

interface HtmlParser {
  parseMetaAndHtml(raw: string): ServiceResult<{ meta: Meta; html: string }>;
}
// 解析失败返回 GESP6_LLM_FORMAT_ERROR（完整链路见 §4.4）

interface CodeValidator {
  validate(code: string, samples: Sample[]): Promise<ServiceResult<ValidationResult>>;
}

interface Orchestrator {
  solve(problem: Problem): Promise<ServiceResult<Solution>>;
}
// 当前 FixedLoopOrchestrator，未来可替换为 AgentOrchestrator（见 §8.3）

interface ProblemFetcher {
  fetch(platform: string, problemId: string): Promise<ServiceResult<{ content: string; platform: string; problemId: string }>>;
}
// 按 platforms.config.ts 路由：LuoguFetcher（API）/ YoudaoFetcher（cheerio DOM）；各实现均启用单飞

interface ImageRecognizer {
  recognize(imageBase64: string): Promise<ServiceResult<{ text: string }>>;
}
// 多模态 LLM 调用，仅识别图片为文本不解题；模型不支持图片时返回 GESP6_MODEL_NOT_SUPPORTED；复用 LLMCaller.generate（传入识别 Prompt image-recognition-prompt.md + 图片 Problem，输出 LLMOutput.raw 为识别的纯文本，见 §7.1）

interface HtmlCache {
  getByPrimaryKey(platform: string, problemId: string): ServiceResult<Solution | null>;
  getByContentKey(contentHash: string): ServiceResult<Solution | null>;
  set(primaryKey: string | null, contentHash: string, solution: Solution): void;
  getOrCompute(contentHash: string, compute: () => Promise<ServiceResult<Solution>>): Promise<ServiceResult<Solution>>;
}
// 双 key 缓存：主 key 仅 platform 输入有；getOrCompute 为读操作返回 ServiceResult<Solution>（compute 回调内 LLM 失败返回 GESP6_INTERNAL_ERROR）；set 为写操作返回 void（见 §4.4，缓存写入失败仅记日志不阻断，为 ServiceResult 规范的合理例外）；set 时 primaryKey 为 null 仅写 contentCache，非 null 同时写 primaryCache+contentCache
// **getOrCompute 与编排流关系**：getOrCompute 内部封装 getByContentKey→compute→set 序列（**仅内容 key 读+LLM 计算+写**，不含主 key 检查），单飞去重在 getOrCompute 内部 in-flight Promise Map 实现（key 为 contentHash）。主 key 检查（getByPrimaryKey）由 Orchestrator 在前置阶段独立调用，不参与单飞（主 key 命中无需计算）。getByPrimaryKey/getByContentKey 为纯读操作，不维护独立 in-flight Map。实现时 Orchestrator：①前置调用 getByPrimaryKey 检查主 key；②未命中调用 getOrCompute 由其自动处理内容 key+计算+写+单飞
```

### 5.2 共享类型定义

```typescript
type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

type Problem = {
  type: 'text' | 'image' | 'platform';
  content: string;        // text: 原文；image: base64；platform: 完整 URL
  platform?: string;      // 仅 platform 类型有，如 'luogu' | 'youdao'
  problemId?: string;     // 仅 platform 类型有，如 'P11447' | '7997'
};
// platform/problemId 由 Route Handler 据 platforms.config.ts 解析后填入

type Solution = { html: string; validated: boolean; warning?: string; cached: boolean };

type Meta = { code: string; samples: Sample[] };
type Sample = { input: string; expectedOutput: string };

type LLMInput = {
  prompt: string;
  problem: Problem;
  history?: Array<{ role: string; content: string }>;
};

type LLMOutput = { raw: string };

type ValidationResult = {
  compiled: boolean;
  passed: boolean;
  errors: string[];
  trimEnabled: boolean;  // 是否启用"忽略末尾空白字符"容错（见 §4.2 样例比对策略）
  failures?: Array<{ sampleIndex: number; input: string; expected: string; actual: string }>;
};

// 平台配置（app/lib/platforms.config.ts 导出）
type PlatformConfig = {
  name: string;                                  // 'luogu' | 'youdao'
  displayName: string;                           // '洛谷' | '有道小图灵'
  urlPattern: RegExp;                            // URL 匹配正则，**必须以 ^https:// 开头，禁止匹配 http://**（SSRF 防护，见 §8.2）
  idExtractor: (url: string) => string | null;   // 从 URL 提取题号
  fetcherType: 'luogu-api' | 'dom-scrape';
};

// 配置示例（洛谷、有道小图灵）：
//   洛谷（https://www.luogu.com.cn/problem/P11447 → P11447）：
//     { name: 'luogu', displayName: '洛谷', urlPattern: /^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/, idExtractor: (url) => url.match(/^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/)?.[1] ?? null, fetcherType: 'luogu-api' }
//   有道小图灵（https://oj.youdao.com/problem/7997 → 7997）：
//     { name: 'youdao', displayName: '有道小图灵', urlPattern: /^https:\/\/oj\.youdao\.com\/problem\/(\d+)$/, idExtractor: (url) => url.match(/^https:\/\/oj\.youdao\.com\/problem\/(\d+)$/)?.[1] ?? null, fetcherType: 'dom-scrape' }

// 模型能力配置（app/lib/models.config.ts 导出）
type ModelConfig = { name: string; supportsImage: boolean; supportsTool: boolean };
// supportsTool 为预留字段，当前架构未使用，为未来 Agent API 集成预留
// 配置来源：models.config.ts 为静态声明式配置，LLMCaller 构造时据环境变量 LLM_MODEL 选取对应 ModelConfig
// 配置示例：{ name: 'glm-4v', supportsImage: true, supportsTool: false }（多模态）、{ name: 'glm-4', supportsImage: false, supportsTool: false }（纯文本）
```

### 5.3 Route Handler API 与 Zod schema

```typescript
// Zod schema
const solveRequestSchema = z.object({
  problem: z.object({
    type: z.enum(['text', 'image', 'platform']),
    content: z.string().refine((val, ctx) => {
      const type = (ctx.parent as { type: string }).type;
      if (type === 'text' && val.length > 10000) return false;
      if (type === 'image' && val.length > 5 * 1024 * 1024) return false;
      if (type === 'platform') {
        // 校验 URL 是否匹配 platforms.config.ts 中任一 urlPattern
        const matched = PLATFORMS.some((p) => p.urlPattern.test(val));
        if (!matched) return false;
      }
      return true;
    }, '内容不合法（platform 类型需为已配置平台的合法 URL）'),
  }),
});

// Route Handler 骨架（POST /api/solve）
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const parsed = solveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ success: false, error: { code: 'GESP6_INPUT_INVALID', message: parsed.error.issues[0]?.message ?? '输入校验失败' } }, { status: 400 });
    }
    // platform 类型：据 platforms.config.ts 解析 platform/problemId 后填入 Problem
    const resolved = resolvePlatform(parsed.data.problem);
    if (!resolved.success) {
      // resolvePlatform 返回 { success: false, error: { code: 'GESP6_INPUT_INVALID', ... } }，Route Handler 据此返回 400
      return Response.json(resolved, { status: 400 });
    }
    const result = await gesp6Orchestrator.solve(resolved.data);
    return Response.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    return Response.json({ success: false, error: { code: 'GESP6_INTERNAL_ERROR', message: '内部错误' } }, { status: 500 });
  }
}
// function resolvePlatform(problem: Problem): ServiceResult<Problem>;  — 返回 ServiceResult<Problem>，不抛异常（避免被 try-catch 捕获为 GESP6_INTERNAL_ERROR）
//   若 type==='platform'，遍历 PLATFORMS 匹配 urlPattern，调用 idExtractor 填充 platform/problemId；无匹配或 url 非 https 则返回
//   { success: false, error: { code: 'GESP6_INPUT_INVALID', message: '不支持的平台 URL' } }（理论已被 Zod 拦截，双重保险；含 url.startsWith('https://') 显式校验，见 §8.2 SSRF 防护）
```

### 5.4 错误码

| 错误码 | 说明 |
|-------|------|
| GESP6_INPUT_INVALID | 输入校验失败（含 platform URL 不匹配任一已配置平台） |
| GESP6_PLATFORM_FETCH_FAILED | 多平台抓取失败（洛谷 API 或 有道 DOM 抓取失败，统一错误码） |
| GESP6_MODEL_NOT_SUPPORTED | 当前模型不支持图片输入（`supportsImage=false`），需切换模型或改用题号/文本 |
| GESP6_LLM_TIMEOUT | LLM 调用超时 |
| GESP6_LLM_FORMAT_ERROR | LLM 输出格式不合规（仅由 HtmlParser.parseMetaAndHtml 解析失败时返回，Orchestrator 据此触发格式重试；格式重试仍失败时降级为 `success: true` + warning，不再使用此错误码。完整链路见 §4.4） |
| GESP6_COMPILE_ENV_ERROR | g++ 环境不可用 |
| GESP6_INTERNAL_ERROR | 内部错误 |

---

## 6. 目录结构

```
app/
  api/
    solve/route.ts                         POST 端点（含 resolvePlatform）
    health/route.ts                        GET 健康检查（FR-020）
  lib/
    ai/
      orchestrators/
        types.ts                           Orchestrator 接口
        fixed-loop-orchestrator.ts         D+ 固定流程编排（双 key 缓存查询）
        agent-orchestrator.ts              未来 Agent 编排（stub）
      services/
        llm-caller.ts                      LLMCaller 实现
        html-parser.ts                     HtmlParser 实现
        code-validator.ts                  CodeValidator 实现
        html-cache.ts                      HtmlCache 双 key 缓存实现（含单飞）
        image-recognizer.ts                ImageRecognizer 实现（多模态 LLM 识别）
        problem-fetchers/
          types.ts                         ProblemFetcher 接口
          luogu-fetcher.ts                 洛谷 API 抓取（含单飞）
          youdao-fetcher.ts                有道小图灵 cheerio DOM 抓取（含单飞）
          index.ts                         按 platforms.config.ts 路由的工厂
      prompts/
        gesp6-skill.md                     skill Prompt 外部文件
        fix-prompt-template.ts             修正 Prompt 模板
        image-recognition-prompt.md        ImageRecognizer 识别 Prompt（图片输入识别为文本）
      types.ts                             共享类型（§5.2，含 ServiceResult<T>、PlatformConfig、ModelConfig）
    platforms.config.ts                    平台声明式配置（洛谷/有道，可扩展）
    models.config.ts                       模型能力声明式配置（supportsImage/supportsTool）
    logging/logger.ts                      应用日志（复用现有）
    env.ts                                 环境变量验证（含 LLM API Key 与 g++ 检查）
  [locale]/
    solve/page.tsx                         题目输入页（文本/图片/多平台 URL）
    result/
      page.tsx                             结果展示页
      components/
        html-renderer.tsx                  iframe 渲染
        loading-animation.tsx              loading 动画
        warning-banner.tsx                 警告横幅
components/ui/                              shadcn/ui 基础组件（Button/Input/Card）
```

**约束**：单文件 ≤ 500 行；页面文件 ≤ 300 行；`@/` 绝对路径导入；服务层单例导出；新增平台仅改 `platforms.config.ts`，不改抓取模块路由代码。

---

## 7. 依赖关系

### 7.1 内部模块依赖

| 模块 | 依赖 |
|------|------|
| Route Handler | Orchestrator, platforms.config.ts（resolvePlatform）, Zod |
| FixedLoopOrchestrator | LLMCaller, HtmlParser, CodeValidator, HtmlCache, ProblemFetcher, ImageRecognizer, models.config.ts |
| LLMCaller | OpenAI SDK, gesp6-skill.md, models.config.ts（按环境变量 LLM_MODEL 选取） |
| HtmlParser | 无外部依赖（纯状态机） |
| CodeValidator | child_process（g++） |
| ProblemFetcher（接口） | platforms.config.ts（路由） |
| LuoguFetcher / YoudaoFetcher | fetch API / cheerio + fetch API；均启用单飞（相同平台+题号并发复用同一抓取 Promise，见 §8.2/§9） |
| ImageRecognizer | LLMCaller.generate（多模态，传入 image-recognition-prompt.md 识别 Prompt + 图片 Problem）, models.config.ts（supportsImage 检测） |
| HtmlCache | lru-cache + 双 key（主 key `gesp6:platform:{p}:{id}` + 内容 key `gesp6:content:{sha256}`）+ `getOrCompute` 单飞（封装 getByContentKey→compute→set 序列，单飞去重在 getOrCompute 内部，见 §5.1）。**内部维护两个 lru-cache 实例**：primaryCache（主 key→Solution）与 contentCache（内容 key→Solution），`set` 时**primaryKey 非 null 同时写入两个实例，primaryKey 为 null（text/image 输入）仅写 contentCache**，各实例独立 LRU 淘汰 |

### 7.2 外部服务依赖

| 服务 | 用途 | 必需性 |
|------|------|-------|
| LLM API（GLM/Kimi/Qwen） | 生成 HTML + 图片识别 | 必需 |
| g++ 编译器 | 编译验证 | 必需（失败可降级） |
| 洛谷 API | 题号抓取 | 可选 |
| 有道小图灵站点 | DOM 抓取 | 可选 |

---

## 8. 非功能设计

### 8.1 性能

| 指标 | 目标 | 实现策略 |
|------|------|---------|
| 首次响应时间 | ≤ 3 分钟 | 单次 LLM 调用 + 最多 3 次修正 |
| 缓存命中响应 | ≤ 200ms | lru-cache 内存缓存（max 100 条，ttl 1 小时） |
| 并发能力 | 10 并发 | LLM API 限流 + 队列 |
| 内存占用 | ≤ 512MB | HTML 字符串 + 缓存上限 |

### 8.2 安全

| 维度 | 策略 |
|------|------|
| 输入校验 | Zod 校验题目类型与内容长度（文本 ≤ 10000 字符、图片 ≤ 5MB、platform 类型须匹配 `platforms.config.ts` 中任一 `urlPattern`） |
| g++ 沙箱 | 临时目录（`mktemp -d`，编译后 `rm -rf`）+ 超时 10s + ulimit：`-t 10`（CPU 10s）+ `-v 262144`（虚拟内存 256MB）+ `-n 64`（文件描述符）+ `-u 1`（单进程，防 fork bomb）。通过 `child_process.execFile` 调用，包裹在 ulimit 子 shell 中 |
| iframe 隔离 | `sandbox="allow-scripts"`（**不加** `allow-same-origin`，避免 iframe 访问父页面 cookie/DOM；**不加** `allow-top-navigation`）。Mermaid 在无 same-origin 下可正常渲染 |
| CSP 头应用方式 | **CSP 通过 iframe `csp` 属性应用到 srcDoc 内 HTML**（srcDoc 创建独立浏览上下文，父页 CSP 不继承）。渲染时硬编码：`<iframe sandbox="allow-scripts" csp="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self';" srcDoc={html}>`。CSP 由系统控制不依赖 LLM 输出，`font-src 'self'` 确保 Mermaid 字体加载，仅允许 inline 脚本与 jsdelivr CDN，禁止 fetch/XHR |
| 多平台 DOM 抓取安全 | **SSRF 防护**：platform 输入必须先经 Zod + `platforms.config.ts` URL 白名单（仅洛谷/有道域名）匹配，禁止抓取任意用户提供的 URL；`platforms.config.ts` 的 `urlPattern` 正则**必须以 `^https://` 开头**，禁止匹配 http://（§5.2 PlatformConfig 注释）；`resolvePlatform` 中增加 `url.startsWith('https://')` 显式校验（双重保险）；fetch 仅允许 https；解析后的题目内容长度上限 100KB，超过截断并记日志。**DOM 解析隔离**：cheerio 仅在服务端运行，结果为纯文本/markdown，不引入用户 DOM 到本系统页面 |
| 敏感信息 | LLM API Key 仅服务端，禁止 NEXT_PUBLIC_ 前缀 |
| 日志 | 禁止输出用户题目内容与生成 HTML 全文 |
| 速率限制 | 单 IP 每分钟 5 次，用内存 Map（key 为 IP，value 为时间戳数组）在 middleware 中实现，每分钟清理过期记录 |
| 单飞模式 | HtmlCache 维护 in-flight Promise Map，相同 key 的并发请求复用同一 Promise（覆盖缓存写入后的并发去重）。**题目抓取模块（LuoguFetcher / YoudaoFetcher）同样启用单飞**：相同平台+题号的并发请求复用同一抓取 Promise，避免触发反爬限制（见 §9 风险表） |

### 8.3 可扩展性（Agent API 预留）

```typescript
// 未来集成 Agent API 时，只需替换 Orchestrator 实现，下游 CodeValidator/HtmlParser/渲染层/缓存层全部不动
const orchestrator: Orchestrator = isAgentApiAvailable
  ? new AgentOrchestrator(agentApi)
  : new FixedLoopOrchestrator(llm, parser, validator, cache);
```

### 8.4 可维护性

| 维度 | 策略 |
|------|------|
| Prompt 更新 | 外部文件 `gesp6-skill.md`，更新不改代码 |
| 模型切换 | LLMCaller 接口抽象；`models.config.ts` 为静态声明式配置，LLMCaller 构造时据环境变量 `LLM_MODEL` 选取对应 ModelConfig（切换模型仅改环境变量） |
| 接口抽象 | 7 个核心接口（LLMCaller/HtmlParser/CodeValidator/Orchestrator/ProblemFetcher/ImageRecognizer/HtmlCache），便于单元测试与替换 |
| 平台/模型扩展 | `platforms.config.ts` / `models.config.ts` 声明式外置，新增平台/模型不改业务代码 |

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| LLM 输出格式不稳定（无 META 标记） | 中 | 状态机解析容错 + 独立格式重试 1 次 + 降级返回 |
| g++ 编译环境在生产服务器不可用 | 高 | Docker 镜像预装 g++ + 失败降级跳过验证 |
| 洛谷 API 反爬限制 | 中 | User-Agent 设置 + 失败提示用户改文本输入 + **LuoguFetcher 启用单飞模式**（相同题号并发请求复用同一抓取 Promise，避免短时间内重复请求触发反爬） |
| 有道小图灵 DOM 结构变更 | 高 | cheerio 选择器集中在 `youdao-fetcher.ts`，结构变更时仅改单文件；抓取失败统一返回 `GESP6_PLATFORM_FETCH_FAILED` 提示用户改文本输入；定期人工巡检 |
| 图片识别准确率不足（多模态 LLM 误识别） | 中 | 识别后展示给用户确认（可选，MVP 直接进入解题）；识别文本与原图片存关联日志便于排查；用户可改用文本输入兜底 |
| LLM 生成的 HTML 含恶意脚本 | 高 | iframe sandbox 禁止 same-origin + 禁止 allow-top-navigation + **CSP 通过 iframe `csp` 属性应用到 srcDoc 内 HTML**（系统硬编码，不依赖 LLM 输出）+ `font-src 'self'` 确保 Mermaid 字体可加载 + 仅允许 inline 脚本与 jsdelivr CDN，禁止 fetch/XHR |
| 单次 LLM 调用 token 超限 | 中 | 监控 token 用量 + 题目长度限制 |
| 缓存击穿（同一题并发请求） | 低 | 单飞模式（HtmlCache in-flight Promise Map） |
| 修正循环无法收敛 | 中 | 最多 3 次重试 + 返回带 warning 的结果 |
| **修正循环中 LLM 修改非代码章节** | 高 | ①修正 Prompt 强约束"仅输出 META 块，HTML 块保持原文不变"；②HtmlParser 解析修正输出后比对 HTML 块 hash，若与上一轮不同则记录警告并采用原 HTML（仅替换 META 中的 code）；③若 LLM 仍输出 HTML 块变更，降级为"仅采纳 code 字段，HTML 块强制使用上一轮版本" |
| 多平台抓取 SSRF | 高 | platform URL 须经 `platforms.config.ts` 白名单匹配（仅洛谷/有道域名），禁止抓取用户提供的任意 URL；`urlPattern` 须以 `^https://` 开头（§5.2）+ `resolvePlatform` 显式校验 `url.startsWith('https://')`（§8.2）；fetch 仅允许 https（见 §8.2） |
| 双 key 缓存淘汰不一致 | 低 | 主 key 与内容 key 独立 LRU 淘汰，可能出现单边淘汰导致缓存命中率下降；对策：内容 key 命中时回填主 key（§4.2 步骤 1）实现自愈；NFR-019 双 key 命中率日志可观测淘汰影响 |
| 图片识别 LLM 调用成本 | 中 | 每次图片输入缓存未命中需额外 1 次识别调用；对策：识别文本 hash 命中内容 key 时省去生成调用（§4.1）；监控识别调用 token 用量；用户可改用文本输入避免识别调用 |
| 有道小图灵 DOM 抓取合规性 | 中 | 需遵守目标站点 robots.txt 与服务条款；对策：实施前核查 robots.txt，控制抓取频率（单飞模式已覆盖），仅用于内部培训用途 |

---

## 10. 功能需求（FR）

| 编号 | 需求描述 |
|------|---------|
| FR-001 | 用户可在 `/solve` 页面通过文本框输入 C++ 题目描述 |
| FR-002 | 用户可在 `/solve` 页面上传题目图片（支持 jpg/png，≤ 5MB；去掉 webp 因 LLM 多模态对 webp 支持差） |
| FR-003 | 用户可在 `/solve` 页面输入多平台题目 URL（洛谷 `https://www.luogu.com.cn/problem/P11447`、有道小图灵 `https://oj.youdao.com/problem/7997`），URL 须经 `platforms.config.ts` 白名单匹配 |
| FR-004 | 系统对题目输入进行 Zod 校验（含 platform URL 白名单），无效输入返回 400 + 错误信息 |
| FR-005 | platform URL 输入时，服务端按 `platforms.config.ts` 路由：洛谷走 `_contentOnly=1` API、有道走 cheerio DOM 解析获取题目内容；各 fetcher 启用单飞 |
| FR-006 | 平台抓取失败时，返回 400 + `GESP6_PLATFORM_FETCH_FAILED`，提示用户改用文本输入 |
| FR-007 | 系统采用双 key 缓存：主 key `gesp6:platform:{platform}:{problemId}`（仅 platform 输入）+ 内容 key `gesp6:content:{sha256(标准化内容)}`（所有输入方式）；查询顺序 主 key → 内容 key → LLM 生成 |
| FR-008 | 系统加载外部文件 `gesp6-skill.md` 作为 LLM Prompt |
| FR-009 | 系统发起单次多模态 LLM 调用，输入 = skill Prompt + 标准化题目内容 |
| FR-010 | LLM 输出格式为 `<<<META>>>{JSON}<<<HTML>>><!DOCTYPE html>...`，META 为 `{ code, samples: [{input, expectedOutput}] }` |
| FR-011 | 系统用状态机解析 LLM 输出，提取 META 块与 HTML 块（含分片/重复/乱序/缺失边界处理） |
| FR-012 | 系统从 META 提取 C++ 代码，调用 g++ 编译（沙箱 + ulimit 限制） |
| FR-013 | 编译成功后，系统用 META 中的 samples 逐个跑样例（stdin/stdout 比对，可选 trim 容错） |
| FR-014 | 编译或样例失败时，系统携带错误信息重新调用 LLM（要求"仅输出 META 块，HTML 块保持原文"） |
| FR-015 | 修正循环最多 3 次（累计 LLM 调用最多 4 次：1 生成 + 3 修正），仍失败则返回当前 HTML + warning |
| FR-016 | 验证通过后，系统返回 HTML + `validated: true`；platform 输入同时写主 key + 内容 key，text/image 输入仅写内容 key |
| FR-017 | 前端用 `<iframe srcDoc={html} sandbox="allow-scripts">` 渲染结果 |
| FR-018 | loading 期间（1-3 分钟）显示动画与等待提示 |
| FR-019 | 验证失败时，结果页顶部显示警告横幅"代码未通过验证，仅供参考" |
| FR-020 | 系统提供 `/api/health` 健康检查端点（返回 `{ status, timestamp }`） |
| FR-021 | LLM 调用超时（>120s）时，返回 504 + ServiceResult 错误体 |
| FR-022 | g++ 环境不可用时，跳过编译验证，返回 HTML + warning |
| FR-023 | 文本输入二级检索：标准化文本（trim + 合并空白 + 统一 `\n`）后 SHA-256 hash 查内容 key，命中则直接返回已生成 HTML 不调用 LLM |
| FR-024 | 图片输入二级检索：先经多模态 LLM 识别为文本 → 标准化 hash 查内容 key，命中则省去解题 LLM 调用 |
| FR-025 | 图片输入前检测当前模型 `supportsImage`，不支持时返回 `GESP6_MODEL_NOT_SUPPORTED` 并提示用户切换模型或改用题号/文本输入 |
| FR-026 | 新增平台仅改 `platforms.config.ts`，不改抓取路由代码（声明式扩展） |

### 10.1 FR 追踪矩阵

| FR | 架构落点 |
|----|---------|
| FR-001~003 | §6 `[locale]/solve/page.tsx` + §5.3 Zod schema |
| FR-004 | §5.3 Zod schema + Route Handler + `platforms.config.ts` |
| FR-005~006 | §6 `problem-fetchers/{luogu-fetcher,youdao-fetcher}.ts` + `platforms.config.ts` |
| FR-007 | §4.2 步骤 1/6 + §6 `html-cache.ts`（双 key） |
| FR-008 | §6 `prompts/gesp6-skill.md` + `llm-caller.ts` |
| FR-009 | §4.2 步骤 2 + `llm-caller.ts` |
| FR-010 | §4.2 步骤 2 + §5.2 Meta 类型 |
| FR-011 | §4.2 步骤 3 + 状态机解析规则 + `html-parser.ts` |
| FR-012 | §4.2 步骤 4 + `code-validator.ts` + §8.2 g++ 沙箱 |
| FR-013 | §4.2 步骤 4 + 样例比对策略 + `code-validator.ts` |
| FR-014 | §4.2 步骤 5 + `fix-prompt-template.ts` |
| FR-015 | §4.2 步骤 5/7 + `fixed-loop-orchestrator.ts` |
| FR-016 | §4.2 步骤 6（双 key 写入策略） |
| FR-017 | §4.3 + `html-renderer.tsx` + §8.2 iframe 隔离 |
| FR-018 | §6 `result/components/loading-animation.tsx` |
| FR-019 | §6 `result/components/warning-banner.tsx` |
| FR-020 | §6 `app/api/health/route.ts` |
| FR-021 | §4.4 异常流 + Route Handler |
| FR-022 | §4.4 异常流 |
| FR-023 | §4.1 文本输入 + §4.2 步骤 1 内容 key 查询 + `html-cache.ts` |
| FR-024 | §4.1 图片输入 + `image-recognizer.ts` + `html-cache.ts` |
| FR-025 | §4.1 图片输入前置 + `models.config.ts` |
| FR-026 | §6 `platforms.config.ts` + `problem-fetchers/index.ts` |

**FR 覆盖率：26/26 = 100%**

---

## 11. 非功能需求（NFR）

| 编号 | 需求描述 |
|------|---------|
| NFR-001 | 首次响应时间 ≤ 3 分钟（含 LLM 调用 + 编译验证） |
| NFR-002 | 缓存命中响应时间 ≤ 200ms |
| NFR-003 | 支持至少 10 个并发请求 |
| NFR-004 | 单 IP 速率限制：每分钟 5 次请求（middleware 内存 Map） |
| NFR-005 | TypeScript 严格模式，无 `any` 类型 |
| NFR-006 | 单文件 ≤ 500 行，页面文件 ≤ 300 行 |
| NFR-007 | 所有函数显式声明返回类型 |
| NFR-008 | 使用 `@/` 绝对路径导入，禁止 `../` 跨模块 |
| NFR-009 | LLM API Key 仅服务端访问，禁止 `NEXT_PUBLIC_` 前缀 |
| NFR-010 | 日志禁止输出用户题目内容与 HTML 全文 |
| NFR-011 | iframe 使用 `sandbox="allow-scripts"` 隔离（不加 allow-same-origin） |
| NFR-012 | g++ 编译在临时目录执行，超时 10s，ulimit：`-t 10 -v 262144 -n 64 -u 1` |
| NFR-013 | 7 个核心接口抽象为 TypeScript interface，读操作返回 ServiceResult<T>，写操作 set 返回 void（见 §4.4） |
| NFR-014 | Prompt 外部文件存储，更新不改代码 |
| NFR-015 | Orchestrator 接口可替换为 AgentOrchestrator 而下游不动 |
| NFR-016 | 单元测试覆盖 HtmlParser 状态机与 CodeValidator（`__tests__/html-parser.test.ts` + `__tests__/code-validator.test.ts`） |
| NFR-017 | 服务层单例导出（`export const xxx = new Xxx()`） |
| NFR-018 | 平台配置与模型能力配置声明式外置（`platforms.config.ts` / `models.config.ts`），新增平台/模型不改业务代码 |
| NFR-019 | 双 key 缓存命中率可观测（日志记录主 key 命中 / 内容 key 命中 / 未命中三类计数，便于优化缓存策略） |

### 11.1 NFR 追踪矩阵

| NFR | 架构落点 |
|-----|---------|
| NFR-001~003 | §8.1 性能 |
| NFR-004 | §8.2 速率限制 |
| NFR-005~008 | §6 约束 + code-style.md |
| NFR-009 | §8.2 敏感信息 |
| NFR-010 | §8.2 日志 |
| NFR-011 | §8.2 iframe 隔离 |
| NFR-012 | §8.2 g++ 沙箱 |
| NFR-013 | §5.1 接口抽象（7 个，读操作返回 ServiceResult<T>，写操作 set 返回 void） |
| NFR-014 | §6 `prompts/gesp6-skill.md` |
| NFR-015 | §8.3 Agent API 预留 |
| NFR-016 | `__tests__/` 目录（testing-standards.md） |
| NFR-017 | §5.1 + api-conventions.md |
| NFR-018 | §6 `platforms.config.ts` + `models.config.ts` |
| NFR-019 | §4.2 步骤 1 + `html-cache.ts`（双 key 命中日志） |

**NFR 覆盖率：19/19 = 100%**

---

## 12. 边界与排除项

### 12.1 不做

- 不做流式输出（用户确认 1-3 分钟等待可接受）
- 不做可视化流程图编辑器交互（iframe 内 Mermaid 自带交互已足够）
- 不做用户系统与题目历史（MVP 不需要登录/权限/请求历史）
- 不做多语言（MVP 仅支持中文）
- 不做服务端 Agent（当前个人开发能力不足，未来预留接口）

### 12.2 后续可扩展

- Agent API 集成（已预留 Orchestrator 接口）
- 用户系统与历史记录
- 多语言支持
- 题目收藏与分享

---

## 13. 验收标准

- [ ] AC-001：`/solve` 页面可输入文本、上传图片、输入多平台 URL 三种方式
- [ ] AC-002：洛谷 URL 输入能正确抓取题目 Markdown（API 抓取）；有道小图灵 URL 输入能正确抓取题目内容（cheerio DOM 解析）
- [ ] AC-003：相同题目二次请求命中缓存，响应 ≤ 200ms（双 key：主 key 或内容 key 命中任一即算；文本输入同题二次请求命中内容 key，不调用解题 LLM）
- [ ] AC-004：LLM 调用输出符合 `<<<META>>>`/`<<<HTML>>>` 双段格式，META 为合法 JSON
- [ ] AC-005：状态机能正确解析 META 与 HTML（含 6 类边界场景测试）
- [ ] AC-006：g++ 编译验证能识别编译错误与样例不匹配
- [ ] AC-007：修正循环最多 3 次（累计 4 次 LLM 调用），超过后返回 warning
- [ ] AC-008：iframe srcDoc 设置后，HTML 中的 `<pre class="mermaid">` 代码块被 mermaid.js 渲染为 SVG 元素（DOM 中存在 `svg.mermaid` 节点），流程图与思维导图节点可见且可交互
- [ ] AC-009：验证失败时顶部显示警告横幅
- [ ] AC-010：响应时间 ≤ 3 分钟（首次）
- [ ] AC-011：`npx tsc --noEmit` 无类型错误 + `npm run lint` 无警告
- [ ] AC-012：HtmlParser 与 CodeValidator 有单元测试覆盖
- [ ] AC-013：7 个核心接口抽象为 TypeScript interface，读操作返回 ServiceResult<T>，写操作 set 返回 void（见 §4.4）
- [ ] AC-014：Prompt 存储在外部文件 `gesp6-skill.md`
- [ ] AC-015：FR 覆盖率 26/26 = 100%（见 §10.1）
- [ ] AC-016：NFR 覆盖率 19/19 = 100%（见 §11.1）
- [ ] AC-017：双 key 缓存策略生效——平台 URL 输入首次生成后写主 key + 内容 key，二次同 URL 请求命中主 key（不抓取）；内容 key 命中时回填主 key；同题改用文本输入命中内容 key（跨输入方式复用）
- [ ] AC-018：图片输入在模型 `supportsImage=false` 时返回 `GESP6_MODEL_NOT_SUPPORTED` 并 UI 提示；`supportsImage=true` 时经多模态 LLM 识别为文本后进入内容 key 缓存检索
- [ ] AC-019：`platforms.config.ts` 声明式扩展——新增平台仅改配置文件，不改 `problem-fetchers/index.ts` 路由代码
- [ ] AC-020：多平台 DOM 抓取 SSRF 防护——非白名单域名 URL 被 Zod 拒绝；`urlPattern` 强制 `^https://` 开头，`resolvePlatform` 返回 `ServiceResult<Problem>` 不抛异常（无匹配返回 `GESP6_INPUT_INVALID`，Route Handler 据此返回 400）
