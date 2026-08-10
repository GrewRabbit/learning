# SSO IDP SP 集成指南

**版本**：v1.0
**状态**：active
**适用对象**：SP（Service Provider）端开发者 + AI Agent
**创建时间**：2026-08-06
**最后更新**：2026-08-06

> 本文档面向需要接入 SSO IDP 的 SP 端开发者与 AI Agent。AI Agent 可按 §0.2 指引按需加载章节，独立完成 SP 端 SSO 集成开发与验证。
> 本文档替代原 `docs/SSO-IDP-与SCIM接口使用规范.md`（已删除，SCIM 部分如有需要将另行建文档）。

---

## 目录

- [0. 文档导航与使用说明](#0-文档导航与使用说明)
- [1. 集成概述](#1-集成概述)
- [2. 集成前置条件](#2-集成前置条件)
- [3. SSO IDP 端点规范](#3-sso-idp-端点规范)
- [4. 集成流程](#4-集成流程)
- [5. 安全要求](#5-安全要求)
- [6. 错误处理](#6-错误处理)
- [7. 集成验证](#7-集成验证)
- [8. 参考实现](#8-参考实现)
- [附录](#附录)

---

## 0. 文档导航与使用说明

### 0.1 适用对象与使用场景

| 角色 | 使用方式 |
|------|---------|
| SP 端开发者 | 通读 §1-§5 后按 §4 流程实施；§3 作为接口契约手册随时查阅 |
| AI Agent | 按 §0.2 指引按需加载章节；优先读取 §2 → §3.1 → §4.1 → §5 → §7 |
| IDP 管理员 | 参考 §3 端点行为与 §6 错误码定位问题 |

### 0.2 AI Agent 使用方式

**按需加载策略**（避免一次性加载全文）：

| 任务阶段 | 必读章节 | 选读章节 |
|---------|---------|---------|
| 理解 IDP 能力 | §1、§3.1 | — |
| 准备集成环境 | §2 | 附录 A |
| 实现核心登录流程 | §3.1、§3.2、§3.3、§3.4、§3.5、§4.1、§5 | §8 |
| 实现 Token 续期 | §3.3.2、§4.2、§5.6 | — |
| 实现登出 | §3.7、§3.8、§4.3 | — |
| 实现 IdP-Initiated SSO | §4.4、§5.5 | — |
| 实现 DPoP（高级） | §3.2、§3.3、§3.4、§4.5 | — |
| 实现 PAR（高级） | §3.9、§4.6 | — |
| 实现 Back-Channel Logout（高级） | §4.7 | §3.8 |
| 验证集成 | §7 | §6 |
| 排查错误 | §6 | 附录 B |

**关键路径优先**：AI Agent 集成核心登录流程时，建议按 `§2 → §3.1 → §3.2 → §3.3 → §3.5 → §3.4 → §4.1 → §5 → §7` 顺序读取。

### 0.3 术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| IDP | Identity Provider | 身份提供商（本项目 SSO 服务） |
| SP | Service Provider | 服务提供商（接入方应用） |
| RP | Relying Party | 依赖方（OIDC 中 SP 的同义词） |
| OIDC | OpenID Connect | 基于 OAuth 2.0 的身份层协议 |
| OAuth 2.0 | — | 授权框架（RFC 6749） |
| PKCE | Proof Key for Code Exchange | 防止授权码拦截（RFC 7636） |
| DPoP | Demonstrating Proof-of-Possession | 发送者约束令牌（RFC 9449） |
| PAR | Pushed Authorization Requests | 推送授权请求（RFC 9126） |
| DCR | Dynamic Client Registration | 动态客户端注册（RFC 7591/7592） |
| JWKS | JSON Web Key Set | 公钥集合（RFC 7517） |
| JWT | JSON Web Token | 基于 JSON 的令牌（RFC 7519） |
| RAT | Registration Access Token | DCR 管理操作的访问令牌 |
| iss | Issuer | 颁发者标识（OIDC） |
| aud | Audience | 受众标识（OIDC） |
| sub | Subject | 主体标识（用户唯一 ID） |
| sid | Session ID | 会话标识（用于 Back-Channel Logout） |

### 0.4 文档版本与变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-06 | 初稿创建，替代原 SSO IDP + SCIM 混合文档 |

---

## 1. 集成概述

### 1.1 协议版本与 RFC 参考

| 协议 | 版本 | RFC | 用途 |
|------|------|-----|------|
| OAuth 2.0 | — | RFC 6749 | 授权框架基础 |
| OAuth 2.0 PKCE | — | RFC 7636 | 防止授权码拦截 |
| OAuth 2.0 Token Revocation | — | RFC 7009 | Token 撤销 |
| OAuth 2.0 Token Introspection | — | RFC 7662 | Token 内省 |
| OAuth 2.0 DPoP | — | RFC 9449 | 发送者约束令牌 |
| OAuth 2.0 PAR | — | RFC 9126 | 推送授权请求 |
| OAuth 2.0 DCR | — | RFC 7591/7592 | 动态客户端注册 |
| OpenID Connect Core | 1.0 | OIDC Core | 身份层 |
| OpenID Connect Discovery | 1.0 | OIDC Discovery | IDP 配置发现 |
| OIDC RP-Initiated Logout | 1.0 | OIDC RP-Initiated Logout | RP 发起登出 |
| OIDC Back-Channel Logout | 1.0 | OIDC Back-Channel Logout | 后端通道登出 |
| OIDC iss 参数 | — | RFC 9207 | 授权响应 iss 参数 |
| JWT | — | RFC 7519 | 令牌格式 |
| JWKS | — | RFC 7517 | 公钥集合 |

### 1.2 支持的 Grant Types

| Grant Type | 用途 | 是否需要用户登录 | 是否返回 refresh_token | 是否返回 id_token |
|-----------|------|----------------|---------------------|------------------|
| `authorization_code` | 标准 Web/App 登录 | 是 | 是（需 `offline_access` scope） | 是 |
| `refresh_token` | 续期 access_token | 否 | 是（轮换后返回新值） | 否 |
| `client_credentials` | 机器对机器访问（如 SCIM） | 否 | 否 | 否 |

### 1.3 支持的 Response Types

- `code`（Authorization Code Flow，唯一支持）

### 1.4 支持的 Signing Algorithms

| 用途 | 支持的算法 | 默认 |
|------|-----------|------|
| id_token 签名 | `RS256` | `RS256` |
| DPoP Proof 签名 | `RS256`、`ES256`、`PS256` | — |

> **安全约束**：IDP 拒绝 `alg=none` 与所有 `HS*` 算法（HS256/HS384/HS512）。

### 1.5 支持的 Scopes 与 Claims

#### Scope 清单

| Scope | 说明 | 必需 | 返回的 Claims |
|-------|------|------|--------------|
| `openid` | OIDC 必需 | 是 | `sub`、`nonce`、`auth_time` |
| `profile` | 用户基础资料 | 否 | `name`、`preferred_username` |
| `email` | 邮箱信息 | 否 | `email`、`email_verified` |
| `groups` | 用户组成员关系 | 否 | `groups` |
| `account_status` | 账户状态 | 否 | `account_active`、`account_expires_at` |
| `offline_access` | 请求 refresh_token | 否 | 颁发 refresh_token |
| `scim` | SCIM API 访问权限 | 否（仅 `client_credentials` 使用） | 用于机器对机器访问 |

#### Scope → Claim 映射表

| Scope | 返回的 Claims（在 id_token 与 userinfo 中） |
|-------|------------------------------------------|
| `openid` | `sub`、`nonce`（如请求时传入）、`auth_time` |
| `profile` | `name`、`preferred_username` |
| `email` | `email`、`email_verified` |
| `groups` | `groups` |
| `account_status` | `account_active`、`account_expires_at` |

### 1.6 IDP 能力声明总览

下表为 Discovery 端点（§3.1）返回的所有 `*_supported` 字段汇总，AI Agent 可据此判断 IDP 能力：

| 字段 | 取值 | 说明 |
|------|------|------|
| `response_types_supported` | `["code"]` | 仅授权码流程 |
| `subject_types_supported` | `["public"]` | 公共 subject 类型 |
| `id_token_signing_alg_values_supported` | `["RS256"]` | id_token 签名算法 |
| `scopes_supported` | `["openid","profile","email","groups","offline_access","scim","account_status"]` | 支持的 scope |
| `token_endpoint_auth_methods_supported` | `["client_secret_post"]` | Token 端点客户端认证方式 |
| `revocation_endpoint_auth_methods_supported` | `["client_secret_post"]` | Revoke 端点客户端认证方式 |
| `introspection_endpoint_auth_methods_supported` | `["client_secret_post"]` | Introspect 端点客户端认证方式 |
| `claims_supported` | `["sub","name","preferred_username","email","email_verified","groups","nonce","auth_time","account_active","account_expires_at"]` | 支持的 claims |
| `code_challenge_methods_supported` | `["S256"]` | PKCE 方法（强制 S256） |
| `grant_types_supported` | `["authorization_code","refresh_token","client_credentials"]` | 支持的 grant_type |
| `request_parameter_supported` | `false` | 不支持 JAR Request Object |
| `request_uri_parameter_supported` | `true` | 支持 PAR request_uri |
| `require_request_uri_registration` | `false` | 不强制注册 request_uri |
| `frontchannel_logout_supported` | `false` | 不支持 Front-Channel Logout |
| `frontchannel_logout_session_supported` | `false` | 不支持 Front-Channel Logout 会话 |
| `backchannel_logout_supported` | `true` | 支持 Back-Channel Logout（FR-002） |
| `backchannel_logout_session_supported` | `true` | 支持 Back-Channel Logout 会话 |
| `authorization_response_iss_parameter_supported` | `true` | 授权响应包含 iss 参数（FR-001） |
| `pushed_authorization_request_endpoint` | `${ISSUER}/api/sso/par` | PAR 端点（FR-007） |
| `require_pushed_authorization_requests` | `false` | PAR opt-in（不强制） |
| `dpop_signing_alg_values_supported` | `["RS256","ES256","PS256"]` | DPoP 签名算法白名单（FR-006） |
| `registration_endpoint` | `${ISSUER}/api/sso/register`（条件性） | DCR 端点（FR-005），仅当 `SSO_DCR_ENABLED=true` 时声明 |

### 1.7 客户端认证方式

IDP 在 Token、Revoke、Introspect 端点支持 `client_secret_post` 认证方式：

- 客户端将 `client_id` 与 `client_secret` 作为请求体参数发送
- IDP 校验通过后授权访问
- **不支持** `client_secret_basic`（HTTP Basic 认证）

---

## 2. 集成前置条件

### 2.1 环境配置

| 环境 | ISSUER_URL | 用途 |
|------|-----------|------|
| 生产 | `https://sso.happyrabbit.top` | 正式服务 |
| 本地开发 | `http://localhost:3000` | 本地联调 |

> **关键约束**：所有端点路径基于 `ISSUER_URL`。本地开发时启动 dev server 必须注入 `ISSUER_URL=http://localhost:3000`，否则 Discovery 会返回生产 issuer，导致 SP 向生产域名发起请求。
>
> 本地开发命令：`ISSUER_URL=http://localhost:3000 APP_URL=http://localhost:3000 SSO_MOCK_ENABLED=1 npm run dev:test`（`SSO_MOCK_ENABLED=1` 启用 SSO mock 模式）

### 2.2 客户端注册流程

每个接入方需向 IDP 管理员申请 OAuth2 客户端，提供以下信息：

| 字段 | 用途 | 示例 |
|------|------|------|
| `client_name` | 客户端显示名（用于 consent 页） | `my-app` |
| `redirect_uris` | 允许的回调 URL 白名单（必须完全匹配） | `["https://my-app.example.com/auth/callback"]` |
| `post_logout_redirect_uris` | 登出后跳转 URL 白名单 | `["https://my-app.example.com/logout/done"]` |
| `allowed_scopes` | 允许的 scope 列表 | `["openid","profile","email","groups","offline_access"]` |
| `grant_types` | 允许的 grant_type | `["authorization_code","refresh_token"]` |
| `response_types` | 允许的 response_type | `["code"]` |
| `backchannelLogoutUri` | Back-Channel Logout 端点（可选，HTTPS） | `https://my-app.example.com/api/backchannel-logout` |
| `idpInitiatedRedirectUri` | IdP-Initiated SSO 回调 URL（可选） | `https://my-app.example.com/auth/callback` |

注册成功后管理员返回：

| 字段 | 暴露范围 | 说明 |
|------|---------|------|
| `client_id` | 公开（前端可见） | 客户端标识 |
| `client_secret` | **仅服务端**（`SSO_CLIENT_SECRET`） | 客户端密钥，禁止 `NEXT_PUBLIC_` 前缀 |

### 2.3 必需的环境变量

#### SP 端 - 浏览器可见（`NEXT_PUBLIC_` 前缀）

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `NEXT_PUBLIC_SSO_ISSUER` | 是 | IDP base URL | `https://sso.happyrabbit.top` |
| `NEXT_PUBLIC_SSO_CLIENT_ID` | 是 | 客户端 ID | `my-app-client` |
| `NEXT_PUBLIC_SSO_REDIRECT_URI` | 是 | 回调 URL | `https://my-app.example.com/auth/callback` |
| `NEXT_PUBLIC_SSO_SCOPE` | 是 | 默认 scope（空格分隔） | `openid profile email groups offline_access` |

#### SP 端 - 仅服务端（无 `NEXT_PUBLIC_` 前缀）

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `SSO_CLIENT_SECRET` | 是 | 客户端密钥（token 交换时使用） | `••••••••` |
| `SSO_ISSUER` | 是 | IDP issuer URL（id_token 验证用） | `https://sso.happyrabbit.top` |
| `SSO_CLIENT_ID` | 是 | 客户端 ID（token 交换时使用） | `my-app-client` |
| `ID_TOKEN_VERIFY_MODE` | 否 | id_token 验证模式：`strict`（默认）或 `soft` | `strict` |

> **安全红线**：`SSO_CLIENT_SECRET` 禁止使用 `NEXT_PUBLIC_SSO_CLIENT_SECRET`（会被内联到浏览器 JS bundle，泄露密钥）。

### 2.4 集成验证工具清单

| 工具 | 用途 | 必需 |
|------|------|------|
| `curl` | 命令行测试端点契约 | 是 |
| Node.js 18+ | 运行 TypeScript 示例与验证脚本 | 是 |
| `jose` 库 | JWT 验证（id_token、DPoP Proof） | 推荐 |
| Playwright | E2E 测试（可选） | 否 |

---

## 3. SSO IDP 端点规范

> 每个端点统一包含：HTTP 方法与路径、Content-Type、请求参数表、请求示例、成功响应契约、错误响应契约、AI 执行清单。

### 3.1 Discovery 发现端点

获取 IDP 配置信息。客户端**应仅信任 Discovery 返回的配置**，不硬编码端点 URL。

```
GET /.well-known/openid-configuration
```

**请求参数**：无

**响应头**：

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=3600
```

**响应体字段表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `issuer` | string | IDP 颁发者 URL（与 `ISSUER_URL` 一致） |
| `authorization_endpoint` | string | 授权端点 URL |
| `token_endpoint` | string | Token 端点 URL |
| `userinfo_endpoint` | string | UserInfo 端点 URL |
| `jwks_uri` | string | JWKS 端点 URL |
| `revocation_endpoint` | string | 撤销端点 URL |
| `end_session_endpoint` | string | 登出端点 URL |
| `introspection_endpoint` | string | 内省端点 URL |
| `response_types_supported` | string[] | 支持的 response_type |
| `subject_types_supported` | string[] | 支持的 subject 类型 |
| `id_token_signing_alg_values_supported` | string[] | id_token 签名算法 |
| `scopes_supported` | string[] | 支持的 scope |
| `token_endpoint_auth_methods_supported` | string[] | Token 端点认证方式 |
| `revocation_endpoint_auth_methods_supported` | string[] | Revoke 端点认证方式 |
| `introspection_endpoint_auth_methods_supported` | string[] | Introspect 端点认证方式 |
| `claims_supported` | string[] | 支持的 claims |
| `code_challenge_methods_supported` | string[] | PKCE 方法 |
| `grant_types_supported` | string[] | 支持的 grant_type |
| `request_parameter_supported` | boolean | 是否支持 JAR Request Object（false） |
| `request_uri_parameter_supported` | boolean | 是否支持 PAR request_uri（true） |
| `require_request_uri_registration` | boolean | 是否强制注册 request_uri（false） |
| `frontchannel_logout_supported` | boolean | Front-Channel Logout 支持（false） |
| `frontchannel_logout_session_supported` | boolean | Front-Channel Logout 会话支持（false） |
| `backchannel_logout_supported` | boolean | Back-Channel Logout 支持（true） |
| `backchannel_logout_session_supported` | boolean | Back-Channel Logout 会话支持（true） |
| `authorization_response_iss_parameter_supported` | boolean | 授权响应 iss 参数支持（true） |
| `pushed_authorization_request_endpoint` | string | PAR 端点 URL |
| `require_pushed_authorization_requests` | boolean | 是否强制 PAR（false，opt-in） |
| `dpop_signing_alg_values_supported` | string[] | DPoP 签名算法白名单 |
| `registration_endpoint` | string（条件性） | DCR 端点 URL，仅当 `SSO_DCR_ENABLED=true` 时存在 |

**响应示例**：

```json
{
  "issuer": "https://sso.happyrabbit.top",
  "authorization_endpoint": "https://sso.happyrabbit.top/api/sso/authorize",
  "token_endpoint": "https://sso.happyrabbit.top/api/sso/token",
  "userinfo_endpoint": "https://sso.happyrabbit.top/api/sso/userinfo",
  "jwks_uri": "https://sso.happyrabbit.top/api/sso/jwks",
  "revocation_endpoint": "https://sso.happyrabbit.top/api/sso/revoke",
  "end_session_endpoint": "https://sso.happyrabbit.top/api/sso/logout",
  "introspection_endpoint": "https://sso.happyrabbit.top/api/sso/introspect",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "scopes_supported": ["openid","profile","email","groups","offline_access","scim","account_status"],
  "token_endpoint_auth_methods_supported": ["client_secret_post"],
  "revocation_endpoint_auth_methods_supported": ["client_secret_post"],
  "introspection_endpoint_auth_methods_supported": ["client_secret_post"],
  "claims_supported": ["sub","name","preferred_username","email","email_verified","groups","nonce","auth_time","account_active","account_expires_at"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code","refresh_token","client_credentials"],
  "request_parameter_supported": false,
  "request_uri_parameter_supported": true,
  "require_request_uri_registration": false,
  "frontchannel_logout_supported": false,
  "frontchannel_logout_session_supported": false,
  "backchannel_logout_supported": true,
  "backchannel_logout_session_supported": true,
  "authorization_response_iss_parameter_supported": true,
  "pushed_authorization_request_endpoint": "https://sso.happyrabbit.top/api/sso/par",
  "require_pushed_authorization_requests": false,
  "dpop_signing_alg_values_supported": ["RS256","ES256","PS256"],
  "registration_endpoint": "https://sso.happyrabbit.top/api/sso/register"
}
```

> `registration_endpoint` 仅在 IDP 启用 DCR（`SSO_DCR_ENABLED=true`）时存在。

**curl 示例**：

```bash
curl -s https://sso.happyrabbit.top/.well-known/openid-configuration | jq .
```

**AI 执行清单**：

- [ ] 拉取 Discovery 并缓存（建议 1 小时）
- [ ] 校验 `issuer` 与预期 `ISSUER_URL` 一致
- [ ] 从 Discovery 提取所有端点 URL，禁止硬编码
- [ ] 检查 `response_types_supported` 包含 `code`
- [ ] 检查 `code_challenge_methods_supported` 包含 `S256`
- [ ] 检查 `scopes_supported` 包含所需 scope
- [ ] 检查 `backchannel_logout_supported` 决定是否实现 §4.7

---

### 3.2 Authorize 授权端点

发起用户授权，浏览器跳转到登录页完成认证后回调到 SP。

```
GET /api/sso/authorize
```

**请求参数**（Query String）：

| 参数 | 必填 | 类型 | 约束 | 说明 |
|------|------|------|------|------|
| `client_id` | 是 | string | 已注册的客户端 ID | 标识客户端 |
| `redirect_uri` | 是 | URL | 必须与注册值**完全匹配** | 回调 URL |
| `response_type` | 是 | `code` | 固定值 | 授权码流程 |
| `scope` | 是 | string | 空格分隔，必须包含 `openid` | 请求的 scope |
| `state` | 是 | string | 随机串，建议 ≥ 32 字符 | CSRF 防御，原样回传 |
| `code_challenge` | 是 | string | S256 哈希值（base64url） | PKCE challenge |
| `code_challenge_method` | 是 | `S256` | 固定值 | PKCE 强制 S256 |
| `nonce` | 否 | string | 随机串 | id_token 中原样回传 |
| `dpop_jkt` | 否 | string | DPoP 公钥 thumbprint | DPoP 绑定（高级，见 §4.5） |
| `request_uri` | 否 | string | PAR 返回的 request_uri | PAR 模式（高级，见 §4.6） |

**校验规则**：

| 规则 | 失败响应 |
|------|---------|
| `response_type=code` | `unsupported_response_type`（302 重定向） |
| `scope` 必须包含 `openid` | `invalid_scope`（302 重定向） |
| `redirect_uri` 必须与客户端注册值**完全匹配** | `invalid_client`（400 JSON） |
| `code_challenge_method=S256` | `invalid_request`（302 重定向） |
| `client_id` 必须存在且启用 | `invalid_client`（400 JSON） |

**行为分支**：

| 场景 | 行为 |
|------|------|
| 用户未登录 | 重定向至 IDP 登录页（携带当前 authorize 请求上下文） |
| 用户已登录但未同意 | 重定向至 consent 页（要求用户确认 scope） |
| 用户已登录且已同意 | 直接生成授权码并回调 |
| IdP-Initiated SSO | 不携带 `code_verifier`/`state`，由 IDP 决定是否接受（见 §4.4） |

**成功响应**（HTTP 302）：

```
HTTP/1.1 302 Found
Location: <redirect_uri>?code=<AUTH_CODE>&state=<STATE>&iss=<ISSUER>
```

| 字段 | 说明 |
|------|------|
| `code` | 授权码（一次性，默认有效期 60 秒） |
| `state` | 原样回传的 state |
| `iss` | IDP 颁发者 URL（RFC 9207，FR-001） |

**错误响应**：

**重定向错误**（携带 state 回传至 redirect_uri）：

| error | 触发场景 |
|-------|---------|
| `invalid_request` | 缺少必需参数、参数格式错误 |
| `invalid_scope` | scope 无效或缺少 `openid` |
| `unsupported_response_type` | `response_type` 不是 `code` |

```
HTTP/1.1 302 Found
Location: <redirect_uri>?error=invalid_request&error_description=...&state=...
```

**非重定向错误**（不跳转 redirect_uri，直接返回 JSON）：

| error | HTTP | 触发场景 |
|-------|------|---------|
| `invalid_client` | 401 | `client_id` 不存在 / 客户端未启用 / `redirect_uri` 不匹配 |
| `server_error` | 500 | 内部错误 |

```json
{
  "error": "invalid_client",
  "error_description": "Client not found or inactive"
}
```

**curl 示例**：

```bash
# 生成 code_challenge（需要 PKCE 工具）
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '+/' '-_')
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d '=' | tr '+/' '-_')
STATE=$(openssl rand -hex 16)

# 跳转授权 URL（在浏览器中打开）
echo "https://sso.happyrabbit.top/api/sso/authorize?client_id=my-app-client&redirect_uri=https%3A%2F%2Fmy-app.example.com%2Fauth%2Fcallback&response_type=code&scope=openid%20profile%20email%20groups%20offline_access&state=$STATE&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256"
```

**TypeScript 示例**：

```typescript
import { generatePKCE, generateRandomString } from '@/lib/sso-sp/pkce';

const { codeVerifier, codeChallenge } = await generatePKCE();
const state = generateRandomString(32);
const nonce = generateRandomString(32);

const authUrl = new URL(`${issuer}/api/sso/authorize`);
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'openid profile email groups offline_access');
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('nonce', nonce);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

window.location.href = authUrl.toString();
```

**AI 执行清单**：

- [ ] 校验 `redirect_uri` 与注册值完全匹配（区分大小写、末尾斜杠）
- [ ] 校验 `scope` 包含 `openid`
- [ ] 生成 `code_verifier`（≥ 43 字符）与 `code_challenge`（S256）
- [ ] 生成 `state`（≥ 32 字符，加密随机）
- [ ] 保存 `code_verifier` 与 `state` 到 sessionStorage + cookie（双写容错）
- [ ] 处理 302 响应（提取 code、state、iss）
- [ ] 校验回传的 `state` 与本地保存一致（CSRF 防御）
- [ ] 校验回传的 `iss` 与 Discovery 的 `issuer` 一致（防 IDP 混淆攻击）

---

### 3.3 Token 令牌端点

用授权码、refresh_token 或 client_credentials 换取 access_token。

```
POST /api/sso/token
Content-Type: application/x-www-form-urlencoded
```

#### 3.3.1 Authorization Code Grant

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | `authorization_code` |
| `code` | 是 | 从 authorize 端点获取的授权码 |
| `redirect_uri` | 是 | 必须与 authorize 请求一致 |
| `client_id` | 是 | 客户端 ID |
| `client_secret` | 是 | 客户端密钥（`client_secret_post` 认证） |
| `code_verifier` | 是 | PKCE verifier（原始值，用于校验 challenge） |
| `DPoP` | 否 | DPoP Proof JWT 头（高级，见 §4.5） |

**成功响应**（HTTP 200）：

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
Pragma: no-cache
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "scope": "openid profile email groups offline_access",
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

**响应字段表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `access_token` | string | 访问令牌（JWT，默认有效期 900 秒 / 15 分钟） |
| `token_type` | string | 固定 `Bearer`（大小写不敏感，OIDC 规范化为小写） |
| `expires_in` | number | access_token 有效期（秒） |
| `refresh_token` | string | 刷新令牌（仅在 scope 含 `offline_access` 时返回） |
| `scope` | string | 实际授权的 scope（空格分隔） |
| `id_token` | string | OIDC 身份令牌（JWT，RS256 签名） |

#### 3.3.2 Refresh Token Grant

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | `refresh_token` |
| `refresh_token` | 是 | 之前获取的 refresh_token |
| `client_id` | 是 | 客户端 ID |
| `client_secret` | 是 | 客户端密钥 |
| `scope` | 否 | 可选缩小范围（不能扩大） |
| `DPoP` | 否 | DPoP Proof JWT 头（高级） |

**响应**：与 authorization_code 相同（**不返回新的 id_token**）。

**Refresh Token 轮换规则**（关键安全特性）：

1. 每次使用 refresh_token 换取新 token 时，**旧 refresh_token 立即失效**
2. 响应中返回**新的 refresh_token**
3. 客户端必须立即用新 refresh_token 替换旧值
4. 检测到已撤销的 refresh_token 被重放时，**自动撤销该用户的所有会话和 token**（安全告警，防 token 窃取）

#### 3.3.3 Client Credentials Grant

用于机器对机器访问（如 SCIM API 调用），无需用户上下文。

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `grant_type` | 是 | `client_credentials` |
| `client_id` | 是 | 客户端 ID |
| `client_secret` | 是 | 客户端密钥 |
| `scope` | 否 | 默认 `scim` |
| `DPoP` | 否 | DPoP Proof JWT 头（高级） |

**响应示例**（**无 refresh_token、无 id_token**）：

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim"
}
```

#### 3.3.4 Token 端点错误响应

| HTTP | error | 触发场景 |
|------|-------|---------|
| 400 | `invalid_request` | 缺少必需参数、参数格式错误 |
| 400 | `invalid_grant` | code 无效/过期/已使用、redirect_uri 不匹配、refresh_token 无效 |
| 400 | `unsupported_grant_type` | grant_type 不支持或客户端未授权该 grant_type |
| 400 | `invalid_scope` | scope 不在 allowed_scopes 内 |
| 401 | `invalid_client` | client_id/client_secret 不匹配 |
| 500 | `server_error` | 内部错误 |
| 429 | — | 触发速率限制（带 `Retry-After` 头） |

**错误响应示例**：

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code expired"
}
```

**curl 示例**（authorization_code）：

```bash
curl -s -X POST https://sso.happyrabbit.top/api/sso/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=https://my-app.example.com/auth/callback" \
  -d "client_id=my-app-client" \
  -d "client_secret=$SSO_CLIENT_SECRET" \
  -d "code_verifier=$CODE_VERIFIER"
```

**TypeScript 示例**（服务端 API Route）：

```typescript
// app/api/auth/sso/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { code, redirect_uri, state, code_verifier } = body;

  // 1. State CSRF 校验（cookie 比对）
  const cookieState = req.cookies.get('sso_oauth_state')?.value;
  if (cookieState && cookieState !== state) {
    return NextResponse.json(
      { error: 'invalid_state', error_description: 'State mismatch' },
      { status: 400 }
    );
  }

  // 2. 调用 IDP token 端点（client_secret 仅在服务端使用）
  const tokenResponse = await fetch(`${process.env.SSO_ISSUER}/api/sso/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri,
      client_id: process.env.SSO_CLIENT_ID!,
      client_secret: process.env.SSO_CLIENT_SECRET!,
      ...(code_verifier ? { code_verifier } : {}),
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.json();
    return NextResponse.json(error, { status: tokenResponse.status });
  }

  const tokens = await tokenResponse.json();

  // 3. 设置 httpOnly cookie（保护 token）
  const response = NextResponse.json({ success: true, token_meta: tokens });
  response.cookies.set('sso_access_token', tokens.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: tokens.expires_in,
    path: '/',
  });
  if (tokens.refresh_token) {
    response.cookies.set('sso_refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 天
      path: '/',
    });
  }
  return response;
}
```

**AI 执行清单**：

- [ ] 校验 `Content-Type: application/x-www-form-urlencoded`
- [ ] 在**服务端**调用此端点（保护 client_secret）
- [ ] `authorization_code` grant 必须传 `code_verifier`
- [ ] `client_credentials` grant 不返回 refresh_token / id_token
- [ ] `refresh_token` grant 响应不含 id_token
- [ ] refresh_token 轮换：立即用新 refresh_token 替换旧值
- [ ] access_token 默认有效期 900 秒（authorization_code）/ 3600 秒（client_credentials）
- [ ] `token_type` 大小写不敏感，规范比较用 `toLowerCase()`

---

### 3.4 UserInfo 用户信息端点

获取当前 access_token 对应的用户信息。响应**按 scope 过滤**。

```
GET /api/sso/userinfo
POST /api/sso/userinfo
Authorization: Bearer <access_token>
```

> 支持 GET 和 POST 两种方法（OIDC Core 1.0 §5.3 要求）。两者共享同一处理逻辑，从 `Authorization` 头读取 Bearer token。

**Scope → Claim 映射表**：

| Scope | 返回的 Claims |
|-------|--------------|
| `openid` | `sub` |
| `profile` | `name`、`preferred_username` |
| `email` | `email`、`email_verified` |
| `groups` | `groups` |
| `account_status` | `account_active`、`account_expires_at` |

**成功响应**（scope=`openid profile email groups`）：

```json
{
  "sub": "a0000000",
  "name": "张三",
  "preferred_username": "zhangsan",
  "email": "zhangsan@example.com",
  "email_verified": true,
  "groups": ["dev-team", "ops-team"]
}
```

**响应字段表**：

| 字段 | 类型 | 触发 scope | 说明 |
|------|------|-----------|------|
| `sub` | string | `openid` | 用户唯一 ID（与 id_token `sub` 一致） |
| `name` | string | `profile` | 用户显示名 |
| `preferred_username` | string | `profile` | 用户名 |
| `email` | string | `email` | 邮箱 |
| `email_verified` | boolean | `email` | 邮箱是否已验证 |
| `groups` | string[] | `groups` | 用户所属组列表 |
| `account_active` | boolean | `account_status` | 账户是否启用 |
| `account_expires_at` | number | `account_status` | 账户过期时间戳（Unix 秒，0 表示不过期） |

**错误响应**：

| HTTP | error | 说明 | 响应头 |
|------|-------|------|--------|
| 401 | `invalid_token` | 缺少/无效/过期的 access_token | `WWW-Authenticate: Bearer error="invalid_token"` |
| 500 | `server_error` | 内部错误 | — |
| 429 | — | 速率限制 | `Retry-After: <seconds>` |

**curl 示例**：

```bash
curl -s https://sso.happyrabbit.top/api/sso/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**AI 执行清单**：

- [ ] 必须使用 access_token 调用（`Authorization: Bearer <token>`）
- [ ] 401 时检查 `WWW-Authenticate` 头获取错误详情
- [ ] 401 时尝试 refresh_token 续期，续期失败跳转登录
- [ ] 若 access_token 是 DPoP-bound，需携带 `DPoP` 头（见 §4.5）

---

### 3.5 JWKS 公钥端点

获取用于验证 id_token 签名的 RSA 公钥集合。

```
GET /api/sso/jwks
```

**响应头**：

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=3600
```

**响应示例**：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "key-2026-07",
      "use": "sig",
      "alg": "RS256",
      "n": "0vx7agoebGcQSuuL...",
      "e": "AQAB"
    }
  ]
}
```

**响应字段表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `keys` | object[] | 公钥数组 |
| `keys[].kty` | string | 密钥类型（`RSA`） |
| `keys[].kid` | string | 密钥 ID（用于匹配 id_token 的 `kid`） |
| `keys[].use` | string | 用途（`sig` 签名） |
| `keys[].alg` | string | 算法（`RS256`） |
| `keys[].n` | string | RSA 模数（base64url） |
| `keys[].e` | string | RSA 指数（base64url，通常 `AQAB`） |

**密钥轮换机制**：

- IDP 支持密钥轮换（FR-004），多个 key 可同时存在
- 客户端按 id_token header 的 `kid` 匹配 JWKS 中的公钥
- 旧 key 退役后从 JWKS 移除

**客户端缓存建议**：缓存 1 小时，避免频繁请求。key 轮换时通过 `kid` 自动匹配新 key。

**curl 示例**：

```bash
curl -s https://sso.happyrabbit.top/api/sso/jwks | jq .
```

**AI 执行清单**：

- [ ] 缓存 JWKS 响应（建议 1 小时）
- [ ] 验证 id_token 时按 `kid` 匹配公钥
- [ ] `kid` 匹配失败时刷新 JWKS 缓存后重试（防 key 轮换）

---

### 3.6 Introspect 令牌内省端点

查询 token 的有效性、关联用户、scope 等元数据。

```
POST /api/sso/introspect
Content-Type: application/x-www-form-urlencoded
```

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 待查询的 access_token 或 refresh_token |
| `token_type_hint` | 否 | `access_token` 或 `refresh_token`（优化查询） |
| `client_id` | 是 | 客户端 ID |
| `client_secret` | 是 | 客户端密钥 |

**响应示例**（活跃 token）：

```json
{
  "active": true,
  "scope": "openid profile email",
  "client_id": "my-app-client",
  "username": "zhangsan",
  "token_type": "Bearer",
  "exp": 1785055843,
  "iat": 1785054943,
  "sub": "a0000000",
  "aud": "my-app-client"
}
```

**响应字段表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `active` | boolean | token 是否活跃 |
| `scope` | string | 授权的 scope（空格分隔） |
| `client_id` | string | 关联的客户端 ID |
| `username` | string | 关联的用户名 |
| `token_type` | string | `Bearer` |
| `exp` | number | 过期时间戳（Unix 秒） |
| `iat` | number | 签发时间戳（Unix 秒） |
| `sub` | string | 用户唯一 ID |
| `aud` | string | 受众（client_id） |

**响应示例**（非活跃 token）：

```json
{
  "active": false
}
```

> **运维提示（R1-010）**：introspect 端点存在 P2 级缺陷——无 `token_type_hint` 时 refresh_token 返回 `active:false`。运维人员查询 token 状态时**必须携带 `token_type_hint` 参数**避免误判。

**curl 示例**：

```bash
curl -s -X POST https://sso.happyrabbit.top/api/sso/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=$ACCESS_TOKEN" \
  -d "token_type_hint=access_token" \
  -d "client_id=my-app-client" \
  -d "client_secret=$SSO_CLIENT_SECRET"
```

**AI 执行清单**：

- [ ] 查询 refresh_token 状态时**必须**传 `token_type_hint=refresh_token`
- [ ] `active=false` 不一定是 token 无效，可能是 hint 缺失（refresh_token）
- [ ] 不要在请求体中暴露 client_secret 给前端

---

### 3.7 Revoke 令牌撤销端点

撤销 access_token 或 refresh_token。

```
POST /api/sso/revoke
Content-Type: application/x-www-form-urlencoded
```

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | 待撤销的 token |
| `token_type_hint` | 否 | `access_token` 或 `refresh_token` |
| `client_id` | 是 | 客户端 ID |
| `client_secret` | 是 | 客户端密钥 |

**响应**：HTTP 200（无论 token 是否存在，符合 RFC 7009）。

**跨类型扩展查找逻辑**：

- IDP 按 `token_type_hint` 优先查找
- 若 `token_type_hint=access_token` 但验证失败，**跨类型扩展查找 refresh_token**
- 确保任意 refresh_token（原始或轮换后）都能被 revoke

> **已修复（2026-07-26）**：原 P0 级问题"轮换后的 refresh_token 无法被有效 revoke"已修复，revoke 端点现按 RFC 7009 §2.1 根据 `token_type_hint` 分派验证方法，并在 access_token 验证失败时跨类型扩展查找 refresh_token。

**curl 示例**：

```bash
curl -s -X POST https://sso.happyrabbit.top/api/sso/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=$REFRESH_TOKEN" \
  -d "token_type_hint=refresh_token" \
  -d "client_id=my-app-client" \
  -d "client_secret=$SSO_CLIENT_SECRET"
```

**AI 执行清单**：

- [ ] 用户登出时同时 revoke access_token 与 refresh_token
- [ ] revoke 失败不阻断登出流程（前端仍清除本地 token）
- [ ] 响应 200 不代表 token 之前有效（RFC 7009 设计）

---

### 3.8 End Session 登出端点

OIDC RP-Initiated Logout 1.0 实现。

```
GET /api/sso/logout
POST /api/sso/logout
```

**请求参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `id_token_hint` | 否 | 登录时获取的 id_token（用于标识用户与 RP 身份） |
| `client_id` | 否 | RP 客户端 ID（当不提供 `id_token_hint` 时，用于确定 RP 身份） |
| `post_logout_redirect_uri` | 否 | 登出后跳转 URL（必须在客户端白名单内） |
| `state` | 否 | 原样回传的 CSRF 串 |

**身份校验逻辑**（OIDC RP-Initiated Logout 1.0 §5）：

1. 优先从 `id_token_hint` 的 `aud` 字段提取 `client_id`（验签通过后使用）
2. 若 `id_token_hint` 不可用或验签失败，回退到 `client_id` 参数
3. 若提供 `post_logout_redirect_uri` 但无法确定 RP 身份（既无有效 `id_token_hint` 也无 `client_id`）→ 返回 400 `invalid_request`
4. `post_logout_redirect_uri` 必须在客户端 `postLogoutRedirectUris` 白名单内（若该字段为空，回退到 `redirectUris`）

**Content-Type 处理表**（POST 请求）：

| Content-Type | 解析方式 |
|--------------|---------|
| `application/json` | `request.json()` |
| `application/x-www-form-urlencoded` / `multipart/form-data` | `request.formData()` |
| 其他/空 body | 回退到 query params |

**响应**：

| 场景 | 响应 |
|------|------|
| 提供 `post_logout_redirect_uri` 且校验通过 | HTTP 307 跳转到 `post_logout_redirect_uri`（带 state） |
| 未提供 `post_logout_redirect_uri` | HTTP 200 `{success: true}`（清除 cookie，默认登出） |
| 校验失败 | HTTP 400/401 错误响应（清除 cookie） |

**安全说明**：所有 400/401 错误路径均清除 accessToken/refreshToken cookie，确保本地登出语义一致。无效 `id_token_hint` 不阻断流程（仅忽略不用于身份判定），但无法通过它触发开放重定向（重定向必须通过 `client_id` 或有效 `id_token_hint` 完成身份校验）。

**curl 示例**：

```bash
# GET 方式
curl -s "https://sso.happyrabbit.top/api/sso/logout?id_token_hint=$ID_TOKEN&post_logout_redirect_uri=https%3A%2F%2Fmy-app.example.com%2Flogout%2Fdone&state=abc123"

# POST 方式（form）
curl -s -X POST https://sso.happyrabbit.top/api/sso/logout \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "id_token_hint=$ID_TOKEN" \
  -d "post_logout_redirect_uri=https://my-app.example.com/logout/done" \
  -d "state=abc123"
```

**AI 执行清单**：

- [ ] SP 端登出时优先传 `id_token_hint`（最安全）
- [ ] 若无 `id_token_hint`，传 `client_id` + `post_logout_redirect_uri`
- [ ] `post_logout_redirect_uri` 必须在客户端注册的 `postLogoutRedirectUris` 白名单内
- [ ] 处理 307 跳转（携带 state 回传）
- [ ] 登出后清除 SP 本地所有 token cookie

---

### 3.9 PAR 推送授权请求端点（高级）

推送授权请求参数至 IDP，获取 `request_uri`，用于增强授权请求安全性（RFC 9126）。

```
POST /api/sso/par
Content-Type: application/x-www-form-urlencoded
```

**请求参数**：与 §3.2 Authorize 端点相同的所有参数（`client_id`、`redirect_uri`、`response_type`、`scope`、`state`、`code_challenge`、`code_challenge_method`、`nonce` 等）。

**成功响应**（HTTP 201）：

```json
{
  "request_uri": "urn:ietf:params:oauth:request_uri:abc123def456",
  "expires_in": 60
}
```

**响应字段表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_uri` | string | PAR 请求 URI（格式 `urn:ietf:params:oauth:request_uri:<random>`） |
| `expires_in` | number | request_uri 有效期（秒，默认 60） |

**使用方式**：

1. POST 所有 authorize 参数至 `/api/sso/par`，获取 `request_uri`
2. GET `/api/sso/authorize?client_id=<client_id>&request_uri=<request_uri>`（只需这两个参数）
3. IDP 根据 `request_uri` 取回之前推送的参数

**`require_pushed_authorization_requests` 默认值**：

- `false`（opt-in，向后兼容）
- IDP 允许 SP 直接传完整 authorize 参数（不使用 PAR）
- 若 IDP 配置为 `true`，则 SP 必须使用 PAR

**错误码**：

| HTTP | error / SSO_IDP_* | 说明 |
|------|-------------------|------|
| 400 | `SSO_IDP_PAR_INVALID_PARAMS` | 参数校验失败 |
| 400 | `SSO_IDP_PAR_EXPIRED` | request_uri 已过期 |
| 400 | `SSO_IDP_PAR_CLIENT_MISMATCH` | client_id 与推送时不一致 |
| 400 | `SSO_IDP_PAR_ALREADY_USED` | request_uri 已被使用 |
| 500 | `SSO_IDP_PAR_STORE_ERROR` | 存储错误 |

**AI 执行清单**：

- [ ] `request_uri` 一次性使用，使用后立即失效
- [ ] `request_uri` 有效期 60 秒，超时需重新 PAR
- [ ] 在 Authorize 端点用 `request_uri` 替代完整参数
- [ ] Authorize 端点的 `client_id` 必须与 PAR 推送时一致

---

### 3.10 DCR 动态客户端注册端点（高级）

支持动态客户端注册与管理（RFC 7591/7592）。

```
POST /api/sso/register    # 注册新客户端
GET /api/sso/register     # 查询客户端元数据
PUT /api/sso/register     # 更新客户端
DELETE /api/sso/register  # 删除客户端
```

**启用条件**：

- IDP 端必须配置 `SSO_DCR_ENABLED=true`
- 调用 POST 注册时需携带 `SSO_DCR_INITIAL_ACCESS_TOKEN`（Initial Access Token）
- Discovery 中 `registration_endpoint` 字段仅在 DCR 启用时声明

#### POST 注册客户端

**请求头**：

```
Authorization: Bearer <SSO_DCR_INITIAL_ACCESS_TOKEN>
Content-Type: application/json
```

**请求体**：

```json
{
  "client_name": "my-dynamic-app",
  "redirect_uris": ["https://my-app.example.com/auth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile email",
  "token_endpoint_auth_method": "client_secret_post"
}
```

**请求体字段表**：

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `client_name` | 是 | — | 客户端显示名 |
| `redirect_uris` | 是 | — | 回调 URL 白名单 |
| `grant_types` | 否 | `["authorization_code","refresh_token"]` | 允许的 grant_type |
| `response_types` | 否 | `["code"]` | 允许的 response_type |
| `scope` | 否 | `openid profile email` | 允许的 scope |
| `token_endpoint_auth_method` | 否 | `client_secret_post` | 客户端认证方式 |
| `post_logout_redirect_uris` | 否 | — | 登出回调 URL 白名单 |
| `backchannel_logout_uri` | 否 | — | Back-Channel Logout 端点 |

**成功响应**（HTTP 201）：

```json
{
  "client_id": "dynamic-client-xxx",
  "client_secret": "secret-plaintext-only-once",
  "registration_access_token": "rat-xxx",
  "client_id_issued_at": 1785055843,
  "client_secret_expires_at": 0,
  "client_name": "my-dynamic-app",
  "redirect_uris": ["https://my-app.example.com/auth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid profile email",
  "token_endpoint_auth_method": "client_secret_post"
}
```

> **安全提示**：`client_secret` 与 `registration_access_token` 为**明文仅返回一次**，IDP 仅存储其 hash。客户端必须立即保存，丢失后需重新注册。

#### GET 查询客户端元数据

**请求头**：

```
Authorization: Bearer <registration_access_token>
```

**Query 参数**：`client_id`

**响应**：客户端元数据（不含 `client_secret` 与 `registration_access_token`）

#### PUT 更新客户端

**请求头**：`Authorization: Bearer <registration_access_token>`

**请求体**：可更新字段（`client_name`、`redirect_uris`、`grant_types`、`response_types`、`scope`、`post_logout_redirect_uris`、`backchannel_logout_uri`）

> 不可更新字段：`client_id`、`client_secret`、`registration_access_token`

#### DELETE 删除客户端

**请求头**：`Authorization: Bearer <registration_access_token>`

**响应**：HTTP 204

**错误码**：

| HTTP | 错误码 | 说明 |
|------|--------|------|
| 400 | `SSO_IDP_DCR_DISABLED` | DCR 未启用 |
| 400 | `SSO_IDP_DCR_INVALID_REDIRECT_URI` | redirect_uri 校验失败 |
| 409 | `SSO_IDP_DCR_CLIENT_EXISTS` | client_name 已存在 |
| 401 | `SSO_IDP_DCR_INVALID_TOKEN` | Initial Access Token 或 RAT 无效 |
| 400 | `SSO_IDP_DCR_INVALID_CLIENT_METADATA` | 客户端元数据校验失败 |
| 405 | `SSO_IDP_DCR_METHOD_NOT_ALLOWED` | 不支持的 HTTP 方法 |

**curl 示例**：

```bash
# 注册
curl -s -X POST https://sso.happyrabbit.top/api/sso/register \
  -H "Authorization: Bearer $SSO_DCR_INITIAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "my-dynamic-app",
    "redirect_uris": ["https://my-app.example.com/auth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid profile email"
  }'
```

**AI 执行清单**：

- [ ] 确认 IDP 启用了 DCR（Discovery 中存在 `registration_endpoint`）
- [ ] 注册响应中的 `client_secret` 与 `registration_access_token` 仅返回一次，立即保存
- [ ] GET/PUT/DELETE 操作必须通过 `registration_access_token` 认证
- [ ] `client_secret_expires_at=0` 表示不过期

---

## 4. 集成流程

> 每个流程步骤统一包含：输入前置条件、操作动作、预期输出、失败处理、AI 验证清单。

### 4.1 SP-Initiated Authorization Code + PKCE 流程（核心）

#### 时序图

```
┌──────┐         ┌─────┐         ┌──────┐         ┌──────┐
│ User │         │ SP  │         │ IDP  │         │ LDAP │
└──┬───┘         └──┬──┘         └──┬───┘         └──┬───┘
   │ 1. 点击登录    │               │                │
   │──────────────▶│               │                │
   │                │ 2. 生成 PKCE/state             │
   │                │ 保存到 sessionStorage+cookie    │
   │                │               │                │
   │                │ 3. 跳转 authorize              │
   │                │──────────────▶│                │
   │                │               │                │
   │ 4. 登录页       │               │                │
   │◀───────────────────────────────│                │
   │ 5. 提交凭证     │               │                │
   │───────────────────────────────▶│                │
   │                │               │ 6. LDAP 验证   │
   │                │               │───────────────▶│
   │                │               │◀───────────────│
   │                │               │                │
   │ 7. consent 页（首次）          │                │
   │◀───────────────────────────────│                │
   │ 8. 同意授权     │               │                │
   │───────────────────────────────▶│                │
   │                │               │                │
   │                │ 9. 回调 code+state+iss         │
   │                │◀──────────────│                │
   │                │               │                │
   │                │ 10. 校验 state CSRF            │
   │                │ 11. 服务端交换 token           │
   │                │──────────────▶│                │
   │                │               │                │
   │                │ 12. 返回 token │                │
   │                │◀──────────────│                │
   │                │               │                │
   │                │ 13. 验证 id_token              │
   │                │ 14. 设置 httpOnly cookie       │
   │                │               │                │
   │                │ 15. 调用 userinfo             │
   │                │──────────────▶│                │
   │                │ 16. 返回用户信息                │
   │                │◀──────────────│                │
   │                │               │                │
   │ 17. 跳转 returnTo               │                │
   │◀──────────────│               │                │
```

#### 步骤 1：生成 PKCE 与 state

**输入前置条件**：
- SP 已注册客户端，获取 `client_id`
- 已加载 PKCE 生成库（参考 [test-sp/lib/sso-sp/pkce.ts](file:///var/catnetweb/test-sp/lib/sso-sp/pkce.ts)）

**操作动作**：

```typescript
import { generatePKCE, generateRandomString } from '@/lib/sso-sp/pkce';

// 1. 生成 PKCE
const { codeVerifier, codeChallenge } = await generatePKCE();
// code_verifier: ≥ 43 字符的随机串
// code_challenge: BASE64URL(SHA256(code_verifier))

// 2. 生成 state（CSRF 防御）与 nonce（id_token 防重放）
const state = generateRandomString(32);
const nonce = generateRandomString(32);
```

**预期输出**：
- `codeVerifier`（≥ 43 字符）
- `codeChallenge`（43 字符 base64url）
- `state`（32 字符随机串）
- `nonce`（32 字符随机串）

**失败处理**：无（纯本地计算）

**AI 验证清单**：
- [ ] `code_verifier` 长度 ≥ 43 字符
- [ ] `code_challenge` 是 `BASE64URL(SHA256(code_verifier))`
- [ ] `state` 长度 ≥ 32 字符，使用加密随机源

#### 步骤 2：保存 PKCE 与 state 到 sessionStorage + cookie

**输入前置条件**：步骤 1 已完成

**操作动作**：

```typescript
import { savePKCEParams, saveReturnTo } from '@/lib/sso-sp/storage';

// 双写容错：sessionStorage 主，cookie 备份
savePKCEParams(codeVerifier, state);

if (returnTo) {
  saveReturnTo(returnTo);
}
```

**预期输出**：
- sessionStorage 中保存 `sso_pkce_verifier` 与 `sso_oauth_state`
- cookie 中保存 `sso_pkce_verifier` 与 `sso_oauth_state`（httpOnly + sameSite=lax）

**AI 验证清单**：
- [ ] sessionStorage 与 cookie 双写
- [ ] cookie 设置 `sameSite=lax`（防 CSRF）
- [ ] `sso_oauth_state` 与 state 值一致

#### 步骤 3：构造 authorize URL 并跳转

**操作动作**：参考 §3.2 的 TypeScript 示例。

**AI 验证清单**：
- [ ] URL 包含所有必填参数
- [ ] `redirect_uri` 已 URL 编码
- [ ] `scope` 包含 `openid`
- [ ] `code_challenge_method=S256`

#### 步骤 4：处理 callback

**输入前置条件**：
- 用户在 IDP 完成登录与同意
- IDP 跳转回 `redirect_uri?code=...&state=...&iss=...`

**操作动作**：

```typescript
import { handleCallback } from '@/lib/sso-sp/auth';

// 从 URL 提取 code、state
const url = new URL(window.location.href);
const code = url.searchParams.get('code');
const state = url.searchParams.get('state');
const iss = url.searchParams.get('iss');

if (!code || !state) {
  throw new Error('Missing code or state in callback');
}

// 校验 iss（防 IDP 混淆攻击）
const expectedIssuer = process.env.NEXT_PUBLIC_SSO_ISSUER;
if (iss !== expectedIssuer) {
  throw new Error(`iss mismatch: expected ${expectedIssuer}, got ${iss}`);
}

// 调用 handleCallback（内部完成 state CSRF 校验 + token 交换）
const result = await handleCallback(code, state);
if (!result.success) {
  // 错误处理
}
```

**预期输出**：
- access_token、refresh_token、id_token 已保存到 httpOnly cookie
- sessionStorage 与 cookie 中的 PKCE 参数已清除

**失败处理**：

| 错误 | 处置 |
|------|------|
| `iss` 不匹配 | 拒绝登录，跳转错误页（防 IDP 混淆攻击） |
| `state` 不匹配 | 返回 400 `invalid_state`，跳转登录页 |
| `code` 已使用 | IDP 返回 `invalid_grant`，提示用户重新登录 |
| `code` 已过期 | 同上 |

**AI 验证清单**：
- [ ] 校验 `iss` 与 Discovery `issuer` 一致
- [ ] 校验 `state` 与 cookie 中的 `sso_oauth_state` 一致
- [ ] token 交换成功后清除 `sso_oauth_state` cookie（一次性使用）

#### 步骤 5：通过服务端 API Route 交换 token

**操作动作**：参考 §3.3 的 TypeScript 示例。

**关键安全约束**：
- `client_secret` **仅**在服务端 API Route 中使用（`process.env.SSO_CLIENT_SECRET`）
- 前端不直接调用 `/api/sso/token`，通过 SP 后端 API Route 转发

**AI 验证清单**：
- [ ] client_secret 不出现在浏览器 JS bundle
- [ ] API Route 设置 httpOnly + secure + sameSite=lax cookie

#### 步骤 6：验证 id_token（8 步）

**输入前置条件**：token 交换返回 id_token

**操作动作**：参考 [test-sp/lib/sso-sp/id-token.ts](file:///var/catnetweb/test-sp/lib/sso-sp/id-token.ts) 完整实现。

8 步验证逻辑：

| 步骤 | 验证内容 | 失败处置 |
|------|---------|---------|
| 1 | JWT 格式（3 段 base64url，以 `.` 分隔） | 拒绝 |
| 2 | alg 白名单（必须是 `RS256`，拒绝 `none`） | 拒绝 |
| 3 | JWKS kid 匹配（从 JWKS 拉取公钥按 `kid` 匹配） | 刷新 JWKS 后重试 |
| 4 | 签名验证（RSA-SHA256） | 拒绝 |
| 5 | iss 校验（`payload.iss === IDP_ISSUER`） | 拒绝 |
| 6 | aud 校验（`payload.aud` 包含当前 `client_id`） | 拒绝 |
| 7 | exp 校验（`now - clockTolerance <= payload.exp`，建议 tolerance 60 秒） | 拒绝 |
| 8 | nonce 校验（可选，若 authorize 请求传入了 nonce，则必须匹配） | 拒绝 |

```typescript
import { validateIdToken } from '@/lib/sso-sp/id-token';

const result = await validateIdToken(tokens.id_token, {
  issuer: process.env.SSO_ISSUER!,
  clientId: process.env.SSO_CLIENT_ID!,
  nonce, // 若传入了 nonce
  jwksUri: `${process.env.SSO_ISSUER}/api/sso/jwks`,
});

if (!result.valid) {
  throw new Error(`Invalid id_token: ${result.error}`);
}
```

**AI 验证清单**：
- [ ] 8 步验证全部通过
- [ ] 验证失败时（strict 模式）拒绝登录
- [ ] `ID_TOKEN_VERIFY_MODE=strict`（默认）验证失败拒绝；`soft` 模式仅记录日志（不推荐生产）

#### 步骤 7：调用 userinfo 获取用户信息

**操作动作**：

```typescript
import { fetchUserInfo } from '@/lib/sso-sp/auth';

const result = await fetchUserInfo();
if (result.success) {
  const user = result.user;
  // user.sub, user.name, user.email, user.groups, ...
}
```

> `fetchUserInfo` 内部自动处理 401 → refresh_token 续期 → 重试逻辑。

**AI 验证清单**：
- [ ] userinfo 返回的 `sub` 与 id_token 的 `sub` 一致
- [ ] 401 时自动触发 refresh_token 续期
- [ ] refresh 失败跳转登录页

#### 步骤 8：保存 token 到 httpOnly cookie

**操作动作**：在服务端 API Route 中完成（参考 §3.3 的 TypeScript 示例）。

**Cookie 配置**：

| Cookie 名 | 用途 | maxAge | httpOnly | secure | sameSite |
|----------|------|--------|----------|--------|----------|
| `sso_access_token` | access_token | 900 秒（15 分钟） | true | true（生产） | lax |
| `sso_refresh_token` | refresh_token | 30 天 | true | true（生产） | lax |
| `sso_id_token` | id_token | 30 天 | true | true（生产） | lax |

**AI 验证清单**：
- [ ] 所有 token cookie 设置 `httpOnly: true`
- [ ] 生产环境 `secure: true`
- [ ] `sameSite: 'lax'`（防 CSRF）
- [ ] access_token maxAge 与 `expires_in` 一致

---

### 4.2 Token 续期（Refresh Token Rotation）

**触发条件**：
- access_token 即将过期（建议提前 60 秒触发）
- 调用 userinfo 或受保护资源返回 401

**流程步骤**：

1. SP 后端调用 `/api/sso/token` with `grant_type=refresh_token`
2. IDP 校验 refresh_token 有效性
3. IDP 返回新的 access_token + 新的 refresh_token
4. **旧 refresh_token 立即失效**
5. SP 立即用新 refresh_token 替换旧值

```typescript
const response = await fetch(`${process.env.SSO_ISSUER}/api/sso/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: oldRefreshToken,
    client_id: process.env.SSO_CLIENT_ID!,
    client_secret: process.env.SSO_CLIENT_SECRET!,
  }),
});

const newTokens = await response.json();
// ⚠️ oldRefreshToken 已失效，必须立即用 newTokens.refresh_token 替换
```

**轮换规则**：

1. 每次使用 refresh_token 后，旧 token 立即失效
2. 响应返回新的 refresh_token
3. 客户端必须立即替换旧值
4. 检测到已撤销的 refresh_token 被重放时，**自动撤销该用户的所有会话和 token**（安全告警，防 token 窃取）

**失败处理**：

| 错误 | 处置 |
|------|------|
| `invalid_grant`（refresh_token 无效或已撤销） | 清除本地会话，跳转登录页 |
| `invalid_client` | 检查 client_id/client_secret 配置 |
| 429 | 等待 `Retry-After` 秒后重试 |

**AI 验证清单**：

- [ ] refresh 后立即用新 refresh_token 替换旧值
- [ ] 检测到 `invalid_grant` 时清除所有本地 token
- [ ] 不要并发触发多个 refresh 请求（防 race condition）

---

### 4.3 Token 撤销与登出

#### 4.3.1 SP-Initiated Logout

**流程步骤**：

1. 用户点击 SP 端"登出"按钮
2. SP 后端调用 `/api/sso/revoke` 撤销 access_token 与 refresh_token
3. SP 端清除本地所有 token cookie
4. 跳转 IDP `/api/sso/logout` 完成 IDP 端登出
5. IDP 跳转回 SP `post_logout_redirect_uri`

```typescript
// 1. 撤销 token
await fetch(`${process.env.SSO_ISSUER}/api/sso/revoke`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: process.env.SSO_CLIENT_ID!,
    client_secret: process.env.SSO_CLIENT_SECRET!,
  }),
});

// 2. 清除本地 cookie
clearAuthData();

// 3. 跳转 IDP 登出
const logoutUrl = new URL(`${process.env.NEXT_PUBLIC_SSO_ISSUER}/api/sso/logout`);
logoutUrl.searchParams.set('id_token_hint', idToken);
logoutUrl.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/logout/done`);
logoutUrl.searchParams.set('state', generateRandomString(16));
window.location.href = logoutUrl.toString();
```

#### 4.3.2 IdP-Initiated Logout（Back-Channel Logout）

参考 §4.7 实现 Back-Channel Logout 端点。

**AI 验证清单**：

- [ ] 登出时同时 revoke access_token 与 refresh_token
- [ ] 清除 SP 本地所有 token cookie
- [ ] 跳转 IDP `/api/sso/logout` 携带 `id_token_hint`
- [ ] `post_logout_redirect_uri` 在客户端白名单内

---

### 4.4 IdP-Initiated SSO 处理（高级）

**场景说明**：IDP 主动发起登录（如用户在 IDP 门户点击 SP 图标），不携带 SP 生成的 `code_verifier` 与 `state`。

**处理逻辑**：

1. IDP 跳转至 SP 的 `redirect_uri`，携带 `code`、`state`（IDP 生成）、`target_url`（可选）
2. SP callback 处理：
   - 从 sessionStorage/cookie 找不到 `code_verifier`（state 不匹配）
   - **不发送 `code_verifier`**，由 IDP 决定是否接受
   - 依赖 IDP 客户端配置允许无 PKCE 的授权码交换
3. target_url 规范化（防开放重定向）

**参考实现**：[test-sp/lib/sso-sp/auth.ts:94-172](file:///var/catnetweb/test-sp/lib/sso-sp/auth.ts)

```typescript
// 从 URL 提取 target_url
const rawTarget = searchParams.get('target_url') || searchParams.get('target_link_uri');
const normalizedTarget = normalizeTargetUrl(rawTarget);
// normalizedTarget 仅允许同源相对路径，拒绝跨域 URL
if (normalizedTarget) {
  saveReturnTo(normalizedTarget);
}

// 登录成功后跳转
const returnTo = getReturnTo();
clearReturnTo();
const safePath = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
router.push(safePath);
```

**AI 验证清单**：

- [ ] IdP-Initiated 场景下不强制 `code_verifier`
- [ ] `target_url` 必须规范化为同源相对路径
- [ ] 拒绝协议相对 URL（`//evil.com`）、跨域 URL、`javascript:` / `data:` 协议
- [ ] 跳转前再次校验路径以 `/` 开头且非 `//`

---

### 4.5 DPoP 集成（高级）

**场景说明**：发送者约束令牌（RFC 9449），将 access_token 绑定到客户端持有的密钥对，防止 token 被窃取后滥用。

**支持算法**：`RS256`、`ES256`、`PS256`（白名单，拒绝 `none` 与 `HS*`）

**集成步骤**：

#### 步骤 1：生成 DPoP 密钥对

```typescript
import { generateKeyPair, exportJWK } from 'jose';

// 生成 ES256 密钥对（推荐）
const { publicKey, privateKey } = await generateKeyPair('ES256');
const publicJwk = await exportJWK(publicKey);
```

#### 步骤 2：计算 DPoP 公钥 thumbprint（jkt）

```typescript
import { calculateJwkThumbprint } from 'jose';

const jkt = await calculateJwkThumbprint(publicJwk, 'sha256');
```

#### 步骤 3：在 Authorize 请求中传 `dpop_jkt`

```typescript
authUrl.searchParams.set('dpop_jkt', jkt);
// IDP 将 jkt 绑定到生成的授权码
```

#### 步骤 4：构造 DPoP Proof JWT

DPoP Proof 是一个短期 JWT，包含：

- Header：`typ: "dpop+jwt"`、`alg: <签名算法>`、`jwk: <公钥>`
- Payload：`htm`（HTTP 方法）、`htu`（URL 不含 query 与 fragment）、`iat`（签发时间）、`jti`（唯一 ID）、`ath`（access_token 的 base64url(SHA256)）

```typescript
import { SignJWT } from 'jose';

async function createDpopProof(
  htm: string,
  htu: string,
  accessToken?: string
): Promise<string> {
  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = { htm, htu, iat, jti };
  if (accessToken) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(accessToken));
    const ath = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    payload.ath = ath;
  }

  return await new SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey);
}
```

#### 步骤 5：在 Token/UserInfo 请求中传 DPoP 头

```typescript
const dpopProof = await createDpopProof('POST', `${issuer}/api/sso/token`);

const response = await fetch(`${issuer}/api/sso/token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    DPoP: dpopProof,
  },
  body: new URLSearchParams({ /* ... */ }),
});
```

**错误处理**：

| 错误码 | 触发场景 | 处置 |
|--------|---------|------|
| `SSO_IDP_DPOP_INVALID_PROOF` | Proof JWT 格式错误或签名失败 | 检查 Proof 构造 |
| `SSO_IDP_DPOP_MISSING_JWK` | Header 缺少 `jwk` | 补充 `jwk` 字段 |
| `SSO_IDP_DPOP_HTM_HTU_MISMATCH` | `htm` 或 `htu` 与请求不一致 | 修正 `htm` / `htu` |
| `SSO_IDP_DPOP_JTI_REPLAY` | `jti` 已被使用 | 重新生成 `jti` |
| `SSO_IDP_DPOP_BIND_MISMATCH` | access_token 未绑定到当前 DPoP key | 检查 `dpop_jkt` 与 `jkt` 一致 |
| `SSO_IDP_DPOP_DISABLED` | IDP 未启用 DPoP | 检查 `SSO_DPOP_ENABLED` 配置 |

**AI 验证清单**：

- [ ] DPoP key 仅在浏览器端生成与持有（私钥不离开客户端）
- [ ] `dpop_jkt` 与 Proof 中的 `jwk` 计算的 thumbprint 一致
- [ ] `htm` 与实际 HTTP 方法一致（区分大小写）
- [ ] `htu` 不含 query 与 fragment
- [ ] `jti` 一次性使用，每次生成新值
- [ ] `ath` 是 access_token 的 base64url(SHA256)

---

### 4.6 PAR 集成（高级）

**场景说明**：增强授权请求安全性，避免参数通过浏览器暴露（RFC 9126）。

**集成步骤**：

1. POST 所有 authorize 参数至 `/api/sso/par`，获取 `request_uri`
2. GET `/api/sso/authorize?client_id=<client_id>&request_uri=<request_uri>`
3. IDP 根据 `request_uri` 取回参数并处理

```typescript
// 1. PAR 推送
const parResponse = await fetch(`${issuer}/api/sso/par`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, // 客户端认证
  },
  body: new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: defaultScope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  }),
});

const { request_uri } = await parResponse.json();

// 2. 跳转 authorize（仅传 client_id 与 request_uri）
const authUrl = new URL(`${issuer}/api/sso/authorize`);
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('request_uri', request_uri);
window.location.href = authUrl.toString();
```

**AI 验证清单**：

- [ ] `request_uri` 一次性使用
- [ ] `request_uri` 有效期 60 秒
- [ ] Authorize 端点的 `client_id` 必须与 PAR 推送时一致
- [ ] `require_pushed_authorization_requests=false` 时 PAR 是可选的

---

### 4.7 Back-Channel Logout 处理（高级）

**场景说明**：IDP 主动通知 SP 用户登出（OIDC Back-Channel Logout 1.0），通过后端 HTTP 通信而非浏览器，比 Front-Channel Logout 更可靠。

**端点配置**：

- 客户端注册时设置 `backchannelLogoutUri`（HTTPS URL，如 `https://my-app.example.com/api/backchannel-logout`）
- IDP 在用户登出时向所有有效 `backchannelLogoutUri` 推送 Logout Token

**Logout Token 验证**（OIDC Back-Channel Logout §4）：

| 验证步骤 | 说明 |
|---------|------|
| 1 | JWT 格式正确 |
| 2 | `iss` 与 IDP issuer 一致 |
| 3 | `aud` 包含当前 `client_id` |
| 4 | `iat` 签发时间合理（防重放） |
| 5 | `sub` 或 `sid` 至少一个存在 |
| 6 | `jti` 唯一（用于防重放，建议缓存 5 分钟） |
| 7 | `events` 字段包含 `http://schemas.openid.net/event/backchannel-logout` |
| 8 | **不含 `nonce`**（OIDC 规范要求） |
| 9 | 签名验证（RS256，使用 JWKS 公钥） |

**实现示例**：

```typescript
// app/api/backchannel-logout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(new URL(`${process.env.SSO_ISSUER}/api/sso/jwks`));

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const logoutToken = formData.get('logout_token') as string;

  if (!logoutToken) {
    return NextResponse.json({ error: 'missing_logout_token' }, { status: 400 });
  }

  try {
    const { payload } = await jwtVerify(logoutToken, JWKS, {
      issuer: process.env.SSO_ISSUER,
      audience: process.env.SSO_CLIENT_ID,
      algorithms: ['RS256'],
    });

    // 验证 events 字段
    const events = payload.events as Record<string, unknown>;
    if (!events || !events['http://schemas.openid.net/event/backchannel-logout']) {
      return NextResponse.json({ error: 'invalid_events' }, { status: 400 });
    }

    // 验证不含 nonce（OIDC 规范要求）
    if (payload.nonce) {
      return NextResponse.json({ error: 'invalid_nonce' }, { status: 400 });
    }

    // 提取 sub 或 sid
    const sub = payload.sub as string | undefined;
    const sid = payload.sid as string | undefined;
    if (!sub && !sid) {
      return NextResponse.json({ error: 'missing_sub_or_sid' }, { status: 400 });
    }

    // 防重放：检查 jti
    const jti = payload.jti as string;
    // TODO: 检查 jti 是否在最近 5 分钟内已使用

    // 撤销本地会话
    if (sub) {
      await revokeLocalSessionBySub(sub);
    } else if (sid) {
      await revokeLocalSessionBySid(sid);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_logout_token', error_description: err instanceof Error ? err.message : 'unknown' },
      { status: 400 }
    );
  }
}
```

**AI 验证清单**：

- [ ] 端点必须使用 HTTPS（生产环境）
- [ ] 验证 Logout Token 签名（RS256）
- [ ] 验证 `events` 字段包含 backchannel-logout 事件
- [ ] 验证不含 `nonce`
- [ ] `sub` 或 `sid` 至少一个存在
- [ ] `jti` 防重放（建议缓存 5 分钟）
- [ ] 响应 200 表示已处理（即使会话不存在）
- [ ] 端点必须快速响应（< 5 秒，IDP 通常有超时）

---

## 5. 安全要求

### 5.1 PKCE 强制

- 所有 SP-Initiated 流程**必须**使用 PKCE（`code_challenge_method=S256`）
- `code_verifier` 应同时保存到 sessionStorage 和 cookie（容错）
- IdP-Initiated 场景允许缺失 `code_verifier`，由 IDP 决定是否接受

### 5.2 State CSRF 防御

- authorize 请求**必须**携带随机 `state`（≥ 32 字符）
- SP 后端**必须**校验 state 与 cookie 一致性
- state 一次性使用，token 交换成功后立即清除 cookie

### 5.3 id_token 验证 8 步

参考 §4.1 步骤 6。验证失败时：
- `strict` 模式（默认）：拒绝登录
- `soft` 模式：仅记录日志（不推荐生产）

### 5.4 Cookie 安全标志

```
httpOnly: true          // 防 XSS 读取
secure: true            // 仅 HTTPS 传输（生产）
sameSite: 'lax'         // 防 CSRF
maxAge: 900             // access_token: 15 分钟
```

### 5.5 开放重定向防御

- SP 处理 `target_url` / `target_link_uri` 时**必须**规范化为同源相对路径
- 拒绝协议相对 URL（`//evil.com`）、跨域 URL、`javascript:` / `data:` 协议
- 即使 `sso_return_to` 已存储，跳转前**必须再次**校验路径以 `/` 开头且非 `//`

参考实现：[test-sp/lib/sso-sp/target-url.ts](file:///var/catnetweb/test-sp/lib/sso-sp/target-url.ts)

### 5.6 Refresh Token 轮换处理

- 每次使用后立即失效旧 refresh_token
- 客户端**必须立即**用新 refresh_token 替换旧值
- 检测到已撤销 refresh_token 被重放时，**自动撤销该用户的所有会话**

### 5.7 client_secret 保护

- `client_secret` **必须**仅在服务端使用（`SSO_CLIENT_SECRET`）
- **禁止**使用 `NEXT_PUBLIC_SSO_CLIENT_SECRET`（会被打入浏览器 bundle）
- 前端代码**不得**直接调用 `/api/sso/token`，必须通过 SP 后端 API Route 转发

### 5.8 速率限制处理

- 所有 SSO 端点均受速率限制
- 触发时返回 429 + `Retry-After` 头
- 客户端应实现指数退避重试

---

## 6. 错误处理

### 6.1 OAuth/OIDC 标准错误码

| error | HTTP | 触发场景 |
|-------|------|---------|
| `invalid_request` | 400 | 缺少必需参数、参数格式错误 |
| `invalid_client` | 401 | client_id 不存在 / client_secret 不匹配 / redirect_uri 不匹配 |
| `invalid_grant` | 400 | authorization code 无效/过期/已使用 / refresh_token 无效 |
| `invalid_scope` | 400 | scope 不在 allowed_scopes 内 / 缺少 openid |
| `invalid_state` | 400 | state 与 cookie 不匹配（CSRF 防御，SP 端） |
| `invalid_token` | 401 | access_token 缺失/无效/过期（userinfo 端点） |
| `invalid_id_token` | 401 | id_token 验证失败（strict 模式） |
| `unsupported_grant_type` | 400 | grant_type 不支持 |
| `unsupported_response_type` | 302 | response_type 不是 `code` |
| `server_error` | 500 | 内部错误 |
| `session_expired` | 401 | 会话过期（自动 refresh 失败后） |

### 6.2 项目自定义错误码（SSO_IDP_*）

#### 授权码服务错误

| 错误码 | 说明 |
|--------|------|
| `SSO_CODE_CREATE_FAILED` | 授权码创建失败 |
| `SSO_CODE_VALIDATE_INVALID` | 授权码无效 |
| `SSO_CODE_VALIDATE_EXPIRED` | 授权码已过期 |
| `SSO_CODE_VALIDATE_CLIENT_MISMATCH` | 授权码与客户端不匹配 |
| `SSO_CODE_VALIDATE_REDIRECT_URI_MISMATCH` | redirect_uri 不匹配 |
| `SSO_CODE_VALIDATE_PKCE_VERIFIER_REQUIRED` | 缺少 code_verifier |
| `SSO_CODE_VALIDATE_PKCE_VERIFICATION_FAILED` | PKCE 验证失败 |
| `SSO_CODE_CONSUME_FAILED` | 授权码消费失败 |

#### 用户信息错误

| 错误码 | 说明 |
|--------|------|
| `SSO_USER_INFO_NOT_FOUND` | 用户信息未找到 |
| `SSO_USER_INFO_LDAP_ERROR` | LDAP 查询错误 |

#### 客户端管理错误

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_INFO_FETCH_FAILED` | IDP 信息获取失败 |
| `SSO_CLIENT_LIST_FAILED` | 客户端列表查询失败 |
| `SSO_CLIENT_INVALID_INPUT` | 客户端输入无效 |
| `SSO_CLIENT_CREATE_FAILED` | 客户端创建失败 |
| `SSO_CLIENT_NOT_FOUND` | 客户端未找到 |
| `SSO_CLIENT_DELETE_FAILED` | 客户端删除失败 |
| `SSO_CLIENT_RESET_FAILED` | 客户端重置失败 |
| `SSO_CLIENT_UPDATE_FAILED` | 客户端更新失败 |

#### 同意（Consent）错误

| 错误码 | 说明 |
|--------|------|
| `SSO_VALIDATION_ERROR` | 验证错误 |
| `SSO_CONSENT_EXPIRED` | 同意已过期 |
| `SSO_CONSENT_USER_MISMATCH` | 同意与用户不匹配 |
| `SSO_SERVER_ERROR` | 服务器错误 |

#### IdP-Initiated SSO 错误

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_INITIATED_CLIENT_NOT_FOUND` | 客户端未找到 |
| `SSO_IDP_INITIATED_CLIENT_INACTIVE` | 客户端未启用 |
| `SSO_IDP_INITIATED_MISSING_CLIENT_ID` | 缺少 client_id |
| `SSO_IDP_IDP_INITIATED_NO_REDIRECT_URI` | 缺少 redirect_uri |

#### Back-Channel Logout 错误（FR-002）

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_BACKCHANNEL_LOGOUT_PUSH_FAILED` | Logout Token 推送失败 |
| `SSO_IDP_BACKCHANNEL_LOGOUT_TOKEN_SIGN_FAILED` | Logout Token 签名失败 |
| `SSO_IDP_BACKCHANNEL_LOGOUT_NO_SESSION` | 无对应会话 |
| `SSO_IDP_SESSION_REGISTRY_ERROR` | 会话注册表错误 |

#### PAR 错误（FR-007）

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_PAR_INVALID_PARAMS` | 参数校验失败 |
| `SSO_IDP_PAR_EXPIRED` | request_uri 已过期 |
| `SSO_IDP_PAR_CLIENT_MISMATCH` | client_id 不一致 |
| `SSO_IDP_PAR_ALREADY_USED` | request_uri 已使用 |
| `SSO_IDP_PAR_STORE_ERROR` | 存储错误 |

#### 密钥轮换错误（FR-004）

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_KEY_ROTATION_IN_PROGRESS` | 密钥轮换进行中 |
| `SSO_IDP_KEY_NOT_FOUND` | 密钥未找到 |
| `SSO_IDP_KEYSTORE_UNAVAILABLE` | 密钥库不可用 |
| `SSO_IDP_KEY_JWKS_PROPAGATION_TIMEOUT` | JWKS 传播超时 |
| `SSO_IDP_KEY_RETIRE_TOO_EARLY` | 密钥退役过早 |

#### DCR 错误（FR-005）

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_DCR_DISABLED` | DCR 未启用 |
| `SSO_IDP_DCR_INVALID_REDIRECT_URI` | redirect_uri 校验失败 |
| `SSO_IDP_DCR_CLIENT_EXISTS` | client_name 已存在 |
| `SSO_IDP_DCR_INVALID_TOKEN` | Initial Access Token 或 RAT 无效 |
| `SSO_IDP_DCR_INVALID_CLIENT_METADATA` | 客户端元数据校验失败 |
| `SSO_IDP_DCR_METHOD_NOT_ALLOWED` | 不支持的 HTTP 方法 |

#### DPoP 错误（FR-006）

| 错误码 | 说明 |
|--------|------|
| `SSO_IDP_DPOP_INVALID_PROOF` | Proof JWT 格式错误或签名失败 |
| `SSO_IDP_DPOP_MISSING_JWK` | Header 缺少 jwk |
| `SSO_IDP_DPOP_HTM_HTU_MISMATCH` | htm 或 htu 与请求不一致 |
| `SSO_IDP_DPOP_JTI_REPLAY` | jti 已被使用 |
| `SSO_IDP_DPOP_BIND_MISMATCH` | access_token 未绑定到当前 DPoP key |
| `SSO_IDP_DPOP_DISABLED` | IDP 未启用 DPoP |

### 6.3 HTTP 状态码使用规范

| HTTP | 用途 |
|------|------|
| 200 | 成功（GET / POST） |
| 201 | 资源创建成功（DCR POST） |
| 204 | 删除成功（DCR DELETE） |
| 302 | 重定向（Authorize 成功 / 重定向错误） |
| 307 | 临时重定向（End Session 跳转） |
| 400 | 请求参数错误 |
| 401 | 认证失败（client_secret 不匹配 / access_token 无效） |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 405 | 方法不允许 |
| 429 | 速率限制 |
| 500 | 服务器内部错误 |

### 6.4 速率限制响应格式

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "error": "too_many_requests",
  "error_description": "Rate limit exceeded. Retry after 60 seconds.",
  "retry_after": 60
}
```

| 端点 | 默认限制 |
|------|---------|
| `/api/sso/authorize` | 按 client_id + IP 限制 |
| `/api/sso/token` | 按 client_id + IP 限制 |
| `/api/sso/userinfo` | 按 IP 限制 |

### 6.5 错误恢复策略

| 错误类型 | 恢复策略 |
|---------|---------|
| 网络错误（5xx / timeout） | 指数退避重试（最多 3 次） |
| 401 invalid_token | 尝试 refresh_token 续期，失败跳转登录 |
| 401 invalid_client | 检查 client_id/client_secret 配置，不重试 |
| 400 invalid_grant | 清除本地会话，跳转登录 |
| 429 too_many_requests | 等待 `Retry-After` 秒后重试 |
| DPoP jti replay | 重新生成 jti，重新发起请求 |

---

## 7. 集成验证

### 7.1 集成验证清单（按流程分组）

#### 7.1.1 SP-Initiated Authorization Code + PKCE 流程

- [ ] **V-001**：Discovery 端点返回 200，`issuer` 与预期 `ISSUER_URL` 一致
- [ ] **V-002**：Discovery 中 `response_types_supported` 包含 `code`
- [ ] **V-003**：Discovery 中 `code_challenge_methods_supported` 仅含 `S256`
- [ ] **V-004**：生成的 `code_verifier` 长度 ≥ 43 字符
- [ ] **V-005**：`code_challenge` 等于 `BASE64URL(SHA256(code_verifier))`
- [ ] **V-006**：`state` 长度 ≥ 32 字符
- [ ] **V-007**：authorize 请求包含所有必填参数
- [ ] **V-008**：authorize 成功返回 302 + code + state + iss
- [ ] **V-009**：回传的 `state` 与本地保存一致
- [ ] **V-010**：回传的 `iss` 与 Discovery `issuer` 一致
- [ ] **V-011**：token 交换成功返回 access_token + id_token
- [ ] **V-012**：scope 含 `offline_access` 时返回 refresh_token
- [ ] **V-013**：id_token 验证 8 步全部通过
- [ ] **V-014**：userinfo 返回的 `sub` 与 id_token `sub` 一致
- [ ] **V-015**：access_token cookie 设置 `httpOnly + secure + sameSite=lax`

#### 7.1.2 Refresh Token Rotation

- [ ] **V-016**：refresh_token grant 返回新的 access_token + 新的 refresh_token
- [ ] **V-017**：旧 refresh_token 立即失效（重放触发 `invalid_grant`）
- [ ] **V-018**：客户端立即用新 refresh_token 替换旧值

#### 7.1.3 Token 撤销与登出

- [ ] **V-019**：revoke 端点返回 HTTP 200（无论 token 是否存在）
- [ ] **V-020**：revoke refresh_token 后，token 交换返回 `invalid_grant`
- [ ] **V-021**：End Session 跳转回 `post_logout_redirect_uri`（携带 state）
- [ ] **V-022**：登出后所有 token cookie 已清除

#### 7.1.4 IdP-Initiated SSO

- [ ] **V-023**：IdP-Initiated 场景下不发送 `code_verifier` 也能完成 token 交换
- [ ] **V-024**：`target_url` 规范化为同源相对路径
- [ ] **V-025**：协议相对 URL（`//evil.com`）被拒绝
- [ ] **V-026**：跨域 URL 被拒绝
- [ ] **V-027**：`javascript:` / `data:` 协议被拒绝

#### 7.1.5 DPoP（高级）

- [ ] **V-028**：DPoP Proof 通过 IDP 校验
- [ ] **V-029**：`dpop_jkt` 与 Proof 中 `jwk` 计算的 thumbprint 一致
- [ ] **V-030**：`htm` 与实际 HTTP 方法一致
- [ ] **V-031**：`htu` 不含 query 与 fragment
- [ ] **V-032**：access_token 绑定到 DPoP key（无 Proof 调用 userinfo 返回 401）

#### 7.1.6 PAR（高级）

- [ ] **V-033**：PAR 端点返回 `request_uri` + `expires_in`
- [ ] **V-034**：`request_uri` 一次性使用
- [ ] **V-035**：`request_uri` 有效期 60 秒
- [ ] **V-036**：Authorize 端点接受 `request_uri` 模式

#### 7.1.7 Back-Channel Logout（高级）

- [ ] **V-037**：Logout Token 签名验证通过
- [ ] **V-038**：`events` 字段包含 `http://schemas.openid.net/event/backchannel-logout`
- [ ] **V-039**：Logout Token 不含 `nonce`
- [ ] **V-040**：`sub` 或 `sid` 至少一个存在
- [ ] **V-041**：处理成功后撤销本地会话
- [ ] **V-042**：端点响应 200（即使会话不存在）

### 7.2 自动化测试脚本

#### 7.2.1 连通性测试（curl）

```bash
#!/bin/bash
# sso-integration-smoke-test.sh

set -euo pipefail

ISSUER="${SSO_ISSUER:-https://sso.happyrabbit.top}"
CLIENT_ID="${SSO_CLIENT_ID:?missing SSO_CLIENT_ID}"
CLIENT_SECRET="${SSO_CLIENT_SECRET:?missing SSO_CLIENT_SECRET}"
REDIRECT_URI="${SSO_REDIRECT_URI:?missing SSO_REDIRECT_URI}"

echo "=== V-001: Discovery 端点 ==="
DISCOVERY=$(curl -s "$ISSUER/.well-known/openid-configuration")
echo "$DISCOVERY" | jq -r '.issuer'
test "$(echo "$DISCOVERY" | jq -r '.issuer')" = "$ISSUER" && echo "✅ V-001 pass" || { echo "❌ V-001 fail"; exit 1; }

echo "=== V-002: response_types_supported 含 code ==="
test "$(echo "$DISCOVERY" | jq -r '.response_types_supported[]')" = "code" && echo "✅ V-002 pass" || { echo "❌ V-002 fail"; exit 1; }

echo "=== V-003: code_challenge_methods_supported 仅含 S256 ==="
test "$(echo "$DISCOVERY" | jq -r '.code_challenge_methods_supported | length')" = "1" && \
test "$(echo "$DISCOVERY" | jq -r '.code_challenge_methods_supported[0]')" = "S256" && echo "✅ V-003 pass" || { echo "❌ V-003 fail"; exit 1; }

echo "=== V-019: JWKS 端点 ==="
JWKS=$(curl -s "$ISSUER/api/sso/jwks")
test "$(echo "$JWKS" | jq -r '.keys | length')" -ge 1 && echo "✅ V-019 pass" || { echo "❌ V-019 fail"; exit 1; }

echo "=== client_credentials grant 测试 ==="
TOKEN_RESPONSE=$(curl -s -X POST "$ISSUER/api/sso/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "scope=scim")

echo "$TOKEN_RESPONSE" | jq .
test -n "$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')" && echo "✅ client_credentials pass" || { echo "❌ client_credentials fail"; exit 1; }

echo "=== 全部连通性测试通过 ==="
```

#### 7.2.2 完整授权流程测试（Node.js）

```typescript
// tests/sso-integration.spec.ts
import { describe, it, expect } from 'vitest';
import { generatePKCE, generateRandomString } from '@/lib/sso-sp/pkce';

describe('SSO IDP 集成完整流程', () => {
  it('V-004: code_verifier 长度 >= 43', async () => {
    const { codeVerifier } = await generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('V-005: code_challenge = BASE64URL(SHA256(code_verifier))', async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const expected = await sha256Base64Url(codeVerifier);
    expect(codeChallenge).toBe(expected);
  });

  it('V-006: state 长度 >= 32', () => {
    const state = generateRandomString(32);
    expect(state.length).toBeGreaterThanOrEqual(32);
  });
});
```

### 7.3 与 IDP 的连通性测试

最小连通性测试矩阵：

| 测试项 | 端点 | 预期 |
|--------|------|------|
| Discovery 可达 | `GET /.well-known/openid-configuration` | 200 + 完整字段 |
| JWKS 可达 | `GET /api/sso/jwks` | 200 + keys 数组非空 |
| client_credentials 工作 | `POST /api/sso/token` grant_type=client_credentials | 200 + access_token |
| Authorize 重定向 | `GET /api/sso/authorize?...` | 302 + Location 含 code/state/iss |
| Token 交换工作 | `POST /api/sso/token` grant_type=authorization_code | 200 + access_token + id_token |
| UserInfo 工作 | `GET /api/sso/userinfo` Authorization: Bearer | 200 + sub 字段 |

### 7.4 错误场景测试矩阵

| 错误码 | 触发方式 | 预期响应 |
|--------|---------|---------|
| `invalid_client` | 错误的 client_secret | 401 + `{"error":"invalid_client"}` |
| `invalid_grant` | 已使用的 authorization code | 400 + `{"error":"invalid_grant"}` |
| `invalid_scope` | scope 不含 `openid` | 302 + `?error=invalid_scope` |
| `unsupported_response_type` | response_type=token | 302 + `?error=unsupported_response_type` |
| `invalid_token` | 无效 access_token 调用 userinfo | 401 + `WWW-Authenticate: Bearer error="invalid_token"` |
| `too_many_requests` | 高频请求 | 429 + `Retry-After` 头 |

### 7.5 安全验证清单

- [ ] **S-001**：PKCE 强制（`code_challenge_method=S256`）
- [ ] **S-002**：state CSRF 校验（cookie 比对）
- [ ] **S-003**：id_token 验证 8 步
- [ ] **S-004**：access_token cookie `httpOnly + secure + sameSite=lax`
- [ ] **S-005**：`target_url` 规范化（拒绝跨域、协议相对、`javascript:`/`data:`）
- [ ] **S-006**：refresh_token 轮换（旧 token 立即失效）
- [ ] **S-007**：`client_secret` 不出现在浏览器 JS bundle
- [ ] **S-008**：`iss` 参数校验（防 IDP 混淆攻击）
- [ ] **S-009**：JWKS 公钥按 `kid` 匹配（防 key 轮换失效）
- [ ] **S-010**：429 速率限制响应处理

---

## 8. 参考实现

### 8.1 test-sp 项目结构

[`test-sp/`](file:///var/catnetweb/test-sp/) 是项目内置的参考 SP 实现，AI Agent 可直接参考或复用：

```
test-sp/
├── lib/sso-sp/
│   ├── config.ts        # SSO 配置（环境变量读取）
│   ├── auth.ts          # 客户端入口（login/handleCallback/fetchUserInfo/refreshToken/revokeToken）
│   ├── pkce.ts          # PKCE 生成（code_verifier/code_challenge/state/nonce）
│   ├── storage.ts       # 存储管理（sessionStorage + cookie 双写）
│   ├── id-token.ts      # id_token 验证 8 步
│   └── target-url.ts    # target_url 规范化（防开放重定向）
├── app/
│   ├── api/auth/sso/route.ts          # 服务端 API Route（保护 client_secret）
│   └── auth/callback/callback-content.tsx  # callback 页面组件
├── tests/
│   ├── e2e-tests/specs/               # E2E 测试场景
│   └── global-setup.ts                # 测试环境校验
├── .env.example                       # 环境变量模板
└── playwright.config.ts               # Playwright 配置
```

### 8.2 关键代码位置清单

| 用途 | 文件路径 |
|------|---------|
| PKCE 生成 | [test-sp/lib/sso-sp/pkce.ts](file:///var/catnetweb/test-sp/lib/sso-sp/pkce.ts) |
| 客户端配置 | [test-sp/lib/sso-sp/config.ts](file:///var/catnetweb/test-sp/lib/sso-sp/config.ts) |
| 存储管理 | [test-sp/lib/sso-sp/storage.ts](file:///var/catnetweb/test-sp/lib/sso-sp/storage.ts) |
| id_token 验证 | [test-sp/lib/sso-sp/id-token.ts](file:///var/catnetweb/test-sp/lib/sso-sp/id-token.ts) |
| target_url 规范化 | [test-sp/lib/sso-sp/target-url.ts](file:///var/catnetweb/test-sp/lib/sso-sp/target-url.ts) |
| 客户端入口流程 | [test-sp/lib/sso-sp/auth.ts](file:///var/catnetweb/test-sp/lib/sso-sp/auth.ts) |
| 服务端 API Route | [test-sp/app/api/auth/sso/route.ts](file:///var/catnetweb/test-sp/app/api/auth/sso/route.ts) |
| callback 页面 | [test-sp/app/auth/callback/callback-content.tsx](file:///var/catnetweb/test-sp/app/auth/callback/callback-content.tsx) |
| 环境变量模板 | [test-sp/.env.example](file:///var/catnetweb/test-sp/.env.example) |
| E2E 测试场景 | [test-sp/tests/e2e-tests/specs/](file:///var/catnetweb/test-sp/tests/e2e-tests/specs/) |

### 8.3 可直接复用的工具函数清单

| 工具函数 | 来源 | 可复用性 | 说明 |
|---------|------|---------|------|
| `generatePKCE()` | [test-sp/lib/sso-sp/pkce.ts](file:///var/catnetweb/test-sp/lib/sso-sp/pkce.ts) | 直接复用 | 生成 code_verifier + code_challenge（S256） |
| `generateRandomString(length)` | 同上 | 直接复用 | 生成 state / nonce |
| `validateIdToken(token, options)` | [test-sp/lib/sso-sp/id-token.ts](file:///var/catnetweb/test-sp/lib/sso-sp/id-token.ts) | 直接复用 | 8 步 id_token 验证 |
| `normalizeTargetUrl(rawUrl)` | [test-sp/lib/sso-sp/target-url.ts](file:///var/catnetweb/test-sp/lib/sso-sp/target-url.ts) | 直接复用 | target_url 规范化（防开放重定向） |
| `savePKCEParams(verifier, state)` | [test-sp/lib/sso-sp/storage.ts](file:///var/catnetweb/test-sp/lib/sso-sp/storage.ts) | 直接复用 | PKCE 双写存储 |
| `saveReturnTo(url)` / `getReturnTo()` / `clearReturnTo()` | 同上 | 直接复用 | returnTo 路径管理 |
| `checkAuthStatus()` | 同上 | 直接复用 | 检查登录状态 |
| `clearAuthData()` | 同上 | 直接复用 | 清除所有认证数据 |

---

## 附录

### A. 环境变量速查表

#### IDP 端（服务端）

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `ISSUER_URL` | 是 | `http://localhost:3000` | IDP 颁发者 URL（影响 Discovery 所有端点） |
| `APP_URL` | 是 | — | 应用根 URL |
| `SSO_MOCK_ENABLED` | 否 | `0` | 启用 SSO mock（仅开发） |
| `SSO_DCR_ENABLED` | 否 | `false` | 启用 DCR（FR-005） |
| `SSO_DCR_INITIAL_ACCESS_TOKEN` | 否 | — | DCR Initial Access Token（DCR 启用时必填） |
| `SSO_DPOP_ENABLED` | 否 | `true` | 启用 DPoP（FR-006，默认启用，置 `false` 禁用） |
| `SSO_PAR_ENABLED` | 否 | `true` | 启用 PAR（FR-007，默认启用，置 `false` 禁用） |

#### SP 端 - 浏览器可见（`NEXT_PUBLIC_` 前缀）

| 变量 | 必填 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_SSO_ISSUER` | 是 | IDP base URL |
| `NEXT_PUBLIC_SSO_CLIENT_ID` | 是 | 客户端 ID |
| `NEXT_PUBLIC_SSO_REDIRECT_URI` | 是 | 回调 URL |
| `NEXT_PUBLIC_SSO_SCOPE` | 是 | 默认 scope（空格分隔） |

#### SP 端 - 仅服务端（无 `NEXT_PUBLIC_` 前缀）

| 变量 | 必填 | 说明 |
|------|------|------|
| `SSO_CLIENT_SECRET` | 是 | 客户端密钥（token 交换时使用） |
| `SSO_ISSUER` | 是 | IDP issuer URL（id_token 验证用） |
| `SSO_CLIENT_ID` | 是 | 客户端 ID（token 交换时使用） |
| `ID_TOKEN_VERIFY_MODE` | 否 | `strict`（默认）或 `soft` |

### B. 错误码速查表

#### OAuth/OIDC 标准错误码

| error | HTTP |
|-------|------|
| `invalid_request` | 400 |
| `invalid_client` | 401 |
| `invalid_grant` | 400 |
| `invalid_scope` | 400 |
| `invalid_state` | 400 |
| `invalid_token` | 401 |
| `invalid_id_token` | 401 |
| `unsupported_grant_type` | 400 |
| `unsupported_response_type` | 302 |
| `server_error` | 500 |
| `session_expired` | 401 |
| `too_many_requests` | 429 |

#### SSO_IDP_* 自定义错误码（按特性分组）

| 特性 | 错误码前缀 | 数量 |
|------|-----------|------|
| 授权码服务 | `SSO_CODE_*` | 8 |
| 用户信息 | `SSO_USER_INFO_*` | 2 |
| 客户端管理 | `SSO_CLIENT_*` | 8 |
| 同意管理 | `SSO_CONSENT_*` / `SSO_VALIDATION_ERROR` / `SSO_SERVER_ERROR` | 4 |
| IdP-Initiated SSO | `SSO_IDP_INITIATED_*` | 4 |
| Back-Channel Logout（FR-002） | `SSO_IDP_BACKCHANNEL_LOGOUT_*` / `SSO_IDP_SESSION_REGISTRY_ERROR` | 4 |
| PAR（FR-007） | `SSO_IDP_PAR_*` | 5 |
| 密钥轮换（FR-004） | `SSO_IDP_KEY_*` / `SSO_IDP_KEYSTORE_*` | 5 |
| DCR（FR-005） | `SSO_IDP_DCR_*` | 6 |
| DPoP（FR-006） | `SSO_IDP_DPOP_*` | 6 |

> 完整错误码清单参见 §6.2

### C. 端点速查表

| 端点 | 方法 | 路径 | 用途 |
|------|------|------|------|
| Discovery | GET | `/.well-known/openid-configuration` | IDP 配置发现 |
| Authorize | GET | `/api/sso/authorize` | 用户授权 |
| Token | POST | `/api/sso/token` | 令牌交换（3 种 grant_type） |
| UserInfo | GET/POST | `/api/sso/userinfo` | 用户信息查询 |
| JWKS | GET | `/api/sso/jwks` | 公钥集合 |
| Introspect | POST | `/api/sso/introspect` | Token 内省 |
| Revoke | POST | `/api/sso/revoke` | Token 撤销 |
| End Session | GET/POST | `/api/sso/logout` | 登出 |
| PAR（高级） | POST | `/api/sso/par` | 推送授权请求 |
| DCR（高级） | POST/GET/PUT/DELETE | `/api/sso/register` | 动态客户端注册 |

### D. 术语表

参见 §0.3。

### E. RFC 参考清单

参见 §1.1。

---

**文档结束**

> 本文档由总调度 agent 基于 SSO IDP 实际实现撰写，所有契约引用实际源代码位置（`file://` 链接可点击）。
> 如发现文档与实现不一致，以实现为准并提 issue 修订文档。
