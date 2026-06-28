# GESP6 解题网页生成器（Web HTML 架构）评审意见 — 第 4 轮

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.4, 700 行, draft）
**对照基准**：r3 评审意见（arch-gesp6-web-html-review-r3.md，15 问题：3 重要 + 12 建议）
**评审时间**：2026-06-29
**评审结论**：通过

---

## 一、r3 问题解决情况核对

| r3 编号 | 问题描述（摘要） | 判定 | v1.4 中的解决位置 | 验证内容 |
|---------|----------------|------|------------------|---------|
| AR3-001 | 接口数量标注错误（标题"6 个"实际 7 个） | 已解决 | §5.1 第 246 行标题 / AC-013 第 693 行 / NFR-013 第 629 行 | §5.1 标题已改为"7 个，读操作均返回 ServiceResult\<T\>"；AC-013 与 NFR-013 同步改为"7 个核心接口，读操作返回 ServiceResult\<T\>，写操作 set 返回 void（见 §4.4）"，数量与返回类型声明均一致 |
| AR3-002 | HtmlCache.getOrCompute/set 未返回 ServiceResult | 已解决 | §5.1 第 280-287 行 / 第 248 行 / 第 286 行 / §4.4 第 240 行 | getOrCompute 返回类型改为 `Promise<ServiceResult<Solution>>`；set 返回 void 并在 §5.1 第 248 行、第 286 行、§4.4 第 240 行三处补充例外说明"写操作 set 返回 void，缓存写入失败仅记日志不阻断，为 ServiceResult 规范的合理例外"；§5.1 标题声明同步调整为"读操作均返回 ServiceResult\<T\>" |
| AR3-003 | platform 输入抓取前置到主 key 检查之前，削弱主 key 加速目标 | 已解决 | §4.2 步骤 1 第 169-179 行 / §2.2 关键说明 2 第 100 行 / §4.1 第 154-159 行 | §4.2 步骤 1 已将"主 key 前置检查"提到"前置标准化"之前："解析 URL 提取 platform+problemId → 检查主 key → 命中直接返回（不抓取、不调用 LLM）→ 未命中进入前置标准化"；§2.2 关键说明 2 明确"主 key 仅依赖 platform+problemId，可在 ProblemFetcher 抓取前检查"；§4.1 输入数据流 platform 分支同步调整为"检查主 key → 命中直接返回 → 未命中才抓取"。三处描述一致 |
| AR3-004 | 图片输入 LLM 调用次数未说明，与"单次多模态调用"决策关系未澄清 | 已解决 | §4.1 前置处理说明 2 第 163 行 | 已补充"图片输入 LLM 调用次数：缓存未命中时为 2-6 次（1 次图片识别预处理 + 1 生成 + 最多 1 格式重试 + 最多 3 修正）。'单次多模态调用'决策指生成阶段为单次调用，图片识别为独立预处理步骤，不冲突" |
| AR3-005 | platforms.config.ts 的 urlPattern 正则与 idExtractor 实现未给出具体值 | 已解决 | §5.2 第 336-340 行 | 已补充洛谷（`/^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/`）与有道小图灵（`/^https:\/\/oj\.youdao\.com\/problem\/(\d+)$/`）的完整配置示例，含 urlPattern 正则、idExtractor 箭头函数实现、fetcherType。正则可正确匹配示例 URL 并提取题号（P11447 / 7997） |
| AR3-006 | models.config.ts 三个问题：具体配置未给出、supportsTool 未引用、配置来源未说明 | 已解决 | §5.2 第 343-346 行 | 已补充：①配置示例 `{ name: 'glm-4v', supportsImage: true, supportsTool: false }` 与 `{ name: 'glm-4', supportsImage: false, supportsTool: false }`；②supportsTool 标注"预留字段，当前架构未使用，为未来 Agent API 集成预留"；③配置来源说明"models.config.ts 为静态声明式配置，LLMCaller 构造时据环境变量 LLM_MODEL 选取对应 ModelConfig" |
| AR3-007 | 文本标准化规则未明确 Unicode 空白字符处理边界 | 已解决 | §4.1 前置处理说明 1 第 162 行 | 已明确："使用 `\s+`（含空格/制表符 `\t`/换行 `\n`/回车 `\r`）合并为单个空格；`\u3000` 全角空格单独替换为半角空格后再合并；零宽字符（`\u200B` 等）不视为空白，保留原样" |
| AR3-008 | HtmlCache 双 key 在 lru-cache 上的实现方式未说明 | 已解决 | §7.1 第 471 行 | 已补充："HtmlCache 内部维护两个 lru-cache 实例：primaryCache（主 key→Solution）与 contentCache（内容 key→Solution），set 时同时写入两个实例，各实例独立 LRU 淘汰" |
| AR3-009 | ImageRecognizer 识别 Prompt 来源未指定，与 LLMCaller.generate 语义关系不清 | 已解决 | §5.1 第 277 行 / §6 第 436 行 / §7.1 第 470 行 | 已明确：①ImageRecognizer 复用 LLMCaller.generate（传入识别 Prompt `image-recognition-prompt.md` + 图片 Problem，输出 LLMOutput.raw 为识别的纯文本）；②§6 目录结构补充 `prompts/image-recognition-prompt.md`；③§7.1 依赖关系明确"LLMCaller.generate（多模态，传入 image-recognition-prompt.md 识别 Prompt + 图片 Problem）" |
| AR3-010 | "内容 key 命中→回填主 key"的调用序列未显式说明 | 已解决 | §4.2 步骤 1 第 177-178 行 | 已显式说明："内容 key 命中 → 返回 HTML + Orchestrator 调用 `htmlCache.set(primaryKey, contentHash, solution)` 回填主 key（primaryKey 由 platform+problemId 拼接），使后续同 URL 请求命中主 key（跨平台/跨输入方式复用）" |
| AR3-011 | 双 key 缓存淘汰一致性风险未识别 | 已解决 | §9 风险表第 544 行 | 已补充："双 key 缓存淘汰不一致 | 低 | 主 key 与内容 key 独立 LRU 淘汰，可能出现单边淘汰导致缓存命中率下降；对策：内容 key 命中时回填主 key（§4.2 步骤 1）实现自愈；NFR-019 双 key 命中率日志可观测淘汰影响" |
| AR3-012 | 图片识别 LLM 调用成本风险未识别 | 已解决 | §9 风险表第 545 行 | 已补充："图片识别 LLM 调用成本 | 中 | 每次图片输入缓存未命中需额外 1 次识别调用；对策：识别文本 hash 命中内容 key 时省去生成调用（§4.1）；监控识别调用 token 用量；用户可改用文本输入避免识别调用" |
| AR3-013 | 有道小图灵 DOM 抓取合法性与 robots.txt/ToS 合规性未提及 | 已解决 | §9 风险表第 546 行 | 已补充："有道小图灵 DOM 抓取合规性 | 中 | 需遵守目标站点 robots.txt 与服务条款；对策：实施前核查 robots.txt，控制抓取频率（单飞模式已覆盖），仅用于内部培训用途" |
| AR3-014 | resolvePlatform 抛 GESP6_INPUT_INVALID 与 Route Handler try-catch 实际返回 GESP6_INTERNAL_ERROR 矛盾 | 已解决 | §5.3 第 379-393 行 | resolvePlatform 已改为返回 `ServiceResult<Problem>`，不抛异常；Route Handler 检查 `resolved.success`，false 时返回 400 + GESP6_INPUT_INVALID；注释明确"resolvePlatform：返回 ServiceResult\<Problem\>，不抛异常（避免被 try-catch 捕获为 GESP6_INTERNAL_ERROR）"。调用序列正确 |
| AR3-015 | urlPattern 须强制 https 校验未在配置类型或文档中明确 | 已解决 | §5.2 第 331 行 / §8.2 第 503 行 / §5.2 配置示例第 338-340 行 | 已在 PlatformConfig.urlPattern 注释明确"必须以 `^https://` 开头，禁止匹配 http://"；§8.2 SSRF 防护同步要求"urlPattern 正则必须以 `^https://` 开头"+"resolvePlatform 中增加 `url.startsWith('https://')` 显式校验（双重保险）"；配置示例的两个 urlPattern 均以 `^https:\/\/` 开头 |

**r3 解决率统计**：已解决 15/15，部分解决 0/15，未解决 0/15

---

## 二、删除比对内容验证

| 核查项 | 结果 | 说明 |
|--------|------|------|
| §1.3"与原架构的根本差异"已删除 | ✅ | v1.4 §1 仅保留 §1.1（背景与目标）和 §1.2（核心架构决策），无 §1.3 |
| §7.2"与原架构的组件复用"已删除 | ✅ | v1.4 §7.2 已替换为"外部服务依赖"（第 473-481 行），原比对内容已移除 |
| 全文无比对残留 | ✅ | 全文检索未发现"与原架构"等比对字样；变更记录 v1.4 行明确说明"删除与原架构比对内容（§1.3 与原架构根本差异、§7.2 与原架构组件复用、文档长度说明中的原架构引用）" |
| 文档长度说明已清理 | ✅ | 第 9 行文档长度说明已无"原架构"字样，仅保留"本文档为设计文档（非代码文件），行数超过 500 行属设计文档合理范围" |
| 无悬空引用 | ✅ | 全文未发现引用已删除章节（§1.3/原 §7.2）的内容 |

---

## 三、评审维度结论

| # | 维度 | 结论 | 摘要 |
|---|------|------|------|
| 1 | 架构完整性 | 通过 | 13 个必备章节完整（架构概述/模块划分/技术选型/数据流/接口定义/目录结构/依赖关系/非功能设计/风险/FR/NFR/边界/AC）；删除比对内容后无悬空引用 |
| 2 | 输入模块改造完整性 | 通过 | 多平台题号（洛谷+有道）、双 key 缓存、文本/图片二级检索、模型能力配置四项改造完整；AR3-003 主 key 检查前置后流程一致性良好 |
| 3 | 双 key 缓存策略 | 通过 | 主 key 前置检查（不抓取）→ 内容 key 查询 → 回填主 key 三步序列清晰；写入策略区分 platform/text/image 输入；lru-cache 双实例实现方式明确 |
| 4 | 一致性 | 通过 | §4.2 步骤 1 / §4.1 输入数据流 / §2.2 依赖图三处对主 key 前置检查描述一致；HtmlCache 接口变更后下游 Orchestrator/Route Handler 调用序列正确；resolvePlatform 改为 ServiceResult 后 Route Handler 调用序列正确；FR-023/024/025 与 §4.1 数据流一致；错误码使用与 §5.4 定义一致 |
| 5 | 合规性 | 通过 | 7 接口读操作均返回 ServiceResult\<T\>；HtmlCache.set 返回 void 有 §4.4/§5.1 三处例外说明；Route Handler 有 Zod + try-catch；无 any 类型；无跨模块 ../ 导入；7 个错误码均符合 MODULE_CATEGORY_SPECIFIC 格式；服务层单例导出（NFR-017）；FR 26/26=100%、NFR 19/19=100% |
| 6 | 可实施性 | 通过 | 类型定义完整（ServiceResult/Problem/Solution/Meta/Sample/LLMInput/LLMOutput/ValidationResult/PlatformConfig/ModelConfig）；接口签名明确；platforms.config.ts/models.config.ts 配置示例可编码；双 key 缓存（lru-cache 双实例）可实现；多平台抓取（洛谷 API + 有道 cheerio）可实现；图片识别（ImageRecognizer + 识别 Prompt）可实现；二级检索数据流可实现 |
| 7 | 风险识别 | 通过 | v1.4 新增 3 项风险（双 key 淘汰一致性/图片识别成本/有道抓取合规性）对策可行：回填主 key 自愈、识别 hash 命中省生成调用、单飞模式控制频率；与 §4.2 步骤 1 回填逻辑、§4.1 图片二级检索流程、§8.2 单飞模式说明均有交叉引用 |

---

## 四、新发现问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR4-001 | §4.2 步骤 1 第 169-179 行 / §5.1 第 283 行 getOrCompute / §7.1 第 471 行 / §8.2 第 507 行 | **§4.2 编排流与 getOrCompute 接口的关系不明确。** §5.1 定义了 `getOrCompute(contentHash, compute)` 接口，§7.1/§8.2 多处引用其作为单飞模式的载体（"getOrCompute 单飞""HtmlCache 维护 in-flight Promise Map，相同 key 的并发请求复用同一 Promise"）。但 §4.2 步骤 1 编排流描述的是 Orchestrator 显式调用 `getByPrimaryKey` → `getByContentKey` → `set` 的序列，未显式调用 `getOrCompute`。开发 agent 无法判断：Orchestrator 应通过 `getOrCompute` 实现"读+计算+写"原子操作以获得单飞去重，还是通过 `getByPrimaryKey`/`getByContentKey` 层的 in-flight Map 实现单飞。两种解读导致实现方式不同 | 建议 | 在 §4.2 步骤 1 或 §8.2 单飞模式说明中明确：①Orchestrator 通过 `getOrCompute(contentHash, compute)` 实现"内容 key 读+LLM 计算+写"原子操作，单飞去重在 getOrCompute 内部 in-flight Promise Map 实现；②主 key 检查（getByPrimaryKey）在前置阶段独立执行，不参与单飞（因主 key 命中无需计算）；③明确 getByPrimaryKey/getByContentKey 是否也维护独立 in-flight Map |
| AR4-002 | §7.1 第 471 行 | **HtmlCache set 操作的写入逻辑未区分 primaryKey 为 null 的情况。** §7.1 描述"set 时同时写入两个实例（primaryCache 与 contentCache）"，但 §4.2 步骤 6 明确"text/image 输入仅写内容 key"（即 primaryKey 为 null）。当前描述未区分 primaryKey 为 null 与非 null 的写入行为，开发 agent 若按字面实现"set 时同时写入两个实例"，会在 text/image 输入时以 null 为 key 写入 primaryCache，产生无效条目浪费内存 | 建议 | 在 §7.1 补充："set 时若 primaryKey 非 null 则同时写入 primaryCache 与 contentCache；若 primaryKey 为 null（text/image 输入）则只写 contentCache，不写 primaryCache" |
| AR4-003 | §4.2 步骤 3 第 186 行 / §4.2 步骤 5 第 200 行 / §4.4 第 236 行 | **格式重试配额的作用范围未明确（生成阶段 vs 修正阶段）。** §4.2 步骤 3 描述"解析失败（无 META 标记）→ 触发 §4.4 格式重试"，适用于任何阶段的解析失败；§4.2 步骤 5 修正循环"回到步骤 3"，意味着修正输出也可能解析失败。§4.4 说"格式重试仅 1 次"，但未明确是"全局 1 次"还是"每个 LLM 调用 1 次"。从 §4.4"最坏累计 5 次（1 生成 + 1 格式重试 + 3 修正）"推断格式重试仅在生成阶段触发，但 §4.2 步骤 3 的通用描述与该推断不一致，开发 agent 无法确定修正阶段解析失败时是否触发格式重试 | 建议 | 在 §4.2 步骤 3 或 §4.4 中明确格式重试配额的作用范围："格式重试仅在生成阶段（步骤 2 后的首次解析）触发，配额全局 1 次；修正循环（步骤 5 回到步骤 3）中解析失败不再触发格式重试，直接降级返回 `{ success: true, data: { html: 原始HTML, validated: false, warning: '修正输出格式不合规' } }`" |
| AR4-004 | §4.2 步骤 1 第 169 行 | **步骤 1 标题"缓存检查"与实际包含的"前置标准化"操作不匹配。** 步骤 1 标题为"缓存检查（双 key 策略）"，但内部包含三个子步骤：①主 key 前置检查（读操作）②前置标准化（含 ProblemFetcher 抓取、ImageRecognizer 识别等产生副作用的操作）③内容 key 查询（读操作）。"缓存检查"标题容易让人误以为步骤 1 仅做读操作，实际还包含网络抓取与 LLM 识别调用 | 建议 | 将 §4.2 步骤 1 标题改为"缓存检查与前置标准化（双 key 策略）"，或在步骤 1 开头补充说明："本步骤包含主 key 检查、前置标准化（抓取/识别）、内容 key 查询三个子步骤，前置标准化可能产生网络与 LLM 调用副作用" |
| AR4-005 | §5.3 第 379-393 行 | **resolvePlatform 的具体函数签名未显式给出。** §5.3 只在注释中描述 resolvePlatform 的行为（"返回 ServiceResult\<Problem\>，不抛异常"），未显式给出函数签名。Route Handler 骨架代码 `const resolved = resolvePlatform(parsed.data.problem)` 体现了使用方式，但参数类型与返回类型需从注释推断。§5.2 共享类型定义也未包含 resolvePlatform 的签名 | 建议 | 在 §5.3 或 §5.2 中显式给出 resolvePlatform 函数签名，例如：`function resolvePlatform(problem: Problem): ServiceResult<Problem>;`，并补充注释说明"若 type==='platform'，遍历 PLATFORMS 匹配 urlPattern，调用 idExtractor 填充 platform/problemId；无匹配或 url 非法返回 { success: false, error: { code: 'GESP6_INPUT_INVALID', message: '不支持的平台 URL' } }" |

---

## 五、评审总结

### 5.1 整体评价

v1.4 在 v1.3 基础上完成了两项关键修订：①删除与原架构比对内容（§1.3、§7.2、文档长度说明中的原架构引用），消除历史包袱；②逐条解决 r3 评审的 15 个问题（3 重要 + 12 建议），解决率 15/15=100%。

**主要改进**：
1. **接口数量与返回类型规范化**（AR3-001/002）：§5.1 标题改为"7 个，读操作均返回 ServiceResult\<T\>"，HtmlCache.getOrCompute 返回 `Promise<ServiceResult<Solution>>`，set 返回 void 并在三处补充例外说明，AC-013/NFR-013 同步更新。
2. **主 key 检查前置**（AR3-003）：§4.2 步骤 1 将主 key 检查提到前置标准化之前，实现"相同 URL 二次请求不抓取、不调用 LLM"的加速目标；§4.1/§2.2 同步调整，三处一致。
3. **配置示例与实现细节补充**（AR3-005/006/007/008/009）：platforms.config.ts/models.config.ts 配置示例可编码，文本标准化 Unicode 空白边界明确，lru-cache 双实例实现方式清晰，ImageRecognizer 识别 Prompt 文件与 LLMCaller 关系明确。
4. **回填主 key 序列显式化**（AR3-010）：§4.2 步骤 1 明确 `htmlCache.set(primaryKey, contentHash, solution)` 三步调用序列。
5. **新增风险对策可行**（AR3-011/012/013）：双 key 淘汰一致性（回填自愈）、图片识别成本（hash 命中省生成）、有道抓取合规性（单飞+核查 robots.txt）均有交叉引用支撑。
6. **resolvePlatform 合规化**（AR3-014/015）：改为返回 ServiceResult 不抛异常，urlPattern 强制 `^https://` 开头 + resolvePlatform 显式 https 校验双重保险。

**当前文档质量水平**：v1.4 已达到可实施状态。13 个必备章节完整，FR 26/26=100%、NFR 19/19=100% 追踪矩阵覆盖，7 个接口签名明确，数据流可实现，配置文件可编码。

### 5.2 核心结论

- **r3 问题解决率**：15/15（100%）
- **新发现问题数**：5
- **严重程度分布**：阻塞 0 / 重要 0 / 建议 5
- **评审结论**：通过
- **通过依据**：无阻塞问题 + r3 重要问题（AR3-001/002/003）全部解决 + 无新发现的重要问题，满足"通过"条件

### 5.3 后续优化建议（非阻塞）

新发现的 5 个建议级问题不影响实施，可在开发阶段同步修正：

| 优先级 | 编号 | 修订内容摘要 |
|--------|------|------------|
| P3 | AR4-001 | 明确 Orchestrator 通过 getOrCompute 实现单飞去重，与 §4.2 编排流的关系 |
| P3 | AR4-002 | §7.1 补充 set 操作区分 primaryKey 为 null 的写入逻辑 |
| P3 | AR4-003 | §4.2/§4.4 明确格式重试配额仅生成阶段触发，修正阶段解析失败直接降级 |
| P3 | AR4-004 | §4.2 步骤 1 标题改为"缓存检查与前置标准化"或补充子步骤说明 |
| P3 | AR4-005 | §5.3 显式给出 resolvePlatform 函数签名 |

### 5.4 合规性核查结果

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 7 接口读操作返回 ServiceResult\<T\> | ✅ 通过 | LLMCaller/HtmlParser/CodeValidator/Orchestrator/ProblemFetcher/ImageRecognizer 均返回 ServiceResult\<T\>；HtmlCache 读操作（getByPrimaryKey/getByContentKey/getOrCompute）返回 ServiceResult，写操作 set 返回 void 有例外说明 |
| HtmlCache.set 返回 void 有合理说明 | ✅ 通过 | §5.1 第 248 行、第 286 行、§4.4 第 240 行三处说明"写操作 set 返回 void，缓存写入失败仅记日志不阻断，为 ServiceResult 规范的合理例外" |
| Route Handler 有 Zod + try-catch | ✅ 通过 | §5.3 完整骨架，Zod schema 含 platform URL 白名单校验，try-catch 兜底 GESP6_INTERNAL_ERROR |
| 无 any 类型 | ✅ 通过 | 全文类型定义均使用具体类型/联合类型/泛型，无 any |
| 无跨模块 ../ 导入 | ✅ 通过 | §6 约束 @/ 绝对路径，NFR-008 明确 |
| 错误码 MODULE_CATEGORY_SPECIFIC 格式 | ✅ 通过 | GESP6_INPUT_INVALID/GESP6_PLATFORM_FETCH_FAILED/GESP6_MODEL_NOT_SUPPORTED/GESP6_LLM_TIMEOUT/GESP6_LLM_FORMAT_ERROR/GESP6_COMPILE_ENV_ERROR/GESP6_INTERNAL_ERROR 共 7 个，格式正确 |
| 单例导出 | ✅ 通过 | §6 约束"服务层单例导出"，NFR-017 明确 |
| FR/NFR 追踪矩阵覆盖率 | ✅ 通过 | FR 26/26=100%、NFR 19/19=100%，新增 FR-023~026/NFR-018~019 均有架构落点 |

### 5.5 可实施性评估

| 评估项 | 结果 | 说明 |
|--------|------|------|
| 类型定义完整 | ✅ | §5.2 共享类型定义完整（ServiceResult/Problem/Solution/Meta/Sample/LLMInput/LLMOutput/ValidationResult/PlatformConfig/ModelConfig） |
| 接口签名明确 | ✅ | 7 个核心接口签名明确，读操作返回 ServiceResult\<T\>，写操作 set 返回 void |
| 配置文件可编码 | ✅ | platforms.config.ts/models.config.ts 配置示例完整可编码 |
| 双 key 缓存可实现 | ✅ | lru-cache 双实例实现方式明确（§7.1） |
| 多平台抓取可实现 | ✅ | 洛谷 API + 有道 cheerio DOM 实现方式清晰，单飞模式覆盖 |
| 图片识别可实现 | ✅ | ImageRecognizer 接口清晰，识别 Prompt 文件已补充，复用 LLMCaller.generate |
| 数据流可实现 | ✅ | §4.1/§4.2 二级检索流程清晰，主 key 前置检查 + 内容 key 查询 + 回填主 key 序列完整 |
