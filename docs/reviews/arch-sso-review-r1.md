# SSO 集成模块架构评审意见（全站登录墙决策变更修订，第 1 轮）

- **评审对象**：`docs/architecture/arch-sso-v1.3.md`（draft，v1.2→v1.3 业务决策变更修订）
- **关联文档**：`docs/specs/spec-sso-auth-v1.3.md`（approved）、`docs/specs/spec-sso-token-v1.2.md`（approved）、`docs/architecture/arch-sso-fr-matrix.md`（v1.3）、`docs/修订调度prompt方案-全站登录墙.md` §一/§三、`package.json`
- **评审人**：nextjs-architecture-reviewer
- **轮次**：第 1 轮（业务决策变更修订后评审）
- **日期**：2026-08-11
- **评审结论**：**需修订**（重要级 3 项 + 建议级 8 项，共 11 项；无阻塞级）

---

## 一、评审重点核验（7 项逐条结论）

### 1. matcher 表达式豁免与 302/401 死循环 —— 有条件通过

**结论**：当前状态（`[locale]` 未落地）下 matcher 表达式正确豁免 `/`（白名单豁免认证、计入限流）、`/login`（负向断言排除）、`/api/sso/*` 与 `/api/health`（进 matcher 但白名单豁免认证）、`/_next/static`、`/_next/image`、`favicon.ico`（负向断言排除），无 302/401 死循环。但存在两处前瞻缺口（AR3-001、AR3-004）。

核验明细（§4.1.3 matcher 表达式）：

```typescript
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|login).*)',
  ],
};
```

- `/` 命中第二条 → middleware 内白名单豁免认证（限流生效，D-004 有意决策）✓
- `/solve`、`/result` 命中 → 认证粗检 → 未登录 302 `/login?returnTo`（FR-029）✓
- `/login` 负向断言排除，不进 middleware ✓（防 302 死循环，FR-028）
- `/api/sso/*`、`/api/health` 命中第一条 → 限流 + 白名单豁免认证 ✓（与现状 middleware.ts L109-111 一致）
- `/_next/static`、`/_next/image`、`favicon.ico` 负向断言排除 ✓
- 未认证响应分流：页面 302+returnTo / API 401 JSON（FR-016 差异化）✓ 与 spec FR-016 一致

**缺口**：`/{locale}/login`（[locale] 前缀登录页）未被负向断言排除、未入白名单常量（AR3-001）；Next.js metadata 文件（icon.svg/apple-icon.png/opengraph-image 等）与 robots.txt/sitemap.xml 未纳入豁免（AR3-004，当前项目仅 favicon.ico 不触发）。

### 2. 页面层认证落点 —— 通过

- 与 spec FR-029 触发判定准则一致：页面涉及服务端数据获取/服务端写操作/layout 级用户态渲染时才接入 `requireAuthPage()`（§4.1.3 Node 层、AD-14）✓
- 当前 `/solve`（'use client' 输入表单页）、`/result`（'use client' 读 sessionStorage）归类正确——源码核对 `app/solve/page.tsx`（'use client'，无服务端场景）、`app/result/page.tsx`（'use client'，读 sessionStorage）均无服务端数据获取/写操作 ✓
- M5 guard 复用合理：`requireAuthPage()` 与 `requireAuth(request)` 共用验签核心 `verifyAccessToken(token)`、JWKS 唯一路径（AR1-006）✓（§5.2 签名 `requireAuthPage(): Promise<ServiceResult<AccessTokenClaims>>`，RSC 内 cookies() 读 token）
- middleware 禁引用 SSO 密钥 env 约束保持：§4.1.3 注、§7.2、§8.2 安全 #2 均明确 ✓
- 细节：requireAuthPage 失败路径（清 cookie + 302）实现载体未明确（AR3-006）

### 3. AD-01 变更波及已确认架构 —— 通过（一处表述矛盾）

- 两层运行结构职责划分保留：AD-03（middleware Edge 无 client_secret / Node 深校验）✓
- token 轮换（OQ-004）保留：§4.1.4 ✓
- 限流先于认证（AR1-001）保留：§4.1.3 顺序说明 ✓
- JWKS 复用唯一路径（AR1-006）保留：AD-07、§2.2、§5.2 ✓
- [locale] 302 二段式规则（AR1-009）保留并更新：§4.1.3 ✓
- 矛盾：§8.2 安全 #8 与 §9.1 R-14 的「白名单不进 matcher」表述与 §4.1.3 实际行为不符（AR3-002）

### 4. fr-matrix 同步完整性 —— 基本通过

- auth FR-028/029/030：v1.3 标注完整（白名单、302+returnTo、Node 深校验判定准则、/login 入口页）✓
- token FR-003/FR-024：v1.3 标注完整（分层语义在全站登录墙范围成立、matcher 扩展页面计入限流、AR2-012 更新为 OQ-010）✓
- token FR-017~020 N/A 维持（OQ-002 不内省）✓
- 遗漏：auth FR-005（returnTo 来源扩展：middleware 302 query / 登录按钮上下文）与 FR-001（/login 入口页作为登录入口）未标注 v1.3（AR3-009）

### 5. 超范围改动与规范 —— 通过（除行数）

- 无超范围改动：v1.3 变更均属 D-001~D-006 及伴随澄清（§1.4 matcher 边界、§4.1.3 API 401、R-14/R-15、§8.3 订单预留、OQ 状态同步）✓
- 技术选型与 package.json 一致：jose ^6.2.8（package.json L49 已确认）、zod ^3.24.1、lru-cache ^11.5.1、lucide-react ^1.21.0、cva/tailwind-merge/clsx、Next 15.1.6、TS ^5.7.3、Tailwind ^3.4.17、Vitest ^3.0.0、@playwright/test ^1.61.1 全部一致 ✓
- 无 any（middleware.ts L80 用 `unknown`、guard.ts 用类型断言非 any）✓；无跨模块 `../` 引用（§5.2 注释统一 `@/app/lib/`，AR2-005 已解决）✓
- **主文档 624 行超 500 行约束**（AR3-003）

### 6. token spec 交叉引用一致性 —— 通过

- token FR-003（会话超时分层）：全站登录墙下语义成立——受保护操作扩展为全部页面+API，middleware 仅 exp、Node 深校验 fail-closed（页面经 requireAuthPage）✓
- token FR-024（SSO 端点限流）：架构已回应 spec 委托——/login 不进 matcher（登录动作经 /api/sso/authorize 限流覆盖），页面 HTML 计入限流全集 ✓
- token FR-017~020（内省）N/A 维持 ✓
- 提示：token spec v1.2 对 auth spec 版本引用过时（B-001 引 v1.1），spec v1.3 §7.1 已标注待修订，架构侧可加注对齐（AR3-011）

### 7. 首页 / 公开语义 —— 通过

- matcher 豁免：`/` 进 matcher 但白名单豁免认证（§4.1.3）✓
- 不展示个人信息、不强推登录：§8.2 安全 #11、§1.1 US-006 ✓；源码 `app/page.tsx`（RSC）无用户信息 ✓
- [locale] 前缀首页延续公开语义：§4.1.3、§8.2 #11、fr-matrix FR-028 ✓
- 首页计入限流（防高频抓取）：§4.1.3、§8.2 #11 ✓（配额场景评估见 AR3-005）

---

## 二、问题清单

### 2.1 阻塞级（0 项）

无。当前状态（无 `[locale]`、无 metadata 文件）下 matcher 表达式无 302/401 死循环，登录墙可实施。

### 2.2 重要级（3 项）

| 编号 | 维度 | 问题描述 | 依据（文件+位置） | 修复建议 |
|------|------|---------|-----------------|---------|
| AR3-001 | matcher / 死循环 | **`/{locale}/login`（[locale] 前缀登录页）未被 matcher 负向断言排除、未入 middleware 白名单常量**。§4.1.3 matcher 第二条 `'/((?!_next/static|_next/image|favicon.ico|login).*)'` 仅排除顶层 `login`；白名单常量仅含 `/api/sso`、`/api/health`、`/`（及 [locale] 前缀首页）。而 AR1-009 二段式规则承诺 [locale] 落地后 302 → `/{locale}/login`，§6 已规划 `app/[locale]/login/page.tsx`。落地后：① 未登录访问 `/{locale}/login` 被 middleware 认证粗检拦截 → 302 顶层 `/login`，locale 登录页不可达；② 登录后回跳 `returnTo=/{locale}/login` 时，/login 页已登录重定向的「排除自身」仅覆盖 `/login`（FR-030），`/{locale}/login` 与 `/login` 规范化后不相等 → 自身 302 循环。**当前不触发（[locale] 未落地），但 matcher 表达式为本次修订核心交付物，应一次性写对；落地时未修复将升级为阻塞** | arch-sso-v1.3.md §4.1.3 matcher 表达式/白名单常量/302 locale 规则、§6 `app/[locale]/login/page.tsx`；spec-sso-auth-v1.3.md FR-028/FR-030 | ① matcher 负向断言扩展覆盖 locale 前缀登录页（如 `(?!_next/static|_next/image|favicon.ico|login|zh/login|...)`）或 middleware 内按 locale 支持列表豁免 `/{locale}/login`；② 白名单常量补充 locale 前缀登录页；③ /login 页已登录重定向排除目标扩展为「与 `/login` 或 `/{locale}/login` 规范化相等」；④ R-12/R-14 补充该场景断言 |
| AR3-002 | 文档内部矛盾 | **§8.2 安全 #8「公开白名单（含 /login）不进 matcher」与 §9.1 R-14「/login、/api/sso/*、/_next/*、favicon 不进 middleware」表述与 §4.1.3 实际行为矛盾**。实际：`/`、`/api/sso/*`、`/api/health` 均**进** matcher（仅豁免认证粗检；`/api/health` 另豁免限流），只有 `/login`、`/_next/*`、favicon 不进 matcher。白名单 4 成员中 3 个进 matcher。该表述会误导实施——开发 agent 可能误将 `/api/sso/*` 排除出 matcher（限流失效、IDP 调用面无保护）或误将 `/` 排除出 matcher（首页不限流，D-004 防高频抓取失效） | arch-sso-v1.3.md §8.2 安全 #8（L496）、§9.1 R-14（L534）vs §4.1.3 matcher 表达式与白名单常量（L175-198） | 统一表述为：「`/login`、`/_next/*`、favicon 不进 matcher；`/`、`/api/sso/*`、`/api/health` 进 matcher 但豁免认证粗检（`/api/health` 另豁免限流）」；R-14 对策同步修正 |
| AR3-003 | 规范约束 | **主文档 arch-sso-v1.3.md 共 624 行，超 code-style 单文件 ≤500 行约束**。v1.2 因 R-13 拆分 fr-matrix 后达标（r2 评审确认），v1.3 增补（D-001~D-006 标注、§1.4 边界澄清、§4.1.3 扩展、R-14/R-15、§8.3）后超限 124 行，R-13 承诺的「后续修订超限时优先拆分 §4 数据流」未执行 | arch-sso-v1.3.md（total 624 lines）；.opencode/rules/global/code-style.md 单文件 ≤500 行；fr-matrix 维护说明「主文档行数约束为拆分动因（R-13）」 | 按 R-13 拆分 §4 数据流（如 §4.1.3 受保护资源访问拆为独立文件，主文档保留摘要与引用），或精简 v1.3 冗余标注（D-xxx 标注可收敛为变更对照表） |

### 2.3 建议级（8 项）

| 编号 | 维度 | 问题描述 | 依据 | 建议修法 |
|---|---|---|---|---|
| AR3-004 | matcher / 前瞻 | **Next.js 框架资源文件（metadata 约定）未被负向断言覆盖**。§4.1.3 matcher 负向断言仅排除 `_next/static|_next/image|favicon.ico|login`。Next.js 会自动将 `app/icon.svg`→`/icon.svg`、`app/apple-icon.png`、`app/opengraph-image.*`、`app/twitter-image.*` 以及 `robots.txt`/`sitemap.xml` 映射为根路径静态资源；落地这些文件后将被 middleware 认证粗检拦截，破坏分享预览与 SEO 抓取。spec FR-028 白名单语义为「`/_next/*` 与 favicon **等框架资源**不得被拦」，当前 matcher 未完整覆盖「等框架资源」。当前项目仅 `favicon.ico`（已豁免）故不触发，但 matcher 表达式为本次修订核心交付物，应一次性写对 | arch-sso-v1.3.md §4.1.3 matcher 表达式；spec-sso-auth-v1.3.md FR-028；glob 核对 app/ 下当前仅 favicon.ico | 负向断言一次性扩展覆盖 metadata 约定（如 `(?!_next/static|_next/image|favicon\.ico|icon\.svg|apple-icon|opengraph-image|twitter-image|robots\.txt|sitemap\.xml|login|...)`）；R-14 断言同步补充 |
| AR3-005 | 限流 / 容量 | **页面 HTML 计入限流后的配额未评估**。D-002 限流全集含页面 HTML（§4.1.3 限流分支 `if (pathname.startsWith('/'))` 等），单 IP 20 次/分（middleware.ts L29 RATE_LIMIT_MAX）未按新范围（页面浏览 + login 入口 + authorize/callback + 解题接口）重新评估。典型用户流：进入 /login → 登录回调 → /solve 输入 → 提交解题 → /result，页面请求可超 20 次/分（含刷新/表单错误回跳），存在 429 风险；与 NFR-004「不改变已登录用户契约」存在张力。快速翻页浏览公开首页的用户同样可能触限（爬虫高频抓首页也被限，D-004 意图内但需确认配额） | arch-sso-v1.3.md §4.1.3 限流分支、D-002；/var/learning/middleware.ts L29；spec-sso-auth-v1.3.md FR-024（页面级路径决策归架构） | 评估页面请求与 API 请求分桶或提高页面配额；在 R-12 或 §12 验证清单补充「完整用户流不触 429」E2E 断言（含快速翻页场景） |
| AR3-006 | 可实施性 | **requireAuthPage 失败路径的实现载体未明确**。§4.1.3 对页面深校验失败仅写「由调用方清 cookie + 302」（AC-039），未指明实现机制：RSC 内无法返回 `NextResponse.redirect`，需 `next/navigation` 的 `redirect()`（抛 NEXT_REDIRECT 由框架处理）且须在跳转前 `cookies().delete(ACCESS_TOKEN_COOKIE_NAME)`（cookies() 为只读、删除通过 await 的 cookies() 实例）。§8.3 订单 layout 级校验（`app/orders/(protected)/layout.tsx`）同为 RSC 载体，同一载体约束适用 | arch-sso-v1.3.md §4.1.3 页面深校验（AC-039）、§8.3；guard.ts requireAuthPage 签名 | 在 §4.1.3 明确载体：`redirect()` + 先 `(await cookies()).delete()` 再跳转；layout 级校验同载体；补充该实现约束至 R-14 或 §10 实施注意 |
| AR3-007 | Edge 边界 | **token-cookie 模块的 Edge 兼容约束未声明**。现 middleware.ts L23 `import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie'`，该模块在 Edge 与 Node 双运行环境被引用（middleware 读 cookie 名、Node 侧写 cookie）。v1.3 未声明该模块必须保持 Edge 兼容（纯常量/同构，禁 Node API 依赖），若未来在其中引入 Node-only 依赖（如 crypto 高级用法、fs、env 读取）将破坏 Edge 构建，或引入敏感 env 引用造成内联泄露（与 FR-024「middleware 禁引用 SSO 密钥 env」同类风险）。架构对 pkce.ts 已有同构声明（AR2-011），token-cookie 缺对齐 | arch-sso-v1.3.md §4.1.3；/var/learning/middleware.ts L23；spec-sso-token-v1.2.md FR-024 | 在 §2.1 M 职责或 §4.1.3 为 token-cookie 增加「Edge/Node 同构纯模块，仅 cookie 名常量，禁 Node API 与 env 引用」声明，与 pkce.ts 对齐 |
| AR3-008 | 模块边界歧义 | **「/login 页复用 oauth-client 能力」表述与 M2/M7 职责冲突**。§6 目录约定⑤与 §11 步骤 9 写「login/page.tsx 复用 app/lib/sso/oauth-client 能力（经 /api/sso/authorize 服务端构造 authorize URL）」。但 M7 职责为 /login 页仅 RSC 检测 + 重定向 + returnTo 透传 + 错误提示；oauth-client 是 M2 服务层，仅由 Route Handler 调用（§4.1.1 主流程为前端生成 PKCE → form POST /api/sso/authorize → 服务端经 oauth-client 构造 URL）。若 RSC 直接调用 oauth-client，则 PKCE 生成方变为服务端，与 FR-003「PKCE 前端生成」矛盾；且 RSC 内调用服务层使登录动作绕过 Route Handler 保护（限流/审计） | arch-sso-v1.3.md §6 目录约定⑤、§11 步骤 9、§4.1.1；spec-sso-auth-v1.3.md FR-003；M2/M7 职责（§2.1） | 删除「/login 页复用 oauth-client」表述；明确 /login 页登录动作统一经 `login-button`（login-client.tsx）form POST `/api/sso/authorize`，oauth-client 仅 Route Handler 使用 |
| AR3-009 | fr-matrix 同步 | **fr-matrix 遗漏两处 v1.3 标注**。① auth FR-005（returnTo 来源）未标注 v1.3 扩展：middleware 302 query 来源之外，登录按钮上下文透传（§4.1.1 步骤 2 用户触发）为新增来源；② auth FR-001（登录发起）未标注「/login 入口页」作为登录入口（与 FR-030 关联）。fr-matrix 为「v1.3 已同步」交付物，遗漏削弱其作为唯一事实源的定位 | /var/learning/docs/architecture/arch-sso-fr-matrix.md（FR-005/FR-001 行）；arch-sso-v1.3.md §4.1.1；spec-sso-auth-v1.3.md FR-030 | 在 fr-matrix 补 FR-005/FR-001 的 v1.3 标注（变更描述 + 关联 FR-030） |
| AR3-010 | 概念澄清 | **FR-028「白名单」与 middleware 白名单常量概念未澄清**。FR-028 白名单（业务概念，含 /login）与 §4.1.3 白名单常量（实现概念，认证豁免不含 /login——/login 由 matcher 负向断言排除而非白名单豁免）同名不同义。§2.1 M6 职责写「白名单含 /login」而 §4.1.3 常量不含，执行流程 a 亦不含；实施时易困惑（/login 到底进不进常量）。功能无影响（matcher 已保证），但影响可维护性 | arch-sso-v1.3.md §2.1 M6、§4.1.3 白名单常量；spec-sso-auth-v1.3.md FR-028 | 在 §4.1.3 或 §2.1 澄清两概念关系：「FR-028 白名单为业务语义（公开路径集合，含 /login）；middleware 白名单常量为实现语义（仅认证豁免路径，/login 由 matcher 负向断言实现公开）」 |
| AR3-011 | 交叉引用 | **token spec 版本引用过时未在架构侧标注**。spec-sso-token-v1.2.md 的 B-001/§1.2/FR-025 引用「spec-sso-auth v1.1，draft」，而 auth spec 已升 v1.3 approved；spec-sso-auth-v1.3.md §7.1 已标注「token 引用待下一轮修订」，但架构文档 §1.2/§10 未同步标注该过时引用，形成 spec 侧已知、架构侧无痕的状态 | spec-sso-token-v1.2.md B-001/§1.2/FR-025；spec-sso-auth-v1.3.md §7.1；arch-sso-v1.3.md §1.2/§10 | 架构 §1.2 或 §10 增加一条注记：「token v1.2 对 auth spec 版本引用（v1.1）过时，待 token 下一轮修订统一」，避免后续误读 |


---

## 三、FR 覆盖核验表

### 3.1 spec-sso-auth v1.3（FR-001~FR-030）

| FR | 摘要 | 落点（arch-sso-v1.3.md） | 核验 |
|---|---|---|---|
| FR-001~005 | 登录发起（入口、授权重定向、PKCE、callback、returnTo） | §4.1.1 主流程、§6 login/page.tsx + login-client.tsx、/api/sso/authorize + /callback Route Handler、oauth-client | 通过（FR-005 returnTo 上下文透传标注缺失见 AR3-009；FR-001 /login 入口页标注缺失见 AR3-009） |
| FR-006~010 | 回调与令牌交换（code→token、错误处理） | §4.1.1 步骤 4、/api/sso/callback | 通过 |
| FR-011~014 | 身份验证与用户信息（id_token 验签、用户态） | §2.1 M 职责、guard 验签（RS256/kid/iss/aud/exp） | 通过 |
| FR-015~018 | 会话与 Cookie 管理（写入/过期/401 语义） | §4.1.3 认证粗检 exp 解码、401 AUTH_SESSION_INVALID（FR-016 语义） | 通过 |
| FR-019~023 | 登出（revoke、end session、post_logout 白名单、returnTo 透传） | §4.1.1 步骤 9、/logout 动作、FR-023 returnTo 透传 | 通过 |
| FR-024~027 | 安全与配置（限流、错误码、脱敏） | §4.1.3 限流分支（D-002）、§8.2、AUTH_* 错误码复用 | 通过（FR-024 页面限流配额评估缺 AR3-005） |
| FR-028 | 白名单（/、/login、/api/sso/*、/api/health、_next 静态与 favicon 不被拦、[locale] 首页延续公开） | §4.1.3 matcher 表达式 + 白名单常量（L175-198） | 有条件通过（/login 语义与实现概念混淆 AR3-010；§8.2/R-14 表述矛盾 AR3-002；框架资源覆盖缺 AR3-004；/{locale}/login 缺 AR3-001） |
| FR-029 | 页面需登录（middleware 粗检 302+returnTo；Node 深校验判定准则） | §4.1.3 页面分流分支 + requireAuthPage；§2.1 M5；§8.3 layout 预留 | 通过（requireAuthPage 失败载体未明确 AR3-006） |
| FR-030 | /login 入口页（登录态检测、已登录 302 回 returnTo、排除自身防循环） | §6 app/login/page.tsx；已登录重定向排除 /login 自身 | 通过（locale 前缀登录页回跳自循环缺 AR3-001） |

### 3.2 spec-sso-token v1.2（FR-001~FR-026）

| FR | 摘要 | 落点（arch-sso-v1.3.md） | 核验 |
|---|---|---|---|
| FR-001~002 | access_token / refresh_token Cookie 存储 | §4.1.3 Cookie 配置（httpOnly/secure/sameSite/maxAge 15 分钟） | 通过 |
| FR-003 | 会话超时两层判定（middleware 仅 exp 不验签不引密钥；Node 深校验，放行对象=access_token） | §4.1.3 认证粗检（Edge 仅解码 exp）与 Node 深校验分工 | 通过（middleware 禁引用 SSO 密钥 env 约束保持，见评审重点 2 结论） |
| FR-004~010 | 刷新触发/单飞/轮换/失败分类 | 全站登录墙新范围下语义不变（refresh 属 token 生命周期，不涉页面墙） | 通过 |
| FR-011~016 | 登出 revoke/end session/白名单 | §4.1.1 登出流程、FR-022/023 归 auth 编排 | 通过 |
| FR-017~020 | 内省（OQ-02 已裁决 N/A） | §1.2 已确认 OQ-002 不内省 | 通过 |
| FR-021~024 | client_secret 保护/脱敏/限流语义/SSO 端点限流 | §8.2 安全基线、§4.1.3 限流（FR-024 页面级路径决策已落 §4.1.3 限流分支） | 通过（配额评估缺 AR3-005） |
| FR-025~026 | AUTH_* 错误码、统一错误 envelope | §8.2 错误码清单复用 | 通过（token spec 对 auth 版本引用过时标注缺 AR3-011） |

**核验结论**：auth FR-001~030、token FR-001~026 全部有落点，无遗漏 FR、无硬缺口；差异均以建议级问题记录（AR3-001~011）。

---

## 四、技术选型核对表（vs package.json）

| 选型（arch-sso-v1.3.md §3 / §4） | package.json | 核验 |
|---|---|---|
| jose（JWT 验签）^6.2.8 | dependencies L49 `"jose": "^6.2.8"` | 一致 ✓ |
| Next.js 15（App Router） | `"next": "15.1.6"` | 一致 ✓ |
| TypeScript ^5.7.3 | `"typescript": "^5.7.3"` | 一致 ✓ |
| zod（输入校验）^3.24.1 | `"zod": "^3.24.1"` | 一致 ✓ |
| lru-cache（限流/缓存）^11.5.1 | `"lru-cache": "^11.5.1"` | 一致 ✓ |
| lucide-react / cva / tailwind-merge / clsx | 均在 dependencies | 一致 ✓ |
| vitest ^3.0.0 / @playwright/test ^1.61.1（测试） | devDependencies | 一致 ✓ |
| tailwindcss ^3.4.17 | dependencies | 一致 ✓ |

**核验结论**：架构未引入 package.json 之外的新依赖，技术选型全部一致。

---

## 五、总体评价

### 5.1 亮点

- **D-001~D-006 变更落地完整**：全站登录墙范围、matcher 扩展、页面层认证、白名单显式化、/login 入口落地、订单预留，均与修订调度方案 §一一致，无遗漏决策项。
- **已确认架构零破坏**：两层运行结构职责划分、token 轮换（OQ-004）、限流先于认证（AR1-001）、JWKS 复用唯一路径（AR1-006）、[locale] 302 二段式（AR1-009）等已确认项在 v1.3 中保持完整，AD-01 变更未波及（评审重点 3 结论：通过）。
- **页面认证落点与 spec 对齐**：FR-029 触发判定准则（服务端数据获取/写操作/layout 级用户态渲染才接入 requireAuthPage）与 M5 复用合理；当前 /solve、/result 均 'use client' 无服务端场景，仅 middleware 粗检的判定与源码核对一致（评审重点 2 结论：通过）。
- **死循环防护思路正确**：matcher 负向断言排除 /login + 白名单 + /login 页排除自身，构成三层防护；middleware 禁引用 SSO 密钥 env 约束在 v1.3 中保持（评审重点 1/2 结论：核心表达式有条件通过）。

### 5.2 结构性问题

- **AR3-001（重要）**：`/{locale}/login` 未入 matcher 负向断言与白名单常量，[locale] 落地（AR1-009 承诺）时将产生 locale 登录页不可达 + 回跳自循环，属本次核心交付物的「一次性写对」缺口。
- **AR3-002（重要）**：§8.2 安全 #8 与 R-14 对 matcher 行为的表述与实际（§4.1.3）矛盾，会误导实施（误排除 /api/sso/* 或 / 出 matcher 将破坏限流与防抓取）。
- **AR3-003（重要）**：主文档 624 行超 500 行约束，R-13 拆分承诺未执行。

### 5.3 结论

**需修订**（无阻塞项；重要 3 项 + 建议 8 项，共 11 项）。本修订轮为业务决策变更，AR3-004~011 均属文档表述/前瞻/标注类问题，不涉及架构方案推翻；AR3-001 与 AR3-002 建议在下一轮（v1.3 定稿前）优先处理。

---

*本评审仅针对文档内容与已核对的源码/依赖现状，未修改任何正文文件。*
