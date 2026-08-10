# SSO Token 生命周期与安全强化 需求规格文档

**版本**：v1.2
**状态**：approved
**创建时间**：2026-08-10
**最后更新**：2026-08-10

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-08-10 | 初稿创建 | — |
| v1.1 | 2026-08-10 | 根据 r1 评审修订：统一内省触发语义与判定分工（R1-001）、补齐刷新后新 access_token 更新（R1-002）、澄清与登录流程 spec 的边界及衔接点（R1-003）、补强跨标签页并发刷新风险（R1-004）；并处理建议级问题 R1-005~R1-015。重要级问题全部解决，建议级全部采纳 | review-r1 |
| v1.2 | 2026-08-10 | 根据 r2 评审修订：消除错误码归属循环引用（R2-001，`AUTH_LOGIN_INVALID_CREDENTIALS` 不适用于 SSO 流程、不收录）、登出白名单校验划界归 auth spec（R2-002，本 spec 不重复规格化）、补 FR-003 运行时分层衔接并统一 Node 层校验对象为 access_token（R2-003）；处理建议级 R2-004~R2-010（FR-017「或」二义性、FR-015/FR-004 衔接声明、AC-003 依赖 OQ-04、AC-017 断言强化、FR-023 重试上限、FR-002 引用精确化、跨 spec 引用版本更新）。重要级问题全部解决，建议级全部采纳 | review-r2 |

## 1. 背景与目标

### 1.1 现状基线（源码）

- `middleware.ts` 中 `isAuthenticated()` 当前为匿名模式（恒返回 `true`），注释明确标注「待 SSO/LDAP 方案确认后实施」；受保护路由仅 `/api/solve`。
- `app/lib/env.ts` 仅校验 AI 相关环境变量，尚无 `SSO_*` 环境变量。
- `app/api/solve/route.ts` 采用 `GESP6_*` 错误码体系（如 `GESP6_INPUT_INVALID`），为本 spec 错误码设计提供风格基线。
- package.json 无任何 SSO 客户端库依赖，无 token 存储 / 轮换 / 撤销 / 内省实现。

### 1.2 业务集成目标

`/var/learning/docs/sso-business-goals.md` 不存在，**业务集成目标缺失**。本 spec 以《SSO IDP SP 集成指南》（`docs/integration-guides/sso-idp-sp-integration-guide.md`，下称「集成指南」）第三方契约为唯一技术依据，叠加 token 生命周期视角的安全强化要求。所有业务决策缺口列入 §5.3 开放问题，不自行决断。登录初始流程（authorize / PKCE / 初始 token 交换 / 初始 Cookie 写入）属登录流程 spec（`docs/specs/spec-sso-auth-v1.1.md`，draft）范围，本 spec 仅覆盖登录后 token 的生命周期管理，二者边界与衔接点见 §3.1 与 §5.1 B-001。

### 1.3 目标

为 SP 端建立完整的 token 生命周期管理需求基线：**令牌存储与会话控制、Refresh Token 轮换、Token 撤销与登出、会话有效性内省校验、安全强化（密钥保护 / 日志脱敏 / 速率限制）**，使后续架构设计与开发阶段有可测试、可追溯的验收依据。

## 2. 用户故事

- 作为**登录用户**，我希望 access_token 到期前系统自动静默续期，以便连续使用解题功能时不被打断。
- 作为**登录用户**，我希望登出后 access_token 与 refresh_token 均立即失效，以便账号不被冒用。
- 作为**登录用户**，我希望会话失效后访问受保护功能时被引导重新登录，而不是得到无意义的错误。
- 作为**安全管理员**，我希望 client_secret 仅存在于服务端且日志不含任何 token 明文，以便降低凭证泄露风险。
- 作为**开发者**，我希望 SSO 相关错误可被稳定归类（统一错误码），以便快速定位问题。

## 3. 功能需求

> 追溯约定：每个 FR 标注依据——`[集成指南 §x.x]` 指向第三方契约章节；`[安全基线]` 表示任务硬性约束与集成指南 §5 安全要求整体；未标注业务目标（缺失）。

### 3.1 令牌存储与会话生命周期

- **FR-001**：access_token 须存储于 httpOnly Cookie，`secure`（生产环境）、`sameSite=lax`、`path=/`；Cookie `maxAge` 与当前 access_token 的 `expires_in` 一致（默认 900 秒 / 15 分钟）。初始 Cookie 写入（登录成功时设置）由登录流程 spec（spec-sso-auth FR-015）负责，本 spec 覆盖登录后生命周期操作（刷新 / 撤销 / 登出）对 access_token Cookie 的维护约束，衔接点见 §5.1 B-001。[集成指南 §3.3.1、§5.4]
- **FR-002**：refresh_token 须存储于独立 httpOnly Cookie，`secure`（生产环境）、`sameSite=lax`、`path=/`；持久化周期须为可配置项，默认 30 天（集成指南 §3.3.1 TypeScript 示例代码中 refresh_token Cookie `maxAge: 30 * 24 * 60 * 60` 秒，正文未规格化，配置项与验证方式见开放问题 OQ-01）。初始 Cookie 写入由登录流程 spec（spec-sso-auth FR-015）负责，本 spec 覆盖刷新 / 撤销 / 登出对 refresh_token Cookie 的维护。[集成指南 §5.4 精神、§3.3.1 示例代码]
- **FR-003**：会话超时以 access_token 有效期为最小粒度（15 分钟，§5.4 `maxAge: 900`）；access_token 过期且未完成刷新前，SP 不得放行受保护操作。「不得放行」的落地判定分运行时两层：**middleware（Edge）层**仅做 cookie 级 `exp` 检查（不验签、不内省、不引用 SSO 密钥环境变量，见 spec-sso-auth FR-016，本 spec 不重复定义其细节）；**Node 运行时层**对受保护操作执行 access_token 深度有效性确认——本地 JWT 解析校验（验签、iss/aud/exp 校验）或按内省分工调用 introspect，fail-closed，二者分工与适用范围见 FR-017 与开放问题 OQ-02。放行校验对象统一为 access_token；id_token 验签属登录身份验证域（spec-sso-auth FR-011），不用于放行判定。[集成指南 §5.4、§4.2 触发条件；spec-sso-auth FR-016]
- **FR-004**：刷新触发时机为：access_token 即将过期（默认提前 60 秒）或访问受保护资源收到 401 时；401 语义由 SP 内部定义（spec-sso-auth FR-018），本 FR 仅约束触发时机，刷新实现细节归 FR-006~FR-010。[集成指南 §4.2 触发条件；spec-sso-auth FR-018]
- **FR-005**：同一会话同一时刻至多允许一个刷新请求在途，不得并发触发多个 refresh 请求（防 race condition）。单飞保证仅在同一 JS 执行上下文（单标签页）内成立；跨标签页 / 多实例并发刷新会以同一旧 refresh_token 并发请求 IDP，触发其重放检测并撤销用户全部会话（集成指南 §3.3.2 规则 4），协同要求与风险决策见开放问题 OQ-05。[集成指南 §4.2 AI 验证清单、§3.3.2 规则 4]

### 3.2 Refresh Token 轮换

- **FR-006**：刷新成功后必须立即用响应中的新 refresh_token 替换 Cookie 中的旧值，不得延迟替换；同时必须用响应中的新 access_token 覆盖 Cookie（`maxAge` 按新 `expires_in` 重置），后续请求统一使用新 access_token，不得继续使用旧值。[集成指南 §3.3.2 规则 3、§4.2 步骤 3/5、§5.6]
- **FR-007**：刷新成功后旧 refresh_token 立即失效，SP 不得再次使用旧值发起任何请求。[集成指南 §3.3.2 规则 1、§5.6]
- **FR-008**：刷新响应不返回 id_token；SP 不得从刷新响应中期望或更新 id_token。[集成指南 §3.3.2 响应说明]
- **FR-009**：刷新收到 `invalid_grant`（refresh_token 无效 / 已撤销 / 被重放）时，SP 必须清除本地全部 token Cookie 并引导用户重新登录；同时须记录安全告警日志（含错误码 `AUTH_TOKEN_INVALID_GRANT`，不含 token 明文），以支持 token 窃取检测与审计。[集成指南 §4.2 失败处理、§3.3.2 规则 4；安全基线]
- **FR-010**：刷新失败须分类处置：`invalid_client` 不重试并记录配置错误；429 优先按 `Retry-After` 精确等待后重试（无 `Retry-After` 头时指数退避）；网络错误 / 5xx 指数退避重试（最多 3 次）。[集成指南 §4.2 失败处理表、§6.5 错误恢复策略]

### 3.3 Token 撤销与登出

- **FR-011**：SP-Initiated Logout 时，SP 后端必须调用 revoke 端点同时撤销 access_token 与 refresh_token。[集成指南 §4.3.1 步骤 2、§3.7 AI 验证清单]
- **FR-012**：revoke 请求必须携带 `token`、`token_type_hint` 及 client 认证凭据，且必须经 SP 后端转发，前端不得直接调用。注：集成指南 §5.7 明文仅禁止前端直连 token 端点，「revoke 前端不得直连」为 §5.7 精神的 SP 侧延伸（§3.7 AI 清单亦要求 client_secret 不暴露前端）。[集成指南 §3.7 请求参数、§5.7]
- **FR-013**：revoke 失败（IDP 不可达 / 网络错误）不阻断登出流程，本地 token Cookie 仍须清除。[集成指南 §3.7 AI 验证清单、§4.3.1 步骤 3]
- **FR-014**：revoke 响应 200 不保证 token 曾处于活跃状态（RFC 7009 设计），SP 不得将 revoke 200 用作 token 有效性判定依据。[集成指南 §3.7]
- **FR-015**：登出时清除本地全部 token Cookie 后，跳转 IDP end session 端点，携带 `id_token_hint`、`post_logout_redirect_uri`、`state`。登出流程编排（revoke→清 cookie→跳转的顺序）与 End Session 响应处理（307 跟随 / 200 处理）归 spec-sso-auth FR-019~FR-021，本 FR 仅约束跳转请求构造。全流程跳转为默认要求，是否可简化为仅本地登出见开放问题 OQ-07（业务确认）。[集成指南 §4.3.1 步骤 4-5；spec-sso-auth FR-019~FR-021]
- **FR-016**：登出跳转的 `post_logout_redirect_uri` 白名单校验（含客户端注册 `postLogoutRedirectUris` 白名单与白名单为空时回退 `redirectUris` 的规则）与开放重定向防御（拒绝跨域、协议相对、`javascript:` / `data:` 协议）归 spec-sso-auth FR-022 / FR-023（登出编排域），本 FR 不重复规格化；本 FR 仅约束登出跳转请求构造须携带经校验合法的 `post_logout_redirect_uri`。[集成指南 §4.3.1 AI 验证清单；spec-sso-auth FR-022/FR-023]

### 3.4 会话有效性内省校验（§3.6 自定义扩展）

> **扩展说明**：集成指南 §0.2 能力映射表未将 Introspect（§3.6）列入任何任务路径，IDP 端点本身可用（`POST /api/sso/introspect`，`client_secret_post` 认证，§1.6）。本 spec 将其用于「会话有效性内省校验」（如 middleware / 受保护资源访问前确认 access_token 是否仍有效），属按 token 生命周期需求的自定义扩展，仅引用其协议契约。

- **FR-017**：SP 服务端在放行受保护操作前**必须**确认 access_token 有效（义务性要求），确认方式由**本地 JWT 解析校验与 IDP 内省组成**：本地校验用于判定结构性失效（签名 / iss / aud / exp，无需网络往返）；内省用于确认 IDP 侧状态（撤销、重放检测等本地无法感知的失效）。二者的执行顺序、组合方式、适用范围与内省结果缓存策略由架构阶段确定（见开放问题 OQ-02）。[集成指南 §3.6；本 spec §3.4 扩展说明（依据集成指南 §0.2 能力映射表核对）]
- **FR-018**：调用 introspect 必须携带 `token_type_hint=access_token`；因集成指南 R1-010 记载 IDP 缺陷——缺失 hint 时 refresh_token 会返回 `active:false` 误判，SP 侧固定校验 access_token，hint 不得省略。[集成指南 §3.6 运维提示 R1-010]
- **FR-019**：introspect 返回 `active:true` 时放行；`active:false` 时按未登录处理（清除会话、引导重新登录）。[集成指南 §3.6 响应语义]
- **FR-020**：introspect 失败（IDP 不可达 / 超时 / 5xx）时按 fail-closed 处理——默认拒绝访问，不得因内省失败而放行可能已失效的会话；fail-open 例外场景须业务确认（见开放问题 OQ-03）。[集成指南 §3.6；安全基线]

### 3.5 安全强化

- **FR-021**：client_secret 仅存于服务端环境变量，禁止 `NEXT_PUBLIC_` 前缀暴露；前端代码不得直接调用 IDP 的 token（含刷新交换）/ revoke / introspect 端点，刷新、撤销、内省一律经 SP 后端转发；初始 token 交换属登录流程 spec 范围，其后端转发约束见 spec-sso-auth FR-009。注：「前端不得直连 revoke / introspect」为 §5.7 精神的 SP 侧延伸。[集成指南 §5.7；安全基线]
- **FR-022**：日志与对外错误信息不得输出 access_token、refresh_token、id_token、授权码 code、state、session id 等敏感值，须脱敏后方可记录。[安全基线；集成指南 §5 整体（§5.7 精神延伸，SP 侧补充）]
- **FR-023**：SP 对 IDP 端点的调用须消费 IDP 速率限制语义：收到 429 时优先按 `Retry-After` 头精确等待后重试；响应无 `Retry-After` 头时采用指数退避；两种情况下重试次数均有上限（沿用 FR-010 / 集成指南 §6.5 的 3 次），避免放大限流。[集成指南 §5.8、§6.4、§6.5]
- **FR-024**：SSO 相关用户侧接口（含登录回调、登出、受保护资源）须纳入速率限制保护，触发时返回 429 与标准错误体。现状说明：现有 middleware 限流（单 IP 每分钟 20 次、`GESP6_RATE_LIMITED`）的 matcher 仅覆盖 `/api/*` 路由（middleware.ts），页面级 SSO 路径（登录页 / 登出页等）的限流归属（扩展 matcher vs 路由内实现）由架构阶段决策，并与开放问题 OQ-10 关联。[集成指南 §5.8；源码现状 middleware.ts]

### 3.6 错误码规格

- **FR-025**：SP 侧 SSO 相关错误必须使用 `AUTH_*` 统一错误码，格式 `MODULE_CATEGORY_SPECIFIC`（全大写、下划线分隔），与现有 `GESP6_*` 风格一致。token 生命周期域错误码清单：`AUTH_TOKEN_EXPIRED`、`AUTH_TOKEN_REFRESH_FAILED`、`AUTH_TOKEN_INVALID_GRANT`、`AUTH_TOKEN_REVOKE_FAILED`、`AUTH_TOKEN_INTROSPECT_FAILED`、`AUTH_SESSION_INVALID`、`AUTH_IDP_RATE_LIMITED`。`AUTH_LOGIN_INVALID_CREDENTIALS` **不适用于 SSO 流程**（SP 侧无本地凭据校验步骤，凭证校验在 IDP 侧执行），本 spec 不收录；登录流程错误码（含 `AUTH_LOGIN_IDP_UNREACHABLE`）以 spec-sso-auth（v1.1）§3.7 为事实来源，本清单不重复规格化。[全局命名规范 §四；安全基线]
- **FR-026**：面向用户展示的 SSO 错误文案不得泄露内部细节（如 client_secret 配置错误、IDP 内部错误码），仅返回统一错误码与安全通用描述，供前端定位与日志关联。错误响应载体沿用现有 `{ success, error: { code, message } }` envelope（与 `GESP6_*` 一致，参考 app/api/solve/route.ts），字段细化由架构阶段确定。[集成指南 §6.3 HTTP 状态码使用规范精神；源码现状 app/api/solve/route.ts；安全基线]

## 4. 非功能需求

- **NFR-001（安全）**：本 spec 安全基线引用集成指南 §5 全部要求；其中 PKCE 强制、state CSRF 防御、id_token 验证 8 步等属登录流程 spec（spec-sso-auth）范围，本 spec 仅承接 token 生命周期相关安全项——Cookie 安全标志、Refresh Token 轮换、client_secret 保护、速率限制（本 spec §3 已细化）；开放重定向防御（登出白名单校验）归 spec-sso-auth FR-022/FR-023（登出编排域），本 spec 不重复规格化。[集成指南 §5.1–§5.8；spec-sso-auth 范围划分]
- **NFR-002（安全）**：内省校验失败默认 fail-closed（拒绝访问），安全优先级高于可用性。[FR-020]
- **NFR-003（性能）**：内省校验不得显著增加受保护接口延迟；内省结果缓存策略（如缓存时长上限 ≤ 剩余有效期）与超时阈值由架构阶段确定；按 FR-017 的本地 / 内省判定分工，须避免对每个请求串行同步调用 IDP。[FR-017 性能约束]
- **NFR-004（可用性）**：IDP 不可达时受保护功能不可用（fail-closed 的副作用），须在日志中标记且可被监控发现；是否允许降级放行由业务确认（OQ-03）。[FR-020]
- **NFR-005（可测试性）**：所有 SP→IDP 调用（token 交换 / 刷新 / 撤销 / 内省）须可被 mock，单元与集成测试不依赖真实 IDP（沿用现有 Vitest 全 mock 模式）；E2E 分级沿用 `@smoke` / `@no-llm` / `@llm`。[项目测试规范]
- **NFR-006（可观测性）**：SSO 事件（登录、刷新、撤销、内省、会话失效）须有结构化日志与错误码关联，但日志字段不得含敏感值（FR-022）。[安全基线]
- **NFR-007（兼容性）**：Cookie 安全属性（`secure` / `sameSite`）须与部署环境（HTTP/HTTPS、生产/开发）一致，不得在非 HTTPS 生产环境使用不安全的 Cookie 配置。[集成指南 §5.4]

## 5. 边界与排除项

### 5.1 明确不做什么

- **B-001**：不实现 SSO 登录初始流程（authorize / PKCE / state / callback / token 交换初始获取、id_token 验证 8 步）——本 spec 聚焦 token 获取之后的**生命周期管理**（存储维护 / 刷新 / 撤销 / 登出 / 内省）与安全强化，登录流程（含初始 token 交换与初始 Cookie 写入）属登录流程 spec（spec-sso-auth v1.1，draft）范围。二者衔接点：初始 access_token / refresh_token 写入会话 Cookie 由 spec-sso-auth 负责（其 FR-015），本 spec 承接其后的生命周期维护。[集成指南 §4.1；spec-sso-auth §3.4]
- **B-002**：不实现 Back-Channel Logout 端点（IdP-Initiated Logout，§4.3.2 / §4.7）——属会话联动需求，超出 token 生命周期范围；IDP 能力声明 `backchannel_logout_supported=true`，是否纳入后续需求见 OQ-09。[集成指南 §1.6]
- **B-003**：不实现 DPoP（§4.5）、PAR（§4.6 / §3.9）、DCR（§3.10）等高级特性；不实现 `client_credentials` / SCIM 场景（§3.3.3）。
- **B-004**：不修改 IDP 侧任何行为（IDP 为第三方契约，SP 仅按契约消费端点）。
- **B-005**：不做技术选型（token 解析/校验库、刷新调度实现、内省缓存实现）、模块划分、数据模型设计——均属架构设计阶段决策，spec 仅描述行为与约束。
- **B-006**：不定义 LDAP 集成（middleware 注释中「SSO/LDAP」为并列可选项，本 spec 仅覆盖 SSO 路径）。[源码现状 middleware.ts]
- **B-008**：不重复规格化登出重定向白名单校验——`post_logout_redirect_uri` 白名单校验（含客户端注册 `postLogoutRedirectUris` 与白名单为空时回退 `redirectUris` 的规则）与开放重定向防御归 spec-sso-auth FR-022 / FR-023（登录/登出流程域），本 spec 以 auth spec 为单一描述来源（对应 FR-016）。[spec-sso-auth FR-022/FR-023]

### 5.2 需求基线缺口（文档缺失声明）

- **B-007**：`docs/sso-business-goals.md` 缺失，本 spec 无业务目标可追溯，所有业务决策均以开放问题（§5.3）形式挂起，待业务目标文档补齐或评审确认后修订。

### 5.3 开放问题（业务决策缺口）

| 编号 | 问题 | 状态 |
|------|------|------|
| OQ-01 | refresh_token 持久化周期：集成指南正文未规格化（示例代码为 30 天），需业务确认默认值与上限；建议配置项名 `SSO_REFRESH_TOKEN_MAX_AGE_DAYS`（最终命名由架构阶段确定） | 待确认 |
| OQ-02 | 内省校验适用范围与判定机制分工：内省仅用于受保护 API（`/api/solve`）还是全站页面 / 路由？本地 JWT 解析校验（验签 / iss / aud / exp）与 IDP 内省的执行顺序、组合方式、判定优先级及内省结果缓存策略如何确定？若业务决策为仅本地校验（不做内省），则 IDP 侧撤销 / 重放检测导致的失效将无法被 SP 感知，需业务确认接受该风险；middleware 现状仅保护 `/api/solve` | 待确认 |
| OQ-03 | 内省失败兜底：默认 fail-closed（FR-020），是否存在需 fail-open 的例外场景（如只读页面） | 待确认 |
| OQ-04 | 会话失效后的引导：统一跳转 `/login` 还是携带 `return_to` 回跳原页面？现有 middleware 重定向 `/login` | 待确认 |
| OQ-05 | 多设备 / 多标签页会话策略：httpOnly Cookie 跨标签页共享但各标签页 JS 上下文独立，多标签页同时触发刷新会以同一旧 refresh_token 并发请求 IDP；按集成指南 §3.3.2 规则 4，IDP 重放检测将**自动撤销该用户所有会话和 token**（风险等级：高）。候选缓解方向（供业务决策）：① 刷新单飞扩展为跨标签页协同（localStorage 锁 / BroadcastChannel / 服务端串行化）；② 接受 `invalid_grant` 后仅清除当前会话并引导重新登录的短暂失效；③ 是否接受会话短暂失效的体验 | 待确认 |
| OQ-06 | middleware 运行于 Edge Runtime（禁 Node 原生模块）与 §5.7「client_secret 仅服务端」约束的落地方式：Edge 中携带 client_secret 调用 introspect 的合规性与替代路径须架构阶段评估 | 待确认 |
| OQ-07 | 登出是否必须走 IDP end session 全流程（FR-015 已定默认全流程，含跳转）还是可仅本地登出？本项为对 FR-015 强度的业务确认项；§4.3.1 为完整流程，业务是否接受 | 待确认（对 FR-015 强度的确认项） |
| OQ-08 | SSO 会话与现有匿名模式的切换策略：`isAuthenticated` 现恒为 `true`，切换为 SSO 校验后存量用户/未登录用户的访问策略 | 待确认 |
| OQ-09 | Back-Channel Logout（§4.3.2 / §4.7）是否纳入后续需求（IDP 能力已支持） | 待确认 |
| OQ-10 | 分布式部署下内存限流不共享（middleware 注释已标注 P2）：SSO 端点限流是否需要跨实例方案 | 待确认 |

## 6. 验收标准

### 6.1 令牌存储与会话生命周期

- [ ] **AC-001**：access_token Cookie 在生命周期内始终满足 `httpOnly + secure（生产）+ sameSite=lax + path=/`，`maxAge` 与当前 `expires_in`（900 秒）一致，前端 JS 无法读取（对应 FR-001 / 集成指南 V-015；初始写入验收以登录流程 spec 输出为前提）
- [ ] **AC-002**：refresh_token 存储于独立 httpOnly Cookie，`maxAge` 大于 access_token（默认 30 天）；配置项注入后按配置值生效（单测断言默认值 + 配置注入后断言）（对应 FR-002）
- [ ] **AC-003**：access_token 过期（> 15 分钟）且未刷新时，受保护操作被拒绝且会话失效（断言收敛为「拒绝访问 + 会话失效」两项）；「引导重新登录」的重定向目标行为按 OQ-04 决策验收，OQ-04 未决前不作重定向目标断言（对应 FR-003）
- [ ] **AC-004**：access_token 到期前 60 秒内发起刷新（单测以可控时钟验证触发时机）（对应 FR-004）
- [ ] **AC-005**：同一标签页内并发触发刷新时仅一个请求发出，其余等待复用结果（对应 FR-005；本 AC 不覆盖跨标签页并发场景，该场景策略与验收见 OQ-05）

### 6.2 Refresh Token 轮换

- [ ] **AC-006**：刷新成功后 Cookie 中 refresh_token 立即替换为新值，access_token 同步更新为新值且 `maxAge` 按新 `expires_in` 重置，后续请求使用新 access_token（对应 FR-006 / 集成指南 V-016/V-018）
- [ ] **AC-007**：刷新后旧 refresh_token 不再被 SP 使用；对 IDP 重放旧值得到 `invalid_grant`（对应 FR-007 / 集成指南 V-017）
- [ ] **AC-008**：刷新响应不含 id_token 时 SP 不报错、不更新 id_token 存储（对应 FR-008）
- [ ] **AC-009**：刷新返回 `invalid_grant` 时全部 token Cookie 被清除并跳转登录页，且记录含 `AUTH_TOKEN_INVALID_GRANT` 的安全告警日志（不含 token 明文）（对应 FR-009）
- [ ] **AC-010**：`invalid_client` 不重试并记录配置错误；429 优先按 `Retry-After` 精确等待后重试（无 `Retry-After` 时指数退避）；5xx/网络错误指数退避且最多 3 次（对应 FR-010 / 集成指南 §6.5）

### 6.3 Token 撤销与登出

- [ ] **AC-011**：登出时 SP 后端对 access_token 与 refresh_token 均发起 revoke（对应 FR-011）
- [ ] **AC-012**：revoke 请求含 `token`、`token_type_hint` 与 client 认证凭据，且仅经 SP 后端发出，前端无直连路径（对应 FR-012）
- [ ] **AC-013**：模拟 revoke 失败（IDP 不可达）时登出仍完成、本地 token Cookie 已清除（对应 FR-013）
- [ ] **AC-014**：revoke 返回 200 不被用作 token 有效性判定（单测断言处理逻辑不依赖 revoke 200 语义）（对应 FR-014 / 集成指南 V-019）
- [ ] **AC-015**：登出后跳转 IDP end session，请求含 `id_token_hint`、`post_logout_redirect_uri`、`state`；编排顺序与 End Session 响应处理按 spec-sso-auth FR-019~FR-021（对应 FR-015 / 集成指南 V-021）
- [ ] **AC-016**：白名单外的 `post_logout_redirect_uri`（跨域、`//evil.com`、`javascript:` 等）被拒绝——白名单取值与回退规则按 spec-sso-auth FR-022 实施，本 AC 断言登出跳转请求构造路径不出现白名单外地址（对应 FR-016 / 集成指南 §5.5 + §4.3.1 AI 验证清单；V-025/026/027 为 §5.5 规则在 IdP-Initiated 场景的验证条目，非登出专属）

### 6.4 会话有效性内省校验

- [ ] **AC-017**：受保护资源访问前经 SP 服务端确认 access_token 有效——单测 mock 断言受保护 API 处理链中有效性确认服务被调用（本地 JWT 校验分支与内省分支分别断言，按 OQ-02 分工执行）；代码审查确认放行路径不依赖浏览器端判定（对应 FR-017）
- [ ] **AC-018**：introspect 请求必须携带 `token_type_hint=access_token`（代码审查 + 请求捕获断言）（对应 FR-018 / 集成指南 R1-010）
- [ ] **AC-019**：`active:true` 放行；`active:false` 按未登录处理（清除会话 + 引导登录）（对应 FR-019）
- [ ] **AC-020**：模拟 introspect 超时 / 5xx / 不可达时访问被拒绝（fail-closed），日志含 `AUTH_TOKEN_INTROSPECT_FAILED`（对应 FR-020）

### 6.5 安全强化与错误码

- [ ] **AC-021**：构建产物（浏览器 bundle）中不存在 client_secret；前端无法直接调用 IDP token / revoke / introspect 端点（对应 FR-021 / 集成指南 §5.7）
- [ ] **AC-022**：全量日志扫描断言无 access_token / refresh_token / id_token / code / state / session id 明文输出（对应 FR-022）
- [ ] **AC-023**：模拟 IDP 返回 429（含 `Retry-After`）时 SP 优先按 `Retry-After` 精确等待重试；无 `Retry-After` 时按指数退避；两种情况重试上限均为 3 次（对应 FR-023 / FR-010 / 集成指南 §6.4、§6.5）
- [ ] **AC-024**：SSO 相关用户接口触发限流时返回 429 与标准错误体（对应 FR-024）
- [ ] **AC-025**：token 生命周期域 SSO 错误全部使用 `AUTH_*` 错误码，格式符合 `MODULE_CATEGORY_SPECIFIC`，清单与 FR-025 一致且不含 `AUTH_LOGIN_INVALID_CREDENTIALS`（该码不适用于 SSO 流程）（lint/单测断言）（对应 FR-025）
- [ ] **AC-026**：用户可见错误文案不含内部细节（错误码可返回，描述为安全通用文案）；错误响应结构沿用 `{ success, error: { code, message } }` envelope（对应 FR-026）


