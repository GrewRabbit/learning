# SSO 登录认证、会话与登出 需求规格文档

**版本**：v1.2
**状态**：approved
**创建时间**：2026-08-10
**最后更新**：2026-08-10

> **需求基线声明**：本 spec 的 FR 全部以 `/var/learning/docs/integration-guides/sso-idp-sp-integration-guide.md`（v1.0，唯一技术契约来源）为技术依据。业务集成目标文档 `/var/learning/docs/sso-business-goals.md` 不存在，业务决策缺口列入 §7 开放问题，不自行决断。
>
> **相关文档**：项目存在 `docs/specs/spec-sso-token-v1.1.md`（draft），覆盖 token 生命周期管理（存储/续期/撤销/内省）；其 B-001 明确"登录初始流程属另一份需求文档范围"（即本 spec），并引用本 spec FR-009 / FR-015 / §3.4 / §3.7 为衔接点。两份 spec 的职责划界（独立演进，R1-001 裁决）见 §5 第 12 条与 §7 OQ-010。

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-08-10 | 初稿创建（SSO 登录认证、会话与登出） | — |
| v1.1 | 2026-08-10 | 根据 r1 评审修订：双 spec 职责划界与错误码分区（R1-001）、续期流程统一为与 token spec 协作（R1-002）、nonce 持久化（R1-003）、Edge Runtime 校验边界与密钥约束（R1-004）；采纳建议项 R1-005~R1-013；§6/§7 章节顺序微调 | review-r1 |
| v1.2 | 2026-08-10 | 根据 r2 评审修订：`AUTH_LOGIN_INVALID_CREDENTIALS` 归属裁决为"不适用于 SSO 流程、本 spec 不收录"（R2-001，结论需 token spec 下一轮修订其 FR-025）；过期/续期边界统一为"过期即重登"并补充 Node 层 60 秒主动续期触发载体（R2-002）；状态 cookie 写入方与 httpOnly 明确为服务端写入（R2-003）；Node 层深度校验对象修正为 access_token（R2-010）；采纳建议项 R2-004（登出 client_id 回退）、R2-005（returnTo 持久化）、R2-006（登出 state 生成与回传校验）、R2-007（end_session POST 提交）、R2-008（access_denied 依据修正）、R2-009（429 与指数退避两条路径拆分） | review-r2 |

---

## 1. 背景与目标

### 1.1 背景

- 当前系统认证为**匿名模式**：`middleware.ts` 中 `isAuthenticated` 恒返回 `true`（注释明确"待 SSO/LDAP 方案确认后实施"），受保护路由 `/api/solve` 实际无认证拦截。
- 现有 `/login` 页面与 middleware 未认证重定向逻辑存在，但无真实登录能力。
- IDP 已就绪并发布集成指南：支持 OIDC Authorization Code + PKCE（唯一流程）、RS256 签名、`client_secret_post` 认证、refresh_token 轮换、RP-Initiated Logout 等能力（§1.2、§1.6）。

### 1.2 目标

- 接入 IDP 实现 **SP-Initiated Authorization Code + PKCE** 登录（§4.1），作为系统唯一认证方式。
- 建立**服务端会话**：令牌以 httpOnly cookie 保存（§5.4）；会话建立与登录态判定由本 spec 定义，会话续期（refresh_token 轮换）归 `spec-sso-token` 的 token 生命周期范围（§5.6 触发条件），本 spec 仅保留流程衔接（FR-018）。
- 实现 **SP-Initiated Logout**：令牌撤销 + IDP 端登出 + 本地会话清除（§4.3.1）。
- 满足集成指南 §5 全部安全要求（PKCE/state/id_token/Cookie/client_secret/开放重定向/速率限制/日志脱敏）。
- 将现有 middleware 认证钩子从匿名模式切换为真实会话校验，使 `/api/solve` 真正受保护。

### 1.3 非目标

见 §5 边界与排除项（IdP-Initiated SSO、DPoP、PAR、Back-Channel Logout、DCR/SCIM 等均不在本次范围）。

---

## 2. 用户故事

- **US-001**：作为未登录用户，我点击"登录"后跳转公司 SSO 完成认证，以便无需单独注册即可使用系统。
- **US-002**：作为已登录用户，我希望在会话有效期内持续使用系统，并在 access_token 过期前由会话生命周期管理（`spec-sso-token` 续期机制）自动续期，以便减少频繁重新登录。
- **US-003**：作为已登录用户，我点击"登出"后 SP 与 IDP 会话同时失效，以便确保账号安全。
- **US-004**：作为管理员，我希望 client_secret 仅存于服务端且日志不泄露任何令牌，以便降低凭证泄露风险。
- **US-005**：作为解题用户，我未登录访问 `/api/solve` 时被自动引导登录，登录后回到原目标，以便完成解题任务。

---

## 3. 功能需求

### 3.1 登录发起

- **FR-001**：系统提供 SSO 登录入口，用户点击后触发 SP-Initiated Authorization Code + PKCE 流程（§4.1）。依据：§4.1、§2.1。
- **FR-002**：发起登录时生成 PKCE 参数：`code_verifier`（≥43 字符，加密随机源）、`code_challenge`（`BASE64URL(SHA256(code_verifier))`）；生成 `state`（≥32 字符，加密随机源）与 `nonce`（≥32 字符，加密随机源，§4.1 步骤 1 示例值 32 字符）（§4.1 步骤 1）。依据：§3.2、§4.1、§5.1、§5.2。
- **FR-003**：登录状态（`code_verifier`、`state`、`nonce`）在跳转 IDP 前持久化，采用 sessionStorage + cookie **双写容错**；**写入方分工与读取语义**（R2-003 裁决）：状态 cookie 由**服务端（登录发起 API）**设置，属性 `httpOnly=true` + `sameSite=lax`（`code_verifier` 为可兑换授权码的高敏凭据，禁止前端 JS 可读，前端无法设置 httpOnly cookie），sessionStorage 由前端写入；服务端读取 cookie、前端读取 sessionStorage；`nonce` 须与 `code_verifier`、`state` 一并持久化，否则回调时无法恢复比对（FR-011 ⑧）。依据：§4.1、§5.1。
- **FR-004**：构造 authorize 请求并跳转 IDP，必带参数：`client_id`、`redirect_uri`（与客户端注册值**完全匹配**，区分大小写与末尾斜杠）、`response_type=code`、`scope`（**必须包含 `openid`**，具体 scope 按配置）、`state`、`code_challenge`、`code_challenge_method=S256`、`nonce`（§4.1 步骤 3）。依据：§3.2、§4.1、§2.3。
- **FR-005**：发起登录时支持携带 `returnTo` 目标路径，与 `code_verifier`/`state`/`nonce` 一并持久化（沿用 FR-003 双写机制，§4.1 步骤 2），登录成功后恢复并跳回；`returnTo` 恢复后仍须通过开放重定向校验（见 FR-023）（§4.1 步骤 17）。依据：§4.1、§5.5。

### 3.2 回调与令牌交换

- **FR-006**：回调处理：从授权响应提取 `code`、`state`、`iss` 三个参数，任一缺失 → 拒绝（错误码 `AUTH_LOGIN_MISSING_PARAMS`），不进入令牌交换（§4.1 步骤 4）。回调含 `error` 参数时按分类处理：`access_denied`（用户拒绝授权，RFC 6749 §4.1.2.1 标准错误——IDP consent 拒绝场景；集成指南 §3.2 / §6.1 错误表未收录，为 OAuth 标准行为补充）→ 展示友好提示并清除一次性登录状态，不进入令牌交换；其他 `error`（`invalid_request` / `invalid_scope` / `unsupported_response_type` 等）→ 归入 `AUTH_LOGIN_IDP_ERROR`（§3.2 错误响应）。回调参数为用户可控输入，须经 Zod schema 校验参数格式与长度（全局代码规范，与 FR-023 并列）。依据：§3.2、§4.1。
- **FR-007**：state 校验：回调 `state` 必须与本地保存值一致，不一致 → 400 拒绝（`AUTH_LOGIN_STATE_MISMATCH`）；`state` **一次性使用**，令牌交换成功后立即清除（§5.2）。依据：§5.2、§4.1。
- **FR-008**：iss 校验：回调 `iss` 必须与 Discovery 返回的 `issuer` 一致，不一致 → 拒绝登录（`AUTH_LOGIN_ISS_MISMATCH`），防 IDP 混淆攻击（RFC 9207）（§4.1 步骤 4）。依据：§3.2、§4.1、§1.6。
- **FR-009**：令牌交换**仅由服务端执行**：`authorization_code` grant，携带 `code`、`redirect_uri`、`client_id`、`client_secret`、`code_verifier`；前端浏览器**禁止**直接调用 IDP token 端点（§5.7）（§4.1 步骤 5）。令牌交换响应须校验 `token_type` 为 `Bearer`（大小写不敏感，OIDC 规范化为小写比较，§3.3），不符 → 按失败处理（`AUTH_TOKEN_EXCHANGE_FAILED`）。依据：§3.3.1、§4.1、§5.7。
- **FR-010**：令牌交换失败处理：IDP 返回 `invalid_grant`（授权码过期/已使用）等错误时，向用户展示明确错误并引导重新登录，同时清除一次性登录状态（§4.1 步骤 4 失败处理）。面向用户的错误提示仅返回错误码与安全通用文案，不得泄露 IDP 内部错误码 / `error_description` 细节与配置信息（与 FR-026 并列，覆盖用户可见文案）。依据：§3.3.4、§4.1。

### 3.3 身份验证与用户信息

- **FR-011**：id_token 按 8 步验证：① JWT 三段格式；② `alg` 白名单（仅 `RS256`，拒绝 `none`）；③ JWKS 按 `kid` 匹配公钥；④ 签名验证（RSA-SHA256）；⑤ `iss` 与 issuer 一致；⑥ `aud` 包含当前 `client_id`；⑦ `exp` 未过期（含时钟容差，建议 60 秒）；⑧ `nonce` 匹配（若 authorize 请求传入）。`ID_TOKEN_VERIFY_MODE=strict`（默认）验证失败**拒绝登录**；`soft` 模式仅记录日志（§4.1 步骤 6）。依据：§4.1、§5.3、§2.3。
- **FR-012**：JWKS 获取与缓存：从 Discovery 取 `jwks_uri`，缓存建议 1 小时；按 id_token header `kid` 匹配公钥；`kid` 未命中时刷新缓存并重试一次（防密钥轮换）（§3.5）。依据：§3.5、§3.1。
- **FR-013**：登录成功后调用 userinfo 获取用户信息（Bearer access_token）；校验 userinfo 返回的 `sub` 与 id_token `sub` 一致，不一致 → 登录失败；userinfo 返回 401 时触发续期逻辑（见 FR-018）（§4.1 步骤 7）。依据：§3.4、§4.1。
- **FR-014**：Discovery 使用：所有 IDP 端点 URL 一律取自 Discovery 响应，**禁止硬编码**；校验 `issuer` 与配置的 `SSO_ISSUER` 一致；Discovery 响应缓存建议 1 小时（§3.1）。**Discovery / JWKS / UserInfo 调用全部在服务端执行**——浏览器不直连 IDP 域名，与现有 CSP `connect-src 'self'` 约束一致（next.config.ts 现状），不调整 CSP。依据：§3.1、§2.3。

### 3.4 会话与 Cookie 管理

- **FR-015**：登录成功后设置会话 cookie：`sso_access_token`（maxAge 与 token `expires_in` 一致，即 15 分钟）、`sso_refresh_token`（30 天，启用 `offline_access` 时）、`sso_id_token`（30 天）；三个 cookie 均满足 `httpOnly=true`、`secure=true`（生产环境）、`sameSite=lax`、`path=/`（§4.1 步骤 8）。access_token / refresh_token 的 cookie 属性（含 `path=/`）与 token spec FR-001 / FR-002 保持一致（单一描述来源，token spec 承接登录后的生命周期维护）。依据：§4.1、§5.4。
- **FR-016**：登录态判定（分层校验）：**middleware（Edge Runtime）层**——仅做 cookie 级校验：`sso_access_token` cookie 存在且 `exp`（JWT 解码级，不验签）未过期即视为已认证，否则 302 重定向登录流程；middleware **禁止引用任何服务端 SSO 密钥环境变量**（`SSO_CLIENT_SECRET` 等会被内联进 Edge bundle 泄露，§5.7），不执行验签 / 内省 / 续期。**Node 运行时层**——受保护 API 的深度校验对象为 **access_token**（R2-010 裁决）：本地 JWT 验签（验签 + `iss`/`aud`/`exp` 结构性校验，fail-closed）在服务端组件 / 后端执行，或按 token spec FR-017 ~ FR-020 的内省分工执行（本 spec 不重复定义内省细节）；`id_token` 验签仅证明身份（有效期 30 天，FR-015），不作为受保护 API 的有效性校验手段。401 / 会话失效语义由 SP 内部定义（不依赖 IDP 返回 401）。现有认证钩子（`isAuthenticated` 匿名模式）切换为上述 middleware 校验（middleware.ts 现状）。依据：§2.3、§4.1。
- **FR-017**：会话失效语义与清理（R2-002 裁决：**过期即重登，不尝试续期**）：会话失效定义为 access_token 过期（不尝试续期）或 refresh_token 被撤销（续期返回 `invalid_grant`）。access_token 过期时由 middleware 302 重定向登录（FR-016，不进入续期）；refresh_token 被撤销时由 Node 运行时清除全部会话 cookie 并跳转登录（§3.4 userinfo 401 处理）。会话失效错误码统一使用 token spec 的 `AUTH_SESSION_INVALID`（与 token spec FR-003 / FR-009 语义一致，定义于 token spec FR-025），本 spec 不重复定义。依据：§3.4、§4.1。
- **FR-018**：续期触发衔接（与 token spec 协作）：**触发载体与时机**——① Node 运行时在受保护请求进入时检查 access_token 剩余有效期 <60 秒即触发续期（token spec FR-004 主动触发时机的落地点）；② 受保护请求 / userinfo 返回 401（IDP 侧撤销等本地无法感知的失效）时触发续期；middleware 302 重定向（`exp` 过期）**不**触发续期（过期即重登，FR-017）。续期的具体实现——轮换规则（新 refresh_token / access_token 立即替换旧值）、失败分类处置、并发防重——归 `spec-sso-token` FR-004 ~ FR-010，本 spec 不重复规格化，仅保留流程编排与触发层面的衔接；IDP 检测到已撤销 refresh_token 被重放并撤销全部会话时，SP 清除本地会话并引导重新登录（token spec FR-009，§3.3.2 轮换规则 4）。依据：§3.3.2、§5.6、§4.1。

### 3.5 登出

- **FR-019**：SP-Initiated Logout：登出流程按序执行——① 服务端调用 revoke 撤销 access_token 与 refresh_token（revoke 调用细节归 token spec FR-011 ~ FR-014）；② 清除本地全部会话 cookie；③ 向 IDP end_session 端点发起登出，携带 `id_token_hint`、`post_logout_redirect_uri`、`state`；`id_token_hint` 不可用（`sso_id_token` cookie 丢失）或验签失败时，携带 `client_id` 参数回退（§3.8 身份校验逻辑 2），确保 IDP 可确认 RP 身份。登出 `state` 由 SP 生成（加密随机源，长度 ≥32，与登录 state 对齐），用于 307 回传校验（FR-021）。end_session 参数以 **POST（application/x-www-form-urlencoded）**方式提交至请求体（§3.8 Content-Type 处理表）——id_token 含 sub/name 等 PII，禁止以 GET query 提交进入浏览器历史与服务器访问日志。登出参数（`post_logout_redirect_uri`、`state` 等）为用户可控输入，须经 Zod schema 校验参数格式与长度（全局代码规范，与 FR-006 并列）。依据：§4.3.1、§3.7、§3.8。
- **FR-020**：revoke 失败不阻断登出：无论 revoke 返回 200（RFC 7009 语义，token 可能本就无效）还是失败，本地 cookie 均必须清除（§3.7）；revoke 调用失败错误码 `AUTH_TOKEN_REVOKE_FAILED` 定义于 token spec FR-025，本 spec 不重复定义。依据：§3.7。
- **FR-021**：End Session 响应处理：IDP 返回 307 跳转回 `post_logout_redirect_uri`（携带 `state`）时，先校验回传 `state` 与本地保存的登出 state 一致（CSRF 防御，FR-019），一致则跟随跳转，不一致则仍视为登出完成、不跳转第三方；未提供 `post_logout_redirect_uri` 时处理 200 `{success: true}`（§3.8）。依据：§3.8。
- **FR-022**：登出重定向白名单校验：`post_logout_redirect_uri` 必须匹配客户端注册的 `postLogoutRedirectUris` 白名单（白名单为空时回退 `redirectUris`）；end_session 返回 400/401 的错误路径也必须清除本地 cookie（§3.8 安全说明）。依据：§3.8、§2.2。
- **FR-023**：开放重定向防御：`returnTo`、登出后跳转目标等一切重定向目标，在跳转前必须校验——规范化为同源相对路径；拒绝协议相对 URL（`//evil.com`）、跨域 URL、`javascript:` / `data:` 协议；跳转前再次确认路径以 `/` 开头且非 `//`（§5.5）。依据：§5.5。

### 3.6 安全与配置

- **FR-024**：client_secret 保护：`SSO_CLIENT_SECRET` 仅服务端使用，**禁止** `NEXT_PUBLIC_` 前缀；构建产物（浏览器 JS bundle）中不得出现 client_secret（§2.3 安全红线）；**middleware（Edge Runtime）禁止引用 `SSO_CLIENT_SECRET`**——Edge bundle 会内联引用的环境变量，任何引用均构成泄露面（FR-016）。依据：§2.2、§2.3、§5.7。
- **FR-025**：IDP 速率限制与重试处理（两条路径分开表述）：① **429**——按 `Retry-After` 头精确等待后重试（§6.5、§6.4 响应格式），重试上限 3 次（SP 侧合理强化，避免放大限流，与 token spec FR-023「重试次数均有上限」要求一致）；② **网络错误 / 5xx**——指数退避重试，最多 3 次（§6.5）。两条路径重试均耗尽后返回明确错误，错误码统一使用 token spec 的 `AUTH_IDP_RATE_LIMITED`（定义于 token spec FR-025）。依据：§5.8、§6.5、§3.3.4、§3.4。
- **FR-026**：日志与用户提示脱敏：所有日志禁止输出 access_token / refresh_token / id_token / 会话标识 / `state` / `code_verifier` / `client_secret`（§5 安全要求与全局代码规范）；面向用户的错误提示（FR-010）仅返回错误码与安全通用文案，不泄露 IDP 内部错误码与配置细节（与 token spec FR-026 等价要求一致）。依据：§5。
- **FR-027**：环境变量分组管理：浏览器可见（`NEXT_PUBLIC_SSO_ISSUER`、`NEXT_PUBLIC_SSO_CLIENT_ID`、`NEXT_PUBLIC_SSO_REDIRECT_URI`、`NEXT_PUBLIC_SSO_SCOPE`）与服务端（`SSO_CLIENT_SECRET`、`SSO_ISSUER`、`SSO_CLIENT_ID`、`ID_TOKEN_VERIFY_MODE` 默认 `strict`）分组；缺失必需环境变量时启动/调用报错清晰（§2.3）。依据：§2.3。

### 3.7 错误码定义

错误码遵循 `MODULE_CATEGORY_SPECIFIC` 格式（全局命名规范），模块前缀 `AUTH`：

| 错误码 | 触发场景 | 对应 FR |
|--------|---------|---------|
| `AUTH_LOGIN_MISSING_PARAMS` | 回调缺少 code/state/iss 任一参数 | FR-006 |
| `AUTH_LOGIN_STATE_MISMATCH` | 回调 state 与本地保存值不一致 | FR-007 |
| `AUTH_LOGIN_ISS_MISMATCH` | 回调 iss 与 Discovery issuer 不一致 | FR-008 |
| `AUTH_LOGIN_IDP_ERROR` | 回调 error 参数（非 access_denied）或 IDP 返回 OAuth 标准错误（invalid_grant 等） | FR-006、FR-010 |
| `AUTH_LOGIN_IDP_UNREACHABLE` | IDP 端点网络不可达 / 超时 | FR-009、FR-014 |
| `AUTH_TOKEN_EXCHANGE_FAILED` | 令牌交换失败（含 token_type 校验不符） | FR-009 |
| `AUTH_ID_TOKEN_INVALID` | id_token 8 步验证失败（strict 模式） | FR-011 |
| `AUTH_IDP_DISCOVERY_FAILED` | Discovery 拉取失败 / issuer 校验失败 | FR-014 |
| `AUTH_LOGOUT_REDIRECT_INVALID` | 登出 / returnTo 重定向目标非法 | FR-023 |

> **错误码归属边界（R1-001 裁决）**：本 spec 与 `spec-sso-token`（v1.1，draft）独立演进、职责划界（见 §5 第 12 条与 §7 OQ-010）。本表仅定义**登录 / 登出流程专属**错误码；**token 生命周期与通用 SSO 错误码**（`AUTH_TOKEN_EXPIRED`、`AUTH_TOKEN_REFRESH_FAILED`、`AUTH_TOKEN_INVALID_GRANT`、`AUTH_TOKEN_REVOKE_FAILED`、`AUTH_TOKEN_INTROSPECT_FAILED`、`AUTH_SESSION_INVALID`、`AUTH_IDP_RATE_LIMITED`）以 token spec FR-025 为**唯一事实来源**，本 spec 涉及上述语义（FR-017 / FR-018 / FR-020 / FR-025）时仅引用、不重复定义。**`AUTH_LOGIN_INVALID_CREDENTIALS` 不适用于 SSO 流程**（凭证校验在 IDP 侧登录页完成，SP 侧不存在产生 invalid_credentials 的触发场景），本 spec **不收录**；该裁决已同步 §7 OQ-010，需 token spec 在下一轮修订其 FR-025 的体系预留表述（其当前将 `AUTH_LOGIN_INVALID_CREDENTIALS` 列入预留清单，与本裁决冲突）。`AUTH_LOGIN_IDP_UNREACHABLE` 由 token spec 体系预留（其 FR-025 声明登录流程错误码清单以本 spec §3.7 为事实来源），定义以本表为准。

---

## 4. 非功能需求

- **NFR-001**（性能）：Discovery 与 JWKS 响应缓存 1 小时，避免重复请求；所有对 IDP 的调用必须设置超时，不无限等待；登录流程端到端不引入显著额外延迟。
- **NFR-002**（安全）：集成指南 §5 全部安全要求落地（PKCE 强制、state CSRF、id_token 验证、Cookie 标志、开放重定向防御、refresh 轮换、client_secret 保护、速率限制、日志脱敏），对应 FR-002/007/011/015/018/023/024/025/026。
- **NFR-003**（可测试性）：单元测试全 mock（不依赖真实 IDP 与模型）；E2E 按现有分级：`@smoke` 覆盖登录 → 受保护接口 → 登出关键路径，`@no-llm` 覆盖认证契约与错误场景；E2E 的 IDP 行为以**本地 mock IDP**（§2.1 `SSO_MOCK_ENABLED=1`）或 Playwright route 拦截模拟，确保 `@smoke` / `@no-llm` 离线稳定执行，不依赖真实 IDP。
- **NFR-004**（兼容性）：现有 `/api/solve` 接口契约与 `GESP6_*` 错误码不变（仅认证入口变更）；middleware 速率限制行为（单 IP 每分钟 20 次）与 `/api/health` 白名单不变。
- **NFR-005**（可维护性）：错误码统一 `AUTH_` 前缀；每个 FR 可追溯到集成指南章节（§3、§4、§5）或源码现状。
- **NFR-006**（可配置性）：`ID_TOKEN_VERIFY_MODE` 支持 `strict`/`soft` 两档；请求 scope 通过 `NEXT_PUBLIC_SSO_SCOPE` 配置。

---

## 5. 边界与排除项

明确**不做**以下内容：

1. **不实现 IdP-Initiated SSO**（§4.4，高级）——本迭代仅 SP-Initiated 流程；IDP 能力是否启用由 IDP 侧决定，SP 侧不做适配（见 OQ-005）。
2. **不实现 DPoP**（§4.5，高级）——IDP 支持但不启用，access_token 为非 DPoP-bound 的 Bearer token。
3. **不实现 PAR**（§4.6，高级）——IDP `require_pushed_authorization_requests=false`（§1.6），非强制，本迭代不采用。
4. **不实现 Back-Channel Logout**（§4.7，高级）——IDP 声明 `backchannel_logout_supported=true`（§1.6），但本迭代不实现 BCL 端点（见 OQ-005）。
5. **不实现 DCR 动态客户端注册**（§3.10）与 `client_credentials` grant / SCIM（§3.3.3）——使用静态注册客户端，无机器对机器场景。
6. **本 spec 不消费 token introspection 内省端点**（§3.6）——会话建立与登录态判定（FR-016 middleware cookie 级 + Node 深度校验）不调用内省端点；受保护操作访问前的有效性确认（本地 JWT 校验或内省，含内省缓存策略）归 `spec-sso-token`（FR-017 ~ FR-020）范围。
7. **不实现本地 LDAP 直连 / 本地密码认证**——认证统一走 SSO，不引入替代认证路径。
8. **不改造现有 middleware 速率限制逻辑**（单 IP 每分钟 20 次、`/api/health` 不限流）——仅替换认证钩子（FR-016），限流逻辑保持现状。
9. **不实现 groups 业务权限映射**——`groups` claim 是否请求及其业务含义未定义（见 OQ-006），本迭代不做权限控制。
10. **不引入多实例共享会话 / 限流存储**——现有内存 Map 限流保持单实例语义（P2 优化项，非本迭代范围）。
11. **行数约束**：本文件 ≤ 500 行（全局代码规范）。若后续评审修订导致超限，将在此声明拆分计划（如拆分为 `spec-sso-auth-login-v1.x.md` 与 `spec-sso-auth-session-v1.x.md`）。
12. **相关 spec 职责划界（R1-001 裁决，独立演进）**：`spec-sso-token`（v1.1，draft）覆盖 **token 生命周期**——令牌存储与 cookie 属性（token FR-001/FR-002）、会话超时语义（FR-003）、续期触发与轮换（FR-004~FR-010）、撤销与登出调用（FR-011~FR-016）、内省校验（FR-017~FR-020）、安全强化与通用 SSO 错误码（FR-021~FR-026）。本 spec 覆盖**登录认证、会话建立与登出编排**——authorize / PKCE / 回调 / 令牌交换初始获取 / id_token 验证 / userinfo / 会话 cookie 建立（FR-015）/ 登录态判定分层（FR-016）/ 登出流程编排（FR-019~FR-023）。重叠区域消除重复规格化的规则：**会话续期**（含提前 60 秒主动续期、轮换、失败分类）归 token spec FR-004~FR-010，本 spec FR-018 仅保留触发衔接；**会话失效语义**统一为 token spec `AUTH_SESSION_INVALID`（本 spec FR-017 引用）；**revoke / 内省调用细节**归 token spec FR-011~FR-020，本 spec 登出仅编排流程顺序；**错误码**归属以 §3.7 归属边界为准（token 生命周期与通用 SSO 错误码以 token spec FR-025 为唯一事实来源）；**cookie 属性**（access_token / refresh_token）以 token spec FR-001 / FR-002 为单一描述来源，token spec 承接登录后的生命周期维护。两份 spec 各自领域内唯一、范围不重叠，符合 spec-workflow「唯一有效 spec」原则，可独立演进至 approved。
13. **不实现 SAML / WS-Fed 认证**（协议不在集成指南支持范围）与 **Front-Channel Logout**（IDP 能力声明 `frontchannel_logout_supported=false`，§1.6）——FCL 与 Back-Channel Logout（第 4 条）同属登出域，因 IDP 不支持而显式排除。

---

## 6. 验收标准

> 编号规则：AC 覆盖 §3 全部 FR；可测试性标注（单测 = Vitest 全 mock；E2E = Playwright；静态 = 构建/代码检查）。

### 登录发起（FR-001 ~ FR-005）

- [ ] AC-001：点击登录入口后，发出的 authorize 请求 URL 包含全部必填参数：`client_id`、`redirect_uri`、`response_type=code`、`scope`（含 `openid`）、`state`、`code_challenge`、`code_challenge_method=S256`、`nonce`（单测 + E2E）。
- [ ] AC-002：`code_verifier` 长度 ≥ 43 字符；`code_challenge` 等于 `BASE64URL(SHA256(code_verifier))`；`state` 与 `nonce` 长度均 ≥ 32 字符（单测，对应 §7.1.1 V-004/V-005/V-006）。
- [ ] AC-003：跳转 IDP 前，`code_verifier`、`state` 与 `nonce` 均已写入 sessionStorage 与 cookie 双份；状态 cookie 由**服务端（登录发起 API）**写入且带 `httpOnly=true` + `sameSite=lax` 标志，前端 JS 无法读取（单测 + E2E cookie 断言）。
- [ ] AC-004：`redirect_uri` 与客户端注册值完全一致（区分大小写、末尾斜杠）（单测，对应 §7.1.1 V-007）。
- [ ] AC-005：`returnTo` 为非法目标（跨域、`//` 开头、`javascript:`/`data:` 协议）时被拒绝或规范化，不产生开放重定向；合法 `returnTo` 与登录状态一并持久化（沿用 FR-003 双写机制），回调认证成功后恢复并再次校验（单测，对应 §7.1.4 V-024 ~ V-027）。

### 回调与令牌交换（FR-006 ~ FR-010）

- [ ] AC-006：回调缺少 `code`/`state`/`iss` 任一参数 → 返回 400（`AUTH_LOGIN_MISSING_PARAMS`）且不发起令牌交换；回调含 `error=access_denied` → 友好提示并清除一次性登录状态；其他 `error` → `AUTH_LOGIN_IDP_ERROR`（单测）。
- [ ] AC-007：回调 `state` 与本地保存值不一致 → 返回 400（`AUTH_LOGIN_STATE_MISMATCH`），不交换令牌（单测，对应 V-009）。
- [ ] AC-008：state 校验通过并完成令牌交换后，`sso_oauth_state` 状态被清除（一次性使用）（单测）。
- [ ] AC-009：回调 `iss` 与 Discovery `issuer` 不一致 → 拒绝登录（`AUTH_LOGIN_ISS_MISMATCH`）（单测，对应 V-010）。
- [ ] AC-010：令牌交换请求由服务端发起且携带 `code_verifier` 与 `client_secret`；浏览器网络请求中不出现对 IDP token 端点的直接调用；响应 `token_type` 非 `Bearer`（大小写不敏感）时按失败处理（E2E 网络断言 + 构建产物静态检查 + 单测 mock）。
- [ ] AC-011：IDP 返回 `invalid_grant`（授权码过期/已使用）→ 用户收到明确错误提示并引导重新登录，一次性登录状态已清除（单测 mock，对应 V-011 失败路径）。

### 身份验证与用户信息（FR-011 ~ FR-014）

- [ ] AC-012：id_token 8 步验证以参数化用例逐一验证：格式错误、`alg=none` 拒绝、`kid` 不匹配（刷新 JWKS 后重试成功）、签名错误、`iss` 不符、`aud` 不含 client_id、`exp` 过期、`nonce` 不匹配——strict 模式均拒绝登录（单测，对应 V-013）。
- [ ] AC-013：`ID_TOKEN_VERIFY_MODE=soft` 时验证失败仅记录日志、不拒绝登录（单测）。
- [ ] AC-014：JWKS 缓存生效（1 小时内不重复请求）；`kid` 未命中时刷新缓存并重试成功（单测 mock fetch 调用计数）。
- [ ] AC-015：userinfo 返回的 `sub` 与 id_token `sub` 一致时登录成功；不一致 → 登录失败（单测，对应 V-014）。
- [ ] AC-016：IDP 端点 URL 全部取自 Discovery，代码中无硬编码端点；Discovery / JWKS / UserInfo 调用全部在服务端执行（浏览器不直连 IDP 域名，与现有 CSP `connect-src 'self'` 一致）；拉取失败或 `issuer` 校验失败 → `AUTH_IDP_DISCOVERY_FAILED`（单测 + 静态检查）。

### 会话与 Cookie 管理（FR-015 ~ FR-018）

- [ ] AC-017：登录成功后设置 `sso_access_token` / `sso_refresh_token` / `sso_id_token` 三个 cookie，属性均为 `httpOnly=true`、`secure=true`（生产）、`sameSite=lax`、`path=/`；access_token maxAge 与 `expires_in`（900 秒）一致（单测 + E2E，对应 V-015）。
- [ ] AC-018：middleware 层：`sso_access_token` cookie 缺失或 `exp` 过期 → 302 重定向登录流程；存在且未过期 → 放行（E2E @smoke）。middleware 源码静态检查确认不引用 `SSO_CLIENT_SECRET` 等服务端密钥环境变量（静态检查）。Node 运行时层深度校验对象为 access_token（本地 JWT 验签 + iss/aud/exp 结构性校验，fail-closed），不以 id_token 验签作为受保护 API 的有效性校验（静态检查 + 单测，对应 FR-016 分层校验）。
- [ ] AC-019：access_token 过期（不尝试续期）→ middleware 302 重定向登录（E2E/单测）；refresh_token 被撤销（续期返回 `invalid_grant`）→ 全部会话 cookie 清除并跳转登录，错误码 `AUTH_SESSION_INVALID`（定义于 token spec）（单测）。
- [ ] AC-020：access_token 剩余有效期 <60 秒时，受保护请求进入 Node 层触发续期（`refresh_token` grant）；userinfo / 受保护请求返回 401 时同样触发续期；续期成功后按 token spec 轮换规则（FR-006~FR-007）替换 cookie 值（单测断言触发载体与衔接，对应 §7.1.2 V-016/V-017/V-018）。
- [ ] AC-021：IDP 检测 refresh_token 重放并撤销全部会话 → SP 清除本地会话并引导重新登录（单测 mock，衔接 token spec FR-009 行为）。

### 登出（FR-019 ~ FR-023）

- [ ] AC-022：登出流程按序执行：revoke access_token + refresh_token → 清除本地全部会话 cookie → end_session 请求以 **POST（application/x-www-form-urlencoded）** 提交，`id_token_hint`、`post_logout_redirect_uri`、`state` 位于请求体、URL 不含 id_token_hint（单测断言调用顺序与提交方式 + E2E @smoke）。
- [ ] AC-023：revoke 返回 200（token 无效时）或网络失败，本地会话 cookie 均被清除（单测，对应 §7.1.3 V-019）。
- [ ] AC-024：revoke refresh_token 后再次用其交换 → IDP 返回 `invalid_grant`（单测 mock，对应 V-020）。
- [ ] AC-025：end_session 307 跳转回白名单内 `post_logout_redirect_uri`（携带 state）被正确跟随；回传 state 与本地保存的登出 state 不一致时不跳转第三方（单测，对应 V-021）。
- [ ] AC-026：`sso_id_token` cookie 丢失或 `id_token_hint` 验签失败时，end_session 请求携带 `client_id` 参数回退（§3.8 身份校验逻辑 2），IDP 端登出仍可完成（单测 mock）。
- [ ] AC-027：`post_logout_redirect_uri` 不在白名单 → 不跳转、本地 cookie 仍清除；end_session 400/401 错误路径同样清除本地 cookie（单测）。
- [ ] AC-028：登出完成后访问受保护资源 → 重定向登录（会话已失效）（E2E，对应 V-022）。

### 安全与配置（FR-024 ~ FR-027）

- [ ] AC-029：生产构建产物（浏览器 JS bundle）中不包含 client_secret 值（构建后静态检查）。
- [ ] AC-030：IDP 返回 429 + `Retry-After` → 按 `Retry-After` 精确等待后重试（上限 3 次）；网络错误 / 5xx → 指数退避最多 3 次；重试耗尽后返回 `AUTH_IDP_RATE_LIMITED`（定义于 token spec）明确错误（单测 mock，对应 §6.4 / §6.5）。
- [ ] AC-031：日志捕获断言：正常/失败流程日志均不含 access_token、refresh_token、id_token、state、code_verifier、client_secret；面向用户的错误响应仅含错误码与安全通用文案，不含 IDP 内部错误详情（单测日志 + 响应断言）。
- [ ] AC-032：缺失必需环境变量（`SSO_CLIENT_SECRET`、`SSO_ISSUER`、`SSO_CLIENT_ID`、`NEXT_PUBLIC_SSO_*`）时报错信息清晰指明缺失项（单测）。
- [ ] AC-033：全部错误码使用 `AUTH_` 前缀且与 §3.7 错误码表一一对应（静态检查 + 评审）。
- [ ] AC-034：单元测试全 mock（不依赖真实 IDP）运行通过；E2E 基于本地 mock IDP（`SSO_MOCK_ENABLED=1`，§2.1）或 Playwright route 拦截执行，`@smoke`（登录 → 受保护接口 → 登出）与 `@no-llm` 认证用例通过（`npm test` / `npm run test:e2e:smoke`）。

---

## 7. 开放问题（需求基线缺口）

以下决策缺口源于业务集成目标文档缺失（`docs/sso-business-goals.md` 不存在），本 spec 以集成指南 + 源码现状为基线，**需业务方确认后方可进入架构设计**：

- **OQ-001**：业务集成目标确认——受保护资源范围、会话策略、登出体验等业务诉求无文档依据，本 spec 全部技术约束来自集成指南。
- **OQ-002**：受保护资源范围——现有仅 `/api/solve` 受保护（middleware `PROTECTED_API_PREFIX`）；页面路由（如 `/result`、`/solve`）是否需要登录保护？
- **OQ-003**：现有 `/login` 页面去留——SSO 登录是否完全替代现有登录页？middleware 未认证重定向目标是否改为 SSO 登录入口？
- **OQ-004**：`offline_access`（refresh_token）是否启用——决定会话策略：15 分钟短期会话（每次需重新登录）vs 30 天持久会话（refresh 轮换续期）。集成指南默认 scope 含 `offline_access`，但业务取舍未定。
- **OQ-005**：是否要求 IdP-Initiated SSO 与 Back-Channel Logout——IDP 均支持（§1.6），SP 侧是否启用由业务场景决定。
- **OQ-006**：`groups` scope 是否请求及业务用途（角色 / 权限映射）——当前无权限体系，`groups` claim 消费方未定义。
- **OQ-007**：`post_logout_redirect_uri` 白名单具体取值——需与客户端注册值（§2.2）保持一致，由业务确认登出后落地页。
- **OQ-008**：生产环境 `ID_TOKEN_VERIFY_MODE` 是否强制 `strict`——集成指南明确 `soft` 不推荐生产，是否允许配置为 `soft` 需确认。
- **OQ-009**：登录成功后的默认落地页——`returnTo` 为空时的跳转目标未定义（现有应用入口为输入页 `/solve` 或 `/`，未确认）。
- **OQ-010**：与 `spec-sso-token`（v1.1，draft）的重叠区域处理——**已裁决（R1-001）**：两份 spec 独立演进、职责划界（本 spec：登录认证 / 会话建立 / 登出编排；token spec：token 生命周期 / 续期 / 撤销 / 内省 / 安全强化与通用 SSO 错误码；划界条款见 §5 第 12 条），不合并。错误码采用分区制：登录类（`AUTH_LOGIN_*`）与登出流程专属错误码归本 spec（§3.7），token / 刷新 / 内省 / 会话失效类（`AUTH_TOKEN_*`、`AUTH_SESSION_INVALID`、`AUTH_IDP_RATE_LIMITED`）归 token spec FR-025（唯一事实来源）。**R2-001 裁决补充**：`AUTH_LOGIN_INVALID_CREDENTIALS` 不适用于 SSO 流程（凭证校验在 IDP 侧，SP 侧无触发场景），本 spec 不收录（见 §3.7），需 token spec 生成方在下一轮修订其 FR-025（其当前将 `AUTH_LOGIN_INVALID_CREDENTIALS` 列入体系预留清单，与本裁决冲突）。无待业务确认项。
