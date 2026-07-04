# 多解法支持 需求规格文档

**版本**：v1.0
**状态**：draft
**创建时间**：2026-07-02
**最后更新**：2026-07-02

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-07-02 | 初稿创建 | — |

---

## 1. 背景与目标

### 1.1 背景

当前系统采用"一题一解"架构：不同输入方式（URL / text / image）通过样例指纹（`sampleFp`）命中同一缓存，返回同一份 HTML 解法。具体表现：

- 缓存层 [fs-html-cache.ts](file:///var/learning/app/lib/ai/services/fs-html-cache.ts) 的三步查询（content key → sample 指纹 → LLM compute）始终只对应一个 `contentHash`。
- `sample/{fp前2位}/{fp}.json` 索引结构为 `{ contentHash, createdAt }`，单一指向。
- [types.ts](file:///var/learning/app/lib/ai/types.ts) 中 `Solution = { html, validated, warning?, cached }` 仅承载单份解法。
- [result/page.tsx](file:///var/learning/app/result/page.tsx) 中"重新生成"按钮仅以 `<Link href="/solve">` 跳回输入页，并未携带问题标识，无法对同一题强制重生成。
- [api/solve/route.ts](file:///var/learning/app/api/solve/route.ts) 返回 `ServiceResult<Solution>`，单解法。

### 1.2 问题

学习者希望对同一道题看到**多种不同算法思路**（如贪心、DP、递归、暴力、数学公式等）以拓展思维，但当前架构只能给出一份解法，重新提交同题也只会命中缓存返回相同结果。

### 1.3 目标

- 同一道题（以 `sampleFp` 为问题标识）支持最多 **5 种**不同算法思路的解法。
- 达到 5 种上限后，按 **FIFO** 替换最旧解法。
- 正常提交返回全部已有解法供用户切换查看。
- "重新生成"能力可跳过缓存，强制调用 LLM 生成新解法，并注入已有解法摘要到 Prompt 以引导差异化算法思路。
- 向后兼容：现有 `sample/` 与 `primary/` 索引继续工作（Plan B 路径不破坏）。

### 1.4 非目标（见 §5 边界与排除项）

- 不做多用户私有解法池（解法池全局共享）。
- 不做解法质量评分 / 排序 / 推荐算法。
- 不做解法的算法标签自动识别（仅依赖 Prompt 引导 LLM 差异化）。

---

## 2. 用户故事

- **US-001**：作为学生，我希望提交一道题后能看到该题已有的所有解法，以便对比不同算法思路。
- **US-002**：作为学生，我希望在结果页通过"解法 1/5"切换器在不同解法间快速切换，以便逐个学习。
- **US-003**：作为学生，我希望点击"重新生成"按钮后系统能强制调用 LLM 给出一种与已有解法**算法思路不同**的新解法，以便拓展思维。
- **US-004**：作为学生，我希望解法达到 5 种上限后再"重新生成"时，最旧的解法被自动替换，以便解法池始终保持最新且不无限膨胀。
- **US-005**：作为学生，我希望"返回"按钮能直接回到输入页重新提交新题，而不丢失当前结果页上下文。
- **US-006**：作为多用户场景下的学生 A，我希望学生 B 之前为同题生成的解法我也能直接看到，以便共享学习成果。
- **US-007**：作为运维，我希望新增的多解法索引不破坏现有 `sample/`、`primary/` 索引，以便 Plan B 降级路径仍可用。

---

## 3. 功能需求

### 3.1 多解法存储（solutions 索引）

- **FR-001**：新增 `solutions/{sampleFp前2位}/{sampleFp}.json` 多解法索引文件，存储该题所有解法的 `contentHash` 列表。
- **FR-002**：索引文件结构为 `{ sampleFp, contentHashes: Array<{ contentHash, createdAt, variant }>, updatedAt }`，其中 `variant` 为解法序号（从 1 递增）。
- **FR-003**：`contentHashes` 数组长度上限为 **5**；新增解法时若已满 5 个，按 FIFO 移除数组首位（最旧）并追加新解法到末尾。
- **FR-004**：每个解法仍是独立的 `content/{hash前2位}/{hash}.html` + `.json`（`SolutionMeta`），**不重复存储** HTML 内容。
- **FR-005**：保留现有 `sample/{fp前2位}/{fp}.json` 索引，始终指向**首个解法**（`contentHashes[0].contentHash`），保证向后兼容与 Plan B 路径可用。
- **FR-006**：保留现有 `primary/{platform}_{problemId}.json` 索引，行为不变（仍指向首个解法）。
- **FR-007**：`solutions` 索引写入采用 fire-and-forget 异步写入，失败仅记日志不阻断主流程（与现有 `writeSampleIndex` 一致，遵循架构 §4.4）。
- **FR-008**：`solutions` 索引文件损坏 / 不存在时视为未建立，降级走单解法路径（不抛错、不中断渲染）。

### 3.2 缓存逻辑变更

- **FR-009**：正常提交（非重新生成）时，Orchestrator 先查 `solutions` 索引：
  - 命中且 `contentHashes` 非空：依次读取所有 `contentHash` 对应的 `content` 文件，组装为 `Solution[]` 返回（全部 `cached: true`）。
  - 未命中 / 损坏：降级走现有三步查询（content key → sample 指纹 → LLM compute），生成首个解法后写入 `solutions` 索引（`contentHashes` 长度为 1）。
- **FR-010**：重新生成（`forceRegenerate=true`）时，**跳过** content key 与 sample 指纹缓存查询，直接调 LLM 生成新解法：
  - 读取 `solutions` 索引中已有解法的算法摘要（见 FR-019），注入 Prompt。
  - 生成成功后：
    - `contentHashes.length < 5`：追加新解法到末尾，`variant` 取 `length + 1`。
    - `contentHashes.length === 5`：移除首位（FIFO），追加新解法到末尾，并对剩余 4 个解法重新分配 `variant`（1..4），新解法 `variant = 5`。
  - 写入新的 `content` 文件（HTML + meta）。
  - 更新 `solutions` 索引（覆盖写）。
  - 若被 FIFO 替换的旧 `contentHash` 不再被任何索引引用，**不主动清理** content 文件（避免误删，见 §5 边界）。
- **FR-011**：重新生成时，新解法的 `validated` 仍需通过编译验证（与现有流程一致）；`validated=false` 时**不写入** `solutions` 索引（与现有 `writeSampleIndex` 仅 `validated=true` 写入的策略一致），返回降级结果并提示用户。
- **FR-012**：单飞机制（in-flight Promise Map）扩展到 `forceRegenerate` 路径：同一 `sampleFp` 的并发重新生成请求复用同一 Promise，避免短时间内重复调 LLM。
- **FR-013**：`solutions` 索引读操作同步（`readFileSync`，与现有 `getBySampleFingerprint` 一致），写操作异步（fire-and-forget）。

### 3.3 API 变更

- **FR-014**：`POST /api/solve` 正常提交（无 `forceRegenerate` 参数）返回 `ServiceResult<{ solutions: Solution[]; sampleFp: string }>`，其中 `solutions` 为该题全部已有解法（至少 1 个）。
- **FR-015**：`POST /api/solve` 新增可选参数 `forceRegenerate: boolean` 与 `sampleFp: string`：
  - `forceRegenerate=true` 时必须携带 `sampleFp`（Zod 校验，缺失返回 400 `GESP6_INPUT_INVALID`）。
  - `forceRegenerate=true` 时跳过缓存，调 LLM 生成新解法（FR-010），返回 `ServiceResult<{ solutions: Solution[]; sampleFp: string }>`（包含替换后的全部解法）。
  - `forceRegenerate=false` 或未传时走 FR-009 正常流程。
- **FR-016**：`Solution` 类型扩展（[types.ts](file:///var/learning/app/lib/ai/types.ts)）：
  ```typescript
  export type Solution = {
    html: string;
    validated: boolean;
    warning?: string;
    cached: boolean;
    sampleFp: string;   // 新增：问题标识
    variant: number;    // 新增：解法序号（1..5）
  };
  ```
- **FR-017**：Zod schema 扩展：在现有 `solveRequestSchema` 基础上新增 `forceRegenerate` 与 `sampleFp` 字段，并加 `superRefine` 校验二者依赖关系。
- **FR-018**：错误码新增：
  - `GESP6_SOLUTIONS_INDEX_READ_FAILED`：solutions 索引读取失败。
  - `GESP6_REGENERATE_MISSING_SAMPLE_FP`：`forceRegenerate=true` 但未传 `sampleFp`。
  - 错误码命名遵循 `MODULE_CATEGORY_SPECIFIC` 规范（[naming-conventions.md](file:///var/learning/.trae/rules/global/naming-conventions.md)）。

### 3.4 页面变更

- **FR-019**：结果页 [result/page.tsx](file:///var/learning/app/result/page.tsx) 改造为多解法展示：
  - 从 sessionStorage 读取 `Solution[]`（替换现有单个 `Solution`）。
  - 顶部展示解法切换器（Tabs 或下拉选择，建议用 `Tabs` 组件与输入页保持一致风格），格式如"解法 1 / 5"。
  - 切换时仅渲染当前选中解法的 `HtmlRenderer`，避免同时挂载多个 iframe（性能考虑）。
  - 显示解法计数："共 5 种解法"。
- **FR-020**：结果页新增两个按钮（替换现有单一"重新生成" `<Link>`）：
  - "返回"按钮：`<Link href="/solve">` 回到输入页（保持现有行为）。
  - "重新生成"按钮：调用 `POST /api/solve` 并携带 `forceRegenerate=true` + `sampleFp`，loading 状态禁用按钮，成功后更新 sessionStorage 并刷新当前页解法列表，失败时展示错误提示不破坏当前解法展示。
- **FR-021**：`SOLUTION_STORAGE_KEY` 存储内容由 `Solution` 改为 `{ solutions: Solution[]; sampleFp: string }`（与 API 返回结构对齐）。
- **FR-022**：输入页 [solve/page.tsx](file:///var/learning/app/solve/page.tsx) 提交逻辑：成功后将 `{ solutions, sampleFp }` 存入 sessionStorage，跳转 `/result`。
- **FR-023**：重新生成按钮在解法数已达 5 时仍可点击，点击后提示"已满 5 种，将替换最旧解法"（可选确认，MVP 可直接执行）。
- **FR-024**：结果页空数据（sessionStorage 无数据）兜底提示保持现有"未找到解题结果，请重新生成"+ 返回按钮逻辑。
- **FR-025**：UI 样式遵循 [component-rules.md](file:///var/learning/.trae/rules/dev/component-rules.md)：颜色用语义变量（`bg-card` / `text-muted-foreground` / `border-border`），禁止内联 SVG，图标用 `lucide-react`。

### 3.5 Prompt 变更

- **FR-026**：重新生成时，Orchestrator 读取 `solutions` 索引中已有解法的 `content` 文件，从 HTML 中抽取算法摘要（建议从第三章"算法策略"卡片标题或第八章"总结"口诀中提取，每条摘要 ≤ 100 字）。
- **FR-027**：将已有解法摘要注入 Prompt（[gesp6-skill.md](file:///var/learning/app/lib/ai/prompts/gesp6-skill.md)）头部，新增"已有解法"章节，明确要求 LLM：
  - 使用与已有解法**不同**的算法思路（如已有贪心，则改用 DP / 递归 / 暴力 / 数学公式等）。
  - 在第三章"算法策略"中显式说明本解法与已有解法的差异点。
- **FR-028**：Prompt 注入采用模板拼接（与现有 `FIX_PROMPT_TEMPLATE` 一致风格），不修改 `gesp6-skill.md` 原文，由 Orchestrator 在调用 LLM 前动态拼接。
- **FR-029**：当 `solutions` 索引为空或读取失败时，重新生成走原始 Prompt（无已有解法注入），等价于首次生成。

---

## 4. 非功能需求

### 4.1 性能

- **NFR-001**：正常提交返回多解法时，串行读取 N 个 `content` 文件（N ≤ 5），单文件读取 1-5ms，总耗时 ≤ 25ms，可接受。
- **NFR-002**：重新生成耗时与现有首次生成一致（LLM 调用 + 编译验证 + 修正循环），不引入额外性能开销。
- **NFR-003**：解法切换器切换时仅渲染单个 `HtmlRenderer`，避免同时挂载多个 iframe 导致内存占用飙升。

### 4.2 存储

- **NFR-004**：单题存储开销 = 5 × ~17KB ≈ 85KB（HTML）+ 5 × ~1KB（meta）+ 1 × ~1KB（solutions 索引）≈ 91KB/题，可接受。
- **NFR-005**：被 FIFO 替换的旧 content 文件不主动清理（见 §5），长期累积存储开销由运维定期清理（不在本期范围）。

### 4.3 安全

- **NFR-006**：`sampleFp` 作为客户端传入参数，必须在 Server Action / Route Handler 中经 Zod 校验（格式为 hex 字符串，长度 64），禁止直接拼接文件路径（防路径穿越）。
- **NFR-007**：`forceRegenerate` 路径同样经过 SSRF 防护（platform 类型仍需匹配 `PLATFORMS` urlPattern）。
- **NFR-008**：Cookie 配置遵循 [code-style.md](file:///var/learning/.trae/rules/global/code-style.md)（`httpOnly` + `secure` + `sameSite: 'lax'`）。

### 4.4 可访问性

- **NFR-009**：解法切换器 Tabs 需支持键盘导航（方向键切换），遵循 WAI-ARIA Tabs 模式。
- **NFR-010**：重新生成按钮 loading 状态需有 `aria-busy="true"` 属性。

### 4.5 兼容性

- **NFR-011**：现有 `sample/` 与 `primary/` 索引继续工作，Plan B 降级路径不破坏。
- **NFR-012**：已有单解法缓存数据（未迁移到 `solutions/` 索引）在首次正常提交时自动迁移：检测到 `sample` 索引存在但 `solutions` 索引不存在时，用 `sample` 索引的 `contentHash` 初始化 `solutions` 索引（`contentHashes` 长度为 1）。

### 4.6 多用户

- **NFR-013**：解法池全局共享，不同用户提交同一题（相同 `sampleFp`）共享同一 `solutions` 索引。
- **NFR-014**：并发重新生成同一题时，由单飞机制（FR-012）保证不重复调 LLM；写入 `solutions` 索引采用覆盖写（read-modify-write），单飞 Promise 内串行化避免竞态。

### 4.7 可观测性

- **NFR-015**：所有 `solutions` 索引读写操作打日志（`logger.info` / `logger.warn` / `logger.error`），包含 `sampleFp`、`contentHashes.length`、`variant`、`elapsedMs`。
- **NFR-016**：FIFO 替换时打 `logger.info` 日志，记录被替换的 `contentHash` 与新增的 `contentHash`。

---

## 5. 边界与排除项

### 5.1 不做

- **不做**多用户私有解法池：所有用户共享同一题的解法池，不区分用户。
- **不做**解法质量评分 / 排序 / 推荐算法：解法顺序按生成时间 FIFO，不智能排序。
- **不做**解法的算法标签自动识别：仅依赖 Prompt 引导 LLM 差异化，不后处理识别算法类型。
- **不做**被替换 content 文件的主动清理：旧文件留存，由运维定期清理（避免误删仍被其他索引引用的文件）。
- **不做**解法池导出 / 导入功能。
- **不做**解法版本历史（被替换的解法不可恢复）。
- **不做**"重新生成"前的确认弹窗（MVP 直接执行；FR-023 为可选提示）。

### 5.2 边界

- `solutions` 索引上限固定为 5，不可配置（避免引入未经要求的"可配置性"，遵循 [Rule.md](file:///var/learning/.trae/rules/global/code-style.md) 简洁优先）。
- `sampleFp` 为唯一问题标识；`platform` + `problemId` 不作为多解法索引 key（因 text / image 输入无 platform）。
- 重新生成必须携带 `sampleFp`，不接受裸 `forceRegenerate=true`（无问题标识无法定位索引）。

---

## 6. 验收标准

### 6.1 多解法存储

- [ ] **AC-001**：首次提交一道新题后，`solutions/{sampleFp前2位}/{sampleFp}.json` 文件存在，`contentHashes` 长度为 1，`variant=1`。
- [ ] **AC-002**：连续 5 次"重新生成"同一题后，`solutions` 索引 `contentHashes` 长度为 5，`variant` 依次为 1..5。
- [ ] **AC-003**：第 6 次"重新生成"后，`contentHashes` 长度仍为 5，首位（`variant=1` 的旧解法）被替换，新解法 `variant=5`，其余解法 `variant` 重新分配为 1..4。
- [ ] **AC-004**：`sample/{fp前2位}/{fp}.json` 与 `primary/{platform}_{problemId}.json` 索引始终指向 `contentHashes[0].contentHash`（首个解法）。
- [ ] **AC-005**：`solutions` 索引文件被手动删除后，正常提交能自动重建（降级走 LLM 生成首个解法）。

### 6.2 缓存逻辑

- [ ] **AC-006**：正常提交已有 3 个解法的题，返回 `solutions` 数组长度为 3，全部 `cached: true`。
- [ ] **AC-007**：`forceRegenerate=true` 提交时，不读取 content key 缓存，直接调 LLM（可通过日志验证无"第 1 步 content 命中"日志）。
- [ ] **AC-008**：重新生成的新解法 `validated=false` 时，`solutions` 索引不更新（长度不变），API 返回降级结果与 warning。
- [ ] **AC-009**：并发 2 次 `forceRegenerate=true` 同一题，仅触发 1 次 LLM 调用（单飞命中日志）。

### 6.3 API

- [ ] **AC-010**：`POST /api/solve` 正常提交返回 `{ success: true, data: { solutions: Solution[], sampleFp: string } }`。
- [ ] **AC-011**：`forceRegenerate=true` 未传 `sampleFp` 时返回 400 `GESP6_INPUT_INVALID`。
- [ ] **AC-012**：`sampleFp` 格式非法（非 64 位 hex）时返回 400 `GESP6_INPUT_INVALID`。
- [ ] **AC-013**：`Solution` 类型包含 `sampleFp` 与 `variant` 字段。

### 6.4 页面

- [ ] **AC-014**：结果页展示"解法 1 / 5"切换器，切换时仅渲染当前解法的 HTML。
- [ ] **AC-015**：结果页有"返回"与"重新生成"两个按钮。
- [ ] **AC-016**：点击"重新生成"按钮后，按钮显示 loading 状态，成功后解法列表更新（如已满 5 则首位被替换）。
- [ ] **AC-017**：点击"返回"按钮跳转到 `/solve` 输入页。
- [ ] **AC-018**：解法数为 1 时，切换器仍展示"解法 1 / 1"（不隐藏）。
- [ ] **AC-019**：sessionStorage 无数据时展示"未找到解题结果"兜底页。

### 6.5 Prompt

- [ ] **AC-020**：重新生成时 LLM 输入 Prompt 包含"已有解法"章节，列出已有解法的算法摘要。
- [ ] **AC-021**：重新生成的新解法 HTML 第三章"算法策略"中包含与已有解法的差异说明（人工抽检）。
- [ ] **AC-022**：`solutions` 索引为空时重新生成，Prompt 不含"已有解法"章节（等价于首次生成）。

### 6.6 兼容性

- [ ] **AC-023**：已有 `sample` 索引存在但 `solutions` 索引不存在时，首次正常提交自动迁移，`solutions` 索引 `contentHashes` 长度为 1，`contentHash` 与 `sample` 索引一致。
- [ ] **AC-024**：现有 Plan B 降级路径（sample 索引失效自愈）不受影响，单元测试通过。

### 6.7 非功能

- [ ] **AC-025**：单题存储开销 ≤ 100KB（5 解法 + 索引）。
- [ ] **AC-026**：正常提交返回 5 解法总耗时 ≤ 50ms（不含 LLM 调用）。
- [ ] **AC-027**：`sampleFp` 路径穿越测试（传入 `../` / `..%2F` 等）返回 400，不读取非法路径文件。
- [ ] **AC-028**：解法切换器支持键盘方向键导航。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| LLM 不遵守"差异化算法"指令 | 重新生成出与已有解法雷同的解法 | Prompt 中显式列举已有算法类型并要求"必须不同"；如连续 2 次生成雷同解法，可在 Orchestrator 层记录 warning 提示用户（非本期范围） |
| `sampleFp` 路径穿越攻击 | 读取 / 写入任意文件 | Zod 校验为 64 位 hex；`getSolutionsIndexPath` 内部用 `path.join` 拼接，禁止接受 `..` |
| 并发重新生成导致 `solutions` 索引竞态 | 索引丢失解法或重复解法 | 单飞机制（FR-012）保证同一 `sampleFp` 的并发请求串行化 |
| 被替换的旧 content 文件累积 | 存储开销增长 | 本期不处理，运维定期清理；后续可加引用计数清理（非本期范围） |
| 已有单解法缓存未迁移 | 老数据无法享受多解法 | NFR-012 自动迁移：首次正常提交时用 `sample` 索引初始化 `solutions` 索引 |
| sessionStorage 存储多解法数据超限 | 5 × 17KB ≈ 85KB 接近 5MB 上限的 1.7% | 可接受；如未来解法变大可改为仅存 `sampleFp` + 当前 `variant`，按需从 API 拉取（非本期范围） |

---

## 8. 技术决策记录

### 8.1 为什么用 `sampleFp` 作为多解法索引 key

- `sampleFp` 是所有输入方式（text / image / platform）统一的问题标识，text / image 无 `platform` + `problemId`。
- 现有 `sample` 索引已用 `sampleFp`，多解法索引复用同一 key 保持一致性。

### 8.2 为什么不修改 `gesp6-skill.md` 原文

- `gesp6-skill.md` 是稳定的 skill 定义，修改会影响所有生成路径。
- 重新生成时通过 Orchestrator 动态拼接"已有解法"章节到 Prompt 头部，与现有 `FIX_PROMPT_TEMPLATE` 拼接方式一致。

### 8.3 为什么 FIFO 替换而非 LRU

- 解法无访问频率统计（多用户共享，无法统一），FIFO 更简单可预测。
- 遵循 [Rule.md](file:///var/learning/.trae/rules/global/code-style.md) 简洁优先：不为一次性代码做抽象。

### 8.4 为什么不主动清理被替换的 content 文件

- 旧 `contentHash` 可能仍被其他 `solutions` 索引（不同 `sampleFp`）或 `primary` 索引引用，主动清理有误删风险。
- 引用计数清理超出本期范围，留给后续优化。

### 8.5 为什么 `forceRegenerate` 复用 `/api/solve` 而非新建端点

- 复用现有 Zod 校验、SSRF 防护、Orchestrator 调用链，减少重复代码。
- 仅新增 2 个可选参数，API 契约向后兼容。

---

## 9. 涉及文件（预估）

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `app/lib/ai/types.ts` | 修改 | `Solution` 扩展 `sampleFp` + `variant`；新增 `SolutionsPayload` 类型 |
| `app/lib/ai/services/fs-html-cache.ts` | 修改 | 新增 `getSolutionsIndex` / `writeSolutionsIndex` 方法；扩展 `getOrCompute` 支持 `forceRegenerate` |
| `app/lib/ai/services/html-cache.ts` | 修改 | `HtmlCache` 接口新增多解法方法；`DualKeyHtmlCache` 同步实现 |
| `app/lib/ai/services/orchestrator.ts` | 修改 | `solve` 方法支持 `forceRegenerate`；新增摘要抽取与 Prompt 注入逻辑 |
| `app/lib/ai/prompts/regenerate-prompt-template.ts` | 新增 | 重新生成 Prompt 模板（已有解法注入） |
| `app/api/solve/route.ts` | 修改 | Zod schema 扩展 `forceRegenerate` + `sampleFp`；返回 `SolutionsPayload` |
| `app/result/page.tsx` | 修改 | 多解法展示 + 切换器 + 两个按钮 |
| `app/result/components/solution-switcher.tsx` | 新增 | 解法切换器组件 |
| `app/solve/page.tsx` | 修改 | sessionStorage 存储结构改为 `SolutionsPayload` |
| `app/lib/ai/services/fs-html-cache.test.ts` | 新增 / 修改 | 多解法索引读写单测 |

---

## 10. 后续工作（非本期范围）

- 解法算法标签自动识别与展示。
- 被替换 content 文件的引用计数清理。
- 解法质量评分与排序。
- 多用户私有解法池。
- 解法版本历史与恢复。
