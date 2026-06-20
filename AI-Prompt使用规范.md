# CatNet-VPN AI Prompt 使用规范

> **文档定位**：本项目所有 AI Agent（子代理）调度的 Prompt 设计、编写、评估的统一标准
> **适用范围**：总调度 agent 指挥子 agent 执行 spec 生成、评审、修订、架构设计、开发实施、测试、调试、代码审查等全部场景
> **与 `.trae/rules/` 的关系**：`.trae/rules/` 约束**产出物**（代码、spec、API），本规范约束**输入指令**（Prompt），两者互补形成完整闭环
> **生成时间**：2026-06-20
> **版本**：v1.0

---

## 一、文档目的与适用范围

### 1.1 为什么需要 Prompt 规范

本项目采用"总调度 + 子 agent"的多代理协作模式，涉及 10+ 种 agent 类型。在 M1 阶段 spec 调度实践中，暴露出以下问题：

| 问题类别 | 具体表现 | 影响 |
|---------|---------|------|
| 引用失效 | Prompt 引用了不存在的 `实施参考路由.md` | 子 agent 执行中断，需临时适配 |
| 参数错填 | 4 模板 × 3 spec × 多参数，人工填充易错 | 上下文加载错误章节 |
| 约束遗漏 | 归档项目隔离、上下文隔离靠人工记忆 | 潜在合规风险 |
| 模板不可复用 | 每个里程碑都要重新设计 prompt | 效率低，质量不稳定 |
| 缺乏评估标准 | 无法判断 prompt 是否合格 | 质量参差不齐 |

本规范旨在解决上述问题，建立可复用、可验证、可演进的 Prompt 工程体系。

### 1.2 适用对象

| 角色 | 使用方式 |
|------|---------|
| **总调度 agent**（主对话） | 按本规范设计 Prompt，调度子 agent 执行 |
| **子 agent**（spec-generator/reviewer、architect、dev-expert 等） | 接收符合本规范的 Prompt，按约束执行 |
| **项目维护者** | 依据本规范评审 Prompt 方案文件（如 `CatNet-VPN-M1阶段spec调度prompt方案.md`） |

### 1.3 不适用范围

- 日常对话中的简单问答（如"这个函数什么意思"）
- 单次一次性命令（如"运行 npm test"）
- 纯文件读写操作（如"读取 package.json"）

---

## 二、Prompt 设计原则

### 2.1 核心原则总览

| 编号 | 原则 | 一句话说明 |
|------|------|-----------|
| P1 | **明确性** | 任务、输入、输出、约束四要素必须显式声明 |
| P2 | **上下文隔离** | 子 agent 只读必要文件，禁止全量加载大文档 |
| P3 | **参数化** | 可变内容用 `{PLACEHOLDER}` 占位，集中管理参数表 |
| P4 | **可验证性** | 每条 Prompt 必须包含可检查的验收标准 |
| P5 | **职责单一** | 一个 Prompt 只交给一种 agent 执行一类任务 |
| P6 | **合规优先** | 必须显式声明禁止事项（归档项目、敏感操作等） |
| P7 | **闭环反馈** | Prompt 末尾要求返回结构化摘要，便于总调度决策 |
| P8 | **版本一致** | 引用文件路径、版本号必须与磁盘实际状态一致 |

### 2.2 原则详解

#### P1 明确性

Prompt 必须包含以下四要素，缺一不可：

```
【任务】   做什么（动词 + 对象 + 目标）
【输入】   读哪些文件（绝对路径 + 必读章节）
【输出】   产出到哪里（绝对路径 + 格式要求）
【约束】   不能做什么（禁止清单 + 硬性限制）
```

**反例**（缺失要素）：
> "帮我生成认证系统的 spec 文档。"

**正例**（四要素齐全）：
> "你是 nextjs-spec-generator，任务：为 CatNet-VPN 生成【用户认证与授权系统】spec 初稿。
> 【输入】读取框架文档 §2.2、§3.2、§3.10 章节。
> 【输出】写入 /var/ServiceNode/docs/specs/spec-auth-system-v1.0.md，状态 draft。
> 【约束】禁止照搬参考项目代码，FR 编号连续，单文件 ≤ 500 行。"

#### P2 上下文隔离

大文档（如 138KB 的框架文档）**禁止全量加载**，必须指定章节范围。

**隔离策略**：

| 文档类型 | 大小 | 策略 |
|---------|------|------|
| 框架文档 | > 50KB | 指定 §章节号，禁止全量读取 |
| 参考项目 | 多文件 | 先读 RELEVANCE.md，仅读"必看模块" |
| 规则文件 | < 5KB | 可全量读取 |
| spec 正文 | < 50KB | 可全量读取 |

**参考项目读取四步法**（所有需要参考项目的 Prompt 共用）：

```
Step 1: 读 docs/CatNet-VPN-参考项目对照指引.md（入口文件）
        └─ 获取：保留/归档项目清单、读取优先级、集成改造提示

Step 2: 从对照指引 §3 获取模块→参考项目映射
        └─ 注意：docs/CatNet-VPN-实施参考路由.md 不存在，映射从对照指引第三节获取

Step 3: 读 _reference/{project}/RELEVANCE.md（仅当映射指向时）
        └─ 获取：必看模块、可忽略部分、改造要点

Step 4: 仅阅读 RELEVANCE.md 标注的"必看模块"文件
        └─ 禁止阅读"可忽略部分"
        └─ 禁止检索 _reference/_archive/ 归档项目
```

#### P3 参数化

可变内容必须用 `{UPPER_SNAKE_CASE}` 占位，并在 Prompt 方案文件中提供参数填充表。

**占位符命名规范**：

| 类别 | 格式 | 示例 |
|------|------|------|
| 文本类 | `{SPEC_NAME}` | 用户认证与授权系统 |
| 路径类 | `{SLUG}` | auth-system |
| 版本类 | `{CURRENT_VERSION}` / `{NEXT_VERSION}` | v1.0 / v1.1 |
| 轮次类 | `{ROUND}` | 1 / 2 |
| 章节类 | `{FRAMEWORK_SECTIONS}` | §2.2、§3.2、§3.10 |
| 文件类 | `{REFERENCE_RELEVANCE_FILES}` | `_reference/test-sp/RELEVANCE.md` |

**参数表格式**（每个 Prompt 方案必须附带）：

```markdown
| 参数 | 值 |
|------|-----|
| `{SPEC_NAME}` | 用户认证与授权系统 |
| `{SLUG}` | auth-system |
| `{FRAMEWORK_SECTIONS}` | §2.2、§3.2、§3.10 |
```

#### P4 可验证性

每个 Prompt 必须包含【验收标准】章节，列出可检查的条件。

**验收标准编写要求**：
- 每条必须是**可执行检查**（文件存在 / 编号连续 / 章节齐全）
- 禁止使用模糊表述（如"质量良好"、"结构清晰"）
- 验收标准数量建议 4-8 条

**示例**：
```
【验收标准】
- 文件已创建在 /var/ServiceNode/docs/specs/spec-auth-system-v1.0.md
- 包含模板所有必备章节（变更记录/背景/用户故事/功能需求/非功能需求/边界/验收标准）
- FR 编号连续无缺漏（FR-001 到 FR-NNN）
- AC 编号连续且每条可测试
- 参考项目仅来自对照指引中的保留项目清单
```

#### P5 职责单一

一个 Prompt 只对应一种 agent 类型 + 一类任务。

**禁止**在一个 Prompt 中混合多种角色职责：

| 错误做法 | 正确做法 |
|---------|---------|
| 让 reviewer 既评审又修订 | 评审用 Prompt B（reviewer），修订用 Prompt C（generator） |
| 让 generator 既生成 spec 又做架构设计 | spec 生成用 spec-generator，架构设计用 architect |
| 让一个 agent 同时处理 3 个 spec | 每个 spec 独立一个 agent 实例（并行） |

#### P6 合规优先

Prompt 必须显式声明以下禁止事项（按场景选用）：

| 禁止事项 | 适用场景 |
|---------|---------|
| 禁止检索 `_reference/_archive/` 归档项目 | 所有涉及参考项目的 Prompt |
| 禁止照搬参考项目代码，仅参考架构模式 | 所有涉及参考项目的 Prompt |
| 禁止使用 `any` 类型 | 所有涉及代码的 Prompt |
| 禁止跨模块 `../` 引用 | 所有涉及代码的 Prompt |
| 禁止跳过评审直接 approved | spec 相关 Prompt |
| 禁止 reviewer 修改 spec 正文 | spec 评审 Prompt |
| 禁止新建版本文件（始终单文件） | spec 修订 Prompt |
| 禁止在 spec 未 approved 前启动开发 | 架构设计/开发 Prompt |

#### P7 闭环反馈

Prompt 末尾必须要求子 agent 返回结构化摘要，格式：

```
完成后返回：
- 文件路径（或操作结果）
- 关键统计（FR/AC 数量、问题数量等）
- 参考项目使用清单（如涉及）
- 阻塞问题（如有）
```

总调度依据此摘要决定是否进入下一阶段。

#### P8 版本一致

引用文件路径和版本号必须与磁盘实际状态一致。

**检查清单**（Prompt 发送前总调度必须核对）：

- [ ] 引用的文件路径实际存在
- [ ] 引用的章节号在目标文件中存在
- [ ] 版本号与文件内部版本号一致（如 Prompt 说 v1.1，文件内部也是 v1.1）
- [ ] 参考项目目录名与 `_reference/` 下实际目录名一致

---

## 三、Prompt 标准格式

### 3.1 标准结构模板

所有调度子 agent 的 Prompt 必须遵循以下结构（章节顺序固定）：

```
你是 {AGENT_TYPE}，任务：{TASK_DESCRIPTION}。

【必读规则文件】（按顺序读取，禁止跳过）
1. {RULE_FILE_1}  — {作用说明}
2. {RULE_FILE_2}  — {作用说明}

【输入文件】
1. {INPUT_FILE_1}
   - 必读章节：{SECTIONS}
   - {读取约束}
2. {INPUT_FILE_2}
   - {作用说明}

【输出】
- 文件路径：{OUTPUT_PATH}
- {格式要求}
- {状态要求}

【操作要求】（如涉及多步骤）
1. {STEP_1}
2. {STEP_2}

【硬性约束】
1. {CONSTRAINT_1}
2. {CONSTRAINT_2}

【验收标准】
- {CHECKABLE_CONDITION_1}
- {CHECKABLE_CONDITION_2}

完成后返回：{RETURN_FORMAT}
```

### 3.2 结构说明

| 章节 | 必选 | 作用 |
|------|:----:|------|
| 角色声明 | ✅ | 指定 agent 类型，激活对应规则加载 |
| 任务描述 | ✅ | 一句话说明做什么 |
| 必读规则文件 | ✅ | 指定加载哪些 `.trae/rules/` 文件 |
| 输入文件 | ✅ | 指定读取哪些文档，含章节范围 |
| 输出 | ✅ | 指定产出路径和格式 |
| 操作要求 | ⚠️ | 多步骤任务时提供（单步骤可省） |
| 硬性约束 | ✅ | 禁止事项和强制要求 |
| 验收标准 | ✅ | 可检查的完成条件 |
| 返回格式 | ✅ | 要求子 agent 返回的摘要格式 |

### 3.3 命名与路径规范

| 类别 | 规范 | 示例 |
|------|------|------|
| Prompt 方案文件 | `CatNet-VPN-{阶段}阶段{任务}调度prompt方案.md` | `CatNet-VPN-M1阶段spec调度prompt方案.md` |
| Prompt 模板编号 | Prompt A / B / C / D...（按执行顺序） | A=生成, B=评审, C=修订, D=终审 |
| 文件路径 | 始终使用绝对路径 | `/var/ServiceNode/docs/specs/spec-auth-system-v1.0.md` |
| 章节引用 | 使用 §前缀 | `§2.2、§3.10` |

---

## 四、场景模板库

### 4.1 Spec 生成场景（Prompt A）

**适用 agent**：`nextjs-spec-generator`
**触发时机**：里程碑启动，需要生成需求规格文档初稿

```
你是 nextjs-spec-generator，任务：为 CatNet-VPN 项目 {MILESTONE} 阶段生成【{SPEC_NAME}】需求规格文档初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. /var/ServiceNode/.trae/rules/spec/spec-template.md  — spec 正文模板结构
2. /var/ServiceNode/.trae/rules/spec/spec-workflow.md  — 工作流与命名规范
3. /var/ServiceNode/.trae/rules/global/naming-conventions.md — 命名规范
4. /var/ServiceNode/.trae/rules/global/code-style.md   — 代码风格约束

【输入文件】
1. /var/ServiceNode/docs/CatNet-VPN-项目框架文档-V11.md
   - 必读章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，不读全文档（文档 138KB，禁止全量加载）
2. /var/ServiceNode/docs/CatNet-VPN-参考项目对照指引.md
   - 作用：参考项目入口文件，必须最先读取
   - 获取：保留/归档项目清单、各项目核心参考价值、读取优先级
3. {REFERENCE_RELEVANCE_FILES}
   - 仅当对照指引指向参考项目时，读取对应 _reference/{project}/RELEVANCE.md
   - 仅阅读 RELEVANCE.md 标注的"必看模块"文件
   - 禁止检索 _reference/_archive/ 归档项目

【输出】
- 文件路径：/var/ServiceNode/docs/specs/spec-{SLUG}-v1.0.md
- 状态：draft
- 严格遵循 spec-template.md 结构：变更记录 / 背景与目标 / 用户故事 / 功能需求 / 非功能需求 / 边界与排除项 / 验收标准

【硬性约束】
1. 禁止照搬参考项目代码，仅参考架构模式与流程
2. 所有功能需求必须编号（FR-001、FR-002...）
3. 所有验收标准必须可测试、可验证（checkbox 列表，AC-001 起）
4. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式
5. 禁止创建多个版本文件（始终只有一份，版本号写在文件内部）
6. 单文件 ≤ 500 行；若超出，在"边界与排除项"说明拆分计划
7. 必须明确"不做什么"（边界与排除项章节）
8. 禁止使用 any 类型，不确定类型用 unknown
9. 禁止跨模块 ../ 引用，必须用 @/ 绝对路径

【验收标准】
- 文件已创建在指定路径
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 引用的框架文档章节准确无误
- 参考项目仅来自对照指引中的保留项目清单

完成后返回：文件路径 + 章节大纲 + FR/AC 数量统计 + 参考项目使用清单。
```

### 4.2 Spec 评审场景（Prompt B）

**适用 agent**：`nextjs-spec-reviewer`
**触发时机**：spec 初稿或修订版完成后

```
你是 nextjs-spec-reviewer，任务：对 CatNet-VPN【{SPEC_NAME}】spec 第 {ROUND} 轮评审。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/spec/spec-workflow.md  — 评审角色职责
2. /var/ServiceNode/.trae/rules/spec/spec-template.md  — 评审对照模板

【输入文件】
1. 待评审 spec：/var/ServiceNode/docs/specs/spec-{SLUG}-v{VERSION}.md
2. 框架文档：/var/ServiceNode/docs/CatNet-VPN-项目框架文档-V11.md
   - 对照章节：{FRAMEWORK_SECTIONS}
3. 参考项目入口：/var/ServiceNode/docs/CatNet-VPN-参考项目对照指引.md
   - 用于核对 spec 是否正确引用保留项目、是否误用归档项目

【输出】
- 文件路径：/var/ServiceNode/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
- 评审意见文件一旦归档禁止修改
- 严格遵循 spec-template.md 中的"评审意见文件模板"

【评审维度】（逐项检查，每项给出结论）
1. 完整性：模板必备章节是否齐全；FR/AC 编号是否连续
2. 准确性：是否与框架文档对应章节一致；有无偏离架构约束
3. 可测试性：每个 AC 是否可验证、可测试
4. 边界清晰度："边界与排除项"是否明确不做什么
5. 合规性：是否违反 MUST/MUST NOT 规则；是否照搬参考项目；是否误用归档项目
6. 一致性：FR 与 AC 是否对应；有无需求遗漏或冗余
7. 依赖识别：是否正确识别与其他 spec 的依赖关系
8. 参考项目使用：是否遵循对照指引的读取优先级和集成改造提示

【问题清单格式】
| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议
- 阻塞级问题必须导致"需修订"结论
- 编号格式：R{ROUND}-001、R{ROUND}-002...

【评审结论】
- 需修订：存在阻塞或重要问题
- 通过：仅剩建议级问题或无问题

【硬性约束】
1. 评审角色禁止直接修改 spec 正文，只输出意见文件
2. 禁止粘贴 spec 原文到评审文件
3. 每个问题必须给出具体修订建议，不可仅指出问题
4. 结论为"通过"时，spec 可进入 approved 状态
5. 禁止检索 _reference/_archive/ 归档项目

完成后返回：评审文件路径 + 问题数量统计（阻塞/重要/建议）+ 评审结论。
```

### 4.3 Spec 修订场景（Prompt C）

**适用 agent**：`nextjs-spec-generator`
**触发时机**：评审完成后，根据评审意见修订 spec
**特点**：参数化支持多轮复用（`{ROUND}` / `{CURRENT_VERSION}` / `{NEXT_VERSION}`）

```
你是 nextjs-spec-generator，任务：根据第 {ROUND} 轮评审意见修订 CatNet-VPN【{SPEC_NAME}】spec。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/spec/spec-workflow.md  — 修订流程约束
2. /var/ServiceNode/.trae/rules/spec/spec-template.md  — 模板结构

【输入文件】
1. 当前 spec：/var/ServiceNode/docs/specs/spec-{SLUG}-v{CURRENT_VERSION}.md
2. 评审意见：/var/ServiceNode/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
3. 框架文档（如需核对）：/var/ServiceNode/docs/CatNet-VPN-项目框架文档-V11.md
   - 核对章节：{FRAMEWORK_SECTIONS}
4. 参考项目入口（如需核对）：/var/ServiceNode/docs/CatNet-VPN-参考项目对照指引.md

【操作要求】
1. 在原 spec 文件上直接修订（不新建文件）
2. 文件内版本号更新为 v{NEXT_VERSION}
3. 在"变更记录"表格新增一行：v{NEXT_VERSION} | 日期 | 根据 r{ROUND} 评审修订 | review-r{ROUND}
4. 状态保持 draft（未通过评审前不改为 approved）

【修订原则】
1. 逐条对照评审问题清单（R{ROUND}-001、R{ROUND}-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由
4. 建议级问题酌情采纳
5. 禁止将评审意见原文直接粘贴进 spec
6. 禁止删除已通过的 FR/AC，仅可修改或新增

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订
2. 禁止改动与评审意见无关的内容
3. 修订后 FR/AC 编号必须保持连续
4. 单文件 ≤ 500 行
5. 禁止使用归档项目作为参考

【验收标准】
- 文件版本号已更新为 v{NEXT_VERSION}
- 变更记录已新增 v{NEXT_VERSION} 行
- 所有阻塞级问题已解决
- 输出修订对照表：R{ROUND}-编号 | 是否解决 | 修订位置

完成后返回：文件路径 + 修订对照表 + 阻塞问题解决率。
```

### 4.4 总调度终审场景（Prompt D）

**适用角色**：总调度 agent 自行执行（不调度子 agent）
**触发时机**：最后一轮修订完成后，做最终决议

```
你是总调度收尾 agent，任务：汇总 {SPEC_COUNT} 个 spec 的最后一轮修订结果，做最终决议。

【输入文件】
1. {SPEC_FILE_LIST}（最后一轮修订后的 spec 文件）
2. {REVIEW_FILE_LIST}（最后一轮评审意见文件）
3. /var/ServiceNode/docs/CatNet-VPN-参考项目对照指引.md（核对参考项目使用合规性）

【任务】
1. 读取所有最后一轮评审意见和对应修订版 spec
2. 核对修订版是否已解决评审中的所有阻塞级问题
3. 对每个 spec 做决议：
   - 阻塞问题已全部解决 → 将 spec 状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题 → 标记为阻塞，列出剩余阻塞问题
4. 输出汇总报告（直接回复，不写文件）：
   - 各 spec 终审状态（approved / 阻塞）
   - 阻塞问题清单（如有）
   - 阻塞问题解决率
   - 是否可进入下一阶段
   - 参考项目使用合规性核查

【硬性约束】
1. 仅修改状态字段，不改动 spec 正文内容
2. approved 状态的 spec 才可交给下一阶段 agent
3. draft 状态的 spec 禁止进入实施
4. 误用归档项目的 spec 不得 approved
5. 终审仅核查最后一轮阻塞问题是否解决，不重新发现新问题（防止无限循环）
```

### 4.5 架构设计场景

**适用 agent**：`nextjs-architect`
**触发时机**：spec 全部 approved 后，进入架构设计阶段

```
你是 nextjs-architect，任务：基于已 approved 的 spec 设计 CatNet-VPN【{MODULE_NAME}】模块技术架构。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/spec/spec-workflow.md  — 了解 spec 输出约束
2. /var/ServiceNode/.trae/rules/dev/dev-workflow.md     — 开发流程约束
3. /var/ServiceNode/.trae/rules/dev/api-conventions.md  — 服务层与 API 规范
4. /var/ServiceNode/.trae/rules/dev/component-rules.md  — 组件规范
5. /var/ServiceNode/.trae/rules/global/code-style.md    — 代码风格
6. /var/ServiceNode/.trae/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. {APPROVED_SPEC_FILES}（已 approved 的 spec 文件，唯一合法输入）
   - 禁止参考 draft 或 in-review 状态的 spec
2. /var/ServiceNode/docs/CatNet-VPN-项目框架文档-V11.md
   - 必读章节：{FRAMEWORK_SECTIONS}
3. /var/ServiceNode/docs/CatNet-VPN-参考项目对照指引.md
   - 获取参考项目清单与读取优先级
4. /var/ServiceNode/docs/CatNet-VPN-代码参考与架构决策报告.md
   - 获取架构决策建议与可复用模块清单
5. {REFERENCE_RELEVANCE_FILES}（如对照指引指向参考项目）

【输出】
- 文件路径：/var/ServiceNode/docs/architecture/arch-{SLUG}-v1.0.md
- 状态：draft
- 必备章节：架构概述 / 模块划分 / 技术选型 / 数据流设计 / 接口定义 / 目录结构 / 依赖关系 / 非功能设计 / 风险与对策

【硬性约束】
1. 架构设计必须以 approved spec 为唯一需求来源
2. 禁止照搬参考项目代码，仅参考架构模式
3. 禁止使用归档项目（shadcn-admin/medusa/NextChat/apex-dashboard）
4. 技术栈必须与框架文档一致（Next.js 16 App Router + Drizzle + next-auth + Redis）
5. 禁止使用 any 类型
6. 禁止跨模块 ../ 引用
7. 单文件 ≤ 500 行

【验收标准】
- 文件已创建在指定路径
- 包含所有必备章节
- 每个 spec 的 FR 都有对应的架构设计落点
- 目录结构符合 .trae/rules/dev/ 规范
- 技术选型与框架文档一致

完成后返回：文件路径 + 架构决策清单 + 模块划分图 + 风险清单。
```

### 4.6 开发实施场景

**适用 agent**：`nextjs-frontend-expert` / `nextjs-backend-expert` / `ts-nextjs-db-modeler`
**触发时机**：架构设计 approved 后，进入编码实施

```
你是 {AGENT_TYPE}，任务：基于架构设计实现 CatNet-VPN【{FEATURE_NAME}】功能。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/dev/dev-workflow.md       — 开发流程
2. /var/ServiceNode/.trae/rules/dev/api-conventions.md    — API 与服务层规范
3. /var/ServiceNode/.trae/rules/dev/component-rules.md    — 组件规范
4. /var/ServiceNode/.trae/rules/dev/testing-standards.md  — 测试规范
5. /var/ServiceNode/.trae/rules/global/code-style.md      — 代码风格
6. /var/ServiceNode/.trae/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. {APPROVED_ARCH_FILE}（已 approved 的架构设计文件）
2. {APPROVED_SPEC_FILE}（对应的 spec 文件）
3. /var/ServiceNode/docs/CatNet-VPN-项目框架文档-V11.md
   - 核对章节：{FRAMEWORK_SECTIONS}

【输出】
- 代码文件：{OUTPUT_PATHS}
- 测试文件：{TEST_PATHS}

【硬性约束】
1. 严格遵循架构设计的目录结构和接口定义
2. Server Component 优先，需要交互时用 Client Component
3. 数据变更通过 Server Action，Zod 验证所有输入
4. 服务层返回 ServiceResult<T> 统一格式
5. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式
6. 禁止使用 any 类型
7. 禁止跨模块 ../ 引用，必须用 @/ 绝对路径
8. 单文件 ≤ 500 行，页面文件 ≤ 300 行
9. 图标统一使用 lucide-react，禁止内联 SVG
10. 禁止使用归档项目代码

【验收标准】
- 代码文件已创建在指定路径
- npx tsc --noEmit 无类型错误
- npm run lint 无警告
- 单元测试覆盖核心业务逻辑
- 所有 FR 对应的功能已实现

完成后返回：文件清单 + 类型检查结果 + 测试覆盖情况。
```

### 4.7 测试编写场景

**适用 agent**：`nextjs-testing-expert`
**触发时机**：功能开发完成后，补充或完善测试

```
你是 nextjs-testing-expert，任务：为 CatNet-VPN【{FEATURE_NAME}】编写测试。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/dev/testing-standards.md — 测试规范
2. /var/ServiceNode/.trae/rules/global/code-style.md      — 代码风格

【输入文件】
1. {SOURCE_FILES}（被测代码文件）
2. {APPROVED_SPEC_FILE}（对应的 spec，获取 AC 验收标准）

【输出】
- 单元测试：{SOURCE_DIR}/__tests__/{name}.test.ts
- 集成测试：tests/integration-tests/{module}/
- E2E 测试：tests/e2e-tests/pages/ + tests/e2e-tests/specs/

【硬性约束】
1. 单元测试用 Vitest，E2E 用 Playwright
2. 测试文件命名：[name].test.ts
3. 先写测试再写代码（TDD 优先）
4. 每个 Bug 修复必须有回归测试
5. E2E 仅覆盖关键用户流程，边界条件由单元测试覆盖
6. E2E 使用 POM 模式（pages/ 目录）
7. 测试标签：@smoke、@critical、@fast
8. 禁止使用 any 类型

【验收标准】
- 测试文件已创建在指定路径
- 覆盖 spec 中的所有 AC 验收标准
- npm test 通过
- 核心业务逻辑路径有测试覆盖

完成后返回：测试文件清单 + 覆盖的 AC 编号 + 测试运行结果。
```

### 4.8 调试排障场景

**适用 agent**：`general_purpose_task` 或对应专业 agent
**触发时机**：遇到 bug、测试失败、构建错误

```
你是 {AGENT_TYPE}，任务：排查 CatNet-VPN【{PROBLEM_DESCRIPTION}】问题。

【输入信息】
1. 问题描述：{PROBLEM_DESCRIPTION}
2. 错误现象：{ERROR_OUTPUT}
3. 复现步骤：{REPRO_STEPS}
4. 相关文件：{RELATED_FILES}

【操作要求】
1. 先读取相关文件，理解代码逻辑
2. 定位问题根因（不要只看表面症状）
3. 提出修复方案并说明原因
4. 实施修复
5. 验证修复有效（运行测试或构建）

【硬性约束】
1. 修复必须符合 .trae/rules/ 规范
2. 禁止使用 any 类型绕过类型检查
3. 禁止删除已有测试来让测试通过
4. 修复后必须运行类型检查和测试验证
5. 如果是 Bug，必须补充回归测试
6. 禁止改动与问题无关的代码

【验收标准】
- 问题已解决，错误现象消失
- npx tsc --noEmit 无类型错误
- npm test 通过
- 已补充回归测试（如适用）

完成后返回：问题根因分析 + 修复方案 + 修改文件清单 + 验证结果。
```

### 4.9 代码审查场景

**适用 agent**：`general_purpose_task`
**触发时机**：功能开发完成，提交前审查

```
你是代码审查 agent，任务：审查 CatNet-VPN【{FEATURE_NAME}】的代码变更。

【必读规则文件】
1. /var/ServiceNode/.trae/rules/global/code-style.md      — 代码风格
2. /var/ServiceNode/.trae/rules/global/naming-conventions.md — 命名规范
3. /var/ServiceNode/.trae/rules/dev/api-conventions.md    — API 规范
4. /var/ServiceNode/.trae/rules/dev/component-rules.md    — 组件规范
5. /var/ServiceNode/.trae/rules/dev/testing-standards.md  — 测试规范

【输入文件】
- 变更文件清单：{CHANGED_FILES}

【审查维度】
1. 规范合规：是否符合 .trae/rules/ 全部规范
2. 类型安全：是否有 any 类型、类型缺失
3. 安全性：输入验证、Cookie 配置、敏感信息处理
4. 性能：是否过度渲染、是否有 N+1 查询
5. 可维护性：命名清晰、结构合理、无冗余
6. 测试覆盖：核心逻辑是否有测试

【输出】
- 直接回复审查意见，不写文件
- 问题分级：阻塞 / 重要 / 建议
- 每个问题给出具体修改建议

【硬性约束】
1. 禁止直接修改代码，只输出审查意见
2. 每个问题必须指向具体文件和行号
3. 阻塞级问题必须修复后才能合并

完成后返回：问题数量统计（阻塞/重要/建议）+ 审查结论（通过/需修改）。
```

---

## 五、最佳实践指南

### 5.1 Prompt 编写流程

编写一个高质量的 Prompt，建议遵循以下流程：

```
Step 1: 明确任务目标
  └─ 要做什么？哪个 agent 执行？产出什么？

Step 2: 确定输入文件
  └─ 需要读哪些文件？哪些章节？（注意上下文隔离）
  └─ 核对文件路径实际存在（P8 版本一致）

Step 3: 选择基础模板
  └─ 从第四章场景模板库选择匹配的模板
  └─ 如无匹配，基于第三章标准格式从头编写

Step 4: 填充参数
  └─ 用参数表集中管理可变内容（P3 参数化）
  └─ 核对参数值与磁盘状态一致

Step 5: 补充约束
  └─ 从 2.2 节 P6 合规优先表选择适用禁止事项
  └─ 补充场景特有的硬性约束

Step 6: 编写验收标准
  └─ 每条必须可执行检查（P4 可验证性）
  └─ 数量 4-8 条

Step 7: 自检
  └─ 对照第六章质量评估标准逐项检查
  └─ 对照 5.3 避坑清单核对

Step 8: 发送并跟踪
  └─ 发送给子 agent
  └─ 接收返回摘要，核对验收标准
  └─ 未通过则迭代修订 Prompt
```

### 5.2 多阶段调度编排

当需要编排多阶段工作流（如 M1 的 6 阶段调度）时，遵循以下规范：

#### 5.2.1 调度方案文件结构

多阶段调度必须先编写调度方案文件，结构如下：

```markdown
# CatNet-VPN {阶段}阶段 {任务}调度 Prompt 方案

> 用途：总调度 agent 指挥子 agent 的标准化 prompt
> 范围：{阶段覆盖范围}
> 拆分粒度：{拆分策略}
> 评审策略：{轮次与修订策略}

## 一、任务拆分方案
（表格：Spec/任务 | 覆盖范围 | 框架文档章节 | 参考项目）

## 二、调度架构
（流程图：阶段N [并行/串行] N× agent → 产出）

## 三、参考项目读取流程（共用）
（四步法，见 2.2 P2）

## 四、Prompt A — {第一阶段名称}
### 4.1 通用模板
### 4.2 参数填充表

## 五、Prompt B — {第二阶段名称}
（同上）

## 六、调度执行顺序
（Step 1-N，标注并行/串行 + 验证条件）

## 七、关键设计要点
（并行度、上下文隔离、版本控制等说明）

## 八、文件清单（预期产出）
```

#### 5.2.2 并行与串行规则

| 规则 | 说明 |
|------|------|
| 同阶段并行 | 同一阶段内多个独立任务并行执行（如 3 个 spec 同时生成） |
| 阶段间串行 | 上一阶段全部完成且验证通过后，才启动下一阶段 |
| 等待机制 | 每阶段等待所有并行任务完成，取最慢任务耗时 |
| 验证点 | 每阶段结束必须验证产出（文件存在、版本号正确、状态正确） |

#### 5.2.3 评审轮次控制

| 策略 | 说明 |
|------|------|
| 最大轮次 | 默认最多 2 轮评审 + 2 轮修订（r1→v1.1→r2→v1.2→终审） |
| 阻塞兜底 | 终审仍未通过则标记阻塞，不无限循环 |
| 终审约束 | 终审仅核查最后一轮阻塞问题，不发现新问题（防止无限循环） |
| 提前通过 | 若 r1 即无阻塞且无重要问题，可提前 approved（跳过 r2） |

### 5.3 避坑清单（基于 M1 实践）

| 编号 | 坑点 | 规避措施 |
|------|------|---------|
| T1 | Prompt 引用了不存在的文件 | 发送前用 `ls` 核对路径存在性（P8） |
| T2 | 框架文档全量加载导致上下文爆炸 | 必须指定 §章节号，禁止全量读取（P2） |
| T3 | 参数填错章节号 | 参数表与框架文档目录交叉核对 |
| T4 | 归档项目被误参考 | 所有 Prompt 显式声明禁止 `_reference/_archive/`（P6） |
| T5 | reviewer 直接改了 spec 正文 | Prompt B 显式声明"禁止修改 spec 正文" |
| T6 | 修订时新建了版本文件 | Prompt C 显式声明"禁止新建文件，在原文件修订" |
| T7 | 版本号文件名与内部不一致 | 始终单文件，文件名不变，版本号写在文件内部 |
| T8 | 并行任务间相互依赖导致死锁 | 同阶段任务必须独立无依赖，有依赖则拆到不同阶段 |
| T9 | 终审发现新问题导致无限循环 | 终审仅核查阻塞问题解决情况，不发现新问题 |
| T10 | 子 agent 返回信息不足无法决策 | Prompt 末尾必须指定返回格式（P7） |
| T11 | spec 未 approved 就进入开发 | 架构设计/开发 Prompt 显式声明"输入必须是 approved 状态" |
| T12 | 参考项目代码被照搬 | 所有涉及参考项目的 Prompt 声明"仅参考架构模式，禁止照搬代码" |

### 5.4 Prompt 演进管理

| 场景 | 操作 |
|------|------|
| 新增场景模板 | 在第四章新增小节，更新目录 |
| 修改现有模板 | 直接修改，更新文档版本号 |
| 废弃模板 | 标记为 `[已废弃]`，保留一个版本周期后删除 |
| 实践发现新坑点 | 补充到 5.3 避坑清单 |
| 规则文件变动 | 同步更新 Prompt 中引用的规则文件路径 |

---

## 六、质量评估标准

### 6.1 Prompt 质量评估维度

每个 Prompt 发送前，总调度应对照以下维度自检：

| 维度 | 检查项 | 权重 |
|------|--------|:----:|
| **完整性** | 四要素齐全（任务/输入/输出/约束） | 高 |
| **准确性** | 文件路径、章节号、版本号与磁盘一致 | 高 |
| **明确性** | 无模糊表述，每条要求可执行 | 高 |
| **隔离性** | 大文档指定章节，未全量加载 | 高 |
| **合规性** | 显式声明禁止事项（归档项目等） | 高 |
| **可验证性** | 验收标准可执行检查 | 中 |
| **参数化** | 可变内容用占位符，有参数表 | 中 |
| **闭环性** | 要求返回结构化摘要 | 中 |

### 6.2 质量等级

| 等级 | 标准 | 处理 |
|------|------|------|
| A（优秀） | 全部维度达标，无避坑清单问题 | 直接发送 |
| B（合格） | 高权重维度全部达标，中权重有 ≤ 1 项未达标 | 可发送，记录改进点 |
| C（需修改） | 高权重维度有未达标项 | 修改后重新评估 |
| D（不合格） | 多项高权重未达标，或命中避坑清单 | 重新编写 |

### 6.3 Prompt 方案文件评审检查清单

评审一个 Prompt 方案文件（如 `CatNet-VPN-M1阶段spec调度prompt方案.md`）时，逐项核对：

- [ ] **结构完整**：包含任务拆分、调度架构、参考项目流程、Prompt 模板、执行顺序、文件清单
- [ ] **模板规范**：每个 Prompt 模板符合第三章标准格式（四要素齐全）
- [ ] **参数表齐全**：每个 Prompt 模板有对应参数填充表
- [ ] **路径准确**：所有文件路径与磁盘实际一致（无不存在文件）
- [ ] **章节准确**：框架文档章节号与实际目录一致
- [ ] **合规声明**：所有 Prompt 显式声明归档项目禁止、参考项目仅参考模式
- [ ] **版本控制**：spec 修订遵循单文件原则，版本号内部递增
- [ ] **评审隔离**：reviewer 只输出意见，不改正文
- [ ] **阻塞兜底**：有最大轮次限制和终审约束
- [ ] **并行独立**：同阶段并行任务无相互依赖
- [ ] **验证点**：每阶段有明确的产出验证条件
- [ ] **避坑核对**：对照 5.3 避坑清单逐项排查

### 6.4 子 agent 产出质量评估

子 agent 返回后，总调度依据以下标准评估产出：

| 检查项 | 方法 |
|--------|------|
| 文件已创建 | `ls` 验证路径存在 |
| 章节齐全 | 读取文件核对模板结构 |
| 编号连续 | Grep 检查 FR/AC 编号 |
| 状态正确 | 读取文件头部核对状态字段 |
| 版本号正确 | 读取文件头部核对版本号 |
| 规范合规 | 抽查代码/spec 是否符合 .trae/rules/ |
| 参考项目合规 | 核对仅使用保留项目 |
| 验收标准达标 | 逐条核对 Prompt 中的验收标准 |

---

## 七、与 `.trae/rules/` 的关系

### 7.1 职责划分

| 规范体系 | 约束对象 | 文件位置 | 加载方式 |
|---------|---------|---------|---------|
| `.trae/rules/` | **产出物**（代码、spec、API、部署） | `.trae/rules/**/*.md` | 子 agent 启动时按角色加载 |
| 本规范 | **输入指令**（Prompt 设计） | `docs/CatNet-VPN-AI-Prompt使用规范.md` | 总调度设计 Prompt 时参考 |

### 7.2 协作关系

```
总调度 agent
  ├─ 读取本规范 → 设计符合标准的 Prompt
  │
  └─ 发送 Prompt 给子 agent
       ├─ Prompt 中指定【必读规则文件】→ 子 agent 加载 .trae/rules/
       ├─ 子 agent 按规则约束产出代码/spec/API
       └─ 子 agent 返回结构化摘要 → 总调度决策
```

### 7.3 规则文件引用速查

设计 Prompt 时，根据任务类型选择必读规则文件：

| 任务类型 | 必读规则文件 |
|---------|-------------|
| Spec 生成 | `spec/spec-template.md` + `spec/spec-workflow.md` + `global/naming-conventions.md` + `global/code-style.md` |
| Spec 评审 | `spec/spec-workflow.md` + `spec/spec-template.md` |
| Spec 修订 | `spec/spec-workflow.md` + `spec/spec-template.md` |
| 架构设计 | `spec/*` + `dev/*` + `global/*` |
| 前端开发 | `dev/dev-workflow.md` + `dev/component-rules.md` + `global/*` |
| 后端开发 | `dev/dev-workflow.md` + `dev/api-conventions.md` + `global/*` |
| 数据库建模 | `dev/api-conventions.md` + `global/naming-conventions.md` |
| 测试编写 | `dev/testing-standards.md` + `global/code-style.md` |
| DevOps | `infra/*` + `global/*` |
| 性能优化 | `dev/dev-workflow.md` + `dev/component-rules.md` |

---

## 八、附录

### 8.1 Agent 类型与场景映射

| Agent 类型 | 适用场景模板 | 对应 Prompt 章节 |
|-----------|-------------|-----------------|
| `nextjs-spec-generator` | Spec 生成 / Spec 修订 | 4.1 / 4.3 |
| `nextjs-spec-reviewer` | Spec 评审 | 4.2 |
| `nextjs-architect` | 架构设计 | 4.5 |
| `nextjs-frontend-expert` | 开发实施（前端） | 4.6 |
| `nextjs-backend-expert` | 开发实施（后端） | 4.6 |
| `ts-nextjs-db-modeler` | 开发实施（数据库） | 4.6 |
| `nextjs-testing-expert` | 测试编写 | 4.7 |
| `nextjs-performance-optimizer` | 性能优化 | 基于调试排障模板适配 |
| `nextjs-devops-expert` | CI/CD / 部署 | 基于开发实施模板适配 |
| `general_purpose_task` | 调试排障 / 代码审查 | 4.8 / 4.9 |
| 总调度 agent（主对话） | 总调度终审 | 4.4 |

### 8.2 严重程度定义

| 级别 | 定义 | 处理要求 |
|------|------|---------|
| 阻塞 | 导致无法进入下一阶段的问题 | 必须解决，否则标记阻塞 |
| 重要 | 影响质量但不阻断流程的问题 | 必须解决或给出不解决的理由 |
| 建议 | 改进性质的建议 | 酌情采纳 |

### 8.3 文件状态定义

| 状态 | 含义 | 允许的操作 |
|------|------|-----------|
| draft | 草稿，未通过评审 | 可修改，禁止用于实施 |
| in-review | 评审中 | 等待评审结果 |
| approved | 已通过评审 | 禁止修改，可作为下游输入 |
| 阻塞 | 终审未通过 | 列出剩余问题，人工介入 |

### 8.4 版本号规则

| 对象 | 规则 | 示例 |
|------|------|------|
| Spec 文件 | `v{major}.{minor}`，初稿 v1.0，每轮修订 minor+1 | v1.0 → v1.1 → v1.2 |
| 架构设计文件 | 同 Spec | v1.0 → v1.1 |
| 评审文件 | `r{轮次}`，从 r1 递增 | r1, r2 |
| 本规范文档 | `v{major}.{minor}`，重大修订 major+1 | v1.0 |

### 8.5 参数填充速查表

设计 Prompt 时常见占位符及填充示例：

| 占位符 | 含义 | 示例值 |
|--------|------|--------|
| `{AGENT_TYPE}` | 子 agent 类型 | nextjs-spec-generator |
| `{SPEC_NAME}` | spec 中文名称 | 用户认证与授权系统 |
| `{SLUG}` | spec 英文标识 | auth-system |
| `{MILESTONE}` | 里程碑阶段 | M1 |
| `{FRAMEWORK_SECTIONS}` | 框架文档章节 | §2.2、§3.2、§3.10 |
| `{REFERENCE_RELEVANCE_FILES}` | 参考项目 RELEVANCE 文件 | `_reference/test-sp/RELEVANCE.md` |
| `{ROUND}` | 评审轮次 | 1 / 2 |
| `{CURRENT_VERSION}` | 当前版本号 | v1.0 |
| `{NEXT_VERSION}` | 下一版本号 | v1.1 |
| `{VERSION}` | 评审对象版本号 | v1.0（r1 评审对象） |
| `{OUTPUT_PATH}` | 输出文件路径 | /var/ServiceNode/docs/specs/spec-auth-system-v1.0.md |
| `{SPEC_COUNT}` | spec 总数 | 3 |
| `{SPEC_FILE_LIST}` | spec 文件清单 | spec-auth-system-v1.2.md 等 |
| `{REVIEW_FILE_LIST}` | 评审文件清单 | spec-auth-system-review-r2.md 等 |

---

## 九、文档维护

### 9.1 更新触发条件

| 触发条件 | 操作 |
|---------|------|
| 新增 agent 类型 | 更新 8.1 映射表，必要时新增场景模板 |
| 新增规则文件 | 更新 7.3 引用速查表 |
| 实践发现新坑点 | 补充到 5.3 避坑清单 |
| 调度流程变更 | 更新 5.2 多阶段调度编排 |
| 质量评估维度调整 | 更新第六章 |

### 9.2 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-06-20 | 初稿创建，基于 M1 阶段 spec 调度实践经验 |

---

> 本规范是活文档，随项目实践持续演进。所有总调度 agent 在设计 Prompt 时必须遵循本规范，发现不足时及时更新。
