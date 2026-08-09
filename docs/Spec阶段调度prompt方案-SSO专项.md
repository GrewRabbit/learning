# Spec 阶段调度 Prompt 方案（SSO 专项）

> **用途**：总调度 agent 指挥子 agent 完成「SSO 集成」spec「制作 → 审核 → 修订 → 终审」完整闭环的标准化 prompt
> **范围**：SSO 集成需求规格化阶段（登录认证 / 会话管理 / 登出 / Token 生命周期），不含架构设计、编码实施
> **拆分粒度**：以「一个可独立验收的内聚功能域」为一个 spec，每个 spec 独立走完整闭环
> **评审策略**：**强制满 2 轮**（r1 评审 → r1 修订 → r2 评审 → r2 修订 → 终审），**至少审核修订 2 轮才能终审**
> **版本**：v1.2
> **创建时间**：2026-08-10（v1.1 修订：2026-08-10；v1.2 修订：2026-08-10）
> **依据规范**：[AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md)（§4.1 Spec 场景、§5.5 调度编排、§3.1 Prompt 标准格式、§8.2 避坑清单）
> **规则来源**：`.opencode/rules/`（与 `.trae/rules/` 内容一致，本方案统一以 `.opencode/rules/` 为准）
> **需求基线**：当前项目**无 approved PRD**（旧 `prd-sso-integration-v1.0.md` 已删除），本方案以 **SSO IDP SP 集成指南（第三方契约） + 业务集成目标 + 现有源码现状** 为 spec 的需求来源。

---

## 一、任务拆分方案

| 阶段 | 任务 | 目标 Agent | 输入 | 输出 | 优先级 |
|------|------|-----------|------|------|:----:|
| 生成 | SSO spec 初稿 | nextjs-spec-generator | SSO 集成指南 + 业务集成目标 + 源码上下文 | `docs/specs/spec-{SLUG}-v1.0.md`（draft） | P0 |
| 评审 r1 | 第 1 轮评审 | nextjs-spec-reviewer | spec-v1.0 + 集成指南 + 源码上下文 | `docs/reviews/spec-{SLUG}-review-r1.md` | P0 |
| 修订 r1 | 第 1 轮修订 | nextjs-spec-generator | spec-v1.0 + review-r1 | `docs/specs/spec-{SLUG}-v1.1.md`（原文件修订） | P0 |
| 评审 r2 | 第 2 轮评审 | nextjs-spec-reviewer | spec-v1.1 + 集成指南 + review-r1 | `docs/reviews/spec-{SLUG}-review-r2.md` | P0 |
| 修订 r2 | 第 2 轮修订 | nextjs-spec-generator | spec-v1.1 + review-r2 | `docs/specs/spec-{SLUG}-v1.2.md`（原文件修订） | P0 |
| 终审 | 最终决议 | 总调度 agent（自行执行） | spec-v1.2 + review-r1 + review-r2 | approved / blocked 决议 | P0 |

**SSO 功能域拆分**（本方案覆盖 2 个 spec）：

| Spec | 覆盖范围 | 集成指南参考章节 | 优先级 |
|------|---------|----------------|:----:|
| `spec-sso-auth` | SSO 登录认证（OIDC 授权码 + PKCE）、会话建立与 Cookie、middleware 认证保护、RP-Initiated 登出 | §1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.5、§3.7、§3.8、§4.1、§4.3、§5、§7（7.1.1 / 7.1.3） | P0 |
| `spec-sso-token` | access_token 续期（refresh_token 轮换）、token 撤销、会话超时、Token 安全强化（日志脱敏、校验配置） | §3.3、§3.6、§3.7、§4.2、§4.3、§5.6、§7（7.1.2 / 7.1.3） | P1 |

> **拆分粒度判定**（按 [§5.3.4](./AI-Prompt使用规范.md)）：两个 spec 均可独立验收（sso-auth 保证"能登录/能登出"，sso-token 保证"长会话稳定与安全"）；无相互强依赖，可先后或并行走闭环。若产出超过单文件 ≤ 500 行，在"边界与排除项"说明拆分。
>
> **§3.6（Introspect 内省）用途说明**：sso-token 引用 §3.6 用于「会话有效性内省校验」（如 middleware 校验 access_token 是否仍有效），该章节未出现在集成指南 §0.2 能力映射表中，属本方案按 token 生命周期需求的自定义扩展，spec 生成时应明确其用途。

---

## 二、调度架构

```
[启动] 总调度 agent
  │
  ├─ 前置条件检查：
  │   ├─ 确认 docs/integration-guides/sso-idp-sp-integration-guide.md 存在
  │   ├─ 确认 docs/sso-business-goals.md 是否存在（不存在则省略输入，业务缺口标注为开放问题）
  │   └─ 确认无 approved PRD → 本方案以「集成指南 + 业务目标 + 源码现状」为需求基线
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
        ├─ 输入: spec-v1.2 + review-r1 + review-r2
        ├─ 决议: approved（仅改状态字段）/ blocked（人工介入）
        └─ approved 后的 spec 方可交给 nextjs-architect
```

**调度原则**（按 [§5.1.3](./AI-Prompt使用规范.md)）：

| 原则 | 本方案体现 |
|------|-----------|
| 最小上下文 | 集成指南为 92KB 大文档，**只读指定章节**（见 Prompt A §输入），禁止全量加载 |
| 最大并行 | `spec-sso-auth` 与 `spec-sso-token` 相互独立，阶段 1 可并行生成；单个 spec 内阶段串行 |
| 单点决策 | 终审由总调度统一裁决，子 agent 不互相通信、不互相调用 |
| 状态可追溯 | 通过文件版本号 + 状态字段（draft/approved）+ 评审归档文件全程可追溯 |
| 失败隔离 | 某 spec 失败不阻塞另一独立 spec |

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
| 终审仅核查 | r1、r2 的**阻塞问题**是否在 v1.2 中全部解决 + 需求基线是否全覆盖，**不发现新问题**（防无限循环） |
| 评审角色隔离 | reviewer 只输出意见文件，禁止修改 spec 正文（修订由 spec-generator 执行） |

**版本与文件规则**（按 [spec-workflow.md](../.opencode/rules/spec/spec-workflow.md)）：

- spec 正文：`docs/specs/spec-{SLUG}-v{major}.{minor}.md`，单文件原则（文件名带版本号，每轮修订 minor+1），初稿 v1.0，终审后 v1.2
- 评审意见：`docs/reviews/spec-{SLUG}-review-r{轮次}.md`，r1、r2 各一份，归档后**禁止修改**
- spec 状态：draft（生成/修订后）→ approved（终审通过，仅改状态字段，不改正文）

> **版本策略取舍依据**：本方案以 [spec-workflow.md §二](../.opencode/rules/spec/spec-workflow.md) 命名规范（文件名含 `v{major}.{minor}`）为准，采用「单文件 + 每轮修订重命名」，任意时刻仅存一份最新版。与 [AI-Prompt 使用规范 §8.2 T7](./AI-Prompt使用规范.md)「文件名不变、版本号写在文件内部」的差异为**有意选择**：文件名随轮次版本递增，可使「评审轮次 ↔ 文件版本」一一对应、产出验证可依赖文件名直接判定，便于流水线状态可追溯。若后续需回归 T7 规则，同步调整 §一/§五/§六/§七/§八/§九/§十一 全部带版本号的文件路径为固定文件名即可。

---

## 四、背景知识

> **说明**：AI-Prompt 使用规范 §5.5.1 调度方案模板含「参考项目读取流程（共用）」章节；本项目以集成指南替代参考项目体系，对应实现为 §四 4.2 方案输入文件表（集成指南按 §0.2 按需加载），故不再单列「参考项目读取流程」章节。

### 4.1 项目现状（SSO 接入点）

本方案适用于 `/var/learning`（`gesp6-web-html`，GESP6 信奥赛 C++ 解题网页生成器）：

- **技术栈**：Next.js 15.1.6（App Router）+ TypeScript 5.7.3 + Tailwind CSS + zod + openai
- **业务**：洛谷题目（GESP 六级）解题网页生成，含流程图/思维导图/代码，调用 OpenAI 模型生成；核心业务已完成
- **现有模块**：`app/solve`（输入页）、`app/result`（结果页）、`app/api/solve`（提交/轮询/取消）、`app/lib/ai`（AI 编排服务）、`middleware.ts`（速率限制 + 认证钩子）
- **认证现状（SSO 接入点）**：
  - [middleware.ts](file:///var/learning/middleware.ts) 已有 `isAuthenticated()` 认证钩子（当前匿名模式返回 `true`），`PROTECTED_API_PREFIX = '/api/solve'` 未认证重定向 `/login`，Edge Runtime 约束（无 logger / 无 Node 原生模块）；matcher 当前仅 `['/api/:path*']`（仅覆盖 API 路由，页面路由保护需扩展 matcher 或将认证检查下沉到页面/服务端组件）
  - [next.config.ts](file:///var/learning/next.config.ts) 安全头已配置 CSP，`frame-src 'none'`、`connect-src 'self'`（SSO 登录为浏览器顶层跳转，需评估 CSP 对 IdP 域名的影响）
  - [app/lib/env.ts](file:///var/learning/app/lib/env.ts) 环境变量校验模式（`validateEnv()` + 模块级缓存），SSO 环境变量可复用该模式
  - 当前无 `/login` 页面、无会话存储、无 SSO 相关环境变量

### 4.2 方案输入文件

| 文件 | 作用 | 读取方式 |
|------|------|---------|
| `docs/integration-guides/sso-idp-sp-integration-guide.md` | **SSO 第三方契约**（需求与技术约束主要来源） | **仅读指定章节**（按 §0.2 按需加载），92KB 大文档禁止全量 |
| `{业务集成目标说明}` | 业务需求描述（登录体验 / 会话时长 / 登出行为等） | 全量（由总调度提供，缺省时以集成指南 + 现状推断并标注开放问题） |
| `.opencode/rules/spec/spec-template.md` | spec 正文模板 | 全量（小文件） |
| `.opencode/rules/spec/spec-workflow.md` | 工作流约束 | 全量（小文件） |
| `.opencode/rules/global/code-style.md` | 代码风格 / 安全（Cookie 配置等） | 按需 |
| `.opencode/rules/global/naming-conventions.md` | 命名规范 | 按需 |
| 现有源码（限定范围） | 规格与实现现实对齐 | 只读与 SSO 直接相关的文件 |
| `package.json` | 核对技术栈 | 全量 |

---

## 五、Prompt A — SSO Spec 生成

### 一、通用模板

```
你是 nextjs-spec-generator，任务：基于 SSO IDP SP 集成指南与业务集成目标，生成【{SPEC_NAME}】需求规格文档初稿。

【必读规则文件】（按顺序读取，禁止跳过）
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md  — spec 正文模板结构
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 工作流与命名规范
3. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md — 命名规范（含 spec 文件命名）
4. {PROJECT_ROOT}/.opencode/rules/global/code-style.md   — 代码风格与安全约束（Cookie 配置、错误码格式）
5. {PROJECT_ROOT}/.opencode/rules/INDEX.md               — 规则体系导航

【输入文件】
1. {PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md（SSO 第三方契约，唯一技术契约来源）
   - 必读章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档）
   - 作用：提取 IDP 能力、端点契约、安全要求、流程约束，作为 FR 的技术依据
2. {PROJECT_ROOT}/{BUSINESS_INPUT_FILE}（业务集成目标说明，如存在）
   - 全量读取
   - 作用：提取登录体验、会话时长、登出行为等业务需求
3. {PROJECT_ROOT}/package.json
   - 核对技术栈：Next.js 15 App Router + TypeScript + Tailwind + zod
4. 现有源码（限定范围，用于规格与实现现实对齐）：
   - {SOURCE_CONTEXT}
   - 禁止通读全量源码，仅读取与 SSO 集成直接相关的文件

【输出】
- 文件路径：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.0.md
- 状态：draft
- 严格遵循 spec-template.md 结构：变更记录 / 背景与目标 / 用户故事 / 功能需求 / 非功能需求 / 边界与排除项 / 验收标准

【硬性约束】
1. 禁止照搬集成指南的示例代码，仅参考协议/端点/安全约束（FR 以集成指南契约 + 业务集成目标为准）
2. 所有功能需求必须编号（FR-001、FR-002...），编号连续无缺漏
3. 所有验收标准必须可测试、可验证（checkbox 列表，AC-001 起）
4. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式（如 AUTH_LOGIN_INVALID_CREDENTIALS、AUTH_LOGIN_IDP_UNREACHABLE、AUTH_TOKEN_REFRESH_FAILED）
5. 禁止创建多个版本文件（始终只有一份：文件名 `spec-{SLUG}-v1.0.md`，内部版本号与文件名一致）
6. 单文件 ≤ 500 行；若超出，在"边界与排除项"说明拆分计划
7. 必须明确"不做什么"（边界与排除项章节）
8. spec 阶段禁止做技术选型、模块划分、数据模型等架构决策（属于架构设计阶段）
9. 每个 FR 必须可追溯到集成指南章节（如 §3.2 Authorize、§4.1 核心流程）或业务集成目标
10. 安全需求必须与集成指南 §5 一致，至少覆盖：
    - PKCE 强制（code_challenge_method=S256）
    - state ≥ 32 字符随机串 + 校验（CSRF 防御）
    - id_token 验证（签名/iss/aud/exp/nonce，strict 模式）
    - Cookie：httpOnly + secure（生产）+ sameSite=lax + maxAge（access_token 15 分钟，按 §5.4）
    - client_secret 仅服务端（禁止 NEXT_PUBLIC_ 前缀）
    - 开放重定向防御（next/post_logout_redirect_uri 白名单校验）
    - 日志不输出 Token / Session ID
    - token 交换 / 撤销 / 刷新必须经 SP 后端转发，前端禁止直接调用 IDP token 端点（按 §5.7）
    - SSO 端点访问须考虑速率限制（429 + Retry-After + 指数退避，按 §5.8）
11. 需在"开放问题"或"边界"中标注需求基线缺口（如集成指南未覆盖的业务决策）

【验收标准】
- 文件已创建在 {PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.0.md
- 包含模板所有必备章节
- FR 编号连续无缺漏
- AC 编号连续且可测试
- 每个 FR 可追溯到集成指南章节或业务目标
- 引用的集成指南章节准确无误
- 未照搬集成指南示例代码（FR 仅体现契约 / 端点 / 安全约束）
- 未混入架构设计内容（技术选型/模块划分/数据模型）
- 涉及认证/会话/密钥的 FR 已覆盖 §5 安全要求

完成后返回：
- 文件路径
- 章节大纲
- FR/AC 数量统计
- 需求基线覆盖情况（引用的集成指南章节清单 + 业务目标覆盖数/总数）
- 开放问题清单（业务决策缺口）
- 阻塞问题（如有）
```

### 二、参数填充表

| 参数 | `spec-sso-auth` 值 | `spec-sso-token` 值 |
|------|-------------------|---------------------|
| `{SPEC_NAME}` | SSO 登录认证、会话与登出 | SSO Token 生命周期与安全强化 |
| `{SLUG}` | `sso-auth` | `sso-token` |
| `{FRAMEWORK_SECTIONS}` | `§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.5、§3.7、§3.8、§4.1、§4.3、§5、§7（7.1.1 / 7.1.3）` | `§3.3、§3.6、§3.7、§4.2、§4.3、§5.6、§7（7.1.2 / 7.1.3）` |
| `{BUSINESS_INPUT_FILE}` | `docs/sso-business-goals.md`（如存在，否则省略并标注） | 同左 |
| `{SOURCE_CONTEXT}` | `middleware.ts、app/lib/env.ts、next.config.ts、app/api/solve/route.ts、app/layout.tsx、app/layout-client.tsx` | 同左 |
| `{PROJECT_ROOT}` | `/var/learning` | `/var/learning` |

> **注**：`{BUSINESS_INPUT_FILE}` 由总调度在派发前确认是否存在；若不存在，Prompt A 的输入文件 2 改为「无业务集成目标说明，以集成指南 + 源码现状为基线，业务缺口列入开放问题」。

---

## 六、Prompt B — SSO Spec 评审

### 一、通用模板

```
你是 nextjs-spec-reviewer，任务：对【{SPEC_NAME}】spec 第 {ROUND} 轮评审。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md  — 评审角色职责与命名
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md  — 评审对照模板

【输入文件】
1. 待评审 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{VERSION}.md
2. 集成指南（第三方契约，核对对象）：{PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 对照章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档，按 §0.2 按需加载）
   - 核对 spec 中的 OIDC 流程、端点契约、安全要求与集成指南是否一致
3. 现有源码上下文（核对实现现实）：
   - {SOURCE_CONTEXT}
   - 仅读取上述文件，禁止通读全量源码
4. 上轮评审意见（仅当 {ROUND} > 1）：
   - {PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{PREV_ROUND}.md
   - 核对上轮问题是否已在当前版本解决

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r{ROUND}.md
- 评审意见文件一旦归档禁止修改
- 严格遵循 spec-template.md 中的"评审意见文件模板"

【评审维度】（逐项检查，每项给出结论）
1. 完整性：模板必备章节是否齐全；FR/AC 编号是否连续
2. 可追溯性：每个 FR 是否可追溯到集成指南章节或业务目标；有无遗漏或超出范围
3. 准确性：是否与集成指南契约一致；有无曲解 IDP 能力或端点行为
4. 第三方对齐（SSO 专项重点）：授权码 + PKCE 流程、Discovery/Authorize/Token/UserInfo/Revoke/End Session 端点、scope→claim 映射、refresh_token 轮换、登出身份校验逻辑，是否与集成指南一致
5. 可测试性：每个 AC 是否可验证、可测试
6. 边界清晰度："边界与排除项"是否明确不做什么（如 SAML、SLO、Back-Channel Logout 是否本期范围）
7. 合规性：是否违反 spec-workflow.md 的 MUST/MUST NOT；是否混入架构设计内容（技术选型/模块划分/数据模型）；错误码格式是否合规；是否照搬集成指南示例代码（应仅体现契约 / 端点 / 安全约束，禁止代码级照搬）
8. 一致性：FR 与 AC 是否对应；有无需求遗漏或冗余
9. 安全性（SSO 专项重点）：PKCE、state CSRF、id_token 验证、Cookie 标志、client_secret 保护、开放重定向防御、日志脱敏是否覆盖；是否包含敏感信息泄露风险；是否缺少输入验证要求
10. 现状对齐：FR 是否考虑现有 middleware.ts / env.ts / next.config.ts 的实际现状（如 Edge Runtime 约束、CSP 影响）

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
4. 不得代替需求方做业务决策（业务模糊应标记为问题/开放问题，而非自行决断）
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

其余参数（`{SPEC_NAME}`、`{SLUG}`、`{FRAMEWORK_SECTIONS}`、`{SOURCE_CONTEXT}`、`{PROJECT_ROOT}`）与 Prompt A 一致。

---

## 七、Prompt C — SSO Spec 修订

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
3. 集成指南（如需核对）：{PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 核对章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档，按 §0.2 按需加载）
4. 现有源码上下文（如需核对）：{SOURCE_CONTEXT}
   - 仅读取上述文件，禁止通读全量源码

【操作要求】
1. 在原 spec 文件上直接修订（不新建文件）
2. 文件内版本号更新为 v{NEXT_VERSION}
3. 在"变更记录"表格新增一行：v{NEXT_VERSION} | 日期 | 根据 r{ROUND} 评审修订 | review-r{ROUND}
4. 状态保持 draft（未通过终审前不改为 approved）
5. 修订完成后，将文件重命名为 {PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{NEXT_VERSION}.md（文件名随内部版本号同步更新，任意时刻仅存一份最新版）

【修订原则】
1. 逐条对照评审问题清单（R{ROUND}-001、R{ROUND}-002...）修订
2. 阻塞级问题必须全部解决
3. 重要级问题必须解决或给出不解决的理由（在变更记录或修订说明中标注）
4. 建议级问题酌情采纳
5. 禁止将评审意见原文直接粘贴进 spec
6. 禁止删除已通过的 FR/AC，仅可修改或新增
7. 若评审意见涉及业务决策缺口且业务集成目标未澄清，标记为待业务方确认，不自行决断
8. 修订内容同样禁止照搬集成指南示例代码，仅参考契约 / 端点 / 安全约束

【硬性约束】
1. 禁止新建版本文件，始终在原文件修订（修订后按操作要求 5 重命名为最新版本文件，任意时刻仅存一份）
2. 禁止改动与评审意见无关的内容
3. 修订后 FR/AC 编号必须保持连续
4. 修订后仍需保持所有必备章节完整
5. 单文件 ≤ 500 行

【验收标准】
- 文件已重命名为 spec-{SLUG}-v{NEXT_VERSION}.md 且内部版本号为 v{NEXT_VERSION}（文件名与内部版本号一致）
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

## 八、Prompt D — SSO Spec 终审

> **适用角色**：总调度 agent 自行执行（不调度子 agent），按 [§4.1.4](./AI-Prompt使用规范.md)。

```
你是总调度收尾 agent，任务：汇总【{SPEC_NAME}】spec 的第 2 轮修订结果，做最终决议。

【输入文件】
1. 第 2 轮修订后的 spec：{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.2.md
2. 第 2 轮评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r2.md
3. 第 1 轮评审意见：{PROJECT_ROOT}/docs/reviews/spec-{SLUG}-review-r1.md
4. 集成指南（核对需求基线覆盖）：{PROJECT_ROOT}/docs/integration-guides/sso-idp-sp-integration-guide.md
   - 对照章节：{FRAMEWORK_SECTIONS}
   - 仅读取上述章节，禁止全量加载（92KB 大文档，按 §0.2 按需加载）

【任务】
1. 读取第 2 轮修订后的最新版 spec（{PROJECT_ROOT}/docs/specs/spec-{SLUG}-v1.2.md）与 r1、r2 两份评审意见（v1.1 的修订过程追溯由 review-r2 内含的「r1 问题解决状态核对」覆盖，无需直接读取 v1.1 文件）
2. 核对修订版是否已解决 r1、r2 中的所有阻塞级问题
3. 核对 spec 是否覆盖需求基线（集成指南 {FRAMEWORK_SECTIONS} 对应能力 + 业务集成目标）
4. 做决议：
   - v1.2 已解决全部阻塞问题 + 需求基线全覆盖 → 将 spec 状态从 draft 改为 approved
   - 仍存在未解决的阻塞问题或需求遗漏 → 标记为 blocked，列出剩余问题，请求人工介入（不进入第 3 轮）
5. 输出汇总报告（直接回复，不写文件）：
   - spec 终审状态（approved / blocked）
   - 阻塞问题清单（如有）
   - 阻塞问题解决率（已解决数/两轮问题总数）
   - 需求基线覆盖率（已覆盖能力数/集成指南指定能力数）
   - 是否可进入架构设计阶段
   - Spec→架构衔接要点（如：会话存储选型、middleware 认证校验实现、CSP 调整、SSO 环境变量设计等需架构阶段重点设计）

【硬性约束】
1. 仅修改状态字段，不改动 spec 正文内容
2. approved 状态的 spec 才可交给 nextjs-architect
3. draft 状态的 spec 禁止进入架构设计/开发
4. 终审仅核查 r1、r2 阻塞问题是否解决，不重新发现新问题（防止无限循环）
5. 需求基线覆盖率必须 100%，任何遗漏都视为阻塞
6. 终审不得代替需求方做业务决策
```

### 二、参数填充表

| 参数 | `spec-sso-auth` 值 | `spec-sso-token` 值 |
|------|-------------------|---------------------|
| `{SPEC_NAME}` | SSO 登录认证、会话与登出 | SSO Token 生命周期与安全强化 |
| `{SLUG}` | `sso-auth` | `sso-token` |
| `{FRAMEWORK_SECTIONS}` | `§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.5、§3.7、§3.8、§4.1、§4.3、§5、§7（7.1.1 / 7.1.3）` | `§3.3、§3.6、§3.7、§4.2、§4.3、§5.6、§7（7.1.2 / 7.1.3）` |
| `{PROJECT_ROOT}` | `/var/learning` | `/var/learning` |

> **注**：终审输入为 v1.2（固定），与 r2 修订产出一致；参数值复用 Prompt A 参数表。

---

## 九、调度执行顺序

> 单个 spec 严格串行执行以下步骤；`spec-sso-auth` 与 `spec-sso-token` 在阶段 1 可并行，各 spec 闭环相互独立。

```
Step 1 [串行] Prompt A — SSO Spec 生成（nextjs-spec-generator）
   ├─ 前置条件：确认集成指南存在；确认业务集成目标文件是否存在（不存在则省略并标注）
   ├─ 产出验证：spec-{SLUG}-v1.0.md 存在、状态 draft、FR/AC 编号连续、未混入架构内容
   └─ 未通过 → 修订 Prompt A 后重发（最多 2 次），仍失败标记 blocked

Step 2 [串行] Prompt B — 评审 r1（nextjs-spec-reviewer）
   ├─ 产出验证：review-r1 存在、编号 R1-xxx 连续、每个问题有修订建议
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 3（强制满 2 轮，不提前 approved）

Step 3 [串行] Prompt C — 修订 r1（nextjs-spec-generator）
   ├─ 输入：spec-v1.0 + review-r1
   ├─ 产出验证：spec-v1.1 存在（已重命名）、文件名与内部版本号一致、变更记录已加行、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt C（最多 2 次）

Step 4 [串行] Prompt B — 评审 r2（nextjs-spec-reviewer）
   ├─ 输入：spec-v1.1 + review-r1（核对遗留问题）
   ├─ 产出验证：review-r2 存在、含上轮问题解决率、编号 R2-xxx 连续
   └─ 评审结论为「需修订」或「通过」→ 均进入 Step 5（强制满 2 轮）

Step 5 [串行] Prompt C — 修订 r2（nextjs-spec-generator）
   ├─ 输入：spec-v1.1 + review-r2
   ├─ 产出验证：spec-v1.2 存在（已重命名）、文件名与内部版本号一致、阻塞问题全解决
   └─ 未通过 → 重新派发 Prompt C（最多 2 次）

Step 6 [串行] Prompt D — 终审（总调度自行执行）
   ├─ 输入：spec-v1.2 + review-r1 + review-r2 + 集成指南
   ├─ 决议：approved（改状态字段）/ blocked（人工介入）
   └─ 终审通过 → spec 进入架构设计阶段
```

**故障恢复**（按 [§5.4](./AI-Prompt使用规范.md)）：瞬时错误自动重试（最多 3 次，指数退避）；参数错误修正后重新派发；子 agent 产出不符合验收标准时分析原因、修订 Prompt 后重发（最多 2 次）；仍失败标记 blocked 请求人工介入。

**超时设置**（按 [§5.4.3](./AI-Prompt使用规范.md)）：spec 生成 5 分钟 / 评审 5 分钟 / 修订 5 分钟 / 终审 2 分钟。

---

## 十、关键设计要点

| 要点 | 说明 |
|------|------|
| **强制满 2 轮** | 用户明确要求，区别于规范默认；即使 r1 干净也必须走 r2，至少审核修订 2 轮才能终审 |
| **需求基线** | 无 approved PRD，以「SSO 集成指南（第三方契约）+ 业务集成目标 + 源码现状」为 spec 需求来源；业务缺口列开放问题，不自行决断 |
| **角色隔离** | reviewer 只评审不修订（T5）；generator 只生成/修订（T6）；终审由总调度执行，子 agent 不互相调用 |
| **上下文隔离** | 集成指南 92KB 大文档只读指定章节（P2/T2/T3）；现有源码限定范围读取；禁止全量加载 |
| **版本控制** | 单文件原则，文件名随版本递增 v1.0→v1.1→v1.2（以 spec-workflow 命名规范为准；与 T7「文件名不变」的差异为有意选择，见 §三 取舍依据）；评审意见独立归档禁止修改 |
| **依赖串行** | 生成→评审→修订→评审→修订→终审严格串行，保证每阶段产出经过验证 |
| **并行度** | `spec-sso-auth` 与 `spec-sso-token` 独立可并行；有依赖的功能域拆到不同 spec 或先后执行 |
| **阻塞兜底** | 自动流程最多 2 轮，终审仍阻塞则 blocked，不无限循环（T9） |
| **安全专项** | SSO spec 必须与集成指南 §5 安全要求一致（PKCE、state CSRF、id_token 验证、Cookie 标志、client_secret 保护、开放重定向防御、日志脱敏） |
| **现状对齐** | FR 必须考虑 middleware Edge Runtime 约束、matcher 范围（当前仅 /api/*，页面路由保护需评估扩展）、CSP `connect-src 'self'` / `frame-src 'none'` 对 SSO 的影响、env.ts 校验模式复用 |
| **返回格式** | 每个 Prompt 末尾要求返回结构化摘要，便于总调度决策（T10） |

---

## 十一、文件清单（预期产出）

| 文件 | 阶段 | 状态 |
|------|------|------|
| `docs/specs/spec-{SLUG}-v1.0.md` | 生成 | draft |
| `docs/specs/spec-{SLUG}-v1.1.md` | 修订 r1 | draft（原文件修订） |
| `docs/specs/spec-{SLUG}-v1.2.md` | 修订 r2 | **approved**（终审通过后状态字段） |
| `docs/reviews/spec-{SLUG}-review-r1.md` | 评审 r1 | 归档只读 |
| `docs/reviews/spec-{SLUG}-review-r2.md` | 评审 r2 | 归档只读 |

> **说明**：按 [spec-workflow.md](../.opencode/rules/spec/spec-workflow.md)，spec 采用"单文件 + 文件名带版本号"：每轮修订在原文件上直接修改并递增版本号，文件名同步更新为最新版本；评审意见文件按轮次独立归档。
>
> **单文件语义**：上表 `spec-{SLUG}-v1.0.md / v1.1.md / v1.2.md` 三行为**同一物理文件在不同轮次的版本名**，任意时刻仅存一份最新版（v1.0 → v1.1 → v1.2），非三份并存文件。若需确认当前版本，以 `docs/specs/` 下实际存在的 `spec-{SLUG}-v*.md` 文件名为准。

---

## 十二、文档维护

| 触发条件 | 操作 |
|---------|------|
| 新增 SSO spec（如 Back-Channel Logout、DPoP、PAR） | 在 §一 任务拆分追加行，按本方案模板填充参数 |
| 集成指南章节变更 | 同步更新 §一/§五/§六 的 `{FRAMEWORK_SECTIONS}` 引用 |
| 规则文件变动 | 同步更新 Prompt 中引用的 `.opencode/rules/` 路径 |
| 实践发现新坑点 | 补充到 §十 关键设计要点 |
| 调度流程变更 | 更新 §二/§九，更新版本号 |

**版本历史**：

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-10 | 初稿创建：面向 SSO 专项的 Spec 阶段调度 prompt 方案；基于 AI-Prompt 使用规范 v2.9 §4.1/§5.5；强制满 2 轮评审；需求基线为「集成指南 + 业务目标 + 源码现状」（无 approved PRD）；含 sso-auth / sso-token 两个功能域 |
| v1.1 | 2026-08-10 | 第 1 轮评审（[review-r1](./reviews/spec-prompt-plan-sso-review-r1.md)）后修订：Prompt C 补文件重命名步骤与验收标准（阻塞）；按集成指南 §0.2 能力映射修正 sso-auth / sso-token 的 FRAMEWORK_SECTIONS（补 §3.5/§4.2/§4.3/§7 子节）；声明版本策略与 T7 的取舍依据；Prompt D 补参数表；Prompt B 合规维度补照搬检查；Prompt B/C/D 补禁止全量加载声明；Prompt A 安全约束补 maxAge/速率限制/前端禁止直连 token 端点；§二 前置条件补业务目标文件检查；§四/§十一 补说明性注释 |
| v1.2 | 2026-08-10 | 第 2 轮评审（[review-r2](./reviews/spec-prompt-plan-sso-review-r2.md)）后修订：Prompt D 任务 1 改为读取最新版 v1.2 + r1/r2 评审意见（修复重命名回归，重要）；§三 取舍依据回退列举补 §五-§八；§四 4.1 / §十 补 middleware matcher 范围约束提示 |

> **注**：依据规范 [AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md) 自身版本历史仅记录至 v2.5，本方案引用的 §4.1/§5.5/§8.2/§9.3/§11.2/§11.5 在 v2.6-v2.9 若有变更，需在规范补全版本历史后回查确认本方案是否受影响。
