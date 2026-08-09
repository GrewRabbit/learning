# Spec 阶段调度 Prompt 方案

> **用途**：总调度 agent 指挥子 agent 完成 spec「制作 → 审核 → 修订 → 终审」完整闭环的标准化 prompt
> **范围**：Spec 生成 / 评审 / 修订 / 终审（架构设计前的需求规格化阶段）
> **拆分粒度**：以「approved PRD 中一个内聚功能域」为一个 spec，每个 spec 独立走完整闭环
> **评审策略**：**强制满 2 轮**（r1 评审 → r1 修订 → r2 评审 → r2 修订 → 终审），**至少审核修订 2 轮才能终审**
> **版本**：v1.0
> **创建时间**：2026-08-10
> **依据规范**：[AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md)（§4.1 Spec 场景、§5.5 调度编排、§3.1 Prompt 标准格式）
> **规则来源**：`.opencode/rules/`（与 `.trae/rules/` 内容一致，本方案统一以 `.opencode/rules/` 为准）

---

## 一、任务拆分方案

| 阶段 | 任务 | 目标 Agent | 输入 | 输出 | 优先级 |
|------|------|-----------|------|------|:----:|
| 生成 | Spec 初稿 | nextjs-spec-generator | approved PRD + 背景/集成文档 + 源码上下文 | `docs/specs/spec-{SLUG}-v1.0.md`（draft） | P0 |
| 评审 r1 | 第 1 轮评审 | nextjs-spec-reviewer | spec-v1.0 + PRD + 背景/集成文档 | `docs/reviews/spec-{SLUG}-review-r1.md` | P0 |
| 修订 r1 | 第 1 轮修订 | nextjs-spec-generator | spec-v1.0 + review-r1 | `docs/specs/spec-{SLUG}-v1.1.md`（原文件修订，draft） | P0 |
| 评审 r2 | 第 2 轮评审 | nextjs-spec-reviewer | spec-v1.1 + PRD + 背景/集成文档 + review-r1 | `docs/reviews/spec-{SLUG}-review-r2.md` | P0 |
| 修订 r2 | 第 2 轮修订 | nextjs-spec-generator | spec-v1.1 + review-r2 | `docs/specs/spec-{SLUG}-v1.2.md`（原文件修订，draft） | P0 |
| 终审 | 最终决议 | 总调度 agent（自行执行，不调度子 agent） | spec-v1.2 + review-r1 + review-r2 + PRD | approved / blocked 决议 | P0 |

> **拆分粒度判定**（按 [§5.3.4](./AI-Prompt使用规范.md)）：每个 spec 覆盖一个可独立验收的功能域（如 SSO 登录登出、结果中继页面、用量计量），单文件 ≤ 500 行；一个 PRD 可拆为多个 spec，各 spec 独立闭环、可并行。

---

## 二、调度架构

```
[启动] 总调度 agent
  │
  ├─ 前置条件检查：PRD 必须为 approved 状态（draft 禁止进入 spec 阶段）
  │
  ├─ [阶段1: 生成] 调度 1× nextjs-spec-generator（每 spec 一个实例，可并行）
  │     └─ 产出: docs/specs/spec-{SLUG}-v1.0.md（draft）
  │
  ├─ [阶段2: 评审 r1] 调度 1× nextjs-spec-reviewer
  │     └─ 产出: docs/reviews/spec-{SLUG}-review-r1.md
  │
  ├─ [阶段3: 修订 r1] 调度 1× nextjs-spec-generator
  │     ├─ 输入: spec-v1.0 + review-r1
  │     └─ 产出: docs/specs/spec-{SLUG}-v1.1.md（原文件修订，版本号内部递增）
  │
  ├─ [阶段4: 评审 r2] 调度 1× nextjs-spec-reviewer
  │     ├─ 输入: spec-v1.1 + review-r1（核对遗留问题）
  │     └─ 产出: docs/reviews/spec-{SLUG}-review-r2.md
  │
  ├─ [阶段5: 修订 r2] 调度 1× nextjs-spec-generator
  │     ├─ 输入: spec-v1.1 + review-r2
  │     └─ 产出: docs/specs/spec-{SLUG}-v1.2.md（原文件修订，版本号内部递增）
  │
  └─ [阶段6: 终审] 总调度 agent 自行执行
        ├─ 输入: spec-v1.2 + review-r1 + review-r2 + PRD
        ├─ 决议: approved（仅改状态字段）/ blocked（人工介入）
        └─ approved 后的 spec 方可交给 nextjs-architect
```

**调度原则**（按 [§5.1.3](./AI-Prompt使用规范.md)）：

| 原则 | 本方案体现 |
|------|-----------|
| 最小上下文 | 集成指南等大文档只读指定章节（见 §四），禁止全量加载 |
| 最大并行 | 多个 spec 相互独立，阶段 1 可并行生成；单个 spec 内阶段串行 |
| 单点决策 | 终审由总调度统一裁决，子 agent 不互相通信、不互相调用 |
| 状态可追溯 | 通过文件版本号 + 状态字段（draft/approved）+ 评审归档文件全程可追溯 |
| 失败隔离 | 某 spec 失败不阻塞其他独立 spec |

---

## 三、评审轮次策略（强制满 2 轮）

> 区别于 [§5.5.3](./AI-Prompt使用规范.md) 默认的「r1 干净可提前通过」，本项目**强制满 2 轮**，用户明确要求至少审核修订 2 轮才能终审。

| 规则 | 说明 |
|------|------|
| **强制满 2 轮** | 无论 r1 评审结论是「需修订」还是「通过」，都必须继续执行 r2 评审 + 修订，禁止提前 approved |
| 轮次上限 | 自动流程最多 2 轮；终审仍存在阻塞问题 → 标记 blocked，请求人工介入，不自动进入第 3 轮 |
| 每轮评审对象 | r1 → spec-v1.0；r2 → spec-v1.1 |
| 每轮修订产出 | r1 → spec-v1.1；r2 → spec-v1.2（均在原文件上修订，版本号 minor+1） |
| r2 评审必须核对 | 逐条核对 r1 问题在 v1.1 中的解决状态，并给出解决率 |
| 终审仅核查 | r1、r2 的**阻塞问题**是否在 v1.2 中全部解决 + PRD 需求是否全覆盖，**不发现新问题**（防无限循环） |
| 评审角色隔离 | reviewer 只输出意见文件，禁止修改 spec 正文（修订由 spec-generator 执行） |

**版本与文件规则**（按 [spec-workflow.md](../.opencode/rules/spec/spec-workflow.md)）：

- spec 正文：`docs/specs/spec-{SLUG}-v{major}.{minor}.md`，单文件原则（文件名带版本号，每轮修订 minor+1），初稿 v1.0，终审后 v1.2
- 评审意见：`docs/reviews/spec-{SLUG}-review-r{轮次}.md`，r1、r2 各一份，归档后**禁止修改**
- spec 状态：draft（生成/修订后）→ approved（终审通过，仅改状态字段，不改正文）

---

## 四、背景知识

### 4.1 项目简介

本方案适用于 `/var/learning`（`gesp6-web-html`，GESP6 信奥赛 C++ 解题网页生成器）：

- **技术栈**：Next.js 15（App Router，含 `[locale]` 国际化）+ TypeScript + Tailwind CSS
- **业务**：洛谷题目（GESP 六级）解题网页生成，含流程图/思维导图/代码，调用 OpenAI 模型生成；核心业务已完成
- **现有模块**：`app/solve`（输入页）、`app/result`（结果页）、`app/api/solve`（提交/轮询/取消）、`app/lib/ai`（AI 编排服务）、`middleware.ts`（速率限制，SSO 认证接入点）
- **测试**：Vitest（单元/集成，全 mock）+ Playwright（E2E，`@smoke`/`@no-llm`/`@llm` 分级）
- **认证现状**：`middleware.ts` 服务端校验，登录页 `/login`，数据变更优先 Server Actions

### 4.2 方案输入文件

| 文件 | 作用 | 读取方式 |
|------|------|---------|
| `docs/{PRD_FILE}` | Spec 唯一需求来源（须 approved） | 按 §章节 读取 |
| `docs/{CONTEXT_FILES}` | 背景/第三方集成文档（如 SSO IDP 集成指南） | **仅读指定章节**，大文档禁止全量加载 |
| `.opencode/rules/spec/spec-template.md` | spec 正文模板 | 全量（小文件） |
| `.opencode/rules/spec/spec-workflow.md` | 工作流约束 | 全量（小文件） |
| `.opencode/rules/global/*` | 代码风格 / 命名 / 安全 | 按需 |
| `package.json` | 核对技术栈 | 全量 |
| 现有源码（可选） | 规格与实现现实对齐 | 限定范围，只读与功能域直接相关的文件 |

---

## 五、Prompt A — Spec 生成

### 一、通用模板

```
你是 nextjs-spec-generator，任务：基于 approved 的 PRD 生成【{SPEC_NAME}】需求规格文档初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md  — spec 正文模板结构
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 工作流与命名规范
3. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范（含 spec 文件命名）
4. {PROJECT_ROOT}/.opencode/rules/global/code-style.md   — 代码风格与安全约束
5. {PROJECT_ROOT}/.opencode/rules/INDEX.md               — 规则体系导航

【输入文件】
1. {PROJECT_ROOT}/{PRD_FILE}（已 approved 的 PRD，唯一需求来源）
   - 必读章节：{PRD_SECTIONS}
   - 仅读取上述章节，不读全文档（大文档禁止全量加载）
2. {PROJECT_ROOT}/{CONTEXT_FILES}（背景/第三方集成文档）
   - 必读章节：{FRAMEWORK_SECTIONS}
   - 作用：理解第三方系统能力与集成约束（协议、端点契约、安全要求），仅读取指定章节
3. {PROJECT_ROOT}/package.json
   - 核对技术栈与 PRD 技术约束一致（Next.js 15 App Router + TypeScript + Tailwind）
4. 现有源码（可选，限定范围，用于规格与实现现实对齐）：
   - {SOURCE_CONTEXT}
   - 禁止通读全量源码，仅读取与 {SPEC_NAME} 直接相关的文件

【输出】
- 文件路径：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.0.md
- 状态：draft
- 严格遵循 spec-template.md 结构：变更记录 / 背景与目标 / 用户故事 / 功能需求 / 非功能需求 / 边界与排除项 / 验收标准

【硬性约束】
1. 禁止照搬第三方集成文档的示例代码，仅参考协议/端点/安全约束（FR 以 PRD 需求为准）
2. 所有功能需求必须编号（FR-001、FR-002...），编号连续无缺漏
3. 所有验收标准必须可测试、可验证（checkbox 列表，AC-001 起）
4. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式（如 AUTH_LOGIN_*）
5. 禁止创建多个版本文件（始终只有一份，版本号写在文件内部）
6. 单文件 ≤ 500 行；若超出，在"边界与排除项"说明拆分计划
7. 必须明确"不做什么"（边界与排除项章节）
8. spec 阶段禁止做技术选型、模块划分、数据模型等架构决策（属于架构设计阶段）
9. 每个 FR 必须可追溯到 PRD 的功能项/用户故事
10. 涉及认证/会话/密钥的安全需求，必须与集成文档的安全要求一致（如 Cookie httpOnly/secure/sameSite、client_secret 仅服务端、PKCE、state CSRF、开放重定向防御）

【验收标准】
- 文件已创建在 {PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.0.md
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 每个 FR 可追溯到 PRD
- 引用的集成文档章节准确无误
- 未混入架构设计内容（技术选型/模块划分/数据模型）

完成后返回：
- 文件路径
- 章节大纲
- FR/AC 数量统计
- PRD 覆盖情况（已覆盖功能项/总数）
- 引用的集成文档章节清单
- 阻塞问题（如有）
```

### 二、参数填充表

| 参数 | 值 | 说明 |
|------|-----|------|
| `{SPEC_NAME}` | 如「SSO 集成（登录登出与会话）」 | spec 中文名称，与 PRD 拆分的内聚功能域一致 |
| `{SLUG}` | 如 `sso-auth` | spec 英文标识，kebab-case |
| `{PRD_FILE}` | `docs/prd/prd-{slug}.md` | 输入 PRD，**必须为 approved 状态** |
| `{PRD_SECTIONS}` | 如 `§6.1、§6.2、§7.2` | PRD 中对应功能域的功能/非功能章节 |
| `{CONTEXT_FILES}` | 如 `docs/integration-guides/sso-idp-sp-integration-guide.md` | 背景/第三方集成文档（无则省略） |
| `{FRAMEWORK_SECTIONS}` | 如 `§1.5、§1.6、§2、§3.1、§3.3、§3.4、§4.1、§5` | 集成文档必读章节（按 §0.2 按需加载） |
| `{SOURCE_CONTEXT}` | 如 `middleware.ts、app/layout-client.tsx、app/api/solve/route.ts、app/lib/env.ts、next.config.ts` | 现有源码上下文（限定范围） |
| `{PROJECT_ROOT}` | `/var/learning` | 项目根目录 |

---

## 六、Prompt B — Spec 评审

### 一、通用模板

```
你是 nextjs-spec-reviewer，任务：对【{SPEC_NAME}】spec 第 {ROUND} 轮评审。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 评审角色职责与命名
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md  — 评审对照模板

【输入文件】
1. 待评审 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{VERSION}.md
2. 对应 PRD：{PROJECT_ROOT}/{PRD_FILE}
   - 对照章节：{PRD_SECTIONS}
   - 用于核对需求覆盖性与可追溯性
3. 背景/集成文档：{PROJECT_ROOT}/{CONTEXT_FILES}
   - 对照章节：{FRAMEWORK_SECTIONS}
   - 核对 spec 中的第三方约束（协议/端点/安全要求）与集成文档是否一致
4. 上轮评审意见（仅当 {ROUND} > 1）：
   - {PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{PREV_ROUND}.md
   - 核对上轮问题是否已在当前版本解决

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
- 评审意见文件一旦归档禁止修改
- 严格遵循 spec-template.md 中的"评审意见文件模板"

【评审维度】（逐项检查，每项给出结论）
1. 完整性：模板必备章节是否齐全；FR/AC 编号是否连续
2. 可追溯性：每个 FR 是否可追溯到 PRD；有无遗漏需求或超出 PRD 范围
3. 准确性：是否与 PRD 需求一致；有无曲解需求
4. 第三方对齐：涉及第三方集成的需求（如 SSO），是否与集成文档的端点/契约/安全要求一致
5. 可测试性：每个 AC 是否可验证、可测试
6. 边界清晰度："边界与排除项"是否明确不做什么
7. 合规性：是否违反 spec-workflow.md 的 MUST/MUST NOT；是否混入架构设计内容（技术选型/模块划分/数据模型）；错误码格式是否合规
8. 一致性：FR 与 AC 是否对应；有无需求遗漏或冗余
9. 安全性：认证/会话/密钥处理是否遵循安全要求（Cookie 标志、PKCE、state CSRF、client_secret 仅服务端、开放重定向防御）；是否包含敏感信息泄露风险；是否缺少输入验证要求

【问题清单格式】
| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议（按 [§11.2](./AI-Prompt使用规范.md)）
- 阻塞级问题必须导致"需修订"结论
- 编号格式：R{ROUND}-001、R{ROUND}-002...

【评审结论】
- 需修订：存在阻塞或重要问题
- 通过：仅剩建议级问题或无问题
- 注意：无论结论为何，本方案强制满 2 轮评审，spec 不会在本轮直接 approved

【硬性约束】
1. 评审角色禁止直接修改 spec 正文，只输出意见文件
2. 禁止粘贴 spec 原文到评审文件（仅引用章节 / FR / AC 编号）
3. 每个问题必须给出具体修订建议，不可仅指出问题
4. 不得代替需求方做需求决策（需求模糊应标记为问题，而非自行决断）
5. {ROUND} > 1 时，必须逐条核对上轮 r{PREV_ROUND} 问题在 v{VERSION} 中的解决状态（已解决/未解决/部分解决），并在评审总结中给出解决率

完成后返回：
- 评审文件路径
- 问题数量统计（阻塞/重要/建议）
- 上轮问题解决率（仅当 {ROUND} > 1）
- 评审结论
```

### 二、参数填充表

| 参数 | r1 值 | r2 值 |
|------|-------|-------|
| `{ROUND}` | `1` | `2` |
| `{VERSION}` | `v1.0` | `v1.1` |
| `{PREV_ROUND}` | —（不填） | `1` |
| 上轮评审文件 | — | `docs/reviews/spec-{SLUG}-review-r1.md` |
| 输出文件 | `docs/reviews/spec-{SLUG}-review-r1.md` | `docs/reviews/spec-{SLUG}-review-r2.md` |

其余参数（`{SPEC_NAME}`、`{SLUG}`、`{PRD_FILE}`、`{PRD_SECTIONS}`、`{CONTEXT_FILES}`、`{FRAMEWORK_SECTIONS}`、`{PROJECT_ROOT}`）与 Prompt A 一致。

---

## 七、Prompt C — Spec 修订

### 一、通用模板

```
你是 nextjs-spec-generator，任务：根据第 {ROUND} 轮评审意见修订【{SPEC_NAME}】spec。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 修订流程约束
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md  — 模板结构
3. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. 当前 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{CURRENT_VERSION}.md
2. 评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
3. 对应 PRD（如需核对）：{PROJECT_ROOT}/{PRD_FILE}
   - 核对章节：{PRD_SECTIONS}
4. 背景/集成文档（如需核对）：{PROJECT_ROOT}/{CONTEXT_FILES}
   - 核对章节：{FRAMEWORK_SECTIONS}

【操作要求】
1. 在原 spec 文件上直接修订（不新建文件）
2. 文件内版本号更新为 v{NEXT_VERSION}
3. 在"变更记录"表格新增一行：v{NEXT_VERSION} | 日期 | 根据 r{ROUND} 评审修订 | review-r{ROUND}
4. 状态保持 draft（未通过终审前不改为 approved）

【修订原则】
1. 逐条对照评审问题清单（R{ROUND}-001、R{ROUND}-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由（在变更记录或修订说明中标注）
4. 建议级问题酌情采纳
5. 禁止将评审意见原文直接粘贴进 spec
6. 禁止删除已通过的 FR/AC，仅可修改或新增
7. 若评审意见涉及需求歧义且 PRD 未澄清，标记为待业务方确认，不自行决断

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订
2. 禁止改动与评审意见无关的内容
3. 修订后 FR/AC 编号必须保持连续
4. 修订后仍需保持所有必备章节完整
5. 单文件 ≤ 500 行

【验收标准】
- 文件版本号已更新为 v{NEXT_VERSION}
- 变更记录已新增 v{NEXT_VERSION} 行
- 所有阻塞级问题已解决
- 所有重要级问题已解决或给出理由
- 输出修订对照表：R{ROUND}-编号 | 是否解决 | 修订位置

完成后返回：
- 文件路径
- 修订对照表
- 阻塞问题解决率
- 待业务方确认清单（如有）
```

### 二、参数填充表

| 参数 | r1 修订值 | r2 修订值 |
|------|----------|----------|
| `{ROUND}` | `1` | `2` |
| `{CURRENT_VERSION}` | `v1.0` | `v1.1` |
| `{NEXT_VERSION}` | `v1.1` | `v1.2` |
| 评审意见文件 | `docs/reviews/spec-{SLUG}-review-r1.md` | `docs/reviews/spec-{SLUG}-review-r2.md` |

其余参数与 Prompt A 一致。

---

## 八、Prompt D — Spec 终审

> **适用角色**：总调度 agent 自行执行（不调度子 agent），按 [§4.1.4](./AI-Prompt使用规范.md)。

```
你是总调度收尾 agent，任务：汇总【{SPEC_NAME}】spec 的第 2 轮修订结果，做最终决议。

【输入文件】
1. 第 2 轮修订后的 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.2.md
2. 第 2 轮评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r2.md
3. 第 1 轮评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r1.md
4. 对应 PRD：{PROJECT_ROOT}/{PRD_FILE}
   - 核对章节：{PRD_SECTIONS}

【任务】
1. 读取 r1、r2 评审意见和对应修订版 spec（v1.1、v1.2）
2. 核对修订版是否已解决 r1、r2 中的所有阻塞级问题
3. 核对 spec 是否覆盖 PRD 中的全部功能需求（每个 PRD 功能项/用户故事有对应 FR）
4. 做决议：
   - v1.2 已解决全部阻塞问题 + PRD 需求全覆盖 → 将 spec 状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题或需求遗漏 → 标记为 blocked，列出剩余问题，请求人工介入（不进入第 3 轮）
5. 输出汇总报告（直接回复，不写文件）：
   - spec 终审状态（approved / blocked）
   - 阻塞问题清单（如有）
   - 阻塞问题解决率（已解决数/两轮问题总数）
   - PRD 需求覆盖率（已覆盖数/总数）
   - 是否可进入架构设计阶段
   - Spec→架构衔接要点（哪些 spec 章节需要架构阶段重点关注）

【硬性约束】
1. 仅修改状态字段，不改动 spec 正文内容
2. approved 状态的 spec 才可交给 nextjs-architect
3. draft 状态的 spec 禁止进入架构设计/开发
4. 终审仅核查 r1、r2 阻塞问题是否解决，不重新发现新问题（防止无限循环）
5. PRD 需求覆盖率必须 100%，任何遗漏都视为阻塞
6. 终审不得代替需求方做需求决策
```

---

## 九、调度执行顺序

> 单个 spec 严格串行执行以下步骤；多个 spec 在阶段 1 可并行，各 spec 闭环相互独立。

```
Step 1 [串行] Prompt A — Spec 生成（nextjs-spec-generator）
   ├─ 前置条件：PRD 已 approved（draft 禁止进入）
   ├─ 产出验证：spec-{SLUG}-v1.0.md 存在、状态 draft、FR/AC 编号连续、未混入架构内容
   └─ 未通过 → 修订 Prompt A 后重发（最多 2 次），仍失败标记 blocked

Step 2 [串行] Prompt B — 评审 r1（nextjs-spec-reviewer）
   ├─ 产出验证：review-r1 存在、编号 R1-xxx 连续、每个问题有修订建议
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 3（强制满 2 轮，不提前 approved）

Step 3 [串行] Prompt C — 修订 r1（nextjs-spec-generator）
   ├─ 输入：spec-v1.0 + review-r1
   ├─ 产出验证：spec-v1.1 存在、版本号已更新、变更记录已加行、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt C（最多 2 次）

Step 4 [串行] Prompt B — 评审 r2（nextjs-spec-reviewer）
   ├─ 输入：spec-v1.1 + review-r1（核对遗留问题）
   ├─ 产出验证：review-r2 存在、含上轮问题解决率、编号 R2-xxx 连续
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 5（强制满 2 轮）

Step 5 [串行] Prompt C — 修订 r2（nextjs-spec-generator）
   ├─ 输入：spec-v1.1 + review-r2
   ├─ 产出验证：spec-v1.2 存在、版本号已更新、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt C（最多 2 次）

Step 6 [串行] Prompt D — 终审（总调度自行执行）
   ├─ 输入：spec-v1.2 + review-r1 + review-r2 + PRD
   ├─ 决议：approved（改状态字段）/ blocked（人工介入）
   └─ 终审通过 → spec 进入架构设计阶段
```

**故障恢复**（按 [§5.4](./AI-Prompt使用规范.md)）：瞬时错误自动重试（最多 3 次，指数退避）；参数错误修正后重新派发；子 agent 产出不符合验收标准时分析原因、修订 Prompt 后重发（最多 2 次）；仍失败标记 blocked 请求人工介入。

---

## 十、关键设计要点

| 要点 | 说明 |
|------|------|
| **强制满 2 轮** | 用户明确要求，区别于规范默认；即使 r1 干净也必须走 r2，至少审核修订 2 轮才能终审 |
| **角色隔离** | reviewer 只评审不修订（T5）；generator 只生成/修订（T6）；终审由总调度执行，子 agent 不互相调用 |
| **上下文隔离** | 集成指南等大文档只读指定章节（P2）；现有源码限定范围读取；禁止全量加载 |
| **版本控制** | 单文件原则，版本号内部递增 v1.0→v1.1→v1.2（T7）；评审意见独立归档禁止修改 |
| **依赖串行** | 生成→评审→修订→评审→修订→终审严格串行，保证每阶段产出经过验证 |
| **并行度** | 多个 spec 相互独立可并行生成/评审；有依赖的功能域拆到不同 spec 或先后执行 |
| **阻塞兜底** | 自动流程最多 2 轮，终审仍阻塞则 blocked，不无限循环（T9） |
| **安全** | spec 涉及认证/会话/密钥时必须与集成文档安全要求一致（PKCE、state、id_token 验证、Cookie 标志、client_secret 保护、开放重定向防御） |
| **返回格式** | 每个 Prompt 末尾要求返回结构化摘要，便于总调度决策（T10） |

---

## 十一、文件清单（预期产出）

| 文件 | 阶段 | 状态 |
|------|------|------|
| `docs/specs/spec-{SLUG}-v1.0.md` | 生成 | draft → 修订后 v1.1 → v1.2 |
| `docs/specs/spec-{SLUG}-v1.1.md` | 修订 r1 | 原文件上修订（单文件原则，物理文件始终为最新版本，文件名带当前版本号） |
| `docs/specs/spec-{SLUG}-v1.2.md` | 修订 r2 | **approved**（终审通过后状态字段） |
| `docs/reviews/spec-{SLUG}-review-r1.md` | 评审 r1 | 归档只读 |
| `docs/reviews/spec-{SLUG}-review-r2.md` | 评审 r2 | 归档只读 |

> **说明**：按 [spec-workflow.md](../.opencode/rules/spec/spec-workflow.md)，spec 采用"单文件 + 文件名带版本号"：每轮修订在原文件上直接修改并递增版本号，文件名同步更新为最新版本；评审意见文件按轮次独立归档。

---

## 附录 A：SSO 集成实例（spec-sso-auth）

> 以下为基于现有 [prd-sso-integration-v1.0.md](./prd/prd-sso-integration-v1.0.md) 与 [sso-idp-sp-integration-guide.md](./integration-guides/sso-idp-sp-integration-guide.md) 填好参数的完整 Prompt，可直接复制发送。
> **前置条件**：`prd-sso-integration-v1.0.md` 当前状态为 draft（待评审），必须先在 PRD 评审/修订/终审闭环中通过，置为 approved 后方可派发本实例的 Prompt A。

### A.0 参数填充表（SSO 实例）

| 参数 | 值 |
|------|-----|
| `{PROJECT_ROOT}` | `/var/learning` |
| `{SPEC_NAME}` | SSO 集成（登录登出与会话） |
| `{SLUG}` | `sso-auth` |
| `{PRD_FILE}` | `docs/prd/prd-sso-integration-v1.0.md` |
| `{PRD_SECTIONS}` | `§6.1（SSO 登录/登出 FR-001~FR-011）、§6.2（用户会话管理 FR-012~FR-018）、§7.2（安全 NFR-006~NFR-014）、§7.3（可用性 NFR-015）` |
| `{CONTEXT_FILES}` | `docs/integration-guides/sso-idp-sp-integration-guide.md` |
| `{FRAMEWORK_SECTIONS}` | `§1.5（Scope/Claims）、§1.6（能力声明）、§2（集成前置条件）、§3.1（Discovery）、§3.2（Authorize）、§3.3（Token）、§3.4（UserInfo）、§3.7（Revoke）、§3.8（End Session）、§4.1（核心登录流程）、§5（安全要求）` |
| `{SOURCE_CONTEXT}` | `middleware.ts、app/layout-client.tsx、app/api/solve/route.ts、app/lib/env.ts、next.config.ts` |

> 各 Prompt 中 `{ROUND}`、`{VERSION}`、`{CURRENT_VERSION}`、`{NEXT_VERSION}` 按 §六/§七 参数表 r1、r2 分别填充。

### A.1 Prompt A（SSO 实例，已填充）

```
你是 nextjs-spec-generator，任务：基于 approved 的 PRD 生成【SSO 集成（登录登出与会话）】需求规格文档初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. /var/learning/.opencode/rules/spec/spec-template.md  — spec 正文模板结构
2. /var/learning/.opencode/rules/spec/spec-workflow.md  — 工作流与命名规范
3. /var/learning/.opencode/rules/global/naming-conventions.md — 命名规范
4. /var/learning/.opencode/rules/global/code-style.md   — 代码风格与安全约束
5. /var/learning/.opencode/rules/INDEX.md               — 规则体系导航

【输入文件】
1. /var/learning/docs/prd/prd-sso-integration-v1.0.md（已 approved 的 PRD，唯一需求来源）
   - 必读章节：§6.1（SSO 登录/登出 FR-001~FR-011）、§6.2（用户会话管理 FR-012~FR-018）、§7.2（安全 NFR-006~NFR-014）、§7.3（可用性 NFR-015）
   - 仅读取上述章节，不读全文档
2. /var/learning/docs/integration-guides/sso-idp-sp-integration-guide.md（IDP 集成文档）
   - 必读章节：§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.7、§3.8、§4.1、§5
   - 作用：理解 IDP 能力与 SP 端集成约束（OIDC 授权码 + PKCE 流程、Token 契约、安全要求），仅读取指定章节，禁止全量加载
3. /var/learning/package.json
   - 核对技术栈：Next.js 15.1.6 App Router + TypeScript 5.7.3 + Tailwind，与 PRD 技术约束一致
4. 现有源码（限定范围，用于规格与实现现实对齐）：
   - middleware.ts（速率限制 + SSO 认证接入点）、app/layout-client.tsx（SessionProvider 注入点）、app/api/solve/route.ts（主业务接口）、app/lib/env.ts（环境变量校验）、next.config.ts（CSP 需放行 IdP 域名）

【输出】
- 文件路径：/var/learning/docs/specs/spec-sso-auth-v1.0.md
- 状态：draft
- 严格遵循 spec-template.md 结构：变更记录 / 背景与目标 / 用户故事 / 功能需求 / 非功能需求 / 边界与排除项 / 验收标准

【硬性约束】
1. 禁止照搬集成文档的示例代码，仅参考协议/端点/安全约束（FR 以 PRD 为准）
2. 所有功能需求编号连续（FR-001、FR-002...）
3. 所有验收标准可测试、可验证（AC-001 起）
4. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式（如 AUTH_LOGIN_INVALID_CREDENTIALS、AUTH_LOGIN_IDP_UNREACHABLE）
5. 禁止创建多个版本文件（始终只有一份，版本号写在文件内部）
6. 单文件 ≤ 500 行；若超出，在"边界与排除项"说明拆分计划（本 PRD 建议拆为 sso-auth / user-dashboard / usage-metering 三份）
7. 必须明确"不做什么"（边界与排除项：如 SAML 接入为可选、SLO 为可选、计费系统不落地）
8. spec 阶段禁止做技术选型、模块划分、数据模型等架构决策（数据库表设计属架构阶段）
9. 每个 FR 必须可追溯到 PRD 的 FR-xxx（§6.1 FR-001~FR-011、§6.2 FR-012~FR-018）
10. 安全需求必须与集成指南 §5 一致：
    - PKCE 强制（code_challenge_method=S256）
    - state ≥ 32 字符随机串 + 服务端 cookie 校验（CSRF）
    - id_token 验证 8 步（签名/iss/aud/exp/nonce），strict 模式默认
    - Cookie：httpOnly + secure（生产）+ sameSite=lax + maxAge 15min
    - client_secret 仅服务端（禁止 NEXT_PUBLIC_SSO_CLIENT_SECRET）
    - 开放重定向防御（next 参数规范化为同源相对路径）

【验收标准】
- 文件已创建在 /var/learning/docs/specs/spec-sso-auth-v1.0.md
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 每个 FR 可追溯到 PRD 的 FR-xxx
- 引用的集成文档章节准确无误
- 未混入架构设计内容（无技术选型/模块划分/数据模型）

完成后返回：
- 文件路径
- 章节大纲
- FR/AC 数量统计
- PRD 覆盖情况（已覆盖功能项/总数，FR-001~FR-018 应全覆盖）
- 引用的集成文档章节清单
- 阻塞问题（如有）
```

### A.2 Prompt B（SSO 实例，已填充）

以 r1 为例（`{ROUND}=1`、`{VERSION}=v1.0`、无上轮评审文件）；r2 派发时按 §六 参数表替换为 `{ROUND}=2`、`{VERSION}=v1.1`，并追加「上轮评审意见：`/var/learning/docs/reviews/spec-sso-auth-review-r1.md`」。

```
你是 nextjs-spec-reviewer，任务：对【SSO 集成（登录登出与会话）】spec 第 1 轮评审。

【必读规则文件】
1. /var/learning/.opencode/rules/spec/spec-workflow.md  — 评审角色职责与命名
2. /var/learning/.opencode/rules/spec/spec-template.md  — 评审对照模板

【输入文件】
1. 待评审 spec：/var/learning/docs/specs/spec-sso-auth-v1.0.md
2. 对应 PRD：/var/learning/docs/prd/prd-sso-integration-v1.0.md
   - 对照章节：§6.1、§6.2、§7.2、§7.3
3. 背景/集成文档：/var/learning/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 对照章节：§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.7、§3.8、§4.1、§5
   - 核对 spec 中的 OIDC 流程、端点契约、安全要求与集成文档一致

【输出】
- 文件路径：/var/learning/docs/reviews/spec-sso-auth-review-r1.md
- 评审意见文件一旦归档禁止修改
- 严格遵循 spec-template.md 中的"评审意见文件模板"

【评审维度】（逐项检查，每项给出结论）
1. 完整性：模板必备章节是否齐全；FR/AC 编号是否连续
2. 可追溯性：每个 FR 是否可追溯到 PRD（FR-001~FR-018）；有无遗漏或超出范围
3. 准确性：是否与 PRD 需求一致；有无曲解
4. 第三方对齐：OIDC 授权码 + PKCE 流程、Token/UserInfo/Revoke/End Session 端点、安全要求是否与集成文档一致
5. 可测试性：每个 AC 是否可验证、可测试
6. 边界清晰度："边界与排除项"是否明确不做什么（SAML/SLO/计费不落地等）
7. 合规性：是否违反 spec-workflow.md；是否混入架构设计内容（如数据库表设计、技术选型）
8. 一致性：FR 与 AC 是否对应；有无冗余/矛盾；错误码格式是否合规
9. 安全性：PKCE、state CSRF、id_token 验证、Cookie 标志、client_secret 保护、开放重定向防御、日志脱敏是否覆盖

【问题清单格式】
| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议
- 阻塞级问题必须导致"需修订"结论
- 编号格式：R1-001、R1-002...

【评审结论】
- 需修订：存在阻塞或重要问题
- 通过：仅剩建议级问题或无问题
- 注意：无论结论为何，本方案强制满 2 轮评审，spec 不会在本轮直接 approved

【硬性约束】
1. 评审角色禁止直接修改 spec 正文，只输出意见文件
2. 禁止粘贴 spec 原文到评审文件（仅引用章节 / FR / AC 编号）
3. 每个问题必须给出具体修订建议，不可仅指出问题
4. 不得代替需求方做需求决策

完成后返回：
- 评审文件路径
- 问题数量统计（阻塞/重要/建议）
- 评审结论
```

### A.3 Prompt C（SSO 实例，已填充）

以 r1 修订为例（`{ROUND}=1`、`{CURRENT_VERSION}=v1.0`、`{NEXT_VERSION}=v1.1`）；r2 修订时替换为 `{ROUND}=2`、`v1.1 → v1.2`。

```
你是 nextjs-spec-generator，任务：根据第 1 轮评审意见修订【SSO 集成（登录登出与会话）】spec。

【必读规则文件】
1. /var/learning/.opencode/rules/spec/spec-workflow.md  — 修订流程约束
2. /var/learning/.opencode/rules/spec/spec-template.md  — 模板结构
3. /var/learning/.opencode/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. 当前 spec：/var/learning/docs/specs/spec-sso-auth-v1.0.md
2. 评审意见：/var/learning/docs/reviews/spec-sso-auth-review-r1.md
3. 对应 PRD（如需核对）：/var/learning/docs/prd/prd-sso-integration-v1.0.md
   - 核对章节：§6.1、§6.2、§7.2、§7.3
4. 背景/集成文档（如需核对）：/var/learning/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 核对章节：§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.7、§3.8、§4.1、§5

【操作要求】
1. 在原 spec 文件上直接修订（不新建文件）
2. 文件内版本号更新为 v1.1
3. 在"变更记录"表格新增一行：v1.1 | 日期 | 根据 r1 评审修订 | review-r1
4. 状态保持 draft（未通过终审前不改为 approved）

【修订原则】
1. 逐条对照评审问题清单（R1-001、R1-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由（在变更记录或修订说明中标注）
4. 建议级问题酌情采纳
5. 禁止将评审意见原文直接粘贴进 spec
6. 禁止删除已通过的 FR/AC，仅可修改或新增
7. 若评审意见涉及需求歧义且 PRD 未澄清，标记为待业务方确认，不自行决断

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订
2. 禁止改动与评审意见无关的内容
3. 修订后 FR/AC 编号必须保持连续
4. 修订后仍需保持所有必备章节完整
5. 单文件 ≤ 500 行

【验收标准】
- 文件版本号已更新为 v1.1
- 变更记录已新增 v1.1 行
- 所有阻塞级问题已解决
- 所有重要级问题已解决或给出理由
- 输出修订对照表：R1-编号 | 是否解决 | 修订位置

完成后返回：
- 文件路径
- 修订对照表
- 阻塞问题解决率
- 待业务方确认清单（如有）
```

### A.4 Prompt D（SSO 实例，终审）

```
你是总调度收尾 agent，任务：汇总【SSO 集成（登录登出与会话）】spec 的第 2 轮修订结果，做最终决议。

【输入文件】
1. 第 2 轮修订后的 spec：/var/learning/docs/specs/spec-sso-auth-v1.2.md
2. 第 2 轮评审意见：/var/learning/docs/reviews/spec-sso-auth-review-r2.md
3. 第 1 轮评审意见：/var/learning/docs/reviews/spec-sso-auth-review-r1.md
4. 对应 PRD：/var/learning/docs/prd/prd-sso-integration-v1.0.md
   - 核对章节：§6.1、§6.2、§7.2、§7.3

【任务】
1. 读取 r1、r2 评审意见和对应修订版 spec（v1.1、v1.2）
2. 核对修订版是否已解决 r1、r2 中的所有阻塞级问题
3. 核对 spec 是否覆盖 PRD 中的全部功能需求（FR-001~FR-018 每个都有对应 FR）
4. 做决议：
   - v1.2 已解决全部阻塞问题 + PRD 需求全覆盖 → 将 spec 状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题或需求遗漏 → 标记为 blocked，列出剩余问题，请求人工介入（不进入第 3 轮）
5. 输出汇总报告（直接回复，不写文件）：
   - spec 终审状态（approved / blocked）
   - 阻塞问题清单（如有）
   - 阻塞问题解决率（已解决数/两轮问题总数）
   - PRD 需求覆盖率（已覆盖数/总数，FR-001~FR-018 应 100%）
   - 是否可进入架构设计阶段
   - Spec→架构衔接要点（如：会话存储选型、sessions/users 表结构、middleware 认证校验实现、CSP 调整等需架构阶段重点设计）

【硬性约束】
1. 仅修改状态字段，不改动 spec 正文内容
2. approved 状态的 spec 才可交给 nextjs-architect
3. draft 状态的 spec 禁止进入架构设计/开发
4. 终审仅核查 r1、r2 阻塞问题是否解决，不重新发现新问题（防止无限循环）
5. PRD 需求覆盖率必须 100%，任何遗漏都视为阻塞
6. 终审不得代替需求方做需求决策
```

---

## 十二、文档维护

| 触发条件 | 操作 |
|---------|------|
| 新增 Spec 实例 | 在附录 A 追加小节（A.2、A.3...），更新版本号 |
| 规则文件变动 | 同步更新 Prompt 中引用的 `.opencode/rules/` 路径 |
| 实践发现新坑点 | 补充到 §十 关键设计要点 |
| 调度流程变更 | 更新 §二/§九，更新版本号 |

**版本历史**：

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-10 | 初稿创建，基于 AI-Prompt 使用规范 v2.9 §4.1/§5.5，强制满 2 轮评审；附录 A 含 SSO 集成实例 |
