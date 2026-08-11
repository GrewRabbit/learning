# SSO 集成模块数据流设计（arch-sso-v1.3 附属文件）

**归属**：`docs/architecture/arch-sso-v1.3.md` §4（R-13 拆分计划落地；v1.3 review-r1 按 AR3-003 拆分执行）
**版本**：v1.3（2026-08-11，approved）
**目的**：承载主文档 §4 数据流设计全部内容（含 review-r1 修订 AR3-001/AR3-004/AR3-006/AR3-007/AR3-010）；**章节编号体系延续**——本文件 §4.1.1~§4.1.5、§4.2 与主文档引用一致，主文档内 `§4.1.x` / `§4.2` 引用均指本文件对应小节。
**修订标注**：本文件随主文档 v1.3 同步演进；AR3-xxx 修订点在各小节内联标注。

---

## 4. 数据流设计

### 4.1 正常流

#### 4.1.1 登录发起（SP-Initiated，auth FR-001~005）

```
浏览器 → [点击登录：任意页面登录入口（login-button）或 /login 登录入口页（D-005）] → M7（客户端组件，JS 必需）
  1. 前端生成 code_verifier(≥43) + code_challenge=BASE64URL(SHA256(verifier))、
     state(≥32)、nonce(≥32)（算法取 lib/sso/pkce.ts 同构实现，AR2-011）
  2. 前端写 sessionStorage：{ code_verifier, state, nonce, returnTo }（FR-003/005 前端侧；
     returnTo 来源：middleware 302 携带的 query（FR-029）/ 用户主动登录入口的上下文，
     二者均经 isSafeReturnTo（FR-023）校验；非法 → 默认落地页 OQ-009）
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

**双写数据流闭环（AR1-003/AR2-004，v1.3 扩展 returnTo 入口）**：状态值（含 returnTo）由**前端生成**（写 sessionStorage，前端读）→ 经 form POST **提交路径**传递服务端 → 服务端校验后写 **httpOnly cookie**（服务端读）。两端同值自洽：回调时服务端以 cookie 比对 `state`（权威，FR-007）、读 `sso_return_to` 恢复跳转（AR2-004），sessionStorage 为前端兜底（cookie 被清时提示重登）。`code_verifier`「禁前端 JS 可读」仅指 **cookie 通道 httpOnly**；前端生成瞬间持有并以 POST body 提交是 RFC 7636 客户端生成语义，不落 URL/历史（FR-026 脱敏覆盖）。

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
  9. 读 sso_return_to cookie（权威，AR2-004，随一次性状态清除）→ 开放重定向校验（FR-023）→ 302；
     空/非法 → 默认落地页（OQ-009：**已裁决为 `/solve`**，2026-08-11）
```

#### 4.1.3 受保护资源访问（全站登录墙两层校验，auth FR-016/028/029、token FR-003）

**matcher 表达式（v1.3，D-002；review-r1 修订 AR3-001/AR3-004 一次性写对）**：middleware.ts（项目根目录，Next.js 15 约定，AR1-004）`config.matcher`：

```typescript
export const config = {
  matcher: [
    // ① API 全集：限流覆盖（先于认证）；/api/health 在 middleware 内豁免限流；
    //    /api/sso/* 与 /api/health 豁免认证粗检（公开白名单，FR-028）
    '/api/:path*',
    // ② 页面路由：负向断言排除框架静态资源、metadata 根资源与登录入口页——不进 middleware
    //    （Next.js 惯例，认证不得拦截，FR-028/AC-035）：
    //    _next/static、_next/image（构建产物/图片优化）、favicon.ico、icon.svg / apple-icon /
    //    opengraph-image / twitter-image（metadata 约定根资源）、robots.txt / sitemap.xml（SEO 抓取）、
    //    顶层 login（登录入口页自身，防 302 死循环：登录页被拦则无法发起登录）；
    //    首页 / 进 matcher，middleware 内按公开白名单豁免认证（限流生效，防高频抓取，D-004）
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|login).*)',
  ],
};
```

> 说明：页面 matcher 条目覆盖 `/` 与 `/solve`、`/result` 等全部业务页面；`[locale]` 落地后 `<locale>` 前缀页面同样命中。**locale 前缀登录页 `/{locale}/login` 命中本条（负向断言仅排除顶层 `login`）→ 由 middleware 白名单常量按 locale 支持列表豁免认证（不 302），与顶层 `/login`（matcher 排除、不经 middleware）实现路径不同但公开语义一致（AR3-001）**；`[locale]` 前缀首页 `/<locale>` 延续 `/` 公开语义（middleware 内按 locale 支持列表判定，FR-028 延续）。

**公开白名单常量（middleware 内集中定义，单一来源，D-004/FR-028；review-r1 修订 AR3-001/AR3-010）**：

```typescript
// 认证豁免（白名单常量，实现语义）：'/api/sso' 前缀（OIDC 回调链）、'/api/health'（运维探活）、'/' 首页；
// FR-028 业务白名单成员 '/login' 不经白名单常量——由 matcher 负向断言排除（不进 middleware），实现路径不同（AR3-010）；
// [locale] 落地后：locale 前缀首页（/<locale>）延续 '/' 公开语义、locale 前缀登录页（/{locale}/login）
// 延续 '/login' 公开语义，均按 locale 支持列表判定（FR-028，AR3-001）
// 限流豁免：仅 '/api/health'（现状不变，便于部署探活）
```

> **白名单概念澄清（AR3-010）**：FR-028 白名单为**业务语义**（公开路径集合，含 `/login`：`/`、`/login`、`/api/sso/*`、`/api/health`）；middleware 白名单常量为**实现语义**（仅认证豁免路径：`/api/sso` 前缀、`/api/health`、`/` 及 `[locale]` 前缀首页、`/{locale}/login`），`/login` 由 matcher 负向断言实现公开、不在常量中。同名不同义，实现时以本段为准。

**middleware 执行流程（Edge，M6）**：

```
浏览器 → 页面（如 /solve、/result）或 API（如 /api/solve POST）→ middleware.ts(Edge)
  1. 限流检查（页面 + API 全集先消耗配额，超限 429 GESP6_RATE_LIMITED；/api/health 豁免）
  2. 认证粗检（限流全集内的受保护子集，公开白名单豁免）：
     a. 白名单常量命中（/api/sso/*、/api/health、首页 / 及 [locale] 前缀首页、locale 前缀登录页
        /{locale}/login，AR3-001）→ 放行（不读 cookie）；顶层 /login 不进 matcher、不经本流程（负向断言）
     b. 受保护 API 路径：sso_access_token 缺失/解码失败/exp 过期 → **401 JSON { code: 'AUTH_SESSION_INVALID' }**
        （FR-016：非浏览器客户端不收到 HTML 登录页；returnTo 对 API 无回跳意义）
     c. 受保护页面路径：同上粗检失败 → **302 → /login?returnTo=<原路径>**（FR-029；returnTo 编码传递，
        登录页/登录按钮经 isSafeReturnTo 校验后透传 authorize（§4.1.1 步骤 2），登录成功回跳，FR-023）
     d. 粗检通过 → 放行 Node 层
     注：Edge 仅解码不验签、不引用 SSO_CLIENT_SECRET（FR-024）；token-cookie 模块为 Edge/Node 同构纯模块
     （仅 cookie 名常量，禁 Node API 与 env 引用，middleware 与 Node 侧共用，AR3-007）；/api/sso/* 豁免认证
     防自身 302 死循环（FR-028）
```

**Node 层（M5）**：

```
受保护 API（/api/solve/route.ts）→ requireAuth（现有，主文档 §5.2）
  1. access_token 本地 JWT 验签：RS256（jose ^6.2.8）+ kid 匹配 JWKS（取 M2 缓存，AR1-006）+
     iss=SSO_ISSUER + aud 含 SSO_CLIENT_ID + exp 未过期（fail-closed）
  2. 剩余寿命 < 60s → 同步触发 M3 续期（单飞在途），成功随当前响应 Set-Cookie 替换 cookie（§4.1.4）
  3. 失败 → 401 AUTH_SESSION_INVALID（清会话 cookie 引导重登）
受保护页面 Node 层深校验（v1.3，D-003/FR-029 判定准则）：
  1. 触发判定：页面涉及服务端数据获取 / 服务端写操作 / layout 级用户态渲染时才需 Node 层校验
     （如 RSC 读用户信息、RSC 数据获取、layout 级校验）；当前 /solve（'use client' 输入表单页）与
     /result（'use client'，读 sessionStorage）均无上述场景 → 仅 middleware 粗检覆盖，不接入 Node 校验
  2. 触发页面：RSC server component 内 await requireAuthPage()（主文档 §5.2，与 requireAuth 同一验签核心、
     JWKS 唯一路径 AR1-006）；整组保护可升级为路由分组 layout 校验（主文档 §8.3 订单预留）
  3. 校验失败（粗检通过但验签/iss/aud/exp 不过，如 token 已被 IDP 撤销但 exp 未过期）→ fail-closed：
     清全部会话 cookie + 302 → /login?returnTo=<原路径>（FR-029/AC-039，不渲染错误页）
     实现载体（AR3-006）：RSC server component 内无法返回 NextResponse.redirect——须先
     (await cookies()).delete() 逐一清除 sso_access_token / sso_refresh_token / sso_id_token
     （cookies() 为只读、Next 15 async API，删除须经 await 后的 cookies() 实例），再调用
     next/navigation 的 redirect()（抛 NEXT_REDIRECT 由框架处理）；路由分组 layout 级校验（主文档 §8.3）
     同为 RSC 载体，同一约束适用
```

**middleware 顺序说明（AR1-001/AR2-009）**：middleware.ts 现状「认证检查 → 限流」，未认证请求直接拦截、不消耗配额。SSO 上线后未认证请求成为常态流量，若保持该顺序则攻击者可无限发起未认证请求绕过限流。故将**「限流 → 认证」顺序调整纳入实施范围**（仅调整 middleware 内两个代码块次序），未认证请求同样消耗配额。v1.3 增补：**API 未登录响应由 302 改为 401 JSON（FR-016 差异化要求）**，与「限流先于认证」共同消除绕过面；页面未登录 302 维持（浏览器路径）。与 auth spec §5 第 8 条边界关系见主文档 §1.4（AR2-009）。

**302 重定向 locale 规则（AR1-009，v1.3 更新；review-r1 修订 AR3-001）**：二段式——① `[locale]` 路由落地前：维持现状顶层 `/login`（v1.3 已确认落地为登录入口页，FR-030/D-005）；② `[locale]` 落地后：从请求路径提取首段 locale（如 `/zh/...`），命中支持列表则 302 → `/{locale}/login`（该目标命中 matcher 第二条，由白名单常量按 locale 支持列表豁免认证——**保证 locale 前缀登录页可达，不因认证粗检再 302 形成死循环，AR3-001**），无前缀/未知 → 默认 locale（取值随 `[locale]` 实施时 i18n 配置）；**locale 前缀首页（`/<locale>`）延续 `/` 公开语义（FR-028）**，middleware 白名单按 locale 支持列表判定。与 OQ-003 联动（已裁决保留 /login），落地时对齐验证（主文档 §11 步骤 8、R-12）。

#### 4.1.4 刷新续期（token FR-004~010 + OQ-05 扩展）

```
cookie 更新通道（AR2-002）：httpOnly 仅能经响应 Set-Cookie 写入、后台异步无法写——替换一律随响应头
完成：①同步（守卫内刷新）②主动（前端调 /api/sso/refresh 服务端回写）→ M3；触发：剩余 <60s 或 401
  1. 单飞检查：服务端 inflight Map（key=会话标识）在途 → 挂起等待同结果
  2. 跨标签页协同（M4，lib/sso/refresh-sync.ts，AR2-003 载体修正）：
     a. 先尝试获取 localStorage 锁（持有者标识 + 时间戳 + 会话标识）
     b. 成功 → 本标签页执行刷新（POST IDP token_endpoint, refresh_token grant），成功后随响应 Set-Cookie
     c. 失败（他标签页在刷）→ 监听「刷新完成」信号（仅信号不传 token，AR2-003）→ 主动调 /api/sso/refresh 获取 Set-Cookie 回写；无后续请求仅清 sessionStorage + 提示
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
| IDP error=access_denied | callback | 友好提示 + 清一次性状态（/login 错误展示，D-005/FR-030） | —（页面提示） |
| IDP 其他 error | callback | 400 | `AUTH_LOGIN_IDP_ERROR` |
| state 不一致 | callback | 400，拒绝交换 | `AUTH_LOGIN_STATE_MISMATCH` |
| iss 不一致 | callback | 拒绝（RFC 9207） | `AUTH_LOGIN_ISS_MISMATCH` |
| authorize 提交参数非法 | authorize | 400，不写 cookie | `AUTH_LOGIN_MISSING_PARAMS` |
| token 交换失败（invalid_grant 等） | callback | 引导重登 + 清一次性状态；提示仅错误码+通用文案 | `AUTH_TOKEN_EXCHANGE_FAILED` |
| token 交换网络失败 | callback | 502 语义错误 | `AUTH_LOGIN_IDP_UNREACHABLE` |
| id_token 验证失败 | callback | strict 拒登 / soft 记日志 | `AUTH_ID_TOKEN_INVALID` |
| Discovery 获取失败 | callback/refresh | 500 | `AUTH_IDP_DISCOVERY_FAILED` |
| access_token 过期/非法（受保护 API） | middleware/Node 守卫 | **middleware 粗检：401 JSON；Node 深校验：401 + 清 cookie + 引导重登（v1.3 由 302 改 401，FR-016）** | `AUTH_TOKEN_EXPIRED` / `AUTH_SESSION_INVALID` |
| 未登录访问受保护页面（v1.3） | middleware | 302 → /login?returnTo（FR-029） | —（302 引导） |
| 页面 Node 层深校验失败（v1.3，FR-029） | 页面 RSC（requireAuthPage） | fail-closed：清全部会话 cookie + 302 → /login?returnTo，不渲染错误页（载体见 §4.1.3，AR3-006） | `AUTH_SESSION_INVALID`（AC-039） |
| 刷新 invalid_grant | refresh | 清全部 cookie + 重登 + 安全告警 | `AUTH_TOKEN_INVALID_GRANT` |
| 刷新失败（网络/5xx 耗尽） | refresh | 保持旧 access 至过期，返回错误 | `AUTH_TOKEN_REFRESH_FAILED` |
| IDP 限流耗尽 | 任意 IDP 调用 | 429 语义 | `AUTH_IDP_RATE_LIMITED` |
| revoke 失败 | logout | 不阻断，cookie 必清 | `AUTH_TOKEN_REVOKE_FAILED`（仅日志） |
| 登出重定向不合法 | logout | 拒绝跳转 | `AUTH_LOGOUT_REDIRECT_INVALID` |
