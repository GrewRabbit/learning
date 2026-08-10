# 架构阶段调度 Prompt 方案（SSO 专项）

> **用途**：总调度 agent 指挥子 agent 完成「SSO 集成」架构设计「制作 → 审核 → 修订 → 终审」完整闭环的标准化 prompt
> **范围**：SSO 集成架构设计阶段（登录认证 / 会话管理 / 登出 / Token 生命周期），承接已 approved 的两份 spec，不含编码实施
> **拆分粒度**：以「一个可独立验收的内聚模块」为一个架构文档，每个架构文档独立走完整闭环
> **评审策略**：**强制满 2 轮**（r1 评审 → r1 修订 → r2 评审 → r2 修订 → 终审），**至少审核修订 2 轮才能终审**
> **版本**：v1.0
> **创建时间**：2026-08-10
> **依据规范**：[AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md)（§4.2 架构设计场景、§5.5 调度编排、§3.1 Prompt 标准格式、§8.2 避坑清单）
> **规则来源**：`.opencode/rules/`（与 `.trae/rules/` 内容一致，本方案统一以 `.opencode/rules/` 为准）
> **需求基线**：**已 approved 的两份 spec**（`docs/specs/spec-sso-auth-v1.2.md`、`docs/specs/spec-sso-token-v1.2.md`）+ **SSO IDP SP 集成指南（第三方契约）** + **现有源码现状**。架构文档以 approved spec 为**唯一合法需求输入**。

---

## 一、任务拆分方案

| 阶段 | 任务 | 目标 Agent | 输入 | 输出 | 优先级 |
|------|------|-----------|------|------|:----:|
| 生成 | SSO 模块架构初稿 | nextjs-architect | 两份 approved spec + 集成指南 + 源码上下文 + 待确认 OQ | `docs/architecture/arch-sso-v1.0.md`（draft） | P0 |
| 评审 r1 | 第 1 轮架构评审 | nextjs-architecture-reviewer | arch-v1.0 + 两份 spec + package.json | `docs/reviews/arch-sso-review-r1.md` | P0 |
| 修订 r1 | 第 1 轮架构修订 | nextjs-architect | arch-v1.0 + review-r1 | `docs/architecture/arch-sso-v1.1.md`（原文件修订） | P0 |
| 评审 r2 | 第 2 轮架构评审 | nextjs-architecture-reviewer | arch-v1.1 + 两份 spec + review-r1 + package.json | `docs/reviews/arch-sso-review-r2.md` | P0 |
| 修订 r2 | 第 2 轮架构修订 | nextjs-architect | arch-v1.1 + review-r2 | `docs/architecture/arch-sso-v1.2.md`（原文件修订） | P0 |
| 终审 | 最终决议 | 总调度 agent（自行执行） | arch-v1.2 + review-r1 + review-r2 + 两份 spec | approved / blocked 决议 | P0 |

> **架构文档粒度决策（有意选择）**：SSO 模块**只产出一份架构文档**（`arch-sso`），承接两份 approved spec（`spec-sso-auth` + `spec-sso-token`）。
>
> - **理由**：两份 spec 在运行时强耦合——共享**同一套两层运行结构**（middleware Edge 层仅 cookie 级校验 + Node 层深度校验，auth FR-016 / token FR-003）、**同一套 Cookie 存储策略**（httpOnly 会话 Cookie）、**同一批 SSO 环境变量**（env.ts 校验模式）与**同一错误载体 envelope**。若拆为两份独立架构文档，共享的两层运行边界 / 环境变量 / Cookie 策略将出现重复规格化与交叉引用混乱，评审时也难以独立验收（评 auth 架构必须同时核对 token 架构的两层衔接）。
> - **判定依据**：按 [§5.3.4](./AI-Prompt使用规范.md) 任务拆分原则，架构层级的可独立验收单元为「SSO 模块整体」（模块内 auth / token 功能域共享运行结构，不满足"无相互依赖可独立验收"）。与 spec 阶段拆两份（各自可独立验收：能登录/能登出 vs 长会话稳定安全）不同。
> - **若后续需拆分**：按 token 生命周期（内省/刷新/撤销）与登录认证（授权码/登出）两个子模块划分，共享两层运行边界、Cookie 策略与环境变量须在单份「共享运行时架构」章节统一定义，子模块架构仅引用。

**架构设计覆盖的功能域**（两份 approved spec 的范围并集）：

| 功能域 | 来源 spec | 关键 FR | 架构决策点 |
|--------|----------|---------|-----------|
| 登录认证（OIDC 授权码 + PKCE） | `spec-sso-auth` v1.2 | FR-001~FR-010（登录发起 / 状态双写 / 授权码流程 / 回调与令牌交换） | 会话存储选型、回调处理、状态双写实现 |
| 会话建立与 Cookie | `spec-sso-auth` v1.2 | FR-002~FR-003（状态 Cookie httpOnly / 双写容错）、FR-015~FR-018（三层校验 / 过期策略 / 续期触发） | 两层运行结构（middleware Edge + Node）职责划分 |
| middleware 认证保护 | `spec-sso-auth` v1.2 | FR-015~FR-018 | middleware matcher 范围扩展、Edge Runtime 约束（禁 client_secret） |
| RP-Initiated 登出 | `spec-sso-auth` v1.2 | FR-019~FR-023（end session 编排 / 白名单校验 / state 校验） | 登出编排服务、IDP 跳转构造 |
| Token 存储与 Cookie | `spec-sso-token` v1.2 | FR-001~FR-002（access/refresh Cookie） | 双 Cookie 策略、maxAge 配置注入 |
| Token 续期（refresh 轮换） | `spec-sso-token` v1.2 | FR-004~FR-010（提前 60s / 单飞 / 轮换 / 退避重试） | 刷新单飞实现、跨标签页并发（OQ-05） |
| Token 撤销与登出 | `spec-sso-token` v1.2 | FR-011~FR-016（revoke / 登出编排 / 白名单） | revoke 服务、失败兜底 |
| 会话有效性内省校验 | `spec-sso-token` v1.2 | FR-017~FR-020（内省 / fail-closed） | 内省 vs 本地 JWT 分工与缓存（FR-017 / NFR-003 / OQ-02） |
| 安全强化与错误码 | 两 spec | token FR-021~FR-026、auth FR-024~FR-025 | 日志脱敏、限流归属（FR-024 / OQ-10）、错误载体 envelope |

---

## 二、调度架构

```
[启动] 总调度 agent
  │
  ├─ 前置条件检查：
  │   ├─ 确认两份 spec 均已 approved：docs/specs/spec-sso-auth-v1.2.md、docs/specs/spec-sso-token-v1.2.md
  │   │   （文件头部「状态：approved」；未 approved 禁止进入架构设计，按 spec-workflow 五步流程）
  │   ├─ 确认 docs/integration-guides/sso-idp-sp-integration-guide.md 存在（第三方契约，按需加载章节）
  │   ├─ 核对 spec 待确认 OQ：docs/specs/spec-sso-auth-v1.2.md §7（OQ-001~OQ-010）、
  │   │   docs/specs/spec-sso-token-v1.2.md §5.3（OQ-01~OQ-10）
  │   │   ├─ 业务决策类 OQ 未确认（如 OQ-004 offline_access、OQ-002 内省范围）：
  │   │   │   → 架构 Prompt E 须列出 OQ 清单，architect 不得自行决断，在架构文档「风险与对策」
  │   │   │     标注为「开放决策项」并给出候选方案供业务选择（或标记 blocked 请求人工介入）
  │   │   └─ 技术决策类 OQ（如 OQ-06 Edge+client_secret 合规路径、OQ-02 缓存策略、OQ-10 限流归属）：
  │   │       → 属架构阶段职责，architect 须给出明确技术方案
  │   └─ 确认 docs/architecture/ 下无冲突的 arch-sso 文件（现有仅 archived/ 目录）
  │
  ├─ [阶段1: 生成] 调度 1× nextjs-architect
  │     ├─ 输入: 两份 approved spec + 集成指南 + 源码上下文 + OQ 清单
  │     └─ 产出: docs/architecture/arch-sso-v1.0.md（draft）
  │
  ├─ [阶段2: 评审 r1] 调度 1× nextjs-architecture-reviewer
  │     └─ 产出: docs/reviews/arch-sso-review-r1.md
  │
  ├─ [阶段3: 修订 r1] 调度 1× nextjs-architect
  │     ├─ 输入: arch-v1.0 + review-r1
  │     └─ 产出: docs/architecture/arch-sso-v1.1.md（原文件修订，版本号内部递增）
  │
  ├─ [阶段4: 评审 r2] 调度 1× nextjs-architecture-reviewer
  │     ├─ 输入: arch-v1.1 + review-r1（核对遗留问题）
  │     └─ 产出: docs/reviews/arch-sso-review-r2.md
  │
  ├─ [阶段5: 修订 r2] 调度 1× nextjs-architect
  │     ├─ 输入: arch-v1.1 + review-r2
  │     └─ 产出: docs/architecture/arch-sso-v1.2.md（原文件修订，版本号内部递增）
  │
  └─ [阶段6: 终审] 总调度 agent 自行执行
        ├─ 输入: arch-v1.2 + review-r1 + review-r2 + 两份 approved spec
        ├─ 决议: approved（仅改状态字段）/ blocked（人工介入）
        └─ approved 后的架构文档方可交给开发 agent（frontend/backend/db-modeler）
```

**调度原则**（按 [§5.1.3](./AI-Prompt使用规范.md)）：

| 原则 | 本方案体现 |
|------|-----------|
| 最小上下文 | 集成指南为 92KB 大文档，**只读指定章节**（见 Prompt E §输入），禁止全量加载；源码限定范围读取 |
| 单一架构文档 | SSO 模块只产出一份 `arch-sso`，两份 spec 的 FR 在同一份架构文档中统一定义落点，避免共享运行时重复规格化 |
| 单点决策 | 终审由总调度统一裁决，子 agent 不互相通信、不互相调用 |
| 状态可追溯 | 通过文件版本号 + 状态字段（draft/approved）+ 评审归档文件全程可追溯 |
| 失败隔离 | 架构阶段单任务，失败即修订重发，不并行多个架构 agent（避免共享运行时的竞争性写入） |

---

## 三、评审轮次策略（强制满 2 轮）

> 区别于 [§5.5.3](./AI-Prompt使用规范.md) 默认的「r1 干净可提前通过」，本项目**强制满 2 轮**，用户明确要求至少审核修订 2 轮才能终审（与 spec 阶段方案一致）。

| 规则 | 说明 |
|------|------|
| **强制满 2 轮** | 无论 r1 评审结论是「需修订」还是「通过」，都必须继续执行 r2 评审 + 修订，禁止提前 approved |
| 轮次上限 | 自动流程最多 2 轮；终审仍存在阻塞问题 → 标记 blocked，请求人工介入，不自动进入第 3 轮 |
| 每轮评审对象 | r1 → arch-v1.0；r2 → arch-v1.1 |
| 每轮修订产出 | r1 → arch-v1.1；r2 → arch-v1.2（均在原文件上修订，版本号 minor+1） |
| r2 评审必须核对 | 逐条核对 r1 问题在 v1.1 中的解决状态，并给出解决率 |
| 终审仅核查 | r1、r2 的**阻塞问题**是否在 v1.2 中全部解决 + **FR 覆盖率 100%**（两份 spec 的 FR 均有架构落点），**不发现新问题**（防无限循环） |
| 评审角色隔离 | reviewer 只输出意见文件，禁止修改架构正文（修订由 nextjs-architect 执行） |

**版本与文件规则**（沿用 spec 阶段方案的「单文件 + 每轮修订重命名」策略）：

- 架构正文：`docs/architecture/arch-{SLUG}-v{major}.{minor}.md`，单文件原则（文件名带版本号，每轮修订 minor+1），初稿 v1.0，终审后 v1.2
- 评审意见：`docs/reviews/arch-{SLUG}-review-r{轮次}.md`，r1、r2 各一份，归档后**禁止修改**
- 架构状态：draft（生成/修订后）→ approved（终审通过，仅改状态字段，不改正文）

> **版本策略取舍依据**：与 spec 阶段方案一致，采用「单文件 + 每轮修订重命名」，任意时刻仅存一份最新版。与 [AI-Prompt 使用规范 §8.2 T7](./AI-Prompt使用规范.md)「文件名不变、版本号写在文件内部」的差异为**有意选择**：文件名随轮次版本递增，可使「评审轮次 ↔ 文件版本」一一对应、产出验证可依赖文件名直接判定，便于流水线状态可追溯。若后续需回归 T7 规则，同步调整本方案全部带版本号的文件路径为固定文件名即可。

---

## 四、背景知识

### 4.1 项目现状（SSO 架构接入点）

本方案适用于 `/var/learning`（`gesp6-web-html`，GESP6 信奥赛 C++ 解题网页生成器）：

- **技术栈**：Next.js 15.1.6（App Router）+ TypeScript 5.7.3 + Tailwind CSS + zod + openai
- **业务**：洛谷题目（GESP 六级）解题网页生成，含流程图/思维导图/代码，调用 OpenAI 模型生成；核心业务已完成
- **现有模块**：`app/solve`（输入页）、`app/result`（结果页）、`app/api/solve`（提交/轮询/取消）、`app/lib/ai`（AI 编排服务）、`middleware.ts`（速率限制 + 认证钩子）
- **认证现状（架构接入点）**：
  - [middleware.ts](file:///var/learning/middleware.ts) 已有 `isAuthenticated()` 认证钩子（当前匿名模式返回 `true`），`PROTECTED_API_PREFIX = '/api/solve'` 未认证重定向 `/login`，Edge Runtime 约束（无 logger / 无 Node 原生模块）；matcher 当前仅 `['/api/:path*']`（仅覆盖 API 路由，页面路由保护需扩展 matcher 或将认证检查下沉到页面/服务端组件）——**架构阶段需决策 matcher 扩展方案（token spec FR-024 / OQ-10 限流归属联动）**
  - [next.config.ts](file:///var/learning/next.config.ts) 安全头已配置 CSP，`frame-src 'none'`、`connect-src 'self'`（SSO 登录为浏览器顶层跳转，需评估 CSP 对 IdP 域名的影响——**架构阶段需评估 CSP 是否需调整**）
  - [app/lib/env.ts](file:///var/learning/app/lib/env.ts) 环境变量校验模式（`validateEnv()` + 模块级缓存），SSO 环境变量复用该模式——**架构阶段需定义 SSO 环境变量全集与校验**
  - 当前无 `/login` 页面、无会话存储、无 SSO 相关环境变量

### 4.2 方案输入文件

| 文件 | 作用 | 读取方式 |
|------|------|---------|
| `docs/specs/spec-sso-auth-v1.2.md` | **已 approved 需求规格（唯一合法需求输入）**，登录认证/会话/登出 | 全量（小文件） |
| `docs/specs/spec-sso-token-v1.2.md` | **已 approved 需求规格（唯一合法需求输入）**，token 生命周期/安全 | 全量（小文件） |
| `docs/integration-guides/sso-idp-sp-integration-guide.md` | **SSO 第三方契约**（架构方案的技术约束核对象） | **仅读指定章节**（§1.5、§1.6、§2、§3.1-§3.8、§4.1-§4.3、§5、§5.6、§7（7.1.1 / 7.1.2 / 7.1.3）），92KB 大文档禁止全量 |
| `package.json` | 核对技术选型与版本 | 全量 |
| 现有源码（限定范围） | 架构与实现现实对齐 | 只读与 SSO 直接相关的文件 |
| `.opencode/rules/dev/dev-workflow.md` | 开发流程约束 | 全量（小文件） |
| `.opencode/rules/dev/api-conventions.md` | 服务层 / API / Server Action 规范 | 全量（小文件） |
| `.opencode/rules/dev/component-rules.md` | 组件规范 | 全量（小文件） |
| `.opencode/rules/global/code-style.md` | 代码风格 / 安全（Cookie 配置等） | 按需 |
| `.opencode/rules/global/naming-conventions.md` | 命名规范（含错误码） | 按需 |

---

## 五、Prompt E — SSO 架构生成

### 一、通用模板

```
你是 nextjs-architect，任务：基于已 approved 的两份 SSO spec 设计【{MODULE_NAME}】模块技术架构初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 了解 spec 输出约束（approved spec 为唯一需求输入）
2. {PROJECT_ROOT}/.opencode/rules/dev/dev-workflow.md     — 开发流程约束（SC/CC/Server Action/middleware 规范）
3. {PROJECT_ROOT}/.opencode/rules/dev/api-conventions.md  — 服务层与 API 规范（ServiceResult、错误码）
4. {PROJECT_ROOT}/.opencode/rules/dev/component-rules.md  — 组件规范
5. {PROJECT_ROOT}/.opencode/rules/global/code-style.md    — 代码风格与安全（Cookie 配置、错误码格式）
6. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. {PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.2.md（已 approved，登录认证 / 会话 / 登出）
   - 全量读取；本 spec 为需求的唯一合法来源之一
2. {PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md（已 approved，token 生命周期 / 安全）
   - 全量读取；本 spec 为需求的唯一合法来源之一
   - 禁止参考任何 draft / in-review 状态的 spec 版本（文件头状态字段必须为 approved）
3. {PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md（SSO 第三方契约）
   - 必读章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档，按 §0.2 按需加载）
   - 作用：核对 OIDC 端点契约 / 安全要求 / 流程约束，作为架构技术选型的约束
4. {PROJECT_ROOT}/package.json
   - 核对技术栈与依赖版本（Next.js 15 App Router + TypeScript + Tailwind + zod + openai），技术选型必须与之一致
5. 现有源码（限定范围，用于架构与实现现实对齐）：
   - {SOURCE_CONTEXT}
   - 禁止通读全量源码，仅读取与 SSO 集成直接相关的文件

【输出】
- 文件路径：{PROJECT_ROOT}/docs/architecture/arch-sso-v1.0.md
- 状态：draft
- 严格遵循以下必备章节：架构概述（含核心架构决策表[决策项/选择/理由]） / 模块划分（模块清单 + 模块依赖关系）/ 技术选型（技术栈表[类别/技术/版本/用途]，与 package.json 一致）/ 数据流设计（正常流 + 异常流）/ 接口定义（服务层 ServiceResult + 错误码）/ 目录结构（符合 dev 规则，@/ 绝对路径）/ 依赖关系 / 非功能设计（性能/安全/可扩展）/ 风险与对策

【硬性约束】
1. 架构设计必须以两份 approved spec 为唯一需求来源；每个 FR 必须有对应架构设计落点，禁止遗漏
2. 禁止照搬集成指南示例代码，仅参考协议 / 端点 / 安全约束作为技术约束
3. 技术栈必须与项目 package.json 实际配置一致（Next.js 15 App Router + TS + Tailwind + zod）
4. 两层运行结构必须明确划分（spec-sso-auth FR-016 / spec-sso-token FR-003）：
   - middleware（Edge Runtime）：仅做 cookie 级 / 基础校验，禁止引用 SSO 密钥（client_secret）环境变量、禁止 Node 原生模块、无 logger 仅 console
   - Node 运行时层：深度校验（access_token 本地 JWT 验签 + iss/aud/exp 或按 token spec 内省分工），client_secret 仅服务端
5. SSO 环境变量必须复用 {PROJECT_ROOT}/app/lib/env.ts 的 validateEnv() + 模块级缓存模式，列出完整环境变量清单（含 SSO_CLIENT_ID / SSO_CLIENT_SECRET / SSO_IDP_* / SSO_MOCK_ENABLED 等，最终命名以架构方案为准），禁止 NEXT_PUBLIC_ 前缀暴露 client_secret
6. middleware matcher 扩展方案必须明确（当前仅 ['/api/:path*']，页面路由保护范围按 spec OQ-002 未决时给出候选方案并标注开放决策项）
7. 安全架构必须覆盖（两 spec §5 安全要求并集）：PKCE 强制（S256）/ state ≥32 CSRF / id_token 验证（strict）/ Cookie httpOnly+secure+sameSite=lax+maxAge / 开放重定向白名单 / 日志脱敏 / token 交换·撤销·刷新仅经 SP 后端 / SSO 端点限流（429+Retry-After+指数退避）
8. 待确认 OQ 处理：业务决策类 OQ（{OQ_ITEMS} 中标注「待确认」的业务项，如 offline_access 启用、受保护范围、登出落地页）**不得自行决断**，在「风险与对策」标注为「开放决策项」并给出候选方案（供业务选择）；技术决策类 OQ（内省 vs 本地 JWT 分工与缓存、Edge+client_secret 合规路径、限流归属）**必须给出明确技术方案**，并核对 token spec NFR-003 内省缓存策略
9. 禁止使用 any 类型；禁止跨模块 ../ 引用（必须 @/ 绝对路径）
10. 单文件 ≤ 500 行；若超出，在「风险与对策」说明拆分计划
11. 禁止硬编码密钥、Token、连接字符串

【验收标准】
- 文件已创建在 {PROJECT_ROOT}/docs/architecture/arch-sso-v1.0.md 且状态为 draft
- 包含所有必备章节（架构概述/模块划分/技术选型/数据流/接口/目录结构/依赖/非功能/风险）
- 两份 spec 的每个 FR（auth FR-001~FR-027、token FR-001~FR-026）都有对应架构落点，无遗漏
- 技术选型与 package.json 实际依赖一致
- 目录结构符合 .opencode/rules/dev/ 规范
- 两层运行结构职责划分明确（middleware Edge 无 client_secret / Node 层深度校验）
- SSO 环境变量清单完整且复用 env.ts 校验模式
- 业务决策类 OQ 未擅自决断（标注为开放决策项 + 候选方案）

完成后返回：
- 文件路径
- 架构决策清单（决策项 | 选择 | 理由）
- 模块划分图（文本形式）
- FR 覆盖清单（auth FR-001~027、token FR-001~026 各自落点章节）
- 开放决策项清单（业务 OQ 候选方案）
- 风险清单
- 阻塞问题（如有）
```

### 二、参数填充表

| 参数 | 值 |
|------|-----|
| `{MODULE_NAME}` | SSO 登录认证与 Token 生命周期（SSO 集成模块） |
| `{SLUG}` | `sso`（模块级单一架构文档，承接两份 spec） |
| `{FRAMEWORK_SECTIONS}` | `§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.5、§3.6、§3.7、§3.8、§4.1、§4.2、§4.3、§5、§5.6、§7（7.1.1 / 7.1.2 / 7.1.3）` |
| `{SOURCE_CONTEXT}` | `middleware.ts、app/lib/env.ts、next.config.ts、app/api/solve/route.ts、app/layout.tsx、app/layout-client.tsx` |
| `{OQ_ITEMS}` | auth §7 OQ-001~OQ-009（待确认）+ token §5.3 OQ-01~OQ-10（待确认）；OQ-010 已裁决不在此列 |
| `{PROJECT_ROOT}` | `/var/learning` |

> **注**：架构生成前总调度须核对两份 spec 的状态字段均为 approved（前置条件）。若业务决策类 OQ 存在阻塞性未决项（如 OQ-004 决定会话模型、OQ-002 决定是否引入内省架构），可先行标记 blocked 请求人工介入，或让 architect 给出候选方案后继续。

---

## 六、Prompt F — SSO 架构评审

### 一、通用模板

```
你是 nextjs-architecture-reviewer，任务：对【{MODULE_NAME}】架构设计第 {ROUND} 轮评审。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/dev/dev-workflow.md     — 开发流程约束
2. {PROJECT_ROOT}/.opencode/rules/dev/api-conventions.md  — API / 服务层规范（核对接口定义）
3. {PROJECT_ROOT}/.opencode/rules/dev/component-rules.md  — 组件规范（核对模块划分）
4. {PROJECT_ROOT}/.opencode/rules/global/code-style.md    — 代码风格
5. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. 待评审架构文件：{PROJECT_ROOT}/docs/architecture/arch-sso-v{VERSION}.md
2. 对应 spec 文件（核对 FR 覆盖性）：
   - {PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.2.md（全量）
   - {PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md（全量）
3. {PROJECT_ROOT}/package.json
   - 核对技术选型与实际依赖一致（禁止凭印象判断）
4. 集成指南（核对技术约束）：{PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 对照章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档）
5. 现有源码上下文（核对现状对齐）：{SOURCE_CONTEXT}
   - 仅读取上述文件，禁止通读全量源码
6. 上轮评审意见（仅当 {ROUND} > 1）：
   - {PROJECT_ROOT}/docs/reviews/arch-sso-review-r{PREV_ROUND}.md
   - 核对上轮问题是否已在当前版本解决

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/arch-sso-review-r{ROUND}.md
- 评审意见文件一旦归档禁止修改

【评审维度】（逐项检查，每项给出结论）
1. Spec 覆盖性：两份 spec 的每个 FR（auth FR-001~FR-027、token FR-001~FR-026）是否都有对应架构设计落点；有无遗漏的需求
2. 技术选型合理性：是否与 package.json 实际依赖一致；是否有过度设计或设计不足（如不必要的引入缓存中间件 / 过度抽象）
3. 模块划分：auth / token 功能域边界是否清晰；共享运行时（middleware + Node 两层）是否单一定义、无重复规格化；耦合度是否合理；是否符合单一职责
4. 两层运行结构（SSO 专项重点）：middleware（Edge）与 Node 层职责划分是否符合两 spec FR-016/FR-003——Edge 层是否误引用 client_secret / Node 原生模块；Node 层深度校验（access_token 本地验签 vs 内省分工）是否明确
5. 数据流设计：是否完整覆盖正常流（登录→受保护访问→续期→登出）和异常流（令牌交换失败 / 刷新失败 / 内省超时 fail-closed / IDP 429）；有无遗漏的边界场景（跨标签页并发刷新 OQ-05）
6. 接口定义：是否符合 api-conventions.md 规范；ServiceResult<T> 返回格式是否统一；错误码是否与两 spec 错误码表（auth §3.7 / token FR-025）一致
7. 目录结构：是否符合 .opencode/rules/dev/ 规范；是否有 @/ 绝对路径导入
8. 安全设计：PKCE / state CSRF / id_token 验证 / Cookie 标志 / client_secret 保护（仅服务端，禁 NEXT_PUBLIC_）/ 开放重定向白名单 / 日志脱敏 / 速率限制是否覆盖；CSP 影响（frame-src 'none' / connect-src 'self'）是否评估；SSO 环境变量是否复用 env.ts 校验模式
9. 待确认 OQ 处理：业务决策类 OQ 是否被擅自决断（应标注为开放决策项 + 候选方案）；技术决策类 OQ 是否给出明确方案（内省分工与缓存、Edge+client_secret 合规路径、限流归属）
10. 风险识别：是否识别了技术风险（如 Edge Runtime 限制、IDP 重放检测撤销会话、内省超时）；对策是否可行
11. 合规性：是否违反 .opencode/rules/ 规范；是否照搬集成指南示例代码
12. 可实施性：开发 agent 能否据此直接编码；有无模糊不清的描述（如环境变量取值、模块边界职责）

【问题清单格式】
| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议（按 [§11.2](./AI-Prompt使用规范.md)）
- 阻塞级问题必须导致"需修订"结论
- 编号格式：AR{ROUND}-001、AR{ROUND}-002...（AR = Architecture Review）

【评审结论】
- 需修订：存在阻塞或重要问题
- 通过：仅剩建议级问题或无问题
- 注意：无论结论为何，本方案强制满 2 轮评审，架构文档不会在本轮直接 approved

【硬性约束】
1. 评审角色禁止直接修改架构文件正文，只输出意见文件
2. 禁止粘贴架构文件原文到评审文件（仅引用章节编号）
3. 每个问题必须给出具体修订建议，不可仅指出问题
4. 必须核对 package.json 实际依赖，禁止凭印象判断技术选型
5. 不得代替需求方做业务决策（业务模糊 OQ 应标注为开放决策项，而非自行决断）
6. {ROUND} > 1 时，必须逐条核对上轮 r{PREV_ROUND} 问题在 v{VERSION} 中的解决状态（已解决/未解决/部分解决），并在评审总结中给出解决率

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
| 上轮评审文件 | — | `docs/reviews/arch-sso-review-r1.md` |
| 输出文件 | `docs/reviews/arch-sso-review-r1.md` | `docs/reviews/arch-sso-review-r2.md` |

其余参数（`{MODULE_NAME}`、`{SLUG}`、`{FRAMEWORK_SECTIONS}`、`{SOURCE_CONTEXT}`、`{PROJECT_ROOT}`）与 Prompt E 一致。

---

## 七、Prompt G — SSO 架构修订

### 一、通用模板

```
你是 nextjs-architect，任务：根据第 {ROUND} 轮评审意见修订【{MODULE_NAME}】架构设计。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/dev/dev-workflow.md     — 开发流程约束
2. {PROJECT_ROOT}/.opencode/rules/dev/api-conventions.md  — API / 服务层规范
3. {PROJECT_ROOT}/.opencode/rules/dev/component-rules.md  — 组件规范
4. {PROJECT_ROOT}/.opencode/rules/global/code-style.md    — 代码风格
5. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范

【输入文件】
1. 当前架构文件：{PROJECT_ROOT}/docs/architecture/arch-sso-v{CURRENT_VERSION}.md
2. 评审意见：{PROJECT_ROOT}/docs/reviews/arch-sso-review-r{ROUND}.md
3. 对应 spec 文件（如需核对 FR 覆盖性）：
   - {PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.2.md
   - {PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md
4. {PROJECT_ROOT}/package.json（如需核对技术选型）
5. 集成指南（如需核对）：{PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 核对章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档）

【操作要求】
1. 在原架构文件上直接修订（不新建文件）
2. 文件内版本号更新为 v{NEXT_VERSION}
3. 在文件头部变更记录新增一行：v{NEXT_VERSION} | 日期 | 根据 r{ROUND} 评审修订 | review-r{ROUND}
4. 状态保持 draft（未通过终审前不改为 approved）
5. 修订完成后，将文件重命名为 {PROJECT_ROOT}/docs/architecture/arch-sso-v{NEXT_VERSION}.md（文件名随内部版本号同步更新，任意时刻仅存一份最新版）

【修订原则】
1. 逐条对照评审问题清单（AR{ROUND}-001、AR{ROUND}-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由（在变更记录或修订说明中标注）
4. 建议级问题酌情采纳
5. 禁止将评审意见原文直接粘贴进架构文件
6. 禁止删除已通过评审的章节，仅可修改或新增
7. 若评审意见涉及业务决策 OQ 且业务方未确认，保持为「开放决策项」状态，不自行决断
8. 修订内容同样禁止照搬集成指南示例代码，仅参考契约 / 端点 / 安全约束

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订（修订后按操作要求 5 重命名为最新版本文件，任意时刻仅存一份）
2. 禁止改动与评审意见无关的内容
3. 修订后必须保持所有必备章节完整（架构概述/模块划分/技术选型/数据流/接口/目录结构/依赖/非功能/风险）
4. 技术选型修改必须与 package.json 一致
5. 两层运行结构职责划分不得因修订而破坏（middleware Edge 无 client_secret / Node 层深度校验）
6. 禁止使用 any 类型；禁止跨模块 ../ 引用
7. 单文件 ≤ 500 行

【验收标准】
- 文件已重命名为 arch-sso-v{NEXT_VERSION}.md 且内部版本号为 v{NEXT_VERSION}（文件名与内部版本号一致）
- 变更记录已新增 v{NEXT_VERSION} 行
- 所有阻塞级问题已解决
- 所有重要级问题已解决或给出理由
- 所有必备章节仍然完整
- 两份 spec 的 FR 覆盖清单仍完整（无新增遗漏）
- 输出修订对照表：AR{ROUND}-编号 | 是否解决 | 修订位置

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
| 评审意见文件 | `docs/reviews/arch-sso-review-r1.md` | `docs/reviews/arch-sso-review-r2.md` |

其余参数与 Prompt E 一致。

---

## 八、Prompt H — SSO 架构终审

> **适用角色**：总调度 agent 自行执行（不调度子 agent），按 [§4.2.4](./AI-Prompt使用规范.md)。

```
你是总调度收尾 agent，任务：汇总【{MODULE_NAME}】架构设计的第 2 轮修订结果，做最终决议。

【输入文件】
1. 第 2 轮修订后的架构文件：{PROJECT_ROOT}/docs/architecture/arch-sso-v1.2.md
2. 第 2 轮评审意见：{PROJECT_ROOT}/docs/reviews/arch-sso-review-r2.md
3. 第 1 轮评审意见：{PROJECT_ROOT}/docs/reviews/arch-sso-review-r1.md
4. 两份对应 spec（核对 FR 覆盖性）：
   - {PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.2.md
   - {PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md

【任务】
1. 读取第 2 轮修订后的最新版架构文件（{PROJECT_ROOT}/docs/architecture/arch-sso-v1.2.md）与 r1、r2 两份评审意见（v1.1 的修订过程追溯由 review-r2 内含的「r1 问题解决状态核对」覆盖，无需直接读取 v1.1 文件）
2. 核对修订版是否已解决 r1、r2 中的所有阻塞级问题
3. 核对架构文件是否覆盖两份 spec 的**全部 FR**（auth FR-001~FR-027、token FR-001~FR-026），FR 覆盖率必须 100%
4. 做决议：
   - v1.2 已解决全部阻塞问题 + FR 全覆盖 → 将架构文件状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题或 FR 遗漏 → 标记为 blocked，列出剩余问题，请求人工介入（不进入第 3 轮）
5. 输出汇总报告（直接回复，不写文件）：
   - 架构终审状态（approved / blocked）
   - 阻塞问题清单（如有）
   - 阻塞问题解决率（已解决数/两轮问题总数）
   - FR 覆盖率（已覆盖 FR 数/两份 spec FR 总数，auth 27 + token 26 = 53）
   - 是否可进入开发阶段
   - 架构→开发衔接要点（如：开发任务的拆分建议、需先落地的服务层/环境变量、mock IDP 测试基建）

【硬性约束】
1. 仅修改状态字段，不改动架构文件正文内容
2. approved 状态的架构文件才可交给开发 agent（frontend-expert / backend-expert / db-modeler）
3. draft 状态的架构文件禁止进入开发
4. 终审仅核查 r1、r2 阻塞问题是否解决 + FR 覆盖率，不重新发现新问题（防止无限循环）
5. FR 覆盖率必须 100%，任何遗漏的 FR 都视为阻塞
6. 终审不得代替业务方做业务决策（开放决策项 OQ 仍保留在架构文档中）
```

### 二、参数填充表

| 参数 | 值 |
|------|-----|
| `{MODULE_NAME}` | SSO 登录认证与 Token 生命周期（SSO 集成模块） |
| `{SLUG}` | `sso` |
| `{PROJECT_ROOT}` | `/var/learning` |

> **注**：终审输入为 arch-sso-v1.2.md（固定），与 r2 修订产出一致；参数值复用 Prompt E 参数表。终审时若发现业务决策类 OQ 仍未确认，仅将对应项列入「开放决策项」清单（随架构文档移交开发阶段处理），不因此单独标记 blocked（除非该 OQ 直接阻塞开发编码路径）。

---

## 九、调度执行顺序

> 架构阶段为**单一架构文档 + 严格串行闭环**（不并行多个架构 agent），执行以下步骤：

```
Step 1 [串行] Prompt E — SSO 架构生成（nextjs-architect）
   ├─ 前置条件：确认两份 spec approved（状态字段）；确认集成指南存在；核对 OQ 待确认清单
   ├─ 产出验证：arch-sso-v1.0.md 存在、状态 draft、必备章节齐全、FR 覆盖清单完整、未擅自决断业务 OQ
   └─ 未通过 → 修订 Prompt E 后重发（最多 2 次），仍失败标记 blocked

Step 2 [串行] Prompt F — 评审 r1（nextjs-architecture-reviewer）
   ├─ 产出验证：review-r1 存在、编号 AR1-xxx 连续、每个问题有修订建议
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 3（强制满 2 轮，不提前 approved）

Step 3 [串行] Prompt G — 修订 r1（nextjs-architect）
   ├─ 输入：arch-v1.0 + review-r1
   ├─ 产出验证：arch-v1.1 存在（已重命名）、文件名与内部版本号一致、变更记录已加行、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt G（最多 2 次）

Step 4 [串行] Prompt F — 评审 r2（nextjs-architecture-reviewer）
   ├─ 输入：arch-v1.1 + review-r1（核对遗留问题）
   ├─ 产出验证：review-r2 存在、含上轮问题解决率、编号 AR2-xxx 连续
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 5（强制满 2 轮）

Step 5 [串行] Prompt G — 修订 r2（nextjs-architect）
   ├─ 输入：arch-v1.1 + review-r2
   ├─ 产出验证：arch-v1.2 存在（已重命名）、文件名与内部版本号一致、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt G（最多 2 次）

Step 6 [串行] Prompt H — 终审（总调度自行执行）
   ├─ 输入：arch-v1.2 + review-r1 + review-r2 + 两份 approved spec
   ├─ 决议：approved（改状态字段）/ blocked（人工介入）
   └─ 终审通过 → 架构文档进入开发阶段（frontend-expert / backend-expert / db-modeler）
```

**故障恢复**（按 [§5.4](./AI-Prompt使用规范.md)）：瞬时错误自动重试（最多 3 次，指数退避）；参数错误修正后重新派发；子 agent 产出不符合验收标准时分析原因、修订 Prompt 后重发（最多 2 次）；仍失败标记 blocked 请求人工介入。

**超时设置**（按 [§5.4.3](./AI-Prompt使用规范.md)）：架构生成 6 分钟 / 评审 5 分钟 / 修订 5 分钟 / 终审 2 分钟（架构生成涉及两份 spec 全量 + 集成指南多章节，超时略高于 spec 生成）。

---

## 十、关键设计要点

| 要点 | 说明 |
|------|------|
| **强制满 2 轮** | 与 spec 阶段方案一致，用户明确要求；即使 r1 干净也必须走 r2，至少审核修订 2 轮才能终审 |
| **单一架构文档** | SSO 模块只产出一份 `arch-sso`（承接两份 spec），共享两层运行结构 / Cookie 策略 / 环境变量单一定义，避免重复规格化（详见 §一 粒度决策） |
| **唯一需求输入** | approved spec 为唯一合法需求来源；禁止参考 draft / in-review spec（T11）；FR 覆盖率必须 100%（T20） |
| **角色隔离** | reviewer 只评审不修订（T5）；architect 只生成/修订（T6）；终审由总调度执行，子 agent 不互相调用（T15） |
| **上下文隔离** | 集成指南 92KB 大文档只读指定章节（P2/T2/T3）；现有源码限定范围读取；禁止全量加载 |
| **两层运行结构** | middleware（Edge）仅 cookie 级校验、禁 client_secret / Node 原生模块；Node 层深度校验（access_token 本地验签 vs 内省分工）——架构阶段必须给出明确方案（两 spec FR-016/FR-003） |
| **版本控制** | 单文件原则，文件名随版本递增 v1.0→v1.1→v1.2（与 T7「文件名不变」的差异为有意选择，见 §三 取舍依据）；评审意见独立归档禁止修改 |
| **依赖串行** | 生成→评审→修订→评审→修订→终审严格串行，保证每阶段产出经过验证；架构阶段不并行多个 agent |
| **阻塞兜底** | 自动流程最多 2 轮，终审仍阻塞则 blocked，不无限循环（T9） |
| **技术决策归架构** | 技术决策类 OQ（内省分工与缓存 / Edge+client_secret 合规路径 / 限流归属 / matcher 扩展）由 architect 给出明确方案；业务决策类 OQ（offline_access / 受保护范围 / 登出落地页）不得擅自决断，标注为开放决策项 + 候选方案 |
| **安全专项** | 架构必须覆盖两 spec §5 安全要求并集（PKCE / state CSRF / id_token 验证 / Cookie 标志 / client_secret 保护 / 开放重定向 / 日志脱敏 / 速率限制 / CSP 影响评估） |
| **现状对齐** | 架构必须考虑 middleware Edge Runtime 约束、matcher 范围（当前仅 /api/*）、CSP `connect-src 'self'` / `frame-src 'none'` 对 SSO 的影响、env.ts 校验模式复用 |
| **返回格式** | 每个 Prompt 末尾要求返回结构化摘要，便于总调度决策（T10） |

---

## 十一、文件清单（预期产出）

| 文件 | 阶段 | 状态 |
|------|------|------|
| `docs/architecture/arch-sso-v1.0.md` | 生成 | draft |
| `docs/architecture/arch-sso-v1.1.md` | 修订 r1 | draft（原文件修订） |
| `docs/architecture/arch-sso-v1.2.md` | 修订 r2 | **approved**（终审通过后状态字段） |
| `docs/reviews/arch-sso-review-r1.md` | 评审 r1 | 归档只读 |
| `docs/reviews/arch-sso-review-r2.md` | 评审 r2 | 归档只读 |

> **说明**：与 spec 阶段一致，架构采用"单文件 + 文件名带版本号"：每轮修订在原文件上直接修改并递增版本号，文件名同步更新为最新版本；评审意见文件按轮次独立归档。
>
> **单文件语义**：上表 `arch-sso-v1.0.md / v1.1.md / v1.2.md` 三行为**同一物理文件在不同轮次的版本名**，任意时刻仅存一份最新版（v1.0 → v1.1 → v1.2），非三份并存文件。若需确认当前版本，以 `docs/architecture/` 下实际存在的 `arch-sso-v*.md` 文件名为准。

---

## 十二、文档维护

| 触发条件 | 操作 |
|---------|------|
| 新增 SSO 功能域（如 Back-Channel Logout、DPoP、PAR） | 在 §一 功能域覆盖表追加行，评估是否需拆分架构文档或扩充模块划分章节 |
| spec 修订（spec-sso-auth / spec-sso-token 版本变化） | 同步更新 §一/§五/§六 的 spec 文件路径与版本号引用（P8 版本一致） |
| 集成指南章节变更 | 同步更新 §一/§五/§六 的 `{FRAMEWORK_SECTIONS}` 引用 |
| 规则文件变动 | 同步更新 Prompt 中引用的 `.opencode/rules/` 路径 |
| 业务 OQ 确认 | 将已确认 OQ 从「开放决策项」状态转为正式架构决策，更新 §五 约束与 §十 要点 |
| 实践发现新坑点 | 补充到 §十 关键设计要点 |
| 调度流程变更 | 更新 §二/§九，更新版本号 |

**版本历史**：

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-10 | 初稿创建：面向 SSO 专项的架构阶段调度 prompt 方案；基于 AI-Prompt 使用规范 v2.9 §4.2/§5.5；承接两份 approved spec（sso-auth / sso-token）；单一架构文档粒度决策；强制满 2 轮评审；含 Prompt E/F/G/H 模板与参数表 |

> **注**：依据规范 [AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md) 自身版本历史仅记录至 v2.5，本方案引用的 §4.2/§5.5/§8.2/§9.3/§11.2/§11.5 在 v2.6-v2.9 若有变更，需在规范补全版本历史后回查确认本方案是否受影响。
