# 后台管理员框架 需求规格文档

**版本**：v1.5
**状态**：approved
**创建时间**：2026-08-20
**最后更新**：2026-08-21

## 变更记录

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-08-20 | 初稿（讨论稿形态：方案对比、实施范围与任务拆解） | — |
| v1.1 | 2026-08-20 | 并入待确认问题答复，补充会话机制说明 | — |
| v1.2 | 2026-08-20 | 全部待确认问题已答复，明确 D/E 双路径与决策清单 | — |
| v1.3 | 2026-08-20 | 根据 r1 评审重组为正式 spec：补背景与目标/用户故事/FR/NFR/边界/AC 六章，原讨论稿章节降为附录；修订守卫复用方式（R1-002）、Edge 复用风险（R1-003）、测试策略矛盾（R1-004）及 11 项建议级问题，并入需求方决策 A1-A4 | review-r1 |
| v1.4 | 2026-08-20 | 根据 r2 评审修订：路由分组隔离、并集守卫语义、守卫降级、8 项表述精确化 | review-r2 |
| v1.5 | 2026-08-21 | 根据 r3 实施前终评勘误修订：上游引用修正（F-001）；AC-016 补 SSO 粗检前置条件（F-003）；§5 声明 D 管理员登出边界（F-004）；§3.5 声明对 auth spec FR-028/029 的扩展关系（F-005）；FR-003 明确无条件必填（F-006）；AC-019 增 Set-Cookie 硬性断言、附录 C 任务 12 扩运维条目交付（arch r3 R3-003/R3-004 联动） | review-r3 |

---

## 1. 背景与目标

项目已有三层认证链并全部验收：middleware 限流 + Edge 粗检（仅解码 JWT exp 不验签）、Node 层 `guard.ts` 完整验签（RS256 + kid + JWKS + iss/aud/exp，fail-closed）、`/login` → OIDC 登录链路（落 `sso_access_token` / `sso_refresh_token` / `sso_id_token` 三 cookie）。当前不存在任何管理端能力。

本次引入**后台管理员框架**，解决两类问题：

1. **授权缺失**：SSO 认证只能证明「用户已登录」，无法区分「管理员」与「普通用户」。需要新增管理员授权层——在白名单内的 SSO 用户获得管理资格，与普通用户共用同一登录链路，零 IDP 配置成本。
2. **应急通道缺失**：后台运营可能发生在 IDP（auth.happyrabbit.top）不可达时（数据库整合进度曾遗留 T8 阻塞，现已恢复）。需要一条完全独立于 IDP 的本地管理员认证面，保证任何情况下管理员可进入后台。

目标：新增**本地管理员凭据登录** + **管理员授权守卫** + `/admin` 框架（Dashboard + 用户管理/资源管理**空框架入口**）。本期不做任何资源管理业务、不做用户管理业务、不建 DB 表。

预期效果：

- D 路径（SSO 管理员）：与普通用户完全一致走 SSO 登录，仅 `sso_sub ∈ ADMIN_SSO_SUBS` 时获得管理员资格；IDP 恢复后此路径可实跑验证。
- E 路径（本地管理员）：IDP 不可用时经 `/admin/login` 本地凭据登录，发独立 `admin_session` cookie，15 分钟有效。
- 两条会话独立并存、互不干扰；管理登录/登出可审计。

## 2. 用户故事

- 作为**管理员**，我想要直接访问 `/admin` 进入后台（SSO 已登录且 sub 在白名单），以便快速开始管理，无需二次登录。
- 作为**管理员**，我想要在 IDP 不可用时通过 `/admin/login` 输入本地用户名密码进入后台，以便应急访问不受单点故障影响。
- 作为**管理员**，我想要在后台看到「用户管理」「资源管理」入口与范围说明，以便了解当前管理能力边界。
- 作为**管理员**，我想要登出后台时仅清除本地会话，以便不影响 SSO 登录态（两条会话独立）。

## 3. 功能需求

### 3.1 环境变量与配置

- **FR-001**：定义 4 个 admin 环境变量：`ADMIN_SSO_SUBS`（D 路径白名单，逗号分隔 sub）、`ADMIN_LOCAL_USERNAME`、`ADMIN_LOCAL_PASSWORD`（E 路径凭据，明文静态存储）、`ADMIN_SESSION_SECRET`（admin_session 签名密钥）。`NEXT_PUBLIC_` 前缀一律禁止（引用 **auth spec FR-024**、同 token spec FR-021：敏感值禁止暴露到浏览器；F-001 勘误）。
- **FR-002**：`getAdminConfig()` 提供解析后的 admin 配置，`validateAdminEnvVars()` 在 `getAdminConfig()` 首次调用时惰性校验（沿用 `getSsoEnv()` 模式）。校验逻辑独立放 `app/lib/admin/config.ts`，**不并入** `app/lib/env.ts` 的 `validateEnv()`（admin 变量不作全站启动/首次校验的硬性要求，仅后台使用）。
- **FR-003**：`validateAdminEnvVars()` 校验规则：`ADMIN_SESSION_SECRET` 长度 ≥ 32 字符；`ADMIN_LOCAL_USERNAME` / `ADMIN_LOCAL_PASSWORD` 非空（**无条件必填**：E 路径为常备应急通道而非可选部署形态，不支持 D-only 部署，与 AC-003 同口径；F-006）；`ADMIN_SSO_SUBS` 可为空（D 路径未启用），非空时逐项 trim 且过滤空串。
- **FR-004**：新增 Edge-safe 常量模块 `app/lib/admin/constants.ts`：仅字符串常量（如 `ADMIN_SESSION_COOKIE_NAME`），零依赖、无任何 import，middleware 与 `session.ts` 共同引用（对齐 `ACCESS_TOKEN_COOKIE_NAME` 从 token-cookie.ts 导入的既有模式）。

### 3.2 白名单判定

- **FR-005**：`isAdminSub(sub)` 纯函数：判定 `sub ∈ ADMIN_SSO_SUBS` 白名单成员（D 路径授权判定核心），可独立单测。

### 3.3 本地管理员会话

- **FR-006**：`signAdminSession(sub, name)` / `verifyAdminSession(token)`：HS256 HMAC JWT（jose，已在依赖中），载荷 `{sub, name, exp}`，有效期 15 分钟（900 秒）。
- **FR-007**：`admin_session` cookie 属性复用 `token-cookie.ts` 导出的 `cookieSecure()`（将原模块私有函数改为 `export`，一行改动）：`httpOnly` + `sameSite=lax` + `path=/` + `secure` 仅生产环境（`cookieSecure()`）+ `maxAge=900`。
- **FR-008**：`verifyAdminSession` 验签失败/过期/载荷非法 → 返回 `ADMIN_SESSION_INVALID`。`session.ts` **不导出**供 Edge 使用的函数（模块含 node:crypto 与 `ADMIN_SESSION_SECRET` 引用，导入会污染 Edge 包）。

### 3.4 授权守卫

- **FR-009**：`app/lib/auth/guard.ts` 仅将 `verifyAccessToken` 由模块私有改为 `export`（一行改动，无行为变化），SSO 守卫（`requireAuth` / `requireAuthPage`）逻辑不动。
- **FR-010**：`app/lib/admin/guard.ts` 新增 `requireAdminPage(): Promise<AdminClaims>`（RSC 页面守卫；`AdminClaims { sub: string; name?: string }` 为归一化返回类型——D 路径 `name` 不保证存在，缺失时展示回退 `sub`）：自行读 cookie，**D 路径优先**——存在 `sso_access_token` → 调 `verifyAccessToken` 完整验签 → 验签通过且 `isAdminSub` 白名单命中 → 返回 D 路径 claims 放行；验签通过但 sub 不在白名单 → 置 `ssoValidButNotAdmin` 标记，继续尝试 E 路径（并集语义，见 FR-011）；验签失败 → 清 SSO 三 cookie（见 FR-012）后继续尝试 E 路径。无 SSO 或 SSO 分支处理完毕 → 尝试 **E 路径**——存在 `admin_session` → `verifyAdminSession` 完整验签 → 有效则放行（返回 E 路径 claims），无效则清 `admin_session`（见 FR-013）。失败路径由本守卫自行控制，不委托 `requireAuthPage`。
- **FR-011**：D 路径**授权失败**（SSO 验签有效但 sub 不在白名单）→ 不直接拒绝，先尝试 E 路径（并集语义）：`admin_session` 有效则放行；仅当 E 路径亦无效（无 `admin_session` 或验签失败）才 `redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')`，**不清 SSO cookie**（授权失败非会话失败，保留 SSO 登录态）。
- **FR-012**：D 路径**验签失败**（SSO token 非法/过期）→ 清除 `sso_access_token` / `sso_refresh_token` / `sso_id_token` 三 cookie（对齐 `requireAuthPage` 的清 cookie 语义），继续尝试 E 路径。
- **FR-013**：E 路径 `admin_session` 验签失败 → 清除 `admin_session` cookie。
- **FR-014**：SSO 与 admin_session **均验签失败**（双失败，含两者均缺失）→ 清对应 cookie + `redirect('/admin/login')`（RSC 守卫无路径来源，**不携带 returnTo**；middleware 层的 302 仍带 `?returnTo=<原路径>`，见 FR-016）。

### 3.5 中间件扩展

> 本节是对 auth spec FR-028（公开白名单）与 FR-029（未认证 302 目标）的 **admin 域扩展**：`/admin/login` 为 admin 域登录入口（符合 FR-028 登录入口公开原则），`/admin/*` 的 302 目标由 `/login` 改为 `/admin/login`（F-005，v1.5）。

- **FR-015**：`/admin/login` 加入 `isPublicPath` 公开白名单（当前该路径会进 middleware 且被误 302 到 `/login`）。
- **FR-016**：`/admin/*`（非 `/admin/login`，含 `/admin` 精确路径）未认证页面请求 → `302 /admin/login?returnTo=<原路径>`，不再走 `/login`。
- **FR-017**：`/admin/*` 认证粗检同时认 SSO 与 `admin_session` 两种 cookie：SSO 粗检维持 `isSessionValid`；`admin_session` 粗检由 middleware 本地新增函数完成——复用自身通用 `decodeJwtExp`（仅 base64url 解码取 exp，不验签），**不 import 任何 admin 服务模块**（仅引 `constants.ts` 字符串常量）。
- **FR-018**：后台仅使用顶层路径（`/admin` 等），不做 locale 前缀处理。

### 3.6 登录页

- **FR-019**：`app/admin/login/page.tsx` 公开登录页（URL `/admin/login`；位于 `app/admin/login/` 目录，无守卫 layout，独立于 `(panel)` 路由分组）：本地管理员表单（E 路径，核心）+ SSO 登录入口（D 路径，复用现有 OIDC 授权链接与 `LoginButton`，`returnTo` 透传，登录成功回跳）。
- **FR-020**：交互组件位置 `app/admin/login/admin-login-client.tsx`（co-locate，对齐既有 `app/login/login-client.tsx` 模式）；页面文件 ≤ 300 行。
- **FR-021**：页面读取 URL `error` 参数并展示：`ADMIN_AUTH_FORBIDDEN` → 无权限提示文案（沿用 login-client 的 error 参数展示模式，错误仅展示安全通用文案，不展示原始 message）。
- **FR-022**：`/admin/login` 对已登录管理员做登录态粗检（仅解码 exp 不验签，对齐 `app/login/page.tsx` 的粗检语义；跳转目标固定 `/admin`，不做 returnTo 回跳）：`sso_access_token` 与 `admin_session` **任一存在且 exp 未过期** → 直接 `redirect('/admin')`。**例外**：URL 携带 `error` 参数（如 `ADMIN_AUTH_FORBIDDEN`）时跳过粗检跳转，直接渲染登录页展示错误——避免无权限用户陷入 `/admin ↔ /admin/login?error=...` 重定向循环（对应 login 页 `isLoginPath` 防死循环的同类处理）。

### 3.7 Server Actions

- **FR-023**：`loginAdminLocal(username, password, returnTo)`：Zod 校验输入（schema：`username` 必填 ≤ 64 字符、`password` 必填 ≤ 128 字符、`returnTo` 可选 ≤ 2048 字符；Zod 拒绝 → 返回 `ADMIN_AUTH_INVALID_INPUT`，不触达密码比较）→ 与 `.env` 中明文密码恒时比较（sha256 归一后 `timingSafeEqual`）→ 通过则 `signAdminSession` 签发并写 `admin_session` cookie（属性见 FR-007）→ 重定向：`isSafeReturnTo(returnTo) && !isLoginPath(returnTo)`（排除 `/admin/login` 自身及 `/{locale}/login` 形态，防登录页循环，语义对齐 `app/login/page.tsx`）才采用 `returnTo`，否则回退 `/admin`。
- **FR-024**：`loginAdminLocal` 凭据错误 → 不写 cookie，返回 `ADMIN_AUTH_INVALID_CREDENTIALS`，`auditLogger` 记录 `admin.login.failure`（code 关联该错误码）。
- **FR-025**：`loginAdminLocal` 登录成功 → `auditLogger` 记录 `admin.login.success`（subject 记录管理员标识）。
- **FR-026**：`logoutAdmin()`：删除 `admin_session` cookie → `redirect('/admin/login')`，**不清 SSO cookie**（两条会话独立，D 路径管理员登出后台不退出 SSO）；`auditLogger` 记录 `admin.logout.completed`。
- **FR-027**：`loginAdminLocal` 爆破防护依托既有 middleware 限流（20 次/分/IP，对 `/admin/login` 的 POST 请求生效，matcher 已覆盖）；该限流为 **per-IP 非 per-account**，属既有机制复用，不新增账号锁定。

### 3.8 后台框架页面

- **FR-028**：`app/admin/(panel)/layout.tsx` 管理框架（路由分组，URL 不变：`/admin`、`/admin/users`、`/admin/resources`；`app/admin/login/` 公开登录页不在分组内，不受本 layout 包裹）：侧边栏（用户管理 / 资源管理）+ 头部（管理员信息 + 登出按钮）；布局组件先执行 `requireAdminPage()`，头部管理员信息展示 `name ?? sub`（`AdminClaims` 归一化，见 FR-010）。
- **FR-029**：`app/admin/(panel)/page.tsx` Dashboard：两模块入口卡片 + 管理范围说明，**纯占位不查库**。
- **FR-030**：`app/admin/(panel)/users/page.tsx`、`app/admin/(panel)/resources/page.tsx` 空框架（占位，预留路由/导航）。
- **FR-031**：**不增加** Header「管理后台」入口，管理员仅直接访问 `/admin` 路径进入。

### 3.9 审计扩展

- **FR-032**：`app/lib/logging/audit-logger.ts` 的 `ERROR_CODE_PATTERN` 扩展为 `/^(AUTH|ADMIN)_[A-Z_]+$/`（admin 错误码可写入审计）。
- **FR-033**：`AuditEvent` 字符串字面量联合类型新增 `admin.login.success` / `admin.login.failure` / `admin.logout.completed` 三个事件字面量。

## 4. 非功能需求

- **NFR-001（安全）**：本地密码 `.env` 静态明文存储 + 恒时比较（sha256 归一后 `timingSafeEqual`，比较长度恒为 32 字节，规避长度不等抛错），**不引入 bcryptjs**。
- **NFR-002（安全）**：`ADMIN_SESSION_SECRET` 长度 ≥ 32 字符（HS256 最小安全密钥）；`admin_session` HS256 HMAC 15 分钟，无续期/刷新机制。
- **NFR-003（安全）**：`admin_session` cookie 属性：`httpOnly` + `sameSite=lax` + `path=/` + `secure` 仅生产环境 + `maxAge=900`（secure 判定复用 `token-cookie.ts` 导出的 `cookieSecure()`）。
- **NFR-004（安全）**：所有用户输入（登录表单）在 Server Action 内经 Zod 服务端验证，禁止信任客户端输入；爆破防护依托既有 middleware 限流（20 次/分/IP，per-IP 非 per-account）。
- **NFR-005（安全）**：Edge 不引密钥：middleware 对 `admin_session` 仅解码 exp 粗检不验签；`NEXT_PUBLIC_` 前缀变量一律禁止（auth spec FR-024，同 token spec FR-021；F-001 勘误）。
- **NFR-006（安全）**：管理登录/登出可审计：`admin.login.success` / `admin.login.failure` / `admin.logout.completed`，错误码走 `ADMIN_AUTH_*`（`ADMIN_AUTH_INVALID_CREDENTIALS` / `ADMIN_AUTH_FORBIDDEN` / `ADMIN_SESSION_INVALID` / `ADMIN_AUTH_INVALID_INPUT`）。
- **NFR-007（性能）**：middleware 粗检不新增外部调用与密钥运算（仅本地 base64url 解码）；守卫层完整验签仅在受保护页面请求时执行。
- **NFR-008（可访问性）**：登录表单控件带 label，错误提示带 `role="alert"`（对齐 login-client 展示模式）。
- **NFR-009（代码约束）**：单文件 ≤ 500 行、页面文件 ≤ 300 行、函数显式返回类型、禁止 `any`、跨模块引用使用 `@/` 绝对路径、文件 kebab-case 命名、Server Action 收敛于 `app/admin/actions.ts`。
- **NFR-010（运行时边界）**：middleware（Edge Runtime）与守卫/Server Action（Node Runtime）模块边界清晰：Edge 侧仅依赖 `constants.ts` 与自身本地函数，Node 侧持有密钥与验签逻辑。

## 5. 边界与排除项

- 不建 DB 表；不做用户管理业务、不做资源管理业务（仅空框架占位）。
- 不引入 bcryptjs（密码静态明文 + 恒时比较）。
- 方案 A（IDP 组声明）/ B（IDP 角色声明）/ C（入库名单）/ F（本地管理员入库）不采用。
- 不做 locale 多语言（项目仅中文环境，后台仅顶层路径）。
- 不增加 Header「管理后台」入口。
- 不新增 per-account 账号锁定（仅既有 per-IP 限流）。
- 不做 `admin_session` 续期/刷新（15 分钟固定，过期重新登录）。
- D 路径管理员登出后台为已知「弹回」行为：`logoutAdmin` 仅删 `admin_session`（D 管理员本无此 cookie）→ 审计 + redirect `/admin/login`，FR-022 粗检见有效 SSO 会话将再跳回 `/admin`（无死循环）；D 管理员真正退出需走全站 SSO 登出（F-004，v1.5）。
- 不做 SSO 组/角色声明判定（仅 sub 白名单，RBAC 分级见附录 F）。
- 「SSO 有效但 sub 不在白名单且无有效 admin_session → 拒绝」仅以单测覆盖，不写 E2E（需求方决策 A1、A5）。

## 6. 验收标准

### 6.1 配置与守卫

- [ ] **AC-001**：`verifyAccessToken` 已从 `guard.ts` 导出，`requireAuth` / `requireAuthPage` 行为无变化（既有 SSO 单测/集成测试全绿）。
- [ ] **AC-002**：`getAdminConfig()` 首次调用触发惰性校验；`ADMIN_SESSION_SECRET` 长度 < 32 时抛错。
- [ ] **AC-003**：`ADMIN_LOCAL_USERNAME` 或 `ADMIN_LOCAL_PASSWORD` 为空时校验抛错。
- [ ] **AC-004**：`ADMIN_SSO_SUBS` 为空或全空白 → D 路径未启用（`isAdminSub` 恒为 false）；非空时逐项 trim 且过滤空串。
- [ ] **AC-005**：`ADMIN_SESSION_COOKIE_NAME` 定义于 `app/lib/admin/constants.ts`（零依赖、无 import），middleware 与 `session.ts` 共同引用。
- [ ] **AC-006**：`requireAdminPage` 对合法 SSO token + sub 在白名单 → 放行并返回 `AdminClaims`（结构含 `sub`；`name` 缺失时头部展示回退 `sub`；D 路径通过）。
- [ ] **AC-007**：`requireAdminPage` 对合法 SSO token + sub 不在白名单 **且无有效 admin_session** → redirect `/admin/login?error=ADMIN_AUTH_FORBIDDEN`，且 SSO 三 cookie 未被清除。
- [ ] **AC-008**：`requireAdminPage` 对非法 SSO token + 合法 admin_session → 清 SSO 三 cookie，经 E 路径放行。
- [ ] **AC-009**：`requireAdminPage` 对 SSO 与 admin_session 均验签失败/缺失 → 清对应 cookie + redirect `/admin/login`（302，returnTo 可选——middleware 层携带、Node 守卫层不携带）。
- [ ] **AC-010**：`requireAdminPage` 对无 SSO + 合法 admin_session → 经 E 路径放行。
- [ ] **AC-011**：`verifyAdminSession` 对过期/篡改/非 HS256 token 返回 `ADMIN_SESSION_INVALID`。

### 6.2 会话与中间件

- [ ] **AC-012**：`signAdminSession` 产物为 HS256 JWT，载荷含 `sub`/`name`/`exp`，`exp` = 签发时间 + 900s，可被 `verifyAdminSession` 通过。
- [ ] **AC-013**：`admin_session` cookie 属性：`httpOnly` + `sameSite=lax` + `path=/` + `maxAge=900`；生产环境 `secure=true`，非生产 `secure=false`。
- [ ] **AC-014**：middleware 对 `/admin/login` 直接放行（白名单豁免）。
- [ ] **AC-015**：middleware 对无有效 cookie 的 `/admin` 及 `/admin/*`（非 login）→ 302 `/admin/login?returnTo=<原路径>`。
- [ ] **AC-016**：middleware 对 `admin_session` exp 未过期的 `/admin/*` → 放行；exp 过期 → 302 `/admin/login`（**且无有效 SSO 粗检会话时**——粗检为 SSO∨admin_session 或语义，F-003，v1.5）。
- [ ] **AC-017**：middleware 源码不 import 任何 admin 服务模块（仅 `constants.ts` 字符串常量，可静态检查）。
- [ ] **AC-018**：`/admin`、`/admin/users`、`/admin/resources` 均为顶层路径，无 locale 前缀。

### 6.3 登录与登出

- [ ] **AC-019**：`loginAdminLocal` 正确凭据 → 写 `admin_session` cookie + 302（优先 `returnTo`；非法或 `returnTo` 为 `/admin/login` 时回退 `/admin`）+ 审计 `admin.login.success`。另含**硬性断言**：登录成功重定向响应携带 `admin_session` 的 Set-Cookie 头（本项目首个 Server Action 的 `cookies().set + redirect()` 组合，无仓内先例，禁止跳过；arch r3 R3-003，v1.5）。
- [ ] **AC-020**：`loginAdminLocal` 错误凭据 → 不写 cookie、返回 `ADMIN_AUTH_INVALID_CREDENTIALS` + 审计 `admin.login.failure`。
- [ ] **AC-021**：`loginAdminLocal` 对 Zod 拒绝的非法输入（空字段 / username > 64 / password > 128 / returnTo > 2048）返回 `ADMIN_AUTH_INVALID_INPUT`，不触达密码比较。
- [ ] **AC-022**：密码比较为恒时（sha256 归一后 `timingSafeEqual`，长度恒 32 字节），不引入 bcryptjs。
- [ ] **AC-023**：`logoutAdmin` → 删 `admin_session` → 302 `/admin/login`；SSO 三 cookie 保留 + 审计 `admin.logout.completed`（会话形态口径：以 E 路径会话为测试载体；D 路径登出行为见 §5 边界声明）。
- [ ] **AC-024**：`/admin/login` 对已登录管理员（`sso_access_token` 或 `admin_session` 任一 exp 粗检通过，且无 error 参数）→ 直接 302 `/admin`。
- [ ] **AC-025**：`/admin/login?error=ADMIN_AUTH_FORBIDDEN` → 渲染无权限提示（不触发粗检跳转，无重定向循环）。
- [ ] **AC-026**：auditLogger 扩展后：`ADMIN_AUTH_*` 错误码通过 `ERROR_CODE_PATTERN` 校验、三个 `admin.*` 事件可正常写入（单元断言）。

### 6.4 页面与框架

- [ ] **AC-027**：未登录访问 `/admin` → 最终落 `/admin/login`（经 middleware 粗检 + Node 守卫双重拦截）。
- [ ] **AC-028**：E 路径登录后 `/admin` 渲染 Dashboard：两模块入口卡片 + 管理范围说明，不查库。
- [ ] **AC-029**：`/admin/users`、`/admin/resources` 渲染占位空框架。
- [ ] **AC-030**：layout 渲染侧边栏（用户管理 / 资源管理）与头部（管理员信息 + 登出按钮）。
- [ ] **AC-031**：全站页面无 Header「管理后台」入口。

### 6.5 测试

- [ ] **AC-032**：单测覆盖 `config` / `qualification` / `session` / `actions` 及 `requireAdminPage` 全分支；其中 D 路径白名单拒绝分支以 mock `verifyAccessToken` 返回合法 claims 且无 `admin_session`，断言 redirect `/admin/login?error=ADMIN_AUTH_FORBIDDEN`（需求方决策 A1、A5）。
- [ ] **AC-033**：E2E（`@no-llm`）通过：未登录访问 `/admin` → `/admin/login`；本地管理员登录 → Dashboard；登出 → `/admin/login`。
- [ ] **AC-034**：D 路径正向 E2E（真实 IDP，SSO 登录态）通过：管理员 → `/admin` → Dashboard（IDP 已恢复，实跑验证）。
- [ ] **AC-035**：E2E 运行环境具备 `ADMIN_SSO_SUBS` / `ADMIN_LOCAL_USERNAME` / `ADMIN_LOCAL_PASSWORD` / `ADMIN_SESSION_SECRET` 四变量（`.env.local` 注入或 playwright.config webServer env 覆盖，见附录 E），本地可复现。

---

## 附录 A：会话机制说明

两条**独立并存**的会话机制，互不干扰：

| 路径 | 会话载体 | 生命周期决定方 | 校验方式 |
|---|---|---|---|
| D（SSO 管理员） | 既有 `sso_access_token` / `sso_refresh_token` / `sso_id_token` | **IDP 决定**（IDP 签发 token，我方按过期/刷新逻辑维护） | middleware 粗检 exp + Node 层 RS256/JWKS 完整验签（既有，`verifyAccessToken`） |
| E（本地管理员） | 独立 `admin_session` cookie（HS256 HMAC JWT） | **我方服务端决定**（15 分钟，`ADMIN_SESSION_SECRET` 签名，与 IDP 无关） | middleware 粗检 exp（Edge 仅解码不验签，复用本地 `decodeJwtExp`）+ Node 层 HMAC 完整验签 |

管理员判定逻辑（并集）：

```
admin = (SSO 登录 && sub ∈ ADMIN_SSO_SUBS)  // D 方案
     || (admin_session cookie 有效)         // E 方案
```

## 附录 B：D / E 两条路径

- **D 路径（SSO 管理员）**：与普通用户一致在 `/login` 完成 SSO 登录 → 直接访问 `/admin` → middleware 粗检通过（SSO exp 有效）→ `requireAdminPage` 校验 `sub ∈ ADMIN_SSO_SUBS` 通过 → 进入后台；不在白名单的已登录 SSO 用户 → 按并集语义先尝试 E 路径（FR-011）：`admin_session` 有效则放行，无效才 redirect `/admin/login?error=ADMIN_AUTH_FORBIDDEN`（不清 SSO cookie，见 FR-011）。
- **E 路径（本地管理员）**：访问 `/admin/*` 被 middleware 粗检拦下（SSO 与 admin_session 均无/无效）→ 302 `/admin/login?returnTo=` → 本地凭据表单登录 → `loginAdminLocal` 签发 `admin_session` cookie → 重定向（优先 `returnTo`）→ 进入后台。
- **E 路径完整链路**：① 访问 `/admin/*` → middleware 粗检双 cookie 均无效 → 302 `/admin/login?returnTo=<原路径>`（middleware 层有 `req.nextUrl` 路径来源，携带 returnTo，登录成功回跳）；② 提交用户名+密码 → `loginAdminLocal`：Zod 校验（拒绝返回 `ADMIN_AUTH_INVALID_INPUT`）→ 恒时比较 → 通过则签发 HS256 JWT 写 `admin_session`（httpOnly/sameSite=lax/path=/secure 仅生产/15min）→ 重定向（优先经 `isSafeReturnTo` 且非登录页的 returnTo，否则回退 `/admin`）；③ 之后每次访问 `/admin/*`：middleware 粗检 `admin_session` 的 exp；Node 层 `requireAdminPage` 完整验签 → 通过进入后台；Node 守卫层双失败 redirect `/admin/login`（RSC 无路径来源，不携带 returnTo，见 FR-014）；④ 登出：`logoutAdmin` 删除 `admin_session` cookie（不清 SSO cookie）。

## 附录 C：任务拆解表

| # | 文件 | 内容 | 要点 |
|---|---|---|---|
| 1 | `app/lib/admin/constants.ts` | Edge-safe 常量（`ADMIN_SESSION_COOKIE_NAME` 等字符串常量） | 零依赖；middleware 与 session.ts 共同引用（FR-004） |
| 2 | `app/lib/admin/config.ts` | 解析 4 个 admin env + `getAdminConfig` / `validateAdminEnvVars` 惰性校验 | 独立于 env.ts，不并入 `validateEnv()`（FR-002/003） |
| 3 | `app/lib/admin/qualification.ts` | `isAdminSub(sub)` 白名单成员判定 | 纯函数，可单测（FR-005） |
| 4 | `app/lib/admin/session.ts` | `signAdminSession` / `verifyAdminSession` + `admin_session` cookie | cookie 属性复用 token-cookie.ts 导出的 `cookieSecure()`（token-cookie.ts 同步一行导出，FR-006/007）；不导出 Edge 函数（FR-008） |
| 5 | `app/lib/auth/guard.ts` | 仅将 `verifyAccessToken` 由模块私有改为 `export` | 一行改动，无行为变化，SSO 守卫不动（FR-009） |
| 6 | `app/lib/admin/guard.ts` | `requireAdminPage()` | 授权失败不清 SSO cookie（FR-010~014） |
| 7 | `middleware.ts` | 三处扩展：`/admin/login` 白名单 / `/admin/*` 302 目标 / 双 cookie 粗检 | 复用本地 `decodeJwtExp`，不 import admin 服务模块（FR-015~018） |
| 8 | `app/admin/login/page.tsx` + `app/admin/login/admin-login-client.tsx` | 公开登录页（本地表单 E + SSO 入口 D，无守卫 layout，独立于 (panel) 分组） | co-locate（FR-019~022） |
| 9 | `app/admin/actions.ts` | `loginAdminLocal` / `logoutAdmin` Server Actions | 恒时比较；returnTo 优先；爆破依托 middleware 限流（FR-023~027） |
| 10 | `app/admin/(panel)/layout.tsx` + `page.tsx` + `users/page.tsx` + `resources/page.tsx` | 管理框架与占位页（路由分组，URL 不变；login 公开页不受包裹） | 先 `requireAdminPage()`；Dashboard 不查库（FR-028~031） |
| 11 | `app/lib/logging/audit-logger.ts` | `ERROR_CODE_PATTERN` 扩展 + `AuditEvent` 新增 3 事件字面量 + 内部报错文案/注释同步为「仅允许 AUTH_*/ADMIN_* 错误码」 | 本期即可记录本地登录/登出审计（FR-032/033） |
| 12 | `.env.local.example` | 登记 4 个 admin 环境变量（值留空） | 随本任务一并交付运维条目（arch r3 R3-004，落点 `docs/operations/`）：`ADMIN_*` 生产 env 清单与 secret 管理登记、`ADMIN_SESSION_SECRET` 轮换流程说明（轮换使在途 `admin_session` 立即失效重登）、日志排查指南增补 `admin.*` 三事件 |
| 13 | 测试 | 单测 + E2E | D 路径白名单判定仅单测（A1）；D 正向 E2E 实跑（A3）；env 注入说明（AC-035） |

## 附录 D：决策清单（已确认）

**负责人决策，2026-08-20**：

- ✅ 方案 D（主路径）：采用 .env 静态 sub 白名单 `ADMIN_SSO_SUBS`。管理员与普通用户完全一致走 SSO 登录，仅 `sso_sub` 命中白名单即获管理员资格。不采用 IDP 组/角色声明/入库名单。
- ✅ 方案 E（应急）：本地管理员完全独立于 IDP，`.env` 指定用户名+密码即可成为管理员。
- ✅ 问题3：本地密码 `.env` 静态明文存储 + 恒时比较（sha256 归一 + `timingSafeEqual`），不引入 bcryptjs。
- ✅ 问题4：本地管理员采用独立 `admin_session` cookie（HS256 HMAC，15 分钟）；D 路径会话由 IDP 决定。
- ✅ 问题6：后台只用顶层路径（`/admin` 等），不做 locale 多语言（项目仅中文环境）。
- ✅ 问题7：Dashboard 首页纯占位（两模块入口卡片 + 说明，不查库）。
- ✅ 问题8：不增加 Header「管理后台」入口，管理员仅直接访问 `/admin` 路径进入。
- ✅ A1：任务 13 删除「SSO 用户 sub 不在白名单 → 拒绝」E2E 用例；D 路径白名单判定仅以单测覆盖（不写 E2E）。
- ✅ A2：admin 错误码使用 `ADMIN_*` 前缀，本期同步扩展 auditLogger（`ERROR_CODE_PATTERN` 改为 `/^(AUTH|ADMIN)_[A-Z_]+$/`，`AuditEvent` 新增 `admin.login.success` / `admin.login.failure` / `admin.logout.completed`），本期即可记录本地登录/登出审计。
- ✅ A3：IDP（auth.happyrabbit.top）已恢复可实跑 SSO E2E；D 路径正向用例补 E2E 实跑，「不在白名单 → 拒绝」仍按 A1 仅单测。
- ✅ A4：`/admin/login` 对齐 app/login 的粗检语义（仅解码 exp 不验签）：已登录管理员访问 `/admin/login` 做粗检，任一有效会话则直接 redirect `/admin`（跳转目标固定 /admin；含 error 参数跳过跳转的防循环边界，见 FR-022）。
- ✅ A5（r2 评审 B1）：守卫并集语义——SSO 验签有效但 sub 不在白名单时，先尝试 E 路径（`admin_session` 有效则放行），两者均无效才 `redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')`；附录 A 并集公式保持不变（FR-010/011、AC-007）。

**错误码定义**（MODULE_CATEGORY_SPECIFIC）：

| 错误码 | 语义 | 使用位置 |
|---|---|---|
| `ADMIN_AUTH_INVALID_CREDENTIALS` | 本地登录失败（凭据错误） | `loginAdminLocal` 失败返回 + 审计 `admin.login.failure` |
| `ADMIN_AUTH_FORBIDDEN` | SSO 有效但无管理员权限（且 E 路径无有效会话） | `requireAdminPage` 授权失败 redirect `error=` 参数 |
| `ADMIN_SESSION_INVALID` | `admin_session` 验签失败/过期/非法 | `verifyAdminSession` 失败返回 |
| `ADMIN_AUTH_INVALID_INPUT` | Zod 校验拒绝（输入不合法） | `loginAdminLocal` Zod 校验失败返回 |

## 附录 E：测试策略注记

- **E2E 主测本地管理员路径**（`@no-llm`，不依赖 IDP）：未登录访问 `/admin` → `/admin/login`；本地管理员登录 → Dashboard；登出 → `/admin/login`。
- **D 路径白名单判定**（SSO 有效但 sub 不在白名单且无有效 admin_session → 拒绝）：**仅单测覆盖**（mock `verifyAccessToken` 返回合法 claims、无 `admin_session`，断言 redirect `/admin/login?error=ADMIN_AUTH_FORBIDDEN` 且不清 SSO cookie），不写 E2E（决策 A1、A5）。
- **D 路径正向用例**：IDP（auth.happyrabbit.top）已恢复，可补 SSO E2E 实跑（测试账号 sub 需预先加入 `ADMIN_SSO_SUBS`；用例挂 chromium 项目、经 `helpers/sso-login.ts` 自登录获真实 IDP 会话，不依赖 auth.setup storageState——arch r3 R3-001，v1.5）。
- **E2E 运行前提**：playwright.config webServer 使用 `npm run dev:test`（`node scripts/dev.mjs --test`，读 `.env.local`，关闭限流）。本地 E2E 需注入 `ADMIN_SSO_SUBS` / `ADMIN_LOCAL_USERNAME` / `ADMIN_LOCAL_PASSWORD` / `ADMIN_SESSION_SECRET` 四变量：本地在 `.env.local` 配置测试值；CI 可在 playwright.config webServer env 覆盖。`.env.local.example` 登记值留空时本地 E2E 会失败，必须提供测试值（AC-035）。

## 附录 F：可扩展需求建议（≤5 条，不纳入本期）

1. **后台维护管理员名单（DB 表 + 管理 UI）**：并入后续「用户管理」模块；届时本地管理员可迁移入库、支持密码轮换。
2. **RBAC 分级（super-admin / operator）**：资源管理需要操作权限细分时引入，当前并集判定可平滑升级为角色判定。
3. **数据变更操作审计**：本地登录/登出审计已随本期落地（FR-032/033）；后续为后台数据变更（用户管理/资源管理）记录操作者（`operator` 字段已在 `billing_records` 预留）。
4. **`/api/admin/*` 受保护 API 组**：后台能力以 Server Action 为主，程序化接口按需再开（复用 `requireAdmin` 同级守卫）。
5. **本地管理员 2FA/TOTP**：应急通道的安全加固，随用户管理模块一并评估。
