# Next.js 项目 AI Prompt 使用规范

> **文档定位**：通用 Next.js 项目所有 AI Agent（子代理）调度的 Prompt 设计、编写、评估的统一标准
> **适用范围**：总调度 agent 指挥子 agent 执行 spec 生成、评审、修订、架构设计、开发实施、测试、调试、代码审查、性能优化等全部场景
> **与 `.trae/rules/` 的关系**：`.trae/rules/` 约束**产出物**（代码、spec、API），本规范约束**输入指令**（Prompt），两者互补形成完整闭环
> **版本**：v2.4

---

## 目录

- [零、快速入门指南](#零快速入门指南)
  - [0.6 场景→章节映射速查表](#06-场景章节映射速查表)
  - [0.7 调度元 Prompt（推荐用法）](#07-调度元-prompt推荐用法)
- [一、文档目的与适用范围](#一文档目的与适用范围)
- [二、Prompt 设计原则](#二prompt-设计原则)
- [三、Prompt 标准格式](#三prompt-标准格式)
- [四、场景模板库](#四场景模板库)
  - [4.1 Spec 场景（完整周期）](#41-spec-场景完整周期)
  - [4.2 架构设计场景（完整周期）](#42-架构设计场景完整周期)
  - [4.3 开发实施场景](#43-开发实施场景)
  - [4.4 测试编写场景](#44-测试编写场景)
  - [4.5 调试排障场景](#45-调试排障场景)
  - [4.6 代码审查场景](#46-代码审查场景)
  - [4.7 性能优化场景](#47-性能优化场景)
- [五、Agent 调度机制](#五agent-调度机制)
- [六、MCP 工具集成规范](#六mcp-工具集成规范)
- [七、编码质量保障](#七编码质量保障)
- [八、最佳实践指南](#八最佳实践指南)
- [九、质量评估标准](#九质量评估标准)
- [十、与 .trae/rules/ 的关系](#十与-traerules-的关系)
- [十一、附录](#十一附录)
- [十二、文档维护](#十二文档维护)

---

## 零、快速入门指南

> **目标**：5 分钟理解本规范的核心用法，快速上手 Prompt 设计。

### 0.1 本规范是什么

一份标准化文档，告诉你**如何为 Next.js 项目的子 agent 设计 Prompt**。它不是提示词字典，而是 Prompt 工程的操作手册。

### 0.2 三层文档体系

```
Layer 0（本规范）     通用规则与模板                    ← 你正在读的
    ↓ 结合项目需求
Layer 1（项目方案）   {项目名}-{里程碑}调度prompt方案.md  ← 每个里程碑生成一次
    ↓ 填充参数
Layer 2（实际指令）   发给子 agent 的具体 Prompt         ← 从 Layer 1 复制发送
```

### 0.3 日常使用流程

```
新里程碑启动
  ├─ 1. 读第二章（P1-P10 原则）→ 内化为自检清单
  ├─ 2. 读第四章（场景模板）→ 选择对应阶段的 Prompt 模板
  ├─ 3. 查 11.5 参数速查表 → 填充占位符
  ├─ 4. 查 8.2 避坑清单 → 核对是否踩坑
  ├─ 5. 发送给子 agent → 接收返回摘要 → 核对验收标准
  └─ 6. 里程碑结束 → 归档 Layer 1 文档
```

### 0.4 按阶段快速定位

| 阶段 | 读哪节 | 用哪个 Prompt |
|------|--------|--------------|
| 需求 | 4.1 | A（生成）→ B（评审）→ C（修订）→ D（终审） |
| 架构 | 4.2 | E（生成）→ F（评审）→ G（修订）→ H（终审） |
| 开发 | 4.3 | 开发实施模板 |
| 测试 | 4.4 | 测试编写模板 |
| 调试 | 4.5 | 调试排障模板 |
| 审查 | 4.6 | 代码审查模板 |
| 优化 | 4.7 | 性能优化模板 |

### 0.5 10 秒自检清单

每次发送 Prompt 前默念：

- [ ] 任务/输入/输出/约束四要素齐全？（P1）
- [ ] 大文档指定了章节范围？（P2）
- [ ] 可变内容用了占位符？（P3）
- [ ] 有可检查的验收标准？（P4）
- [ ] 文件路径实际存在？（P8）
- [ ] 末尾要求返回结构化摘要？（P7）

### 0.6 场景→章节映射速查表

> **用途**：不需要记住文档结构。告诉 AI 你要做什么任务，AI 查此表找到需要引用的章节，自动组装 Prompt。

| 任务类型 | 需引用的规范章节 | 结合的输入文件 | 目标 Agent |
|---------|----------------|--------------|-----------|
| Spec 生成 | §2.2 P1-P4,P6 / §4.1.1 / §2.3 G1-G10 / §8.2 T1-T7 / §11.5 | 项目框架文档 §x | nextjs-spec-generator |
| Spec 评审 | §2.2 P5,P7 / §4.1.2 / §11.2 | 待评审 spec 文件 | general_purpose_task |
| Spec 修订 | §2.2 P3,P7 / §4.1.3 / §8.2 T5-T7 | spec + 评审意见 | nextjs-spec-generator |
| Spec 终审 | §4.1.4 / §8.2 T9 | spec + 评审意见 | general_purpose_task |
| 架构生成 | §2.2 P1-P4 / §4.2.1 / §2.3 G1-G10 / §8.2 T19 | approved spec | nextjs-architect |
| 架构评审 | §4.2.2 / §11.2 | 架构文件 + spec | general_purpose_task |
| 架构修订 | §4.2.3 / §8.2 T19 | 架构文件 + 评审意见 | nextjs-architect |
| 架构终审 | §4.2.4 / §8.2 T20 | 架构文件 + 评审意见 | general_purpose_task |
| 开发实施 | §2.3 G1-G10 / §4.3 / §8.2 T11-T13 | approved 架构 + spec | nextjs-frontend/backend-expert |
| 测试编写 | §4.4 / §8.2 T18 | 源码 + spec AC | nextjs-testing-expert |
| 调试排障 | §4.5 | 错误信息 + 相关文件 | general_purpose_task |
| 代码审查 | §4.6 / §7.5 / §11.2 | 变更文件清单 | general_purpose_task |
| 性能优化 | §4.7 | 性能报告 / 页面 URL | nextjs-performance-optimizer |
| 里程碑编排 | §5.1-5.3 / §5.5 / §0.4 | 里程碑需求 | 总调度自身 |

### 0.7 调度元 Prompt（推荐用法）

> **核心思路**：你不需要自己查上表。把以下元 Prompt 发给总调度 AI，它自动查表、读章节、组装 Prompt。

**元 Prompt 模板**：

```
我要执行【{任务类型}】任务。

请按以下步骤操作：
1. 读取本文件的 §0.6 场景→章节映射速查表
2. 根据"{任务类型}"找到需要引用的章节清单
3. 逐个读取这些章节的内容
4. 读取以下需求文件：{需求文件路径}
   - 必读章节：{需求文件章节}
5. 基于规范章节 + 需求文件，生成可直接发送给【{AGENT_TYPE}】的完整 Prompt
6. 输出以下三项：
   a. 填好参数的完整 Prompt（可直接复制发送）
   b. 参数填充表（参数名 → 值的对照）
   c. 避坑核对结果（对照 §8.2 相关条目，逐条标注 ✅/⚠️）
```

**使用示例**：

```
我要执行【Spec 生成】任务。

请按以下步骤操作：
1. 读取本文件的 §0.6 场景→章节映射速查表
2. 根据"Spec 生成"找到需要引用的章节清单
3. 逐个读取这些章节的内容
4. 读取以下需求文件：docs/项目框架文档.md
   - 必读章节：§2.2、§3.1
5. 基于规范章节 + 需求文件，生成可直接发送给【nextjs-spec-generator】的完整 Prompt
6. 输出以下三项：
   a. 填好参数的完整 Prompt（可直接复制发送）
   b. 参数填充表（参数名 → 值的对照）
   c. 避坑核对结果（对照 §8.2 相关条目，逐条标注 ✅/⚠️）
```

**你只需要改三个值**：
- `{任务类型}`：从 §0.6 表第一列选一个（如"Spec 生成"、"架构评审"）
- `{需求文件路径}`：你的项目需求文件
- `{AGENT_TYPE}`：从 §0.6 表最后一列选对应的 agent 类型

---

## 一、文档目的与适用范围

### 1.1 为什么需要 Prompt 规范

Next.js 项目采用"总调度 + 子 agent"的多代理协作模式，涉及 10+ 种 agent 类型。在多阶段调度实践中，常见以下问题：

| 问题类别 | 具体表现 | 影响 |
|---------|---------|------|
| 引用失效 | Prompt 引用了不存在的文件或章节 | 子 agent 执行中断，需临时适配 |
| 参数错填 | 多模板 × 多 spec × 多参数，人工填充易错 | 上下文加载错误章节 |
| 约束遗漏 | 上下文隔离、安全约束靠人工记忆 | 潜在合规与安全风险 |
| 模板不可复用 | 每个里程碑都要重新设计 prompt | 效率低，质量不稳定 |
| 缺乏评估标准 | 无法判断 prompt 是否合格 | 质量参差不齐 |
| 调度无序 | Agent 间依赖不清、并行/串行混乱 | 死锁、重复执行、遗漏步骤 |
| 工具使用随意 | MCP 工具调用无规范，参数与错误处理缺失 | 工具调用失败、结果不可控 |
| 代码质量失控 | AI 生成代码缺乏统一质量标准 | 技术债累积、维护困难 |

本规范旨在解决上述问题，建立可复用、可验证、可演进的 Prompt 工程体系。

### 1.2 适用对象

| 角色 | 使用方式 |
|------|---------|
| **总调度 agent**（主对话） | 按本规范设计 Prompt，调度子 agent 执行 |
| **子 agent**（spec-generator/reviewer、architect、dev-expert 等） | 接收符合本规范的 Prompt，按约束执行 |
| **项目维护者** | 依据本规范评审 Prompt 方案文件 |

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
| P6 | **合规优先** | 必须显式声明禁止事项（敏感操作、安全约束等） |
| P7 | **闭环反馈** | Prompt 末尾要求返回结构化摘要，便于总调度决策 |
| P8 | **版本一致** | 引用文件路径、版本号必须与磁盘实际状态一致 |
| P9 | **安全优先** | 涉及密钥、凭证、个人数据的操作必须显式约束 |
| P10 | **工具显式** | MCP 工具调用必须声明触发条件、参数与错误处理策略 |

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
> "你是 nextjs-spec-generator，任务：为项目生成【用户认证与授权系统】spec 初稿。
> 【输入】读取项目框架文档 §2.2、§3.2、§3.10 章节。
> 【输出】写入 {PROJECT_ROOT}/docs/specs/spec-auth-system-v1.0.md，状态 draft。
> 【约束】禁止照搬参考项目代码，FR 编号连续，单文件 ≤ 500 行。"

#### P2 上下文隔离

大文档**禁止全量加载**，必须指定章节范围。

**隔离策略**：

| 文档类型 | 大小 | 策略 |
|---------|------|------|
| 框架文档 | > 50KB | 指定 §章节号，禁止全量读取 |
| 参考项目 | 多文件 | 先读 RELEVANCE.md，仅读"必看模块" |
| 规则文件 | < 5KB | 可全量读取 |
| spec 正文 | < 50KB | 可全量读取 |
| 依赖库文档 | > 30KB | 优先使用 MCP 工具按需检索 |

**参考项目读取四步法**（所有需要参考项目的 Prompt 共用）：

```
Step 1: 读参考项目对照指引（入口文件）
        └─ 获取：保留/归档项目清单、读取优先级、集成改造提示

Step 2: 从对照指引获取模块→参考项目映射

Step 3: 读 {REFERENCE_ROOT}/{project}/RELEVANCE.md（仅当映射指向时）
        └─ 获取：必看模块、可忽略部分、改造要点

Step 4: 仅阅读 RELEVANCE.md 标注的"必看模块"文件
        └─ 禁止阅读"可忽略部分"
        └─ 禁止检索归档项目目录
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
| 项目类 | `{PROJECT_ROOT}` | /home/user/my-app |
| 技术类 | `{TECH_STACK}` | Next.js 15 + Drizzle + next-auth |

**参数表格式**（每个 Prompt 方案必须附带，完整占位符清单见 [11.5 参数填充速查表](#115-参数填充速查表)）：

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
- 每条必须是**可执行检查**（文件存在 / 编号连续 / 章节齐全 / 命令通过）
- 禁止使用模糊表述（如"质量良好"、"结构清晰"）
- 验收标准数量建议 4-8 条

**示例**：
```
【验收标准】
- 文件已创建在 {PROJECT_ROOT}/docs/specs/spec-auth-system-v1.0.md
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
| 禁止检索归档项目目录 | 所有涉及参考项目的 Prompt |
| 禁止照搬参考项目代码，仅参考架构模式 | 所有涉及参考项目的 Prompt |
| 禁止使用 `any` 类型 | 所有涉及代码的 Prompt |
| 禁止跨模块 `../` 引用 | 所有涉及代码的 Prompt |
| 禁止跳过评审直接 approved | spec 相关 Prompt |
| 禁止 reviewer 修改 spec 正文 | spec 评审 Prompt |
| 禁止新建版本文件（始终单文件） | spec 修订 Prompt |
| 禁止在 spec 未 approved 前启动开发 | 架构设计/开发 Prompt |
| 禁止硬编码密钥、Token、连接字符串 | 所有涉及代码的 Prompt |
| 禁止将敏感信息写入日志或返回值 | 所有涉及代码的 Prompt |
| 禁止在客户端组件中直接调用数据库 | 前端开发 Prompt |
| 禁止使用 `dangerouslySetInnerHTML` 未做净化 | 前端开发 Prompt |

#### P7 闭环反馈

Prompt 末尾必须要求子 agent 返回结构化摘要，格式：

```
完成后返回：
- 文件路径（或操作结果）
- 关键统计（FR/AC 数量、问题数量等）
- 参考项目使用清单（如涉及）
- MCP 工具调用清单（如涉及）
- 阻塞问题（如有）
```

总调度依据此摘要决定是否进入下一阶段。

#### P8 版本一致

引用文件路径和版本号必须与磁盘实际状态一致。

**检查清单**（Prompt 发送前总调度必须核对）：

- [ ] 引用的文件路径实际存在
- [ ] 引用的章节号在目标文件中存在
- [ ] 版本号与文件内部版本号一致（如 Prompt 说 v1.1，文件内部也是 v1.1）
- [ ] 参考项目目录名与实际目录名一致

#### P9 安全优先

涉及敏感数据的操作必须显式约束：

| 场景 | 约束 |
|------|------|
| 数据库操作 | 禁止硬编码连接字符串，必须使用环境变量 |
| 认证授权 | 禁止在日志中输出 Token、密码、Session ID |
| API 调用 | 禁止将 API Key 提交到代码仓库 |
| 用户数据 | 禁止在返回值中包含密码哈希、敏感字段 |
| 环境变量 | 禁止在客户端组件中读取服务端环境变量 |

#### P10 工具显式

MCP 工具调用必须遵循以下要求：

- 显式声明触发条件（何时调用）
- 显式声明参数来源（从哪个文件/变量获取）
- 显式声明结果处理方式（写入文件 / 返回摘要 / 触发后续动作）
- 显式声明错误恢复策略（重试 / 降级 / 中止）

### 2.3 全局代码约束

以下约束适用于**所有涉及代码的 Prompt 模板**（4.2-4.7），模板内不再逐条重复，仅声明"适用全局代码约束（2.3 节）"。各模板可在此基础上追加场景特有约束。

| 编号 | 约束 | 说明 |
|------|------|------|
| G1 | 禁止使用 `any` 类型 | 不确定类型用 `unknown`，用类型守卫收窄 |
| G2 | 禁止跨模块 `../` 引用 | 必须使用 `@/` 绝对路径导入 |
| G3 | 单文件 ≤ 500 行 | 页面文件 ≤ 300 行；超出则拆分 |
| G4 | 禁止硬编码密钥、Token、连接字符串 | 必须使用环境变量 |
| G5 | 禁止在日志或返回值中输出敏感信息 | Token、密码、Session ID 等 |
| G6 | 禁止在客户端组件中直接调用数据库 | 通过 Server Action 或 API Route |
| G7 | 禁止使用 `dangerouslySetInnerHTML` 未做净化 | 必须用 DOMPurify 等净化 |
| G8 | 禁止使用 `@ts-ignore` / `@ts-expect-error` | 修复类型错误而非绕过 |
| G9 | TypeScript 严格模式 | `tsconfig.json` 中 `strict: true` |
| G10 | 图标统一使用 lucide-react | 禁止内联 SVG（除非必要） |

> **Prompt 模板中的引用方式**：在【硬性约束】章节开头声明"适用全局代码约束（2.3 节 G1-G10）"，然后仅列出场景特有约束。

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

【MCP 工具】（如涉及）
1. {TOOL_NAME} — {触发条件}，参数：{PARAMS}，错误处理：{STRATEGY}

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

【错误处理】（如涉及）
- 文件不存在：{处理策略（中止/降级/创建空文件）}
- 权限不足：{处理策略}
- 类型检查失败：{处理策略}
- 其他错误：{处理策略}

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
| MCP 工具 | ⚠️ | 涉及工具调用时提供（无工具可省） |
| 输出 | ✅ | 指定产出路径和格式 |
| 操作要求 | ⚠️ | 多步骤任务时提供（单步骤可省） |
| 硬性约束 | ✅ | 禁止事项和强制要求 |
| 错误处理 | ⚠️ | 遇到错误时的处理策略（简单任务可省） |
| 验收标准 | ✅ | 可检查的完成条件 |
| 返回格式 | ✅ | 要求子 agent 返回的摘要格式 |

### 3.3 命名与路径规范

| 类别 | 规范 | 示例 |
|------|------|------|
| Prompt 方案文件 | `{项目名}-{阶段}阶段{任务}调度prompt方案.md` | `myapp-M1阶段spec调度prompt方案.md` |
| Prompt 模板编号 | Prompt A / B / C / D...（按执行顺序） | A=生成, B=评审, C=修订, D=终审 |
| 文件路径 | 始终使用绝对路径或 `{PROJECT_ROOT}` 占位 | `{PROJECT_ROOT}/docs/specs/spec-auth-system-v1.0.md` |
| 章节引用 | 使用 §前缀 | `§2.2、§3.10` |

---

## 四、场景模板库

### 4.1 Spec 场景（完整周期）

Spec 需求规格文档遵循"生成→评审→修订→终审"完整闭环，确保需求质量在进入架构设计前得到验证。

#### 4.1.1 Spec 生成（Prompt A）

**适用 agent**：`nextjs-spec-generator`
**触发时机**：里程碑启动，需要生成需求规格文档初稿

```
你是 nextjs-spec-generator，任务：为项目 {MILESTONE} 阶段生成【{SPEC_NAME}】需求规格文档初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. {PROJECT_ROOT}/.trae/rules/spec/spec-template.md  — spec 正文模板结构
2. {PROJECT_ROOT}/.trae/rules/spec/spec-workflow.md  — 工作流与命名规范
3. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范
4. {PROJECT_ROOT}/.trae/rules/global/code-style.md   — 代码风格约束

【输入文件】
1. {PROJECT_ROOT}/docs/项目框架文档.md
   - 必读章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，不读全文档（大文档禁止全量加载）
2. {PROJECT_ROOT}/docs/参考项目对照指引.md
   - 作用：参考项目入口文件，必须最先读取
   - 获取：保留/归档项目清单、各项目核心参考价值、读取优先级
3. {REFERENCE_RELEVANCE_FILES}
   - 仅当对照指引指向参考项目时，读取对应 {REFERENCE_ROOT}/{project}/RELEVANCE.md
   - 仅阅读 RELEVANCE.md 标注的"必看模块"文件
   - 禁止检索归档项目目录

【输出】
- 文件路径：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.0.md
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
10. 禁止硬编码密钥、Token、连接字符串

【验收标准】
- 文件已创建在指定路径
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 引用的框架文档章节准确无误
- 参考项目仅来自对照指引中的保留项目清单

完成后返回：文件路径 + 章节大纲 + FR/AC 数量统计 + 参考项目使用清单。
```

#### 4.1.2 Spec 评审（Prompt B）

**适用 agent**：`nextjs-spec-reviewer`
**触发时机**：spec 初稿或修订版完成后

```
你是 nextjs-spec-reviewer，任务：对【{SPEC_NAME}】spec 第 {ROUND} 轮评审。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/spec/spec-workflow.md  — 评审角色职责
2. {PROJECT_ROOT}/.trae/rules/spec/spec-template.md  — 评审对照模板

【输入文件】
1. 待评审 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{VERSION}.md
2. 框架文档：{PROJECT_ROOT}/docs/项目框架文档.md
   - 对照章节：{FRAMEWORK_SECTIONS}
3. 参考项目入口：{PROJECT_ROOT}/docs/参考项目对照指引.md
   - 用于核对 spec 是否正确引用保留项目、是否误用归档项目

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
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
9. 安全性：是否包含敏感信息泄露风险；是否缺少输入验证要求

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
5. 禁止检索归档项目目录

完成后返回：评审文件路径 + 问题数量统计（阻塞/重要/建议）+ 评审结论。
```

#### 4.1.3 Spec 修订（Prompt C）

**适用 agent**：`nextjs-spec-generator`
**触发时机**：评审完成后，根据评审意见修订 spec
**特点**：参数化支持多轮复用（`{ROUND}` / `{CURRENT_VERSION}` / `{NEXT_VERSION}`）

```
你是 nextjs-spec-generator，任务：根据第 {ROUND} 轮评审意见修订【{SPEC_NAME}】spec。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/spec/spec-workflow.md  — 修订流程约束
2. {PROJECT_ROOT}/.trae/rules/spec/spec-template.md  — 模板结构

【输入文件】
1. 当前 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{CURRENT_VERSION}.md
2. 评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
3. 框架文档（如需核对）：{PROJECT_ROOT}/docs/项目框架文档.md
   - 核对章节：{FRAMEWORK_SECTIONS}
4. 参考项目入口（如需核对）：{PROJECT_ROOT}/docs/参考项目对照指引.md

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

#### 4.1.4 Spec 终审（Prompt D）

**适用角色**：总调度 agent 自行执行（不调度子 agent）
**触发时机**：最后一轮修订完成后，做最终决议

```
你是总调度收尾 agent，任务：汇总 {SPEC_COUNT} 个 spec 的最后一轮修订结果，做最终决议。

【输入文件】
1. {SPEC_FILE_LIST}（最后一轮修订后的 spec 文件）
2. {REVIEW_FILE_LIST}（最后一轮评审意见文件）
3. {PROJECT_ROOT}/docs/参考项目对照指引.md（核对参考项目使用合规性）

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

### 4.2 架构设计场景（完整周期）

架构设计与 spec 一样遵循"生成→评审→修订→终审"完整闭环，确保架构质量在进入开发前得到验证。

#### 4.2.1 架构设计生成（Prompt E）

**适用 agent**：`nextjs-architect`
**触发时机**：spec 全部 approved 后，进入架构设计阶段

```
你是 nextjs-architect，任务：基于已 approved 的 spec 设计【{MODULE_NAME}】模块技术架构。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/spec/spec-workflow.md  — 了解 spec 输出约束
2. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md     — 开发流程约束
3. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md  — 服务层与 API 规范
4. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md  — 组件规范
5. {PROJECT_ROOT}/.trae/rules/global/code-style.md    — 代码风格
6. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. {APPROVED_SPEC_FILES}（已 approved 的 spec 文件，唯一合法输入）
   - 禁止参考 draft 或 in-review 状态的 spec
2. {PROJECT_ROOT}/docs/项目框架文档.md
   - 必读章节：{FRAMEWORK_SECTIONS}
3. {PROJECT_ROOT}/docs/参考项目对照指引.md
   - 获取参考项目清单与读取优先级
4. {REFERENCE_RELEVANCE_FILES}（如对照指引指向参考项目）

【输出】
- 文件路径：{PROJECT_ROOT}/docs/architecture/arch-{SLUG}-v1.0.md
- 状态：draft
- 必备章节：架构概述 / 模块划分 / 技术选型 / 数据流设计 / 接口定义 / 目录结构 / 依赖关系 / 非功能设计 / 风险与对策

【硬性约束】
1. 架构设计必须以 approved spec 为唯一需求来源
2. 禁止照搬参考项目代码，仅参考架构模式
3. 技术栈必须与项目实际配置一致（核对 package.json）
4. 禁止使用 any 类型
5. 禁止跨模块 ../ 引用
6. 单文件 ≤ 500 行
7. 禁止硬编码密钥、Token、连接字符串

【验收标准】
- 文件已创建在指定路径
- 包含所有必备章节
- 每个 spec 的 FR 都有对应的架构设计落点
- 目录结构符合 .trae/rules/dev/ 规范
- 技术选型与项目实际配置一致

完成后返回：文件路径 + 架构决策清单 + 模块划分图 + 风险清单。
```

#### 4.2.2 架构设计评审（Prompt F）

**适用 agent**：`general_purpose_task`（评审角色与生成角色隔离，同 spec 评审模式）
**触发时机**：架构设计初稿或修订版完成后

```
你是架构评审 agent，任务：对【{MODULE_NAME}】架构设计第 {ROUND} 轮评审。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md     — 开发流程约束
2. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md  — API 规范（核对接口定义）
3. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md  — 组件规范（核对模块划分）
4. {PROJECT_ROOT}/.trae/rules/global/code-style.md    — 代码风格
5. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. 待评审架构文件：{PROJECT_ROOT}/docs/architecture/arch-{SLUG}-v{VERSION}.md
2. 对应 spec 文件：{APPROVED_SPEC_FILES}
   - 用于核对 FR 覆盖性
3. {PROJECT_ROOT}/package.json
   - 核对技术选型与实际依赖一致
4. {PROJECT_ROOT}/docs/项目框架文档.md
   - 对照章节：{FRAMEWORK_SECTIONS}

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/arch-{SLUG}-review-r{ROUND}.md
- 评审意见文件一旦归档禁止修改

【评审维度】（逐项检查，每项给出结论）
1. Spec 覆盖性：每个 FR 是否有对应的架构设计落点；有无遗漏的需求
2. 技术选型合理性：是否与 package.json 实际依赖一致；是否有过度设计或设计不足
3. 模块划分：边界是否清晰；耦合度是否合理；是否符合单一职责
4. 数据流设计：是否完整覆盖正常流和异常流；有无遗漏的边界场景
5. 接口定义：是否符合 api-conventions.md 规范；ServiceResult 返回格式是否统一
6. 目录结构：是否符合 .trae/rules/dev/ 规范；是否有 @/ 绝对路径导入
7. 非功能设计：性能（缓存、渲染策略）、安全（输入验证、认证授权）、可扩展性是否考虑
8. 风险识别：是否识别了技术风险；对策是否可行
9. 合规性：是否违反 .trae/rules/ 规范；是否照搬参考项目代码
10. 可实施性：开发 agent 能否据此直接编码；有无模糊不清的描述

【问题清单格式】
| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议
- 阻塞级问题必须导致"需修订"结论
- 编号格式：AR{ROUND}-001、AR{ROUND}-002...（AR = Architecture Review）

【评审结论】
- 需修订：存在阻塞或重要问题
- 通过：仅剩建议级问题或无问题

【硬性约束】
1. 评审角色禁止直接修改架构文件正文，只输出意见文件
2. 禁止粘贴架构文件原文到评审文件
3. 每个问题必须给出具体修订建议
4. 结论为"通过"时，架构文件可进入 approved 状态
5. 必须核对 package.json 实际依赖，禁止凭印象判断技术选型

完成后返回：评审文件路径 + 问题数量统计（阻塞/重要/建议）+ 评审结论。
```

#### 4.2.3 架构设计修订（Prompt G）

**适用 agent**：`nextjs-architect`
**触发时机**：架构评审完成后，根据评审意见修订
**特点**：参数化支持多轮复用（`{ROUND}` / `{CURRENT_VERSION}` / `{NEXT_VERSION}`）

```
你是 nextjs-architect，任务：根据第 {ROUND} 轮评审意见修订【{MODULE_NAME}】架构设计。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md     — 开发流程约束
2. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md  — API 规范
3. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md  — 组件规范
4. {PROJECT_ROOT}/.trae/rules/global/code-style.md    — 代码风格

【输入文件】
1. 当前架构文件：{PROJECT_ROOT}/docs/architecture/arch-{SLUG}-v{CURRENT_VERSION}.md
2. 评审意见：{PROJECT_ROOT}/docs/reviews/arch-{SLUG}-review-r{ROUND}.md
3. 对应 spec 文件：{APPROVED_SPEC_FILES}（如需核对 FR 覆盖性）
4. {PROJECT_ROOT}/package.json（如需核对技术选型）

【操作要求】
1. 在原架构文件上直接修订（不新建文件）
2. 文件内版本号更新为 v{NEXT_VERSION}
3. 在文件头部变更记录新增一行：v{NEXT_VERSION} | 日期 | 根据 r{ROUND} 评审修订
4. 状态保持 draft（未通过评审前不改为 approved）

【修订原则】
1. 逐条对照评审问题清单（AR{ROUND}-001、AR{ROUND}-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由
4. 建议级问题酌情采纳
5. 禁止删除已通过评审的章节，仅可修改或新增
6. 禁止改动与评审意见无关的内容

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订
2. 修订后必须保持所有必备章节完整
3. 技术选型修改必须与 package.json 一致
4. 禁止使用 any 类型
5. 禁止跨模块 ../ 引用
6. 单文件 ≤ 500 行

【验收标准】
- 文件版本号已更新为 v{NEXT_VERSION}
- 变更记录已新增 v{NEXT_VERSION} 行
- 所有阻塞级问题已解决
- 所有必备章节仍然完整
- 输出修订对照表：AR{ROUND}-编号 | 是否解决 | 修订位置

完成后返回：文件路径 + 修订对照表 + 阻塞问题解决率。
```

#### 4.2.4 架构设计终审（Prompt H）

**适用角色**：总调度 agent 自行执行（不调度子 agent）
**触发时机**：最后一轮架构修订完成后，做最终决议

```
你是总调度收尾 agent，任务：汇总【{MODULE_NAME}】架构设计的最后一轮修订结果，做最终决议。

【输入文件】
1. 最后一轮修订后的架构文件：{PROJECT_ROOT}/docs/architecture/arch-{SLUG}-v{VERSION}.md
2. 最后一轮评审意见：{PROJECT_ROOT}/docs/reviews/arch-{SLUG}-review-r{ROUND}.md
3. 对应 spec 文件：{APPROVED_SPEC_FILES}（核对 FR 覆盖性）

【任务】
1. 读取最后一轮评审意见和对应修订版架构文件
2. 核对修订版是否已解决评审中的所有阻塞级问题
3. 核对架构文件是否覆盖所有 spec 的 FR
4. 做决议：
   - 阻塞问题已全部解决 + FR 全覆盖 → 将架构文件状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题或 FR 遗漏 → 标记为阻塞，列出剩余问题
5. 输出汇总报告（直接回复，不写文件）：
   - 架构终审状态（approved / 阻塞）
   - 阻塞问题清单（如有）
   - FR 覆盖率（已覆盖数/总数）
   - 是否可进入开发阶段

【硬性约束】
1. 仅修改状态字段，不改动架构文件正文内容
2. approved 状态的架构文件才可交给开发 agent
3. draft 状态的架构文件禁止进入开发
4. 终审仅核查最后一轮阻塞问题是否解决，不重新发现新问题（防止无限循环）
5. FR 覆盖率必须 100%，任何遗漏的 FR 都视为阻塞
```

### 4.3 开发实施场景

**适用 agent**：`nextjs-frontend-expert` / `nextjs-backend-expert` / `ts-nextjs-db-modeler`
**触发时机**：架构设计 approved 后，进入编码实施

```
你是 {AGENT_TYPE}，任务：基于架构设计实现【{FEATURE_NAME}】功能。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md       — 开发流程
2. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md    — API 与服务层规范
3. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md    — 组件规范
4. {PROJECT_ROOT}/.trae/rules/dev/testing-standards.md  — 测试规范
5. {PROJECT_ROOT}/.trae/rules/global/code-style.md      — 代码风格
6. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. {APPROVED_ARCH_FILE}（已 approved 的架构设计文件）
2. {APPROVED_SPEC_FILE}（对应的 spec 文件）
3. {PROJECT_ROOT}/docs/项目框架文档.md
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
10. 禁止硬编码密钥、Token、连接字符串，必须使用环境变量
11. 禁止在客户端组件中直接调用数据库
12. 禁止使用 dangerouslySetInnerHTML 未做净化

【验收标准】
- 代码文件已创建在指定路径
- npx tsc --noEmit 无类型错误
- npm run lint 无警告
- 单元测试覆盖核心业务逻辑
- 所有 FR 对应的功能已实现

完成后返回：文件清单 + 类型检查结果 + 测试覆盖情况。
```

### 4.4 测试编写场景

**适用 agent**：`nextjs-testing-expert`
**触发时机**：功能开发完成后，补充或完善测试

```
你是 nextjs-testing-expert，任务：为【{FEATURE_NAME}】编写测试。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/dev/testing-standards.md — 测试规范
2. {PROJECT_ROOT}/.trae/rules/global/code-style.md      — 代码风格

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

### 4.5 调试排障场景

**适用 agent**：`general_purpose_task` 或对应专业 agent
**触发时机**：遇到 bug、测试失败、构建错误

```
你是 {AGENT_TYPE}，任务：排查【{PROBLEM_DESCRIPTION}】问题。

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

### 4.6 代码审查场景

**适用 agent**：`general_purpose_task`
**触发时机**：功能开发完成，提交前审查

```
你是代码审查 agent，任务：审查【{FEATURE_NAME}】的代码变更。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/global/code-style.md      — 代码风格
2. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范
3. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md    — API 规范
4. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md    — 组件规范
5. {PROJECT_ROOT}/.trae/rules/dev/testing-standards.md  — 测试规范

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

### 4.7 性能优化场景

**适用 agent**：`nextjs-performance-optimizer`
**触发时机**：性能指标不达标、Lighthouse 评分低、构建缓慢

```
你是 nextjs-performance-optimizer，任务：优化【{TARGET_AREA}】性能。

【必读规则文件】
1. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md       — 开发流程
2. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md    — 组件规范
3. {PROJECT_ROOT}/.trae/rules/global/code-style.md      — 代码风格

【输入文件】
1. {PERFORMANCE_REPORT}（Lighthouse 报告 / 构建分析 / 性能指标）
2. {RELATED_FILES}（待优化的代码文件）

【优化维度】
1. Core Web Vitals：LCP、FID、CLS、INP
2. 包体积：Bundle 大小、按需加载、Tree Shaking
3. 渲染性能：Server/Client Component 划分、Suspense 边界
4. 数据获取：缓存策略、并行请求、流式渲染
5. 构建优化：编译速度、增量构建、依赖优化

【硬性约束】
1. 优化不得破坏现有功能
2. 禁止使用 any 类型
3. 优化后必须通过全部测试
4. 禁止引入未在 package.json 中的依赖
5. 性能优化必须可测量（优化前后对比数据）

【验收标准】
- 性能指标有明显提升（附优化前后对比）
- npx tsc --noEmit 无类型错误
- npm test 通过
- npm run build 成功

完成后返回：优化前后的性能指标对比 + 修改文件清单 + 优化原理说明。
```

---

## 五、Agent 调度机制

### 5.1 总体调度策略

总调度 agent 作为中枢，负责全流程的任务分解、Agent 分配、状态跟踪与决策。

#### 5.1.1 调度模式

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| **串行调度** | 任务间存在强依赖（spec→架构→开发） | 前一阶段完成且验证通过后才启动下一阶段 |
| **并行调度** | 同阶段内独立任务（多个 spec 同时生成） | 多个 agent 实例同时执行，取最慢任务耗时 |
| **混合调度** | 复杂工作流（部分并行 + 部分串行） | 按依赖图编排，最大化并行度 |

#### 5.1.2 调度决策流程

```
接收任务
  ├─ 1. 任务分解：将大任务拆分为原子任务
  ├─ 2. 依赖分析：识别任务间依赖关系
  ├─ 3. Agent 匹配：为每个任务选择最合适的 agent 类型
  ├─ 4. 编排调度：确定并行/串行执行顺序
  ├─ 5. Prompt 生成：按本规范生成每个 agent 的 Prompt
  ├─ 6. 派发执行：发送 Prompt，等待返回
  ├─ 7. 结果评估：核对验收标准
  └─ 8. 状态推进：通过则进入下一任务，未通过则迭代
```

#### 5.1.3 调度原则

| 原则 | 说明 |
|------|------|
| **最小上下文** | 每个 agent 只加载完成任务所需的最小上下文 |
| **最大并行** | 在依赖允许的前提下最大化并行度 |
| **单点决策** | 所有跨 agent 的决策由总调度统一裁决 |
| **状态可追溯** | 每个任务的输入、输出、状态变更可追溯 |
| **失败隔离** | 单个 agent 失败不阻塞其他独立任务 |

### 5.2 Sub-agent 协同工作流程

#### 5.2.1 协同模型

```
总调度 agent（主对话）
  │
  ├─ [阶段1: 需求] 并行调度 N × nextjs-spec-generator
  │     └─ 产出: spec 文件 (draft)
  │
  ├─ [阶段2: 评审] 并行调度 N × nextjs-spec-reviewer
  │     └─ 产出: 评审意见文件
  │
  ├─ [阶段3: 修订] 并行调度 N × nextjs-spec-generator
  │     └─ 产出: spec 文件 (draft, 版本递增)
  │
  ├─ [阶段4: 终审] 总调度自行执行
  │     └─ 产出: spec 状态决议 (approved/阻塞)
  │
  ├─ [阶段5: 架构生成] 调度 nextjs-architect
  │     └─ 产出: 架构设计文件 (draft)
  │
  ├─ [阶段5b: 架构评审] 调度 general_purpose_task
  │     └─ 产出: 架构评审意见文件
  │
  ├─ [阶段5c: 架构修订] 调度 nextjs-architect
  │     └─ 产出: 架构设计文件 (draft, 版本递增)
  │
  ├─ [阶段5d: 架构终审] 总调度自行执行
  │     └─ 产出: 架构状态决议 (approved/阻塞)
  │
  ├─ [阶段6: 开发] 并行调度 frontend/backend/db-modeler
  │     └─ 产出: 代码文件 + 测试文件
  │
  ├─ [阶段7: 测试] 调度 nextjs-testing-expert
  │     └─ 产出: 测试文件 + 覆盖率报告
  │
  └─ [阶段8: 审查] 调度 general_purpose_task (代码审查)
        └─ 产出: 审查意见
```

#### 5.2.2 Agent 间数据传递

Agent 间**禁止直接通信**，所有数据传递通过文件系统：

| 传递方式 | 说明 | 示例 |
|---------|------|------|
| 文件产出 | 上游 agent 写入文件，下游 agent 读取 | spec-generator 写 spec，reviewer 读 spec |
| 状态字段 | 文件内部的状态字段标识是否可被下游消费 | spec 状态 approved 后才可被 architect 读取 |
| 调度摘要 | 子 agent 返回给总调度的结构化摘要 | 总调度依据摘要决定下一步 |

**禁止行为**：
- 子 agent 直接调用其他子 agent
- 子 agent 读取非本任务指定的文件
- 子 agent 修改非本任务产出的文件

#### 5.2.3 协同状态机

每个任务在调度系统中经历以下状态：

```
pending → dispatched → running → completed
                ↓           ↓
             cancelled    failed → retrying → running
                ↓           ↓
             skipped     blocked → manual_intervention
```

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| pending | 已创建任务，等待派发 | 任务分解完成 |
| dispatched | Prompt 已发送给 agent | 总调度派发 |
| running | agent 正在执行 | agent 开始返回 |
| completed | agent 返回且验收通过 | 验收标准全部满足 |
| failed | agent 执行出错 | 运行异常 |
| retrying | 失败后重试中 | 可恢复错误 |
| blocked | 无法继续，需人工介入 | 阻塞级问题未解决 |
| cancelled | 任务被取消 | 依赖任务失败/取消 |
| skipped | 任务被跳过 | 条件不满足 |

### 5.3 任务分配与优先级管理

#### 5.3.1 Agent 类型选择矩阵

| 任务类型 | 首选 Agent | 备选 Agent | 选择依据 |
|---------|-----------|-----------|---------|
| 需求规格生成 | nextjs-spec-generator | general_purpose_task | 专业模板支持 |
| 需求规格评审 | nextjs-spec-reviewer | general_purpose_task | 评审角色隔离 |
| 架构设计 | nextjs-architect | general_purpose_task | 技术选型能力 |
| 前端组件开发 | nextjs-frontend-expert | general_purpose_task | React/Next.js 专业 |
| 后端 API 开发 | nextjs-backend-expert | general_purpose_task | Server Action/Route Handler |
| 数据库建模 | ts-nextjs-db-modeler | nextjs-backend-expert | ORM/Schema 专业 |
| 测试编写 | nextjs-testing-expert | general_purpose_task | 测试框架专业 |
| 性能优化 | nextjs-performance-optimizer | general_purpose_task | Core Web Vitals 专业 |
| DevOps/部署 | nextjs-devops-expert | general_purpose_task | CI/CD 专业 |
| 调试排障 | general_purpose_task | 对应专业 agent | 通用问题解决 |
| 代码审查 | general_purpose_task | 对应专业 agent | 跨领域审查 |

#### 5.3.2 优先级定义

| 优先级 | 定义 | 调度策略 |
|--------|------|---------|
| P0-紧急 | 阻塞主流程的 Bug、数据丢失风险 | 立即调度，可中断低优先级任务 |
| P1-高 | 核心功能开发、关键 spec 生成 | 优先调度，并行执行 |
| P2-中 | 增强功能、测试补充、文档更新 | 按计划调度 |
| P3-低 | 代码优化、重构、技术债清理 | 空闲时调度 |

#### 5.3.3 任务分配规则

| 规则 | 说明 |
|------|------|
| 一任务一 agent | 一个原子任务只分配给一个 agent 实例 |
| 同类并行 | 同类型独立任务可分配给多个同类 agent 实例并行 |
| 依赖串行 | 有依赖关系的任务必须按依赖顺序执行 |
| 负载均衡 | 避免单个 agent 承担过多任务（建议单 agent 同时处理 ≤ 3 个任务） |
| 能力匹配 | 任务复杂度与 agent 能力匹配（专业任务用专业 agent） |

#### 5.3.4 任务拆分原则

```
任务拆分粒度判断：
├─ 可独立验收？ → 否 → 继续拆分
├─ 单 agent 可完成？ → 否 → 继续拆分
├─ 输入输出明确？ → 否 → 继续拆分
├─ 预计执行时间合理？ → 否 → 继续拆分
└─ 全部是 → 原子任务，可调度
```

### 5.4 故障恢复与重试机制

#### 5.4.1 故障分类与处理

| 故障类型 | 表现 | 处理策略 |
|---------|------|---------|
| 瞬时错误 | 网络超时、工具调用偶发失败 | 自动重试（最多 3 次，指数退避） |
| 参数错误 | Prompt 参数填错、路径不存在 | 修正参数后重新派发 |
| 上下文不足 | agent 无法获取必要信息 | 补充输入文件后重新派发 |
| 逻辑错误 | agent 产出不符合验收标准 | 分析原因，修订 Prompt 后重新派发 |
| 阻塞问题 | 存在无法自动解决的阻塞 | 标记 blocked，请求人工介入 |

#### 5.4.2 重试策略

```
重试决策流程：
├─ 第1次失败 → 分析错误类型
│   ├─ 瞬时错误 → 自动重试（间隔 5s）
│   ├─ 参数错误 → 修正参数后重试
│   └─ 逻辑错误 → 修订 Prompt 后重试
├─ 第2次失败 → 重新分析
│   ├─ 瞬时错误 → 自动重试（间隔 15s）
│   └─ 其他 → 升级处理
├─ 第3次失败 → 标记 blocked
│   └─ 请求人工介入，提供失败原因与上下文
```

#### 5.4.3 超时处理

| 任务类型 | 建议超时 | 超时处理 |
|---------|---------|---------|
| 文件读取/写入 | 30s | 重试 1 次后报告 |
| spec 生成 | 5min | 超时中止，检查上下文是否过大 |
| 代码开发 | 10min | 超时中止，拆分任务后重新调度 |
| 测试运行 | 5min | 超时中止，检查是否有死循环测试 |
| 构建/部署 | 15min | 超时中止，检查资源与配置 |

> **超时值依据**：以上超时值为基于 Trae IDE 多 agent 实践经验的建议值。实际项目中应根据任务复杂度、上下文大小、模型能力调整。若频繁超时，应优先检查上下文是否过大（P2）或任务拆分是否过粗（5.3.4）。

### 5.5 多阶段调度编排

#### 5.5.1 调度方案文件结构

多阶段调度必须先编写调度方案文件，结构如下：

```markdown
# {项目名} {阶段}阶段 {任务}调度 Prompt 方案

> 用途：总调度 agent 指挥子 agent 的标准化 prompt
> 范围：{阶段覆盖范围}
> 拆分粒度：{拆分策略}
> 评审策略：{轮次与修订策略}

## 一、任务拆分方案
（表格：Spec/任务 | 覆盖范围 | 框架文档章节 | 参考项目 | 优先级）

## 二、调度架构
（流程图：阶段N [并行/串行] N× agent → 产出）

## 三、参考项目读取流程（共用）
（四步法，见 2.2 P2）

## 四、Prompt A — {第一阶段名称}
### 一、通用模板
### 二、参数填充表

## 五、Prompt B — {第二阶段名称}
（同上）

## 六、调度执行顺序
（Step 1-N，标注并行/串行 + 验证条件 + 超时设置）

## 七、关键设计要点
（并行度、上下文隔离、版本控制、故障恢复等说明）

## 八、文件清单（预期产出）
```

#### 5.5.2 并行与串行规则

| 规则 | 说明 |
|------|------|
| 同阶段并行 | 同一阶段内多个独立任务并行执行（如 3 个 spec 同时生成） |
| 阶段间串行 | 上一阶段全部完成且验证通过后，才启动下一阶段 |
| 等待机制 | 每阶段等待所有并行任务完成，取最慢任务耗时 |
| 验证点 | 每阶段结束必须验证产出（文件存在、版本号正确、状态正确） |
| 失败隔离 | 单个任务失败不阻塞同阶段其他独立任务 |

#### 5.5.3 评审轮次控制

| 策略 | 说明 |
|------|------|
| Spec 最大轮次 | 默认最多 2 轮评审 + 2 轮修订（r1→v1.1→r2→v1.2→终审） |
| 架构最大轮次 | 默认最多 2 轮评审 + 2 轮修订（ar1→v1.1→ar2→v1.2→终审） |
| 阻塞兜底 | 终审仍未通过则标记阻塞，不无限循环 |
| 终审约束 | 终审仅核查最后一轮阻塞问题，不发现新问题（防止无限循环） |
| 提前通过 | 若 r1/ar1 即无阻塞且无重要问题，可提前 approved（跳过 r2/ar2） |
| 架构 FR 覆盖 | 架构终审额外核查 FR 覆盖率必须 100%，任何遗漏视为阻塞 |

#### 5.5.4 回滚机制

当已 approved 的文件需要重新打开时，遵循以下流程：

```
回滚触发条件
  ├─ 1. 开发阶段发现 spec/架构设计有根本性缺陷
  ├─ 2. 测试阶段发现需求遗漏
  └─ 3. 人工审查发现 approved 文件存在阻塞级问题
```

| 步骤 | 操作 | 状态变更 |
|------|------|---------|
| 1. 发起回滚 | 总调度确认回滚必要性 | approved → rollback-requested |
| 2. 影响评估 | 评估回滚影响的下游任务（已开发的代码、已编写的测试） | — |
| 3. 状态回退 | 将文件状态改为 draft，版本号 minor+1 | rollback-requested → draft |
| 4. 修订 | 重新走"修订→评审→终审"流程 | draft → (评审循环) → approved |
| 5. 下游同步 | 通知受影响的下游任务暂停或回滚 | — |

**硬性约束**：
1. 回滚必须由总调度决策，子 agent 不可自行回滚
2. 回滚后必须重新走完整评审闭环（不可跳过评审直接 approved）
3. 回滚操作必须在文件变更记录中记录：`v{VERSION} | 日期 | 回滚原因：{原因}`
4. 已基于旧 approved 版本开发的代码，需评估是否需要同步修改

---

## 六、MCP 工具集成规范

### 6.1 MCP 工具触发条件

MCP（Model Context Protocol）工具用于扩展 agent 能力，在以下场景自动触发：

| 触发场景 | 推荐工具 | 触发条件 |
|---------|---------|---------|
| UI 设计稿生成/修改 | pencil | 需要创建或修改可视化设计稿时 |
| 第三方库文档查询 | context7 | 需要查询未包含在项目中的库 API 时 |
| 文件系统操作 | filesystem | 需要批量读取/写入/搜索文件时 |
| 数据库操作 | 数据库 MCP | 需要直接查询或修改数据库时 |
| 外部 API 调用 | 对应 API MCP | 需要调用外部服务时 |

#### 6.1.1 自动触发判断流程

```
任务分析
├─ 是否需要可视化设计？ → 是 → 触发 pencil
├─ 是否需要查询第三方库 API？ → 是 → 触发 context7
├─ 是否需要批量文件操作？ → 是 → 触发 filesystem
├─ 是否需要数据库交互？ → 是 → 触发数据库 MCP
├─ 是否需要外部服务调用？ → 是 → 触发对应 API MCP
└─ 以上均否 → 不调用 MCP 工具，使用内置工具
```

### 6.2 参数配置规范

#### 6.2.1 参数来源原则

| 参数类别 | 来源 | 说明 |
|---------|------|------|
| 路径参数 | Prompt 中显式指定 | 禁止 agent 自行猜测路径 |
| 内容参数 | 从输入文件读取 | 禁止 agent 凭空生成内容 |
| 配置参数 | 从 .trae/rules/ 读取 | 遵循项目规范 |
| 动态参数 | 上游 agent 产出 | 通过文件系统传递 |

#### 6.2.2 参数校验规则

调用 MCP 工具前必须校验参数：

- [ ] 必填参数是否齐全
- [ ] 路径参数是否实际存在
- [ ] 类型参数是否符合工具 schema
- [ ] 内容参数是否在合理范围内

#### 6.2.3 工具调用模板

Prompt 中声明 MCP 工具调用的标准格式：

```
【MCP 工具】
1. {TOOL_NAME}
   - 触发条件：{WHEN_TO_CALL}
   - 参数来源：{PARAM_SOURCE}
   - 预期结果：{EXPECTED_RESULT}
   - 错误处理：{ERROR_STRATEGY}
```

### 6.3 结果处理流程

#### 6.3.1 结果处理标准流程

```
工具调用返回
  ├─ 1. 结果校验：核对返回数据是否符合预期 schema
  ├─ 2. 错误检测：检查是否有错误信息
  │     ├─ 有错误 → 进入错误恢复流程（6.4）
  │     └─ 无错误 → 继续
  ├─ 3. 结果存储：将结果写入指定文件或变量
  ├─ 4. 结果摘要：提取关键信息，纳入返回摘要
  └─ 5. 后续动作：根据结果决定是否触发下一步
```

#### 6.3.2 结果存储规范

| 结果类型 | 存储方式 | 说明 |
|---------|---------|------|
| 设计稿 | 写入 .pen 文件或指定路径 | pencil 产出 |
| 文档内容 | 写入 docs/ 目录 | context7 产出 |
| 文件列表 | 直接用于后续操作 | filesystem 产出 |
| 查询结果 | 写入临时文件或直接使用 | 数据库/API 产出 |

#### 6.3.3 结果摘要要求

工具调用后，agent 必须在返回摘要中包含：

```
MCP 工具调用清单：
- 工具名称：{TOOL_NAME}
- 调用次数：{COUNT}
- 是否成功：{SUCCESS/FAILED}
- 关键产出：{OUTPUT_SUMMARY}
- 耗时：{DURATION}（如可获取）
```

### 6.4 错误恢复机制

#### 6.4.1 错误分类与恢复策略

| 错误类型 | 表现 | 恢复策略 |
|---------|------|---------|
| 参数错误 | 必填参数缺失、类型不匹配 | 校验参数后重新调用（最多 2 次） |
| 权限错误 | 无访问权限、认证失败 | 中止调用，报告总调度 |
| 超时错误 | 工具响应超时 | 重试 1 次（间隔 10s），仍失败则降级 |
| 资源错误 | 文件不存在、磁盘空间不足 | 检查资源后重试或降级 |
| 逻辑错误 | 工具执行完成但结果异常 | 分析错误原因，调整参数后重试 |
| 服务不可用 | MCP 服务未启动或崩溃 | 降级为内置工具或中止任务 |

#### 6.4.2 降级策略

当 MCP 工具不可用时，按以下优先级降级：

```
MCP 工具不可用
  ├─ 1. 尝试内置工具替代
  │     ├─ filesystem → Read/Write/Glob/Grep
  │     ├─ context7 → WebSearch/WebFetch
  │     └─ pencil → 文字描述设计意图
  ├─ 2. 内置工具无法替代 → 报告总调度
  └─ 3. 总调度决定：中止任务或人工介入
```

#### 6.4.3 错误报告格式

工具调用失败时，agent 必须返回结构化错误报告：

```
MCP 工具调用失败：
- 工具名称：{TOOL_NAME}
- 错误类型：{ERROR_TYPE}
- 错误信息：{ERROR_MESSAGE}
- 已尝试恢复：{RECOVERY_ATTEMPTS}
- 当前状态：{BLOCKED/DEGRADED/RETRYING}
- 建议处理：{SUGGESTED_ACTION}
```

### 6.5 常用 MCP 工具速查

#### 6.5.1 pencil（UI 设计）

| 属性 | 说明 |
|------|------|
| 用途 | 创建/修改可视化设计稿 |
| 触发条件 | 需要生成页面 UI 设计、组件设计稿 |
| 关键参数 | 设计类型、页面尺寸、风格指引 |
| 结果处理 | 生成 .pen 文件，返回设计稿路径 |
| 错误恢复 | 降级为文字描述设计意图 |

#### 6.5.2 context7（库文档查询）

| 属性 | 说明 |
|------|------|
| 用途 | 查询第三方库的最新文档与 API |
| 触发条件 | 需要使用项目未包含的库、查询库的最新用法 |
| 关键参数 | 库名称、版本、查询关键词 |
| 结果处理 | 提取相关 API 说明，写入临时文档或直接使用 |
| 错误恢复 | 降级为 WebSearch 查询官方文档 |

#### 6.5.3 filesystem（文件系统）

| 属性 | 说明 |
|------|------|
| 用途 | 批量文件读取、写入、搜索 |
| 触发条件 | 需要批量操作文件（超过内置工具效率时） |
| 关键参数 | 操作类型、路径模式、内容 |
| 结果处理 | 返回操作结果清单 |
| 错误恢复 | 降级为内置 Read/Write/Glob/Grep |

---

## 七、编码质量保障

> **与 `.trae/rules/` 的边界**：本章定义 Prompt 中**应声明的质量约束和验证流程**，确保子 agent 知道"必须达到什么标准"。具体的代码风格细则、命名规则等由 `.trae/rules/global/` 和 `.trae/rules/dev/` 定义。本章不重复 `.trae/rules/` 的内容，仅定义 Prompt 层面的质量要求和验证方法。

### 7.1 代码质量标准

#### 7.1.1 必须满足的硬性标准

| 标准编号 | 标准 | 验证方法 |
|---------|------|---------|
| Q1 | TypeScript 严格模式无错误 | `npx tsc --noEmit` 退出码 0 |
| Q2 | ESLint 无警告无错误 | `npm run lint` 退出码 0 |
| Q3 | 禁止使用 `any` 类型 | Grep 搜索 `\bany\b` 无结果（注释除外） |
| Q4 | 禁止使用 `@ts-ignore` / `@ts-expect-error` | Grep 搜索无结果 |
| Q5 | 禁止跨模块 `../` 引用 | Grep 搜索 `from '\.\./'` 无结果 |
| Q6 | 单文件 ≤ 500 行 | `wc -l` 检查 |
| Q7 | 页面文件 ≤ 300 行 | `wc -l` 检查 |
| Q8 | 所有函数有显式返回类型 | TypeScript 配置 + 代码审查 |
| Q9 | 所有公共 API 有 JSDoc 注释 | 代码审查 |
| Q10 | 核心业务逻辑有测试覆盖 | 测试覆盖率报告 |

#### 7.1.2 Next.js 特定标准

| 标准编号 | 标准 | 说明 |
|---------|------|------|
| N1 | Server Component 优先 | 仅在需要交互时使用 Client Component |
| N2 | 数据变更通过 Server Action | 禁止客户端直接调用数据库 |
| N3 | 输入验证使用 Zod | 所有 Server Action 输入必须验证 |
| N4 | 服务层返回统一格式 | `ServiceResult<T>` 或项目约定格式 |
| N5 | 使用 `@/` 绝对路径导入 | 禁止 `../` 相对路径 |
| N6 | 图标统一使用 lucide-react | 禁止内联 SVG（除非必要） |
| N7 | 环境变量分层管理 | 服务端/客户端环境变量分离 |
| N8 | Metadata API 配置 SEO | 禁止手动操作 `<head>` |

### 7.2 代码风格要求

#### 7.2.1 命名规范

| 对象 | 规范 | 示例 |
|------|------|------|
| 文件名（组件） | PascalCase | `UserProfile.tsx` |
| 文件名（工具/服务） | kebab-case | `auth-service.ts` |
| 文件名（测试） | `{name}.test.ts` | `auth-service.test.ts` |
| 变量/函数 | camelCase | `getUserById` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase | `UserProfile` |
| 枚举 | PascalCase + PascalCase 成员 | `UserRole.Admin` |
| CSS 类名 | kebab-case | `user-profile-card` |
| 环境变量 | UPPER_SNAKE_CASE | `DATABASE_URL` |

#### 7.2.2 代码组织规范

```
组件文件结构（按顺序）：
1. import 语句（按：React → 第三方 → 项目内部分组，组间空行）
2. 类型/接口定义
3. 常量定义
4. 组件实现
5. 子组件（如有）
6. 导出（如需）
```

```typescript
// 正例
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UserProfileProps {
  userId: string;
}

const MAX_AVATAR_SIZE = 1024;

export function UserProfile({ userId }: UserProfileProps) {
  // ...
}
```

#### 7.2.3 注释规范

| 注释类型 | 使用场景 | 规范 |
|---------|---------|------|
| JSDoc | 公共 API、复杂函数 | 必须包含 @param @returns @throws |
| 行内注释 | 复杂逻辑说明 | 解释"为什么"而非"做什么" |
| TODO | 待办事项 | `// TODO: {描述} — {负责人} {日期}` |
| FIXME | 已知缺陷 | `// FIXME: {描述} — {影响范围}` |

**禁止**：
- 显而易见的注释（如 `// 获取用户` 在 `getUser` 函数上）
- 被注释掉的代码（使用 git 管理历史）
- 过时的注释（代码变更后未更新注释）

### 7.3 最佳实践遵循方法

#### 7.3.1 React 最佳实践

| 实践 | 要求 | 示例 |
|------|------|------|
| 组件单一职责 | 一个组件只做一件事 | 拆分 `UserDashboard` 为 `UserProfile` + `UserStats` + `UserActivity` |
| Props 接口定义 | 所有 props 用 interface 定义 | `interface UserProfileProps { ... }` |
| 受控组件 | 表单使用受控模式 | `value` + `onChange` |
| 错误边界 | 关键组件包裹 ErrorBoundary | 防止整个页面崩溃 |
| Suspense 边界 | 异步组件用 Suspense 包裹 | 提供加载状态 |
| 自定义 Hook | 复用逻辑抽取为 Hook | `useAuth`、`useDebounce` |

#### 7.3.2 Next.js App Router 最佳实践

| 实践 | 要求 |
|------|------|
| Server Component 默认 | 仅在需要交互/状态/浏览器 API 时加 `'use client'` |
| 数据获取在 Server Component | 利用 RSC 的流式渲染 |
| 动态路由用 `generateStaticParams` | 静态生成优先 |
| Metadata API | 用 `generateMetadata` 配置动态 SEO |
| Loading UI | 每个路由段提供 `loading.tsx` |
| Error UI | 每个路由段提供 `error.tsx` |
| Route Groups | 用 `(group)` 组织路由，不影响 URL |

#### 7.3.3 TypeScript 最佳实践

| 实践 | 要求 |
|------|------|
| 严格模式 | `tsconfig.json` 中 `strict: true` |
| 禁止 any | 用 `unknown` 替代不确定类型 |
| 类型推导 | 能推导的不显式声明（变量），函数返回值显式声明 |
| 联合类型 | 优先用联合类型而非枚举（字符串字面量联合） |
| 类型守卫 | 用 `typeof`/`in`/自定义守卫收窄类型 |
| 泛型约束 | 泛型加 `extends` 约束 |

#### 7.3.4 安全最佳实践

| 实践 | 要求 |
|------|------|
| 输入验证 | 所有外部输入用 Zod 验证 |
| SQL 注入防护 | 使用 ORM 参数化查询，禁止拼接 SQL |
| XSS 防护 | 禁止 `dangerouslySetInnerHTML` 未净化 |
| CSRF 防护 | Server Action 自带 CSRF 令牌 |
| 敏感数据 | 禁止硬编码密钥，使用环境变量 |
| 日志安全 | 禁止日志输出 Token/密码/Session ID |

### 7.4 验证流程

#### 7.4.1 开发完成验证清单

每个开发任务完成后，agent 必须执行以下验证：

```
验证流程（按顺序执行）：
├─ 1. 类型检查：npx tsc --noEmit
│     └─ 退出码必须为 0
├─ 2. 代码规范：npm run lint
│     └─ 无警告无错误
├─ 3. 单元测试：npm test
│     └─ 全部通过
├─ 4. 构建：npm run build
│     └─ 构建成功
├─ 5. 功能验证：核对 spec 中的 FR
│     └─ 所有 FR 已实现
└─ 6. 验收标准：核对 Prompt 中的 AC
      └─ 所有 AC 已满足
```

#### 7.4.2 验证结果报告

```
验证结果：
- 类型检查：✅ 通过 / ❌ 失败（{错误数} 个错误）
- 代码规范：✅ 通过 / ❌ 失败（{警告数} 个警告）
- 单元测试：✅ 通过 / ❌ 失败（{失败数}/{总数}）
- 构建：✅ 成功 / ❌ 失败
- 功能实现：✅ {已实现数}/{总数} FR
- 验收标准：✅ {已满足数}/{总数} AC
```

### 7.5 代码审查清单

#### 7.5.1 自动审查清单

代码审查 agent 必须逐项检查：

- [ ] **类型安全**：无 `any`、无 `@ts-ignore`、函数有返回类型
- [ ] **导入规范**：使用 `@/` 绝对路径、无 `../` 跨模块引用
- [ ] **命名规范**：符合 7.2.1 命名规范
- [ ] **文件大小**：单文件 ≤ 500 行、页面文件 ≤ 300 行
- [ ] **组件规范**：Server Component 优先、Props 有 interface
- [ ] **输入验证**：Server Action 输入用 Zod 验证
- [ ] **安全合规**：无硬编码密钥、无敏感信息日志
- [ ] **错误处理**：有 try-catch、有错误码
- [ ] **测试覆盖**：核心逻辑有测试
- [ ] **注释完整**：公共 API 有 JSDoc

#### 7.5.2 审查问题分级

| 级别 | 定义 | 示例 | 处理要求 |
|------|------|------|---------|
| 阻塞 | 违反硬性标准、有安全风险 | 使用 `any`、硬编码密钥 | 必须修复后才能合并 |
| 重要 | 影响质量但不阻断 | 缺少测试、命名不规范 | 必须修复或给出理由 |
| 建议 | 改进性质 | 可提取复用 Hook、优化性能 | 酌情采纳 |

---

## 八、最佳实践指南

### 8.1 Prompt 编写流程

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
  └─ 从 P9 安全优先表选择安全约束

Step 6: 声明 MCP 工具（如涉及）
  └─ 按 6.2.3 工具调用模板声明
  └─ 指定触发条件、参数来源、错误处理

Step 7: 编写验收标准
  └─ 每条必须可执行检查（P4 可验证性）
  └─ 数量 4-8 条

Step 8: 自检
  └─ 对照第九章质量评估标准逐项检查
  └─ 对照 8.2 避坑清单核对

Step 9: 发送并跟踪
  └─ 发送给子 agent
  └─ 接收返回摘要，核对验收标准
  └─ 未通过则迭代修订 Prompt
```

### 8.2 避坑清单

| 编号 | 坑点 | 规避措施 |
|------|------|---------|
| T1 | Prompt 引用了不存在的文件 | 发送前用 `ls` 核对路径存在性（P8） |
| T2 | 框架文档全量加载导致上下文爆炸 | 必须指定 §章节号，禁止全量读取（P2） |
| T3 | 参数填错章节号 | 参数表与框架文档目录交叉核对 |
| T4 | 归档项目被误参考 | 所有 Prompt 显式声明禁止归档目录（P6） |
| T5 | reviewer 直接改了 spec 正文 | Prompt B 显式声明"禁止修改 spec 正文" |
| T6 | 修订时新建了版本文件 | Prompt C 显式声明"禁止新建文件，在原文件修订" |
| T7 | 版本号文件名与内部不一致 | 始终单文件，文件名不变，版本号写在文件内部 |
| T8 | 并行任务间相互依赖导致死锁 | 同阶段任务必须独立无依赖，有依赖则拆到不同阶段 |
| T9 | 终审发现新问题导致无限循环 | 终审仅核查阻塞问题解决情况，不发现新问题 |
| T10 | 子 agent 返回信息不足无法决策 | Prompt 末尾必须指定返回格式（P7） |
| T11 | spec 未 approved 就进入开发 | 架构设计/开发 Prompt 显式声明"输入必须是 approved 状态" |
| T12 | 参考项目代码被照搬 | 所有涉及参考项目的 Prompt 声明"仅参考架构模式，禁止照搬代码" |
| T13 | 硬编码密钥导致安全风险 | 所有代码 Prompt 声明"禁止硬编码密钥，使用环境变量"（P9） |
| T14 | MCP 工具调用失败未处理 | Prompt 中声明错误恢复策略（P10） |
| T15 | Agent 间直接通信导致状态混乱 | 所有跨 agent 数据传递通过文件系统 |
| T16 | 任务拆分过细导致调度开销过大 | 遵循 5.3.4 任务拆分原则 |
| T17 | 重试无限制导致资源浪费 | 遵循 5.4.2 重试策略，最多 3 次 |
| T18 | 代码审查遗漏安全项 | 使用 7.5.1 自动审查清单逐项检查 |
| T19 | 架构设计未评审直接进入开发 | 架构设计必须经过 4.2.2 评审 + 4.2.4 终审，approved 后才可开发 |
| T20 | 架构设计遗漏 spec 的 FR | 架构终审（4.2.4）必须核查 FR 覆盖率 100% |

### 8.3 Prompt 演进管理

| 场景 | 操作 |
|------|------|
| 新增场景模板 | 在第四章新增小节，更新目录 |
| 修改现有模板 | 直接修改，更新文档版本号 |
| 废弃模板 | 标记为 `[已废弃]`，保留一个版本周期后删除 |
| 实践发现新坑点 | 补充到 8.2 避坑清单 |
| 规则文件变动 | 同步更新 Prompt 中引用的规则文件路径 |
| 新增 MCP 工具 | 在 6.5 常用工具速查新增条目 |
| 新增 Agent 类型 | 更新 11.1 映射表，必要时新增场景模板 |

### 8.4 上下文窗口优化策略

#### 8.4.1 上下文预算管理

| 上下文类型 | 建议占比 | 说明 |
|---------|---------|------|
| 系统规则 | 10-15% | .trae/rules/ 文件 |
| 任务输入 | 30-40% | spec/架构/代码文件 |
| 参考信息 | 20-30% | 参考项目/库文档 |
| 历史对话 | 10-15% | 多轮交互历史 |
| 输出预留 | 20-25% | 预留给 agent 产出 |

> **预算比例依据**：以上比例为基于 Trae IDE 实践经验的建议值，非理论推导。核心原则是：任务输入占比最大（30-40%），输出预留不少于 20%，系统规则不超过 15%。实际项目中应根据文档大小和任务复杂度调整。

#### 8.4.2 优化技巧

| 技巧 | 说明 |
|------|------|
| 章节级读取 | 大文档只读必要章节（P2） |
| 摘要传递 | 上游 agent 返回摘要而非全文 |
| 文件分片 | 超大文件按模块分片读取 |
| 按需加载 | 先读目录/索引，再按需读详情 |
| 工具替代 | 用 MCP 工具按需检索替代全量加载 |
| 历史压缩 | 长对话定期压缩历史消息 |

---

## 九、质量评估标准

### 9.1 Prompt 质量评估维度

每个 Prompt 发送前，总调度应对照以下维度自检：

| 维度 | 检查项 | 权重 |
|------|--------|:----:|
| **完整性** | 四要素齐全（任务/输入/输出/约束） | 高 |
| **准确性** | 文件路径、章节号、版本号与磁盘一致 | 高 |
| **明确性** | 无模糊表述，每条要求可执行 | 高 |
| **隔离性** | 大文档指定章节，未全量加载 | 高 |
| **合规性** | 显式声明禁止事项（安全约束等） | 高 |
| **安全性** | 显式声明安全约束（P9） | 高 |
| **可验证性** | 验收标准可执行检查 | 中 |
| **参数化** | 可变内容用占位符，有参数表 | 中 |
| **闭环性** | 要求返回结构化摘要 | 中 |
| **工具声明** | MCP 工具调用有完整声明 | 中 |

### 9.2 质量等级

| 等级 | 标准 | 处理 |
|------|------|------|
| A（优秀） | 全部维度达标，无避坑清单问题 | 直接发送 |
| B（合格） | 高权重维度全部达标，中权重有 ≤ 1 项未达标 | 可发送，记录改进点 |
| C（需修改） | 高权重维度有未达标项 | 修改后重新评估 |
| D（不合格） | 多项高权重未达标，或命中避坑清单 | 重新编写 |

### 9.3 Prompt 方案文件评审检查清单

评审一个 Prompt 方案文件时，逐项核对：

- [ ] **结构完整**：包含任务拆分、调度架构、参考项目流程、Prompt 模板、执行顺序、文件清单
- [ ] **模板规范**：每个 Prompt 模板符合第三章标准格式（四要素齐全）
- [ ] **参数表齐全**：每个 Prompt 模板有对应参数填充表
- [ ] **路径准确**：所有文件路径与磁盘实际一致（无不存在文件）
- [ ] **章节准确**：框架文档章节号与实际目录一致
- [ ] **合规声明**：所有 Prompt 显式声明归档项目禁止、参考项目仅参考模式
- [ ] **安全声明**：所有代码 Prompt 显式声明安全约束
- [ ] **版本控制**：spec/架构修订遵循单文件原则，版本号内部递增
- [ ] **评审隔离**：reviewer 只输出意见，不改正文（spec 和架构均适用）
- [ ] **架构闭环**：架构设计包含生成→评审→修订→终审完整流程（4.2.1-4.2.4）
- [ ] **阻塞兜底**：有最大轮次限制和终审约束（spec 和架构均适用）
- [ ] **并行独立**：同阶段并行任务无相互依赖
- [ ] **验证点**：每阶段有明确的产出验证条件
- [ ] **故障恢复**：有重试策略和超时处理
- [ ] **工具声明**：MCP 工具调用有完整声明（如涉及）
- [ ] **避坑核对**：对照 8.2 避坑清单逐项排查

### 9.4 子 agent 产出质量评估

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
| 类型检查 | `npx tsc --noEmit` 通过 |
| 代码规范 | `npm run lint` 通过 |
| 测试通过 | `npm test` 通过 |
| 验收标准达标 | 逐条核对 Prompt 中的验收标准 |

---

## 十、与 `.trae/rules/` 的关系

### 10.1 职责划分

| 规范体系 | 约束对象 | 文件位置 | 加载方式 |
|---------|---------|---------|---------|
| `.trae/rules/` | **产出物**（代码、spec、API、部署） | `.trae/rules/**/*.md` | 子 agent 启动时按角色加载 |
| 本规范 | **输入指令**（Prompt 设计） | `docs/AI-Prompt使用规范.md` | 总调度设计 Prompt 时参考 |

### 10.2 协作关系

```
总调度 agent
  ├─ 读取本规范 → 设计符合标准的 Prompt
  │
  └─ 发送 Prompt 给子 agent
       ├─ Prompt 中指定【必读规则文件】→ 子 agent 加载 .trae/rules/
       ├─ Prompt 中指定【MCP 工具】→ 子 agent 按声明调用工具
       ├─ 子 agent 按规则约束产出代码/spec/API
       └─ 子 agent 返回结构化摘要 → 总调度决策
```

### 10.3 规则文件引用速查

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

## 十一、附录

### 11.1 Agent 类型与场景映射

| Agent 类型 | 适用场景模板 | 对应 Prompt 章节 |
|-----------|-------------|-----------------|
| `nextjs-spec-generator` | Spec 生成 / Spec 修订 | 4.1.1 / 4.1.3 |
| `nextjs-spec-reviewer` | Spec 评审 | 4.1.2 |
| `nextjs-architect` | 架构设计生成 / 架构设计修订 | 4.2.1 / 4.2.3 |
| `general_purpose_task` | 架构设计评审 / 调试排障 / 代码审查 | 4.2.2 / 4.5 / 4.6 |
| `nextjs-frontend-expert` | 开发实施（前端） | 4.3 |
| `nextjs-backend-expert` | 开发实施（后端） | 4.3 |
| `ts-nextjs-db-modeler` | 开发实施（数据库） | 4.3 |
| `nextjs-testing-expert` | 测试编写 | 4.4 |
| `nextjs-performance-optimizer` | 性能优化 | 4.7 |
| `nextjs-devops-expert` | CI/CD / 部署 | 基于开发实施模板适配 |
| 总调度 agent（主对话） | Spec 终审 / 架构终审 / 调度编排 | 4.1.4 / 4.2.4 / 第五章 |

### 11.2 严重程度定义

| 级别 | 定义 | 处理要求 |
|------|------|---------|
| 阻塞 | 导致无法进入下一阶段的问题 | 必须解决，否则标记阻塞 |
| 重要 | 影响质量但不阻断流程的问题 | 必须解决或给出不解决的理由 |
| 建议 | 改进性质的建议 | 酌情采纳 |

### 11.3 文件状态定义

| 状态 | 含义 | 允许的操作 |
|------|------|-----------|
| draft | 草稿，未通过评审 | 可修改，禁止用于实施 |
| in-review | 评审中 | 等待评审结果 |
| approved | 已通过评审 | 禁止修改，可作为下游输入 |
| 阻塞 | 终审未通过 | 列出剩余问题，人工介入 |

### 11.4 版本号规则

| 对象 | 规则 | 示例 |
|------|------|------|
| Spec 文件 | `v{major}.{minor}`，初稿 v1.0，每轮修订 minor+1 | v1.0 → v1.1 → v1.2 |
| 架构设计文件 | 同 Spec | v1.0 → v1.1 |
| 评审文件 | `r{轮次}`，从 r1 递增 | r1, r2 |
| 本规范文档 | `v{major}.{minor}`，重大修订 major+1 | v2.0 |

### 11.5 参数填充速查表

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
| `{OUTPUT_PATH}` | 输出文件路径 | `{PROJECT_ROOT}/docs/specs/spec-auth-system-v1.0.md` |
| `{PROJECT_ROOT}` | 项目根目录绝对路径 | /home/user/my-app |
| `{REFERENCE_ROOT}` | 参考项目根目录 | `_reference` |
| `{TECH_STACK}` | 项目技术栈 | Next.js 15 + Drizzle + next-auth |
| `{SPEC_COUNT}` | spec 总数 | 3 |
| `{SPEC_FILE_LIST}` | spec 文件清单 | spec-auth-system-v1.2.md 等 |
| `{REVIEW_FILE_LIST}` | 评审文件清单 | spec-auth-system-review-r2.md 等 |
| `{TOOL_NAME}` | MCP 工具名称 | pencil / context7 |
| `{FEATURE_NAME}` | 功能名称 | 用户认证与授权 |
| `{MODULE_NAME}` | 模块名称 | 认证模块 |
| `{PROBLEM_DESCRIPTION}` | 问题描述 | 登录后跳转 404 |
| `{ERROR_OUTPUT}` | 错误输出 | Error: Cannot read property... |
| `{REPRO_STEPS}` | 复现步骤 | 1. 访问 /login 2. 输入... |
| `{RELATED_FILES}` | 相关文件清单 | src/app/login/page.tsx 等 |
| `{CHANGED_FILES}` | 变更文件清单 | src/app/login/page.tsx 等 |
| `{APPROVED_SPEC_FILES}` | 已 approved 的 spec 文件 | spec-auth-system-v1.2.md |
| `{APPROVED_ARCH_FILE}` | 已 approved 的架构文件 | arch-auth-system-v1.0.md |
| `{APPROVED_SPEC_FILE}` | 对应的 spec 文件 | spec-auth-system-v1.2.md |
| `{SOURCE_FILES}` | 被测代码文件 | src/lib/auth-service.ts |
| `{SOURCE_DIR}` | 源码目录 | src/lib |
| `{TEST_PATHS}` | 测试文件路径 | src/lib/__tests__/auth-service.test.ts |
| `{OUTPUT_PATHS}` | 代码文件路径 | src/app/login/page.tsx |
| `{TARGET_AREA}` | 性能优化目标 | 首页加载性能 |
| `{PERFORMANCE_REPORT}` | 性能报告 | Lighthouse 报告路径 |

### 11.6 MCP 工具速查表

| 工具名称 | 用途 | 触发条件 | 降级方案 |
|---------|------|---------|---------|
| pencil | UI 设计稿生成/修改 | 需要可视化设计 | 文字描述设计意图 |
| context7 | 第三方库文档查询 | 查询库 API | WebSearch 查询官方文档 |
| filesystem | 批量文件操作 | 超过内置工具效率 | 内置 Read/Write/Glob/Grep |

### 11.7 术语表

| 术语 | 英文 | 说明 |
|------|------|------|
| 需求规格文档 | spec | 描述功能需求、非功能需求、验收标准的文档 |
| 功能需求 | FR (Functional Requirement) | 编号为 FR-001、FR-002... 的需求项 |
| 验收标准 | AC (Acceptance Criteria) | 编号为 AC-001、AC-002... 的可测试条件 |
| 草稿 | draft | 文件初始状态，可修改，禁止用于实施 |
| 评审中 | in-review | 正在评审，等待评审结果 |
| 已批准 | approved | 已通过评审，禁止修改，可作为下游输入 |
| 阻塞 | blocked | 终审未通过，需人工介入 |
| 服务层返回格式 | ServiceResult\<T\> | 统一的 API 返回格式，包含 data/error 字段 |
| 页面对象模型 | POM (Page Object Model) | E2E 测试模式，将页面操作封装为对象 |
| 路由组 | Route Groups | Next.js App Router 中用 `(group)` 组织路由 |
| Server Component | RSC | 在服务端渲染的 React 组件 |
| Client Component | — | 加 `'use client'` 指令的组件，在客户端渲染 |
| Server Action | — | Next.js 中在服务端执行的函数 |
| 模型上下文协议 | MCP (Model Context Protocol) | 扩展 AI agent 能力的工具协议 |
| 总调度 agent | orchestrator | 主对话中的 agent，负责调度子 agent |
| 子 agent | sub-agent | 被调度的专业 agent（如 spec-generator、architect） |
| 里程碑 | milestone | 项目阶段性目标，如 M1、M2 |
| 占位符 | placeholder | Prompt 模板中用 `{UPPER_SNAKE_CASE}` 表示的可变内容 |
| 评审轮次 | round | 评审的序号，如 r1、r2（spec），ar1、ar2（架构） |

### 11.8 端到端实例：M1 阶段 Spec 生成

> 以下展示从项目需求到发送 Prompt A 的完整填充过程，帮助理解如何使用本规范。

**项目背景**：myapp 是一个 Next.js 博客系统，M1 里程碑覆盖"文章管理"模块。

**Step 1：任务拆分**

| Spec | 覆盖范围 | 框架文档章节 | 优先级 |
|------|---------|-------------|--------|
| spec-article-crud | 文章创建/读取/更新/删除 | §2.1、§3.1、§3.5 | P1 |
| spec-article-publish | 文章发布与草稿管理 | §2.1、§3.2 | P1 |

**Step 2：填充参数表**

| 参数 | 值 |
|------|-----|
| `{PROJECT_ROOT}` | /home/user/myapp |
| `{MILESTONE}` | M1 |
| `{SPEC_NAME}` | 文章 CRUD 管理 |
| `{SLUG}` | article-crud |
| `{FRAMEWORK_SECTIONS}` | §2.1、§3.1、§3.5 |
| `{REFERENCE_RELEVANCE_FILES}` | _reference/blog-demo/RELEVANCE.md |

**Step 3：填充 Prompt A 模板（以 spec-article-crud 为例）**

```
你是 nextjs-spec-generator，任务：为项目 M1 阶段生成【文章 CRUD 管理】需求规格文档初稿。

【必读规则文件】
1. /home/user/myapp/.trae/rules/spec/spec-template.md  — spec 正文模板结构
2. /home/user/myapp/.trae/rules/spec/spec-workflow.md  — 工作流与命名规范
3. /home/user/myapp/.trae/rules/global/naming-conventions.md — 命名规范
4. /home/user/myapp/.trae/rules/global/code-style.md   — 代码风格约束

【输入文件】
1. /home/user/myapp/docs/项目框架文档.md
   - 必读章节：§2.1、§3.1、§3.5
   - 仅读取上述章节，不读全文档
2. /home/user/myapp/docs/参考项目对照指引.md
   - 作用：参考项目入口文件
3. _reference/blog-demo/RELEVANCE.md
   - 仅阅读标注的"必看模块"文件

【输出】
- 文件路径：/home/user/myapp/docs/specs/spec-article-crud-v1.0.md
- 状态：draft

【硬性约束】
1. 禁止照搬参考项目代码，仅参考架构模式
2. 所有 FR 编号连续（FR-001、FR-002...）
3. 所有 AC 可测试、可验证
4. 单文件 ≤ 500 行
5. 禁止使用 any 类型

【验收标准】
- 文件已创建在 /home/user/myapp/docs/specs/spec-article-crud-v1.0.md
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 参考项目仅来自对照指引中的保留项目清单

完成后返回：文件路径 + 章节大纲 + FR/AC 数量统计 + 参考项目使用清单。
```

**Step 4：发送并接收返回**

子 agent 返回示例：
```
- 文件路径：/home/user/myapp/docs/specs/spec-article-crud-v1.0.md
- 章节大纲：变更记录 / 背景与目标 / 用户故事(3个) / 功能需求(12条) / 非功能需求(5条) / 边界与排除项 / 验收标准(12条)
- FR 数量：12，AC 数量：12
- 参考项目使用：blog-demo（文章列表分页模式）
```

**Step 5：总调度核对验收标准**

| 验收标准 | 结果 |
|---------|------|
| 文件已创建 | ✅ `ls` 确认存在 |
| 包含必备章节 | ✅ 读取文件头部核对 |
| FR 编号连续 | ✅ Grep 检查 FR-001 到 FR-012 |
| AC 编号连续 | ✅ Grep 检查 AC-001 到 AC-012 |
| 参考项目合规 | ✅ blog-demo 在保留项目清单中 |

**Step 6：进入 Prompt B（评审）**

验收通过后，填充 Prompt B 模板，将 `{ROUND}` 填为 `1`，`{VERSION}` 填为 `v1.0`，发送给 `nextjs-spec-reviewer`。

> 完整的 M1 调度方案文件应按 5.5.1 结构编写，包含所有 spec 的 Prompt A/B/C/D 参数填充表和调度执行顺序。

---

## 十二、文档维护

### 12.1 更新触发条件

| 触发条件 | 操作 |
|---------|------|
| 新增 agent 类型 | 更新 11.1 映射表，必要时新增场景模板 |
| 新增规则文件 | 更新 10.3 引用速查表 |
| 实践发现新坑点 | 补充到 8.2 避坑清单 |
| 调度流程变更 | 更新第五章 Agent 调度机制 |
| 新增 MCP 工具 | 更新第六章和 11.6 速查表 |
| 质量标准调整 | 更新第七章和第九章 |
| 安全要求变更 | 更新 2.2 P9 和 7.3.4 安全最佳实践 |

### 12.2 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-06-20 | 初稿创建，基于项目 spec 调度实践经验 |
| v2.0 | 2026-06-21 | 标准化改造为通用 Next.js 规范；新增 Agent 调度机制、MCP 工具集成、编码质量保障、上下文优化等章节 |
| v2.1 | 2026-06-21 | 架构设计补充完整闭环（生成→评审→修订→终审）；更新协同模型、评审轮次控制、Agent 映射表、避坑清单 |
| v2.2 | 2026-06-21 | 第四章编号重构：4.1-4.4 合并为 4.1（含 4.1.1-4.1.4 子节），4.5 改为 4.2，后续章节连续重编号至 4.7；同步更新所有交叉引用 |
| v2.3 | 2026-06-21 | 修复版本号不一致；添加目录和快速入门指南；添加全局代码约束（2.3 节）；标准格式增加错误处理章节；添加回滚机制（5.5.4）；明确第七章与 .trae/rules/ 边界；添加术语表（11.7）和端到端实例（11.8）；数值添加依据说明；合并参数表引用 |
| v2.4 | 2026-06-21 | 添加场景→章节映射速查表（0.6）和调度元 Prompt（0.7），解决"人类不知道该引用哪些章节"的问题 |

---

> 本规范是活文档，随项目实践持续演进。所有总调度 agent 在设计 Prompt 时必须遵循本规范，发现不足时及时更新。
