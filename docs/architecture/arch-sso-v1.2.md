# SSO 登录认证与 Token 生命周期（SSO 集成模块）技术架构 v1.2

**日期**：2026-08-10 ｜ **状态**：draft ｜ **版本**：v1.2
**需求来源**：`docs/specs/spec-sso-auth-v1.2.md`（approved）、`docs/specs/spec-sso-token-v1.2.md`（approved）
**技术约束**：`docs/integration-guides/sso-idp-sp-integration-guide.md`（第三方契约，仅作协议/端点/安全约束，不照搬代码）
**前置状态**：业务 OQ-004 / OQ-002 / OQ-05 已由业务方确认（§1.2），其余业务 OQ 为开放决策项（§9.2）
**版本历史**：v1.0（2026-08-10）初版；**v1.1（2026-08-10）** 根据 arch-sso-review-r1（第 1 轮）修订，AR1-001~011 全部落实（正文以 AR1-xxx 标注；含 middleware 限流/认证顺序、end_session POST form、状态双写数据流、jose ^6.2.8、M5→M2 唯一路径、服务单例、refresh-sync 迁移、locale 对齐、mock 环境变量、JWKS 复用假设声明）；§10 FR 覆盖矩阵拆分至 `arch-sso-fr-matrix.md`（R-13）。**v1.2（2026-08-10）** 根据 arch-sso-review-r2（第 2 轮）修订，AR2-001~012 全部落实（正文以 AR2-xxx 标注；含 /api/sso/* 豁免认证粗检、cookie 更新通道（同步刷新随响应 Set-Cookie + /api/sso/refresh 主动拉取）、跨标签页协同仅信号不传 token、returnTo 入服务端状态 cookie、路径前缀统一 @/app/lib/、jose 版本验证动作、logout POST-only、OQ-01 状态对齐、限流顺序边界说明、auditLogger 落点、pkce 同构边界、页面级限流决策）。

---
## 1. 架构概述

### 1.1 目标

将现有匿名模式（`middleware.ts` 中 `isAuthenticated` 恒为 true）替换为 SP-Initiated OIDC Authorization Code + PKCE 登录认证体系：① 用户经 IDP（`sso.happyrabbit.top`）登录，SP 经 OIDC 标准流程换取 token；② 登录态以三个 httpOnly Cookie（`sso_access_token` / `sso_refresh_token` / `sso_id_token`）承载；③ 受保护资源（仅 `/api/solve`，OQ-002）由两层校验保障：middleware（Edge）粗校验 + Node 层本地 JWT 验签深校验；④ Refresh Token 轮换续期（OQ-004：30 天持久会话 + 轮换），跨标签页单飞协同（OQ-05）；⑤ SP-Initiated Logout 全流程（revoke → 清 cookie → end_session form POST → 白名单回跳）。

### 1.2 已确认业务决策（架构落地依据，非开放项）

| 编号 | 决策 | 架构落点 |
|------|------|----------|
| OQ-004 | 启用 `offline_access`，30 天持久会话 + refresh 轮换续期；token FR-004~010 全量实现；FR-002 refresh_token cookie 30 天（`SSO_REFRESH_TOKEN_MAX_AGE_DAYS` 默认 30） | §3、§4.2、§5 |
| OQ-002 | 受保护资源 = 仅 `/api/solve`；Node 层仅本地 JWT 验签，不调 IDP 内省端点；middleware matcher 不扩展页面路由；token FR-017~020 降级 N/A | §4.1、§4.2、§6、§9.1 |
| OQ-05 | 跨标签页并发刷新 = 单飞协同（localStorage 锁 + BroadcastChannel） | §4.3、§5 |

### 1.3 核心架构决策表

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| AD-01 | 受保护资源范围 | 仅 `/api/solve`；middleware matcher 保持 `['/api/:path*']`（限流全集），认证粗检为子集（仅 `PROTECTED_API_PREFIX=/api/solve`，AR2-001） | OQ-002；页面路由保持匿名，不破坏现有 UX 与 NFR-004 |
| AD-02 | access_token 深度校验 | Node 层本地 JWT 验签（RS256 + iss/aud/exp，fail-closed），不内省；**JWKS 复用集成指南 §3.5 端点（原规格化用于 id_token，复用假设见 R-11/§11 首日实测）** | OQ-002；FR-017~020 N/A；避免每请求串行 IDP 调用；接受撤销感知失效（R-01） |
| AD-03 | 两层运行结构 | middleware（Edge）：仅 cookie 存在性 + 解码级 exp 检查，不验签/不内省/不续期/不引用 `SSO_CLIENT_SECRET`；**粗检仅对受保护资源生效，`/api/sso/*` 豁免（AR2-001）**；Node 层完整本地验签 | auth FR-016 / token FR-003；Edge 引用 client_secret 会被内联泄露（FR-024） |
| AD-04 | 续期触发与 401 语义 | 触发：①Node 受保护请求剩余 < 60s ②受保护请求/userinfo 401；middleware 302 不触发续期；401/失效语义 SP 内部定义（`AUTH_SESSION_INVALID`） | auth FR-017/018、token FR-004；过期不尝试续期（FR-017） |
| AD-05 | 刷新单飞 | 服务端内存 inflight Map（复用 fs-html-cache 先例）+ 跨标签页协同（localStorage 锁 + BroadcastChannel，**仅信号不传 token，AR2-003**） | token FR-005 + OQ-05；避免并发刷新同一旧 refresh_token 触发 IDP 重放检测撤销全会话 |
| AD-06 | JWT 验签实现 | 新增 `jose` 依赖（锁定 `^6.2.8`，AR1-005；**实施前 `npm view jose versions` 验证存在性，AR2-006**；Edge/Node 双运行时） | 集成指南 §2.4 推荐；WebCrypto 自实现风险高（R-04） |
| AD-07 | Discovery/JWKS 缓存 | 内存缓存 1h（lru-cache），kid 未命中刷新重试一次；id_token 与 access_token 共用同一 JWKS 缓存（唯一路径，AR1-006） | auth FR-012/014、token NFR-003；端点 URL 全取 Discovery，禁硬编码 |
| AD-08 | 状态持久化 | **前端生成** code_verifier/state/nonce/returnTo → 前端写 sessionStorage → form POST 提交 `/api/sso/authorize` → 服务端 Zod 校验后写 httpOnly cookie（**含 sso_return_to，AR2-004**；权威）；回调服务端读 cookie、前端读 sessionStorage（闭环见 §4.1.1，AR1-003） | auth FR-003（R2-003）/FR-005；cookie 通道 httpOnly 前端不可读，双写值须由前端生成并经提交路径到服务端 |
| AD-09 | 登出编排 | revoke（access+refresh）→ 清本地 cookie → end_session（**浏览器 HTML form 自动提交，POST x-www-form-urlencoded**）+ 白名单回跳 | auth FR-019~023、token FR-011~016；302 无法携带 POST body，end_session 载体必须为 form 自动提交（AR1-002） |
| AD-10 | IDP 调用重试 | 429 按 Retry-After 精确等待（≤3 次）；网络/5xx 指数退避（≤3 次）；耗尽 → `AUTH_IDP_RATE_LIMITED` | auth FR-025、token FR-010/023 |
| AD-11 | 回调/登出参数校验 | Zod schema 服务端校验，禁信任客户端 | code-style + auth FR-006/019 |
| AD-12 | 环境变量管理 | 扩展 `app/lib/env.ts` `validateEnv()` + 模块级缓存；`SSO_MOCK_ENABLED=1` 时 `SSO_CLIENT_SECRET` 可缺省、`SSO_ISSUER` 仍必填（§7.2，AR1-010） | 项目既有约定；`SSO_CLIENT_SECRET` 禁 `NEXT_PUBLIC_` 前缀（FR-024/021） |
| AD-13 | 跨标签页刷新协同 | localStorage 锁（互斥持有者）+ BroadcastChannel 广播「刷新完成」信号（**不传递 token**，cookie 更新一律经服务端 Set-Cookie，AR2-003） | OQ-05 决策；候选①落地（§9.3） |

### 1.4 边界（不实现）

依据 auth spec §5：IdP-Initiated SSO、DPoP、PAR、Back-Channel Logout、DCR/client_credentials/SCIM、LDAP 直连、**middleware 分布式限流改造（跨实例共享计数）**、groups 权限映射、多实例共享存储、SAML/WS-Fed/Front-Channel Logout（IDP `frontchannel_logout_supported=false`）。OQ-06（Edge+client_secret 调 introspect）因 OQ-02 不内省而不再适用。

> 边界澄清（AR1-001/AR2-009）：边界内「限流改造」仅指**分布式化**（维持单实例内存限流，OQ-010）；**限流/认证执行顺序调整**（现状认证先于限流 → 改为限流先于认证）**纳入实施范围**，见 §4.1.3 与 §11 步骤 8。与 auth spec §5 第 8 条「不改造现有 middleware 速率限制逻辑——仅替换认证钩子」的边界（AR2-009）：顺序调整属**认证钩子替换**范畴——限流逻辑本体（单 IP 每分钟 20 次、`/api/health` 不限流、配额窗口/429 响应）完全不变，仅将认证钩子执行位置从限流之前移到限流之后（钩子本体替换即 spec 允许的「仅替换认证钩子」），不构成对限流逻辑的改造。

---
## 2. 模块划分

### 2.1 模块清单

| 模块 | 名称 | 运行时 | 职责 | 对应 FR |
|------|------|--------|------|---------|
| M1 | SSO 路由层 | Node（Route Handler） | `/api/sso/*`：authorize（form POST）/ callback / logout（**仅 POST，AR2-007**）；Zod 校验、错误 envelope | auth FR-001~010、FR-019~023 |
| M2 | SSO 服务层 | Node | Discovery、JWKS 缓存、token 交换、id_token 验证、userinfo、revoke、end_session 编排 | auth FR-009~014、FR-019~022 |
| M3 | Token 生命周期服务 | Node | refresh 轮换、单飞（inflight Map）、失败分类、token cookie 读写（**仅经响应 Set-Cookie 写入，AR2-002**） | token FR-001~010 |
| M4 | 跨标签页协同 | 浏览器（工具模块，非 UI） | localStorage 锁 + BroadcastChannel **仅作「刷新完成/会话失效」信号，不传递 token**（JS 无法写 httpOnly cookie，AR2-003）；他标签页收到信号后主动调 `/api/sso/refresh`（Set-Cookie 回写）或清除前端 sessionStorage + 提示重登；置于 `lib/sso/refresh-sync.ts`（AR1-008） | token FR-005（OQ-05 扩展） |
| M5 | 认证守卫（Node 层） | Node | 受保护 API（`/api/solve`）access_token 本地 JWT 验签（iss/aud/exp fail-closed）；JWKS 取 M2（唯一路径，AR1-006） | auth FR-016、token FR-003/017（N/A 化后职责） |
| M6 | middleware（Edge） | Edge | 限流（先于认证，AR1-001；所有 `/api/*`）+ 认证粗检（**仅 /api/solve，/api/sso/* 豁免，AR2-001**）+ exp 粗检 + 302（locale 规则 §4.1.3）；**禁引用 SSO 密钥 env** | auth FR-016/024 |
| M7 | 登录/登出 UI 组件 | 浏览器 | 登录入口（生成 PKCE 状态 + sessionStorage + form POST）、登出按钮（form POST）、会话状态提示 | auth FR-001/019 入口 |
| M8 | 配置与环境 | Node/Edge | `validateEnv()` 扩展 SSO 分组校验（含 mock 分支，AR1-010） | auth FR-027 |

### 2.2 模块依赖关系

```
middleware.ts(Edge) ─── 仅读 cookie（解码 exp，不验签）──→ 浏览器
    │ 限流（所有 /api/*，先于认证）→ 认证粗检（仅 /api/solve）→ 302（未登录 / exp 过期）
    ▼
M1 SSO 路由层(Route Handler, Node) ──→ M2 SSO 服务层 ──→ IDP (Discovery/Token/UserInfo/Revoke/EndSession)
    │                                    │
    │                                    ▼
    │                              M3 Token 生命周期服务（refresh 轮换/单飞/cookie，Set-Cookie 写入 AR2-002）
    ▼
M7 登录/登出 UI ── 客户端 ──→ M4 跨标签页协同（lib/sso/refresh-sync.ts，广播仅信号 AR2-003，收信号主动调 /api/sso/refresh 回写）
    ▼
M5 认证守卫(Node) ←── JWKS 缓存（M2，唯一路径，AR1-006）── 深度校验 ── /api/solve/route.ts
    ▼
M8 配置与环境（validateEnv()，SSO_CLIENT_SECRET 仅 Node 侧）
```

依赖方向：M1 → M2 → M3 → M8；M2 → IDP（HTTP）；M5 → M2（JWKS 缓存，**唯一实现路径**，AR1-006 已裁决，无「独立 jose 验签」分支）；M6 独立（Edge，仅 Web API 与 cookie）；M4 → M3 浏览器侧（经 `/api/sso/refresh`，服务端 Set-Cookie 回写）。

---
## 3. 技术选型

技术栈与 `package.json` 现状核对（依赖版本以下文为准）：

| 类别 | 技术 | 版本（package.json） | 用途 |
|------|------|---------------------|------|
| 框架 | Next.js（App Router，`[locale]` 国际化规划中） | 15.1.6 | 路由层 M1/M6、SSR 页面 |
| 语言 | TypeScript | ^5.7.3 | 全量类型约束（禁 any） |
| 样式 | Tailwind CSS | ^3.4.17 | UI 组件样式 |
| 校验 | zod | ^3.24.1 | 回调/登出/authorize 提交参数 Schema 验证 |
| 缓存 | lru-cache | ^11.5.1 | Discovery/JWKS 1h 缓存、token 交换响应缓存 |
| JWT 验签 | **jose（新增）** | **^6.2.8**（AR1-005 锁定；**实施前 `npm view jose versions` 验证 v6.2.8 存在，AR2-006**；Edge/Node 双运行时） | RS256 本地验签（id_token 8 步、access_token 深校验）。备选 WebCrypto 自实现（不推荐，AD-06/R-04） |
| HTTP | fetch（Node 内置） | — | SP → IDP 调用（token/revoke/userinfo/discovery/jwks），带超时与重试 |
| 图标 | lucide-react | ^1.21.0 | 按钮图标（禁内联 SVG） |
| UI 变体 | class-variance-authority + tailwind-merge + clsx | ^0.7.1 / ^3.6.0 / ^2.1.1 | 按钮/表单组件变体 |
| 测试 | Vitest + @playwright/test | ^3.0.0 / ^1.61.1 | 单测全 mock、E2E 分级（@smoke/@no-llm/@llm） |

**依赖变更说明**：新增 `jose@^6.2.8`（唯一新增运行时依赖）：OQ-002 核心需求（RS256 本地验签）；Edge/Node 双兼容；集成指南 §2.4 推荐。拒绝时备选 WebCrypto（R-04）。

---
## 4. 数据流设计

### 4.1 正常流

#### 4.1.1 登录发起（SP-Initiated，auth FR-001~005）

```
浏览器 → [点击登录] → M7 login-button（客户端组件，JS 必需）
  1. 前端生成 code_verifier(≥43) + code_challenge=BASE64URL(SHA256(verifier))、
     state(≥32)、nonce(≥32)（算法取 lib/sso/pkce.ts 同构实现，AR2-011）
  2. 前端写 sessionStorage：{ code_verifier, state, nonce, returnTo }（FR-003/005 前端侧）
  3. 动态构造 form POST /api/sso/authorize（隐藏字段 code_verifier/code_challenge/state/nonce/returnTo，敏感值走 body 不落 URL/历史）→ form.submit()
     ↓
/api/sso/authorize (Route Handler, Node)
  4. Zod 校验 body（长度/字符集/一致性）→ 写状态 cookie：sso_pkce_verifier / sso_oauth_state /
     sso_oauth_nonce / **sso_return_to**（httpOnly+sameSite=lax+secure(生产)，maxAge=10min 一次性，
     cookie 为权威副本；returnTo 为 FR-005 服务端落点，AR2-004）
  5. 构造 authorize URL：client_id / redirect_uri(注册值完全匹配) / response_type=code /
     scope(必含 openid) / state / code_challenge / code_challenge_method=S256 / nonce / iss
  6. 302 → IDP authorize_endpoint（顶层导航跟随跨域，前端 JS 不再参与）
```

**双写数据流闭环（AR1-003/AR2-004）**：状态值（含 returnTo）由**前端生成**（写 sessionStorage，前端读）→ 经 form POST **提交路径**传递服务端 → 服务端校验后写 **httpOnly cookie**（服务端读）。两端同值自洽：回调时服务端以 cookie 比对 `state`（权威，FR-007）、读 `sso_return_to` 恢复跳转（AR2-004），sessionStorage 为前端兜底（cookie 被清时提示重登）。`code_verifier`「禁前端 JS 可读」仅指 **cookie 通道 httpOnly**（`document.cookie` 读不到）；前端生成瞬间持有并以 POST body 提交是 RFC 7636 客户端生成语义，不落 URL/历史（FR-026 脱敏覆盖）。

#### 4.1.2 回调与令牌交换（auth FR-006~014）

```
IDP → 302 → /api/sso/callback?code&state&iss (Route Handler, Node)
  1. Zod 校验 query；code/state/iss 缺失 → 400 AUTH_LOGIN_MISSING_PARAMS
  2. error 参数：access_denied → 友好提示+清一次性状态；其他 → AUTH_LOGIN_IDP_ERROR
  3. state 与 cookie sso_oauth_state 比对（cookie 权威，§4.1.1）→ 不一致 400 AUTH_LOGIN_STATE_MISMATCH（一次性，交换成功即清）
  4. iss 与 Discovery issuer 比对 → 不一致 AUTH_LOGIN_ISS_MISMATCH（RFC 9207）
  5. 服务端 POST IDP token_endpoint（authorization_code：code/redirect_uri/client_id/
     client_secret/code_verifier）→ token_type 须 Bearer（小写比较）否则 AUTH_TOKEN_EXCHANGE_FAILED
  6. id_token 8 步验证（FR-011）：三段格式 / alg 白名单 RS256 拒 none / kid 匹配 JWKS /
     RSA-SHA256 签名 / iss / aud 含 client_id / exp 容差 60s / nonce 比对
     → ID_TOKEN_VERIFY_MODE=strict 拒登 / soft 记日志
  7. 调 userinfo（Bearer access_token），sub 与 id_token.sub 一致否则失败；userinfo 401 → 触发续期（FR-018）重试
  8. 写 cookie：sso_access_token(maxAge=expires_in≈900s) / sso_refresh_token(30 天) /
     sso_id_token(30 天)；均 httpOnly+secure(生产)+sameSite=lax+path=/
  9. 读 sso_return_to cookie（权威，AR2-004，随一次性状态清除）→ 开放重定向校验（FR-023）→ 302；空/非法 → 默认落地页（OQ-009）
```

#### 4.1.3 受保护资源访问（两层校验，auth FR-016 / token FR-003）

```
浏览器 → /api/solve (POST) → middleware.ts(Edge, M6)
  1. 限流检查（所有 /api/* 先消耗配额，超限 429 GESP6_RATE_LIMITED）
  2. 认证粗检（**仅对受保护资源生效，AR2-001**）：仅 PROTECTED_API_PREFIX=/api/solve 的请求读
     sso_access_token cookie，不存在/解码失败/exp 过期 → 302 重定向登录（Edge 仅解码不验签、不引用
     SSO_CLIENT_SECRET）；**/api/sso/* 豁免粗检仅限流**（matcher 为限流全集、粗检为其子集），否则自身 302 死循环
  3. 通过 → 放行 Node 层
     ↓
/api/solve/route.ts → M5 认证守卫（Node）
  4. access_token 本地 JWT 验签：RS256（jose ^6.2.8）+ kid 匹配 JWKS（取 M2 缓存，AR1-006）+
     iss=SSO_ISSUER + aud 含 SSO_CLIENT_ID + exp 未过期（fail-closed）
  5. 剩余寿命 < 60s → 同步触发 M3 续期（单飞在途），成功**随当前响应 Set-Cookie 替换 cookie**（httpOnly 仅经响应头写入，AR2-002，见 §4.1.4）
  6. 通过 → 执行业务逻辑；失败 → 401 AUTH_SESSION_INVALID（清会话 cookie 引导重登）
```

**middleware 顺序说明（AR1-001/AR2-009）**：middleware.ts 现状「认证检查（L82-87）→ 限流（L89-106）」，未认证请求直接 302、不消耗 20 次/min 配额。SSO 上线后未认证请求成为常态流量，若保持该顺序则攻击者可无限发起未认证请求绕过限流。故将**「限流 → 认证」顺序调整纳入实施范围**（仅调整 middleware 内两个代码块次序，成本极低），未认证请求同样消耗配额，并消除与本节步骤 1-2 的矛盾（§11 步骤 8）。与 auth spec §5 第 8 条边界关系见 §1.4（AR2-009）。

**302 重定向 locale 规则（AR1-009）**：二段式——① `[locale]` 路由落地前：维持现状顶层 `/login`（当前项目无 `[locale]` 目录，§6 注）；② `[locale]` 落地后：从请求路径提取首段 locale（如 `/zh/...`），命中支持列表则 302 → `/{locale}/login`，无前缀/未知 → 默认 locale（取值随 `[locale]` 实施时 i18n 配置，项目暂未配置）。与 OQ-003 联动，落地时对齐验证（§11 步骤 8）。

#### 4.1.4 刷新续期（token FR-004~010 + OQ-05 扩展）

```
cookie 更新通道（AR2-002）：httpOnly 仅能经响应 Set-Cookie 写入、后台异步无法写——替换一律随响应头
完成：①同步（守卫内刷新）②主动（前端调 /api/sso/refresh 服务端回写）→ M3；触发：剩余 <60s 或 401
  1. 单飞检查：服务端 inflight Map（key=会话标识）在途 → 挂起等待同结果
  2. 跨标签页协同（M4，lib/sso/refresh-sync.ts，AR2-003 载体修正）：
     a. 先尝试获取 localStorage 锁（持有者标识 + 时间戳 + 会话标识）
     b. 成功 → 本标签页执行刷新（POST IDP token_endpoint, refresh_token grant），成功后随响应 Set-Cookie
     c. 失败（他标签页在刷）→ 监听「刷新完成」信号（仅信号不传 token，JS 无法写 httpOnly，AR2-003）→ 主动调 /api/sso/refresh 获取 Set-Cookie 回写；无后续请求仅清 sessionStorage + 提示
     d. 刷新成功后：BroadcastChannel 广播「刷新完成」（不含 token）给其他标签页
  3. 成功：响应 Set-Cookie 立即替换 sso_refresh_token（新值）+ 覆盖 sso_access_token（maxAge 按
     新 expires_in 重置，FR-006）；旧 refresh 立即失效（FR-007）；无 id_token 不更新（FR-008）
  4. 失败：invalid_grant → 清全部 token cookie + 引导重登 + 安全告警（AUTH_TOKEN_INVALID_GRANT 不含明文，
     FR-009）；invalid_client → 不重试记配置错误（FR-010）；429 → Retry-After 精确等待；网络/5xx →
     指数退避 ≤3 次；耗尽 → AUTH_TOKEN_REFRESH_FAILED / AUTH_IDP_RATE_LIMITED（FR-010/023）
```

#### 4.1.5 登出（SP-Initiated Logout，auth FR-019~023 / token FR-011~016）

```
浏览器 → [点击登出] → form POST /api/sso/logout（**仅 POST，GET 返回 405，AR2-007**）
  1. 服务端 revoke：POST IDP revocation_endpoint（token=access_token + token_type_hint）
     → 再 revoke refresh_token（跨类型扩展查找，FR-011/012）
  2. revoke 失败不阻断登出（FR-013/020），cookie 必清（AUTH_TOKEN_REVOKE_FAILED 仅记日志）
  3. 清本地全部会话 cookie（sso_access_token / sso_refresh_token / sso_id_token）
  4. 生成登出 state(≥32)；构造 **end_session HTML form 自动提交页**（AR1-002）：method=POST action=
     IDP end_session_endpoint，enctype=x-www-form-urlencoded，隐藏字段：id_token_hint（不可用/验签失败
     → client_id 回退，FR-019）+ post_logout_redirect_uri（白名单，FR-022）+ state；页面 onload 自动
     submit（POST 载体保证 id_token_hint 不进浏览器历史；302 无法携带 POST body，故不以 302 提交）
  5. 浏览器顶层 POST 至 IDP（清理 IDP 侧会话 cookie）；IDP 302/307 回跳 post_logout_redirect_uri?state → 校验一致跟随（不一致仍视为登出完成不跳第三方，FR-021）；未提供 redirect → 200 {success:true}
```

### 4.2 异常流

| 异常 | 检测点 | 处理 | 错误码 |
|------|--------|------|--------|
| 回调缺参 | callback | 400，不交换 | `AUTH_LOGIN_MISSING_PARAMS` |
| IDP error=access_denied | callback | 友好提示 + 清一次性状态 | —（页面提示） |
| IDP 其他 error | callback | 400 | `AUTH_LOGIN_IDP_ERROR` |
| state 不一致 | callback | 400，拒绝交换 | `AUTH_LOGIN_STATE_MISMATCH` |
| iss 不一致 | callback | 拒绝（RFC 9207） | `AUTH_LOGIN_ISS_MISMATCH` |
| authorize 提交参数非法 | authorize | 400，不写 cookie | `AUTH_LOGIN_MISSING_PARAMS` |
| token 交换失败（invalid_grant 等） | callback | 引导重登 + 清一次性状态；提示仅错误码+通用文案 | `AUTH_TOKEN_EXCHANGE_FAILED` |
| token 交换网络失败 | callback | 502 语义错误 | `AUTH_LOGIN_IDP_UNREACHABLE` |
| id_token 验证失败 | callback | strict 拒登 / soft 记日志 | `AUTH_ID_TOKEN_INVALID` |
| Discovery 获取失败 | callback/refresh | 500 | `AUTH_IDP_DISCOVERY_FAILED` |
| access_token 过期/非法 | middleware(Node 守卫) | 401 + 清 cookie + 引导重登 | `AUTH_TOKEN_EXPIRED` / `AUTH_SESSION_INVALID` |
| 刷新 invalid_grant | refresh | 清全部 cookie + 重登 + 安全告警 | `AUTH_TOKEN_INVALID_GRANT` |
| 刷新失败（网络/5xx 耗尽） | refresh | 保持旧 access 至过期，返回错误 | `AUTH_TOKEN_REFRESH_FAILED` |
| IDP 限流耗尽 | 任意 IDP 调用 | 429 语义 | `AUTH_IDP_RATE_LIMITED` |
| revoke 失败 | logout | 不阻断，cookie 必清 | `AUTH_TOKEN_REVOKE_FAILED`（仅日志） |
| 登出重定向不合法 | logout | 拒绝跳转 | `AUTH_LOGOUT_REDIRECT_INVALID` |

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
  getJwks(): Promise<ServiceResult<JsonWebKeySet>>; clearCache(): void;
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

**不收录**：`AUTH_LOGIN_INVALID_CREDENTIALS`（凭证校验在 IDP 侧，两 spec 均明确不收录）。**用户提示**：仅错误码 + 安全通用文案（FR-026），不泄露 IDP 细节、token 值、会话标识。

---
## 6. 目录结构

遵循 dev 规则（`@/` 绝对路径、kebab-case、单文件 ≤500 行、页面 ≤300 行、Server Action 用 actions.ts）：

```
middleware.ts（项目根目录，Next.js 15 约定，AR1-004）      # M6：Edge 限流（先于认证）+ cookie exp 粗检（仅 /api/solve，AR2-001）+ 302
app/
├── api/
│   ├── solve/route.ts                     # 既有（不变）：接入 M5 requireAuth 守卫
│   └── sso/                               # M1：SSO 路由层（Node）
│       ├── authorize/route.ts             # 登录发起：form POST 状态值 → 写状态 cookie（含 sso_return_to，AR2-004）→ 302
│       ├── callback/route.ts              # 回调：校验+交换+8 步验证+userinfo+写 cookie+returnTo 恢复
│       ├── logout/route.ts                # 登出编排（仅 POST，AR2-007）→ end_session form 自动提交页
│       └── refresh/route.ts               # 刷新端点（同步/主动拉取路径，Set-Cookie 回写，AR2-002）
├── lib/
│   ├── env.ts                             # M8：validateEnv() 扩展（SSO 分组 + mock 分支，AR1-010）
│   ├── logging/logger.ts                  # 既有：应用日志（脱敏由 M2/M3 保证）
│   ├── logging/audit-logger.ts            # 新增（AR2-010）：auditLogger.log()（仅 API/Server Action 层）
│   ├── auth/                              # M5：认证守卫
│   │   ├── guard.ts                       # requireAuth：本地 JWT 验签 fail-closed（JWKS 取 M2，AR1-006）
│   │   └── guard.test.ts
│   ├── sso/                               # M2/M3/M4：SSO 服务层（Node）+ 浏览器侧工具
│   │   ├── config.ts                      # SsoConfig 读取（模块级缓存）
│   │   ├── types.ts                       # SsoConfig/TokenResponse/IdTokenClaims 等类型
│   │   ├── schemas.ts                     # 回调/登出/authorize 提交参数 Zod schema
│   │   ├── pkce.ts                        # code_verifier/challenge/state/nonce 生成与校验（同构纯函数：仅 Web API——crypto.getRandomValues/TextEncoder/SubtleCrypto，无 Node API 依赖；'use client' 组件与 Node 服务层均可引用，AR2-011）
│   │   ├── discovery-service.ts           # Discovery/JWKS 缓存 1h（单例）
│   │   ├── oauth-client.ts                # SP→IDP HTTP 调用（超时+重试，单例，AR1-007）
│   │   ├── id-token-verifier.ts           # id_token 8 步验证（单例）
│   │   ├── token-cookie.ts                # 三个 token cookie + 状态 cookie 读写（安全属性集中定义）
│   │   ├── token-refresher.ts             # 刷新轮换 + 单飞 inflight Map（单例，Set-Cookie 写入 AR2-002）
│   │   ├── logout-service.ts              # revoke + 清 cookie + end_session form 页构造
│   │   ├── refresh-sync.ts                # M4：跨标签页协同（浏览器侧工具，AR1-008 由 components 迁入；仅信号不传 token，AR2-003）
│   │   └── __tests__/                     # 各服务单测（全 mock，无模型）
│   └── ai/types.ts                        # 既有：ServiceResult 定义（复用）
├── components/
│   └── auth/                              # M7：登录/登出 UI（仅 UI 组件，AR1-008）
│       ├── login-button.tsx               # 生成 PKCE 状态（引 pkce.ts 同构实现，AR2-011）+ 写 sessionStorage + form POST（§4.1.1）
│       ├── logout-button.tsx              # 登出入口（form POST /api/sso/logout，AR2-007）
│       └── session-status.tsx             # 会话状态提示（可选）
└── [locale]/                              # 规划中（OQ-003）；落地后 middleware 302 带 locale 前缀（AR1-009）
    ├── layout.tsx
    └── login/page.tsx
```

**目录约定说明**：① **middleware.ts 在项目根目录**（非 `app/`）——Next.js 15 约定 middleware 须在根目录或 `src/`，`app/` 内不生效（AR1-004），与现状一致；② **`refresh-sync.ts` 置于 `lib/sso/`**——components/ 只放 UI 组件（component-rules），跨标签页协同为浏览器侧纯工具（AR1-008）；③ 跨模块引用一律 `@/` 绝对路径（禁 `../`），§5.2 注释路径与此一致（AR2-005）；④ `callback/route.ts` 预计超限 → 编排下沉至 `lib/sso/` 服务层，route 薄适配（§9.1 R-08）。

---
## 7. 依赖关系

### 7.1 运行时依赖（新增 1 项）

| 包 | 版本约束 | 用途 |
|----|----------|------|
| `jose` | **^6.2.8**（新增，AR1-005 锁定；**实施步骤 1 前置 `npm view jose versions` 验证，AR2-006**） | Node 层 RS256 本地验签（id_token 8 步 + access_token 深校验） |

其余依赖零新增（zod/lru-cache/fetch 均已在 package.json 或运行时内置）。

### 7.2 环境变量清单（扩展 `validateEnv()`）

**浏览器可见（NEXT_PUBLIC_ 前缀，无敏感值）**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_SSO_ISSUER` | 无（必填） | IDP issuer，如 `https://sso.happyrabbit.top` |
| `NEXT_PUBLIC_SSO_CLIENT_ID` | 无（必填） | 公开的 client_id |
| `NEXT_PUBLIC_SSO_REDIRECT_URI` | 无（必填） | 回调地址，须与注册值完全匹配 |
| `NEXT_PUBLIC_SSO_SCOPE` | `openid profile email groups offline_access` | 空格分隔 scope（必含 openid + offline_access） |

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
## 8. 非功能设计

### 8.1 性能

| 项 | 设计 |
|----|------|
| Discovery/JWKS | 内存缓存 1h（lru-cache）；kid 未命中刷新一次（FR-012）；id_token/access_token 共用 |
| 受保护请求 | 本地 JWT 验签纯 CPU（jose），无 IDP 串行调用（OQ-02 收益） |
| 续期 | **同步刷新仅发生在剩余 <60s 小窗口**（AR2-002），单飞防重复；刷新随当前响应 Set-Cookie，阻塞成本受限窗口内 |
| IDP 调用超时 | token/revoke/userinfo 均设超时（建议 10s）+ 重试（429 Retry-After / 指数退避 ≤3 次） |

### 8.2 安全（两 spec §5 安全要求并集）

| # | 要求 | 架构落点 |
|---|------|----------|
| 1 | PKCE 强制（S256） | authorize 必带 `code_challenge_method=S256`；verifier ≥43；前端生成 → sessionStorage + httpOnly cookie 双写（§4.1.1，FR-002/003） |
| 2 | state CSRF（≥32） | state ≥32 加密随机；前端生成经 form POST 提交，服务端 cookie 权威比对；一次性交换后清除（FR-007） |
| 3 | id_token 验证（strict） | 8 步验证（FR-011），默认 strict；JWKS 缓存 1h；access_token 复用同一 JWKS（假设见 AD-02/R-11） |
| 4 | Cookie 安全 | `httpOnly + secure(生产) + sameSite=lax + path=/ + maxAge`（access 900s / refresh 30 天 / id_token 30 天；**一次性状态 cookie 含 sso_return_to 均 10min，AR2-004**） |
| 5 | 开放重定向防御 | returnTo（服务端读 `sso_return_to` cookie，AR2-004）/登出目标规范化为同源相对路径；拒 `//evil.com`、跨域、`javascript:`/`data:`（FR-023） |
| 6 | Refresh 轮换 | 旧 refresh 立即失效 + 立即替换（**随响应 Set-Cookie，AR2-002**）+ 重放触发 IDP 撤销全会话 → SP 清本地引导重登（FR-006~009） |
| 7 | client_secret 保护 | 仅服务端；禁 `NEXT_PUBLIC_SSO_CLIENT_SECRET`；构建产物不得出现；Edge 禁引用；前端不得直连 token/revoke/introspect（FR-024/021/012） |
| 8 | 端点限流 | middleware 调整为**限流先于认证**（AR1-001），未认证请求同样消耗配额；matcher 保持 `/api/:path*`（限流全集）；**认证粗检仅对受保护资源 `/api/solve` 生效，`/api/sso/*` 豁免粗检仅限流**（AR2-001）；**页面级 SSO 路径（登录页/登出页）不扩展 matcher 限流**——页面路由保持匿名（OQ-002），`/api/sso/*` 已由现有 matcher 覆盖（FR-024 归属决策，AR2-012）；429+Retry-After+指数退避（FR-024/025） |
| 9 | 日志脱敏 | 禁输出 access/refresh/id_token、code、state、code_verifier、client_secret、会话标识（FR-026/022）；用户提示仅错误码+通用文案 |
| 10 | 浏览器不直连 IDP | CSP `connect-src 'self'` 不调整；Discovery/JWKS/UserInfo/token/revoke 全服务端；**end_session 例外**：OIDC RP-Initiated Logout 标准要求浏览器顶层 POST 至 IDP（携带 IDP 侧会话 cookie），服务端仅构造 form 参数与编排（FR-014/021、AR1-002） |
| 11 | IDP 混淆防护 | 回调校验 iss（RFC 9207，FR-008）；end_session 身份校验（id_token_hint aud → client_id 回退） |

### 8.3 可扩展性

受保护资源扩展：复用 `requireAuth`（M5）与 middleware 粗检；内省能力：OQ-02 反转时可在 M5 内插入内省调用（FR-017~020 届时激活）；多实例：单飞 inflight Map 与限流为单实例内存语义，多实例需 Redis（OQ-010）。

### 8.4 可观测性

SSO 事件结构化日志（`logger`），含错误码/阶段/耗时，无敏感值（FR-026）；审计日志（`auditLogger`，**新增 `@/app/lib/logging/audit-logger.ts`，AR2-010**；仅 API/Server Action 层调用）记录登录成功/失败/登出/刷新 invalid_grant 告警；关键指标：登录成功率、刷新失败率（按错误码）、IDP 调用延迟/429 计数。

---
## 9. 风险与对策

### 9.1 风险清单

| # | 风险 | 等级 | 对策 |
|---|------|------|------|
| R-01 | **IDP 撤销/重放检测失效无法被 SP 感知**（OQ-02 副作用）：仅本地验签时 IDP 侧撤销的 token 在 exp 前仍被接受；refresh 重放导致 IDP 撤销全会话，SP 仅下次刷新时发现 | 高（业务已接受） | ① access_token 15min 短寿命缩小暴露窗口；② 刷新 invalid_grant → 清全部 cookie + 安全告警（FR-009）；③ 需实时感知 → 激活内省（§8.3） |
| R-02 | 跨标签页并发刷新触发 IDP 重放检测（OQ-05 未实现时） | 高 | M4 单飞已落地；竞态窗口（锁持有者崩溃等）→ 兜底：invalid_grant 时清会话引导重登 |
| R-03 | Edge middleware 误引用 SSO 密钥 env 泄露 | 高 | 代码评审硬查：middleware.ts 只读 cookie 与 `NEXT_PUBLIC_*`；构建产物 grep `SSO_CLIENT_SECRET`（CI 步骤） |
| R-04 | 新增 `jose` 依赖被拒 | 中 | 备选 WebCrypto 自实现 RS256（node:crypto subtle.verify），算法细节易错、测试要求高 |
| R-05 | Discovery/JWKS 缓存与密钥轮换错位 | 中 | kid 未命中刷新重试一次（FR-012）；TTL 1h |
| R-06 | IDP 不可达时受保护功能不可用（fail-closed 副作用） | 中 | token NFR-004 已声明；`AUTH_IDP_DISCOVERY_FAILED` 可监控；仅缓存缺失时才依赖 IDP |
| R-07 | 回调状态 cookie 与 sessionStorage 双写不一致 | 低 | 双写容错（FR-003）：cookie 权威、sessionStorage 前端兜底；前端生成值经 form POST 提交，服务端 Zod 拒绝非法值（§4.1.1，AR1-003） |
| R-08 | 单文件超限 | 中 | `callback/route.ts` 编排下沉 `lib/sso/oauth-client.ts`+`id-token-verifier.ts`，route 薄适配；仍超则拆 `token-cookie.ts` |
| R-09 | SSO_MOCK_ENABLED mock IDP 与真实 IDP 行为偏差 | 中 | E2E @smoke 用 Playwright route 拦截真实契约路径；mock 仅本地开发（NFR-003） |
| R-10 | `/api/sso/refresh` 端点暴露被滥用 | 低 | 仅内部调用（不注册公开路由）或校验会话标识 + 限流覆盖；以服务层直调为主 |
| R-11 | **access_token 验签复用 JWKS 的假设不成立**（AR1-011）：集成指南 §3.5 JWKS 仅规格化「验证 id_token 签名」（kid/AI 清单均只提 id_token）；若 IDP 以独立密钥集签发 access_token（kid 不在 JWKS 或 alg 不同），本地验签失败 | 中 | **显式声明假设**：access_token 本地验签复用同一 JWKS，假设 IDP 以同一签名密钥集签发（kid 匹配）；**列入实施首日实测确认项**（§11 步骤 8）：真实 IDP access_token 走通 RS256 验签；不成立时调整路径（access_token 改 userinfo 校验确认 / 扩展 JWKS 获取逻辑） |
| R-12 | `[locale]` 落地前 middleware 302 `/login` 与 `[locale]/login` 未对齐（AR1-009） | 低 | 当前无 `[locale]` 目录，`/login` 为现状顶层路由（OQ-003 待确认）；落地时按 §4.1.3 locale 规则调整并加入步骤 8 对齐验证 |
| R-13 | 主文档单文件行数超限（500 行约束） | 中 | **拆分计划**：v1.0 基线 568 行本身超限；v1.1 已压缩冗余并将 §10 FR 覆盖矩阵**拆分至独立文件 `arch-sso-fr-matrix.md`**（主文档保留 §10 模块↔FR 摘要表）；若后续修订再次超限，继续拆分 §4 数据流（login-flow/logout-flow 分文件） |

### 9.2 开放决策项（业务 OQ，架构不擅自决断，附候选方案）

| # | OQ | 候选方案 | 架构影响 |
|---|-----|----------|----------|
| OQ-001 | 业务集成目标（受保护资源/登录体验） | A：仅保护 `/api/solve`；B：全站登录墙 | 按 OQ-002 以 A 设计；改 B 则 matcher 扩展页面路由，AD-01 变更 |
| OQ-003 | `/login` 页面去留与重定向目标 | A：保留登录页（提示跳转 IDP）；B：删除，直接 302 → IDP | 目录预留 `[locale]/login/page.tsx`；middleware 302 locale 规则（AR1-009）随其落地；不阻塞 |
| OQ-005 | IdP-Initiated SSO / BCL | A：暂不启用；B：后续 BCL 会话同步 | 不阻塞；BCL 需新增回调端点（auth §5 边界外） |
| OQ-006 | groups scope 及权限用途 | A：仅收集不映射权限；B：映射 groups → 功能权限 | 不阻塞；userinfo 已含 groups claim，M5 可扩展 |
| OQ-007 | `post_logout_redirect_uri` 白名单取值 | A：仅首页 `/`；B：首页+解题页等 | config.ts 集中定义；不阻塞 |
| OQ-008 | 生产 `ID_TOKEN_VERIFY_MODE` 强制 strict？ | A：强制 strict（推荐）；B：允许 soft | 默认 strict；架构按 strict 设计 |
| OQ-009 | 登录成功默认落地页 | A：returnTo；B：固定首页 | 已按 A（FR-005），fallback 首页 |
| OQ-010 | 分布式限流跨实例 + **token FR-024 页面级限流归属（AR2-012）** | A：单实例内存限流（现状）；B：Redis 共享计数 | 现状 A；B 为多实例前置；**限流/认证顺序调整（AR1-001）与分布式化无关，纳入实施范围**；**页面级 SSO 路径（登录页/登出页）限流：不扩展 matcher（页面路由保持匿名，OQ-002），`/api/sso/*` 已由现有 matcher `/api/:path*` 限流覆盖（FR-024 由此满足，决策记录于 §8.2 安全 #8）** |
| token OQ-04 | 会话失效引导 | A：跳登录页（带 returnTo）；B：首页 | 默认 A；实现于 logout/refresh 失败路径 |
| token OQ-07 | 登出全流程 vs 仅本地登出 | A：全流程（revoke+end_session）；B：仅清本地 | 已按 A（AD-09） |
| token OQ-08 | SSO 与匿名模式切换策略 | A：一次性切换；B：AB 灰度 | 不阻塞；middleware `isAuthenticated` 直切 |
| token OQ-09 | BCL 后续需求 | A：暂不 | 不阻塞 |

### 9.3 已裁决的 OQ-05 候选方案对比（决策记录）

按 OQ-05 落地候选①：localStorage 锁（互斥持有者）+ BroadcastChannel 广播。候选②（接受 invalid_grant 短暂失效）会触发 IDP 重放检测撤销全会话，风险不可接受（FR-005 警告）；候选③（仅服务端串行化）无法解决多标签页同时持有旧 refresh，需配合 BroadcastChannel 分发。最终：①为主，②作为锁失效兜底（invalid_grant 即按 FR-009 处理）。**AR2-003 载体修正**：广播仅承载「刷新完成/会话失效」信号，**不传递 token**；他标签页经主动调 `/api/sso/refresh`（服务端 Set-Cookie 回写）或清除前端 sessionStorage 完成协同，JS 不写 httpOnly cookie。

---
## 10. FR 覆盖清单

### 10.1 模块 ↔ FR 摘要表

完整逐条落点矩阵见 `docs/architecture/arch-sso-fr-matrix.md`（R-13 拆分）；v1.2 修订所致的落点变更以正文 AR2-xxx 标注为准（returnTo cookie 落点 AR2-004、cookie 更新通道 AR2-002、跨标签页协同 AR2-003、页面级限流决策 AR2-012）。

| 模块 | 覆盖 FR |
|------|---------|
| M1 SSO 路由层 | auth FR-001~010、FR-019~023 |
| M2 SSO 服务层 | auth FR-009~014、FR-019~022 |
| M3 Token 生命周期 | token FR-001~010 |
| M4 跨标签页协同 | token FR-005（OQ-05 扩展） |
| M5 认证守卫 | auth FR-016；token FR-003、FR-017~020（N/A） |
| M6 middleware | auth FR-016、FR-024；token FR-003 |
| M7 UI 组件 | auth FR-001、FR-019（入口） |
| M8 配置与环境 | auth FR-027 |

---
## 11. 实施指导（分步）

| 步骤 | 内容 | 涉及模块 | 验证 |
|------|------|----------|------|
| 1 | `jose` 引入（**前置 `npm view jose versions` 验证 ^6.2.8 存在，不存在则回退 jose v5/WebCrypto，AR2-006**）+ `lib/env.ts` 扩展 SSO 环境变量校验（含 mock 分支，AR1-010） | M8 | `npm run type-check`；env 缺失/mock 可缺省单测 |
| 2 | `lib/sso/` 骨架：types/schemas/pkce/config（**pkce 同构纯函数：仅 Web API，'use client' 组件与服务层共用，AR2-011**） | M2/M8 | 单测（pkce 随机性、challenge 正确性、提交 schema） |
| 3 | Discovery/JWKS + oauth-client（交换/refresh/userinfo/revoke/end_session，超时+重试） | M2 | 单测全 mock IDP；单例导出检查（AR1-007） |
| 4 | id-token-verifier（8 步验证，strict/soft） | M2 | 单测：篡改 claim/签名失败用例 |
| 5 | `/api/sso/authorize`（form POST + 状态双写含 returnTo，AR1-003/AR2-004）+ `/api/sso/callback` | M1 | E2E @smoke（Playwright route 拦截 IDP；断言状态 cookie 含 sso_return_to 且 httpOnly、sessionStorage 双写） |
| 6 | `token-cookie.ts` + `token-refresher.ts`（单飞 inflight Map，**随响应 Set-Cookie 写入，AR2-002**） | M3 | 单测：并发单飞、失败分类 |
| 7 | M4 跨标签页协同 + `lib/sso/refresh-sync.ts`（AR1-008；**广播仅信号不传 token，他标签页主动调 /api/sso/refresh，AR2-003**） | M4 | E2E 双标签页并发刷新（@no-llm） |
| 8 | M5 `requireAuth` 接入 `/api/solve`；middleware 粗检扩展（**限流/认证顺序调整 AR1-001、302 locale 规则 AR1-009、/api/sso/* 豁免认证粗检 AR2-001**） | M5/M6 | E2E：未登录 302、过期 302、有效放行；**未登录访问 /api/sso/authorize → 302 到 IDP 而非 /login（豁免断言，AR2-001）**；限流覆盖未认证请求断言；[locale] 落地后 302 前缀对齐验证；**首日实测（AR1-011）：真实 IDP access_token 走通 RS256 验签（kid 命中 JWKS），失败即触发 R-11 调整路径** |
| 9 | `/api/sso/logout`（**仅 POST，GET 405，AR2-007**；revoke→清 cookie→**end_session form 自动提交页**，AR1-002）+ M7 UI（login-button 状态生成 + form POST，AR1-003；logout-button form POST） | M1/M7 | E2E 登出流（@smoke）：断言浏览器 POST x-www-form-urlencoded 提交 end_session，无 302 提交；GET logout 断言 405 |
| 10 | 全量回归：`npm run test:quick` → `npm run test:full`；安全自查（client_secret grep、cookie 标志） | 全部 | CI + 发布前验证 |

---
## 12. 待确认事项汇总（阻塞/非阻塞）

- **非阻塞**：OQ-003（/login 页去留，关联 AR1-009 locale 规则生效时机）、OQ-006、OQ-007、OQ-008、OQ-009、OQ-010（页面级限流归属已裁决，AR2-012）、token OQ-04/07/08/09；
- **阻塞项**：无（OQ-004/002/05 已确认，其余不影响模块骨架落地）；
- **技术确认**：`jose@^6.2.8` 依赖需获准且**实施前 `npm view jose versions` 验证版本存在**（AR2-006；R-04 备选 WebCrypto）；`SSO_REFRESH_TOKEN_MAX_AGE_DAYS` 命名（token OQ-01：**取值 30 已随 OQ-004 确认，仅剩命名审批**，AR2-008）；**AR1-011 首日实测确认**（步骤 8 执行）。
