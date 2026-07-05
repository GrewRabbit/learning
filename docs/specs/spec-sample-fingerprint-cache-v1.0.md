# 样例指纹缓存层 需求规格文档

**版本**：v1.1
**状态**：approved
**创建时间**：2026-07-01
**最后更新**：2026-07-02

## 变更记录

| 版本   | 日期         | 变更内容                                                                                                                                                                       | 参考评审      |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| v1.0 | 2026-07-01 | 初稿创建                                                                                                                                                                       | —         |
| v1.1 | 2026-07-02 | 根据 r1 评审修订：细化 extractSampleFingerprint 实现（语言标记处理、样例章节范围限定）、明确 FR-007 降级路径与 sample 命中后 contentCache 回写策略（方案 B）、明确 FR-016 回填方案、补充边界场景、调整章节顺序、补充集成测试对称用例与前置条件、补充 FR-016 对应 AC | review-r1 |

## 1. 背景与目标

### 背景

当前缓存系统使用双层 key 设计：

* **主 key**（`gesp6:platform:{platform}:{problemId}`）：仅 platform 输入可用，免网络抓取

* **内容 key**（`SHA-256(标准化全文)`）：所有输入方式共享，基于题目全文 hash

实测发现：用户文本方式输入与 platform（URL）方式输入同一道题时，因 fetcher 拼接的 markdown 格式与用户手输格式不同（标题带不带题号、样例章节名不同、代码块包裹格式不同），导致 contentHash 不匹配，文本方式无法命中 platform 方式已生成的缓存，触发重复 LLM 调用（耗时 + 消耗额度）。

实测数据（B3614 栈模板题）：

* 全文 hash：用户文本 `6a6b59c2...` ≠ fetcher `59588fd2...` → miss

* 样例指纹（代码块内容 hash）：用户文本 `3a36dcfa...` === fetcher `3a36dcfa...` → 命中

### 目标

新增"样例指纹"缓存层，作为 contentHash 的补充查询路径，使文本/图片输入方式能命中 platform 方式已生成的缓存，减少重复 LLM 调用。

**约束**：匹配动作由程序完成（正则提取代码块 + SHA-256），不消耗 LLM token。

## 2. 用户故事

作为 GESP 解题系统的用户，当我用文本方式粘贴一道已有 URL 缓存的题目时，我希望系统能直接返回已缓存的解题页面，而不是重新调用 LLM 生成，以节省等待时间和 token 消耗。

## 3. 功能需求

### 3.1 样例指纹提取

* **FR-001**：新增 `extractSampleFingerprint(content: string): string` 函数，位于 `app/lib/ai/services/problem-fetchers/types.ts`

* **FR-002**：提取逻辑分两步：

  * **第一步（样例章节范围识别）**：从 markdown 中匹配"样例"章节范围——以 `^## `  开头且标题含"样例"二字的行（如 `## 样例`、`## 输入输出样例`、`## 输入输出样例 #1`）作为章节起始，到下一个 `^## `  标题或文末为止。若题目无任何含"样例"二字的二级标题，则降级为提取全文所有代码块（兜底，避免无样例章节标题的题目完全失效）。

  * **第二步（代码块提取与标准化）**：在样例章节范围内用正则 `/```[\s\S]*?```/g` 匹配所有代码块；对每个匹配到的完整代码块，去除开头  `` 及可选语言标记（正则 `/^``\[a-zA-Z0-9]\*\n?/`，覆盖 ```cpp、```python、```c 等）和结尾 ```（正则 ` /\n?\`\`\`$/`），再 ` normalizeContent`；用 ` |||`分隔符拼接（选择`|||\` 因代码块内容中极少出现连续三个竖线，collision 风险可忽略）；最后 SHA-256。

* **FR-003**：无代码块时返回空字符串 `''`（降级信号）

* **FR-004**：多组样例按原文出现顺序拼接，不排序

### 3.2 HtmlCache 接口扩展

* **FR-005**：`HtmlCache` 接口新增 `getBySampleFingerprint(sampleFp: string): ServiceResult<{ contentHash: string } | null>` 方法，返回 sample 指纹指向的 contentHash

* **FR-006**：`getOrCompute` 方法签名扩展，新增可选参数 `sampleFp?: string`

* **FR-007**：`getOrCompute` 内部查询顺序：

  1. 查 contentCache\[contentHash] → 命中返回（cached: true）
  2. miss 且 sampleFp 非空 → 查 sampleCache\[sampleFp]：

     * 命中拿到 contentHash2 → 查 contentCache\[contentHash2]：

       * 命中：用当前 contentHash 在 contentCache 建立映射（contentCache\[contentHash] = solution），返回（cached: true）。此回写使后续相同 contentHash 请求直接命中 contentCache，避免重复走 sample 查询路径。

       * 未命中（content 文件缺失/损坏，即 sample 索引失效）：视为 sample 索引失效，继续走第 3 步 compute。FsHtmlCache 实现可选择性删除失效 sample 索引文件实现自愈。

     * miss → 走第 3 步
  3. miss → 调 compute → 写 contentCache\[contentHash] +（若 sampleFp 非空且 result.validated）写 sampleCache\[sampleFp] = contentHash

* **FR-008**：sample 索引仅在 `validated=true` 时回填（与 primary 索引一致，避免缓存错误结果）。**写入位置**：sample 索引由 `getOrCompute` 内部在 compute 成功后写入（因 sampleFp 仅 getOrCompute 知道，`set` 方法签名不包含 sampleFp）；primary 索引由 Orchestrator 调用 `set` 完成。两者写入位置不同但策略一致（仅 validated=true 时写、fire-and-forget）。

### 3.3 FsHtmlCache 文件系统实现

* **FR-009**：sample 索引文件路径：`{baseDir}/sample/{fp前2位}/{fp}.json`

* **FR-010**：sample 索引文件格式：`{ "contentHash": "xxx", "createdAt": "ISO时间" }`（与 primary 索引一致）

* **FR-011**：`getBySampleFingerprint` 读取 sample 索引文件，返回 contentHash（不直接返回 Solution，由调用方再用 contentHash 查 content）

* **FR-012**：写 sample 索引采用 fire-and-forget 异步写入（与现有 primary/content 写入策略一致）

### 3.4 DualKeyHtmlCache 内存实现

* **FR-013**：新增 `sampleCache: LRUCache<string, string>`（key=sampleFp, value=contentHash），max=100, ttl=1h（与现有 LRU 配置一致）

### 3.5 Orchestrator 改造

* **FR-014**：`solveTextOrImage` 方法在算 contentHash 后，额外算 sampleFp，传入 `getOrCompute`

* **FR-015**：`solvePlatform` 方法在 fetcher 抓取标准化后，额外算 sampleFp，传入 `getOrCompute`

* **FR-016**：sample 指针命中时，因 FR-007 第 2 步已在 `getOrCompute` 内部用当前 contentHash 写入 contentCache（方案 B），Orchestrator 回填逻辑不变：仍用当前 contentHash 调用 `cache.set(primaryKey, contentHash, result.data)`。后续 primary 命中 → `getByContentKey(当前contentHash)` → 命中（因 FR-007 已建立映射）。

## 4. 非功能需求

* **NFR-001**：性能——sample 指纹提取为正则 + SHA-256，O(n) 文本长度，单次 <1ms

* **NFR-002**：可靠性——sample 索引读写失败不影响主流程（catch 后降级走 contentHash）

* **NFR-003**：零 LLM token 消耗——指纹提取纯程序逻辑

## 5. 边界与排除项

### 边界场景（降级为现有 contentHash 流程，不影响功能）

| 场景                                              | 行为                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 用户文本无代码块（如只粘描述没粘样例）                             | sampleFp 为空 → 跳过 sample 查询 → 走 contentHash                                                          |
| 用户修改了样例内容                                       | sampleFp 不匹配 → miss → 走 contentHash → LLM 生成                                                        |
| 题目本身无样例                                         | sampleFp 为空 → 走 contentHash                                                                         |
| 用户用缩进而非 \`\`\` 标记代码                             | 正则提取失败 → sampleFp 为空 → 走 contentHash                                                                |
| 题目描述含代码块（如示例代码、伪代码），且用户文本与 fetcher 描述部分代码块格式不一致 | 样例章节识别命中样例代码块，描述代码块不参与指纹 → 不影响。但若题目无"样例"章节标题，降级为提取全文代码块，此时描述代码块格式差异会导致 sampleFp 不匹配 → 走 contentHash |
| 用户只粘贴部分样例 / 样例数量与 fetcher 不一致                   | sampleFp 拼接结果不同 → 不匹配 → miss → 走 contentHash → LLM 生成                                               |
| image 识别文本代码块格式与 fetcher 不一致                    | sampleFp 不匹配 → 降级走 contentHash                                                                      |

### 不做的事

* **不迁移已有缓存**：现有 content 文件无 sample 索引，新方案上线后：

  * platform 方式仍能用 primary 索引命中（不受影响）

  * text 方式首次 miss → LLM 生成 → 自动建 sample 索引，之后能命中

  * 不写迁移脚本（从 HTML 反向提取样例不可靠）

* **不做相似度匹配**：仅精确 hash 匹配，不做模糊比对

* **不改变 content 文件格式**：sample 索引是新增的独立映射文件

## 6. 验收标准

### 功能验收

* [ ] AC-001：`extractSampleFingerprint` 对 B3614 用户文本和 fetcher 抓取内容返回相同 hash

* [ ] AC-002：`extractSampleFingerprint` 对无代码块文本返回空字符串

* [ ] AC-003：`getBySampleFingerprint` 命中时返回正确的 contentHash

* [ ] AC-004：`getOrCompute` 在 contentHash miss + sampleFp 命中时返回缓存的 Solution

* [ ] AC-005：`getOrCompute` 在 contentHash miss + sampleFp miss 时调用 compute

* [ ] AC-006：compute 成功 + validated=true + sampleFp 非空时，写入 sample 索引

* [ ] AC-007：compute 成功 + validated=false 时，不写入 sample 索引

* [ ] AC-008：sample 索引读写失败时不影响主流程（降级走 contentHash）

* [ ] AC-019：带语言标记的代码块（`cpp）与不带标记的相同内容代码块（`）sampleFp 一致

* [ ] AC-020：sample 索引指向的 content 文件缺失时，`getOrCompute` 降级走 compute 路径，不返回错误

### 跨输入方式验收

* [ ] AC-009：text 方式输入 B3614 全文，命中 platform 方式已生成的缓存（cached=true）

* [ ] AC-010：platform 方式提交（已有 text 方式生成的 sample 索引），命中缓存（cached=true）

* [ ] AC-011：image 方式提交（已有其他方式生成的 sample 索引），命中缓存（cached=true）。前置条件：依赖 ImageRecognizer 识别输出的文本包含与 fetcher 拼接格式一致的 \`\`\` 代码块标记；若识别格式不一致，sampleFp 不匹配 → 降级走 contentHash（已在 §5 边界场景列出）

* [ ] AC-018：platform 方式提交且 sample 索引命中时，primary 索引文件被正确写入（后续相同 platform+problemId 请求能通过 primary 前置检查直接命中）

### 测试验收

* [ ] AC-012：单元测试覆盖 extractSampleFingerprint、getBySampleFingerprint、getOrCompute 新逻辑

* [ ] AC-013：集成测试覆盖"跨输入方式命中"场景（含对称用例）

* [ ] AC-014：E2E 测试覆盖 B3614 文本输入命中已有缓存

### 工程验收

* [ ] AC-015：`npm run type-check` 无错误

* [ ] AC-016：`npm test`（单元+集成）全部通过

* [ ] AC-017：`npm run test:e2e:critical` 通过

## 7. 测试实施

### 7.1 单元测试（Vitest，`__tests__/` 同级目录）

| 测试文件                                           | 覆盖内容                                                                                                                                                            | 用例数  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `problem-fetchers/__tests__/types.test.ts`（扩展） | `extractSampleFingerprint`：有代码块/无代码块/多代码块顺序/代码块内容标准化/带语言标记与不带标记一致/样例章节识别/描述含代码块不影响                                                                              | 6-7  |
| `services/__tests__/html-cache.test.ts`（扩展）    | `getBySampleFingerprint` 命中/miss、`getOrCompute` 三条路径（content 命中/sample 命中/compute）、sample 索引回填条件（validated true/false）、sample 命中后 contentCache 回写、sample 索引失效降级 | 8-10 |
| `services/__tests__/fs-html-cache.test.ts`（扩展） | sample 索引文件读写、目录分桶、读写失败降级、失效 sample 索引自愈删除                                                                                                                      | 4-5  |

### 7.2 集成测试（`tests/integration-tests/`）

| 测试文件                       | 覆盖内容    | 用例数 |
| -------------------------- | ------- | --- |
| `orchestrator.test.ts`（扩展） | 见下方用例清单 | 3-4 |

**用例清单**（前置条件：primary 索引不存在，使用未提交过的题号或测试前清理 primary 索引）：

* 用例 1（text 生成 → platform 命中）：mock LLM，text 方式提交 → 验证生成缓存 + 建 sample 索引 → platform 方式提交同题 → 验证命中 sample 索引（cached=true，未调 LLM）

* 用例 2（platform 生成 → text 命中，与 §1 目标场景对齐）：mock LLM，platform 方式提交 → 验证生成缓存 + 建 sample 索引 → text 方式提交同题 → 验证命中 sample 索引（cached=true，未调 LLM）

* 用例 3（可选，sample 索引失效自愈）：前置：手动删除 sample 索引指向的 content 文件 → 提交同题 → 验证降级走 compute + 删除失效 sample 索引

### 7.3 E2E 测试（`tests/e2e-tests/specs/`）

| 测试文件                     | 覆盖内容                                                                            | 标签          |
| ------------------------ | ------------------------------------------------------------------------------- | ----------- |
| `solve-text.spec.ts`（扩展） | 实际用 B3614 文本输入（已有 platform 缓存），验证命中缓存（statusText 含"来自缓存" + 响应 body cached=true） | `@critical` |

> E2E 测试依赖已有 `data/gesp6/primary/luogu_B3614.json` 缓存。若缓存被清理，需先用 URL 方式提交一次生成缓存。

