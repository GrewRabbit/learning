# 样例指纹缓存层 评审意见 — 第 1 轮

**评审对象**：spec-sample-fingerprint-cache-v1.0.md
**评审时间**：2026-07-02
**评审结论**：需修订

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R1-001 | §3.5 FR-016 | FR-016 "sample 指针命中时，回填 primary 索引（仅 platform 方式 + validated=true），与现有 content 命中回填逻辑一致" 未说明回填用的 contentHash 来源。现有 `solvePlatform` 回填逻辑（orchestrator.ts:127-129）使用当前请求的 `contentHash` 调用 `cache.set(primaryKey, contentHash, result.data)`。但 sample 命中时 `result.data` 实际来自 `contentHash2`（sample 索引指向的 contentHash）对应的 content 文件。若按字面"与现有逻辑一致"用当前 `contentHash` 回填 primary，则 primary 索引文件写入 `{contentHash: 当前contentHash}`，但 content 文件实际存储在 `contentHash2.html`。后续 primary 命中 → `getByContentKey(当前contentHash)` → 文件不存在 → miss，导致 primary 索引失效，每次都要重新走 fetcher+sample 查询路径。 | 阻塞 | 明确 sample 命中后的 primary 回填方案，二选一：(A) 扩展 `getOrCompute` 返回值，新增 `actualContentHash` 字段（sample 命中时为 contentHash2，否则为入参 contentHash），Orchestrator 用 `actualContentHash` 回填 primary；(B) `getOrCompute` 命中 sample 时内部用当前 `contentHash` 写一份 contentCache（建立当前 contentHash → Solution 映射），Orchestrator 回填逻辑不变。推荐方案 B，Orchestrator 改动最小且下次同 contentHash 直接命中 contentCache。 |
| R1-002 | §3.1 FR-002 | FR-002 "去掉 ``` 包裹后逐个 normalizeContent" 未说明是否处理代码块语言标记。luogu-fetcher 拼接的样例代码块格式为 ```` ```\n${inp}\n``` ````（无语言标记），但用户文本常用 ```` ```cpp\n code\n``` ````（带语言标记）。正则 `/```[\s\S]*?```/g` 匹配到的完整代码块包含语言标记，若"去掉 ``` 包裹"采用简单 `slice(3, -3)`，则带标记的代码块会保留 `cpp` 前缀，normalizeContent 后变成 `cpp code`，与 fetcher 的 `code` 不一致，sampleFp 不匹配，直接违背 §1 目标场景。 | 重要 | 明确"去掉 ``` 包裹"的实现：去除开头的 ```` ``` ```` 及可选语言标记（如 `cpp`/`python`/`c`），去除结尾的 ```` ``` ````。建议用正则 `/^```[a-zA-Z0-9]*\n?/` 去头、`/\n?```$/` 去尾，或等效实现。补充一条 AC 验证"带语言标记的代码块与不带标记的相同内容代码块 sampleFp 一致"。 |
| R1-003 | §3.1 FR-002 | FR-002 提取"所有代码块"，未区分"样例代码块"与"题目描述中的代码块"。luogu-fetcher 将 `description`/`background`/`hint` 字段原样拼入 markdown（luogu-fetcher.ts:165-178），若题目描述本身含代码块（如示例代码、伪代码），也会被 `extractSampleFingerprint` 提取。用户文本若对描述部分代码块的格式处理不同（如省略、改语言标记、改缩进），会导致 sampleFp 不匹配，命中率下降。§5 边界场景未覆盖此情况。 | 重要 | 二选一：(A) 明确 `extractSampleFingerprint` 仅提取"样例"章节下的代码块（需定义章节识别规则，如 `## 样例` 后到下一个 `## ` 前的范围），并在 §5 补充"描述含代码块"边界场景；(B) 保留"提取所有代码块"设计，但在 §5 明确列出"题目描述含代码块且用户文本与 fetcher 描述部分代码块不一致时，sampleFp 不匹配 → 降级走 contentHash"作为已知边界。推荐方案 A，更符合"样例指纹"语义。 |
| R1-004 | §3.2 FR-007 | FR-007 第 2 步 "查 sampleCache[sampleFp] → 拿到 contentHash2 → 查 contentCache[contentHash2] → 命中返回" 未说明 contentHash2 对应的 content 不存在时如何降级。FsHtmlCache 场景下 content 文件可能因手动清理、磁盘故障、写入失败等原因缺失，此时 sample 索引指向的 contentHash2 已失效。spec 未定义此降级路径，实施时可能误判为"命中但数据损坏"而返回错误。 | 重要 | 在 FR-007 第 2 步补充："若 sampleCache 命中但 contentCache[contentHash2] 未命中（content 文件缺失/损坏），视为 sample 索引失效，继续走第 3 步 compute 路径"。可选择性补充：FsHtmlCache 实现可在检测到 sample 索引指向的 content 不存在时，删除该失效 sample 索引文件（自愈）。 |
| R1-005 | §6.2 集成测试 | §6.2 集成测试描述"先 text 方式提交生成缓存 + 建 sample 索引 → 再 platform 方式提交同题 → 验证命中 sample 索引"，存在两个问题：(1) platform 方式有 primary 前置检查（orchestrator.ts:99-103），若 primary 索引已存在会直接命中 primary 返回，根本不会走到 sample 查询路径，测试前置条件（primary 索引不存在）未说明；(2) 该测试方向是"text 生成 → platform 命中"，而 §1 目标场景是"platform 生成 → text 命中"（文本方式命中 platform 方式已生成的缓存），目标方向的集成测试缺失（虽然 §6.3 E2E 覆盖，但 E2E 依赖已有缓存无法验证完整生成+命中流程）。 | 重要 | (1) 在集成测试描述中明确前置条件："platform 方式的 primary 索引不存在（使用未提交过的题号，或测试前清理 primary 索引）"；(2) 补充对称用例："先 platform 方式提交生成缓存 + 建 sample 索引 → 再 text 方式提交同题 → 验证命中 sample 索引（cached=true，未调 LLM）"，与 §1 目标场景对齐。用例数从 2 调整为 3-4。 |
| R1-006 | §7 AC-011 | AC-011 "image 方式提交（已有其他方式生成的 sample 索引），命中缓存" 未说明前提条件。image 方式需先经 ImageRecognizer 识别为文本，识别输出的文本格式（代码块标记方式、样例章节结构）取决于识别模型，可能与 fetcher 拼接格式或用户手输格式不一致，导致 sampleFp 不匹配。AC-011 作为可验证验收标准，缺少前置假设可能导致无法稳定验证。 | 建议 | 在 AC-011 补充前置条件："依赖 ImageRecognizer 识别输出的文本包含与 fetcher 拼接格式一致的 ```` ``` ```` 代码块标记"；或在 §5 边界场景补充"image 识别文本代码块格式与 fetcher 不一致时，sampleFp 不匹配 → 降级走 contentHash"作为已知边界。 |
| R1-007 | §3.5 FR-016 / §7 | FR-016 "sample 指针命中时回填 primary 索引" 在 §7 验收标准中无对应 AC。FR 与 AC 对应关系不完整，无法验证该功能点是否实现。 | 建议 | 在 §7 补充一条 AC，如"AC-018：platform 方式提交且 sample 索引命中时，primary 索引文件被正确写入（后续相同 platform+problemId 请求能通过 primary 前置检查直接命中）"。 |
| R1-008 | §6 / §7 | spec 章节顺序为 §6 测试实施、§7 验收标准，与 spec-template.md 模板结构（§6 验收标准）不一致。模板未明确禁止调整顺序，但偏离模板可能导致其他角色按模板位置查找时遗漏。 | 建议 | 将 §7 验收标准前移为 §6，§6 测试实施后移为 §7；或合并为"§6 验收标准与测试实施"单章节，先列 AC 再列测试矩阵。 |
| R1-009 | §3.1 FR-002 | FR-002 用 `|||` 作为代码块内容拼接分隔符，未说明选择理由。虽概率极低，但若样例代码块内容本身含 `|||`（如注释、字符串字面量），会导致拼接后哈希不一致。 | 建议 | 说明 `|||` 选择理由（如"代码块内容中极少出现连续三个竖线"），或改用更安全的分隔方案（如长度前缀编码 `${len}||${content}`，或对每个代码块单独哈希后再拼接哈希值）。 |
| R1-010 | §3.2 FR-007 | FR-007 未说明 sample 命中后是否在当前 `contentHash` 写入 contentCache（建立当前 contentHash → Solution 的映射）。若不写，每次相同 contentHash 请求都要重复走"content miss → sample 查询 → contentHash2 查询"三步路径，性能略差；若写，下次直接命中 contentCache[contentHash]，性能更优。 | 建议 | 明确优化策略：sample 命中后，getOrCompute 内部用当前 `contentHash` 写一份 contentCache（与 R1-001 方案 B 一致）。补充说明此写入采用与 compute 成功后相同的 fire-and-forget 策略，不影响响应延迟。 |
| R1-011 | §3.2 / §3.3 / §3.4 | sample 索引的写入位置（getOrCompute 内部 vs `set` 方法）未在 FR 中明确。FR-007 第 3 步"写 contentCache + 写 sampleCache"暗示在 getOrCompute 内部写，但 FR-016 "回填 primary 索引"由 Orchestrator 调用 `set` 完成，两套索引写入位置不一致，实施时可能产生歧义（开发者可能误将 sample 索引写入也放到 `set` 方法）。 | 建议 | 在 FR-007 或 FR-008 明确说明："sample 索引写入由 getOrCompute 内部在 compute 成功后完成（因 sampleFp 仅 getOrCompute 知道，set 方法签名不包含 sampleFp）；primary 索引写入由 Orchestrator 调用 set 完成。两者写入位置不同但策略一致（仅 validated=true 时写、fire-and-forget）。" |
| R1-012 | §5 边界与排除项 | §5 边界场景未列出"样例代码块数量不同"的情况。用户文本可能只粘贴部分样例（如只粘样例 1 不粘样例 2），或 fetcher 抓取的样例数量与用户记忆不同。此时 sampleFp 不匹配（拼接长度不同），降级走 contentHash。该场景与"用户修改了样例内容"不同（内容未改，数量变了），应单独列出。 | 建议 | 在 §5 边界场景表补充一行："用户只粘贴部分样例 / 样例数量与 fetcher 不一致 \| sampleFp 拼接结果不同 → 不匹配 → miss → 走 contentHash → LLM 生成"。 |

## 评审总结

本轮评审发现 1 个阻塞级、4 个重要级、7 个建议级问题，共 12 个问题，结论为**需修订**。

### 核心问题

1. **R1-001（阻塞）**：FR-016 回填 primary 索引时 contentHash 来源未明确。若实施者按字面"与现有逻辑一致"用当前 contentHash 回填，会导致 primary 索引指向不存在的 content 文件，primary 缓存层失效。这是架构性缺陷，必须在 spec 中明确解决方案（推荐方案 B：getOrCompute 命中 sample 时内部用当前 contentHash 写 contentCache）。

2. **R1-002、R1-003（重要）**：`extractSampleFingerprint` 的提取逻辑存在两个影响命中率的歧义点——代码块语言标记处理、样例代码块与描述代码块区分。两者都直接关系 §1 目标场景（用户文本 vs fetcher）能否命中，需在 FR-002 中明确实现细节。

3. **R1-004（重要）**：sample 索引指向的 content 失效时的降级路径未定义，可能导致实施时返回错误而非降级。

4. **R1-005（重要）**：集成测试前置条件缺失 + §1 目标方向集成测试缺失，影响测试可执行性和目标场景验证完整性。

### 修订方向

- §3.1：细化 `extractSampleFingerprint` 实现（语言标记处理、代码块范围限定）
- §3.2：明确 FR-007 降级路径、sample 命中后 contentCache 回写策略、sample 索引写入位置
- §3.5：明确 FR-016 回填方案（contentHash2 来源或方案 B）
- §5：补充边界场景（描述含代码块、样例数量不同）
- §6/§7：调整章节顺序、补充集成测试对称用例与前置条件、补充 FR-016 对应 AC

修订完成后建议进入 r2 评审，重点复核 R1-001、R1-002、R1-003 的修订方案是否消除了实施歧义。
