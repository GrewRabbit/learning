# 修订阶段调度 Prompt 方案（全站登录墙专项）

> **用途**：总调度 agent 指挥子 agent 完成「SSO 集成」已 approved 文档的**业务决策变更修订**闭环
> **范围**：将受保护资源范围从「仅 `/api/solve`」扩展为「全站登录墙」（除公开白名单外全部页面路由与 API 均需登录），同步修订 spec-sso-auth 与 arch-sso（含 fr-matrix 交叉引用核对）
> **性质**：非新 spec，非评审轮次修订——是**业务决策变更**（OQ-001 候选 A→B 反转），在已 approved v1.2 基础上升版 v1.3
> **评审策略**：**1 轮评审**（用户已确认）——本次变更点集中（受保护资源范围 + 白名单 + 页面校验），1 轮严格评审即达质量门
> **版本**：v1.0
> **创建时间**：2026-08-11
> **依据规范**：[AI-Prompt 使用规范 v2.9](./AI-Prompt使用规范.md)（§4.1 spec 修订、§4.2 架构修订、§0.7 调度元 Prompt）
> **规则来源**：`.opencode/rules/`（以 `.opencode/` 为准）
> **需求基线**：已 approved 的 `spec-sso-auth-v1.2.md`、`spec-sso-token-v1.2.md` + 用户业务决策确认（见下）+ 现有源码现状

---

## 一、业务决策变更清单（用户已确认）

| 编号 | 变更前（v1.2 已 approved） | 变更后（v1.3） |
|------|---------------------------|---------------|
| D-001 | 受保护资源 = 仅 `/api/solve`（OQ-002 裁决） | **全站登录墙**：仅 `/` 首页公开，其余所有页面路由 + API 均需登录态 |
| D-002 | middleware matcher = `['/api/:path*']`，页面路由匿名 | matcher 扩展覆盖页面路由；认证粗检范围同步扩展 |
| D-003 | 无页面层认证 | `/solve`、`/result` 等页面路由需登录（RSC 层或 middleware 校验） |
| D-004 | 公开资源（隐式） | 显式白名单：`/`、`/login`、`/api/sso/*`（OIDC 回调链）、`/api/health` 等运维接口 |
| D-005 | `/login` 页面无真实功能（middleware 302 目标） | `/login` 页面落地：SP-Initiated OIDC 登录入口页 |
| D-006 | 未来订单/结算系统（待规划） | 全部业务资源「先认证后访问」为统一原则，认证基础设施预留订单系统接入，但**本次不实施订单功能** |

**用户明确答复（原话要点）**：
- 页面只有 `http://localhost:3000/` 不需要登录，其他页面都需要登录状态才能打开
- 未来在用户登录基础上开发针对本网站使用用户的简单订单和结算系统，所有资源先认证后访问
- 本次只出认证墙，订单/结算另行安排；首页始终公开可浏览（不强推登录，不展示个人信息）
- 公开白名单：`/login` 登录页、`/api/sso/*` 回调、`/api/health` 等运维接口

---

## 二、任务拆分方案

| 阶段 | 任务 | 目标 Agent | 输入 | 输出 | 优先级 |
|------|------|-----------|------|------|:----:|
| S1 修订 | spec-sso-auth v1.2→v1.3（决策变更） | nextjs-spec-generator | v1.2 + 本方案变更清单 + 源码现状 | `docs/specs/spec-sso-auth-v1.3.md`（draft） | P0 |
| S2 评审 | spec-sso-auth v1.3 评审（1 轮） | nextjs-spec-reviewer | v1.3 + token v1.2 + 本方案 | `docs/reviews/spec-sso-auth-review-r1.md` | P0 |
| S3 修订 | spec-sso-auth 按 r1 修订 | nextjs-spec-generator | v1.3 + review-r1 | `docs/specs/spec-sso-auth-v1.3.md`（修订） | P0 |
| S4 终审 | spec-sso-auth 终审 | 总调度 agent（自行执行） | v1.3 + review-r1 | approved / blocked 决议 | P0 |
| A1 修订 | arch-sso v1.2→v1.3（AD-01 变更）+ fr-matrix | nextjs-architect | approved spec-v1.3 + arch-v1.2 + fr-matrix | `docs/architecture/arch-sso-v1.3.md`（draft）+ fr-matrix 更新 | P0 |
| A2 评审 | arch-sso v1.3 评审（1 轮） | nextjs-architecture-reviewer | v1.3 + 两份 spec + 本方案 | `docs/reviews/arch-sso-review-r1.md` | P0 |
| A3 修订 | arch-sso 按 r1 修订 | nextjs-architect | v1.3 + review-r1 | `docs/architecture/arch-sso-v1.3.md`（修订） | P0 |
| A4 终审 | arch-sso 终审 | 总调度 agent（自行执行） | v1.3 + review-r1 + spec-v1.3 | approved / blocked 决议 | P0 |

**范围外**：`spec-sso-token` 不修订（用户已确认），仅核对交叉引用一致性（A1 阶段 architect 核对 token FR-003/FR-024 与 auth 新范围的引用）；订单/结算系统 spec 本次不产出。

---

## 三、修订核心约束（S1 阶段注入）

1. **受保护资源范围**：除白名单（`/`、`/login`、`/api/sso/*`、`/api/health`）外，全部页面路由 + API 需登录。`/api/sso/*` 是 OIDC 授权码回调链，必须公开（否则死循环）；`/login` 是登录入口页本身。
2. **页面层校验**：沿用既有两层运行结构——middleware（Edge）cookie 级粗检（禁 client_secret，FR-016 不变）+ Node 层深度校验。页面路由的深度校验落点由 spec 定义（如 RSC server component 校验或布局级校验），architect 阶段落实现方案。
3. **首页 `/`**：始终公开可浏览，不重定向登录、不强推登录、不展示个人信息。
4. **middleware matcher 扩展**：需覆盖页面路由，但 `/_next/*` 等静态资源与 `favicon` 不得被拦（Next.js 惯例，architect 落 matcher 表达式）。
5. **`/login` 页面**：落地为 SP-Initiated OIDC 登录入口（触发 authorize 跳转），需新增需求 FR；当前代码库不存在 `/login` 路由。
6. **错误码/安全约束不变**：错误码分区制、middleware 禁引用 SSO 密钥 env、`exp` 过期即重登等 v1.2 已确认机制全部保留，仅范围扩展。
7. **未来订单系统**：在 spec/arch 中体现「认证基础设施先行」原则与可扩展性说明，不实施订单功能、不新增订单 FR。

---

## 四、调度架构

```
[启动] 总调度 agent
  ├─ 前置检查：确认 spec-sso-auth-v1.2/arch-sso-v1.2 状态 approved、fr-matrix 存在
  ├─ [S1] 调度 1× nextjs-spec-generator → spec-sso-auth-v1.3.md（draft）
  ├─ [S2] 调度 1× nextjs-spec-reviewer → spec-sso-auth-review-r1.md
  ├─ [S3] 调度 1× nextjs-spec-generator → 修订 spec-sso-auth-v1.3.md
  ├─ [S4] 终审（总调度）→ approved / blocked
  ├─ [A1] 调度 1× nextjs-architect → arch-sso-v1.3.md + fr-matrix 核对
  ├─ [A2] 调度 1× nextjs-architecture-reviewer → arch-sso-review-r1.md
  ├─ [A3] 调度 1× nextjs-architect → 修订 arch-sso-v1.3.md
  └─ [A4] 终审（总调度）→ approved / blocked
```

**调度原则**：S 系列串行（spec approved 后才进架构）；A 系列串行；spec 与架构评审角色隔离（reviewer 只输出意见文件，禁止改正文）；终审由总调度统一裁决，仅核查阻塞问题与需求基线全覆盖，不发现新问题。

**版本与文件规则**（沿袭既有方案）：spec 正文 `docs/specs/spec-sso-auth-v1.3.md`（文件名随版本递增，任意时刻仅存一份最新版）；评审意见 `docs/reviews/spec-sso-auth-review-r1.md`、`docs/reviews/arch-sso-review-r1.md`（归档禁改）；状态 draft → approved。

---

## 五、Prompt C' — spec-sso-auth 决策变更修订

### 通用模板

```
你是 nextjs-spec-generator，任务：对【spec-sso-auth】spec 执行【业务决策变更修订】（非评审轮次修订）。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/spec/spec-workflow.md
2. {PROJECT_ROOT}/.opencode/rules/spec/spec-template.md
3. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md

【输入文件】
1. 当前 spec：{PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.2.md
2. 决策变更清单：{PROJECT_ROOT}/docs/修订调度prompt方案-全站登录墙.md §一
3. 关联 spec（交叉引用核对）：{PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md
4. 现有源码上下文（如需核对，仅读取指定文件）：
   - {PROJECT_ROOT}/middleware.ts
   - {PROJECT_ROOT}/app/lib/auth/guard.ts
   - {PROJECT_ROOT}/app/solve/page.tsx、app/result/page.tsx、app/page.tsx（是否存在/是否接入认证）

【操作要求】
1. 在原 spec 文件上直接修订，修订后重命名为 spec-sso-auth-v1.3.md（文件名随版本递增，任意时刻仅存一份）
2. 文件内版本号更新为 v1.3，状态保持 draft
3. 在"变更记录"表格新增一行：v1.3 | 2026-08-11 | 业务决策变更：受保护资源范围扩展为全站登录墙（D-001~D-006）| 修订调度prompt方案-全站登录墙 §一

【修订范围（严格限定于决策变更）】
1. D-001：受保护资源范围从「仅 /api/solve」扩展为「全站登录墙」——修订概述、US、FR（尤其是 FR-016 分层校验的适用对象）、NFR-004、相关 AC
2. D-002：middleware 认证粗检范围扩展——修订 FR-016 相关描述与 matcher 语义（matcher 具体表达式归架构，spec 只定义范围与约束）
3. D-003：页面路由需登录——新增或修订 FR，定义页面层登录态判定与未登录 302 行为
4. D-004：公开白名单显式化——新增 FR 定义白名单：/、/login、/api/sso/*（OIDC 回调链）、/api/health 等运维接口；说明 /api/sso/* 与 /login 必须公开的原因（防死循环）
5. D-005：/login 页面落地为 SP-Initiated OIDC 登录入口——新增需求 FR（登录入口页触发 authorize 跳转、returnTo 透传）
6. D-006：体现「全部业务资源先认证后访问」的统一原则，为未来订单/结算系统预留（可在概述或 NFR 层说明，不新增订单功能 FR）
7. 同步更新 OQ-001/OQ-002/OQ-003/OQ-009 的裁决状态（已由业务方确认，从开放问题转为已裁决，移除或标注）

【硬性约束】
1. 禁止改动与决策变更无关的内容（错误码分区制、过期即重登、续期衔接、cookie 属性等已确认机制全部保留）
2. 禁止删除已通过的 FR/AC，仅可修改或新增
3. 修订后 FR/AC 编号保持连续；单文件 ≤ 500 行
4. 不新增 spec-sso-token 范围的内容（token 生命周期归 token spec，本次不修订 token spec，仅核对交叉引用一致性）
5. 禁止将集成指南示例代码照搬，仅参考契约/端点/安全约束

【验收标准】
- 文件重命名为 spec-sso-auth-v1.3.md 且内部版本号为 v1.3
- 变更记录已新增 v1.3 行
- D-001~D-006 全部在 spec 中体现
- 全站登录墙范围与公开白名单表述清晰无歧义
- FR/AC 编号连续，必备章节完整
- 输出变更对照表：变更点 | 修订位置 | 说明

完成后返回：文件路径、变更对照表、新增/修改的 FR 编号清单、待业务方确认清单（如有）。
```

---

## 六、Prompt B' — spec-sso-auth v1.3 评审

沿用既有 Spec 阶段方案 Prompt B 模板（nextjs-spec-reviewer），输入调整为：`spec-sso-auth-v1.3.md` + `spec-sso-token-v1.2.md` + `docs/修订调度prompt方案-全站登录墙.md` §一/§三。评审重点：
1. 全站登录墙范围与白名单（`/`、`/login`、`/api/sso/*`、`/api/health`）表述是否无歧义、是否有遗漏
2. 页面层校验与既有两层运行结构（FR-016）是否衔接一致、有无破坏 middleware 禁 client_secret 约束
3. 与 token spec 的交叉引用是否一致
4. 是否有超范围改动（本次为决策变更，不应引入无关修订）
5. OQ-001~OQ-009 裁决状态更新是否恰当
6. 首页 `/` 公开语义（不强推登录、不展示个人信息）是否被正确规格化

---

## 七、Prompt G' — arch-sso 决策变更修订

### 通用模板

```
你是 nextjs-architect，任务：对【arch-sso】架构文档执行【业务决策变更修订】（非评审轮次修订）。

【必读规则文件】
1. {PROJECT_ROOT}/.opencode/rules/dev/dev-workflow.md
2. {PROJECT_ROOT}/.opencode/rules/dev/api-conventions.md
3. {PROJECT_ROOT}/.opencode/rules/dev/component-rules.md
4. {PROJECT_ROOT}/.opencode/rules/global/code-style.md
5. {PROJECT_ROOT}/.opencode/rules/global/naming-conventions.md

【输入文件】
1. 当前架构：{PROJECT_ROOT}/docs/architecture/arch-sso-v1.2.md
2. 已 approved spec：{PROJECT_ROOT}/docs/specs/spec-sso-auth-v1.3.md（唯一需求来源）
3. 关联 spec（交叉引用）：{PROJECT_ROOT}/docs/specs/spec-sso-token-v1.2.md
4. FR 矩阵：{PROJECT_ROOT}/docs/architecture/arch-sso-fr-matrix.md
5. 决策变更清单：{PROJECT_ROOT}/docs/修订调度prompt方案-全站登录墙.md §一
6. 现有源码（如需核对）：{PROJECT_ROOT}/middleware.ts、app/lib/auth/guard.ts、app/solve/page.tsx、app/result/page.tsx、app/page.tsx、app/api/sso/*、app/components/auth/*
7. 集成指南（如需核对，仅读指定章节）

【操作要求】
1. 在原架构文件上直接修订，修订后重命名为 arch-sso-v1.3.md（文件名随版本递增，任意时刻仅存一份）
2. 文件内版本号更新为 v1.3，状态保持 draft
3. 文件头部变更记录新增一行：v1.3 | 2026-08-11 | 业务决策变更：全站登录墙（AD-01 变更）| 修订调度prompt方案-全站登录墙 §一
4. 同步更新 arch-sso-fr-matrix.md 中受影响的 auth FR 落点与 token FR 交叉引用

【修订范围（严格限定于决策变更）】
1. **AD-01 变更**：受保护资源范围从「仅 /api/solve」改为「全站登录墙」，middleware matcher 扩展覆盖页面路由
2. **matcher 表达式**：给出具体 matcher 实现方案（覆盖页面路由 + API，豁免 /_next/* 静态资源、favicon、/login、/api/sso/*、/api/health；注意 OIDC 回调链与登录页不得被 302 循环拦截）
3. **页面层认证落点**：RSC server component 校验 vs 布局级校验 vs middleware 兜底的实现方案，与 M5 guard（requireAuth）复用或扩展
4. **/login 页面模块**：新增 SP-Initiated 登录入口页设计（触发 authorize、returnTo 透传），复用既有 app/lib/sso/oauth-client 能力
5. **首页 / 保持公开**：matcher 与校验逻辑对 / 豁免，不强推登录
6. **未来订单系统预留**：架构层面说明认证基础设施的扩展性（如路由分组、认证守卫复用），不新增订单模块设计
7. **§9.2 OQ-001**：从「以 A 设计」更新为「已裁决 B（全站登录墙）」，同步 OQ-002 相关行

【硬性约束】
1. 禁止改动与决策变更无关的架构内容（两层运行结构、token 轮换、限流先于认证、JWKS 复用等已确认架构全部保留）
2. 两层运行结构职责划分不得破坏：middleware Edge 无 client_secret / Node 层深度校验
3. 禁止使用 any；禁止跨模块 ../ 引用；单文件 ≤ 500 行
4. 技术选型修改必须与 package.json 一致
5. 与 spec-sso-token v1.2 的交叉引用保持一致（token FR-003/FR-024 等被引用处需核对语义在新范围下仍成立）

【验收标准】
- 文件重命名为 arch-sso-v1.3.md 且内部版本号为 v1.3
- AD-01 变更完整落地，matcher 表达式明确
- 页面层认证落点方案明确且可实施
- fr-matrix 已同步更新
- 所有必备章节完整；两份 spec FR 覆盖清单仍完整
- 输出变更对照表：变更点 | 修订位置 | 说明

完成后返回：文件路径、变更对照表、matcher 表达式方案、待业务方确认清单（如有）。
```

---

## 八、Prompt F' — arch-sso v1.3 评审

沿用既有架构阶段方案 Prompt F 模板（nextjs-architecture-reviewer），输入调整为：`arch-sso-v1.3.md` + `arch-sso-fr-matrix.md` + `spec-sso-auth-v1.3.md`（approved）+ `spec-sso-token-v1.2.md` + `package.json` + `docs/修订调度prompt方案-全站登录墙.md` §一/§三。评审重点：
1. matcher 表达式是否正确豁免 `/`、`/login`、`/api/sso/*`、`/api/health`、`/_next/*` 静态资源，无 302 死循环
2. 页面层认证落点（RSC vs 布局 vs middleware）是否与 spec 一致、与 M5 guard 复用是否合理
3. AD-01 变更是否波及两层运行结构、限流先于认证、JWKS 复用等已确认架构
4. fr-matrix 是否同步完整
5. 是否有超范围改动；token 交叉引用是否一致

---

## 九、执行顺序

1. 总调度：前置检查（v1.2 状态 approved、fr-matrix 存在）
2. S1 → S2 → S3 → S4（spec 系列串行；S4 approved 后进入架构）
3. A1 → A2 → A3 → A4（架构系列串行）
4. 全部 approved 后：更新 `docs/changelog/`（结构化修改必须记录）
5. Git 提交（用户确认后执行）

---

## 十、文件清单（预期产出）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `docs/specs/spec-sso-auth-v1.3.md` | 新增 | v1.2→v1.3 决策变更修订（spec-sso-auth-v1.2.md 删除） |
| `docs/reviews/spec-sso-auth-review-r1.md` | 新增 | 1 轮评审意见（归档禁改） |
| `docs/architecture/arch-sso-v1.3.md` | 新增 | v1.2→v1.3 决策变更修订（arch-sso-v1.2.md 删除） |
| `docs/architecture/arch-sso-fr-matrix.md` | 修改 | 受影响 FR 落点与交叉引用更新 |
| `docs/reviews/arch-sso-review-r1.md` | 新增 | 1 轮评审意见（归档禁改） |
| `docs/changelog/2026-08-11-全站登录墙规格变更.md` | 新增 | 结构化修改更新日志 |

---

## 十一、文档维护

- 本方案为本次修订的调度依据，修订完成后归档（不删除，供后续决策变更参照）
- spec/arch 正式版本号 v1.3 以文件内「版本」字段 + 文件名双确认
- 评审意见文件归档后禁止修改
