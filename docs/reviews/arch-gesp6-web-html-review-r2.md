# GESP6 解题网页生成器（Web HTML 架构）评审意见 — 第 2 轮

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.1, 576 行）
**对照参考**：arch-cpp-training-assistant-v1.0.md（v1.1, approved）
**评审时间**：2026-06-29
**评审结论**：需修订

---

## 一、r1 问题解决情况核对

| r1 编号 | 问题描述（摘要） | 判定 | v1.1 中的解决位置 | 备注 |
|---------|----------------|------|------------------|------|
| AR1-001 | 4 接口未返回 ServiceResult<T> | 已解决 | §5.1 第 206-228 行 | 4 个接口均改为 `ServiceResult<T>`，并明确说明"所有接口遵循 api-conventions.md ServiceResult<T> 统一返回格式" |
| AR1-002 | 7 个共享类型未定义 | 已解决 | §5.2 第 230-259 行 | Problem/Solution/Meta/Sample/LLMInput/LLMOutput/ValidationResult 全部定义；ValidationResult 增补 `failures` 字段以支持 AR1-021，合理扩展 |
| AR1-003 | Route Handler 缺 Zod schema 与 try-catch 骨架 | 已解决 | §5.3 第 263-291 行 | 完整 `solveRequestSchema` + POST 骨架，含 try-catch、400/500 分支（注：`parsed.error.message` 用法待修正，见 AR2-004） |
| AR1-004 | 修正循环计数语义不清晰 | 已解决 | §4.2 步骤 5 第 151 行 / 步骤 7 第 164 行 / §1.3 第 44 行 / FR-015 第 457 行 | 四处表述统一为"1 生成 + 3 修正 = 4 次" |
| AR1-005 | 异常流"格式重试"与修正循环关系未明确 | 已解决 | §4.4 第 195 行 / §4.2 步骤 3 第 140 行 | 明确"独立于修正循环配额""最坏 5 次（1+1+3）""格式重试仍失败时不进入修正循环" |
| AR1-006 | 状态机解析规则未详述 | 已解决 | §4.2 第 168-174 行 | 含状态转换/分片/重复/乱序/缺失 5 类边界处理 |
| AR1-007 | META 块结构未定义 | 已解决 | §4.2 第 174 行 / §5.2 第 239-242 行 | 明确 JSON 结构 `{ code, samples: [{ input, expectedOutput }] }`，与 Meta/Sample 类型一致 |
| AR1-008 | 目录结构缺少 4 类必要文件 | 已解决 | §6 第 307-341 行 | 补全 health/route.ts、logging/logger.ts、env.ts、components/ui/ |
| AR1-009 | iframe CSP 头策略未具体化 | 已解决 | §8.2 第 397-398 行 / §9 第 431 行 | sandbox 不加 allow-same-origin/allow-top-navigation；CSP 头给出具体策略；风险表对策补充（注：CSP 应用方式见 AR2-001） |
| AR1-010 | 缺少"修正循环中 LLM 修改非代码章节"风险 | 已解决 | §9 第 435 行 | 新增风险项，含三层对策（Prompt 约束 + HTML hash 比对 + 降级仅采纳 code） |
| AR1-011 | 缺少 FR 追踪矩阵 | 已解决 | §10.1 第 466-490 行 | 22 个 FR 全部映射，标注"FR 覆盖率：22/22 = 100%" |
| AR1-012 | 模块依赖关系图不准确 | 部分解决 | §2.2 第 72-82 行 | 渲染模块位置已修正（通过 Route Handler 中转）；但缓存模块仍出现两次（读/写），未合并为一次出现 |
| AR1-013 | 输入模块边界模糊 | 已解决 | §2.1 第 59 行 / 第 68 行 | 类型改为"前端 + Zod schema"；补充 Route Handler 为接入层说明 |
| AR1-014 | 缓存 key 计算方式未说明 | 已解决 | §4.2 步骤 6 第 156-162 行 / §8.1 第 387 行 / §7.1 第 359 行 | SHA-256 + 三种输入方式 + key 格式 `gesp6:sha256:{hash}` + lru-cache 容量配置 + getOrCompute 单飞方法 |
| AR1-015 | 速率限制与单飞模式实现方式未说明 | 已解决 | §8.2 第 401-402 行 / §9 第 433 行 / §7.1 第 359 行 | 速率限制用内存 Map in middleware；单飞模式用 in-flight Promise Map in HtmlCache |
| AR1-016 | 缺少 NFR 追踪矩阵 | 已解决 | §11.1 第 516-533 行 | 17 个 NFR 全部映射，标注"NFR 覆盖率：17/17 = 100%" |
| AR1-017 | g++ 沙箱 ulimit 具体值未给出 | 已解决 | §8.2 第 396 行 / NFR-012 第 509 行 | mktemp -d + rm -rf + timeout 10s + ulimit -t 10/-v 262144/-n 64/-u 1 + child_process.execFile |
| AR1-018 | FR-002 图片限制变更理由未说明 | 已解决 | FR-002 第 444 行 | 补充"较原架构 10MB 收紧为 5MB 以控制 LLM 输入 token 量；去掉 webp 因 LLM 多模态对 webp 支持差" |
| AR1-019 | AC-008"可见"不可测试 | 已解决 | AC-008 第 566 行 | 改为"DOM 中存在 svg.mermaid 节点"，可自动化测试 |
| AR1-020 | lru-cache 待新增依赖未明确标注 | 已解决 | §3.2 第 110-113 行 | 补充"待新增依赖清单"小节 + 安装命令 |
| AR1-021 | 样例比对策略未详述 | 已解决 | §4.2 第 176-179 行 / §5.2 第 253-258 行 | trim 容错 + 失败样例信息格式 + 部分失败携带全部失败样例 + ValidationResult.failures 字段 |

**r1 解决率统计**：已解决 20/21，部分解决 1/21，未解决 0/21

---

## 二、评审维度结论

| # | 维度 | 结论 | 摘要 |
|---|------|------|------|
| 1 | 架构完整性 | 通过 | 9 个必备章节齐全（架构概述/模块划分/技术选型/数据流/接口定义/目录结构/依赖关系/非功能设计/风险与对策），另含 FR/NFR/边界/AC 共 13 章 |
| 2 | 核心架构合理性 | 通过 | 方案 D+ 七项核心决策清晰；修正循环计数消歧完成；异常流与修正循环关系明确；4 接口抽象合理无过度设计 |
| 3 | 模块划分 | 需修订 | 8 模块单一职责清晰，Route Handler 边界已说明；但模块依赖图中缓存模块仍出现两次（AR1-012 部分解决），且洛谷抓取位置与数据流不一致（AR2-002） |
| 4 | 数据流设计 | 需修订 | 正常流/异常流/状态机/META 结构/样例比对均覆盖；但洛谷抓取执行时机与缓存检查顺序矛盾（AR2-002），格式重试成功后流程未明确（AR2-003） |
| 5 | 接口定义 | 通过 | 4 接口返回 ServiceResult<T>；7 个共享类型定义完整且与接口签名一致；错误码符合 MODULE_CATEGORY_SPECIFIC；Route Handler 有 Zod + try-catch 骨架（Zod 错误消息用法待修正 AR2-004） |
| 6 | 目录结构 | 通过 | 文件命名 kebab-case；@/ 绝对路径导入约束；4 类必要文件已补全；目录落点与 FR 追踪矩阵基本一致（FR-018/019 落点缺章节引用 AR2-007） |
| 7 | 技术选型合理性 | 通过 | 与 package.json 一致（已核对）；lru-cache 为待新增依赖已标注；g++、iframe sandbox 选型恰当 |
| 8 | 非功能设计 | 需修订 | 性能/安全/可扩展性/可维护性框架完整；但 CSP 头应用方式未明确（AR2-001），CSP 缺 font-src（AR2-006 合并至 AR2-001） |
| 9 | 风险识别 | 通过 | 识别 8 项风险（含新增"修正循环 LLM 修改非代码章节"）；对策具体可行；建议补充单飞与洛谷抓取交互（AR2-011） |
| 10 | FR/NFR 完整性 | 通过 | FR 追踪矩阵 22/22 = 100%；NFR 追踪矩阵 17/17 = 100%；AC-008 可测试化 |
| 11 | 合规性 | 通过 | 4 接口返回 ServiceResult<T>；Route Handler 有 Zod + try-catch；无 any 类型；无跨模块 ../ 导入；错误码符合格式；单例导出正确 |
| 12 | 可实施性 | 需修订 | 类型定义完整、接口签名明确、目录落点清晰、状态机可实现；但 CSP 应用方式未明确影响 iframe 安全实现（AR2-001），洛谷抓取时机矛盾影响编排流程实现（AR2-002） |

---

## 三、新发现问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| AR2-001 | §8.2 第 398 行 | **CSP 头策略未说明如何应用到 iframe srcDoc 内的 HTML。** 父页面的 CSP 头不会继承到 iframe srcDoc 加载的内容（srcDoc 创建的是独立浏览上下文）。当前文档给出 CSP 头策略但未说明应用机制，若仅依赖父页面 CSP 头则 iframe 内 LLM 生成的 HTML 不受约束，§8.2 安全设计与 §9"HTML 含恶意脚本"风险对策实际失效。另 CSP 头 `default-src 'none'` 未声明 `font-src`，若 Mermaid 需加载字体会被阻止 | 重要 | 明确 CSP 头应用方式（推荐使用 `<iframe sandbox="allow-scripts" csp="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self';">` 的 `csp` 属性，由系统控制不依赖 LLM 输出）；或在 §4.2 步骤 2 说明"LLM 生成的 HTML 头部必须包含 `<meta http-equiv="Content-Security-Policy" content="...">` 标签"，并在 Prompt 文件 `gesp6-skill.md` 中约束 |
| AR2-002 | §2.2 第 81 行 / §4.2 步骤 6 第 160 行 | **洛谷抓取执行时机与模块依赖图不一致。** §4.2 步骤 6 明确"洛谷题号：先抓取 Markdown 再 hash Markdown 文本"作为缓存 key，意味着洛谷抓取必须在缓存检查（步骤 1）之前完成；但 §2.2 模块依赖图中"洛谷抓取模块"挂在缓存模块(读)之后的 Route Handler 分支，且 §4.2 步骤 1 缓存检查未提及洛谷抓取前置。开发 agent 据此实现会导致洛谷题号输入无法正确命中缓存 | 重要 | ①更新 §2.2 模块依赖图，将"洛谷抓取模块"放在缓存检查之前（输入模块 → 洛谷抓取(若题号) → 缓存检查 → ...）；②在 §4.2 步骤 1 补充说明"若输入为洛谷题号，先调用洛谷抓取模块获取 Markdown，再用 Markdown 的 SHA-256 hash 作为缓存 key"；③在 §4.1 输入数据流中明确洛谷题号分支的前置处理 |
| AR2-003 | §4.2 步骤 3 第 140 行 / §4.4 第 195 行 | **格式重试成功后的流程未明确。** §4.4 说"格式重试仍失败时不进入修正循环"，但格式重试**成功**后是否回到步骤 3 重新解析、是否进入步骤 4 编译验证、编译/样例失败时是否仍可进入步骤 5 修正循环（配额是否不变），文档未说明 | 建议 | 在 §4.2 步骤 3 或 §4.4 补充："格式重试成功后，回到步骤 3 重新解析 LLM 输出；解析成功后正常进入步骤 4 编译验证。若编译/样例失败，仍可进入步骤 5 修正循环，修正循环配额不变（最多 3 次）" |
| AR2-004 | §5.3 第 284 行 | **Route Handler Zod 验证失败时 `message: parsed.error.message` 不符合 Zod API。** Zod 的 `parsed.error` 是 `ZodError` 对象，没有顶层 `message` 属性（`message` 是 `Error` 基类属性，值为 "Validation error"）。应使用 `parsed.error.issues[0]?.message` 获取第一个校验失败的具体消息，与原架构 §5.3.3 第 451 行保持一致 | 建议 | 将 `message: parsed.error.message` 改为 `message: parsed.error.issues[0]?.message ?? '输入校验失败'` |
| AR2-005 | §5.4 第 301 行 / §4.4 第 195 行 / §5.1 第 217 行 | **GESP6_LLM_FORMAT_ERROR 错误码使用场景未明确。** §4.4 说格式重试仍失败时"降级返回原始 HTML + warning"（即 `success: true` + warning），§5.1 注释说 HtmlParser 同步方法返回 ServiceResult 以传递 GESP6_LLM_FORMAT_ERROR。但 HtmlParser 解析失败返回 `{ success: false, error: { code: 'GESP6_LLM_FORMAT_ERROR' } }` 后，Orchestrator 如何处理、格式重试由谁触发、最终降级时是否还使用此错误码，文档未串起来 | 建议 | 明确 GESP6_LLM_FORMAT_ERROR 的完整使用链路：①HtmlParser.parseMetaAndHtml 解析失败 → 返回 `{ success: false, error: { code: 'GESP6_LLM_FORMAT_ERROR', message: 'LLM 输出缺少 META 标记' } }`；②Orchestrator 检测到失败 → 触发 §4.4 格式重试（独立配额）；③格式重试仍失败 → Orchestrator 降级返回 `{ success: true, data: { html: 原始HTML, validated: false, warning: 'LLM 输出格式不合规，已降级返回原始 HTML' } }`（此时不再使用 GESP6_LLM_FORMAT_ERROR 错误码，因为是降级成功返回） |
| AR2-006 | §5.2 / §6 types.ts | **ServiceResult<T> 类型定义未在 v1.1 中给出。** §5.1 第 206 行引用了 api-conventions.md 的 ServiceResult<T> 定义，但 §5.2 共享类型定义中未包含此类型，§6 types.ts 注释说"共享类型（§5.2）"但未明确包含 ServiceResult<T>。开发 agent 实施时需要在 types.ts 中定义此类型，可能产生不一致 | 建议 | 在 §5.2 共享类型定义中补充 ServiceResult<T> 类型定义（`type ServiceResult<T> = { success: boolean; data?: T; error?: { code: string; message: string } }`），或在 §6 types.ts 注释中明确"包含 ServiceResult<T>（遵循 api-conventions.md）" |
| AR2-007 | §10.1 第 484-485 行 | **FR-018/019 架构落点缺少 §6 章节引用。** FR-018（loading 动画）落点仅标注 `loading-animation.tsx`，FR-019（警告横幅）落点仅标注 `warning-banner.tsx`，未引用 §6 目录结构中的具体位置。对比其他 FR 均引用了 §6 或 §4.x 章节 | 建议 | 补充架构落点章节引用：FR-018 → `§6 result/components/loading-animation.tsx`；FR-019 → `§6 result/components/warning-banner.tsx` |
| AR2-008 | §5.2 ValidationResult 第 253-258 行 / §4.2 第 177 行 | **ValidationResult 缺少标识是否启用 trim 容错的字段。** §4.2 说"默认严格比对，可选择'忽略末尾空白字符'（trim() 后比对）"，但 ValidationResult 中无字段标识是否启用了容错。LLM 在修正时不知道比对策略，可能产生与容错策略不匹配的修正 | 建议 | 在 ValidationResult 中补充 `trimEnabled: boolean` 字段，或在 failures 字段每项中补充 `trimApplied: boolean`，让 LLM 知道实际比对策略 |
| AR2-009 | §5.3 第 272 行 / §8.2 第 395 行 / FR-003 第 445 行 | **洛谷题号正则 `^P\d+$` 限制过严。** 洛谷题目编号格式包括 P（普通题）、B（普及组）、T（团队题）、CF（Codeforces）、SP（SP 题库）等多种前缀。当前正则会拒绝 B1234、T1234、CF1234A 等合法题号，导致用户输入受限 | 建议 | ①扩展正则为 `^(P|B|T|CF|SP|AT|UVA)\w+$` 覆盖主流前缀；或②在 FR-003/§5.3 中明确说明"当前仅支持 P 开头题号，其他前缀后续扩展"，避免用户困惑 |
| AR2-010 | 全文 | **文档长度 576 行超过 code-style.md 规定的 500 行上限，未声明理由。** 原架构 arch-cpp-training-assistant-v1.0.md 在文档头部有明确声明"行数超过 500 行属设计文档合理范围（spec §5.3 已确立 spec/架构文档分离原则）"，本架构文档无类似声明 | 建议 | 在文档头部（§变更记录后）补充说明"本文档为设计文档（非代码文件），行数超过 500 行属设计文档合理范围（参考原架构 arch-cpp-training-assistant-v1.0.md 文档说明）"；或精简 FR/NFR 追踪矩阵（可合并到 FR/NFR 清单中作为"架构落点"列） |
| AR2-011 | §8.2 第 402 行 / §7.1 第 359 行 / §9 第 430 行 | **单飞模式与洛谷抓取的交互未说明。** 缓存 key 需先完成洛谷抓取（§4.2 步骤 6），意味着 HtmlCache 的 `getOrCompute(key, compute)` 单飞模式只能在洛谷抓取完成后生效。相同洛谷题号的并发请求仍会各自发起洛谷抓取，可能触发反爬限制（§9 风险表"洛谷 API 反爬限制"对策未覆盖此场景） | 建议 | 在 §8.2 或 §9 风险表补充：①洛谷抓取模块也需要单飞模式（相同题号的并发请求复用同一抓取 Promise）；②或明确单飞模式覆盖范围说明"HtmlCache 单飞模式仅覆盖缓存写入后的并发去重，洛谷抓取的单飞由 LuoguFetcher 模块自行实现" |

---

## 四、评审总结

### 4.1 整体评价

v1.1 相对 v1.0 有显著改进：r1 评审的 21 个问题中 20 个已完全解决、1 个部分解决（AR1-012 缓存模块标注但未合并）。修订质量较高，主要体现在：

1. **接口规范化完成**：4 个接口全部返回 `ServiceResult<T>`，7 个共享类型定义完整且与接口签名一致，Route Handler 含 Zod schema + try-catch 骨架，合规性问题清零。
2. **数据流语义消歧**：修正循环计数（1+3=4）、格式重试独立配额（最坏 5 次）、状态机解析规则（5 类边界）、META 块 JSON 结构、样例比对策略全部明确，开发 agent 可据此实现 HtmlParser 与 CodeValidator。
3. **安全设计具体化**：iframe sandbox 策略（不加 allow-same-origin/allow-top-navigation）、g++ ulimit 具体值（-t 10/-v 262144/-n 64/-u 1）、速率限制实现（内存 Map in middleware）、单飞模式实现（in-flight Promise Map in HtmlCache）均落地。
4. **追踪矩阵补全**：FR 22/22、NFR 17/17 覆盖率 100%，AC-008 可测试化。

当前文档质量水平：**良好，接近 approved 标准**，但存在 2 个新发现的重要问题需修订。

### 4.2 核心结论

- **r1 问题解决率**：20/21 已解决，1/21 部分解决（AR1-012），0/21 未解决
- **新发现问题数**：11
- **严重程度分布**：阻塞 0 / 重要 2 / 建议 9
- **评审结论**：需修订

**评审结论说明**：根据 AI-Prompt §4.2.2"通过"条件（无阻塞问题 + r1 重要问题全部解决 + 无新发现的重要问题），当前存在 2 个新发现的重要问题（AR2-001 CSP 应用方式、AR2-002 洛谷抓取时机），故结论为"需修订"。但修订量较小，预计 1 轮修订即可通过终审。

### 4.3 下一轮修订优先级清单（按严重程度排序）

| 优先级 | 编号 | 修订内容摘要 |
|--------|------|------------|
| P1 | AR2-001 | 明确 CSP 头应用到 iframe srcDoc 内 HTML 的方式（推荐 sandbox csp 属性）+ 补充 font-src |
| P1 | AR2-002 | 修正洛谷抓取执行时机（前置到缓存检查之前）+ 更新模块依赖图 + 补充步骤 1 说明 |
| P2 | AR2-003 | 明确格式重试成功后的流程（回到步骤 3 → 步骤 4 → 可进入步骤 5） |
| P2 | AR2-005 | 明确 GESP6_LLM_FORMAT_ERROR 错误码的完整使用链路 |
| P2 | AR2-004 | 修正 Zod 错误消息用法（`parsed.error.issues[0]?.message`） |
| P3 | AR2-006 | 补充 ServiceResult<T> 类型定义 |
| P3 | AR2-008 | ValidationResult 补充 trimEnabled 字段 |
| P3 | AR2-011 | 补充单飞模式与洛谷抓取的交互说明 |
| P3 | AR2-009 | 扩展洛谷题号正则或明确限制说明 |
| P3 | AR2-007 | FR-018/019 架构落点补充 §6 章节引用 |
| P3 | AR2-010 | 文档长度说明或精简 |

### 4.4 合规性核查结果

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 4 个接口返回 ServiceResult<T> | ✅ 通过 | §5.1 第 206-228 行 |
| Route Handler 有 Zod schema + try-catch | ✅ 通过 | §5.3 第 263-291 行（Zod 错误消息用法待修正 AR2-004） |
| 无 any 类型 | ✅ 通过 | 全文 Grep 仅 NFR-005 描述中提及 |
| 无跨模块 ../ 导入 | ✅ 通过 | §6 约束明确 @/ 绝对路径 |
| 错误码符合 MODULE_CATEGORY_SPECIFIC | ✅ 通过 | GESP6_INPUT_INVALID 等 6 个错误码格式正确 |
| 单例导出 | ✅ 通过 | §7.2 复用清单含"单例导出" |
| 技术选型与 package.json 一致 | ✅ 通过 | 已核对 package.json，lru-cache 为待新增已标注 |

### 4.5 可实施性评估

| 评估项 | 结果 | 说明 |
|--------|------|------|
| 类型定义完整 | ✅ | 7 个共享类型 + 接口签名匹配（建议补充 ServiceResult<T> AR2-006） |
| 接口签名明确 | ✅ | 4 接口参数与返回类型清晰 |
| 目录结构落点清晰 | ✅ | §6 完整，FR/NFR 追踪矩阵覆盖 |
| 状态机规则可实现 | ✅ | §4.2 第 168-174 行 5 类边界处理明确 |
| 编排流程可实现 | ⚠️ | 洛谷抓取时机矛盾需先修订（AR2-002） |
| iframe 安全可实现 | ⚠️ | CSP 应用方式需先明确（AR2-001） |
