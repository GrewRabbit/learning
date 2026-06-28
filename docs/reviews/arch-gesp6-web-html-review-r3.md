# GESP6 解题网页生成器（Web HTML 架构）评审意见 — 第 3 轮（输入模块专项）

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.3, 700 行, draft）
**对照基准**：v1.2（终审 approved，见 arch-gesp6-web-html-final-review.md）
**评审重点**：输入模块改造（多平台题号、双 key 缓存、文本/图片二级检索、模型能力配置）
**评审时间**：2026-06-29
**评审结论**：需修订

---

## 一、v1.2 基线核对

v1.2 终审结论为 approved，核心基线：4 接口（LLMCaller/HtmlParser/CodeValidator/Orchestrator）+ HtmlCache 返回 ServiceResult<T>、8 共享类型、Zod+try-catch 骨架、CSP 通过 iframe `csp` 属性应用、洛谷抓取前置、格式重试独立配额。v1.3 在此基础上新增 ProblemFetcher/ImageRecognizer 接口、双 key 缓存、多平台配置、模型能力配置，未破坏 v1.2 已通过的设计。

---

## 二、评审维度结论

| # | 维度 | 结论 | 摘要 |
|---|------|------|------|
| 1 | 输入模块改造完整性 | 需修订 | 多平台/双 key/文本检索/图片检索/模型配置框架完整，但 platform 输入抓取前置到主 key 检查之前，削弱主 key 加速目标（AR3-003） |
| 2 | 多平台题号输入设计 | 通过 | PlatformConfig 类型规范可扩展；ProblemFetcher 接口统一路由；洛谷 API + 有道 cheerio 实现方式清晰；URL 提取规则（P11447 含 P、7997 末尾数字）正确 |
| 3 | 双 key 缓存策略 | 需修订 | 主 key/内容 key 格式清晰、查询顺序正确、写入策略合理、HtmlCache 支持双 key 操作；但 getOrCompute/set 未返回 ServiceResult（AR3-002），主 key 检查时机不合理（AR3-003） |
| 4 | 文本二级检索 | 通过 | 标准化规则（trim+合并空白+统一 \n）明确；SHA-256 输入清晰（标准化内容）；命中/未命中流程完整 |
| 5 | 图片二级检索 | 通过 | supportsImage 检测机制清晰；不支持时 UI 提示+GESP6_MODEL_NOT_SUPPORTED 明确；多模态识别→标准化→hash→内容 key 流程与文本输入一致；ImageRecognizer 接口合理 |
| 6 | 模型能力配置 | 通过 | ModelConfig 类型定义规范；supportsImage 字段用于图片前置检测充分；supportsTool 未被引用（AR3-006 建议） |
| 7 | 一致性（Problem 类型变更） | 需修订 | type 'luogu'→'platform' 全文同步（Zod/接口/FR/AC）；错误码 LUOGU→PLATFORM 全文同步；目录结构 problem-fetchers/ 与 FR 矩阵一致；但接口数量标注"6 个"实际 7 个（AR3-001） |
| 8 | 合规性（ServiceResult/Zod/any） | 需修订 | 无 any 类型、无跨模块 ../ 导入、单例导出、Zod+try-catch 齐全；但 HtmlCache.getOrCompute 返回 Promise\<Solution\>、set 返回 void，违反"均返回 ServiceResult\<T\>"声明（AR3-002） |
| 9 | 可实施性 | 通过 | 类型定义完整、接口签名明确、数据流清晰、配置文件类型可编码；具体配置值与实现细节待开发阶段补充（AR3-005/008 建议） |
| 10 | 风险识别 | 通过 | v1.3 新增 3 项风险（DOM 结构变更/图片识别准确率/SSRF）均识别到位；双 key 淘汰一致性与图片识别成本风险未识别（AR3-011/012 建议） |

---

## 三、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR3-001 | §5.1 第 256 行 / AC-013 第 693 行 / NFR-013 第 629 行 | **接口数量标注错误。** §5.1 标题"核心接口抽象（6 个，均返回 ServiceResult\<T\>）"实际列出 7 个接口：LLMCaller、HtmlParser、CodeValidator、Orchestrator、ProblemFetcher、ImageRecognizer、HtmlCache。v1.2 终审基线为 4 接口（不含 HtmlCache 计数），v1.3 新增 ProblemFetcher+ImageRecognizer 后应为 7 个（或明确 HtmlCache 是否计入"核心接口"）。AC-013"6 个核心接口抽象为 TypeScript interface，均返回 ServiceResult\<T\>"作为可验证验收标准会直接失败（数量不符 + AR3-002 返回类型不符） | 重要 | ①将 §5.1 标题改为"7 个"（含 HtmlCache），或将 HtmlCache 明确排除在"核心接口"外并单独说明；②同步更新 AC-013、NFR-013 为正确数量；③若保留"均返回 ServiceResult\<T\>"声明，需先解决 AR3-002 |
| AR3-002 | §5.1 HtmlCache 第 292-294 行 | **HtmlCache 两个方法未返回 ServiceResult\<T\>，违反 §5.1"均返回 ServiceResult\<T\>"声明与 AC-013。** ①`set(primaryKey, contentHash, solution): void`——返回 void 而非 ServiceResult；②`getOrCompute(contentHash, compute): Promise<Solution>`——返回 Promise\<Solution\> 而非 Promise\<ServiceResult\<Solution\>\>。getOrCompute 是读操作（缓存未命中时触发 compute），可能因 LLM 调用失败而需要返回错误，当前签名无法传递错误码。set 返回 void 虽有 §4.4"缓存写入失败仅记日志不阻断"的合理性，但与"均返回 ServiceResult"声明矛盾 | 重要 | ①将 `getOrCompute` 返回类型改为 `Promise<ServiceResult<Solution>>`，compute 回调内 LLM 失败时返回 `{ success: false, error: { code: 'GESP6_INTERNAL_ERROR', ... } }`；②`set` 保留 void 可接受（写失败不阻断），但在 §5.1 补充说明"set 为写操作，失败仅记日志不阻断返回，故返回 void，为 ServiceResult 规范的合理例外"；或将 §5.1"均返回 ServiceResult\<T\>"改为"读操作均返回 ServiceResult\<T\>，写操作 set 返回 void（见 §4.4）" |
| AR3-003 | §4.2 步骤 1 第 180-189 行 / §2.2 关键说明 2 第 111 行 / §4.1 第 165-168 行 | **platform 输入的抓取前置到主 key 检查之前，削弱主 key"加速同 URL 二次查询"优化目标。** §4.2 步骤 1"前置标准化"要求 platform URL 先 ProblemFetcher 抓取，然后才进入"查询顺序"检查主 key。但主 key `gesp6:platform:{platform}:{problemId}` 仅依赖 platform+problemId（由 URL 解析得到，无需抓取），可在抓取前检查。当前设计导致：相同 URL 二次请求仍会发起网络抓取（洛谷 API/有道 DOM），仅省去 hash 计算与 LLM 调用，主 key 的"加速"价值大幅缩水。§2.2 关键说明 2 的理由"内容 key 基于 hash，须先抓取"仅适用于内容 key，不适用于主 key | 重要 | 调整 platform 输入查询顺序为：①解析 URL 提取 platform+problemId → ②检查主 key → 命中则直接返回（**不抓取**）→ ③主 key 未命中则抓取+标准化+hash → ④检查内容 key → 命中返回+回填主 key → ⑤均未命中进入步骤 2。同步修改 §4.2 步骤 1"前置标准化"说明，将主 key 检查从"查询顺序"提到"前置标准化"之前；§4.1 输入数据流 platform 分支同步调整 |
| AR3-004 | §1.3 第 51 行 / §4.1 第 160-163 行 / §1.2 第 34 行 | **图片输入缓存未命中时 LLM 调用次数未说明，与"单次多模态调用"决策关系未澄清。** §1.3 对比表标注"1-5 次（1 生成+最多 1 格式重试+最多 3 修正）"，但图片输入缓存未命中时实际为 2-6 次（1 识别+1 生成+最多 1 格式重试+最多 3 修正）。ImageRecognizer 的识别调用是生成流程之外的额外 LLM 调用，文档未在 §1.3 或 §4.1 明确说明此额外调用与 v1.2"单次多模态 LLM 调用"决策不冲突（"单次"指生成调用，识别为预处理） | 建议 | 在 §4.1 图片输入分支或 §1.3 对比表补充说明："图片输入缓存未命中时，LLM 调用次数为 2-6 次（1 次图片识别预处理 + 1 生成 + 最多 1 格式重试 + 最多 3 修正）。'单次多模态调用'决策指生成阶段为单次调用，图片识别为独立预处理步骤，不冲突" |
| AR3-005 | §5.2 PlatformConfig 第 337-343 行 / §6 platforms.config.ts 第 432 行 | **platforms.config.ts 的 urlPattern 正则与 idExtractor 实现未给出具体值。** PlatformConfig 类型定义了 `urlPattern: RegExp` 和 `idExtractor: (url: string) => string | null`，但未给出洛谷（如 `/^https:\/\/www\.luogu\.com\.cn\/problem\/(P\w+)$/`）和有道（如 `/^https:\/\/oj\.youdao\.com\/problem\/(\d+)$/`）的具体正则与提取逻辑。开发 agent 需自行推断，可能导致实现不一致 | 建议 | 在 §5.2 或 §6 platforms.config.ts 注释中补充两个平台的配置示例（urlPattern 正则 + idExtractor 实现），例如：`{ name: 'luogu', urlPattern: /^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/, idExtractor: (url) => url.match(/^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/)?.[1] ?? null, fetcherType: 'luogu-api' }` |
| AR3-006 | §5.2 ModelConfig 第 346 行 / §8.4 第 528 行 | **models.config.ts 三个问题：①具体配置未给出；②supportsTool 字段未被任何流程引用；③配置来源（硬编码/环境变量）未说明。** supportsTool 在全文无引用，当前架构无 tool calling 场景；模型切换（§8.4"模型切换只改构造参数"）与 models.config.ts 的关系未明确——是硬编码配置表还是从环境变量（如 LLM_MODEL）选取 | 建议 | ①补充 models.config.ts 配置示例（如 GLM-4V supportsImage=true, GLM-4 supportsImage=false）；②若 supportsTool 当前无用，标注"预留字段，当前架构未使用"或移除；③说明配置来源"models.config.ts 为静态声明式配置，LLMCaller 构造时据环境变量 LLM_MODEL 选取对应 ModelConfig" |
| AR3-007 | §4.1 前置处理说明 1 第 172 行 / FR-023 第 576 行 | **文本标准化规则未明确 Unicode 空白字符处理边界。** "多个连续空白字符合并为一个"未说明覆盖范围：是否包括 \u00A0（不间断空格）、\u200B（零宽空格）、\u3000（全角空格）、\t（制表符）等。不同实现对 hash 结果不同，影响跨输入方式缓存命中 | 建议 | 在 §4.1 标准化规则中明确"空白字符"范围，例如"使用 `\s+`（含空格/制表符/换行/回车）合并为单个空格，\u3000 全角空格单独替换为半角空格后再合并；零宽字符（\u200B 等）不视为空白，保留原样" |
| AR3-008 | §7.1 HtmlCache 第 465 行 / §5.1 HtmlCache 第 289-295 行 | **HtmlCache 双 key 在 lru-cache 上的实现方式未说明。** lru-cache 为单 key-value 缓存，双 key（主 key+内容 key）映射同一 Solution 需要实现策略：是维护两个 lru-cache 实例（主 key→Solution + 内容 key→Solution），还是单实例+二级索引（主 key→内容 key→Solution）。影响淘汰一致性与内存占用 | 建议 | 在 §7.1 或 §5.1 HtmlCache 注释中补充实现说明，例如"HtmlCache 内部维护两个 lru-cache 实例：primaryCache（主 key→Solution）与 contentCache（内容 key→Solution），set 时同时写入两个实例，各实例独立 LRU 淘汰" |
| AR3-009 | §5.1 ImageRecognizer 第 284-287 行 / §7.1 第 464 行 | **ImageRecognizer 的识别 Prompt 来源未指定，且依赖 LLMCaller.generate 但语义不匹配。** §7.1 标注 ImageRecognizer 依赖 LLMCaller，但 LLMCaller.generate 的语义为"生成解题 HTML"（输入 LLMInput含 problem+prompt，输出 LLMOutput含 raw HTML），图片识别的输入是 base64 图片、输出是纯文本，与 generate 语义不符。识别 Prompt（如"请识别图片中的编程题目，输出纯文本"）来源未说明——是独立 Prompt 文件还是内联 | 建议 | ①明确 ImageRecognizer 是否复用 LLMCaller.generate（传入识别 Prompt+图片 Problem）还是 LLMCaller 新增 recognize 方法；②指定识别 Prompt 来源（如 `app/lib/ai/prompts/image-recognition-prompt.md`）；③在 §6 目录结构补充该 Prompt 文件 |
| AR3-010 | §4.2 步骤 1 第 187 行 | **"内容 key 命中→回填主 key"的调用序列未显式说明。** §4.2 步骤 1 说"内容 key 命中 → 返回 HTML + 回填主 key"，但未说明由谁、用哪个接口方法执行回填。按 HtmlCache 接口，回填需调用 `set(primaryKey, contentHash, solution)`，即 getByPrimaryKey(miss)→getByContentKey(hit)→set(primaryKey, contentHash, solution) 三步序列，编排模块需协调此序列 | 建议 | 在 §4.2 步骤 1 补充："内容 key 命中时，Orchestrator 调用 `htmlCache.set(primaryKey, contentHash, solution)` 回填主 key（primaryKey 由 platform+problemId 拼接），使后续同 URL 请求命中主 key" |
| AR3-011 | §9 风险表 第 534-547 行 | **双 key 缓存淘汰一致性风险未识别。** 主 key 与内容 key 独立存储（见 AR3-008），LRU 淘汰时可能出现：主 key 被淘汰但内容 key 仍在→平台 URL 查询需重新抓取+hash；或内容 key 被淘汰但主 key 仍在→文本输入同内容查询 miss 触发冗余 LLM 调用。虽不影响正确性（缓存 miss 仅导致重新生成），但影响缓存命中率与性能预期 | 建议 | 在 §9 风险表补充："双 key 缓存淘汰不一致 | 低 | 主 key 与内容 key 独立 LRU 淘汰，可能出现单边淘汰导致缓存命中率下降；对策：内容 key 命中时回填主 key（§4.2 步骤 1）实现自愈；NFR-019 双 key 命中率日志可观测淘汰影响" |
| AR3-012 | §9 风险表 第 534-547 行 | **图片识别 LLM 调用成本风险未识别。** 每次图片输入缓存未命中至少需要 1 次识别调用+1 次生成调用，识别调用虽为"轻量"但仍消耗 token。若大量不同图片输入，识别成本累积。文档未识别此成本风险 | 建议 | 在 §9 风险表补充："图片识别 LLM 调用成本 | 中 | 每次图片输入缓存未命中需额外 1 次识别调用；对策：识别文本 hash 命中内容 key 时省去生成调用（§4.1）；监控识别调用 token 用量；用户可改用文本输入避免识别调用" |
| AR3-013 | §9 风险表 第 539 行 / §8.2 第 506 行 | **有道小图灵 DOM 抓取合法性与 robots.txt/ToS 合规性未提及。** §9 识别了"DOM 结构变更"技术风险，§8.2 识别了 SSRF 安全风险，但未提及抓取有道小图灵站点的法律合规性（robots.txt 是否允许、服务条款是否禁止自动化抓取）。虽为内部培训工具，但架构文档应至少标注合规考量 | 建议 | 在 §9 风险表或 §8.2 补充："有道小图灵 DOM 抓取合规性 | 中 | 需遵守目标站点 robots.txt 与服务条款；对策：实施前核查 robots.txt，控制抓取频率（单飞模式已覆盖），仅用于内部培训用途" |
| AR3-014 | §5.3 第 386-387 行 | **resolvePlatform"抛 GESP6_INPUT_INVALID"与 Route Handler try-catch 实际返回 GESP6_INTERNAL_ERROR 矛盾。** §5.3 说 resolvePlatform"无匹配则抛 GESP6_INPUT_INVALID"，但 resolvePlatform 在 Route Handler try 块内调用（第 380 行），若抛异常会被 catch 捕获返回 `GESP6_INTERNAL_ERROR`（500），而非 `GESP6_INPUT_INVALID`（400）。用户会收到错误的错误码与 HTTP 状态码 | 建议 | 修改 resolvePlatform 为返回 ServiceResult 而非抛异常，Route Handler 检查返回值后决定返回 400+GESP6_INPUT_INVALID；或在 Route Handler 中将 resolvePlatform 调用移出 try-catch 并单独处理异常。文档应明确"resolvePlatform 返回 `{ success: false, error: { code: 'GESP6_INPUT_INVALID' } }`，Route Handler 据此返回 400" |
| AR3-015 | §5.2 PlatformConfig 第 340 行 / §8.2 第 506 行 | **urlPattern 须强制 https 校验未在配置类型或文档中明确。** §8.2 SSRF 防护要求"fetch 仅允许 https"，但 PlatformConfig.urlPattern 类型为 RegExp，未约束正则必须匹配 https。若配置者写出 `urlPattern: /^https?:\/\/.../`（允许 http），则 SSRF 防护的 https 限制在 Zod 层失效，仅靠 fetch 层兜底 | 建议 | 在 §5.2 PlatformConfig 注释或 §8.2 中明确"urlPattern 正则必须以 `^https://` 开头，禁止匹配 http://"，或在 Route Handler resolvePlatform 中增加 `url.startsWith('https://')` 显式校验 |

---

## 四、评审总结

### 4.1 整体评价

v1.3 输入模块改造整体质量**良好**，在 v1.2 approved 基础上完成了多平台、双 key 缓存、文本/图片二级检索、模型能力配置四项核心改造，设计思路清晰、框架完整。主要亮点：

1. **多平台设计规范可扩展**：PlatformConfig 声明式配置 + ProblemFetcher 接口路由，新增平台仅改配置（FR-026），洛谷 API 与有道 cheerio DOM 两种抓取方式分工清晰。
2. **双 key 缓存策略合理**：主 key 加速同 URL 查询、内容 key 实现跨输入方式复用，查询顺序与写入策略明确，HtmlCache 接口支持双 key 操作。
3. **二级检索设计完整**：文本标准化+hash、图片识别为文本后 hash 复用内容 key，跨输入方式缓存复用逻辑自洽。
4. **风险识别有进步**：v1.3 新增 3 项风险（DOM 结构变更/图片识别准确率/SSRF），对策具体可行。
5. **FR/NFR/AC 同步更新**：FR-023~026、NFR-018~019 均有架构落点，追踪矩阵覆盖率 100%。

当前存在 3 个重要问题需修订：接口数量标注错误（AR3-001）、HtmlCache 方法返回类型不合规（AR3-002）、主 key 检查时机削弱优化目标（AR3-003）。均为局部修订，不影响整体架构设计，预计 1 轮修订即可通过。

### 4.2 核心结论

- **评审维度通过率**：6/10 通过，4/10 需修订
- **问题数**：15（阻塞 0 / 重要 3 / 建议 12）
- **评审结论**：需修订（存在 3 个重要问题，不满足"无重要问题"的通过条件）
- **v1.2 基线完整性**：未破坏 v1.2 已通过的设计（CSP/格式重试/修正循环/状态机等均保持一致）

### 4.3 下一轮修订优先级清单

| 优先级 | 编号 | 修订内容摘要 |
|--------|------|------------|
| P1 | AR3-002 | HtmlCache.getOrCompute 返回 ServiceResult\<Solution\>，set 补充 void 例外说明或调整声明 |
| P1 | AR3-001 | §5.1 接口数量"6 个"改为"7 个"，同步 AC-013/NFR-013（依赖 AR3-002 先解决"均返回"声明） |
| P1 | AR3-003 | platform 输入主 key 检查前置到抓取之前，调整 §4.2 步骤 1 前置标准化与查询顺序、§4.1 输入数据流 |
| P2 | AR3-004 | 补充图片输入 LLM 调用次数说明（2-6 次）与"单次多模态调用"不冲突声明 |
| P2 | AR3-010 | 显式说明"回填主 key"三步调用序列 |
| P2 | AR3-014 | resolvePlatform 改为返回 ServiceResult 而非抛异常 |
| P3 | AR3-005~009 | 补充配置具体值、标准化边界、lru-cache 实现方式、识别 Prompt 来源等实现细节 |
| P3 | AR3-011~013 | 补充双 key 淘汰一致性、图片识别成本、有道抓取合规性风险 |
| P3 | AR3-015 | 明确 urlPattern 须强制 https |

### 4.4 合规性核查结果

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 接口返回 ServiceResult\<T\> | ⚠️ 待修订 | 7 接口中 5 个完全合规；ProblemFetcher/ImageRecognizer 合规；HtmlCache 的 getByPrimaryKey/getByContentKey 合规，getOrCompute/set 不合规（AR3-002） |
| Route Handler 有 Zod + try-catch | ✅ 通过 | §5.3 完整骨架，platform URL 白名单校验已加入 Zod refine |
| 无 any 类型 | ✅ 通过 | 全文类型定义均使用具体类型/联合类型/泛型 |
| 无跨模块 ../ 导入 | ✅ 通过 | §6 约束 @/ 绝对路径，NFR-008 明确 |
| 错误码 MODULE_CATEGORY_SPECIFIC | ✅ 通过 | GESP6_INPUT_INVALID/GESP6_PLATFORM_FETCH_FAILED/GESP6_MODEL_NOT_SUPPORTED 等 7 个错误码格式正确 |
| 单例导出 | ✅ 通过 | §7.2 复用清单含"单例导出"，NFR-017 约束 |
| Problem 类型一致性 | ✅ 通过 | type 'luogu'→'platform' 在 §5.2/§5.3/FR/AC 全文同步 |
| 错误码一致性 | ✅ 通过 | GESP6_LUOGU_FETCH_FAILED→GESP6_PLATFORM_FETCH_FAILED 全文同步，无残留 |
| FR/NFR 追踪矩阵 | ✅ 通过 | FR 26/26=100%、NFR 19/19=100%，新增 FR-023~026/NFR-018~019 均有落点 |

### 4.5 可实施性评估

| 评估项 | 结果 | 说明 |
|--------|------|------|
| 类型定义完整 | ✅ | PlatformConfig/ModelConfig/Problem 扩展字段完整，接口签名明确 |
| 多平台抓取可实现 | ✅ | 洛谷 API（已有）+ 有道 cheerio DOM 接口清晰，具体正则待补充（AR3-005） |
| 双 key 缓存可实现 | ⚠️ | 接口支持双 key 操作，lru-cache 实现方式待明确（AR3-008），主 key 检查时机需调整（AR3-003） |
| 图片识别可实现 | ✅ | ImageRecognizer 接口清晰，识别 Prompt 来源待补充（AR3-009） |
| 数据流可实现 | ✅ | §4.1/§4.2 二级检索流程清晰，编排模块协调逻辑可实现（回填序列待显式化 AR3-010） |
| 配置文件可编码 | ✅ | 类型定义完整，开发 agent 可直接编码（具体配置值待补充 AR3-005/006） |
