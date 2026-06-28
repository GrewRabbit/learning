# GESP6 解题网页生成器（Web HTML 架构）评审意见 — 第 1 轮

**评审对象**：`docs/architecture/arch-gesp6-web-html-v1.0.md`（v1.0, draft, 480 行）
**对照参考**：`docs/architecture/arch-cpp-training-assistant-v1.0.md`（v1.1, approved，原架构）
**评审时间**：2026-06-29
**评审结论**：需修订

---

## 一、评审维度结论

| # | 维度 | 结论 | 摘要 |
|---|------|------|------|
| 1 | 架构完整性 | 通过 | §4.2.1 要求的 9 个必备章节（架构概述/模块划分/技术选型/数据流设计/接口定义/目录结构/依赖关系/非功能设计/风险与对策）齐全，另含 FR/NFR/边界/AC 共 13 章 |
| 2 | 核心架构合理性 | 需修订 | 方案 D+ 七项核心决策在 §1.2/§4.2 清晰体现；但修正循环计数语义、异常流与修正循环关系存在歧义；4 个接口抽象为合理预留，无过度设计 |
| 3 | 模块划分 | 需修订（含建议） | 8 模块单一职责基本清晰；但"输入模块"标注"前端 + Route Handler"边界模糊；依赖关系图存在渲染模块依赖画错、缓存模块重复出现的问题 |
| 4 | 数据流设计 | 需修订 | 正常流（缓存检查→生成→解析→验证→修正→返回）覆盖完整；异常流覆盖 5 类场景；但修正循环计数、"格式重试"与修正循环关系、META 结构未明确 |
| 5 | 接口定义 | 需修订 | 4 个接口抽象方向正确，错误码符合 MODULE_CATEGORY_SPECIFIC；但**所有接口返回类型均未使用 ServiceResult<T>**，违反 api-conventions.md；共享类型未定义；Route Handler 缺 Zod schema 与 try-catch 骨架 |
| 6 | 目录结构 | 需修订 | 文件命名符合 kebab-case，@/ 绝对路径导入已约束；但缺少 `/api/health` 端点（FR-020 无落点）、logger 目录、env.ts、components/ui 目录 |
| 7 | 技术选型合理性 | 通过（含建议） | Next.js 15/TS 5/Zod 3/OpenAI SDK/lucide-react 均与 package.json 一致；lru-cache 为新增依赖（§3.2 已标注）；g++、iframe sandbox 选型恰当 |
| 8 | 非功能设计 | 需修订 | 性能/安全/可扩展性/可维护性框架完整；但 iframe CSP 头策略未具体化、g++ ulimit 具体值缺失、速率限制与单飞模式实现方式未说明 |
| 9 | 风险识别 | 需修订 | 识别 7 项风险；但缺少"修正循环中 LLM 修改非代码章节"风险、洛谷题号格式校验风险；"HTML 含恶意脚本"对策（sandbox + CSP）不够具体 |
| 10 | FR/NFR 完整性 | 需修订 | 22 FR + 17 NFR 覆盖核心需求；但**缺少 FR 追踪矩阵**（§4.2.1 验收标准明确要求）；AC-008"可见"不可测试；FR-002 图片限制与原架构不一致未说明 |
| 11 | 合规性 | 需修订 | 无 any、无跨模块 ../、单例导出正确；但接口返回类型违反 ServiceResult 规范、Route Handler 缺 Zod 验证展示 |
| 12 | 可实施性 | 需修订 | 整体方向可实施；但 7 个共享类型未定义、状态机解析规则未详述、META 结构未定义、Route Handler 骨架缺失，开发 agent 据此难以直接编码 |

---

## 二、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR1-001 | §5.1 核心接口抽象（第 188-216 行） | **4 个接口返回类型均未使用 `ServiceResult<T>`，违反 api-conventions.md §二统一返回格式规范。** `LLMCaller.generate` 返回 `Promise<LLMOutput>`、`HtmlParser.parseMetaAndHtml` 返回 `{ meta: Meta; html: string }`、`CodeValidator.validate` 返回 `Promise<ValidationResult>`、`Orchestrator.solve` 返回 `Promise<Solution>`。api-conventions.md 明确要求服务层统一返回 `ServiceResult<T> = { success: boolean; data?: T; error?: { code: string; message: string } }`。当前定义导致错误无法通过返回值传递，与 §5.4 错误码表脱节 | 重要 | 将 4 个接口返回类型改为 `ServiceResult<T>`：①`LLMCaller.generate(input): Promise<ServiceResult<LLMOutput>>`；②`HtmlParser.parseMetaAndHtml(raw): ServiceResult<{ meta: Meta; html: string }>`（同步方法也需返回 ServiceResult 以传递解析失败错误码 `GESP6_LLM_FORMAT_ERROR`）；③`CodeValidator.validate(code, samples): Promise<ServiceResult<ValidationResult>>`；④`Orchestrator.solve(problem): Promise<ServiceResult<Solution>>`。同时在 §5.1 补充说明"所有接口遵循 api-conventions.md ServiceResult<T> 统一返回格式，错误码取自 §5.4 错误码表" |
| AR1-002 | §5.1 核心接口抽象（第 188-216 行）/ §6 types.ts | **7 个共享类型未定义，开发 agent 无法据此编码。** 接口签名引用了 `LLMInput`、`LLMOutput`、`Meta`、`Sample`、`ValidationResult`、`Problem`、`Solution` 共 7 个类型，但 §5.1 与 §6 目录结构中的 `types.ts` 均未给出定义。§5.2 `SolveRequest`/`SolveResponse` 与 `Problem`/`Solution` 的关系也未说明 | 重要 | 在 §5 新增"共享类型定义"小节（或在 §5.1 后补充），定义全部 7 个类型：①`Problem = { type: 'text'\|'image'\|'luogu'; content: string }`（与 SolveRequest.problem 一致）；②`Solution = { html: string; validated: boolean; warning?: string; cached: boolean }`（与 SolveResponse 一致）；③`Meta = { code: string; samples: Sample[] }`（明确 META 块结构，见 AR1-007）；④`Sample = { input: string; expectedOutput: string }`；⑤`LLMInput = { prompt: string; problem: Problem; history?: Array<{ role: string; content: string }> }`（含修正循环上下文）；⑥`LLMOutput = { raw: string }`（LLM 原始输出，含 META+HTML 标记）；⑦`ValidationResult = { compiled: boolean; passed: boolean; errors: string[] }`。明确 `SolveResponse` 即 `Solution`，Route Handler 直接返回 Orchestrator 结果 |
| AR1-003 | §5.2 Route Handler API（第 218-235 行） | **Route Handler 缺少 Zod schema 定义与 try-catch 实现骨架，违反 code-style.md "所有用户输入必须经 Zod 验证"与 api-conventions.md "Server Action/Route Handler 必须包含 try-catch"。** §5.2 仅给出 TypeScript 类型 `SolveRequest`/`SolveResponse`，未给出 Zod schema；也未展示 Route Handler POST 方法的异常处理骨架（Zod 验证失败如何返回 400、Orchestrator 调用失败如何返回 504/500）。对比原架构 §5.3.3 有完整的 try-catch 骨架，本架构缺失会直接影响开发 agent 可实施性 | 重要 | 在 §5.2 补充：①Zod schema 定义（`solveRequestSchema = z.object({ problem: z.object({ type: z.enum(['text','image','luogu']), content: z.string() }) })`，并补充各 type 的 content 长度限制，如文本 ≤ 10000 字符、图片 base64 ≤ 5MB、洛谷题号正则 `^P\d+$`）；②Route Handler POST 方法骨架，包含外层 try-catch（Zod 验证失败 → 400 + ServiceResult 错误体；Orchestrator 调用 → 返回 ServiceResult；未预期异常 → 500）；③明确"禁止抛出未捕获异常"（api-conventions.md） |
| AR1-004 | §4.2 编排数据流 步骤 5/7（第 148-159 行）/ FR-015 | **修正循环计数语义不清晰，"3 次"指修正次数还是总 LLM 调用次数存在歧义。** 步骤 5 说"LLM 第 N 次调用（fix，N ≤ 3）"，步骤 7 说"3 次后仍失败"。结合 §1.3"1-5 次（单次生成 + 修正循环）"与任务背景"修正循环最多 3 次"，推断为 1 次生成 + 3 次修正 = 4 次。但步骤 5 的"N ≤ 3"中 N 若为"第 N 次调用"且 N 从 1 开始（生成是第 1 次），则修正最多 2 次（N=2,3），与"修正循环最多 3 次"矛盾；若 N 为修正次数，则总调用 4 次但 §1.3 写"1-5 次"。FR-015"修正循环最多 3 次"也无法消歧。开发 agent 可能实现为 1+3 或 1+2 | 重要 | 统一修正为明确表述：①§4.2 步骤 5 改为"LLM 第 k 次修正调用（k = 1, 2, 3，即修正循环最多 3 次）"；②步骤 7 改为"3 次修正后仍失败（即累计 4 次 LLM 调用：1 次生成 + 3 次修正）"；③§1.3"1-5 次"修正为"1-4 次（1 次生成 + 最多 3 次修正）；若计入格式不合规重试（§4.4）则为 1-5 次"；④FR-015 改为"修正循环最多 3 次（累计 LLM 调用最多 4 次），仍失败则返回当前 HTML + warning" |
| AR1-005 | §4.2 编排数据流（第 148-159 行）/ §4.4 异常流 | **异常流"LLM 格式不合规重试"与修正循环的关系未明确，可能导致实现时重复计数或遗漏。** §4.4 异常流规定"LLM 输出格式不合规（无 META 标记）→ 重试 1 次，仍失败则降级"。但此"重试 1 次"与 §4.2 步骤 5 的修正循环（针对编译/样例失败）是独立的还是共享 3 次配额？若独立，最坏情况为 1（生成）+ 1（格式重试）+ 3（修正）= 5 次调用，与 §1.3"1-5 次"一致；若共享，则修正循环可用次数会减少。文档未说明 | 重要 | 在 §4.4 异常流表格"LLM 输出格式不合规"行补充说明："此重试独立于修正循环的 3 次配额，用于格式容错。最坏情况累计 LLM 调用 5 次（1 生成 + 1 格式重试 + 3 修正）。格式重试仍失败时不进入修正循环，直接降级返回原始 HTML + warning"。同时在 §4.2 步骤 3 补充"解析失败（无 META 标记）触发 §4.4 格式重试，不进入步骤 5 修正循环" |
| AR1-006 | §4.2 步骤 3（第 137-139 行）/ FR-011 | **状态机解析规则未详述，开发 agent 无法实现 HtmlParser。** §4.2 步骤 3 仅说"状态机解析 META 块（含 code + samples）与 HTML 块"，但未说明：①如何识别 `<<<META>>>`/`<<<HTML>>>` 标记；②标记分片（标记被 LLM 输出截断在边界）如何处理；③标记重复/乱序如何处理；④标记缺失如何处理；⑤META 块内部结构（code + samples 如何分隔）。对比原架构 §4.2.2/4.2.3 对 `<<<CODE>>>/<<<ANALYSIS>>>` 标记有 6 类边界场景详细处理，本架构对 `<<<META>>>/<<<HTML>>>` 标记零边界场景说明 | 重要 | 在 §4.2 步骤 3 后新增"状态机解析规则"小节，参考原架构 §4.2.2/4.2.3 详述：①状态机状态转换（`pending` → `meta` → `html`，单向不可回退）；②标记分片处理（维护标记缓冲区，最大长度按 `<<<HTML>>>` 11 字符封顶，缓冲区超长仍未匹配则判定为普通文本）；③标记重复（仅识别首次，后续作为普通文本）；④标记乱序/嵌套（`html` 状态后收到 `<<<META>>>` 视为普通文本）；⑤标记缺失（无 META → 触发 §4.4 格式重试；无 HTML → 降级返回空 HTML + warning）；⑥META 块内部结构（明确为 JSON 还是自定义分隔符，见 AR1-007） |
| AR1-007 | §4.2 步骤 2（第 134-136 行）/ FR-010 | **META 块结构未定义，`Meta` 类型缺失。** §4.2 步骤 2 说 LLM 输出 `<<<META>>>{...}<<<HTML>>>`，其中 `{...}` 表示 META 块，但未定义其结构：是 JSON 对象？字段有哪些？§4.2 步骤 3 说"含 code + samples"，但 code 与 samples 如何组织（JSON 字段？分隔符？）、samples 的格式（input/expectedOutput 字段名？stdin/stdout？）均未说明。FR-010 仅描述外层 `<<<META>>>{...}<<<HTML>>>` 格式，未定义 `{...}` 内部 | 重要 | 在 §4.2 或 §5 明确定义 META 块结构。建议采用 JSON 格式（LLM 对 JSON 输出较稳定）：`{ "code": string, "samples": [{ "input": string, "expectedOutput": string }] }`。补充说明：①META 块为 JSON 字符串（`<<<META>>>` 与 `<<<HTML>>>` 之间的内容）；②`code` 字段为 C++ 源码（供 CodeValidator 编译）；③`samples` 字段为样例数组（供 CodeValidator 跑 stdin/stdout 比对）；④在 §5 类型定义中补充 `Meta` 与 `Sample` 类型（与 AR1-002 一致）；⑤在 Prompt 文件 `gesp6-skill.md` 中要求 LLM 输出此 JSON 结构 |
| AR1-008 | §6 目录结构（第 258-290 行） | **目录结构缺少 4 类必要文件，导致部分 FR/NFR 无落点。** ①缺 `app/api/health/route.ts`——FR-020 要求"系统提供 `/api/health` 健康检查端点"，但目录结构中无此文件，FR-020 无架构落点；②缺 `app/lib/logging/` 目录——dev-workflow.md §六要求使用 `@/app/lib/logging/logger`，§7.2 提到"完全复用 logger"但目录结构未体现；③缺 `app/lib/env.ts`——§7.2 提到"部分复用 环境变量"但目录结构未体现；④缺 `components/ui/` 目录——component-rules.md §一要求 `components/ui/` 存放基础 UI 组件，§3.1 使用 shadcn/ui 但目录结构未体现 | 重要 | 在 §6 目录结构补充：①`app/api/health/route.ts`（GET 健康检查端点，返回 `{ status, timestamp }`，对应 FR-020）；②`app/lib/logging/logger.ts`（应用日志，复用现有实现）；③`app/lib/env.ts`（环境变量验证，含 LLM API Key 与 g++ 可用性检查）；④`components/ui/`（shadcn/ui 基础组件，如 Button/Input/Card）。同时在 §7.2"完全复用"清单中明确这些文件的位置 |
| AR1-009 | §8.2 安全（第 344-353 行）/ §9 风险表 | **iframe 安全策略不充分，CSP 头未具体化，allow-same-origin 未澄清。** §8.2 仅说"`sandbox=\"allow-scripts\"` 限制权限"和"CSP 头"，但：①`sandbox=\"allow-scripts\"` 允许脚本执行，若 LLM 生成的 HTML 含恶意 JS（fetch 外部 API 泄露、挖矿），sandbox 无法阻止；②未说明是否需要 `allow-same-origin`（若加则 iframe 可访问父页面 DOM，有安全风险；若不加则 Mermaid 可能无法正常渲染某些功能）；③CSP 头未给出具体策略（如 `script-src` 允许哪些源、是否允许 `unsafe-inline`）。§9 风险表"HTML 含恶意脚本"对策仅"iframe sandbox 隔离 + CSP 头"，不够具体 | 重要 | 在 §8.2 补充：①明确 iframe 属性为 `sandbox=\"allow-scripts\"`（**不加** `allow-same-origin`，避免 iframe 访问父页面 cookie/DOM，Mermaid 在无 same-origin 下可正常渲染）；②给出具体 CSP 头策略，如 `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data:;`（仅允许 inline 脚本与 Mermaid CDN，禁止 fetch/XHR）；③在 §9 风险表"HTML 含恶意脚本"对策补充"iframe sandbox 禁止 same-origin + CSP 头限制脚本源与网络请求 + 禁止 `allow-top-navigation`" |
| AR1-010 | §9 风险表（第 377-386 行）/ §4.2 步骤 5 | **缺少"修正循环中 LLM 修改非代码章节"风险，修正循环有效性无保障。** §4.2 步骤 5 要求修正调用"只修代码块，其余章节不动"，但 LLM 可能不遵守此要求，修改了流程图、思维导图、分析等章节，导致已验证的章节被破坏。§9 风险表未识别此风险，也无对策。这直接影响修正循环的有效性——修正后可能引入新问题 | 重要 | 在 §9 风险表新增一行："修正循环中 LLM 修改非代码章节 \| 高 \| 对策：①修正 Prompt 强约束'仅输出 META 块（含修正后的 code），HTML 块保持原文不变'；②HtmlParser 解析修正输出后，服务层比对 HTML 块 hash，若与上一轮不同则记录警告并采用原 HTML（仅替换 META 中的 code）；③若 LLM 输出仍含 HTML 块变更，降级为'仅采纳 code 字段，HTML 块强制使用上一轮版本'" |
| AR1-011 | §10 功能需求（第 389-414 行） | **缺少 FR 追踪矩阵，违反 AI-Prompt §4.2.1 验收标准。** §4.2.1 明确要求"每个 spec 的 FR 都有对应的架构设计落点"作为验收标准，原架构 §10.1 有完整的 FR 追踪矩阵（FR-001~031 每项映射到架构章节）。本架构 §10 仅列出 22 个 FR 清单，未将每个 FR 映射到架构落点章节，开发 agent 无法快速核对 FR 覆盖完整性 | 重要 | 在 §10 FR 清单后新增"FR 追踪矩阵"小节，表格格式：`FR 编号 | 描述 | 架构落点（章节引用）`。例如：FR-001 → §6 `[locale]/solve/page.tsx` + §5.2 Zod schema；FR-007 → §4.2 步骤 1 + §6 `html-cache.ts`；FR-012 → §4.2 步骤 4 + §6 `code-validator.ts`；FR-017 → §4.3 + §6 `html-renderer.tsx`；FR-020 → §6 `app/api/health/route.ts`（需先补充 AR1-008）。确保 22 个 FR 全部有明确落点，并在末尾标注"FR 覆盖率：22/22 = 100%" |
| AR1-012 | §2.2 模块依赖关系（第 72-82 行） | **模块依赖关系图存在两处不准确：①缓存模块出现两次（读缓存与写缓存），易误解为两个模块；②渲染模块挂在缓存模块下方，但渲染模块是前端组件，消费 Route Handler 响应，与缓存模块无直接依赖。** 当前图示：`缓存模块（写入缓存）→ 渲染模块（iframe）`，暗示渲染模块依赖缓存模块，实际不符 | 建议 | 修正 §2.2 模块依赖关系图：①将缓存模块合并为一次出现，用"读/写"标注操作类型；②将渲染模块从缓存模块下方移出，改为独立的"Route Handler 响应 → 渲染模块"路径；③建议改为：`输入模块 → Route Handler → 缓存模块(读) → [命中] → Route Handler → 渲染模块` 与 `[未命中] → 编排模块 → ... → 缓存模块(写) → Route Handler → 渲染模块` 两条路径 |
| AR1-013 | §2.1 模块清单（第 59-68 行） | **"输入模块"标注"前端 + Route Handler"边界模糊。** Route Handler（`app/api/solve/route.ts`）是接入层，负责 Zod 校验并调用 Orchestrator，不属于"输入模块"。输入模块应仅指前端输入页 + Zod schema 定义。将 Route Handler 归入输入模块会导致模块边界混乱 | 建议 | 修正 §2.1 输入模块的"类型"列为"前端 + Zod schema"，将 Route Handler 从输入模块移除。Route Handler 作为接入层单独说明（或在编排模块下说明"Route Handler 调用 Orchestrator"）。同时在 §2.1 补充说明"Route Handler（`app/api/solve/route.ts`）为接入层，负责 Zod 校验后调用 Orchestrator，不属于任何单一模块" |
| AR1-014 | §4.2 步骤 6（第 153-155 行）/ FR-007 | **缓存 key 计算方式未说明，开发 agent 无法实现 HtmlCache。** §4.2 步骤 6 说"写入缓存（key = 题目 hash）"，但未说明：①hash 算法（SHA-256？MD5？）；②hash 输入（纯文本题目？含 type 字段？图片 base64？洛谷题号还是抓取后的 Markdown？）；③同一题号不同输入方式（题号 vs 文本）是否能命中同一缓存。这直接影响缓存命中率与正确性 | 建议 | 在 §4.2 步骤 6 补充缓存 key 计算方式：①hash 算法用 SHA-256；②hash 输入为"标准化后的题目内容"——文本输入直接 hash 文本；图片输入 hash base64 内容；洛谷题号先抓取 Markdown 再 hash Markdown 文本（确保同一题不同输入方式命中同一缓存）；③明确 key 格式如 `gesp6:sha256:{hash}`；④在 §6 `html-cache.ts` 接口定义中补充 `get(key: string)`/`set(key: string, html: string)` 方法签名与 lru-cache 容量配置（如 max 100 条，ttl 1 小时） |
| AR1-015 | §8.2 安全（第 353 行）/ §9 风险表 | **速率限制与单飞模式实现方式未说明。** §8.2 提到"单 IP 每分钟 5 次"速率限制，§9 风险表提到"单飞模式（in-flight 请求复用）"作为缓存击穿对策，但均未说明实现方式：速率限制用中间件？内存计数？单飞模式在哪个模块实现（HtmlCache？Orchestrator？）？MVP 无数据库，需明确内存实现方案 | 建议 | 在 §8.2 补充：①速率限制实现——用内存 Map（key 为 IP，value 为时间戳数组）在 Route Handler 或 middleware 中实现，每分钟清理过期记录；②在 §9 风险表"缓存击穿"对策补充"单飞模式在 HtmlCache 模块实现，维护 in-flight Promise Map，相同 key 的并发请求复用同一 Promise"；③在 §6 `html-cache.ts` 接口中补充 `getOrCompute(key: string, compute: () => Promise<string>): Promise<string>` 方法签名 |
| AR1-016 | §11 非功能需求 / §8 非功能设计 | **缺少 NFR 追踪矩阵。** §11 列出 17 个 NFR 清单，§8 非功能设计分散覆盖部分 NFR，但未集中映射。原架构评审 AR1-007 已指出此问题并补充了 NFR 追踪矩阵。本架构同样缺少，不便于开发 agent 核对 NFR 覆盖完整性（如 NFR-016 单元测试在 §8 无落点） | 建议 | 在 §11 NFR 清单后新增"NFR 追踪矩阵"小节，表格格式：`NFR 编号 | 描述 | 架构落点（章节引用）`。覆盖 NFR-001~017 全部 17 项。例如：NFR-001 → §8.1 性能表；NFR-011 → §8.2 安全（iframe sandbox）；NFR-016 → §8 补充测试落点（`__tests__/html-parser.test.ts` + `__tests__/code-validator.test.ts`，遵循 testing-standards.md）。末尾标注"NFR 覆盖率：17/17 = 100%" |
| AR1-017 | §8.2 安全（第 349 行）/ NFR-012 | **g++ 沙箱资源限制（ulimit）具体值未给出。** §8.2 与 NFR-012 提到"临时目录 + 超时 10s + 资源限制（ulimit）"，但未给出 ulimit 的具体值（内存限制？CPU 时间？文件描述符？进程数？）。g++ 编译用户提交的代码有安全风险（fork bomb、内存耗尽、文件读取），具体 ulimit 值对安全很重要 | 建议 | 在 §8.2 补充 g++ 沙箱的具体资源限制：①`ulimit -t 10`（CPU 时间 10 秒，与超时一致）；②`ulimit -v 262144`（虚拟内存 256MB）；③`ulimit -n 64`（文件描述符 64）；④`ulimit -u 1`（单进程，防 fork bomb）；⑤临时目录用 `mktemp -d` 创建，编译后 `rm -rf` 清理；⑥明确在 `code-validator.ts` 中用 `child_process.execFile('g++', [...args], { timeout: 10000, maxBuffer: 1024*1024, env: { ...process.env, PATH: ... } })` 调用，并通过 `ulimit` 子 shell 包裹 |
| AR1-018 | FR-002（第 394 行） | **FR-002 图片限制与原架构不一致，未说明变更理由。** 本架构 FR-002 规定"支持 jpg/png，≤ 5MB"，原架构 spec §NFR-010 规定"jpg/png/webp，≤ 10MB"。本架构去掉了 webp 支持并将上限从 10MB 降为 5MB，但未在 §1.3 或变更记录中说明变更理由。若为有意决策应说明，若为笔误应修正 | 建议 | 在 FR-002 补充说明图片限制的变更理由，或修正为与原架构一致。建议：①若有意降为 5MB（减少 LLM token 消耗），在 §1.3 或 FR-002 注释说明"较原架构 10MB 收紧为 5MB，控制 LLM 输入 token 量"；②若有意去掉 webp（LLM 多模态对 webp 支持差），说明理由；③若为笔误，修正为"jpg/png/webp，≤ 10MB"与原架构一致 |
| AR1-019 | §13 验收标准 AC-008（第 472 行） | **AC-008"可见"不可测试。** AC-008 原文"前端 iframe 能正确渲染 HTML（Mermaid 流程图与思维导图可见）"中"可见"不够明确——如何判定"可见"？是否需要验证 Mermaid 正确渲染为 SVG？无法自动化测试 | 建议 | 修正 AC-008 为可测试表述："iframe srcDoc 设置后，HTML 中的 `<pre class="mermaid">` 代码块被 mermaid.js 渲染为 SVG 元素（DOM 中存在 `svg.mermaid` 节点），流程图节点与思维导图节点可见且可交互"。或拆分为 AC-008a（iframe srcDoc 正确设置）+ AC-008b（Mermaid 渲染为 SVG）两个可独立验证的条件 |
| AR1-020 | §3.1 技术栈表（第 97 行）/ §3.2 依赖变更 | **lru-cache 不在 package.json 中，需明确标注为待新增依赖。** §3.1 列出 lru-cache 11.x，§3.2 标注为"新增"，但 package.json（已核对）中无此依赖。虽然架构设计阶段尚未实施，但 AI-Prompt §4.2.1 硬性约束要求"技术栈必须与项目实际配置一致（核对 package.json）"。开发 agent 实施时需先 `npm install lru-cache`，架构文档应明确列出待新增依赖清单 | 建议 | 在 §3.2 依赖变更表后补充"待新增依赖清单"小节，明确列出：①`lru-cache@^11.0.0`（HTML 内存缓存）；②安装命令 `npm install lru-cache@^11.0.0`；③说明"实施阶段需先执行此命令再开始编码"。同时在 §6 `html-cache.ts` 注释中标注"依赖 lru-cache，需先安装" |
| AR1-021 | §4.2 步骤 4（第 141-146 行）/ FR-013 | **样例比对策略未详述，stdout 比对的容错方式未定义。** §4.2 步骤 4 说"用 samples 跑样例（stdin/stdout 比对）"，FR-013 说"逐个跑样例（stdin/stdout 比对）"，但未说明：①stdout 比对是否容忍末尾换行/空格差异（OJ 常见容错）；②比对失败后携带的"失败样例信息"格式（哪些字段）；③样例部分通过部分失败时是否进入修正循环（是携带所有失败样例还是仅第一个）。这直接影响 CodeValidator 实现 | 建议 | 在 §4.2 步骤 4 补充：①stdout 比对策略——默认严格比对，但可选择"忽略末尾空白字符"（`trim()` 后比对），在 `ValidationResult` 中标注是否启用容错；②失败样例信息格式——`{ sampleIndex: number; input: string; expected: string; actual: string }`；③部分失败处理——所有失败样例均携带进入修正循环，Prompt 中列出全部失败样例供 LLM 修正；④在 §5 CodeValidator 接口定义中补充 `ValidationResult` 结构（见 AR1-002） |

---

## 三、评审总结

### 3.1 整体评价

架构文档整体质量良好，方案 D+ 的七项核心决策（单次多模态调用 + 修正循环 + iframe srcDoc 渲染 + g++ 编译验证 + 4 接口抽象 + Prompt 外部存储 + 无流式）在 §1.2/§4.2 清晰体现，与原架构（ReactFlow + SSE 流式 + Stage1/Stage2）的根本差异在 §1.3 表格对比明确。9 个必备章节齐全，模块划分单一职责基本清晰，技术选型与 package.json 一致（lru-cache 为合理新增）。4 个接口抽象为未来 Agent API 集成预留，符合"为未来 Agent API 集成预留接口"的核心目标，无过度设计。480 行篇幅精炼。

### 3.2 核心问题

本轮评审发现 **11 项重要级问题**，集中在以下五个方面：

1. **接口定义违反 api-conventions.md**（AR1-001/AR1-002/AR1-003）：4 个接口返回类型均未使用 `ServiceResult<T>` 统一格式；7 个共享类型（LLMInput/LLMOutput/Meta/Sample/ValidationResult/Problem/Solution）未定义；Route Handler 缺 Zod schema 与 try-catch 骨架。这三项直接导致开发 agent 无法据此编码，且违反规范。

2. **编排数据流语义歧义**（AR1-004/AR1-005）：修正循环"3 次"的计数语义不清晰（修正次数 vs 总调用次数）；异常流"LLM 格式不合规重试"与修正循环的关系未明确，可能导致实现时重复计数或遗漏。

3. **解析与验证细节缺失**（AR1-006/AR1-007/AR1-021）：状态机解析规则未详述（标记分片/重复/乱序/缺失边界场景）；META 块内部结构未定义（JSON？字段？）；样例比对容错策略未说明。对比原架构对 `<<<CODE>>>/<<<ANALYSIS>>>` 标记的 6 类边界场景详细处理，本架构对 `<<<META>>>/<<<HTML>>>` 标记零边界说明。

4. **目录结构不完整与 FR 覆盖缺口**（AR1-008/AR1-011）：缺少 `/api/health` 端点（FR-020 无落点）、logger 目录、env.ts、components/ui 目录；缺少 FR 追踪矩阵（AI-Prompt §4.2.1 验收标准明确要求）。

5. **安全设计不充分**（AR1-009/AR1-010）：iframe CSP 头策略未具体化、allow-same-origin 未澄清；缺少"修正循环中 LLM 修改非代码章节"风险与对策，修正循环有效性无保障。

### 3.3 修订方向

建议 nextjs-architect 在修订时（v1.1）：

1. **接口定义规范化**（AR1-001/AR1-002/AR1-003）：4 个接口返回类型改为 `ServiceResult<T>`；定义 7 个共享类型；补充 Route Handler Zod schema 与 try-catch 骨架
2. **编排数据流消歧**（AR1-004/AR1-005）：统一修正循环计数表述（1 生成 + 3 修正 = 4 次）；明确格式重试独立于修正循环配额
3. **解析验证细节补充**（AR1-006/AR1-007/AR1-021）：详述状态机解析规则（6 类边界场景）；定义 META 块 JSON 结构；说明样例比对容错策略
4. **目录结构补全**（AR1-008）：补充 health 端点、logger、env.ts、components/ui
5. **追踪矩阵补充**（AR1-011/AR1-016）：新增 FR 追踪矩阵（22 项）与 NFR 追踪矩阵（17 项）
6. **安全设计具体化**（AR1-009/AR1-010）：给出 CSP 头具体策略；明确不加 allow-same-origin；新增"修正循环 LLM 修改非代码章节"风险与对策
7. **酌情采纳建议级问题**（AR1-012~AR1-015/AR1-017~AR1-021）：模块依赖图修正、缓存 key 计算方式、速率限制实现、g++ ulimit 具体值、FR-002 图片限制确认、AC-008 可测试化、lru-cache 新增标注、样例比对策略

### 3.4 问题数量统计

| 严重程度 | 数量 |
|---------|------|
| 阻塞 | 0 |
| 重要 | 11 |
| 建议 | 10 |
| **合计** | **21** |

### 3.5 package.json 核对说明

已核对 `/var/learning/package.json`（存在，name: `cpp-training-assistant`，version: 0.1.0）：
- §3.1 技术栈表中 Next.js 15.x、TypeScript 5.x、Zod 3.x、OpenAI 兼容 SDK（openai ^4.77.0）、lucide-react、shadcn/ui（radix-ui 依赖）均与 package.json 实际依赖一致 ✓
- lru-cache 不在 package.json 中，§3.2 已标注为"新增"，需在实施阶段 `npm install`（见 AR1-020）
- g++ 为系统级依赖，无法从 package.json 核对，合理
- mermaid.js 由 iframe 内 LLM 生成的 HTML 引入，非项目 npm 依赖，合理
