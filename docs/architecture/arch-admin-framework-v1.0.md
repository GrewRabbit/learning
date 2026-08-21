# 后台管理员框架 技术架构 v1.3

**日期**：2026-08-21 ｜ **状态**：approved ｜ **版本**：v1.3

**变更记录**：

| 版本 | 日期 | 变更内容 | 参考评审 |
|------|------|---------|---------|
| v1.0 | 2026-08-20 | 初稿创建 | — |
| v1.1 | 2026-08-20 | 根据 r1 评审修订（AR1-001~013：username 恒时判定补全、loginAdminLocal 契约统一与 AdminLoginState 定义、FR 矩阵抽离、10 项建议级采纳） | review-r1 |
| v1.2 | 2026-08-20 | 根据 r2 评审修订（AR2-001~004） | review-r2 |
| v1.3 | 2026-08-21 | 根据 r3 实施前终评修订（R3-001~004：E2E 项目挂载与 playwright.config 任务、审计副作用精确化、Set-Cookie 断言升格 AC-019、运维条目归属 ADM-M12；§5.4 引用勘误对齐 spec v1.5） | review-r3 |

**需求来源**（唯一合法输入，均已 approved）：
- `docs/specs/spec-admin-framework-v1.5.md`（后台管理员框架，FR-001~033 / AC-001~035 / NFR-001~010 + 附录 A~F）
- `docs/specs/spec-sso-auth-v1.3.md`（SSO 登录认证：登录链路 / 全站登录墙 / error 展示模式 / returnTo 开放重定向校验）
- `docs/specs/spec-sso-token-v1.2.md`（token 生命周期：verifyAccessToken 验签语义 RS256 + kid + JWKS + iss/aud/exp）

**前置状态**：admin spec 业务决策 A1~A5 + 方案 D/E + B1/B2 全部已确认（附录 D）；本架构不新增「开放决策项」，发现的 spec 未覆盖技术缺口一律列为风险项（§9）。

---

## 1. 架构概述

### 1.1 目标

在既有三层认证链（middleware 限流 + Edge 粗检 + Node 层 `guard.ts` 完整验签 + `/login` OIDC 登录链路）之上，新增**后台管理员框架**：

1. **授权层**（D 路径）：SSO 用户 `sub ∈ ADMIN_SSO_SUBS` 白名单即获管理员资格，与普通用户共用同一 SSO 登录链路，零 IDP 配置成本；
2. **应急通道**（E 路径）：IDP 不可达时经 `/admin/login` 本地凭据登录，签发独立 `admin_session`（HS256，15 分钟）会话，完全独立于 IDP；
3. **管理框架**：`/admin` Dashboard（用户管理/资源管理**空框架占位**）+ 管理登录/登出审计；本期不建 DB 表、不做任何业务。

两条会话独立并存、互不干扰；管理员判定为**并集**（附录 A）：

```text
admin = (SSO 登录 && sub ∈ ADMIN_SSO_SUBS)  // D 方案
     || (admin_session cookie 有效)         // E 方案
```

### 1.2 已确认决策基线（一律不回退）

| 基线 | 内容 | 架构落点 |
|------|------|----------|
| 方案 D（主路径） | `ADMIN_SSO_SUBS` 静态 sub 白名单 + SSO 登录；管理员与普通用户一致走 SSO | §2 ADM-M02/M03、§4.2 |
| 方案 E（应急） | `ADMIN_LOCAL_USERNAME` + 明文密码 + 独立 `admin_session` cookie | §2 ADM-M04、§4.2 |
| 密码方案 | `.env` 静态明文 + **sha256 归一 + `timingSafeEqual`**（恒 32 字节），**不引 bcryptjs** | §5.2、§8.2 |
| 会话方案 | `admin_session` HS256 HMAC JWT，**15 分钟**，无续期/刷新机制 | §2 ADM-M04、§8.2 |
| 路径方案 | 后台仅顶层路径（`/admin` 等），**无 locale 前缀** | §6 |
| Dashboard | **纯占位不查库**（两模块入口卡片 + 范围说明） | §2 ADM-M10 |
| 入口 | **不增加** Header「管理后台」入口 | §1.5 |
| 排除方案 | 方案 A（IDP 组声明）/ B（IDP 角色声明）/ C（入库名单）/ F（本地管理员入库）**不采用** | §1.5 |
| 决策 A1 | D 路径白名单拒绝用例**仅单测覆盖，不写 E2E** | §2 ADM-M13、§9-风险 10 |
| 决策 A2 | admin 错误码 `ADMIN_*` 前缀，本期扩展 auditLogger | §5.5、§5.6 |
| 决策 A3 | D 路径正向补 E2E 实跑（IDP 已恢复）；白名单拒绝仍仅单测 | §2 ADM-M13、§9-风险 10 |
| 决策 A4 | `/admin/login` 粗检语义对齐 app/login：仅解码 exp 不验签，跳转目标固定 `/admin`，error 参数跳过 | §4.3-N4、§4.4-X5 |
| 决策 A5（并集守卫） | SSO 验签有效但 sub 不在白名单 → **先试 E 路径**；均无效才 `redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')`，**不清 SSO cookie** | §4.2、§4.4-X4 |

### 1.3 核心架构决策表

| # | 决策项 | 选择 | 理由 |
|---|--------|------|------|
| AAD-01 | 管理员授权模型 | **D 主路径 + E 应急路径，并集判定**（§1.1 公式） | spec 附录 D 决策；授权缺失 + 应急通道双目标 |
| AAD-02 | 本地密码存储与比较 | `.env` 明文 + sha256 归一 + `timingSafeEqual`（恒 32 字节），**不引 bcryptjs** | NFR-001；规避长度不等抛错 |
| AAD-03 | admin_session 载体 | 独立 **HS256 HMAC JWT** cookie（jose `SignJWT`/`jwtVerify`），载荷 `{sub, name, exp}`，900s，无续期 | NFR-002；决策问题 4；与 IDP 无关 |
| AAD-04 | **两层运行结构** | middleware(Edge)：仅 base64url 解码 exp 粗检（复用本地 `decodeJwtExp`），仅引 `constants.ts` 字符串常量；Node 层：持有 `ADMIN_SESSION_SECRET`、HS256 完整验签、恒时比较、白名单判定 | NFR-005/NFR-010、FR-008/FR-017；Edge 引密钥会打包内联泄露（对齐 auth spec FR-024 敏感值暴露约束，v1.3 勘误） |
| AAD-05 | 守卫并集语义 | SSO 验签有效但 sub 不在白名单 → 先试 E 路径；均无效才 `redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')`，**不清 SSO cookie** | 决策 A5 / FR-011 / AC-007；授权失败非会话失败 |
| AAD-06 | 守卫失败载体 | **Node** `requireAdminPage` 双失败 `redirect('/admin/login')` **不携带 returnTo**（RSC 无路径来源）；**middleware** 层 302 带 `?returnTo=<原路径>` | FR-014 / R2-003 / B2 / AC-009 |
| AAD-07 | 路由分组隔离 | `app/admin/login/`（公开，无守卫 layout）+ `app/admin/(panel)/`（守卫 layout + 页面），**URL 不变** | R2-001 / FR-019 / FR-028 / AC-018 |
| AAD-08 | admin 配置校验 | `getAdminConfig()` **惰性校验**（复用 `getSsoEnv()` 模式），独立 `app/lib/admin/config.ts`，**不并入** `env.ts` `validateEnv()` | FR-002；admin 变量不作全站启动硬性要求 |
| AAD-09 | Edge-safe 常量 | `app/lib/admin/constants.ts` 零依赖纯字符串常量，middleware 与 session.ts 共同引用 | FR-004 / AC-005；对齐 `ACCESS_TOKEN_COOKIE_NAME` 既有模式 |
| AAD-10 | SSO 守卫复用 | `verifyAccessToken` 仅由模块私有改 `export`（**一行改动，无行为变化**）；`requireAuth`/`requireAuthPage` 不动 | FR-009 / AC-001 |
| AAD-11 | admin 错误码 | `ADMIN_AUTH_INVALID_CREDENTIALS` / `ADMIN_AUTH_FORBIDDEN` / `ADMIN_SESSION_INVALID` / `ADMIN_AUTH_INVALID_INPUT` | 附录 D / NFR-006 |
| AAD-12 | 审计扩展 | `ERROR_CODE_PATTERN` → `/^(AUTH|ADMIN)_[A-Z_]+$/`；`AuditEvent` 新增 3 事件**字符串字面量**（非 TS enum） | FR-032/033 / A2 / R2-009 |
| AAD-13 | 技术依赖 | **无新增依赖**（jose ^6.2.8 已在依赖，HS256 签发/验签复用）；不引 bcryptjs | FR-006/NFR-001；package.json 核对 |
| AAD-14 | 爆破防护 | 复用既有 middleware **per-IP 限流**（20 次/分/IP，matcher 已覆盖 `/admin/login` POST），**不新增账号锁定** | FR-027 / NFR-004 / 边界 |
| AAD-15 | E 路径登录身份 | `signAdminSession` 的 `sub` 与 `name` 均取 `ADMIN_LOCAL_USERNAME`（本地标识即管理员标识） | FR-006 / FR-025（subject）；实现细节落点 |

### 1.4 两层运行结构（运行时边界，硬约束）

| 层 | 运行时 | 职责 | 禁止事项 |
|----|--------|------|----------|
| **middleware** | Edge | `/admin/login` 公开白名单；`/admin/*`（非 login）未认证 302 → `/admin/login?returnTo=`；`admin_session` **exp 粗检**（本地函数复用 `decodeJwtExp`，仅 base64url 解码不验签）；SSO 粗检维持 `isSessionValid` | 禁 import admin 服务模块（config/session/guard/qualification）；禁引用 `ADMIN_SESSION_SECRET`；禁 Node 原生模块；无 logger 仅 `console`；**admin 模块仅允许引用 `@/app/lib/admin/constants` 字符串常量**（SSO 侧沿用既有 `@/app/lib/sso/token-cookie` 常量引用，Edge 同构既有行为，AR1-010） |
| **Node 运行时** | Node | 持有 `ADMIN_SESSION_SECRET`；HS256 完整验签（`verifyAdminSession`）；恒时密码比较（sha256 + `timingSafeEqual`）；白名单判定（`isAdminSub`）；`requireAdminPage` 并集守卫；Server Actions（登录/登出） | `session.ts` **不导出**供 Edge 使用的函数（模块含 node:crypto 与密钥引用，导入会污染 Edge 包，FR-008） |

### 1.5 边界与排除项（不实现）

- 不建 DB 表；不做用户管理业务、资源管理业务（仅空框架占位，FR-029/030）
- 不引入 bcryptjs；`admin_session` 无续期/刷新（15 分钟固定，过期重登）
- 方案 A（IDP 组声明）/ B（IDP 角色声明）/ C（入库名单）/ F（本地管理员入库）不采用
- 不增加 Header「管理后台」入口（FR-031）
- 不做 locale 多语言（FR-018，后台仅顶层路径）
- 不新增 per-account 账号锁定（仅既有 per-IP 限流，FR-027）
- 不做 SSO 组/角色声明判定（仅 sub 白名单；RBAC 分级见附录 F-2，预留平滑升级）
- 不新增 `/api/admin/*` 路由（附录 F-4 预留，本期 Server Action 为主）
- 「SSO 有效但 sub 不在白名单且无有效 admin_session → 拒绝」仅单测覆盖，不写 E2E（决策 A1/A5）

---

## 2. 模块划分

### 2.1 模块清单

| 模块 | 名称 | 运行时 | 职责 | 对应 FR |
|------|------|--------|------|---------|
| ADM-M01 | Edge-safe 常量 | Edge/Node 同构 | `app/lib/admin/constants.ts`：`ADMIN_SESSION_COOKIE_NAME` 等纯字符串常量，零依赖、无任何 import | FR-004 |
| ADM-M02 | 配置与环境 | Node | `app/lib/admin/config.ts`：`getAdminConfig()` / `validateAdminEnvVars()` 惰性校验 + 4 个 admin env 解析（模块级缓存，复用 `getSsoEnv()` 模式） | FR-001~003 |
| ADM-M03 | 白名单判定 | Node | `app/lib/admin/qualification.ts`：`isAdminSub(sub)` 纯函数（D 路径授权判定核心，可独立单测） | FR-005 |
| ADM-M04 | 本地管理员会话 | Node | `app/lib/admin/session.ts`：`signAdminSession` / `verifyAdminSession`（HS256）、`verifyLocalCredentials`（username/password 双 sha256+timingSafeEqual，AR1-001）、`adminSessionCookieOptions()`（cookie 属性）；**Node-only，不导出 Edge 函数** | FR-006~008、NFR-001~003 |
| ADM-M05 | SSO 守卫复用 | Node | `app/lib/auth/guard.ts`：仅 `export` `verifyAccessToken`（一行）；`app/lib/sso/token-cookie.ts`：仅 `export` `cookieSecure()`（一行） | FR-007/009 |
| ADM-M06 | 管理员守卫 | Node | `app/lib/admin/guard.ts`：`requireAdminPage(): Promise<AdminClaims>` 并集语义全分支（D 优先 → E 兜底 → 双失败 redirect） | FR-010~014 |
| ADM-M07 | middleware 扩展 | Edge | `middleware.ts`：`/admin/login` 加入 `isPublicPath`；`/admin/*` 302 目标改 `/admin/login?returnTo=`；双 cookie 粗检（SSO 维持 `isSessionValid` + 本地 `isAdminSessionValid`）；限流既有逻辑不动 | FR-015~017、FR-027 |
| ADM-M08 | 管理登录页 | RSC + Client | `app/admin/login/page.tsx` + `admin-login-client.tsx`（E 路径本地表单 + D 路径 SSO 入口 + error 参数展示 + 已登录粗检跳转） | FR-019~022 |
| ADM-M09 | Server Actions | Node | `app/admin/actions.ts`：`loginAdminLocal` / `logoutAdmin`（Zod 校验 + username/password 双恒时判定 + 审计 + 重定向，AR1-001） | FR-023~026 |
| ADM-M10 | 后台框架 | RSC | `app/admin/(panel)/`：layout（requireAdminPage + 侧边栏 + 头部）、Dashboard、users/resources 占位页 | FR-028~031 |
| ADM-M11 | 审计扩展 | Node | `app/lib/logging/audit-logger.ts`：`ERROR_CODE_PATTERN` 扩展 + `AuditEvent` 新增 3 事件字面量 + 内部报错文案同步 | FR-032/033 |
| ADM-M12 | 环境变量与运维登记 | 配置 | `.env.local.example` 登记 4 个 admin env（值留空）+ **运维条目交付（v1.3/R3-004）**：`ADMIN_*` 生产 env 清单与 secret 管理登记、`ADMIN_SESSION_SECRET` 轮换流程（轮换使在途 `admin_session` 立即失效重登）、日志排查指南增补 `admin.*` 三事件（落点 `docs/operations/`） | FR-001、AC-035 |
| ADM-M13 | 测试 | 测试 | 单测（config/qualification/session/actions/guard 全分支，全 mock；actions 单测落点 `app/admin/__tests__/actions.test.ts`，AR1-006）+ E2E（`@no-llm` 主测 E 路径；D 正向用例同文件标注 `@llm` 实跑按 A3，AR1-013）+ **playwright.config 变更（v1.3/R3-001，列入实施任务）**：chromium 项目 testMatch 增补 `admin-framework\.spec\.ts`（无 storageState，E 路径从无会话态开始）；D 正向用例经 `helpers/sso-login.ts` 自登录获真实 IDP 会话（不依赖 auth.setup storageState，对齐 sso-login.spec.ts 先例） | AC-032~035 |

### 2.2 模块依赖关系（文本图）

```text
middleware.ts (Edge, ADM-M07)
  │ 仅引 ADM-M01 constants.ts（ADMIN_SESSION_COOKIE_NAME）+ token-cookie.ts（cookie 名常量，Edge 同构）
  │ 限流（既有，覆盖 /admin/login POST）→ isPublicPath（新增 /admin/login）→ 受保护 admin 路径 302 /admin/login?returnTo
  ▼
app/admin/login/ (ADM-M08, 公开无守卫 layout)
  ├─ page.tsx (RSC)：粗检跳转 / error 参数 / returnTo 校验 ── 仅依赖 token-cookie 常量 + constants.ts + 本地函数
  └─ admin-login-client.tsx (Client)
       ├─ useActionState ──→ app/admin/actions.ts (ADM-M09) ──→ ADM-M04 session.ts（恒时比较/sign）──→ ADM-M11 auditLogger
       └─ LoginButton（复用既有 SSO 入口，returnTo 透传）──→ /api/sso/authorize（既有 D 路径，不动）
  ▼
app/admin/(panel)/layout.tsx (ADM-M10, RSC)
  └─ requireAdminPage() (ADM-M06)
       ├─ D 路径：verifyAccessToken（ADM-M05 现 export，RS256+JWKS 既有）→ isAdminSub（ADM-M03）
       ├─ E 路径：verifyAdminSession（ADM-M04，HS256 + ADMIN_SESSION_SECRET）
       └─ 失败：清 cookie + redirect（Node 层无 returnTo）
  ▼
页面：Dashboard / users / resources（纯占位，不查库）
```

依赖方向（单向，无循环）：
- ADM-M06 → ADM-M05（verifyAccessToken，**admin → auth 单向**）、ADM-M04、ADM-M03、ADM-M01、token-cookie.ts（SSO cookie 名常量）
- ADM-M09 → ADM-M04、ADM-M02（getAdminConfig）、ADM-M01、token-cookie.ts（isSafeReturnTo）、ADM-M11
- ADM-M04 → ADM-M01、ADM-M02、token-cookie.ts（cookieSecure）、jose、node:crypto
- ADM-M02 → 仅读 process.env（不依赖任何 admin 模块）
- ADM-M08 → ADM-M09（Server Action）、LoginButton（既有）
- ADM-M10 → ADM-M06（layout 守卫）、ADM-M09（登出）
- ADM-M07（middleware）→ 仅 ADM-M01 + token-cookie.ts + 本地函数（Edge 边界）

---

## 3. 技术选型

与 `package.json` 现状核对（**无新增依赖**；jose ^6.2.8 已在 dependencies，HS256 签发/验签直接复用）：

| 类别 | 技术 | 版本（package.json） | 用途 |
|------|------|---------------------|------|
| 框架 | Next.js 15（App Router） | 15.1.6 | 路由分组（(panel)）、Server Action、middleware、RSC 页面 |
| 语言 | TypeScript | ^5.7.3 | 全量类型约束（禁 any，显式返回类型） |
| JWT | **jose**（已存在，无新依赖） | ^6.2.8 | HS256 签发（`SignJWT`）/ 验签（`jwtVerify`）；E 路径 admin_session 载体 |
| 密码比较 | node:crypto（Node 内置） | — | sha256 归一 + `timingSafeEqual`（恒 32 字节，NFR-001；**不引 bcryptjs**） |
| 校验 | zod | ^3.24.1 | `loginAdminLocal` 表单 Schema（username/password/returnTo） |
| 样式 | Tailwind CSS | ^3.4.17 | 管理框架 UI |
| UI 变体 | class-variance-authority + tailwind-merge + clsx | ^0.7.1 / ^3.6.0 / ^2.1.1 | 按钮/卡片变体 |
| 图标 | lucide-react | ^1.21.0 | 侧边栏/头部图标（禁内联 SVG） |
| 表单基础 | @radix-ui/react-label / react-slot | ^2.1.10 / ^1.3.0 | label（NFR-008 可访问性）、组件插槽 |
| 测试 | Vitest + @playwright/test | ^3.0.0 / ^1.61.1 | 单测全 mock（config/qualification/session/actions/guard）；E2E 分级（@no-llm 主测 E 路径） |

> 备选说明：本地密码哈希候选 bcryptjs 被 NFR-001 显式排除；HS256 候选 WebCrypto 自实现风险高，jose 已在依赖中直接复用（对齐 arch-sso AD-06 先例）。
> 样式约束（AR1-012）：admin 页面组件遵循 component-rules 语义变量体系（`bg-card`、`text-destructive`、`rounded-(--radius-btn)` 等语义类名，禁 `bg-white`/`rounded-lg` 等原始值硬编码）；UI 实现阶段读取当前皮肤 `design/{skin}/DESIGN.md`。

---

## 4. 数据流设计

### 4.1 middleware（Edge）流程（FR-015~017）

middleware 执行顺序（对 `/admin/*` 的扩展插入既有流程，限流逻辑不动）：

1. **跨域 POST 页面路由 303 转 GET**（既有，不动）
2. **健康检查早退**（既有，不动）
3. **限流**（既有，per-IP 20 次/分；`/admin/login` 的 POST 已入 matcher 全集，FR-027 生效）
4. **公开白名单**：`isPublicPath('/admin/login')` → `true`（新增分支，FR-015）→ 放行，不读 cookie
5. **受保护 admin 路径分支**（新增，FR-016/017）：`pathname === '/admin' || pathname.startsWith('/admin/')`（非 login，login 已在第 4 步放行）：
   - 粗检通过条件：`isSessionValid(req) || isAdminSessionValid(req)`（**双 cookie 并集粗检**）
   - 未通过 → `302 /admin/login?returnTo=<pathname+search>`（FR-016，不再走 `/login`）
6. **非 admin 既有逻辑**（API 401 JSON / 页面 302 `/login`，不动）

`isAdminSessionValid(req)`（middleware 本地新增函数，Edge 边界内）：
- 读 `ADMIN_SESSION_COOKIE_NAME`（来自 `@/app/lib/admin/constants`）cookie
- 复用本地 `decodeJwtExp`（仅 base64url 解码取 exp，**不验签**，FR-017）
- 返回 `exp !== undefined && exp > now`；不存在/解码失败 → false（fail-closed 于 Node 层兜底）

matcher **保持不变**（`/admin/login` 已含于页面路由负向断言组内，需进 middleware 以限流 + 白名单；顶层 `login` 的负向排除不影响 `/admin/login`，其首段为 `admin`）。

> 状态码载体（v1.1，AR1-011）：既有页面重定向 `NextResponse.redirect(loginUrl)` 未显式传状态码，实际为 **307**（spec AC-015 及本文「302」均为临时重定向**语义表述**，不回溯 spec）；admin 分支沿用同一载体（不显式传 302）。Server Action 内 `redirect()` 实际返回 **303**（POST 后转 GET）。E2E 断言口径统一为**跟随重定向断言最终 URL**（`expect(page).toHaveURL(...)`），不做精确状态码断言。

### 4.2 Node 守卫流程（requireAdminPage，FR-010~014 + A5）

`requireAdminPage(): Promise<AdminClaims>` 执行顺序（D 优先 → E 兜底 → 失败 redirect，**失败路径由本守卫自行控制，不委托 requireAuthPage**）：

```text
① 读 sso_access_token cookie
② 存在 → verifyAccessToken（RS256+JWKS 完整验签，ADM-M05）
     ├─ 验签通过 且 isAdminSub(sub) 命中 → 返回 D claims { sub, name? }（AC-006）
     ├─ 验签通过 但 sub 不在白名单 → 置 ssoValidButNotAdmin = true（不清 cookie，A5，AC-007 分支前置）
     └─ 验签失败（含过期 AUTH_TOKEN_EXPIRED）→ 清 SSO 三 cookie（FR-012），继续
③ 读 admin_session cookie
④ 存在 → verifyAdminSession（HS256 完整验签）
     ├─ 通过 → 返回 E claims { sub, name }（AC-008 / AC-010）
     └─ 失败 → 清 admin_session（FR-013），继续
⑤ 判定收口：
     ├─ ssoValidButNotAdmin === true → redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')，SSO 三 cookie 保留（FR-011/A5，AC-007）
     └─ 其余（双失败/双缺失）→ redirect('/admin/login')，**不携带 returnTo**（FR-014/R2-003/B2，AC-009）
```

关键语义：
- **D 验签失败 ≠ 授权失败**：清 SSO cookie 后仍可经 E 路径放行（AC-008）
- **授权失败保留 SSO 登录态**：`ADMIN_AUTH_FORBIDDEN` 仅指「已认证未授权」，不清 SSO cookie（FR-011）
- **name 归一化**：D 路径 `AccessTokenClaims.name` 不保证存在（索引签名），`typeof name === 'string'` 才取用，缺失回退 `sub`（FR-010，头部展示 `name ?? sub`）
- **verifyAccessToken 既有审计副作用（预期行为，AR1-009；v1.3/R3-002 精确化）**：D 路径验签失败时该函数内部既有 `auth.session_invalid` 审计自动触发（guard.ts 多处调用）；admin 守卫沿用既有事件、不新增 admin 前缀事件、不改造 `verifyAccessToken`——审计流出现「既有 `auth.session_invalid` + admin 清 cookie/redirect」混合为预期结果，勿重复记录。**注意：仅非过期失败分支触发该审计；`JWTExpired`（AUTH_TOKEN_EXPIRED）分支无既有审计事件**，单测断言勿按「D 验签失败必有既有审计」编写

### 4.3 正常流

**N1（E 路径完整链路，主测试路径）**：
① 未登录访问 `/admin` → middleware：双 cookie 粗检均无效 → `302 /admin/login?returnTo=/admin`
② `/admin/login` page：RSC 粗检（双 cookie 均无）→ 渲染 `AdminLoginClient`（returnTo 经校验透传）
③ 提交表单 → `loginAdminLocal`：Zod 校验 → `verifyLocalCredentials` 恒时判定通过（username 与 password 双匹配，AR1-001）→ `signAdminSession` 签发 HS256 → 写 `admin_session` cookie（httpOnly/sameSite=lax/path=/secure 仅生产/maxAge=900）→ audit `admin.login.success` → `redirect(returnTo=/admin)`（重定向语义见 §4.1 状态码载体注记）
④ `/admin` → middleware：`admin_session` exp 有效 → 放行 → `(panel)/layout` → `requireAdminPage`：无 SSO → E 路径验签通过 → 返回 E claims → 渲染 Dashboard
⑤ 登出：头部登出按钮 → `logoutAdmin`：删 `admin_session` → audit `admin.logout.completed` → `redirect('/admin/login')`（SSO cookie 保留，AC-023）

**N2（D 路径完整链路）**：
① SSO 已登录（`sso_access_token` exp 有效）且 `sub ∈ ADMIN_SSO_SUBS` 管理员访问 `/admin` → middleware：SSO 粗检通过 → 放行
② `(panel)/layout` → `requireAdminPage`：D 路径验签通过 + 白名单命中 → 返回 D claims（name 缺失回退 sub）→ 渲染
③ 登出仅删 `admin_session`（无则仅审计 + redirect），SSO 登录态不受影响（FR-026，两条会话独立）

**N3（并集语义：SSO 有效但非白名单 + admin_session 有效，A5）**：
① 访问 `/admin` → middleware：SSO 粗检通过 → 放行
② `requireAdminPage`：D 验签通过、白名单未命中 → `ssoValidButNotAdmin = true` → E 路径 `admin_session` 验签通过 → **放行（返回 E claims）**——SSO 用户凭本地会话进入后台

**N4（已登录访问 /admin/login，FR-022/A4）**：
① 访问 `/admin/login`（middleware 白名单放行）→ page RSC 粗检：`sso_access_token` 或 `admin_session` **任一存在且 exp 未过期**，且 URL **无 error 参数** → `redirect('/admin')`（跳转目标固定，不做 returnTo 回跳）

### 4.4 异常流

**X1（E 路径凭据错误，FR-024/AC-020）**：`loginAdminLocal` Zod 通过 → `verifyLocalCredentials` 恒时判定失败——**username 与 `ADMIN_LOCAL_USERNAME` 不匹配 或 password 不匹配，任一失败即整体失败**（单布尔结果不泄露具体失败项，AR1-001）→ 不写 cookie → 返回 `ADMIN_AUTH_INVALID_CREDENTIALS` + audit `admin.login.failure`（code 关联；subject 约定见 §5.6）→ client 展示安全通用错误文案（`role="alert"`，NFR-008）

**X2（Zod 校验拒绝，FR-023/AC-021）**：username 空/超 64、password 空/超 128、returnTo 超 2048 → 返回 `ADMIN_AUTH_INVALID_INPUT`，**不触达凭据比较**、不写 cookie、不审计

**X3（E 会话过期/篡改，FR-008/013/AC-011）**：`requireAdminPage` E 路径 `verifyAdminSession` 失败（过期/篡改/非 HS256）→ 清 `admin_session` → 若 `ssoValidButNotAdmin` → 走 X4；否则双失败走 X6

**X4（D 授权失败 + E 无效，FR-011/A5/AC-007）**：D 验签通过但白名单未命中 + E 路径无有效会话 → 清 `admin_session`（如有）→ `redirect('/admin/login?error=ADMIN_AUTH_FORBIDDEN')`，**SSO 三 cookie 保留**

**X5（/admin/login?error=ADMIN_AUTH_FORBIDDEN 防循环，FR-021/022/AC-025）**：URL 携带 `error` 参数 → **跳过**粗检跳转 → 直接渲染登录页 + 无权限通用文案（避免 `/admin ↔ /admin/login?error=...` 重定向循环，对应 login 页 `isLoginPath` 防死循环同类处理）

**X6（双失败，FR-014/AC-009）**：SSO 与 admin_session 均缺失/验签失败 → 清对应 cookie → `redirect('/admin/login')`（RSC 无路径来源，**无 returnTo**）；middleware 层的 302 仍带 `?returnTo=<原路径>`（FR-016）

**X7（middleware 粗检误放行，AC-027）**：cookie exp 未过期但被篡改/伪造 → middleware 放行 → Node 层 `requireAdminPage` 完整验签失败（fail-closed）→ 清 cookie + `redirect('/admin/login')` —— Node 层为最终裁决

**X8（爆破）**：连续错误凭据 POST `/admin/login` → 既有 middleware 限流 20 次/分/IP 触发 429（per-IP 非 per-account，FR-027，无账号锁定）

---

## 5. 接口定义

### 5.1 类型定义（app/lib/admin/types.ts）

```typescript
/** 归一化管理员声明（FR-010）：D 路径 name 不保证存在，缺失回退 sub */
export interface AdminClaims {
  sub: string;
  name?: string;
}

/** admin_session HS256 JWT 载荷（FR-006，Node 侧验签结果） */
export interface AdminSessionClaims {
  sub: string;
  name?: string;
  exp: number;
}

/** loginAdminLocal 的 useActionState 状态（v1.1，AR1-002）：仅失败路径填充 error；成功路径经 redirect() 抛 NEXT_REDIRECT，不产生返回值 */
export interface AdminLoginState {
  error?: { code: string; message: string };
}

/** 解析后的 admin 配置（FR-001~003） */
export interface AdminConfig {
  ssoSubs: string[];         // 逐项 trim + 过滤空串
  localUsername: string;     // 非空
  localPassword: string;     // 非空（明文，恒时比较用）
  sessionSecret: string;     // ≥ 32 字符
}

/** admin_session cookie 属性（FR-007/NFR-003） */
export interface AdminSessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;           // cookieSecure()：仅生产环境
  maxAge: 900;
}
```

> `ServiceResult<T>` 统一 `import type { ServiceResult } from '@/app/lib/ai/types'`（与既有 guard.ts 导入一致），admin 模块**禁止重复定义**（v1.1，AR1-007）。

### 5.2 服务层接口（app/lib/admin/）

| 模块 | 函数 | 签名 | 语义 |
|------|------|------|------|
| config.ts | `getAdminConfig` | `(): AdminConfig` | 首次调用触发 `validateAdminEnvVars()`（惰性校验，复用 `getSsoEnv()` 模式），模块级缓存 |
| config.ts | `validateAdminEnvVars` | `(): void` | 校验规则见 §5.4；**禁 NEXT_PUBLIC_ADMIN_* 前缀**；失败抛错（AC-002/003） |
| config.ts | `resetAdminConfigCache` | `(): void` | 测试用（对齐 `resetEnvValidation`） |
| qualification.ts | `isAdminSub` | `(sub: string): boolean` | 纯函数：`sub ∈ ADMIN_SSO_SUBS`；白名单为空恒 false（AC-004） |
| session.ts | `signAdminSession` | `(sub: string, name: string): Promise<string>` | jose `SignJWT` HS256，载荷 `{sub, name, exp}`，exp = now + 900s（FR-006/AC-012） |
| session.ts | `verifyAdminSession` | `(token: string): Promise<ServiceResult<AdminSessionClaims>>` | jose `jwtVerify` HS256（alg 白名单仅 HS256）；失败 → `ADMIN_SESSION_INVALID`（FR-008/AC-011） |
| session.ts | `verifyLocalCredentials` | `(username: string, password: string): boolean`（**同步**，sha256/timingSafeEqual 均为同步操作，v1.1/AR1-004） | 内部读 `getAdminConfig()`：username 与 `config.localUsername`、password 与 `config.localPassword` **各自两侧 sha256 归一后 `timingSafeEqual`**（恒 32 字节，NFR-001/AC-022）；双匹配才 `true`，单布尔结果不泄露具体失败项（v1.1/AR1-001） |
| session.ts | `adminSessionCookieOptions` | `(): AdminSessionCookieOptions` | 属性复用 token-cookie.ts **新导出**的 `cookieSecure()`（FR-007/AC-013） |
| guard.ts | `requireAdminPage` | `(): Promise<AdminClaims>` | 并集守卫（§4.2）；失败路径清 cookie + `redirect`（不返回） |
| auth/guard.ts（改） | `verifyAccessToken` | 由模块私有改 `export`（**一行**） | 无行为变化；RS256+kid+JWKS+iss/aud/exp 既有语义（FR-009/AC-001） |
| sso/token-cookie.ts（改） | `cookieSecure` | 由模块私有改 `export`（**一行**） | `process.env.NODE_ENV === 'production'`（FR-007） |

### 5.3 Server Action 接口（app/admin/actions.ts，'use server'）

| Action | 签名 | 流程与返回 |
|--------|------|------------|
| `loginAdminLocal` | `(prevState: AdminLoginState, formData: FormData): Promise<AdminLoginState>`（v1.1，AR1-002；**成功路径经 `redirect()` 抛 NEXT_REDIRECT 不返回**，返回值仅承载失败态 `error`） | Zod 校验（拒绝 → `ADMIN_AUTH_INVALID_INPUT`，不触达凭据比较）→ `verifyLocalCredentials` 恒时判定（username/password 任一不匹配 → 不写 cookie + 返回 `AdminLoginState { error: ADMIN_AUTH_INVALID_CREDENTIALS }` + audit `admin.login.failure`，AR1-001）→ 双匹配 → `signAdminSession`（sub/name 取 `ADMIN_LOCAL_USERNAME`，AAD-15）+ 写 `admin_session` cookie（`cookies().set`，属性见 §5.1）→ audit `admin.login.success` → `redirect(redirectTo)`；`redirectTo = isSafeReturnTo(returnTo) && !isLoginPath(returnTo) ? returnTo : '/admin'`（FR-023） |
| `logoutAdmin` | `(): Promise<void>` | 读 `admin_session` 并验签取 sub 作 audit subject（验签成功取 sub；无 cookie 或验签失败 subject 留空、事件仍记录，v1.2/AR2-003）→ 删 `admin_session` cookie（**不清 SSO 三 cookie**，FR-026）→ audit `admin.logout.completed` → `redirect('/admin/login')`（抛 NEXT_REDIRECT） |

> Zod schema（FR-023/AC-021）：`username` 必填 ≤ 64、`password` 必填 ≤ 128、`returnTo` 可选 ≤ 2048（z.string().trim().max(2048).optional()）。
> admin 侧 `isLoginPath`（本地私有函数，对齐 app/login/page.tsx 语义）：规范化去尾部斜杠后，命中 `/admin/login`、`/login` 或 `/^\/[^/]+\/login$/`（`/{locale}/login` 形态）即视为登录页 → returnTo 回退 `/admin`（防登录页循环，FR-023）。
> redirect 异常约定：成功路径经 `next/navigation` `redirect()` 抛 `NEXT_REDIRECT`（控制流异常，非业务错误，try-catch 中须重新抛出，对齐 `requireAuthPage` 既有载体 AR3-006）。

### 5.4 环境变量清单（FR-001~003，登记 .env.local.example，值留空）

| 变量 | 必填 | 校验规则（validateAdminEnvVars） | 用途 |
|------|------|-------------------------------|------|
| `ADMIN_SSO_SUBS` | 否（可空） | 非空时按逗号分隔，**逐项 trim + 过滤空串**；全空白 → D 路径未启用（isAdminSub 恒 false） | D 路径 sub 白名单（AC-004） |
| `ADMIN_LOCAL_USERNAME` | 是 | **非空**（E 路径启用前提） | E 路径本地管理员用户名（AC-003） |
| `ADMIN_LOCAL_PASSWORD` | 是 | **非空**（E 路径启用前提） | E 路径明文密码（sha256 恒时比较用，AC-003） |
| `ADMIN_SESSION_SECRET` | 是 | **长度 ≥ 32 字符**（HS256 最小安全密钥，NFR-002） | admin_session 签名密钥（AC-002） |

**禁止**：`NEXT_PUBLIC_ADMIN_*` 任何前缀（敏感值暴露到浏览器；出处为 **auth spec FR-024**、同 token spec FR-021——spec v1.5 勘误，v1.3 同步）；`validateAdminEnvVars` 检测到即抛错（对齐 `validateSsoEnvVars` 对 `NEXT_PUBLIC_SSO_CLIENT_SECRET` 的拦截模式）。

### 5.5 错误码表（附录 D，MODULE_CATEGORY_SPECIFIC）

| 错误码 | 语义 | 使用位置 |
|--------|------|----------|
| `ADMIN_AUTH_INVALID_CREDENTIALS` | 本地登录失败（凭据错误） | `loginAdminLocal` 失败返回 + audit `admin.login.failure`（FR-024） |
| `ADMIN_AUTH_FORBIDDEN` | SSO 有效但无管理员权限（且 E 路径无有效会话） | `requireAdminPage` 授权失败 `redirect(error=)` 参数（FR-011） |
| `ADMIN_SESSION_INVALID` | `admin_session` 验签失败/过期/非法 | `verifyAdminSession` 失败返回（FR-008） |
| `ADMIN_AUTH_INVALID_INPUT` | Zod 校验拒绝 | `loginAdminLocal` 校验失败返回（FR-023） |

### 5.6 审计事件扩展（FR-032/033 + R2-009）

`app/lib/logging/audit-logger.ts` 改动（共 2 处逻辑 + 文案同步）：

1. `ERROR_CODE_PATTERN`：`/^AUTH_[A-Z_]+$/` → **`/^(AUTH|ADMIN)_[A-Z_]+$/`**（admin 错误码可写入审计，FR-032/AC-026）
2. `AuditEvent` 字符串字面量联合类型新增（FR-033，**非 TS enum**）：
   - `'admin.login.success'` — subject = `ADMIN_LOCAL_USERNAME`（E 路径唯一本地管理员标识，即登录成功时的输入 username；FR-025）
   - `'admin.login.failure'` — code 关联 `ADMIN_AUTH_INVALID_CREDENTIALS`；subject = **经 Zod 校验后的用户输入 username**（≤64 已限长、注入面受控，失败尝试值可审计；v1.1 裁决，AR1-008）
   - `'admin.logout.completed'` — subject = 验签 `admin_session` 成功时取其 sub；无 cookie 或验签失败时 subject 留空（审计事件仍记录；与 §5.3 约定一致，v1.2/AR2-003）
3. 内部报错文案与头注释同步为「code 字段仅允许 AUTH_*/ADMIN_* 错误码」（附录 C 任务 11）

`AuditContext`（code/detail/subject）与 `SENSITIVE_KEY_PATTERN` 黑名单**不变**（admin 事件同样受脱敏约束）。

---

## 6. 目录结构

```text
app/
  admin/
    actions.ts                        # ADM-M09 Server Actions（loginAdminLocal / logoutAdmin，共享于 login/ 与 (panel)/）
    __tests__/                        # ADM-M13 actions 单测（actions.test.ts，与被测代码同位，v1.1/AR1-006）
    login/                            # ADM-M08 公开登录页（无守卫 layout，独立于 (panel) 分组，R2-001）
      page.tsx                        # RSC：粗检跳转（FR-022）/ error 参数（FR-021）/ returnTo 校验（≤ 300 行，FR-020）
      admin-login-client.tsx          # 'use client'：本地表单（useActionState）+ SSO LoginButton + 错误提示（NFR-008）
    (panel)/                          # ADM-M10 受守卫分组（URL 无 (panel) 前缀，FR-028）
      layout.tsx                      # RSC：requireAdminPage() + 侧边栏 + 头部（仅渲染，dev-workflow Layout 拆分）
      layout-client.tsx               # 'use client'：头部交互（管理员信息 name ?? sub + 登出按钮 dropdown）
      page.tsx                        # Dashboard：两模块入口卡片 + 范围说明（纯占位不查库，FR-029）
      users/
        page.tsx                      # 用户管理空框架占位（预留路由/导航，FR-030）
      resources/
        page.tsx                      # 资源管理空框架占位（预留路由/导航，FR-030）
    README.md                         # 路由分组 README（命名规范 §三）
app/lib/
  admin/
    constants.ts                      # ADM-M01 Edge-safe 纯字符串常量（零依赖、无 import，FR-004）
    config.ts                         # ADM-M02 getAdminConfig / validateAdminEnvVars（惰性校验，FR-002/003）
    qualification.ts                  # ADM-M03 isAdminSub 纯函数（FR-005）
    session.ts                        # ADM-M04 sign/verifyAdminSession + verifyLocalCredentials + cookie 属性（Node-only，FR-006~008）
    guard.ts                          # ADM-M06 requireAdminPage 并集守卫（FR-010~014）
    types.ts                          # AdminClaims / AdminSessionClaims / AdminConfig 等（§5.1）
    __tests__/                        # ADM-M13 单测（config / qualification / session / guard 全分支，全 mock）
    README.md                         # 核心业务模块 README
  auth/
    guard.ts                          # ADM-M05 仅 export verifyAccessToken（一行，无行为变化，FR-009）
  sso/
    token-cookie.ts                   # ADM-M05 仅 export cookieSecure()（一行，FR-007）
  logging/
    audit-logger.ts                   # ADM-M11 ERROR_CODE_PATTERN 扩展 + AuditEvent 3 事件（FR-032/033）
middleware.ts                         # ADM-M07 Edge 扩展（白名单 + 302 目标 + 双 cookie 粗检，FR-015~017）
.env.local.example                    # ADM-M12 4 个 admin env 登记（值留空，AC-035）
tests/e2e-tests/specs/admin-framework.spec.ts   # ADM-M13 E2E（@no-llm 主测 E 路径，AC-033）
playwright.config.ts                            # ADM-M13 chromium 项目 testMatch 增补 admin-framework.spec.ts（v1.3/R3-001）
```

要点：
- 路由分组：`app/admin/login/`（公开）+ `app/admin/(panel)/`（守卫），**URL 不变**（`/admin`、`/admin/users`、`/admin/resources`），全部顶层路径无 locale 前缀（FR-018/AC-018）
- 页面粒度：`page.tsx`（数据/校验）+ `admin-login-client.tsx`（交互）+ `actions.ts`（Server Action），单文件 ≤ 300 行（FR-020/NFR-009）
- 跨模块引用一律 `@/` 绝对路径，同目录 `./`；组件文件 kebab-case（NFR-009）
- 组件归属（v1.1，AR1-012）：本期组件 co-locate 于路由目录（FR-020 已裁决，对齐既有 login-client 模式，属对 component-rules §一 `components/admin/` 约定的**合理偏离——spec 决策优先**）；未来出现跨页面复用的 admin 业务组件时归入 `components/admin/`，样式遵循 §3 语义变量约束

---

## 7. 依赖关系

| 文件 | 调用（@/ 绝对路径） | 被调用 |
|------|---------------------|--------|
| `middleware.ts` | `@/app/lib/admin/constants`（ADMIN_SESSION_COOKIE_NAME）、`@/app/lib/sso/token-cookie`（ACCESS_TOKEN_COOKIE_NAME）、本地 `decodeJwtExp`/`isAdminSessionValid` | Next.js 运行时（matcher） |
| `app/lib/admin/constants.ts` | **无（零依赖）** | middleware.ts、session.ts、admin/guard.ts、login/page.tsx、actions.ts |
| `app/lib/admin/config.ts` | 仅读 `process.env` | session.ts、admin/guard.ts、actions.ts（经 getAdminConfig） |
| `app/lib/admin/qualification.ts` | **无（纯函数）** | admin/guard.ts |
| `app/lib/admin/session.ts` | `@/app/lib/admin/constants`、`@/app/lib/admin/config`、`@/app/lib/sso/token-cookie`（cookieSecure）、jose、node:crypto | admin/guard.ts、actions.ts |
| `app/lib/admin/guard.ts` | `@/app/lib/auth/guard`（verifyAccessToken）、`@/app/lib/admin/session`、`@/app/lib/admin/qualification`、`@/app/lib/admin/constants`、`@/app/lib/sso/token-cookie`、next/headers、next/navigation | `(panel)/layout.tsx` |
| `app/lib/auth/guard.ts`（改） | 既有（verifyAccessToken 现 export） | admin/guard.ts |
| `app/lib/sso/token-cookie.ts`（改） | 既有（cookieSecure 现 export） | session.ts、middleware.ts（既有） |
| `app/admin/actions.ts` | `@/app/lib/admin/config`、`@/app/lib/admin/session`、`@/app/lib/admin/constants`、`@/app/lib/sso/token-cookie`（isSafeReturnTo）、`@/app/lib/logging/audit-logger`、zod、next/headers、next/navigation | login/admin-login-client.tsx（useActionState）、`(panel)/layout-client.tsx`（logoutAdmin） |
| `app/admin/login/page.tsx` | `@/app/lib/sso/token-cookie`（ACCESS_TOKEN_COOKIE_NAME/isSafeReturnTo）、`@/app/lib/admin/constants`、本地 `decodeJwtExp`/`isLoginPath` | Next.js 路由 |
| `app/admin/login/admin-login-client.tsx` | `@/app/admin/actions`（loginAdminLocal）、`@/components/auth/login-button`、`@/components/ui/*` | login/page.tsx |
| `app/admin/(panel)/layout.tsx` | `@/app/lib/admin/guard`（requireAdminPage） | Next.js 路由分组（包裹 users/resources） |
| `app/admin/(panel)/layout-client.tsx` | `@/app/admin/actions`（logoutAdmin）、`@/components/ui/*` | layout.tsx |
| `app/lib/logging/audit-logger.ts`（改） | 无（console） | actions.ts、guard.ts（既有） |

依赖规则校验（可静态检查）：
- **Edge 边界**：middleware.ts 全文件不得出现 `app/lib/admin/{config,session,guard,qualification}` 引用、不得出现 `ADMIN_SESSION_SECRET` 字符串（AC-017）
- **单向依赖**：admin → auth（ADM-M06 → ADM-M05）、admin → sso（token-cookie 常量），无反向依赖、无循环
- **禁止跨模块 `../`**：上述引用全部为 `@/` 绝对路径（NFR-009）

---

## 8. 非功能设计

### 8.1 性能（NFR-007）

- middleware 粗检零新增外部调用与密钥运算：`admin_session` 仅本地 base64url 解码取 exp（复用 `decodeJwtExp`，Web API），与 SSO 粗检同量级
- Node 层完整验签仅受保护页面请求时执行一次（`(panel)/layout` 层）；HS256 验签为本地 CPU 运算，无网络往返
- `getAdminConfig()` 模块级缓存（首次校验后直接复用，对齐 `getSsoEnv`/`getSsoConfig` 模式），无重复 env 解析
- 无新增缓存/存储需求（本期无 DB、无外部调用）

### 8.2 安全

| 项 | 设计 | 依据 |
|----|------|------|
| 密码恒时比较 | sha256 归一（恒 32 字节）后 `timingSafeEqual`，规避长度不等抛错；不引 bcryptjs | NFR-001/AC-022 |
| 密钥强度 | `ADMIN_SESSION_SECRET` ≥ 32 字符（HS256 最小安全密钥）；`admin_session` HS256 15 分钟，无续期/刷新 | NFR-002 |
| Cookie 属性 | `httpOnly` + `sameSite=lax` + `path=/` + `secure` 仅生产（复用新导出的 `cookieSecure()`）+ `maxAge=900` | FR-007/NFR-003/AC-013 |
| Edge 无密钥 | middleware 仅解码 exp 不验签，禁 import admin 服务模块、禁 `ADMIN_SESSION_SECRET`（Edge bundle 内联泄露风险）；禁 `NEXT_PUBLIC_ADMIN_*` | NFR-005/FR-017 |
| 输入验证 | 登录表单经 Server Action Zod 服务端验证，禁信任客户端；Zod 拒绝不触达凭据比较 | NFR-004/FR-023 |
| 爆破防护 | 复用既有 middleware per-IP 限流（20 次/分，matcher 已覆盖 `/admin/login` POST）；不新增账号锁定 | FR-027 |
| 审计 | `admin.login.success` / `admin.login.failure` / `admin.logout.completed`；错误码 `ADMIN_AUTH_*` 过 `ERROR_CODE_PATTERN`；脱敏黑名单不变 | NFR-006/FR-032/033 |
| 开放重定向 | returnTo 经 `isSafeReturnTo` + `isLoginPath` 双重校验，非法回退 `/admin` | FR-023 |
| 防重定向循环 | `/admin/login` error 参数跳过粗检跳转（FR-022）；middleware 仅对非 login admin 路径生成 returnTo | FR-021/022 |
| 纵深防御 | middleware 粗检仅第一道，Node 层完整验签为最终裁决（fail-closed，X7） | FR-010/017、AC-027 |

### 8.3 可扩展性（附录 F 预留）

- **RBAC 分级（F-2）**：并集判定（`isAdminSub`）可平滑升级为角色判定（sub → role 映射），不改守卫结构
- **用户管理/资源管理（F-1/F-3）**：占位页路由已预留，后续在 `(panel)` 分组内扩展页面 + Server Actions；操作审计可复用扩展后的 auditLogger
- **`/api/admin/*`（F-4）**：预留；届时走 middleware 既有 API 分支（401 JSON）或按需扩展双 cookie 判定，Node 侧复用 `requireAdminPage` 同级守卫
- **本地管理员 2FA/TOTP（F-5）**：E 路径增强点（loginAdminLocal 校验后追加），不影响 D 路径

---

## 9. 风险与对策

> spec 业务决策 A1~A5 + B1/B2 全部已确认，本架构**不产生新的「开放决策项」**；以下为 spec 未覆盖的真实技术缺口与实现风险，标注候选方案。

| # | 风险 | 等级 | 对策（候选方案） |
|---|------|------|------------------|
| 1 | **Edge 粗检误放行被篡改的 admin_session**：middleware 仅解码 exp 不验签，伪造/篡改但 exp 未过期的 cookie 通过粗检 | 低（可接受） | 纵深防御：Node 层 `requireAdminPage` 完整验签为最终裁决（fail-closed，X7）；与 SSO 既有同款风险模型一致（FR-017 语义） |
| 2 | **jose v6 HS256 API 细节**：`SignJWT`/`jwtVerify` 对 HMAC 密钥的传入格式（`Uint8Array`/`importJWK`）与 `alg` 白名单配置需按 v6 文档验证 | 低 | 实施前经 Context7 查询 jose v6 文档确认；候选：`SignJWT().setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret))`；单测覆盖签验往返（AC-012） |
| 3 | **cookies() 只读性与 redirect 顺序**：`requireAdminPage` 内 `cookies()` delete 与 `redirect()` 的响应合并语义（Set-Cookie 是否随 302 发出） | 中 | 既有 `requireAuthPage` 已实现同款模式（AR3-006 验证过），照搬；单测断言清 cookie + redirect 双效应（AC-008/009/010） |
| 4 | **Server Action cookie 写入 + redirect 顺序**：`loginAdminLocal` 内 `cookies().set` 后 `redirect()`，Next 是否保证 Set-Cookie 随重定向响应发出 | 中 | 候选：E2E 断言重定向响应 Set-Cookie 头（实际载体 303，见 §4.1 状态码注记，AR1-011）；若不满足，改为写 cookie 后返回成功态由 client 侧 `router.push`（次选，不符合 Server Action 直跳约定，尽量不用）。**v1.3/R3-003：`loginAdminLocal` 为全仓首个 Server Action（app/ 下现无 `'use server'` 文件），无仓内先例；该断言已升格为 spec AC-019 硬性验收项（spec v1.5），禁止跳过** |
| 5 | **returnTo 超长**：middleware 生成的 `returnTo=<pathname+search>` 可能超 Zod 2048 上限 | 低 | Zod 拒绝即回退 `/admin`（FR-023 已定义非法回退语义），无安全影响 |
| 6 | **私有函数副本**（v1.1 补全盘点，AR1-005）：`decodeJwtExp` **三处**（middleware.ts、app/login/page.tsx 既有 + admin/login/page.tsx 新增，前两处经源码核实）+ `isLoginPath` 两处（login/page.tsx 与 admin 侧）；语义对齐但存在漂移风险 | 低 | 均为 Web API/纯字符串实现，Edge/Node 双运行时与零依赖约束下不强行抽共享模块（既有可复用模块含 Node 依赖，login/page.tsx 为 RSC 粗检专用）；单测断言各形态（`/admin/login`、`/{locale}/login`、exp 解码）；`[locale]` 落地或出现第四处副本时统一提取 Edge-safe 纯函数模块（对齐 constants.ts 模式） |
| 7 | **middleware 行数**：现 299 行 + admin 扩展约 40 行 → 约 340 行，未超 500 上限 | 低 | 若后续超限：拆分计划为将 admin 粗检提取至独立 Edge 模块（仍仅引 constants.ts 字符串常量，维持 Edge 边界） |
| 8 | **D 路径正向 E2E 依赖真实 IDP**（AC-034）：需 IDP 可达 + 测试账号 sub 预入 `ADMIN_SSO_SUBS` | 中 | 按附录 E 分级：`@no-llm` 主测 E 路径（AC-033，离线稳定）；D 正向用例标注需真实 IDP（A3），本地不可达时跳过不阻塞 |
| 9 | **`.env.local.example` 值留空导致本地 E2E 失败**（AC-035） | 中 | playwright.config webServer env 注入测试值或本地 `.env.local` 配置（附录 E 已定义）；CI 用 env 覆盖 |
| 10 | **D 路径白名单拒绝分支无法 E2E**（决策 A1/A5） | 低（已裁决） | 仅单测覆盖：mock `verifyAccessToken` 返回合法 claims + 无 `admin_session`，断言 redirect `/admin/login?error=ADMIN_AUTH_FORBIDDEN` 且不清 SSO cookie（AC-007/032） |
| 11 | **`requireAdminPage` 单文件行数**：并集全分支 + 清 cookie + redirect 预计 ~120 行 | 低 | 未超 500 上限；若超限拆分：将 D/E 分支提取为模块私有函数（同文件内），不破坏模块边界 |
| 12 | **主文档行数超 500 行上限**（v1.0 实测 520 行） | 低（**v1.1 已解决**，AR1-003） | 拆分已执行：§10 FR 覆盖矩阵与附录 AC 核对抽离至 `docs/architecture/arch-admin-fr-matrix.md`（对齐 `arch-sso-fr-matrix.md` 先例），主文档 ≤ 500 行，§10 原位置保留引用指向 |

---

## 10. FR 覆盖矩阵（抽离引用，v1.1/AR1-003）

完整 FR-001~033 逐条架构落点矩阵、AC 与既有基线核对及维护说明，见附属文件 **`docs/architecture/arch-admin-fr-matrix.md`**（对齐 `arch-sso-fr-matrix.md` 先例）。落点变更明细以矩阵内「（vN.N）」轮次标注为唯一登记处，本节不枚举具体 FR 号（单向引用，v1.2/AR2-002）。