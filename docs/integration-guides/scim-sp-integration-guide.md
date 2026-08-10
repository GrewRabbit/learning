# SCIM SP 集成指南

**版本**：v1.0
**状态**：active
**适用对象**：SP（Service Provider）端开发者 + AI Agent
**创建时间**：2026-08-06
**最后更新**：2026-08-06

> 本文档面向需要接入 SCIM（System for Cross-domain Identity Management）身份供给能力的 SP 端开发者与 AI Agent。AI Agent 可按 §0.2 指引按需加载章节，独立完成 SP 端 SCIM 集成开发（代码实现、配置部署、功能验证全流程）。
> 本文档是 `sso-idp-sp-integration-guide.md` 的配套文档，专注 SCIM 2.0 身份供给场景；SSO 登录场景请参考前者。

---

## 目录

- [0. 文档导航与使用说明](#0-文档导航与使用说明)
- [1. 集成环境要求](#1-集成环境要求)
- [2. 前置条件说明](#2-前置条件说明)
- [3. SCIM 功能概述](#3-scim-功能概述)
- [4. 详细集成步骤](#4-详细集成步骤)
- [5. 请求/响应示例（端到端集成场景）](#5-请求响应示例端到端集成场景)
- [6. 错误处理机制](#6-错误处理机制)
- [7. 测试验证流程](#7-测试验证流程)
- [8. 最佳实践建议](#8-最佳实践建议)
- [附录](#附录)

---

## 0. 文档导航与使用说明

### 0.1 适用对象与使用场景

| 角色 | 使用方式 |
|------|---------|
| SP 端开发者 | 通读 §1-§3 后按 §4 实施；§4 作为接口契约手册随时查阅，§5 提供端到端参考实现 |
| AI Agent | 按 §0.2 指引按需加载章节；优先读取 §2 → §3 → §4.2 → §4.3 → §6 → §7 |
| IDP 管理员 | 参考 §2 客户端管理、§3 能力声明、§6 错误码定位问题 |

### 0.2 AI Agent 使用方式

**按需加载策略**（避免一次性加载全文）：

| 任务阶段 | 必读章节 | 选读章节 |
|---------|---------|---------|
| 理解 SCIM 能力边界 | §3 | §3.6 |
| 准备集成环境与凭据 | §1、§2 | 附录 A |
| 实现认证 | §4.2 | §2.4 |
| 实现 Users CRUD | §4.1、§4.3 | §4.6 |
| 实现 Groups CRUD | §4.1、§4.4 | §4.6 |
| 实现 PATCH 部分更新 | §4.3.5、§4.4.5、§4.6.4 | — |
| 实现 EnterpriseUser 扩展 | §4.5.1 | — |
| 实现 filter/sort/分页/属性投影 | §4.6.1、§4.6.2、§4.6.3、§4.6.5 | — |
| 实现 ETag 并发控制 | §4.6.6 | — |
| 端到端参考实现 | §5 | 附录 D |
| 排查错误 | §6 | 附录 B |
| 验证集成 | §7 | — |

**关键路径优先**：AI Agent 集成核心 provisioning 流程时，建议按 `§2 → §3 → §4.1 → §4.2 → §4.3 → §4.4 → §4.6 → §6 → §7` 顺序读取。

**执行约束**：所有示例中的 `<ISSUER_URL>`、`<access_token>`、`<entryUUID>` 等占位符须由 AI Agent 替换为真实值后再执行；`<ISSUER_URL>` 默认为 IDP 部署地址（如 `https://sso.example.com`），本地开发为 `http://localhost:3000`。

### 0.3 术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| SCIM | System for Cross-domain Identity Management | 跨域身份管理协议（RFC 7643/7644） |
| IDP | Identity Provider | 身份提供商（本项目 SSO/SCIM 服务端） |
| SP | Service Provider | 服务提供商（接入方应用，本指南读者） |
| CRUD | Create / Read / Update / Delete | 资源增删改查 |
| PATCH | — | 部分更新操作（RFC 7644 §3.5.2） |
| ETag | Entity Tag | 实体标签，用于乐观并发控制 |
| LDAP | Lightweight Directory Access Protocol | 轻量目录访问协议（SCIM 后端目录） |
| entryUUID | — | LDAP 条目全局唯一标识，对应 SCIM `id` |
| entryCSN | — | LDAP 条目变更序列号，ETag 版本来源 |
| DCR | Dynamic Client Registration | 动态客户端注册（RFC 7591/7592） |
| OAuth2 | — | 授权框架（RFC 6749） |
| JWT | JSON Web Token | 基于 JSON 的令牌（RFC 7519） |
| Bearer Token | — | 持有者令牌（RFC 6750） |
| Provisioning | — | 身份供给（向下游同步用户/组） |

### 0.4 文档版本与变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-06 | 初稿创建，覆盖 SCIM 2.0 SP 集成全流程 |

---

## 1. 集成环境要求

### 1.1 IDP/SCIM 服务端环境

SP 端集成前，IDP 侧须满足以下运行环境（由 IDP 运维负责，SP 端仅需确认可达性）：

| 项 | 要求 | 说明 |
|----|------|------|
| SCIM 服务端 | 已部署并运行本项目 IDP（含 SCIM v2 模块） | SCIM API 基址：`{ISSUER_URL}/api/scim/v2` |
| 后端目录 | OpenLDAP 可达，已加载 `inetOrgPerson`、`groupOfNames`、`scimClient` schema | SCIM 资源最终持久化于 LDAP |
| `ISSUER_URL` | 已正确配置（如 `https://sso.example.com`） | 用于 token 端点、`meta.location`、`$ref` 构造；缺失则 IDP 启动期抛错 |
| 写方法开关 | `SCIM_ENABLE_WRITE_METHODS=on`（默认） | `off` 时回退只读 + PATCH，POST/PUT/DELETE 返回 501；紧急回滚用 |
| PATCH path 开关 | `SCIM_ENFORCE_PATH_REQUIRED=on`（默认） | `off` 时兼容 path-less PATCH（已废弃，不建议） |
| HTTPS（生产） | 生产环境必须 HTTPS | 本地开发可用 `http://localhost:3000` |

### 1.2 SP 端客户端运行环境

SP 端集成 SCIM **不依赖特定 SDK**，仅需标准 HTTP 客户端能力：

| 能力 | 要求 | 用途 |
|------|------|------|
| HTTP/HTTPS 客户端 | 支持 GET/POST/PUT/PATCH/DELETE、自定义请求头、form-urlencoded 与 JSON body | 调用 SCIM API 与 token 端点 |
| JSON 解析/序列化 | 标准能力 | 请求体/响应体处理 |
| Token 缓存 | 进程内缓存 + 过期管理（建议提前 60s 失效） | client_credentials token 有效期 1 小时，避免频繁换 token |
| ETag 处理 | 能记录响应 `ETag` 并在 PUT/PATCH/DELETE 请求中回传 `If-Match` | 乐观并发控制（可选但推荐） |
| URL 编码 | `encodeURIComponent` | filter 等查询参数含空格/引号须编码 |
| TLS 证书校验 | 生产环境启用 | 本地自签名证书测试时可关闭（仅测试） |

**推荐技术栈**：任意语言均可。本项目为 Next.js/TypeScript，附录 D 提供 TypeScript 参考客户端实现；其他语言按相同 HTTP 契约实现即可。

### 1.3 网络环境要求

| 项 | 要求 |
|----|------|
| SP → IDP | SP 服务器须能访问 `{ISSUER_URL}`（出站 443/HTTPS） |
| 防火墙/白名单 | 若 IDP 限制来源 IP，须将 SP 出口 IP 加入白名单 |
| 速率限制 | IDP 侧按 clientId 限流：读 200 次/分钟、写 50 次/分钟、服务发现 500 次/分钟（按 IP）。SP 须做客户端侧节流，超限返回 429 + `Retry-After` |
| 代理 | 若 SP 经代理出网，须正确配置 `x-forwarded-for`（IDP 用首段 IP 做 discovery 限流键） |

### 1.4 IDP 侧关键环境变量（SP 端需知晓）

完整清单见附录 A。SP 端集成最相关的：

| 变量名 | 默认值 | 对 SP 集成的影响 |
|--------|--------|------------------|
| `ISSUER_URL` | — | 决定 SCIM API 基址与 token 端点地址 |
| `SCIM_ENABLE_WRITE_METHODS` | `on` | `off` 时 SP 无法执行写操作 |
| `SCIM_ENFORCE_PATH_REQUIRED` | `on` | `on` 时 SP 的 PATCH 请求必须带 `path` 字段 |
| `SSO_DCR_ENABLED` | `false` | 仅影响 SSO OIDC 客户端 DCR，**与 SCIM Client 创建无关**（见 §2.5 澄清） |

---

## 2. 前置条件说明

### 2.1 SP 端技术条件

| 条件 | 说明 |
|------|------|
| 具备 HTTP 客户端 | 见 §1.2 |
| 具备凭据安全存储能力 | `client_secret` / API Key 须加密存储于密钥管理服务或环境变量，**禁止**入库或入日志 |
| 具备唯一标识管理能力 | SP 须能持久化 SCIM 资源 `id`（entryUUID），用于后续 GET/PUT/PATCH/DELETE |
| 具备重试/退避能力 | 对 429/5xx 实现指数退避重试（见 §6.3） |

### 2.2 权限要求

| 权限 | 持有者 | 用途 |
|------|--------|------|
| IDP 管理员 | IDP 运维 | 在管理后台 `/admin/dashboard/scim` 创建/管理 SCIM Client |
| SCIM Client 凭据 | SP 端 | 调用 SCIM API 认证 |

> **重要**：SCIM Client **只能由 IDP 管理员在管理后台创建**，SP 端无法自助注册。SP 端需向 IDP 管理员申请，获取 `client_id` + `client_secret`（oauth2 模式）或 API Key（apikey 模式）。

### 2.3 准备工作清单

集成前 SP 端需完成以下准备：

- [ ] 确认 IDP 的 `ISSUER_URL`（向 IDP 管理员获取）
- [ ] 确认认证模式：`oauth2`（推荐，标准 OAuth2 client_credentials）或 `apikey`（简化集成）
- [ ] 确认权限范围：需要的资源操作（User/Group 的 read/create/update/delete）与属性级权限
- [ ] 向 IDP 管理员申请创建 SCIM Client，获取凭据
- [ ] （验证用）在 IDP/LDAP 中确认或准备基线测试用户名与组名（如 `SCIM_TEST_USERNAME`、`SCIM_TEST_GROUPNAME`）
- [ ] 在 SP 端配置凭据安全存储与 token 缓存机制

### 2.4 SCIM Client 创建与管理

SCIM Client 通过**管理后台 Server Action** 管理（非 REST API、非 DCR）。下表列出生命周期操作，SP 端无权直接调用，仅供理解凭据来源：

| 操作 | 入口 | 关键说明 |
|------|------|----------|
| 创建 Client | 管理后台 → SCIM 页面 | 管理员填写 `name`、`allowedScopes`（默认 `['scim']`）、`isActive`、`scimResourcePermissions`、`scimAuthMode`；创建后**明文凭据仅返回一次** |
| 轮换 clientSecret | 管理后台 | 仅 oauth2 模式；新 secret 明文仅返回一次 |
| 轮换 API Key | 管理后台 | 仅 apikey 模式；新 key 明文仅返回一次 |
| 切换认证模式 | 管理后台 | `oauth2 → apikey` 时自动生成新 API Key 并返回；失败回滚 |
| 删除 Client | 管理后台 | 物理删除，不可恢复 |
| 列表查询 | 管理后台 | 响应中 `secret` 与 `scimApiKeyHash` 强制置空，附加 `hasScimApiKey` 标志 |

**ScimClient 数据模型**（SP 端需理解的字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 客户端唯一标识，格式 `client_<32位hex>`，即 OAuth2 的 `client_id` |
| `secret` | string | client_secret 的 bcrypt 哈希（响应中始终置空，明文仅创建/重置时返回） |
| `name` | string | 客户端显示名 |
| `allowedScopes` | string[] | 允许的 scope，默认 `['scim']` |
| `isActive` | boolean | 是否启用，禁用后认证返回 403 |
| `scimAuthMode` | `'oauth2' \| 'apikey'` | 认证模式，**二选一互斥**，无 `both` |
| `scimResourcePermissions` | ScimResourcePermission[] | 资源级 + 属性级权限（见 §4.2.4） |
| `createdAt` / `updatedAt` | string (ISO 8601) | 创建/更新时间 |

### 2.5 ⚠️ DCR 澄清（常见误区）

| 问题 | 正确认知 |
|------|----------|
| DCR（`/api/sso/register`）能创建 SCIM Client 吗？ | **不能**。DCR 创建的是 **SSO OIDC 客户端**（用于登录），不是 SCIM Client（用于身份供给）。 |
| SCIM Client 怎么创建？ | 仅由 IDP 管理员在管理后台创建（见 §2.4）。 |
| API Key 用什么请求头？ | `Authorization: Bearer <api-key>`，**不是** `X-API-Key`。 |
| oauth2 模式 client 能用 API Key 调用吗？ | **不能**，返回 403；反之 apikey 模式 client 不能用 OAuth2 token 调用。二者互斥。 |
| SCIM oauth2 client 的 grant_types 可配置吗？ | 不可。强制为 `['client_credentials']`（token 端点认证时动态注入，未持久化）。 |

---

## 3. SCIM 功能概述

### 3.1 协议版本与 RFC 参考

本项目实现 **SCIM 2.0**：

| RFC | 标题 | 覆盖范围 |
|-----|------|----------|
| RFC 7643 | SCIM Core Schema | User/Group 资源模型、ServiceProviderConfig、ResourceTypes、Schemas |
| RFC 7644 | SCIM Protocol | CRUD、PATCH、filter、sort、分页、ETag、错误响应 |

### 3.2 核心能力

| 能力 | 支持情况 | 说明 |
|------|----------|------|
| Users CRUD | ✅ 全支持 | POST/GET/PUT/PATCH/DELETE（DELETE 默认软删，`?mode=hard` 物理删） |
| Groups CRUD | ✅ 全支持 | POST/GET/PUT/PATCH/DELETE（DELETE 始终物理删） |
| PATCH | ✅ 支持 | add/replace/remove，支持子属性过滤路径 |
| filter | ✅ 支持 | eq/ne/co/sw/ew/pr/gt/ge/lt/le/and/or/not + 括号 |
| sort | ✅ 支持 | sortBy/sortOrder（应用层排序） |
| 分页 | ✅ 支持 | startIndex/count（offset 分页，非游标） |
| 属性投影 | ✅ 支持 | attributes/excludedAttributes |
| ETag 并发 | ✅ 支持 | 响应 `ETag`，请求 `If-Match`，412 前置校验失败 |
| EnterpriseUser 扩展 | ✅ 支持 | employeeNumber/department/manager（RFC 7643 §4.3） |
| changePassword | ✅ 支持 | PATCH password（writeOnly，永不返回） |
| 服务发现 | ✅ 支持 | ServiceProviderConfig/ResourceTypes/Schemas（免认证） |
| OAuth2 认证 | ✅ 支持 | client_credentials（主认证方式） |
| API Key 认证 | ✅ 支持 | 静态 Bearer Token（兼容模式） |

### 3.3 不支持的能力（明确边界）

| 能力 | 状态 | 说明 |
|------|------|------|
| Bulk 批量操作 | ❌ 不支持 | `bulk.supported=false`，无 `/Bulk` 端点；`POST /Bulk` 返回 501 |
| `/Me` 端点 | ❌ 返回 501 | 机器令牌场景未实现，返回 `SCIM_FEATURE_NOT_IMPLEMENTED` |
| 游标分页 | ❌ 不支持 | 仅 offset 分页（startIndex/count） |
| 增量同步 | ❌ 不支持 | 无 `updatedSince` 等增量查询 |
| `/.search` POST 查询 | ❌ 不支持 | 仅支持 GET 查询参数式 filter |
| `interopProfileConformant:true` | ❌ 不声明 | — |
| `/Users` 集合端点 PUT/DELETE | ❌ 返回 501 | 仅支持单资源 `/Users/{id}` 的 PUT/DELETE |

### 3.4 服务发现端点

以下端点**免认证**（但仍受 IP 级 discovery 限流，500 次/分钟）：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/scim/v2/ServiceProviderConfig` | GET | 服务提供方能力声明 |
| `/api/scim/v2/ResourceTypes` | GET | 资源类型列表（User/Group） |
| `/api/scim/v2/ResourceTypes/{id}` | GET | 单个资源类型 |
| `/api/scim/v2/Schemas` | GET | Schema 列表（4 个） |
| `/api/scim/v2/Schemas/{...id}` | GET | 单个 Schema（路径为 schema URI） |

> AI Agent 集成第一步建议先 GET `/ServiceProviderConfig` 确认 IDP 实际能力，再据此实现。

### 3.5 认证方式

SCIM API 支持两种**互斥**认证模式，均通过 `Authorization: Bearer <token>` 头传递：

| 模式 | 凭证 | 适用场景 |
|------|------|----------|
| OAuth2 client_credentials | JWT access_token（1 小时有效） | 推荐；标准 OAuth2 流程，可定期轮换 secret |
| API Key | 静态随机串（base64url） | 简化集成；不需实现 token 获取逻辑 |

详见 §4.2。

### 3.6 资源模型概览

| 资源 | schema URN | 扩展 | 端点 |
|------|-----------|------|------|
| User | `urn:ietf:params:scim:schemas:core:2.0:User` | `ldapauth-scim`（始终携带，私有）、`enterprise`（有数据时携带，标准） | `/Users` |
| Group | `urn:ietf:params:scim:schemas:core:2.0:Group` | 无 | `/Groups` |

**Schema URN 常量**：

| 常量 | URN |
|------|-----|
| User Core | `urn:ietf:params:scim:schemas:core:2.0:User` |
| ldapauth-scim 扩展 | `urn:ietf:params:scim:schemas:extension:ldapauth-scim:2.0:User` |
| Enterprise 扩展 | `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User` |
| Group Core | `urn:ietf:params:scim:schemas:core:2.0:Group` |
| PatchOp | `urn:ietf:params:scim:api:messages:2.0:PatchOp` |
| ListResponse | `urn:ietf:params:scim:api:messages:2.0:ListResponse` |
| Error | `urn:ietf:params:scim:api:messages:2.0:Error` |

---

## 4. 详细集成步骤

### 4.1 API 端点配置

#### 4.1.1 端点清单

所有端点位于 `/api/scim/v2` 前缀下，`Content-Type` 统一为 `application/scim+json; charset=utf-8`，响应统一带 `Cache-Control: no-store`。

| HTTP 方法 | 完整路径 | 功能 | 查询参数 | 认证 |
|-----------|----------|------|----------|------|
| GET | `/Users` | 列出用户 | `filter`,`sortBy`,`sortOrder`,`startIndex`,`count`,`attributes`,`excludedAttributes` | 是 |
| POST | `/Users` | 创建用户 | — | 是 |
| GET | `/Users/{id}` | 获取单个用户 | `attributes`,`excludedAttributes` | 是 |
| PUT | `/Users/{id}` | 全量替换用户 | — | 是 |
| PATCH | `/Users/{id}` | 部分更新用户 | — | 是 |
| DELETE | `/Users/{id}` | 删除用户（默认软删，`?mode=hard` 硬删） | `mode=hard\|soft` | 是 |
| GET | `/Groups` | 列出组 | 同 `/Users` | 是 |
| POST | `/Groups` | 创建组 | — | 是 |
| GET | `/Groups/{id}` | 获取单个组 | `attributes`,`excludedAttributes` | 是 |
| PUT | `/Groups/{id}` | 全量替换组 | — | 是 |
| PATCH | `/Groups/{id}` | 部分更新组 | — | 是 |
| DELETE | `/Groups/{id}` | 删除组（物理删） | — | 是 |
| GET | `/Me` | 当前认证用户 | — | 是（返回 501） |
| GET | `/ServiceProviderConfig` | 能力声明 | — | 否 |
| GET | `/ResourceTypes` | 资源类型列表 | — | 否 |
| GET | `/ResourceTypes/{id}` | 单个资源类型 | — | 否 |
| GET | `/Schemas` | Schema 列表 | — | 否 |
| GET | `/Schemas/{...id}` | 单个 Schema | — | 否 |

#### 4.1.2 通用请求头

| 请求头 | 必需性 | 说明 |
|--------|--------|------|
| `Authorization` | **必需**（认证端点） | `Bearer <token>`，缺失或非 `Bearer ` 前缀返回 401 |
| `Content-Type` | **必需**（POST/PUT/PATCH） | `application/scim+json` 或 `application/json`，否则 415 |
| `Accept` | 不强制 | 响应恒为 `application/scim+json; charset=utf-8` |
| `If-Match` | 可选（PUT/PATCH/DELETE） | ETag 并发控制，格式 `W/"<version>"` 或 `*` |
| `Content-Length` | 自动 | 超过 1MB（1024×1024）返回 413 |

#### 4.1.3 通用响应头

| 响应头 | 值 | 说明 |
|--------|-----|------|
| `Content-Type` | `application/scim+json; charset=utf-8` | 所有响应（含错误）固定 |
| `Cache-Control` | `no-store` | 所有响应固定 |
| `ETag` | `W/"<version>"` | 资源响应附带；version 来自 `entryCSN`（优先）/`modifyTimestamp`（回退） |
| `Location` | 资源 URI | POST 创建、GET 单资源响应附带 |
| `Retry-After` | 秒数 | 仅 429 限流时附带 |

### 4.2 认证授权实现流程

#### 4.2.1 方式 A：OAuth2 client_credentials（推荐）

**步骤 1：获取 access_token**

```bash
curl -X POST "https://<ISSUER_URL>/api/sso/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=client_<32位hex>" \
  -d "client_secret=<创建时返回的明文secret>" \
  -d "scope=scim"
```

> **注意**：token 端点用 `application/x-www-form-urlencoded`，**不是 JSON**。

成功响应（HTTP 200）：

```json
{
  "access_token": "<JWT access_token>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "scim"
}
```

- `expires_in` 固定 3600 秒（1 小时）；**不签发 refresh_token**，过期需重新请求。
- `scope` 必须包含 `scim`（默认签发）。
- token 的 `aud` claim 等于 `client_id`。

token 端点错误响应（OAuth 标准格式 `{error, error_description}`，非 SCIM 格式）：

| HTTP | error | 触发条件 |
|------|-------|----------|
| 400 | `invalid_request` | 参数校验失败 |
| 400 | `unsupported_grant_type` | grant_type 非法 |
| 401 | `invalid_client` | client_id/secret 校验失败 |
| 400 | `unauthorized_client` | client 未授权 client_credentials |
| 400 | `invalid_scope` | 请求 scope 不在 allowedScopes 内 |
| 429 | — | 触发 token 限流 |

**步骤 2：调用 SCIM API 时携带 token**

```bash
curl -X GET "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: application/scim+json"
```

**步骤 3：token 缓存策略**

- 进程内缓存 token，建议提前 60 秒失效（避免边界过期）。
- 过期后重新调用 `/api/sso/token`。
- 收到 401 时主动失效缓存并重试一次。

#### 4.2.2 方式 B：API Key（简化集成）

API Key 作为 Bearer Token 直接发送，**无需先调 token 端点**：

```bash
curl -X GET "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer <api-key>" \
  -H "Accept: application/scim+json"
```

- API Key 格式：32 字节随机数的 base64url 编码（约 43 字符）。
- 明文仅在创建/重置时返回一次，须立即安全保存，丢失只能重置。
- 仅 `scimAuthMode='apikey'` 的 client 接受 API Key；oauth2 模式 client 用 API Key 调用返回 403。

#### 4.2.3 认证失败响应

认证失败使用 SCIM 错误格式（见 §6.1）：

| HTTP | detail | 触发条件 |
|------|--------|----------|
| 401 | `Authorization header with Bearer token is required` | 缺失 Authorization 头或非 Bearer 前缀 |
| 403 | `Token does not include scim scope` | OAuth2 token scope 不含 `scim` |
| 401 | `Client not found` | token aud 对应 client 不存在 |
| 403 | `Client is not active` | client 已禁用 |
| 403 | `OAuth2 token not allowed for this client; use API Key instead` | apikey 模式 client 用 OAuth2 token |
| 403 | `API Key not allowed for this client; use OAuth2 token instead` | oauth2 模式 client 用 API Key |
| 401 | `Invalid or expired token` | token 既非有效 OAuth2 token，也不匹配任何 API Key |

#### 4.2.4 权限模型（资源级 + 属性级）

每个 SCIM Client 配置 `scimResourcePermissions`，约束可访问的资源类型、操作与属性：

```json
{
  "scimResourcePermissions": [
    {
      "resourceType": "User",
      "operations": ["read", "create", "update"],
      "attributePermissions": [
        { "attributePath": "password", "permission": "none" },
        { "attributePath": "active", "permission": "readOnly" }
      ]
    },
    {
      "resourceType": "Group",
      "operations": ["read", "create", "update", "delete"],
      "attributePermissions": []
    }
  ]
}
```

- **资源操作权限**：`operations` 不含请求操作 → 403（handler 层拦截）。
- **属性级权限**：`none`/`readOnly`/`readWrite`/`writeOnly`/`immutable`，支持父子路径继承（如 `name.familyName` 未配置时回退到 `name`）。
- **权限与 schema mutability 取交集**为有效权限：`readOnly` 属性即使 SP 有 `readWrite` 权限仍不可写；`none` 权限的属性不出现在响应中。

**只读客户端**：`operations: ['read']`，只能调 GET，写操作返回 403。
**读写客户端**：`operations: ['read','create','update','delete']`，可调全部 CRUD；通过 `attributePermissions` 收窄敏感属性（如禁止写 `password`）。

> SP 端申请 Client 时须明确告知 IDP 管理员所需权限范围，按最小权限原则配置。

### 4.3 用户资源（Users）CRUD

#### 4.3.1 User 字段表

| 字段路径 | 类型 | 必填 | 唯一 | 可写 | 说明 |
|---------|------|------|------|------|------|
| `id` | string | 是 | global | 否（readOnly） | LDAP entryUUID |
| `schemas` | string[] | 否 | 否 | 否 | 自动计算，含 core + ldapauth-scim（始终）+ enterprise（有数据时） |
| `userName` | string | 是 | server | 否（**immutable**） | 登录名，字符集 `^[a-zA-Z0-9._-]+$`，存储时 toLowerCase 归一化 |
| `name.familyName` | string | **是** | 否 | 是 | 姓（LDAP `sn`，inetOrgPerson 强制） |
| `name.givenName` | string | 否 | 否 | 是 | 名（LDAP `givenName`） |
| `name.formatted` | string | 否 | 否 | 否 | **声明但不存储**，响应**永不返回** |
| `name.middleName`/`honorificPrefix`/`honorificSuffix` | string | 否 | 否 | 是 | **声明但不存储**（写入被忽略） |
| `displayName` | string | 否 | 否 | 是 | 显示名（LDAP `displayName`，回退 `cn`） |
| `emails[].value` | string(email) | 否 | 否 | 是 | 邮箱（LDAP `mail`）；**响应仅返回 1 项**，多邮箱不持久化 |
| `emails[].type`/`primary` | — | 否 | 否 | 否 | **声明但不存储**；请求校验至多 1 项 `primary:true` |
| `active` | boolean | 否 | 否 | 是 | 账户启用状态（computed，由 `pwdEndTime` 计算） |
| `password` | string | 否 | 否 | 是（writeOnly） | 明文密码，min 8 字符；**响应永不返回**；写入记录审计 |
| `groups` | complex[] | 否 | 否 | 否（readOnly, computed） | 用户所属组列表 |
| `urn:...:ldapauth-scim:2.0:User:accountActive` | boolean | 否 | 否 | 否 | 与 `active` 同值（私有扩展） |
| `urn:...:ldapauth-scim:2.0:User:accountExpiresAt` | dateTime | 否 | 否 | 是 | 账户过期时间（LDAP `pwdEndTime`，ISO 8601） |
| `urn:...:enterprise:2.0:User:employeeNumber` | string | 否 | 否 | 是 | 员工编号（LDAP `employeeNumber`） |
| `urn:...:enterprise:2.0:User:department` | string | 否 | 否 | 是 | 部门（LDAP `departmentNumber`，**SCIM 名 ≠ LDAP 名**） |
| `urn:...:enterprise:2.0:User:manager` | complex | 否 | 否 | 是 | 经理（LDAP `manager`，DN 引用） |
| `urn:...:enterprise:2.0:User:manager.value` | string | 是（若 manager 存在） | 否 | 是 | 经理的 entryUUID |
| `urn:...:enterprise:2.0:User:manager.$ref`/`displayName` | — | 否 | 否 | 否 | 经理 URI/cn（readOnly） |
| `meta` | complex | 否 | 否 | 否 | resourceType/location/created/lastModified/version |

**未实现的标准 User 字段**（请求 `.strict()` 拒绝，响应不输出）：`externalId`、`nickName`、`profileUrl`、`title`、`userType`、`preferredLanguage`、`locale`、`timezone`、`phoneNumbers`、`ims`、`photos`、`addresses`、`entitlements`、`roles`、`x509Certificates`。

#### 4.3.2 POST /Users（创建）

```bash
curl -X POST "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": [
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    ],
    "userName": "jdoe",
    "name": { "familyName": "Doe", "givenName": "John" },
    "displayName": "John Doe",
    "emails": [{ "value": "jdoe@example.com", "type": "work", "primary": true }],
    "password": "StrongP@ss123",
    "active": true,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      "employeeNumber": "E001",
      "department": "Engineering"
    }
  }'
```

成功响应（HTTP 201）：

```
HTTP/1.1 201 Created
Content-Type: application/scim+json; charset=utf-8
Location: https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>
ETag: W/"<entryCSN>"
Cache-Control: no-store
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:ldapauth-scim:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "<entryUUID>",
  "userName": "jdoe",
  "name": { "familyName": "Doe", "givenName": "John" },
  "displayName": "John Doe",
  "emails": [{ "value": "jdoe@example.com" }],
  "active": true,
  "groups": [],
  "urn:ietf:params:scim:schemas:extension:ldapauth-scim:2.0:User": { "accountActive": true },
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "E001",
    "department": "Engineering"
  },
  "meta": {
    "resourceType": "User",
    "location": "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>",
    "created": "2026-08-06T08:00:00Z",
    "lastModified": "2026-08-06T08:00:00Z",
    "version": "<entryCSN>"
  }
}
```

**注意事项**：
- `userName` 字符集限定 `^[a-zA-Z0-9._-]+$`，违反返回 400。
- `name.familyName` 必填（inetOrgPerson `sn` 强制），缺失返回 400。
- `emails` 至多一项 `primary:true`，违反返回 400。
- `password` 可选；未提供时服务端生成 32 字节随机串作为默认密码。
- `userName` 唯一性预检：已存在返回 409 `uniqueness`。
- `manager.value` 必须是已存在用户的 entryUUID，不存在返回 404。
- 请求体走 `.strict()` 校验，未知属性或未注册 schema URI 直接拒绝。
- `active:false` 时才执行禁用（`pwdEndTime=now`）；`active:true` 或缺失不操作。

#### 4.3.3 GET /Users（列表）与 GET /Users/{id}

**列表查询**：

```bash
curl -G "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer <token>" \
  --data-urlencode 'filter=userName eq "jdoe"' \
  --data-urlencode 'startIndex=1' \
  --data-urlencode 'count=100' \
  --data-urlencode 'sortBy=userName' \
  --data-urlencode 'sortOrder=ascending' \
  --data-urlencode 'attributes=userName,displayName'
```

成功响应（HTTP 200）：

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 1,
  "startIndex": 1,
  "itemsPerPage": 1,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:ldapauth-scim:2.0:User"],
      "id": "<entryUUID>",
      "userName": "jdoe",
      "displayName": "John Doe",
      "meta": { "resourceType": "User", "location": "...", "version": "<entryCSN>" }
    }
  ]
}
```

**单个查询**：

```bash
curl "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>" \
  -H "Authorization: Bearer <token>" \
  -H "If-Match: W/\"<entryCSN>\""
```

响应同创建响应结构（含 `ETag` 头）。资源不存在返回 404 `SCIM_RESOURCE_NOT_FOUND`。

#### 4.3.4 PUT /Users/{id}（全量替换）

```bash
curl -X PUT "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -H 'If-Match: W/"<entryCSN>"' \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName": "jdoe",
    "name": { "familyName": "Doe", "givenName": "Johnathan" },
    "displayName": "Johnathan Doe",
    "emails": [{ "value": "johnathan.doe@example.com", "primary": true }],
    "active": true
  }'
```

**注意事项**：
- 所有字段可选（必填豁免：仅更新提供的字段，未提供的不变）。
- `userName` 可选但 **immutable**：提供时必须与现有值一致，否则返回 400 `userName is immutable and cannot be changed`。
- `password` **不在 PUT schema 中**，密码修改走 PATCH。
- 集合端点 `PUT /Users` 不支持，返回 501。

#### 4.3.5 PATCH /Users/{id}（部分更新）

```bash
curl -X PATCH "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -H 'If-Match: W/"<entryCSN>"' \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      { "op": "replace", "path": "displayName", "value": "John D." },
      { "op": "replace", "path": "active", "value": false },
      { "op": "add", "path": "emails", "value": [{ "value": "work@example.com" }] }
    ]
  }'
```

常见 PATCH 场景：

| 场景 | Operations |
|------|-----------|
| 替换 displayName | `{ "op": "replace", "path": "displayName", "value": "John D." }` |
| 替换嵌套属性 | `{ "op": "replace", "path": "name.givenName", "value": "Johnny" }` |
| 添加邮箱 | `{ "op": "add", "path": "emails", "value": [{ "value": "work@example.com" }] }` |
| 替换特定 type 邮箱 | `{ "op": "replace", "path": "emails[type eq \"work\"]", "value": { "value": "new@example.com", "type": "work" } }` |
| 移除属性 | `{ "op": "remove", "path": "displayName" }` |
| 移除特定邮箱 | `{ "op": "remove", "path": "emails[type eq \"work\"]" }` |
| 修改密码 | `{ "op": "replace", "path": "password", "value": "NewStrongP@ss456" }` |
| 启用/禁用 | `{ "op": "replace", "path": "active", "value": false }` |
| 修改 Enterprise 扩展 | `{ "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Marketing" }` |

**PATCH 校验规则**：
- `schemas` 必须包含 `urn:ietf:params:scim:api:messages:2.0:PatchOp`，否则 400 `invalidSyntax`。
- `Operations` 数组最多 100 个。
- `add`/`replace` 带 path 必须含 value；`remove` 带 path 不能含 value。
- path 默认必填（`SCIM_ENFORCE_PATH_REQUIRED=on`）；path-less PATCH 返回 400。
- 子属性过滤路径仅支持 `eq`：`emails[type eq "work"]`。
- readOnly/immutable 属性修改返回 403 `mutability`。

#### 4.3.6 DELETE /Users/{id}

```bash
# 软删除（默认）：pwdEndTime=now，用户条目保留但 active=false
curl -X DELETE "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>" \
  -H "Authorization: Bearer <token>"

# 物理删除：从 LDAP 删除条目
curl -X DELETE "https://<ISSUER_URL>/api/scim/v2/Users/<entryUUID>?mode=hard" \
  -H "Authorization: Bearer <token>"
```

成功响应（HTTP 204 No Content，无 body）。

**注意事项**：
- 软删除（默认）：`active` 置 false，条目仍存在，可重新启用。
- 物理删除需 `SCIM_ENABLE_WRITE_METHODS=on`（默认）且 SP 有 `delete` 权限。
- 集合端点 `DELETE /Users` 不支持，返回 501。

### 4.4 组资源（Groups）CRUD

#### 4.4.1 Group 字段表

| 字段路径 | 类型 | 必填 | 唯一 | 可写 | 说明 |
|---------|------|------|------|------|------|
| `id` | string | 是 | global | 否（readOnly） | LDAP entryUUID |
| `schemas` | string[] | 否 | 否 | 否 | 固定 `[Group Core URN]` |
| `displayName` | string | 是 | 否（创建时唯一性预检 → 409） | 是 | 组名（LDAP `cn`，RDN，**不能 remove**） |
| `members[].value` | string | 否 | 否 | 是 | 成员的 entryUUID（User 的 id） |
| `members[].$ref` | reference | 否 | 否 | 否 | User 资源 URI |
| `members[].display` | string | 否 | 否 | 否 | 成员显示名（User 的 cn） |
| `members[].type` | string | 否 | 否 | 否 | 固定 `"User"`（声明但不存储） |
| `meta` | complex | 否 | 否 | 否 | 元数据 |

**未实现的标准 Group 字段**：`externalId`（未注册，strict 拒绝）。

#### 4.4.2 POST /Groups（创建）

```bash
curl -X POST "https://<ISSUER_URL>/api/scim/v2/Groups" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "Engineering Team",
    "members": [
      { "value": "<userEntryUUID>", "$ref": "https://<ISSUER_URL>/api/scim/v2/Users/<userEntryUUID>", "display": "John Doe" }
    ]
  }'
```

成功响应（HTTP 201），body 含服务端生成的 `id`（entryUUID）、`meta`、`members`（DN 反查为 entryUUID/display）。

**注意事项**：
- `displayName` 必填（min 1），缺失返回 400。
- `displayName` 唯一性预检：已存在返回 409 `uniqueness`。
- `members.value` 必须为已存在 User 的 entryUUID；**不存在的成员静默跳过**。
- 空成员组回退占位 DN（`groupOfNames` 要求至少一个 member）。
- `members` 子对象 `.strict()` 仅允许 `value`/`$ref`/`display`/`type`。

#### 4.4.3 GET /Groups（列表）与 GET /Groups/{id}

```bash
curl -G "https://<ISSUER_URL>/api/scim/v2/Groups" \
  -H "Authorization: Bearer <token>" \
  --data-urlencode 'filter=displayName eq "Engineering Team"'
```

Group 支持 filter：`displayName eq/co/sw/pr`、`id eq`（快路径）。Group **没有 `active` 属性**，`active` 过滤仅 User 支持。

#### 4.4.4 PUT /Groups/{id}（全量替换）

```bash
curl -X PUT "https://<ISSUER_URL>/api/scim/v2/Groups/<entryUUID>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -H 'If-Match: W/"<entryCSN>"' \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName": "Engineering Team Renamed",
    "members": [
      { "value": "<userEntryUUID1>" },
      { "value": "<userEntryUUID2>" }
    ]
  }'
```

- members 替换走 diff 重建（计算 toRemove/toAdd，分别调用成员增删；add 失败尝试回滚已 remove 的）。
- `displayName` 变更调用 `groupUpdate(cn)` 重命名。

#### 4.4.5 PATCH /Groups/{id}

```bash
curl -X PATCH "https://<ISSUER_URL>/api/scim/v2/Groups/<entryUUID>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations": [
      { "op": "add", "path": "members", "value": [{ "value": "<userEntryUUID>" }] }
    ]
  }'
```

常见 PATCH 场景：

| 场景 | Operations |
|------|-----------|
| 添加成员（幂等，重复添加静默忽略） | `{ "op": "add", "path": "members", "value": [{ "value": "<uuid>" }] }` |
| 移除特定成员 | `{ "op": "remove", "path": "members[value eq \"<uuid>\"]" }` |
| 移除所有成员 | `{ "op": "remove", "path": "members" }` |
| 重命名组 | `{ "op": "replace", "path": "displayName", "value": "New Name" }` |

**注意**：`displayName` 不能 remove（`cn` 是 Group RDN），返回 400。PATCH 后双向失效 User/Group 缓存。

#### 4.4.6 DELETE /Groups/{id}

```bash
curl -X DELETE "https://<ISSUER_URL>/api/scim/v2/Groups/<entryUUID>" \
  -H "Authorization: Bearer <token>"
```

成功响应（HTTP 204）。Group 删除**始终物理删除**（无软删模式）。资源不存在返回 404。

### 4.5 其他扩展资源

#### 4.5.1 EnterpriseUser 扩展

标准 RFC 7643 §4.3 企业用户扩展，schema URN：`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`。

**在 POST/PUT 中携带**：以 URN 为 key 的容器对象：

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
  "userName": "jdoe",
  "name": { "familyName": "Doe" },
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "E001",
    "department": "Engineering",
    "manager": { "value": "<managerEntryUUID>" }
  }
}
```

**支持的扩展字段**：

| 字段 | 类型 | LDAP 属性 | 说明 |
|------|------|-----------|------|
| `employeeNumber` | string | `employeeNumber` | 员工编号 |
| `department` | string | `departmentNumber` | 部门（SCIM 名 ≠ LDAP 名） |
| `manager` | complex | `manager`（DN 引用） | 经理对象 |
| `manager.value` | string | — | 经理 entryUUID（写入时解析为 DN；不存在返回 404） |
| `manager.$ref`/`displayName` | — | — | 经理 URI/cn（readOnly，写入忽略） |

**在 PATCH 中修改**：path 用完整 URN 或归一化形式（`enterprise:department`）：

```json
{ "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Sales" }
```

**响应 schemas 数组动态追加**：仅当 User 含 enterprise 数据时，响应 schemas 才追加 enterprise URN。

#### 4.5.2 ldapauth-scim 私有扩展

本项目私有扩展，schema URN：`urn:ietf:params:scim:schemas:extension:ldapauth-scim:2.0:User`，**始终**包含在 User 响应 schemas 数组中。

| 字段 | 类型 | 可写 | 说明 |
|------|------|------|------|
| `accountActive` | boolean | 否（readOnly, computed） | 与 `active` 同值 |
| `accountExpiresAt` | dateTime | 是 | 账户过期时间（LDAP `pwdEndTime`，ISO 8601） |

> 此扩展字段**不能**在 POST/PUT 请求体中通过 URN 容器对象携带（strict schema 未列出），只能通过 PATCH 修改（path 用 URN 形式）。`active` 可在 POST/PUT 中直接设置。

#### 4.5.3 服务发现资源

**ServiceProviderConfig 响应**（真实能力声明）：

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ServiceProviderConfig"],
  "patch": { "supported": true },
  "bulk": { "supported": false, "maxOperations": 0, "maxPayloadSize": 0 },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": true },
  "sort": { "supported": true },
  "etag": { "supported": true },
  "authenticationSchemes": [
    { "type": "oauth2clientcredentials", "name": "OAuth Bearer Token", "description": "Authentication via OAuth2 Client Credentials", "specUri": "https://datatracker.ietf.org/doc/html/rfc6750", "primary": true },
    { "type": "httpbasic", "name": "API Key", "description": "Authentication via static API Key (compatibility mode for external SPs)", "primary": false }
  ],
  "documentationUri": "https://<ISSUER_URL>/docs/scim"
}
```

**ResourceTypes 响应**：返回 2 个资源类型（User/Group）。User 携带 2 个必需扩展（`ldapauth-scim`、`enterprise`，`required: true`），Group 无扩展。

**Schemas 响应**：返回 4 个 schema（User Core、Group Core、ldapauth-scim 扩展、enterprise 扩展）。单个 schema 可通过 `GET /Schemas/urn:ietf:params:scim:schemas:core:2.0:User` 获取（路径段用 `/` 分隔）。

### 4.6 通用能力

#### 4.6.1 filter 过滤

**语法**（递归下降解析器）：

```
Filter     := LogOr
LogOr      := LogAnd ('OR' LogAnd)*
LogAnd     := LogNot ('AND' LogNot)*
LogNot     := 'NOT' LogNot | Group
Group      := '(' Filter ')' | Comparison | Present
Comparison := Attr Operator Value
Present    := Attr 'PR'
```

**比较操作符**：

| 操作符 | 含义 | 示例 |
|--------|------|------|
| `eq` | 等于 | `userName eq "jdoe"` |
| `ne` | 不等于 | `active ne true` |
| `co` | 包含 | `emails co "example.com"` |
| `sw` | 开头匹配 | `userName sw "jd"` |
| `ew` | 结尾匹配 | `emails ew "@example.com"` |
| `pr` | 存在 | `emails pr` |
| `gt`/`ge`/`lt`/`le` | 大于/大于等于/小于/小于等于 | （数值/日期比较） |
| `and`/`or`/`not` | 逻辑组合 | `userName eq "jdoe" and active eq true` |
| `(` `)` | 括号嵌套 | `(userName eq "a" or userName eq "b") and active eq true` |

**字符串字面量**用双引号 `"..."` 包裹。filter 值在 URL 中须 `encodeURIComponent` 编码（空格→`%20`，引号→`%22`）。

**可过滤字段**：必须在属性注册表中注册且能映射到 LDAP 属性。computed 属性（`groups`、`meta`、`schemas`）不可过滤。

**`active` 特例**（仅 User，仅 `eq`）：
- `active eq true` → 活跃用户
- `active eq false` → 已禁用用户

**filter 复杂度限制**：`filter.maxResults=200`，与 `count` 上限一致。filter 语法错误返回 400 `invalidFilter`。

#### 4.6.2 sort 排序

| 参数 | 取值 | 默认值 |
|------|------|--------|
| `sortBy` | SCIM 属性路径（如 `userName`、`displayName`） | 空（不排序） |
| `sortOrder` | `ascending` \| `descending` | `ascending` |

- 应用层排序（非 LDAP server-side sort），filter 后、分页前执行。
- 字符串比较 `localeCompare` 大小写不敏感。
- 排序值为 null 的条目排末尾。
- 未注册的 `sortBy` 属性：忽略排序，不报错。
- `sortOrder` 非法值返回 400 `invalidFilter`。

#### 4.6.3 分页

| 参数 | 默认值 | 下限 | 上限 |
|------|--------|------|------|
| `startIndex` | `1` | `<1` 重置为 `1` | 无上限（1-based） |
| `count` | `100` | `<0` 重置为 `100` | `200`（超出截断） |

- **`count=0` 特殊语义**：仅返回 `totalResults`，`itemsPerPage=0`，`Resources: []`（用于总数探测）。
- `itemsPerPage = Math.min(Resources.length, count)`。

#### 4.6.4 属性投影

| 参数 | 行为 |
|------|------|
| `attributes` | 逗号分隔；仅返回指定属性 + **强制包含** `schemas`、`id`、`meta` |
| `excludedAttributes` | 逗号分隔；移除指定属性，但 `schemas`/`id`/`meta` 不可被排除 |

示例：`?attributes=userName,displayName` → 每个资源含 `schemas`/`id`/`meta`/`userName`/`displayName`。

#### 4.6.5 PATCH 操作详解

PATCH 请求体结构：

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "<attrPath>", "value": <value> },
    { "op": "add", "path": "<attrPath>", "value": <value> },
    { "op": "remove", "path": "<attrPath>" }
  ]
}
```

**op 语义**：
- `add`：添加值（多值属性追加，单值属性等同 replace）
- `replace`：替换值
- `remove`：移除值（带 path 不能含 value）

**路径表达式**：

| 路径 | 说明 |
|------|------|
| `displayName` | 简单属性 |
| `name.givenName` | 子属性点路径 |
| `emails` | 多值属性整体 |
| `emails[type eq "work"]` | 子属性过滤路径（**仅支持 `eq`**） |
| `members[value eq "<uuid>"]` | Group 成员过滤路径 |
| `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department` | URN 前缀（自动归一化为 `enterprise:department`） |

**path 必填性**：`SCIM_ENFORCE_PATH_REQUIRED=on`（默认）时，path-less PATCH 返回 400 `invalidSyntax`/`SCIM_PATH_INVALID`。

#### 4.6.6 ETag / If-Match 并发控制

- **响应 ETag**：`W/"<version>"`，version 来自 `entryCSN`（优先）/`modifyTimestamp`（回退）。
- **请求 If-Match**：
  - 缺失：放行（乐观更新，不阻塞）。
  - `*`：资源存在即匹配，放行。
  - 具体 version：与当前资源 version 比对，不匹配返回 **412** `SCIM_PRECONDITION_FAILED`。
- SP 端推荐流程：GET 获取资源 → 记录 ETag → PUT/PATCH/DELETE 时回传 `If-Match` → 收到 412 重新 GET 取最新 ETag 后重试。

#### 4.6.7 速率限制

| 类型 | 配额 | 窗口 | 适用 |
|------|------|------|------|
| `read` | 200 请求 | 60 秒 | GET /Users、GET /Groups 等 |
| `write` | 50 请求 | 60 秒 | POST/PUT/PATCH/DELETE |
| `discovery` | 500 请求 | 60 秒 | ServiceProviderConfig/ResourceTypes/Schemas（按 IP） |

超限返回 429 + `Retry-After` 头。SP 端须实现客户端节流与退避重试。

---

## 5. 请求/响应示例（端到端集成场景）

本节提供一个完整的身份供给端到端流程，AI Agent 可据此实现 SP 端 provisioning 同步逻辑。完整 TypeScript 参考客户端见附录 D。

### 5.1 场景：新员工入职 provisioning

**流程**：获取 token → 创建组 → 创建用户 → 将用户加入组 → 查询确认 → 更新用户 → 禁用用户 → 清理。

```bash
# 步骤 1：获取 access_token（oauth2 模式）
TOKEN=$(curl -s -X POST "https://<ISSUER_URL>/api/sso/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=client_xxx&client_secret=<secret>&scope=scim" \
  | jq -r '.access_token')

# 步骤 2：创建组
GROUP_ID=$(curl -s -X POST "https://<ISSUER_URL>/api/scim/v2/Groups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{ "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"], "displayName": "New-Hires-2026Q3" }' \
  | jq -r '.id')

# 步骤 3：创建用户
USER_ID=$(curl -s -X POST "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
    "userName": "jdoe2026",
    "name": { "familyName": "Doe", "givenName": "John" },
    "displayName": "John Doe",
    "emails": [{ "value": "jdoe2026@example.com", "primary": true }],
    "password": "TempPass123!",
    "active": true,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { "employeeNumber": "E2026-001", "department": "Engineering" }
  }' | jq -r '.id')

# 步骤 4：将用户加入组（PATCH add members）
curl -s -X PATCH "https://<ISSUER_URL>/api/scim/v2/Groups/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], "Operations": [ { "op": "add", "path": "members", "value": [{ "value": "'$USER_ID'" }] } ] }'

# 步骤 5：查询确认（filter + 属性投影）
curl -s -G "https://<ISSUER_URL>/api/scim/v2/Users" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'filter=userName eq "jdoe2026"' \
  --data-urlencode 'attributes=userName,displayName,active'

# 步骤 6：更新用户部门（PATCH enterprise 扩展）
curl -s -X PATCH "https://<ISSUER_URL>/api/scim/v2/Users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], "Operations": [ { "op": "replace", "path": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department", "value": "Sales" } ] }'

# 步骤 7：禁用用户（PATCH active=false，软删除语义）
curl -s -X PATCH "https://<ISSUER_URL>/api/scim/v2/Users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/scim+json" \
  -d '{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], "Operations": [ { "op": "replace", "path": "active", "value": false } ] }'

# 步骤 8：清理（物理删除用户 + 删除组）
curl -s -X DELETE "https://<ISSUER_URL>/api/scim/v2/Users/$USER_ID?mode=hard" -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE "https://<ISSUER_URL>/api/scim/v2/Groups/$GROUP_ID" -H "Authorization: Bearer $TOKEN"
```

### 5.2 场景：全量同步（轮询拉取）

SP 端定期拉取用户/组列表做全量同步：

```bash
# 分页拉取所有活跃用户
START=1
while true; do
  RESP=$(curl -s -G "https://<ISSUER_URL>/api/scim/v2/Users" \
    -H "Authorization: Bearer $TOKEN" \
    --data-urlencode 'filter=active eq true' \
    --data-urlencode "startIndex=$START" \
    --data-urlencode 'count=200')
  # 处理 RESP.Resources ...
  TOTAL=$(echo "$RESP" | jq '.totalResults')
  START=$((START + 200))
  [ $START -gt $TOTAL ] && break
done
```

> 全量同步注意速率限制（read 200/分钟）；大规模目录建议分时段拉取。

### 5.3 典型错误响应示例

**404 资源不存在**：
```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "User <id> not found", "status": "404" }
```

**409 userName 重复**：
```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "User with userName 'jdoe' already exists", "status": "409", "scimType": "uniqueness" }
```

**400 缺少必填 name.familyName**：
```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "<Zod 校验错误描述>", "status": "400", "scimType": "invalidValue" }
```

**412 ETag 不匹配**：
```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "detail": "ETag precondition failed: resource version mismatch", "status": "412" }
```

---

## 6. 错误处理机制

### 6.1 错误响应格式

所有 SCIM API 错误使用 SCIM 标准错误格式：

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "<人类可读错误描述>",
  "status": "<HTTP 状态码字符串>",
  "scimType": "<可选，SCIM 标准子类型>"
}
```

`scimType` 取值（RFC 7644 §3.12）：`invalidFilter` / `tooMany` / `uniqueness` / `mutability` / `invalidSyntax` / `invalidPath` / `noTarget` / `invalidValue` / `invalidVers`。

> **注意**：token 端点（`/api/sso/token`）与 DCR 端点（`/api/sso/register`）的错误响应使用 OAuth 标准格式 `{error, error_description}`，**非 SCIM 格式**。

### 6.2 错误码完整清单

| 错误码 | HTTP | scimType | 含义 | 触发场景 | 处理策略 |
|--------|------|----------|------|----------|----------|
| `SCIM_RESOURCE_NOT_FOUND` | 404 | — | 资源不存在 | GET/PUT/PATCH/DELETE 不存在的 id | 核对 id（entryUUID），勿重试 |
| `SCIM_UNIQUENESS_VIOLATION` | 409 | `uniqueness` | 唯一性冲突 | userName/displayName 重复 | 换唯一值 |
| `SCIM_USER_ALREADY_EXISTS` | 409 | `uniqueness` | 用户已存在 | 同上 | 换 userName |
| `SCIM_VALUE_INVALID` | 400 | `invalidValue` | 值非法 | add/replace 缺 value、PUT 改 immutable userName | 修正字段值 |
| `SCIM_SYNTAX_INVALID` | 400 | `invalidSyntax` | 语法错误 | remove 带 value、pathless 非对象 | 修正请求体语法 |
| `SCIM_PATH_INVALID` | 400 | `invalidSyntax` | path 缺失 | path-less PATCH（开关 on 时） | 补 path 字段 |
| `SCIM_FILTER_INVALID` | 400 | `invalidFilter` | filter 语法非法 | filter 表达式错误 | 检查 filter 语法 |
| `SCIM_TARGET_NOT_FOUND` | 400 | `noTarget` | PATCH 路径目标不存在 | 子属性过滤目标不存在 | 检查 path 表达式 |
| `SCIM_RESULT_TOO_MANY` | 400 | `tooMany` | 结果过多 | 超 maxResults:200 | 收窄 filter 或分页 |
| `SCIM_PERMISSION_DENIED` | 403 | `mutability`/无 | 权限不足或属性只读 | SP 无操作/属性权限 | 核对 scimResourcePermissions |
| `SCIM_AUTH_FAILED` | 401 | — | 认证失败 | 无效/过期 token | 重新获取 token / 检查 API Key |
| `SCIM_AUTH_TOKEN_EXPIRED` | 401 | — | Token 过期 | token 过期 | 重新获取 token |
| `SCIM_AUTH_SCOPE_INSUFFICIENT` | 403 | — | scope 不足 | scope 不含 `scim` | 申请 `scim` scope |
| `SCIM_AUTH_API_KEY_INVALID` | 401 | — | API Key 无效 | API Key 不匹配 | 重新生成 API Key |
| `SCIM_AUTH_MODE_MISMATCH` | 403 | — | 认证模式不匹配 | oauth2 client 用 API Key 或反之 | 切换匹配的认证方式 |
| `SCIM_PRECONDITION_FAILED` | 412 | — | ETag 不匹配 | If-Match 与当前 version 不符 | 重新 GET 取最新 ETag 后重试 |
| `SCIM_RATE_LIMITED` | 429 | — | 速率限制 | 超限额 | 按 Retry-After 退避重试 |
| `SCIM_PAYLOAD_TOO_LARGE` | 413 | — | 请求体超限 | Content-Length > 1MB | 拆分请求 |
| `SCIM_MEDIA_UNSUPPORTED` | 415 | — | Content-Type 不支持 | 非 scim+json/json | 改用 `application/scim+json` |
| `SCIM_METHOD_NOT_ALLOWED` | 405 | — | 方法不允许 | OPTIONS 等 | 核对端点支持的方法 |
| `SCIM_FEATURE_NOT_IMPLEMENTED` | 501 | — | 功能未实现 | /Me、Bulk、集合端点 PUT/DELETE | 等后续版本 |
| `SCIM_USER_CREATE_FAILED` | 500 | — | LDAP userAdd 失败 | 非冲突的 LDAP 错误 | 联系运维查 LDAP |
| `SCIM_USER_UPDATE_FAILED` | 500 | — | 用户更新失败 | LDAP 更新异常 | 联系运维 |
| `SCIM_USER_DELETE_FAILED` | 500 | — | 用户删除失败 | LDAP 删除异常 | 联系运维 |
| `SCIM_GROUP_CREATE_FAILED` | 500 | — | LDAP groupAdd 失败 | 非冲突的 LDAP 错误 | 联系运维 |
| `SCIM_GROUP_UPDATE_FAILED` | 500 | — | 组更新失败 | LDAP 更新异常 | 联系运维 |
| `SCIM_GROUP_DELETE_FAILED` | 500 | — | 组删除失败 | LDAP 删除异常 | 联系运维 |

管理后台错误码（非 SCIM 协议层，SP 端一般不接触）：`SCIM_CLIENT_INFO_FETCH_FAILED`、`SCIM_CLIENT_APIKEY_RESET_FAILED`。

### 6.3 错误处理策略

| HTTP | 是否重试 | 策略 |
|------|----------|------|
| 400 | 否 | 修正请求参数/请求体后重发 |
| 401 | 是（1 次） | 失效 token 缓存，重新获取 token 后重试一次 |
| 403 | 否 | 核对权限/scope，联系 IDP 管理员调整 Client 权限 |
| 404 | 否 | 核对 id；provisioning 场景可视为"已删除" |
| 409 | 否 | 换唯一值（userName/displayName） |
| 412 | 是 | 重新 GET 取最新 ETag，合并变更后重试 |
| 413/415 | 否 | 拆分请求 / 修正 Content-Type |
| 429 | 是 | 按 `Retry-After` 头退避，指数退避重试 |
| 5xx | 是 | 指数退避重试（建议 3 次，间隔 1s/2s/4s）；持续失败告警 |
| 501 | 否 | 功能未实现，规避该端点 |

**重试幂等性**：
- POST 创建：非幂等，409 后勿盲目重试（可能已创建成功）。
- PUT/PATCH/DELETE：幂等性依赖 If-Match；建议带 ETag 重试。
- GET：幂等，可自由重试。

---

## 7. 测试验证流程

### 7.1 集成自检 Checklist

SP 端集成完成后，按以下顺序自检：

- [ ] **服务发现**：`GET /ServiceProviderConfig` 返回 200，确认 `patch/filter/sort/etag/changePassword.supported=true`、`bulk.supported=false`。
- [ ] **认证**：
  - oauth2：`POST /api/sso/token` 获取 token，`scope` 含 `scim`。
  - apikey：用 API Key 调 `GET /Users` 返回 200。
- [ ] **权限**：调写操作前确认 Client `operations` 含对应权限，否则返回 403。
- [ ] **Users CRUD**：创建 → 查询 → PUT 更新 → PATCH 更新 → 软删除 → 物理删除，全流程通过。
- [ ] **Groups CRUD**：创建 → 查询 → PUT 替换 members → PATCH 增删成员 → 删除，全流程通过。
- [ ] **filter**：`userName eq "x"`、`active eq true`、`emails co "x"`、`and` 组合均生效。
- [ ] **sort/分页**：`sortBy=userName&sortOrder=ascending`、`startIndex`/`count` 生效；`count=0` 仅返回 totalResults。
- [ ] **属性投影**：`attributes=userName,displayName` 正确过滤；`id`/`schemas`/`meta` 始终返回。
- [ ] **ETag**：GET 记录 ETag → PUT 带 `If-Match` 成功 → 用旧 ETag 触发 412。
- [ ] **错误处理**：404/409/400/401/403/412/429 各触发一次并正确处理。
- [ ] **EnterpriseUser**：创建带 enterprise 扩展的用户，响应 schemas 含 enterprise URN。
- [ ] **changePassword**：PATCH password 成功，响应不含 password。

### 7.2 使用项目现成测试命令验证

本项目自带完整 SCIM 测试套件，SP 端可参考其断言验证自身集成。**运行前提**：IDP dev server 运行（`npm run dev:test`）+ LDAP 可达 + 测试凭据配置。

#### 7.2.1 IDP 侧测试命令（运行目录 `/var/catnetweb`）

| 命令 | 作用 | 前提 |
|------|------|------|
| `npm run test:scim:all` | SCIM 全量测试（单元 + E2E） | 见下 |
| `npm run test:scim` | SCIM 单元测试聚合（API + 库 + 配置） | 无需外部服务 |
| `npm run test:scim:api` | SCIM API 层单元测试 | 无 |
| `npm run test:scim:unit` | SCIM 库单元测试 | 无 |
| `npm run test:e2e:scim-client` | SCIM Client E2E（Playwright） | IDP 运行 + LDAP + `SCIM_OAUTH2_CLIENT_ID/SECRET`、`SCIM_API_KEY`、`SCIM_TEST_USERNAME/GROUPNAME` |
| `npm run test:integration:scim-client` | SCIM Client LDAP 集成测试 | `LDAP_URL`/`LDAP_BIND_DN`/`LDAP_PASSWORD`/`LDAP_BASE_DN`（缺失则跳过） |

#### 7.2.2 SP 侧 E2E 测试命令（运行目录 `/var/catnetweb/test-sp`）

`test-sp` 模拟 SP 端，对 IDP 发起真实 SCIM 请求，是 SP 集成验证的最佳参考：

| 命令 | 作用 |
|------|------|
| `npm run test:e2e:scim:all` | SCIM 全量 E2E（UI + API 合规，99 测试） |
| `npm run test:e2e:scim-compliance` | API 合规层 E2E（HTTP 直调 IDP，88 测试） |
| `npm run test:e2e:scim:oauth2` | OAuth2 认证接入 E2E |
| `npm run test:e2e:scim:apikey` | API Key 认证接入 E2E |
| `npm run test:e2e:scim-discovery` | 服务发现 E2E |
| `npm run test:e2e:scim-users-crud` | Users CRUD E2E |
| `npm run test:e2e:scim-groups-crud` | Groups CRUD E2E |
| `npm run test:e2e:scim-patch` | PATCH 端点 E2E |
| `npm run test:e2e:scim-filter-operators` | filter 全操作符 E2E |
| `npm run test:e2e:scim-filter-pagination` | 过滤与分页 E2E |
| `npm run test:e2e:scim-sort-positive` / `-negative` | sort E2E |
| `npm run test:e2e:scim-etag` | ETag 并发控制 E2E |
| `npm run test:e2e:scim-enterprise-user` | EnterpriseUser 扩展 E2E |
| `npm run test:e2e:scim-password` | changePassword E2E |
| `npm run test:e2e:scim-attributes` | 属性投影 E2E |
| `npm run test:e2e:scim-pagination-edge` | 分页边界（count=0）E2E |
| `npm run test:e2e:scim-username-mutability` | userName 不可变性 E2E |
| `npm run test:e2e:scim-auth-mode-exclusion` | 认证模式互斥 E2E |
| `npm run test:e2e:scim-permission-deny` | 权限拒绝 E2E |
| `npm run test:e2e:scim-bulk-negative` | Bulk 负面 E2E（确认 501） |
| `npm run test:e2e:scim-me` | /Me 端点 E2E（确认 501） |

#### 7.2.3 SP 端测试环境变量

`test-sp/.env.test` 需配置（参考 `test-sp/.env.example`）：

| 变量名 | 说明 |
|--------|------|
| `SSO_ISSUER` | IDP 地址（默认 `http://localhost:3000`） |
| `SCIM_OAUTH2_CLIENT_ID` / `SCIM_OAUTH2_CLIENT_SECRET` | OAuth2 模式 SCIM Client 凭据（缺失则 OAuth2 测试 skip） |
| `SCIM_API_KEY` | API Key 模式凭据（缺失则 APIKey 测试 skip） |
| `SCIM_TEST_USERNAME` | 基线测试用户名（默认 `testuser`） |
| `SCIM_TEST_GROUPNAME` | 基线测试组名（默认 `testgroup`） |

> 本地运行 E2E 注意：IDP 须用 `npm run dev:test` 启动（含 `SSO_MOCK_ENABLED=1 APP_URL=http://localhost:3000` 等环境变量），否则 discovery issuer 不匹配会阻断测试。建议放宽 `RATE_LIMIT_*_MAX` 避免限流误报。

### 7.3 手动验证步骤（无 test-sp 时）

若无 test-sp，SP 端可用 curl/Postman 按 §5.1 端到端流程手动验证。关键断言：

1. POST /Users 返回 201，响应含 `id`、`Location`、`ETag` 头。
2. GET /Users/{id} 返回 200，`userName` 与创建一致。
3. PATCH 后 GET 确认字段已变更。
4. DELETE 后 GET 返回 404。
5. filter 查询 `totalResults` 与预期一致。

---

## 8. 最佳实践建议

### 8.1 性能优化

| 实践 | 说明 |
|------|------|
| **缓存 access_token** | oauth2 token 有效期 1 小时，进程内缓存并提前 60s 失效；避免每次请求换 token |
| **分页拉取** | 全量同步用 `count=200`（上限）分页，减少请求次数 |
| **收窄 filter** | 用精确 filter（`userName eq`）替代拉取全量再过滤；`id eq`/`userName eq` 走快路径 |
| **属性投影** | 列表查询用 `attributes=` 仅取所需字段，减少传输量；`id`/`schemas`/`meta` 始终返回 |
| **`count=0` 探测总数** | 需要总数但不需要数据时用 `count=0`，仅返回 `totalResults` |
| **客户端节流** | 控制请求频率在 read 200/min、write 50/min 内，避免 429 |
| **批量场景避免 Bulk** | Bulk 不支持；大批量操作用并发 PATCH（注意写限流 50/min） |

### 8.2 安全加固

| 实践 | 说明 |
|------|------|
| **凭据加密存储** | `client_secret`/API Key 须存于密钥管理服务或加密环境变量，禁止入库/入日志 |
| **最小权限原则** | Client `operations` 仅授予必需操作；敏感属性（`password`）用 `attributePermissions: none` 收窄 |
| **HTTPS** | 生产环境强制 HTTPS；token/凭据不得经明文 HTTP 传输 |
| **token scope 最小化** | 仅申请 `scim` scope |
| **ETag 防并发覆盖** | PUT/PATCH 带 `If-Match`，避免覆盖他人修改 |
| **凭据定期轮换** | 定期通过管理后台轮换 clientSecret/API Key |
| **认证模式选择** | 优先 oauth2（短期 token，泄露影响小）；API Key 泄露需立即重置 |
| **审计** | IDP 侧记录所有 SCIM 写操作审计事件（含 `scim_user_password_change`、`scim_user_delete` 等）；SP 侧也应记录同步日志 |
| **输入校验** | SP 侧对 `userName` 字符集 `^[a-zA-Z0-9._-]+$` 预校验，避免 400 往返 |

### 8.3 兼容性处理

| 场景 | 处理 |
|------|------|
| **userName immutable** | 创建后不可变更；PUT 须传与现状一致的 `userName`，或省略 |
| **userName 大小写归一化** | 存储时 toLowerCase；filter 用小写或依赖大小写不敏感 |
| **active 软删除语义** | DELETE 默认软删（`active=false`），条目仍存在；重新启用用 PATCH `active=true` |
| **emails 单值存储** | 后端仅存 1 个邮箱，多邮箱不持久化；响应仅返回 1 项 |
| **name.familyName 必填** | inetOrgPerson `sn` 强制；创建时必填，缺失返回 400 |
| **Group 空成员** | `groupOfNames` 要求至少一个 member，空成员组回退占位 DN |
| **Group displayName 不可 remove** | `cn` 是 RDN；只能 replace，不能 remove |
| **Content-Type** | POST/PUT/PATCH 必须用 `application/scim+json` 或 `application/json`，否则 415 |
| **filter URL 编码** | filter 含空格/引号须 `encodeURIComponent`，否则返回 400 |
| **ldapauth-scim 扩展常驻** | User 响应 schemas 始终含 ldapauth-scim URN；enterprise URN 仅在有数据时含 |
| **`active` filter 仅 eq** | 仅 User 支持，仅 `eq` 操作符；Group 无 `active` |
| **PATCH path 必填** | 默认 `SCIM_ENFORCE_PATH_REQUIRED=on`，path-less PATCH 返回 400 |
| **子属性过滤仅 eq** | `emails[type eq "work"]` 仅支持 `eq`，不支持其他操作符 |

### 8.4 常见踩坑

1. **DCR 不能创建 SCIM Client**：SCIM Client 只能由 IDP 管理员在管理后台创建；DCR 创建的是 SSO OIDC 客户端。
2. **API Key 也用 `Authorization: Bearer`**：不是 `X-API-Key`。
3. **oauth2/apikey 互斥**：oauth2 client 用 API Key 调用返回 403，反之亦然。
4. **client_credentials 不返回 refresh_token**：token 过期需重新请求 `/api/sso/token`。
5. **secret/API Key 明文仅返回一次**：创建/重置时立即保存，丢失只能重置。
6. **token 端点用 form-urlencoded**：不是 JSON，Content-Type 应为 `application/x-www-form-urlencoded`。
7. **`id` 是 entryUUID**：不是 `userName`；GET/PUT/PATCH/DELETE 路径用 `id`。
8. **PUT 不含 password**：密码修改只能走 PATCH `password`。
9. **Bulk 不支持**：无 `/Bulk` 端点，返回 501。
10. **`/Me` 返回 501**：机器令牌场景未实现。
11. **token 端点错误不是 SCIM 格式**：是 OAuth 标准格式 `{error, error_description}`。
12. **`SCIM_ENABLE_WRITE_METHODS=off` 时写操作 501**：IDP 紧急回滚会启用此开关，SP 端须能处理 501。

---

## 附录

### 附录 A：环境变量清单

#### A.1 SCIM 专项

| 变量名 | 默认值 | 说明 | 敏感 |
|--------|--------|------|------|
| `ISSUER_URL` | — | IDP 签发地址，决定 SCIM API 基址与 token 端点 | 否 |
| `SCIM_ENABLE_WRITE_METHODS` | `on` | 写方法开关；`off` 回退只读 + PATCH | 否 |
| `SCIM_ENFORCE_PATH_REQUIRED` | `on` | PATCH path 必填开关 | 否 |

#### A.2 SCIM 测试凭据（test-sp）

| 变量名 | 说明 | 敏感 |
|--------|------|------|
| `SCIM_OAUTH2_CLIENT_ID` | OAuth2 模式 SCIM Client ID | 是 |
| `SCIM_OAUTH2_CLIENT_SECRET` | OAuth2 模式 SCIM Client Secret | 是 |
| `SCIM_API_KEY` | API Key 模式 Bearer Token | 是 |
| `SCIM_OAUTH2_MODE_API_KEY` | 认证模式互斥测试专用（oauth2 client 的残留 API Key） | 是 |
| `SCIM_TEST_USERNAME` | 基线测试用户名（默认 `testuser`） | 否 |
| `SCIM_TEST_GROUPNAME` | 基线测试组名（默认 `testgroup`） | 否 |
| `SSO_ISSUER` | IDP 地址（默认 `http://localhost:3000`） | 否 |

#### A.3 SSO / LDAP 相关

| 变量名 | 说明 | 敏感 |
|--------|------|------|
| `LDAP_URL` | LDAP 服务地址 | 否 |
| `LDAP_BIND_DN` | 绑定 DN | 是 |
| `LDAP_PASSWORD` | 绑定密码 | 是 |
| `LDAP_BASE_DN` | 根 base DN | 否 |
| `LDAP_USER_BASE_DN` | 用户 base DN | 否 |
| `LDAP_GROUP_BASE_DN` | 组 base DN | 否 |
| `SSO_DCR_ENABLED` | DCR 开关（仅影响 SSO OIDC 客户端，与 SCIM Client 无关），默认 `false` | 否 |
| `SSO_DCR_INITIAL_ACCESS_TOKEN` | DCR Initial Access Token | 是 |
| `REDIS_URL` | Redis（SSO 临时数据、速率限制），可选 | 否 |
| `RATE_LIMIT_SSO_TOKEN_MAX` | token 端点限流（测试环境建议放宽） | 否 |

### 附录 B：HTTP 状态码速查

| 状态码 | 场景 |
|--------|------|
| 200 | GET/PATCH/PUT 成功 |
| 201 | POST 创建成功 |
| 204 | DELETE 成功（无 body） |
| 400 | 请求体校验失败、PATCH 语法错误、值非法、filter 语法错误 |
| 401 | 认证失败（缺 Authorization、token 无效/过期） |
| 403 | 权限不足、scope 不足、client 未激活、认证模式不匹配、属性只读 |
| 404 | 资源不存在 |
| 405 | 方法不允许（如 OPTIONS） |
| 409 | 唯一性冲突（userName/displayName 重复） |
| 412 | ETag If-Match 不匹配 |
| 413 | 请求体超过 1MB |
| 415 | Content-Type 不支持 |
| 429 | 速率限制 |
| 500 | 内部错误（LDAP 异常等） |
| 501 | 功能未实现（/Me、Bulk、集合端点 PUT/DELETE） |

### 附录 C：字段映射表（SCIM ↔ LDAP）

#### C.1 User 映射

| SCIM 字段 | LDAP 属性 | 说明 |
|-----------|-----------|------|
| `id` | `entryUUID` | readOnly，global 唯一 |
| `userName` | `uid` | immutable，server 唯一，toLowerCase 归一化 |
| `name.formatted` | `cn` | readOnly，returned:'never'，响应不输出 |
| `name.familyName` | `sn` | 必填，不可 remove |
| `name.givenName` | `givenName` | 可移除 |
| `displayName` | `displayName` | 回退 `cn` |
| `emails.value` | `mail` | 仅存 1 项 |
| `active` | `pwdEndTime`（计算） | 无 pwdEndTime→true；有且未过期→true；否则 false |
| `password` | `userPassword` | writeOnly，returned:'never' |
| `groups` | `memberOf`（计算） | readOnly, computed |
| `meta.created` | `createTimestamp` | 转 ISO 8601 |
| `meta.lastModified` | `modifyTimestamp` | 转 ISO 8601 |
| `meta.version` | `entryCSN`（优先）/`modifyTimestamp` | ETag 来源 |
| `ldapauth-scim:accountExpiresAt` | `pwdEndTime` | dateTime |
| `enterprise:employeeNumber` | `employeeNumber` | 直接映射 |
| `enterprise:department` | `departmentNumber` | SCIM 名 ≠ LDAP 名 |
| `enterprise:manager` | `manager`（DN 引用） | onRead DN→entryUUID+cn；onWrite entryUUID→DN |

LDAP 基础 filter：`(objectClass=inetOrgPerson)`。

#### C.2 Group 映射

| SCIM 字段 | LDAP 属性 | 说明 |
|-----------|-----------|------|
| `id` | `entryUUID` | readOnly |
| `displayName` | `cn` | 必填（RDN），不可 remove |
| `members` | `member` | multiValued；onRead DN→entryUUID+cn；onWrite 走 groupMembershipService |
| `meta.version` | `entryCSN`/`modifyTimestamp` | ETag 来源 |

LDAP 基础 filter：`(objectClass=groupOfNames)`。

### 附录 D：TypeScript 参考客户端实现

> 以下为最小可运行的 SP 端 SCIM 客户端参考实现，覆盖 token 缓存、CRUD、PATCH、ETag、错误处理。AI Agent 可据此移植到目标 SP 项目。

```typescript
// scim-client.ts —— SP 端 SCIM 2.0 参考客户端
const SCIM_BASE = `${process.env.SSO_ISSUER}/api/scim/v2`;
const TOKEN_URL = `${process.env.SSO_ISSUER}/api/sso/token`;

interface ScimError extends Error {
  status?: number;
  scimType?: string;
  detail?: string;
}

// 1. Token 缓存（oauth2 模式）
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value; // 提前 60s 失效
  }
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SCIM_OAUTH2_CLIENT_ID!,
      client_secret: process.env.SCIM_OAUTH2_CLIENT_SECRET!,
      scope: 'scim',
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw Object.assign(new Error(`token failed: ${err.error_description ?? resp.status}`));
  }
  const data = await resp.json();
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

// 2. 通用请求（含 401 重试 + 错误归一化）
async function scimRequest(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/scim+json',
    ...(init.body ? { 'Content-Type': 'application/scim+json' } : {}),
    ...(init.headers ?? {}),
  } as Record<string, string>;
  const resp = await fetch(`${SCIM_BASE}${path}`, { ...init, headers });
  // 401 → 失效 token 并重试一次
  if (resp.status === 401 && retry) {
    cachedToken = null;
    return scimRequest(path, init, false);
  }
  if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
    const body = await resp.json().catch(() => ({}));
    const err = new Error(body.detail ?? `SCIM ${resp.status}`) as ScimError;
    err.status = resp.status;
    err.scimType = body.scimType;
    throw err;
  }
  return resp;
}

// 3. Users CRUD
export async function createUser(user: object) {
  const resp = await scimRequest('/Users', { method: 'POST', body: JSON.stringify(user) });
  return { data: await resp.json(), etag: resp.headers.get('etag') };
}

export async function getUser(id: string) {
  const resp = await scimRequest(`/Users/${id}`);
  return { data: await resp.json(), etag: resp.headers.get('etag') };
}

export async function listUsers(params: { filter?: string; startIndex?: number; count?: number; attributes?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.filter) qs.set('filter', params.filter);
  if (params.startIndex) qs.set('startIndex', String(params.startIndex));
  if (params.count) qs.set('count', String(params.count));
  if (params.attributes) qs.set('attributes', params.attributes);
  const resp = await scimRequest(`/Users?${qs}`);
  return resp.json();
}

export async function patchUser(id: string, operations: object[], ifMatch?: string) {
  const resp = await scimRequest(`/Users/${id}`, {
    method: 'PATCH',
    headers: ifMatch ? { 'If-Match': ifMatch } : {},
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: operations,
    }),
  });
  return { data: await resp.json(), etag: resp.headers.get('etag') };
}

export async function deleteUser(id: string, mode: 'soft' | 'hard' = 'soft') {
  await scimRequest(`/Users/${id}${mode === 'hard' ? '?mode=hard' : ''}`, { method: 'DELETE' });
}

// 4. Groups CRUD（结构同 Users，路径换 /Groups）
export async function createGroup(group: object) {
  const resp = await scimRequest('/Groups', { method: 'POST', body: JSON.stringify(group) });
  return { data: await resp.json(), etag: resp.headers.get('etag') };
}

export async function addGroupMember(groupId: string, userEntryUUID: string) {
  return patchGroup(groupId, [
    { op: 'add', path: 'members', value: [{ value: userEntryUUID }] },
  ]);
}

export async function patchGroup(id: string, operations: object[], ifMatch?: string) {
  const resp = await scimRequest(`/Groups/${id}`, {
    method: 'PATCH',
    headers: ifMatch ? { 'If-Match': ifMatch } : {},
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: operations,
    }),
  });
  return { data: await resp.json(), etag: resp.headers.get('etag') };
}

// 5. 退避重试包装（429/5xx）
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as ScimError;
      const retryable = err.status === 429 || (err.status && err.status >= 500);
      if (!retryable || i >= maxRetries) throw e;
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

**使用示例**：

```typescript
// 创建用户并加入组（带 ETag 并发控制与重试）
const { data: user, etag } = await withRetry(() =>
  createUser({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: 'jdoe',
    name: { familyName: 'Doe', givenName: 'John' },
    emails: [{ value: 'jdoe@example.com', primary: true }],
    password: 'StrongP@ss123',
    active: true,
  })
);

// 修改部门（PATCH enterprise 扩展，带 If-Match）
await withRetry(() =>
  patchUser(user.id, [
    { op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Sales' },
  ], etag ?? undefined)
);
```

### 附录 E：关键文件索引

| 文件 | 用途 |
|------|------|
| `app/api/scim/v2/**/route.ts` | SCIM 端点路由（Users/Groups/Me/ServiceProviderConfig/ResourceTypes/Schemas） |
| `app/lib/scim/core/scim-handler.ts` | 横切关注层（认证/限流/权限/审计/ETag/请求体校验） |
| `app/lib/scim/core/scim-auth.ts` | 认证（OAuth2 + API Key 双路径） |
| `app/lib/scim/core/scim-permission-engine.ts` | 权限引擎（资源/操作/属性级） |
| `app/lib/scim/core/scim-user-service.ts` / `scim-user-write-service.ts` | User 读/写服务 |
| `app/lib/scim/core/scim-group-service.ts` / `scim-group-write-service.ts` | Group 读/写服务 |
| `app/lib/scim/core/user-attribute-registry.ts` | User 属性注册表（含 ldapauth-scim 扩展） |
| `app/lib/scim/core/group-attribute-registry.ts` | Group 属性注册表 |
| `app/lib/scim/core/enterprise-user-attribute-registry.ts` | Enterprise 扩展属性注册表 |
| `app/lib/scim/config/scim-capabilities.ts` | 能力声明（单一数据源） |
| `app/lib/scim/config/scim-discovery.ts` | 服务发现端点响应构造 |
| `app/lib/scim/utils/scim-filter.ts` | filter 递归下降解析器 |
| `app/lib/scim/utils/scim-pagination.ts` | 分页 + 属性投影 |
| `app/lib/scim/utils/scim-sort.ts` | 应用层排序 |
| `app/lib/scim/utils/scim-errors.ts` | 错误响应工具（ETag 校验） |
| `app/lib/scim/utils/scim-rate-limit.ts` | 速率限制 |
| `app/lib/scim/validations/scim-patch.ts` | PATCH 校验（path 必填灰度） |
| `app/lib/scim/validations/scim-user-schema.ts` / `scim-group-schema.ts` | Zod 资源校验 |
| `app/lib/scim/types/scim-error-codes.ts` | SCIM 错误码与 scimType 枚举 |
| `app/lib/scim/core/scim-client-service.ts` | SCIM Client 业务服务（CRUD + 凭证轮换） |
| `app/lib/scim/core/storage/ldap-scim-client-repository.ts` | SCIM Client LDAP 存储 |
| `app/api/sso/token/route.ts` | OAuth2 token 端点 |
| `app/api/sso/register/route.ts` | DCR 端点（SSO OIDC 客户端，非 SCIM Client） |
| `docs/specs/spec-scim-improvement-v1.0.md` | SCIM 需求规格（FR/NFR） |
| `docs/architecture/arch-scim-improvement-v1.0.md` | SCIM 架构设计（ADR） |
| `docs/architecture/scim-client-schema.ldif` | SCIM Client LDAP schema 权威定义 |
| `docs/changelog/` | SCIM 演进历史（19 份相关 changelog） |
| `test-sp/tests/scim-*.spec.ts` | SP 侧 E2E 测试（20 个，最佳参考） |

---

> **反馈与维护**：本指南基于 2026-08-06 代码状态编写。如发现与实际行为不符，请以 `docs/specs/spec-scim-improvement-v1.0.md`（approved）与代码实现为准，并反馈修订。
