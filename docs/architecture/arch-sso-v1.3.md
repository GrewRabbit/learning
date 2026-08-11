# SSO 登录认证与 Token 生命周期（SSO 集成模块）技术架构 v1.3

**日期**：2026-08-11 ｜ **状态**：approved ｜ **版本**：v1.3
**需求来源**：`docs/specs/spec-sso-auth-v1.3.md`（approved）、`docs/specs/spec-sso-token-v1.2.md`（approved）
**技术约束**：`docs/integration-guides/sso-idp-sp-integration-guide.md`（第三方契约，仅作协议/端点/安全约束，不照搬代码）
**前置状态**：业务 OQ-004 / OQ-002（全站登录墙）/ OQ-05 / OQ-001（范围部分）/ OQ-003 已由业务方确认（§1.2、§9.2），其余业务 OQ 为开放决策项（§9.2）
**版本历史**：

| 版本 | 日期 | 变更 | 来源 |
|------|------|------|------|
| v1.0 | 2026-08-10 | 初版 | spec-sso-auth-v1.0 |
| v1.1 | 2026-08-10 | 评审修订（AR1-001~011） | arch-sso-review-r1 |
| v1.2 | 2026-08-10 | 评审修订（AR2-001~012）；§10 FR 矩阵拆分至 `arch-sso-fr-matrix.md`（R-13） | arch-sso-review-r2 |
| v1.3 | 2026-08-11 | **业务决策变更：全站登录墙（AD-01 变更）**：受保护资源范围扩展（D-001）、matcher 扩展覆盖页面路由（D-002）、页面层认证落点（D-003）、公开白名单显式化（D-004）、`/login` 入口页落地（D-005）、「全部业务资源先认证后访问」统一原则与订单系统预留（D-006）；§9.2 OQ-001/OQ-002/OQ-003/OQ-009 裁决状态同步 | 修订调度prompt方案-全站登录墙 §一 |
| v1.3 | 2026-08-11 | 评审修订（AR3-001~011）：matcher/白名单常量覆盖 `/{locale}/login` 前缀登录页（AR3-001）、「不进 matcher」表述统一（AR3-002）、§4 数据流拆分至 `arch-sso-dataflow.md`（AR3-003）、metadata 框架根资源豁免（AR3-004）、页面限流配额评估（AR3-005）、requireAuthPage 失败载体明确（AR3-006）、token-cookie Edge 兼容声明（AR3-007）、/login 复用 oauth-client 表述删除（AR3-008）、fr-matrix 补 FR-001/FR-005 v1.3 标注（AR3-009）、白名单概念澄清（AR3-010）、token spec 版本引用过时标注（AR3-011） | arch-sso-review-r1 |

> v1.3 修订遵循「业务决策变更」边界：仅改动与全站登录墙决策相关的架构内容；两层运行结构、token 轮换、限流先于认证、JWKS 复用等已确认架构全部保留不变。正文中决策变更点以 **D-xxx** 标注，v1.2 评审遗留标注（AR1/AR2-xxx）在受影响行同步更新语义。

---

## 1. 架构概述

### 1.1 目标

将现有匿名模式（`middleware.ts` 中 `isAuthenticated` 恒为 true）替换为 SP-Initiated OIDC Authorization Code + PKCE 登录认证体系：

① 用户经 IDP（`sso.happyrabbit.top`）登录，SP 经 OIDC 标准流程换取 token；② 登录态以三个 httpOnly Cookie（`sso_access_token` / `sso_refresh_token` / `sso_id_token`）承载；③ **受保护资源 = 全站登录墙（D-001，业务 OQ-002 已裁决）**：除公开白名单（首页 `/`、`/login` 登录入口页、`/api/sso/*` OIDC 回调链、`/api/health` 等运维接口，FR-028）外的**全部页面路由与 API** 均由两层校验保障：middleware（Edge）粗校验 + Node 层本地 JWT 验签深校验（页面按 FR-029 触发判定准则决定是否落 Node 层，D-003，详见 §4.1.3）；④ Refresh Token 轮换续期（OQ-004：30 天持久会话 + 轮换），跨标签页单飞协同（OQ-05）；⑤ SP-Initiated Logout 全流程（revoke → 清 cookie → end_session form POST → 白名单回跳）；⑥ **「全部业务资源先认证后访问」为全站统一原则（D-006 / NFR-007）**：认证基础设施为未来订单/结算系统预留接入，本次不实施订单功能。

**用户故事落点（spec v1.3）**：US-005 未登录访问受保护页面（如 `/solve`）→ 引导登录并登录后回跳（FR-029 302 + returnTo）；US-006 首页 `/` 始终公开、不强推登录（FR-028）。

### 1.2 已确认业务决策（架构落地依据，非开放项）

| 编号 | 决策 | 架构落点 |
|------|------|----------|
| OQ-004 | 启用 `offline_access`，30 天持久会话 + refresh 轮换续期；token FR-004~010 全量实现；FR-002 refresh_token cookie 30 天（`SSO_REFRESH_TOKEN_MAX_AGE_DAYS` 默认 30） | §3、§4.2、§5 |
| OQ-002 | **受保护资源 = 全站登录墙（D-001，2026-08-11 业务确认，spec v1.3 §7.1）**：除公开白名单（FR-028：`/`、`/login`、`/api/sso/*`、`/api/health` 等运维接口）外，全部页面路由与 API 均需登录态；Node 层仅本地 JWT 验签，不调 IDP 内省端点；middleware matcher 扩展覆盖页面路由（D-002，表达式见 §4.1.3）；token FR-017~020 降级 N/A | §4.1、§4.2、§6、§9.1 |
| OQ-001 | 业务集成目标（范围部分随 OQ-002 确认）：**全站登录墙（D-001）**；会话策略/登出体验等其余业务诉求无文档依据，仍列 §9.2 | §1.3、§4.1.3 |
| OQ-003 | **`/login` 保留并落地为 SP-Initiated OIDC 登录入口页（FR-030，2026-08-11 业务确认）**；middleware 未认证重定向目标维持 `/login`；`[locale]` 落地后 302 locale 规则（AR1-009）随其生效 | §4.1.3、§6、M7 |
| OQ-05 | 跨标签页并发刷新 = 单飞协同（localStorage 锁 + BroadcastChannel） | §4.3、§5 |

### 1.3 核心架构决策表

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| AD-01 | 受保护资源范围 | **全站登录墙（D-001，变更自 v1.2「仅 /api/solve」）**：除公开白名单（FR-028：`/`、`/login`、`/api/sso/*`、`/api/health` 等运维接口）外，全部页面路由与 API 均需登录态；middleware matcher 扩展覆盖页面路由（D-002，表达式见 §4.1.3）；认证粗检 = 限流全集内受保护子集（白名单豁免）；**未登录响应按路径类型差异化（FR-016/029）：页面 302 → `/login?returnTo=<原路径>`、API 401 JSON（`AUTH_SESSION_INVALID`）** | 业务 OQ-002 裁决反转（2026-08-11 确认，修订调度方案 D-001/D-002）；首页 `/` 公开、不强推登录（D-004 / FR-028）；`/api/sso/*` 与 `/login` 必须公开、防 302 死循环（FR-028） |
| AD-02 | access_token 深度校验 | Node 层本地 JWT 验签（RS256 + iss/aud/exp，fail-closed），不内省；**JWKS 复用集成指南 §3.5 端点（复用假设见 R-11/§11 首日实测）** | OQ-002；FR-017~020 N/A；避免每请求串行 IDP 调用；接受撤销感知失效（R-01） |
| AD-03 | 两层运行结构 | middleware（Edge）：仅 cookie 存在性 + 解码级 exp 检查，不验签/不内省/不续期/不引用 `SSO_CLIENT_SECRET`；**粗检范围 = 全站受保护资源（页面 + API），公开白名单豁免（D-002/D-004，语义扩展自 v1.2 AR2-001）**；Node 层完整本地验签（API 走 `requireAuth`；页面按 FR-029 判定准则走 `requireAuthPage`，§4.1.3/D-003） | auth FR-016 / token FR-003；Edge 引用 client_secret 会被内联泄露（FR-024） |
| AD-04 | 续期触发与 401 语义 | 触发：①Node 受保护请求剩余 < 60s ②受保护请求/userinfo 401；middleware 302/401 不触发续期；401/失效语义 SP 内部定义（`AUTH_SESSION_INVALID`） | auth FR-017/018、token FR-004；过期不尝试续期（FR-017） |
| AD-05 | 刷新单飞 | 服务端内存 inflight Map（复用 fs-html-cache 先例）+ 跨标签页协同（localStorage 锁 + BroadcastChannel，**仅信号不传 token，AR2-003**） | token FR-005 + OQ-05；避免并发刷新同一旧 refresh_token 触发 IDP 重放检测撤销全会话 |
| AD-06 | JWT 验签实现 | 新增 `jose` 依赖（锁定 `^6.2.8`，AR1-005；**实施前 `npm view jose versions` 验证存在性，AR2-006**；Edge/Node 双运行时） | 集成指南 §2.4 推荐；WebCrypto 自实现风险高（R-04） |
| AD-07 | Discovery/JWKS 缓存 | 内存缓存 1h（lru-cache），kid 未命中刷新重试一次；id_token 与 access_token 共用同一 JWKS 缓存（唯一路径，AR1-006） | auth FR-012/014、token NFR-003；端点 URL 全取 Discovery，禁硬编码 |
| AD-08 | 状态持久化 | **前端生成** code_verifier/state/nonce/returnTo → 前端写 sessionStorage → form POST 提交 `/api/sso/authorize` → 服务端 Zod 校验后写 httpOnly cookie（**含 sso_return_to，AR2-004**；权威）；回调服务端读 cookie、前端读 sessionStorage（闭环见 §4.1.1，AR1-003；**v1.3：middleware 302 携带的 query returnTo 与登录按钮上下文 returnTo 均经前端透传进入本链路，FR-029**） | auth FR-003（R2-003）/FR-005；cookie 通道 httpOnly 前端不可读，双写值须由前端生成并经提交路径到服务端 |
| AD-09 | 登出编排 | revoke（access+refresh）→ 清本地 cookie → end_session（**浏览器 HTML form 自动提交，POST x-www-form-urlencoded**）+ 白名单回跳 | auth FR-019~023、token FR-011~016；302 无法携带 POST body，end_session 载体必须为 form 自动提交（AR1-002） |
| AD-10 | IDP 调用重试 | 429 按 Retry-After 精确等待（≤3 次）；网络/5xx 指数退避（≤3 次）；耗尽 → `AUTH_IDP_RATE_LIMITED` | auth FR-025、token FR-010/023 |
| AD-11 | 回调/登出参数校验 | Zod schema 服务端校验，禁信任客户端（**含 /login 与 middleware 的 returnTo query 校验，FR-023，v1.3**） | code-style + auth FR-006/019 |
| AD-12 | 环境变量管理 | 扩展 `app/lib/env.ts` `validateEnv()` + 模块级缓存；`SSO_MOCK_ENABLED=1` 时 `SSO_CLIENT_SECRET` 可缺省、`SSO_ISSUER` 仍必填（§7.2，AR1-010） | 项目既有约定；`SSO_CLIENT_SECRET` 禁 `NEXT_PUBLIC_` 前缀（FR-024/021） |
| AD-13 | 跨标签页刷新协同 | localStorage 锁（互斥持有者）+ BroadcastChannel 广播「刷新完成」信号（**不传递 token**，cookie 更新一律经服务端 Set-Cookie，AR2-003） | OQ-05 决策；候选①落地（§9.3） |
| AD-14 | **页面层认证落点（v1.3 新增，D-003/FR-029）** | middleware 粗检为全站第一道（Edge 统一，对全部受保护页面生效）；**需 Node 深校验的页面在 RSC server component 内调 `requireAuthPage()`**（精确到页）；整组保护可用**路由分组 layout 校验**（未来订单模块，§8.3）；当前 `/solve`（'use client' 输入表单页）与 `/result`（'use client'，读 sessionStorage）均无服务端数据获取/写操作/layout 级用户态渲染 → 仅 middleware 粗检覆盖，不接入 Node 校验（FR-029 判定准则） | FR-029；RSC 校验粒度精确、layout 校验适合整组覆盖、middleware 兜底不可少（Edge 先行） |

### 1.4 边界（不实现）

依据 auth spec §5：IdP-Initiated SSO、DPoP、PAR、Back-Channel Logout、DCR/client_credentials/SCIM、LDAP 直连、**middleware 分布式限流改造（跨实例共享计数）**、groups 权限映射、多实例共享存储、SAML/WS-Fed/Front-Channel Logout（IDP `frontchannel_logout_supported=false`）、**订单/结算系统功能实现（D-006：仅预留认证接入，见 §8.3）**。OQ-06（Edge+client_secret 调 introspect）因 OQ-02 不内省而不再适用。

> 边界澄清（AR1-001/AR2-009，v1.3 增补 matcher 边界）：边界内「限流改造」仅指**分布式化**（维持单实例内存限流，OQ-010）；**限流/认证执行顺序调整**（限流先于认证）**纳入实施范围**（§4.1.3 与 §11 步骤 8）。与 auth spec §5 第 8 条「不改造现有 middleware 速率限制逻辑——仅替换认证钩子」的边界（AR2-009）：顺序调整与 **matcher 扩展（D-002）** 均属**认证钩子替换**范畴——限流逻辑本体（单 IP 每分钟 20 次、`/api/health` 不限流、配额窗口/429 响应）完全不变；matcher 扩展覆盖页面路由是业务决策（D-002）要求，页面路由随之纳入限流全集（同一 matcher），页面 HTML 请求消耗配额属 matcher 覆盖的自然结果、非限流逻辑改造；`/login` 不进 matcher（静态登录入口页，其承载的登录动作经 `/api/sso/*` 已限流覆盖，原 AR2-012 决策在 v1.3 的更新见 §9.2 OQ-010）。

---

## 2. 模块划分

### 2.1 模块清单

| 模块 | 名称 | 运行时 | 职责 | 对应 FR |
|------|------|--------|------|---------|
| M1 | SSO 路由层 | Node（Route Handler） | `/api/sso/*`：authorize（form POST）/ callback / logout（**仅 POST，AR2-007**）/ refresh；Zod 校验、错误 envelope | auth FR-001~010、FR-019~023 |
| M2 | SSO 服务层 | Node | Discovery、JWKS 缓存、token 交换、id_token 验证、userinfo、revoke、end_session 编排 | auth FR-009~014、FR-019~022 |
| M3 | Token 生命周期服务 | Node | refresh 轮换、单飞（inflight Map）、失败分类、token cookie 读写（**仅经响应 Set-Cookie 写入，AR2-002**）；`token-cookie.ts` 为 **Edge/Node 同构纯模块（仅 cookie 名常量，禁 Node API 与 env 引用，middleware 与 Node 侧共用，AR3-007）** | token FR-001~010 |
| M4 | 跨标签页协同 | 浏览器（工具模块，非 UI） | localStorage 锁 + BroadcastChannel **仅作「刷新完成/会话失效」信号，不传递 token**（AR2-003）；他标签页收到信号后主动调 `/api/sso/refresh`（Set-Cookie 回写）或清除前端 sessionStorage + 提示重登；置于 `lib/sso/refresh-sync.ts`（AR1-008） | token FR-005（OQ-05 扩展） |
| M5 | 认证守卫（Node 层） | Node | **受保护 API（`/api/solve` 等）** access_token 本地 JWT 验签（iss/aud/exp fail-closed，`requireAuth`）；**受保护页面 Node 层深校验（`requireAuthPage`，v1.3 新增，按 FR-029 判定准则接入，D-003）**；JWKS 取 M2（唯一路径，AR1-006） | auth FR-016、FR-029；token FR-003/017（N/A 化后职责） |
| M6 | middleware（Edge） | Edge | 限流（先于认证，AR1-001；**v1.3：matcher 全集 = 页面 + API，D-002**）+ 认证粗检（**全站受保护资源，公开白名单常量豁免：`/`（含 [locale] 前缀首页）、`/api/sso/*`、`/api/health`、`/{locale}/login`；顶层 `/login` 不进 matcher（负向断言排除）不经本模块——FR-028 业务白名单成员、实现路径不同，AR3-010**）+ exp 粗检 + **未认证响应分流：页面 302 + returnTo（FR-029）/ API 401 JSON（FR-016）**；**禁引用 SSO 密钥 env** | auth FR-016/024/028/029 |
| M7 | 登录/登出 UI 组件 | 浏览器 | 登录入口（生成 PKCE 状态 + sessionStorage + form POST）、**`/login` 登录入口页（v1.3 新增：RSC 登录态检测 + 已登录重定向回跳 + returnTo 透传 + 错误提示，D-005/FR-030）**、登出按钮（form POST）、会话状态提示 | auth FR-001/019/030 入口 |
| M8 | 配置与环境 | Node/Edge | `validateEnv()` 扩展 SSO 分组校验（含 mock 分支，AR1-010） | auth FR-027 |

### 2.2 模块依赖关系

```
middleware.ts(Edge) ─── 仅读 cookie（解码 exp，不验签）──→ 浏览器
    │ 限流（页面 + API 全集，先于认证）→ 认证粗检（受保护子集，白名单豁免）→ 未认证响应：页面 302+returnTo / API 401 JSON
    ▼
M1 SSO 路由层(Route Handler, Node) ──→ M2 SSO 服务层 ──→ IDP (Discovery/Token/UserInfo/Revoke/EndSession)
    │                                    │
    │                                    ▼
    │                              M3 Token 生命周期服务（refresh 轮换/单飞/cookie，Set-Cookie 写入 AR2-002）
    ▼
M7 登录/登出 UI（含 /login 入口页，D-005） ── 客户端 ──→ M4 跨标签页协同（lib/sso/refresh-sync.ts，广播仅信号 AR2-003，收信号主动调 /api/sso/refresh 回写）
    ▼
M5 认证守卫(Node) ←── JWKS 缓存（M2，唯一路径，AR1-006）── 深度校验 ── 受保护 API（/api/solve/route.ts）与需 Node 校验的页面（requireAuthPage，D-003）
    ▼
M8 配置与环境（validateEnv()，SSO_CLIENT_SECRET 仅 Node 侧）
```

依赖方向：M1 → M2 → M3 → M8；M2 → IDP（HTTP）；M5 → M2（JWKS 缓存，**唯一实现路径**，AR1-006 已裁决）；M6 独立（Edge，仅 Web API 与 cookie；公开白名单常量集中定义，v1.3/D-004，单一来源）；M4 → M3 浏览器侧（经 `/api/sso/refresh`，服务端 Set-Cookie 回写）；**页面路由 → M5（按 FR-029 判定准则，需 Node 校验时经 `requireAuthPage`，v1.3/D-003）**。

---

## 3. 技术选型

技术栈与 `package.json` 现状核对（依赖版本以下文为准；已核对 package.json：`jose@^6.2.8` 已在 dependencies；**v1.3 无新增依赖**）：

| 类别 | 技术 | 版本（package.json） | 用途 |
|------|------|---------------------|------|
| 框架 | Next.js（App Router，`[locale]` 国际化规划中） | 15.1.6 | 路由层 M1/M6、SSR 页面（含 `/login` 入口页） |
| 语言 | TypeScript | ^5.7.3 | 全量类型约束（禁 any） |
| 样式 | Tailwind CSS | ^3.4.17 | UI 组件样式 |
| 校验 | zod | ^3.24.1 | 回调/登出/authorize 提交/returnTo 参数 Schema 验证 |
| 缓存 | lru-cache | ^11.5.1 | Discovery/JWKS 1h 缓存、token 交换响应缓存 |
| JWT 验签 | **jose（已新增）** | **^6.2.8**（AR1-005 锁定；**实施前 `npm view jose versions` 验证 v6.2.8 存在，AR2-006**；Edge/Node 双运行时） | RS256 本地验签（id_token 8 步、access_token 深校验、页面 requireAuthPage 复用）。备选 WebCrypto 自实现（不推荐，AD-06/R-04） |
| HTTP | fetch（Node 内置） | — | SP → IDP 调用（token/revoke/userinfo/discovery/jwks），带超时与重试 |
| 图标 | lucide-react | ^1.21.0 | 按钮图标（禁内联 SVG） |
| UI 变体 | class-variance-authority + tailwind-merge + clsx | ^0.7.1 / ^3.6.0 / ^2.1.1 | 按钮/表单组件变体 |
| 测试 | Vitest + @playwright/test | ^3.0.0 / ^1.61.1 | 单测全 mock、E2E 分级（@smoke/@no-llm/@llm） |

**依赖变更说明**：v1.3 无新增依赖（全站登录墙为范围扩展，不引入新技术选型）；`jose@^6.2.8` 为唯一运行时新增依赖（OQ-002 核心需求，RS256 本地验签；Edge/Node 双兼容；集成指南 §2.4 推荐）。

---

## 4. 数据流设计

> **R-13 拆分（v1.3 review-r1 执行，AR3-003）**：完整数据流设计已拆分至 **`arch-sso-dataflow.md`**（章节编号体系延续——§4.1.1~§4.1.5、§4.2 均指该文件对应小节）；本文档仅保留摘要与关键决策锚点。review-r1 对 §4 的修订（AR3-001 matcher/白名单 locale 前缀登录页、AR3-004 metadata 根资源豁免、AR3-006 requireAuthPage 失败载体、AR3-007 token-cookie Edge 兼容、AR3-010 白名单概念澄清）已全部落于该文件对应小节。

### 4.1 正常流（摘要，详见 `arch-sso-dataflow.md`）

| 子节 | 内容 | 关键决策锚点 |
|------|------|-------------|
| §4.1.1 登录发起 | SP-Initiated PKCE 发起（任意页面登录入口 / `/login` 入口页，D-005） | 前端生成 PKCE 状态 + sessionStorage 双写 + form POST `/api/sso/authorize` + 服务端状态 cookie（含 `sso_return_to`，AR2-004）；middleware 302 与登录按钮上下文 returnTo 均经 isSafeReturnTo 校验透传（FR-029） |
| §4.1.2 回调与令牌交换 | code→token 交换 + id_token 8 步验证 + userinfo + 三 cookie 写入 | state/iss 比对（cookie 权威）、returnTo 恢复（OQ-009 默认落地页 = `/solve`，已裁决） |
| §4.1.3 受保护资源访问 | **全站登录墙两层校验（D-001~D-004，本版核心）** | matcher 表达式与公开白名单常量（单一来源 D-004）、未认证响应分流（页面 302+returnTo / API 401 JSON）、requireAuthPage 触发判定准则（D-003）、302 locale 二段式（AR1-009） |
| §4.1.4 刷新续期 | refresh 轮换 + 单飞 + 跨标签页协同（OQ-004/OQ-05） | Set-Cookie 回写（AR2-002）、广播仅信号不传 token（AR2-003） |
| §4.1.5 登出 | revoke→清 cookie→end_session form POST（AR1-002） | 仅 POST（AR2-007）、白名单回跳（FR-022） |

### 4.2 异常流（摘要）

异常 → 检测点 → 处理 → 错误码 全表（18 类：回调缺参 / state 不一致 / iss 不一致 / token 交换失败 / 未登录访问受保护页面 302 / 页面 Node 深校验失败等）见 `arch-sso-dataflow.md §4.2`；错误码定义见 §5.4。

---

## 5. 接口定义

### 5.1 服务层约定

遵循 `api-conventions.md`：服务层方法返回 `ServiceResult<T>`，不抛异常；**统一服务单例导出**（`export const x = new X()`，AR1-007）。

```typescript
// @/app/lib/ai/types.ts 既有定义（复用）
export type ServiceResult<T> = { success: boolean; data?: T; error?: { code: string; message: string } };
```

### 5.2 服务层接口（M2/M3/M5 核心签名；注释路径统一 @/app/lib/ 前缀，AR2-005）

```typescript
// @/app/lib/sso/config.ts（M8）— validateEnv 模式；模块级缓存，issuer/端点来自 Discovery
export function getSsoConfig(): SsoConfig;

// @/app/lib/sso/discovery-service.ts（M2，单例）— 端点全部取自 Discovery；JWKS 缓存 1h（kid 未命中重试，M5 复用 AR1-006）
export class DiscoveryService {
  getIssuer(): string; getEndpoint(name: DiscoveryEndpoint): string; // 校验与 SSO_ISSUER 一致
  getJwks(kid: string): Promise<ServiceResult<JsonWebKeySet>>; clearCache(): void;
}
export const discoveryService = new DiscoveryService();

// @/app/lib/sso/oauth-client.ts（M2，单例，AR1-007；构造注入 fetch 便于单测 mock）
export class OAuthClient {
  exchangeCode(p: ExchangeCodeParams): Promise<ServiceResult<TokenResponse>>;
  refreshToken(p: RefreshTokenParams): Promise<ServiceResult<TokenResponse>>;
  getUserInfo(t: string): Promise<ServiceResult<IdTokenClaims>>;
  revokeToken(t: string, hint: 'access_token'|'refresh_token'): Promise<ServiceResult<void>>;
  callEndSession(p: EndSessionParams): Promise<ServiceResult<{ url: string }>>; // form 提交目标
}
export const oauthClient = new OAuthClient();

// @/app/lib/sso/id-token-verifier.ts（M2，单例）
export class IdTokenVerifier {
  verifyIdToken(idToken: string, expectedNonce: string): Promise<ServiceResult<IdTokenClaims>>;
}
export const idTokenVerifier = new IdTokenVerifier(); // 8 步验证见 §4.1.2 步骤 6

// @/app/lib/sso/token-refresher.ts（M3，单例）
export class TokenRefresher {
  refreshIfNeeded(): Promise<ServiceResult<void>>;       // 单飞 inflight Map + 跨标签页协同
  onInvalidGrant(): void;                                // 清 cookie + 安全告警
}
export const tokenRefresher = new TokenRefresher();

// @/app/lib/auth/guard.ts（M5）
export async function requireAuth(request: Request): Promise<ServiceResult<AccessTokenClaims>>;
// access_token 本地 JWT 验签（jose ^6.2.8，RS256+kid+iss/aud/exp），fail-closed；JWKS 取 discoveryService（AR1-006）
// 供受保护 API（/api/solve 等）调用（现状保留）

export async function requireAuthPage(): Promise<ServiceResult<AccessTokenClaims>>;
// v1.3 新增（D-003/FR-029）：页面 Node 层深校验入口——RSC server component 内调用（cookies() 读
// sso_access_token，与 requireAuth 同一验签核心与 JWKS 唯一路径 AR1-006）；校验失败由调用方
// 清全部会话 cookie + 302 → /login?returnTo（AC-039）
// 实现：验签核心抽为内部 verifyAccessToken(token)，requireAuth 与 requireAuthPage 共用
//（当前 /solve、/result 无服务端场景，不接入；未来需 Node 校验的页面按 FR-029 判定准则接入）
```

### 5.3 Route Handler 接口（M1）

| 端点 | 方法 | 入参（Zod 验证） | 成功响应 | 失败响应 |
|------|------|------------------|----------|----------|
| `/api/sso/authorize` | **POST（form，AR1-003）** | code_verifier/code_challenge/state/nonce/returnTo（body） | 302 → IDP authorize URL | 400 `AUTH_LOGIN_MISSING_PARAMS` 等 |
| `/api/sso/callback` | GET | code/state/iss/error（可选） | 302 → returnTo（经校验） | 400/401 + 错误页（envelope） |
| `/api/sso/logout` | **POST only（AR2-007）** | 无（登出编排） | **200：end_session HTML form 自动提交页**（POST IDP，AR1-002）；无 redirect 时 200 `{success:true}` | 400 `AUTH_LOGOUT_REDIRECT_INVALID` 等；**GET → 405** |
| `/api/sso/refresh`（内部，可选暴露） | POST | 会话标识（cookie） | 200 `{success:true}`（**经响应 Set-Cookie 回写新 cookie，AR2-002**） | 401 `AUTH_TOKEN_INVALID_GRANT` 等 |

错误 envelope 统一格式（沿用 `GESP6_*` 风格）：

```json
{ "success": false, "error": { "code": "AUTH_LOGIN_STATE_MISMATCH", "message": "登录状态校验失败，请重新登录" } }
```

### 5.4 错误码全集（AUTH_*，两份 spec 并集 16 个）

**auth spec §3.7（9 个）**：`AUTH_LOGIN_MISSING_PARAMS`、`AUTH_LOGIN_STATE_MISMATCH`、`AUTH_LOGIN_ISS_MISMATCH`、`AUTH_LOGIN_IDP_ERROR`、`AUTH_LOGIN_IDP_UNREACHABLE`、`AUTH_TOKEN_EXCHANGE_FAILED`、`AUTH_ID_TOKEN_INVALID`、`AUTH_IDP_DISCOVERY_FAILED`、`AUTH_LOGOUT_REDIRECT_INVALID`

**token spec FR-025（7 个）**：`AUTH_TOKEN_EXPIRED`、`AUTH_TOKEN_REFRESH_FAILED`、`AUTH_TOKEN_INVALID_GRANT`、`AUTH_TOKEN_REVOKE_FAILED`、`AUTH_TOKEN_INTROSPECT_FAILED`、`AUTH_SESSION_INVALID`、`AUTH_IDP_RATE_LIMITED`

**不收录**：`AUTH_LOGIN_INVALID_CREDENTIALS`（凭证校验在 IDP 侧，两 spec 均明确不收录）。**用户提示**：仅错误码 + 安全通用文案（FR-026，含 /login 页错误展示，D-005），不泄露 IDP 细节、token 值、会话标识。

---

## 6. 目录结构

遵循 dev 规则（`@/` 绝对路径、kebab-case、单文件 ≤500 行、页面 ≤300 行）：

```
middleware.ts（项目根目录，Next.js 15 约定，AR1-004）      # M6：Edge 限流（页面+API 全集，先于认证）+ cookie exp 粗检
│                                        #（受保护子集，公开白名单豁免，D-002/D-004）+ 未认证分流：页面 302+returnTo / API 401 JSON（v1.3）
app/
├── api/
│   ├── solve/route.ts                     # 既有（不变）：接入 M5 requireAuth 守卫（未登录 401 JSON，v1.3 语义）
│   └── sso/                               # M1：SSO 路由层（Node）
│       ├── authorize/route.ts             # 登录发起：form POST 状态值 → 写状态 cookie（含 sso_return_to，AR2-004）→ 302
│       ├── callback/route.ts              # 回调：校验+交换+8 步验证+userinfo+写 cookie+returnTo 恢复
│       ├── logout/route.ts                # 登出编排（仅 POST，AR2-007）→ end_session form 自动提交页
│       └── refresh/route.ts               # 刷新端点（同步/主动拉取路径，Set-Cookie 回写，AR2-002）
├── login/                                 # v1.3 新增（D-005/FR-030）：/login 登录入口页（全站 302 目标 + 主动登录入口）
│   ├── page.tsx                           # RSC：读 query returnTo（isSafeReturnTo 校验，FR-023）→ 透传；cookie 级登录态检测
│   │                                      #   （FR-016 语义，解码 exp 不验签）→ 已登录 302 回 returnTo/默认落地页（排除与 /login 或 /{locale}/login 规范化相等目标，防循环，FR-030，AR3-001）
│   └── login-client.tsx                   # 'use client'：登录按钮（pkce.ts 同构生成 + sessionStorage + form POST）+ 登录错误提示（FR-026 脱敏）
├── lib/
│   ├── env.ts                             # M8：validateEnv() 扩展（SSO 分组 + mock 分支，AR1-010）
│   ├── logging/logger.ts                  # 既有：应用日志（脱敏由 M2/M3 保证）
│   ├── logging/audit-logger.ts            # 新增（AR2-010）：auditLogger.log()（仅 API/Server Action 层）
│   ├── auth/                              # M5：认证守卫
│   │   ├── guard.ts                       # requireAuth（API）+ requireAuthPage（页面，v1.3 新增）：本地 JWT 验签 fail-closed（JWKS 取 M2，AR1-006）
│   │   └── guard.test.ts
│   ├── sso/                               # M2/M3/M4：SSO 服务层（Node）+ 浏览器侧工具
│   │   ├── config.ts                      # SsoConfig 读取（模块级缓存）
│   │   ├── types.ts                       # SsoConfig/TokenResponse/IdTokenClaims 等类型
│   │   ├── schemas.ts                     # 回调/登出/authorize 提交参数 Zod schema（含 returnTo 校验，FR-023）
│   │   ├── pkce.ts                        # code_verifier/challenge/state/nonce 生成与校验（同构纯函数：仅 Web API，AR2-011）
│   │   ├── discovery-service.ts           # Discovery/JWKS 缓存 1h（单例）
│   │   ├── oauth-client.ts                # SP→IDP HTTP 调用（超时+重试，单例，AR1-007）
│   │   ├── id-token-verifier.ts           # id_token 8 步验证（单例）
│   │   ├── token-cookie.ts                # 三个 token cookie + 状态 cookie 读写（安全属性集中定义；**Edge/Node 同构纯模块，仅 cookie 名常量，AR3-007**）
│   │   ├── token-refresher.ts             # 刷新轮换 + 单飞 inflight Map（单例，Set-Cookie 写入 AR2-002）
│   │   ├── logout-service.ts              # revoke + 清 cookie + end_session form 页构造
│   │   ├── refresh-sync.ts                # M4：跨标签页协同（浏览器侧工具，AR1-008；仅信号不传 token，AR2-003）
│   │   └── __tests__/                     # 各服务单测（全 mock，无模型）
│   └── ai/types.ts                        # 既有：ServiceResult 定义（复用）
├── components/
│   └── auth/                              # M7：登录/登出 UI（仅 UI 组件，AR1-008；v1.3：login-button 供 /login 页与页头入口复用）
│       ├── login-button.tsx               # 生成 PKCE 状态（引 pkce.ts 同构实现，AR2-011）+ 写 sessionStorage + form POST（§4.1.1，returnTo 透传 v1.3）
│       ├── logout-button.tsx              # 登出入口（form POST /api/sso/logout，AR2-007）
│       └── session-status.tsx             # 会话状态提示（可选）
└── [locale]/                              # 规划中（OQ-003 已裁决保留 /login）；落地后 middleware 302 带 locale 前缀（AR1-009）、locale 首页延续公开语义（FR-028）
    ├── layout.tsx
    ├── login/page.tsx                     # locale 前缀登录页（复用顶层 /login 实现；命中 matcher 由公开白名单常量按 locale 支持列表豁免认证，AR3-001）
    ├── page.tsx                           # locale 前缀首页（延续 / 公开语义，FR-028）
    ├── solve/page.tsx                     # locale 前缀解题页（受保护，FR-029）
    └── result/page.tsx                    # locale 前缀结果页（受保护，FR-029）
```

**目录约定说明**：① **middleware.ts 在项目根目录**（非 `app/`）——Next.js 15 约定 middleware 须在根目录或 `src/`，`app/` 内不生效（AR1-004），与现状一致；② **`refresh-sync.ts` 置于 `lib/sso/`**——components/ 只放 UI 组件（component-rules），跨标签页协同为浏览器侧纯工具（AR1-008）；③ 跨模块引用一律 `@/` 绝对路径（禁 `../`），§5.2 注释路径与此一致（AR2-005）；④ `callback/route.ts` 预计超限 → 编排下沉至 `lib/sso/` 服务层，route 薄适配（§9.1 R-08）；⑤ **`/login` 页面（v1.3 新增）**：`page.tsx`（RSC，≤300 行）承担登录态检测与重定向，`login-client.tsx`（'use client'）承担交互；`login-button.tsx` 复用为可嵌入任意页面的登录入口（D-005）；**登录动作统一经 `login-button`（`login-client.tsx`）form POST `/api/sso/authorize`（PKCE 状态生成 + returnTo 透传均在客户端，`oauth-client` 仅 Route Handler 层使用，AR3-008）**。

---

## 7. 依赖关系

### 7.1 运行时依赖（新增 1 项，v1.3 无新增）

| 包 | 版本约束 | 用途 |
|----|----------|------|
| `jose` | **^6.2.8**（已入 package.json，AR1-005 锁定；**实施步骤 1 前置 `npm view jose versions` 验证，AR2-006**） | Node 层 RS256 本地验签（id_token 8 步 + access_token 深校验 + 页面 requireAuthPage，API/页面共用） |

其余依赖零新增（zod/lru-cache/fetch 均已在 package.json 或运行时内置；**v1.3 全站登录墙不引入新技术选型**）。

### 7.2 环境变量清单（扩展 `validateEnv()`）

**浏览器可见（NEXT_PUBLIC_ 前缀，无敏感值）**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_SSO_ISSUER` | 无（必填） | IDP issuer，如 `https://sso.happyrabbit.top` |
| `NEXT_PUBLIC_SSO_CLIENT_ID` | 无（必填） | 公开的 client_id |
| `NEXT_PUBLIC_SSO_REDIRECT_URI` | 无（必填） | 回调地址，须与注册值完全匹配 |
| `NEXT_PUBLIC_SSO_SCOPE` | `openid profile email groups offline_access` | 空格分隔 scope（必含 openid + offline_access） |
| `NEXT_PUBLIC_SSO_DASHBOARD_URL` | 无（可选） | SSO 用户中心地址（Header「用户信息」跳转目标）；缺失时 Header 隐藏该入口 |
| `NEXT_PUBLIC_SSO_REGISTER_URI` | 无（可选） | IDP 注册页地址（Header 未登录「注册」入口）；缺失时 Header 隐藏该入口 |

**服务端（Node 层）**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SSO_CLIENT_SECRET` | 无（必填；**mock 模式可缺省**，AR1-010） | **禁 NEXT_PUBLIC_ 前缀**；仅 Node 层引用，Edge 禁引用 |
| `SSO_ISSUER` | 无（必填，**含 mock 模式**，AR1-010） | 服务端 issuer（须与 Discovery 一致，FR-008/014）；mock IDP 同样遵循 |
| `SSO_CLIENT_ID` | 无（必填） | 服务端 client_id（与 NEXT_PUBLIC_SSO_CLIENT_ID 同值，Node 侧权威） |
| `ID_TOKEN_VERIFY_MODE` | `strict` | `strict` 拒登 / `soft` 记日志（OQ-008 待确认生产强制） |
| `SSO_REFRESH_TOKEN_MAX_AGE_DAYS` | `30` | refresh_token cookie 持久化周期（OQ-004；命名审批见 §12，AR2-008） |
| `SSO_MOCK_ENABLED` | `0` | 测试环境 mock IDP 开关（NFR-003） |
| `SSO_RETRY_MAX` | `3` | IDP 调用重试上限（FR-025/023） |

**校验规则（AR1-010 明确 mock 分支）**：常规模式（`SSO_MOCK_ENABLED` 非 `1`）：`SSO_CLIENT_SECRET`、`SSO_ISSUER` 均必填，缺失报错清晰；mock 模式（`SSO_MOCK_ENABLED=1`）：`SSO_CLIENT_SECRET` **可缺省**（本地开发无真实凭据即可运行，缺失记警告日志），`SSO_ISSUER` **保持必填**（Discovery/iss 校验契约不变）。任何模式：`NEXT_PUBLIC_SSO_CLIENT_SECRET` 存在即报错；`SSO_CLIENT_SECRET` 不出现在 middleware（Edge）可引用路径。

---

## 8. 非功能性设计

### 8.1 性能

- Discovery/JWKS 内存缓存 1h（lru-cache），端点 URL 缓存复用，避免每请求 Discovery（§4.1.2/4.1.3）；
- 续期仅在剩余 < 60s 或 401 时触发；403/401 不反复重试；
- middleware 粗检仅解码 cookie（无验签、无网络），Edge 层 O(1)；
- Node 层验签走 jose，JWKS 命中缓存无外呼（kid 未命中才刷新）；
- `/login` 页面为轻量 RSC（登录态检测 + 入口按钮），无服务端数据拉取（D-005）；
- 页面级认证成本 v1.3 说明：受保护页面仅经 middleware 粗检（Edge，µs 级），无 Node 层开销；**页面不消耗 `/api/*` 限流配额外的资源（matcher 全集见 §4.1.3，配额为同源共享，页面 HTML 请求计入限流全集——属 D-002 matcher 扩展的自然结果，见 §1.4/OQ-010 更新）**。

### 8.2 安全

| # | 安全项 | 设计 |
|---|--------|------|
| 1 | Cookie 安全属性 | 全部会话 cookie：httpOnly + sameSite=lax + secure（生产判断）+ 清晰 path；状态 cookie 追加 10min maxAge 一次性语义 |
| 2 | 密钥边界 | `SSO_CLIENT_SECRET` 仅 Node 层；middleware（Edge）禁引用（AD-03/FR-024）；禁 `NEXT_PUBLIC_` 前缀（§7.2） |
| 3 | 回调参数 | code/state/iss 服务端 Zod 校验；state 一次性比对（cookie 权威）；iss RFC 9207 防登录混淆；code_verifier PKCE 防代换（§4.1.2） |
| 4 | 开放重定向 | `isSafeReturnTo`（FR-023）白名单/同源/路径归一化校验覆盖全部 returnTo 入口：middleware 302 query、/login 页透传、authorize 提交、回调恢复（v1.3，D-005）；排除与 `/login` 或 `/{locale}/login` 规范化相等目标防死循环（FR-030，AR3-001） |
| 5 | token 泄露面 | httpOnly cookie 承载（前端 JS 不可读）；跳转不含 token；sessionStorage 仅存 PKCE/state/nonce/returnTo（不存 token）；广播仅信号不传 token（AR2-003） |
| 6 | 登出完整性 | revoke（access+refresh）→ 清 cookie → end_session form POST（id_token_hint）→ 白名单回跳（FR-019~023） |
| 7 | client_secret 泄露 | 禁 `NEXT_PUBLIC_` 前缀 + validateEnv 存在即报错（§7.2） |
| 8 | 端点限流 | 限流先于认证（AR1-001）；**v1.3：matcher 全集 = 页面 + API（D-002）。matcher 参与面三分类（AR3-002 统一表述）：① 不进 matcher（负向断言排除）：`/login`（登录入口页自身，防 302 循环；其登录动作经 /api/sso/authorize 已限流覆盖）、`/_next/*` 静态资源与 favicon（Next.js 惯例）；② 进 matcher 且豁免认证粗检（公开白名单常量，D-004）：首页 `/`（含 [locale] 前缀首页）、`/api/sso/*`、`/api/health`、`/{locale}/login`——均计入限流；③ 进 matcher 且豁免限流：仅 `/api/health`（现状，部署探活）；`/api/sso/*` 豁免认证但计入限流（IDP 调用面，AD-10）**（原 AR2-001/AR2-012 语义随 D-002 更新） |
| 9 | 错误信息脱敏 | 用户可见错误仅错误码 + 通用文案（FR-026，含 /login 错误提示，D-005）；日志经 auditLogger，不落 token 明文 |
| 10 | 会话失效 | 登出清 cookie + IDP 侧 end_session；refresh 轮换使旧 refresh 立即失效（FR-007）；页面 Node 层校验失败 fail-closed（AC-039） |
| 11 | 首页公开边界 | 首页 `/`（及 [locale] 前缀首页）公开：**不展示个人信息、不强推登录（FR-028）；middleware 白名单豁免认证但计入限流（防高频抓取造页消耗）**；`/_next/*`、favicon 不进 matcher（Next.js 惯例，静态资源不被拦，AC-035）；**metadata 框架根资源（`icon.svg` / `apple-icon` / `opengraph-image` / `twitter-image` / `robots.txt` / `sitemap.xml`，Next.js 自动映射根路径静态资源）随负向断言一并豁免（AR3-004，落地后否则被拦破坏分享预览与 SEO）** |

### 8.3 可扩展性（v1.3 增补：订单系统预留，D-006）

认证基础设施以「全部业务资源先认证后访问」为统一原则（NFR-007），为未来订单/结算系统预留接入，**本次不新增订单模块设计**：

| 扩展方向 | 预留机制 | 落地方式 |
|----------|----------|----------|
| 新增受保护 API | 复用 requireAuth | 新 route handler 内 `await requireAuth(request)`（fail-closed，401 JSON）即受保护，无需改造守卫；限流/认证粗检随 matcher `/api/:path*` 自动覆盖（D-002） |
| 新增受保护页面 | 复用 requireAuthPage / 路由分组 | **页面级**（单页粒度）：RSC server component 内 `await requireAuthPage()`（按 FR-029 判定准则接入）；**整组级**（订单模块多页台阶）：路由分组 `app/orders/(protected)/layout.tsx` 内做 layout 级校验（FR-029 判定准则「layout 级用户态渲染」场景，entry 校验后子页共享），未登录 302 → /login?returnTo（AC-039 语义）；middleware 粗检先行兜底（Edge 统一拦截未携带 cookie 请求，白名单不覆盖订单路径） |
| 登录态 UI 复用 | M7 组件 | login-button（PKCE 生成 + form POST）可嵌入订单页引导登录；/login 页已承载 returnTo 透传与登录后回跳（FR-030） |
| 前端受保护操作 | 既有路径 | 表单依赖服务端校验（Server Action/Route Handler）+ 守卫；纯前端读 sessionStorage 场景（/result 先例）由 middleware 粗检兜底 |
| 多实例 / 更高并发 | 预留 | 限流/单飞/缓存当前单实例内存实现（OQ-010 已确认）；迁移 Redis（共享限流计数 + inflight 锁）时隔离在 M3/M6 内部，不扩散 |

---

## 9. 风险与对策

### 9.1 风险登记

| # | 风险 | 等级 | 对策 |
|---|------|------|------|
| R-01 | IDP 撤销不可感知（撤销后 access_token 生效期内仍可用） | 高（接受） | 短 access 时效（900s）+ refresh 轮换 + 页面 Node 校验 fail-closed（AC-039）；非阻断 |
| R-02 | 并发刷新同一旧 refresh_token → IDP 重用检测撤销会话 | 高 | 单飞（M3 inflight Map）+ 跨标签页锁/广播（M4，仅信号 AR2-003） |
| R-03 | Edge 环节误引用 client_secret → 内联泄露 | 高 | middleware 只读 cookie（AD-03/FR-024）；validateEnv 拒绝 NEXT_PUBLIC_SSO_CLIENT_SECRET；评审卡点 |
| R-04 | jose 被依赖审计拒绝 | 高（缓冲） | 备选 WebCrypto 自实现（算法集 RS256/JWK 解析）；实施步骤 1 验证版本存在（AR2-006） |
| R-05 | JWKS 缓存错位（kid 引用旧键） | 中 | 1h 缓存 + kid 未命中强制刷新重试（AR1-006） |
| R-06 | IDP 不可达（Discovery/JWKS/token） | 中 | fail-closed：错误码而非降级放行（AUTH_IDP_DISCOVERY_FAILED 等）；429/网络重试（AD-10） |
| R-07 | 前端 sessionStorage 与服务端 cookie 双写不一致 | 低 | cookie 权威；前端读为兜底（§4.1.1 双写闭环） |
| R-08 | route handler 单文件超限 | 低 | 编排下沉 lib/sso/ 服务层，route 薄适配（§6 ④） |
| R-09 | mock IDP 与真实 IDP 行为偏差 | 中 | mock 仅限测试环境（SSO_MOCK_ENABLED）；首日实测（§11 步骤 8/10） |
| R-10 | refresh 滥用（离线窃取 refresh_token） | 低 | refresh cookie 30 天 + 轮换；invalid_grant 全清（FR-009）；ROT 期间可加多设备会话语义 |
| R-11 | access_token 复用 JWKS 假设（IDP 可能对 cookie 令牌不签 RS256 或强制 introspection） | 中（首日实测） | 集成指南 §3.5 的 JWT-format access_token + RS256 + kid 假设；**首日实测验证（AR1-011）**：实机走通后校验 access_token 确为 RS256 JWT 且 JWKS 可取——若不成立，回退方案：①token 交换后仅信任 id_token（access_token 仅作 cookie 载体，Node 深校验降级为字段校验）②强制 introspection（打开 OQ-02 选项，与 OQ-002 冲突需业务再裁） |
| R-12 | [locale] 302 目标与 `[locale]` 路由落地不对齐 | 低（OQ-003 已裁决） | 二段式 locale 规则（AR1-009）；落地时回归（§11 步骤 8）；**断言 `/{locale}/login` 可达且不被 302/401 拦截（白名单常量按 locale 支持列表豁免，AR3-001）** |
| R-13 | 主文档 500 行超限 | 低 | §10 FR 覆盖矩阵拆至 `arch-sso-fr-matrix.md`（v1.2 已执行）；正文引用向量表 |
| R-14 | **全站 matcher 白名单误配 → 302/401 死循环（v1.3 新增，D-002 伴随）** | 中 | matcher 参与面三分类（AR3-002 统一）：**不进 matcher**——`/login`、`/_next/*`、favicon 及 metadata 根资源（icon.svg/apple-icon/opengraph-image/twitter-image/robots.txt/sitemap.xml，AR3-004）；**进 matcher 但白名单常量豁免认证（单一来源，D-004）**——首页 `/`、`/api/sso/*`、`/api/health`、`/{locale}/login`（AR3-001）；middleware 仅对受保护子集发 302/401；**E2E 断言 AC-035/036/038**（认证白名单路径不被拦，含 `/{locale}/login`） |
| R-15 | **页面 Node 深校验遗漏（v1.3 新增，D-003）** | 低 | FR-029 判定准则书面化（§4.1.3 + §6）；新页面接入时按准则审核（§8.3 扩展路径）；本次 /solve、/result 无服务端场景经确认不接入 |
| R-16 | **页面 HTML 计入限流后配额未按新范围评估（v1.3 新增，AR3-005）** | 中 | matcher 全集含页面 HTML（D-002），单 IP 20 次/分（middleware.ts L29 RATE_LIMIT_MAX）未按新范围重新评估：典型用户流（/login → 回调 → /solve → /result，含刷新/错误回跳）与快速翻页可能触 429，与 NFR-004「不改变已登录用户契约」存在张力；**对策**：首日实测（§11 步骤 8/10）评估页面/API 分桶或提高页面配额——评估结论不改变限流逻辑本体（§1.4 边界，限流改造仅指分布式化），落点仅配额参数；§12 验证清单补「完整用户流不触 429」E2E 断言（含快速翻页场景） |

### 9.2 待确认业务 OQ 表

| # | 问题 | 状态 | 假设 |
|---|------|------|------|
| OQ-001 | 业务集成目标 | **已裁决（部分，v1.3）：受保护范围 = 全站登录墙（D-001）；其余诉求无文档依据**（2026-08-11） | 按裁决实施 |
| OQ-002 | 内省 | **已裁决（2026-08-11，spec v1.3 §7.1）：全站登录墙不内省** | access_token 本地验签（AD-02）；token FR-017~020 N/A |
| OQ-003 | 是否保留 /login | **已裁决（2026-08-11）：保留并落地为登录入口页（FR-030，D-005）** | 未登录重定向目标维持 /login（含 locale 二段式 AR1-009） |
| OQ-004 | 30 天持久化 | **已裁决：启用 offline_access 30 天 + 轮换** | 架构已按 30 天设计（§4.1.4/§7.2） |
| OQ-005~008 | IDP 消费域/体验细节 | 开放（阻塞项已解，OQ-005 有专项记录 §9.3） | 见下 |
| OQ-009 | 登录成功默认落地页 | **已裁决（2026-08-11 业务方确认）：`/solve`**（returnTo 空/非法时回调 302 目标 + /login 已登录重定向目标） | returnTo 正常时按 returnTo 回跳（FR-029）；空/非法 → `/solve` |
| OQ-010 | 多实例扩展 | **已确认单实例（v1.3 更新页面级限流决策）**：限流维持单实例内存；**matcher 扩展覆盖页面路由（D-002）后，页面 HTML 请求随 matcher 全集计入限流（同一配额）；路由侧原「页面级 SSO 路径不扩展 matcher」决策（AR2-012）随 D-002 更新为「公开白名单（/login 等）不进 matcher，登录动作经 /api/sso/* 限流覆盖」** | 多实例迁移时隔离 M3/M6（§8.3） |

### 9.3 OQ-05 候选方案（§9.2 引用）

| 候选 | 方案 | 决策 | 备注 |
|------|------|------|------|
| ① | localStorage 锁互斥 + BroadcastChannel 广播刷新信号（仅信号不传 token，AR2-003） | **主方案（架构落点）** | 锁失败/无广播支持（Safari/隐私模式）→ 兜底 ② |
| ② | 放弃跨标签页协同，各自独立刷新 | 兜底 | 无广播环境下退化为方案 ② 语义（单飞仅内存可见） |

---

## 10. FR 覆盖清单

完整矩阵见 `arch-sso-fr-matrix.md`（v1.3 已同步，含落点/模块/N/A 标注）。本文档对应摘要：

| 模块 | auth spec FR | token spec FR |
|------|--------------|---------------|
| M1 SSO 路由层 | FR-001~006（登录发起）、FR-008~010、FR-019~023（登出 API） | — |
| M2 SSO 服务层 | FR-009~014（回调/验证） | — |
| M3 Token 生命周期 | — | FR-001~010（分发/刷新/轮换） |
| M4 跨标签页协同 | — | FR-005（OQ-05 扩展：锁 + 广播仅信号 AR2-003） |
| M5 认证守卫 | FR-016（Node 深校验 401）、**FR-029（页面 Node 校验入口，v1.3/D-003）** | FR-003（分层核对）；FR-017~020（N/A，OQ-002） |
| M6 middleware | FR-016（粗检）、FR-024、**FR-028（白名单）/FR-029（302+returnTo），v1.3/D-002/D-004** | FR-003（分层核对） |
| M7 登录/登出 UI | FR-001、FR-019、**FR-030（/login 入口页，v1.3/D-005）** | — |
| M8 配置 | FR-027 | FR-021~023（env/脱敏/重试） |

**auth spec FR-028/FR-029/FR-030（v1.3 决策变更新增覆盖）**：FR-028 白名单（`/`、`/login`、`/api/sso/*`、`/api/health` 等运维接口 + 静态资源不被拦）→ §1.3 AD-01/AD-03、§4.1.3（`arch-sso-dataflow.md`）、§8.2 #11；FR-029 页面需登录（302 + returnTo + Node 深校验判定准则 + AC-039）→ §4.1.3（`arch-sso-dataflow.md`）、§6、§9.1 R-15；FR-030 /login 登录入口页 → §4.1.1（`arch-sso-dataflow.md`）、§6、M7。

> **交叉引用注记（AR3-011）**：token spec v1.2 对 auth spec 的版本引用（v1.1 draft、FR-025 引 v1.1 §3.7）已过时——spec 侧已在《待确认》标注待 token 下一轮修订统一（spec-sso-auth-v1.3.md §5.1 OQ-010）；本架构 v1.3 以 auth v1.3 + token v1.2（approved）为需求来源，数据流落点不受影响。

---

## 11. 实施指导

**前置约束**：本架构文件为唯一实施依据（spec 需求已折叠）；实施顺序即下表；每步 TDD（测试先行）+ 类型检查 + lint（对照 §12 验证清单）。

| 步骤 | 任务 | 模块 | 说明 / 验收 |
|------|------|------|------------|
| 1 | jose + env | M8 | `npm view jose versions` 验证 v6.2.8（AR2-006）→ 安装依赖 → 扩展 validateEnv SSO 分组（§7.2，含 mock 分支 AR1-010；NEXT_PUBLIC_SSO_CLIENT_SECRET 存在即报错） |
| 2 | lib/sso 骨架 | M8/M2 | config/types/schemas（含 returnTo Zod schema FR-023）+ pkce.ts 同构纯函数（AR2-011）；单测 |
| 3 | Discovery + JWKS | M2 | discovery-service（1h lru-cache、kid 未命中刷新重试 AR1-006、iss 一致性）；单测 mock fetch |
| 4 | PKCE 生成 + 状态提交 | M7/M1 | pkce.ts 前端态 + login-button（sessionStorage + form POST）+ authorize/route.ts（Zod 校验 → 写状态 cookie 含 sso_return_to AR2-004 → 302）；E2E（@smoke/@no-llm） |
| 5 | 回调 + token 交换 | M1/M2 | callback/route.ts 全流程（§4.1.2 步骤 1-8）+ id-token-verifier + oauth-client（注入 fetch）；单测全 mock |
| 6 | token cookie + refresher | M3 | token-cookie（安全属性）/ token-refresher（单飞 + Set-Cookie 回写 AR2-002）；单测 |
| 7 | 跨标签页协同 | M4 | refresh-sync.ts（localStorage 锁 + BroadcastChannel 仅信号 AR2-003） |
| 8 | requireAuth + middleware 扩展 | M5/M6 | **本步为 v1.3 变更核心**：① middleware 顺序「限流 → 认证」（AR1-001）；② **matcher 扩展覆盖页面路由（D-002，表达式与三分类见 `arch-sso-dataflow.md` §4.1.3）+ 公开白名单常量（D-004，含 /{locale}/login，AR3-001）+ 未登录响应分流：页面 302+returnTo[FR-029] / API 401 JSON[FR-016]**；③ 页面 Node 校验入口 requireAuthPage（D-003，验签核心与 requireAuth 共用、JWKS 唯一路径 AR1-006；失败载体 cookies().delete + redirect，AR3-006）；④ [locale] 302 二段式规则（AR1-009，含 OQ-003 已裁决）；⑤ 受保护 API 接入守卫（/api/solve）；⑥ **首日实测（AR1-011/R-11）含 R-16 页面限流配额评估（完整用户流与快速翻页是否触 429）**；E2E：AC-035/036/037/038（认证/白名单/静态资源断言，含 /{locale}/login 可达） |
| 9 | logout + M7 UI | M1/M7 | logout/route.ts（revoke→清 cookie→end_session form 自动提交页 AR1-002，仅 POST AR2-007）+ logout-button/session-status；**/login 登录入口页（page.tsx RSC 检测/重定向 + login-client.tsx 交互，returnTo 透传+错误提示，FR-030/D-005；登录动作经 login-button form POST /api/sso/authorize，AR3-008）** |
| 10 | 回归 | 全量 | `npm test` + lint + type-check + E2E 分级（含 R-14/R-15 断言）；token 会话 30 天/轮换/登出全链路验证 |

---

## 12. 待确认事项

**业务侧（非阻塞，已裁决项不再列）**：

| # | 事项 | 影响 | 提出者 |
|---|------|------|--------|
| OQ-005 | 登录后 cookie 策略与单标签页体验细节 | 跨标签页单飞（§9.3 候选①为主） | 评审 |
| OQ-006 | IDP 账号注册/找回入口 | /login 页可加提示位（FR-030，不阻塞） | 评审 |
| OQ-007 | IDP 密码策略提示/SSO 失败原因仪表 | 错误码映射（§5.4） | 评审 |
| OQ-008 | ID_TOKEN_VERIFY_MODE 生产强制值 | `soft` 是否生产禁用（§7.2） | 评审 |
| OQ-009 | **默认落地页：`/solve`（已裁决，2026-08-11 业务方确认）** | returnTo 空/非法时回调 302 目标 + /login 已登录重定向目标（FR-030） | v1.3 修订 |
| OQ-010 | 多实例扩展 | 已确认单实例；迁移方案 §8.3（v1.3 更新页面级限流决策） | v1.3 修订 |
| token OQ-04/07/08/09 | token 相关开放项 | 见 token spec v1.2《待确认》 | token spec |

**技术侧**：jose v6.2.8 存在性（实施步骤 1 前置，AR2-006）；`SSO_REFRESH_TOKEN_MAX_AGE_DAYS` 命名审批（AR2-008）；首日实测 JWKS/access_token 契约（AR1-011/R-11）。

**验证清单（v1.2 继承 + v1.3 增补）**：

- [ ] `npm run type-check`（禁 any）
- [ ] `npm run lint`
- [ ] `npm test`（单元 + 集成，SSO 服务全 mock）
- [ ] E2E @smoke / @no-llm / @llm 分级（含 v1.3 增补断言：AC-035 白名单可访问且静态不被拦 / AC-036 未登录 /solve、/result 302 带 returnTo / AC-037 首页公开 / AC-038 /login 渲染 + 入口 + 错误提示 / AC-039 页面 Node 失败清 cookie 302；R-14 死循环断言；**R-16 完整用户流不触 429（含快速翻页）**；**`/{locale}/login` 可达且不被 302/401 拦截（AR3-001，[locale] 落地后启用）**）
- [ ] 安全专项：middleware 未引用 SSO_CLIENT_SECRET（代码评审卡点 A）；**requireAuthPage 失败载体实施注意：cookies() 为只读，须先 await cookies().delete() 清三个会话 cookie 再 next/navigation redirect()（AR3-006）**
- [ ] 两 spec FR 覆盖核对（auth v1.3 全量 + token v1.2 全量，见 fr-matrix）
- [ ] `docs/changelog/` 新增本次 v1.3 决策变更「全站登录墙」更新日志（依据 changelog 规范）

---

*本文件为 arch-sso-v1.2.md 的业务决策变更修订（全站登录墙，AD-01），修订范围严格限定于修订调度 prompt 方案 §一 D-001~D-006；未变更架构（两层运行结构、token 轮换、限流先于认证、JWKS 复用等）全部保留。数据流设计见 `arch-sso-dataflow.md`（§4，AR3-003 拆分）；FR 矩阵见 `arch-sso-fr-matrix.md`（v1.3）。*