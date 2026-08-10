# SSO 集成模块架构评审意见（第 2 轮）

- **评审对象**：`docs/architecture/arch-sso-v1.1.md`（draft，第 1 轮修订后版本）
- **关联文档**：`docs/specs/spec-sso-auth-v1.2.md`（approved）、`docs/specs/spec-sso-token-v1.2.md`（approved）、`docs/architecture/arch-sso-fr-matrix.md`、`docs/integration-guides/sso-idp-sp-integration-guide.md`（按需章节）
- **评审人**：nextjs-architecture-reviewer
- **轮次**：第 2 轮
- **日期**：2026-08-10
- **评审结论**：**需修订**（重要级 4 项 + 建议级 8 项，共 12 项）

---

## 一、第 1 轮解决情况核验（AR1-001 ~ AR1-011）

| 编号 | 问题摘要 | 判定 | 依据（v1.1 落点） |
|------|---------|------|-----------------|
| AR1-001 | middleware 限流/认证顺序矛盾 | 已解决 | §1.4 边界澄清（分布式化才是边界，顺序调整纳入实施范围）+ §4.1.3 顺序说明（限流先于认证）+ §11 步骤 8 |
| AR1-002 | end_session 302 无法带 POST body | 已解决 | AD-09、§4.1.5 步骤 4（HTML form 自动提交页，onload 自动 submit，防 token 进历史）、§5.3、§11 步骤 9 |
| AR1-003 | 状态双写数据来源/提交路径未定义 | 已解决 | AD-08、§4.1.1 步骤 2~4 双写闭环（前端生成 → form POST 提交 → 服务端写 httpOnly cookie，cookie 权威） |
| AR1-004 | middleware.ts 路径错误 | 已解决 | §6 根目录 middleware.ts + §11 步骤 8 |
| AR1-005 | jose 版本未锁定 | 已解决 | §3、§7.1 锁定 ^6.2.8（2026-08 最新稳定 v6） |
| AR1-006 | M5→M2 JWKS 路径二义 | 已解决 | §2.2 唯一路径、AD-07、§5.2 requireAuth 注释 |
| AR1-007 | 服务单例 vs 自由函数 | 已解决 | §5.1 服务层约定 + §5.2 全部 export const 单例 |
| AR1-008 | refresh-sync.ts 落位违规 | 已解决 | §6 移至 lib/sso/refresh-sync.ts |
| AR1-009 | /login 与 [locale]/login 未对齐 | 已解决 | §4.1.3 二段式 locale 规则（①[locale] 落地前维持现状顶层 /login；②落地后 302→/{locale}/login）+ R-12 |
| AR1-010 | mock 模式 env 必填性未展开 | 已解决 | §7.2 mock 分支（client_secret 可缺省并警告、issuer 必填） |
| AR1-011 | access_token 复用 JWKS 假设未声明 | 已解决 | AD-02 注、R-11 显式声明假设 + 首日实测确认、§11 步骤 8 |

**第 1 轮解决率：11/11（100%）**

---


## 二、第 2 轮问题清单

### 2.1 重要级（4 项）

| 编号 | 维度 | 问题描述 | 依据（文件+位置） | 修复建议 |
|------|------|---------|-----------------|---------|
| AR2-001 | 两层运行结构 / 数据流 | **middleware 认证粗检作用域未豁免 /api/sso/*，登录流程可能被自身 302 拦截形成死循环**。§4.1.3 步骤 2 描述「读 sso_access_token cookie：不存在/解码失败/exp 过期 → 302 重定向登录」，但 middleware matcher 为 `/api/:path*`（AD-01），覆盖 /api/sso/authorize、callback、logout、refresh 自身。未登录用户发起登录（无 cookie）访问 /api/sso/authorize 会被同一 middleware 302 到 /login，登录发起/回调/登出全部被自身拦截。现状 middleware.ts L82-87 认证钩子仅对 PROTECTED_API_PREFIX（/api/solve）生效，架构未显式声明粗检仅对受保护资源生效、/api/sso/* 仅限流不粗检 | arch-sso-v1.1.md §4.1.3 步骤 1-2、AD-01、§8.2 安全 #8；middleware.ts L82-87、L117-119 | 明确认证粗检仅对受保护资源（/api/solve）生效，/api/sso/* 端点仅做限流、豁免认证粗检；在 §4.1.3 与 §11 步骤 8 中补充该豁免规则 |
| AR2-002 | 数据流 / 可实施性 | **异步刷新后 cookie 替换载体未定义**。§4.1.3 步骤 5「触发 M3 续期（后台异步刷新替换 cookie，不阻塞当前请求）」，§4.1.4 步骤 3「成功：立即替换 sso_refresh_token + 覆盖 sso_access_token」。但 httpOnly cookie 只能经响应 Set-Cookie 写入：后台异步任务在响应已发出后无法再 Set-Cookie，需明确刷新完成后的 cookie 更新通道（随当前响应同步 Set-Cookie / 前端主动调用 /api/sso/refresh 拉取），否则 M3 续期在实现上无法落地 | arch-sso-v1.1.md §4.1.3 步骤 5、§4.1.4 步骤 3、§5.3 /api/sso/refresh | 明确二选一：①续期同步完成并随当前响应 Set-Cookie（阻塞当前请求或提前刷新）；②刷新端点由前端主动触发，服务端 Set-Cookie 回写 |
| AR2-003 | 安全 / 数据流 | **跨标签页「收到广播后更新 cookie」与 httpOnly 冲突**。§4.1.4 步骤 2c「等待 BroadcastChannel 广播（新 access_token），收到后更新 cookie」——浏览器 JS 无法写入 httpOnly cookie（FR-003 明确 code_verifier 等禁前端可读、cookie 由服务端设置），M4（浏览器侧 refresh-sync.ts）收到广播后「更新 cookie」在技术上不可行 | arch-sso-v1.1.md §4.1.4 步骤 2c/2d、§4.1.1 步骤 4（状态 cookie 服务端写）、spec-sso-auth FR-003 R2-003 | 跨标签页同步机制改为：其他标签页收到广播后调用 /api/sso/refresh（服务端刷新 + Set-Cookie 回写），或刷新统一由服务端 inflight Map 兜底（AD-05），广播仅作「刷新已完成」信号而非 token 传递 |
| AR2-004 | Spec 覆盖性 / 数据流 | **returnTo 未写入服务端 cookie，回调恢复断裂（FR-005 落点缺失）**。§4.1.1 步骤 2-3 前端将 returnTo 写入 sessionStorage 并经 form POST 提交，但步骤 4 服务端写状态 cookie 仅三个（sso_pkce_verifier/sso_oauth_state/sso_oauth_nonce），**returnTo 未持久化到服务端 cookie**；§4.1.2 步骤 9 由服务端读 returnTo 恢复跳转——服务端 cookie 中无 returnTo、sessionStorage 服务端不可读，FR-005「returnTo 与登录状态一并持久化」架构落点缺失 | arch-sso-v1.1.md §4.1.1 步骤 4 vs 步骤 2/3、§4.1.2 步骤 9；spec-sso-auth FR-005 | returnTo 一并写入服务端状态 cookie（如 sso_return_to，随一次性状态 maxAge=10min），回调时从 cookie 读取并做开放重定向校验 |


### 2.2 建议级（8 项）

| 编号 | 维度 | 问题描述 | 依据（文件+位置） | 修复建议 |
|------|------|---------|-----------------|---------|
| AR2-005 | 目录结构 | §5.2 接口签名注释路径（lib/sso/config.ts、lib/auth/guard.ts）与 §6 目录结构（app/lib/sso/、app/lib/auth/）前缀不一致，易误导开发 agent 建错目录；code-style 要求跨模块 @/ 绝对路径（@/app/lib/...） | arch-sso-v1.1.md §5.2 vs §6；.opencode/rules/global/code-style.md 导入规范 | 统一注释与目录为 @/app/lib/ 前缀 |
| AR2-006 | 技术选型 | jose ^6.2.8 声称「2026-08 最新稳定 v6 系列」但 package.json 无 jose，无法核对版本存在性；集成指南 §2.4 仅「推荐 jose」未锁定版本；需实施时 npm view jose 验证 v6.2.8 存在 | arch-sso-v1.1.md §3、§7.1；package.json（无 jose）；sso-idp-sp-integration-guide.md §2.4 | 实施步骤 1 前置 `npm view jose versions` 验证，若 v6 不存在则回退架构 §12 备选（WebCrypto 或 jose v5） |
| AR2-007 | 接口定义 / 安全 | /api/sso/logout 声明为 GET/POST（§5.3、§4.1.5），GET 触发登出编排（revoke + 清 cookie）属有副作用操作，可被 CSRF/预取触发登出；两份 spec 均未要求 GET 登出 | arch-sso-v1.1.md §5.3、§4.1.5；spec-sso-token FR-011~15；spec-sso-auth FR-019 | logout 仅接受 POST；GET 返回 405 或仅渲染确认页 |
| AR2-008 | 待确认 OQ 处理 | §12 将 SSO_REFRESH_TOKEN_MAX_AGE_DAYS 列为「技术确认（token OQ-01，取值 30）」与 §1.2 已确认 OQ-004（30 天持久+轮换）状态矛盾——OQ-01 的取值已被 OQ-004 隐含确认，剩命名审批未落「已确认」 | arch-sso-v1.1.md §1.2 vs §12；spec-sso-token OQ-01 | 将 OQ-01 状态标注为「随 OQ-004 落地，仅剩命名审批」或直接列入已确认决策 |
| AR2-009 | 合规性 | spec auth §5 边界第 8 条「不改造现有 middleware 速率限制逻辑——仅替换认证钩子，限流逻辑保持现状」与架构 AR1-001「限流/认证顺序调整（认证先于限流 → 限流先于认证）纳入实施范围」字面冲突：调整顺序即改动限流执行路径，需确认是否构成「改造限流逻辑」 | spec-sso-auth-v1.2.md §5 第 8 条；arch-sso-v1.1.md §1.4、§4.1.3、§11 步骤 8 | 架构侧补充说明：顺序调整属「认证钩子替换」范畴（限流逻辑本体不变，仅调整其在 middleware 中的执行次序），或请 spec 侧澄清边界措辞 |
| AR2-010 | 可实施性 | §8.4 可观测引用 auditLogger，但现状 app/lib/logging/logger.ts 无 auditLogger 导出（grep 无结果）；架构未列出 auditLogger 的新增位置与实现路径，开发 agent 无法直接编码 | arch-sso-v1.1.md §8.4；源码 app/lib/logging/logger.ts；dev-workflow.md §六（auditLogger.log() 仅 API/Server Action 层） | 在 §6 目录结构中补充 app/lib/logging/ 下 auditLogger 落点（新增文件及接口签名） |
| AR2-011 | 模块划分 / 可实施性 | M7 login-button（components/auth/，客户端组件）调用 lib/sso/pkce.ts 生成 PKCE——pkce.ts 位于服务层目录 app/lib/sso/，架构未声明其「同构纯函数、无服务端依赖」属性与 'use client' 兼容性，客户端组件 import 服务层文件边界需明确 | arch-sso-v1.1.md §6、§2.1 M7；.opencode/rules/dev/component-rules.md | 明确 pkce.ts 为同构纯函数（无 Node API 依赖），或拆分前端独立 utils 目录 |
| AR2-012 | Spec 覆盖性 / 可实施性 | token FR-024「SSO 用户侧接口纳入限流」落点仅写 middleware matcher /api/:path* 覆盖 /api/sso/*——现状 middleware matcher 已是 /api/:path*（middleware.ts L117-119），即 API 端点限流无需改动即已覆盖；但 token FR-024 提及「页面级 SSO 路径（登录页/登出页）限流归属由架构阶段决策（OQ-10 关联）」未被架构回应 | arch-sso-v1.1.md §8.2 安全 #8、§9.2 OQ-010；spec-sso-token FR-024；middleware.ts matcher | 补充页面级 SSO 路径限流决策：不覆盖页面路由（现状）或扩展 matcher，需在 OQ-010 下显式记录 |


---

## 三、FR 覆盖核验表（auth FR-001~027 + token FR-001~026）

核验对象：`arch-sso-fr-matrix.md`（§10 FR 矩阵拆分文件）与主文档 §10.1 摘要表、正文落点交叉核对。

### 3.1 auth FR-001~027（spec-sso-auth-v1.2）

| FR | 摘要 | 落点 | 核验 |
|----|------|------|------|
| FR-001 | 登录入口 | §4.1.1、M1/M7 | ✓ |
| FR-002 | PKCE 参数生成 | §4.1.1 步骤 1、lib/sso/pkce.ts | ✓ |
| FR-003 | 状态双写容错（R2-003 cookie 服务端写） | AD-08、§4.1.1 步骤 3-4 | ✓ |
| FR-004 | authorize 必带参数 | §4.1.1 步骤 5、M2 | ✓ |
| FR-005 | returnTo 持久化+开放重定向校验 | §4.1.1 步骤 2/§4.1.2 步骤 9 | ✗ 落点断裂（**AR2-004**） |
| FR-006 | 回调参数校验/error 分类 | §4.1.2 步骤 1、schemas.ts | ✓ |
| FR-007 | state 一次性比对 | §4.1.2 步骤 3 | ✓ |
| FR-008 | iss 校验 RFC 9207 | §4.1.2 步骤 4 | ✓ |
| FR-009 | 令牌交换仅服务端 | §4.1.2 步骤 5、M2 | ✓ |
| FR-010 | 交换失败引导重登 | §4.1.2 步骤 5 | ✓ |
| FR-011 | id_token 8 步验证 | §4.1.2 步骤 6、M2 | ✓ |
| FR-012 | JWKS 缓存/kid 重试 | AD-07、§8.1 | ✓ |
| FR-013 | userinfo sub 一致 | §4.1.2 步骤 7 | ✓ |
| FR-014 | Discovery 服务端执行/禁直连 | §8.2 安全 #10、M2 | ✓ |
| FR-015 | 三 cookie 属性 | §4.1.2 步骤 8、token-cookie.ts | ✓ |
| FR-016 | 登录态分层判定 | §4.1.3、M5/M6、AD-03 | ✓ |
| FR-017 | 会话失效 | §4.2、AUTH_SESSION_INVALID | ✓ |
| FR-018 | 续期触发衔接 | §4.1.4、AD-04 | ✓ |
| FR-019 | SP-Initiated Logout 按序 | §4.1.5、AD-09、logout-service.ts | ✓ |
| FR-020 | revoke 失败不阻断 | §4.1.5 步骤 2 | ✓ |
| FR-021 | end_session 响应处理 | §4.1.5 步骤 5 | ✓ |
| FR-022 | post_logout_redirect_uri 白名单 | §4.1.5 步骤 4、OQ-007 | ✓ |
| FR-023 | 开放重定向防御 | §8.2 安全 #5 | ✓ |
| FR-024 | client_secret 保护 | §8.2 安全 #7 | ✓ |
| FR-025 | IDP 限流两路径 | AD-10、§4.2 | ✓ |
| FR-026 | 日志/提示脱敏 | §8.2 安全 #9、FR-026 | ✓ |
| FR-027 | 环境变量分组 | §7.2、M8 | ✓ |

### 3.2 token FR-001~026（spec-sso-token-v1.2）

| FR | 摘要 | 落点 | 核验 |
|----|------|------|------|
| FR-001 | access_token cookie | §4.1.2 步骤 8、token-cookie.ts | ✓ |
| FR-002 | refresh_token cookie 30 天 | §7.2、OQ-01 | ✓ |
| FR-003 | 会话超时两层判定 | §4.1.3、M5/M6 | ✓ |
| FR-004 | 刷新触发 | §4.1.4、AD-04 | ✓ |
| FR-005 | 单飞 | AD-05、§4.1.4 步骤 1 | ✓（落地缺陷见 AR2-002/003） |
| FR-006 | 刷新成功立即替换 | §4.1.4 步骤 3 | ✗ 替换载体未定义（**AR2-002**） |
| FR-007 | 旧 refresh 立即失效 | §4.1.4 步骤 3 | ✓ |
| FR-008 | 无 id_token 不期望 | §4.1.4 步骤 3 | ✓ |
| FR-009 | invalid_grant 清 cookie+告警 | §4.1.4 步骤 4、AUTH_TOKEN_INVALID_GRANT | ✓ |
| FR-010 | 失败分类 | §4.1.4 步骤 4、AD-10 | ✓ |
| FR-011 | 登出 revoke | §4.1.5 步骤 1 | ✓ |
| FR-012 | revoke 仅服务端转发 | §8.2 安全 #7/#10 | ✓ |
| FR-013 | revoke 失败 cookie 仍清 | §4.1.5 步骤 2-3 | ✓ |
| FR-014 | revoke 200 不作判定 | §4.1.5 步骤 1 | ✓ |
| FR-015 | 清 cookie 后跳 end session | §4.1.5 步骤 3-4 | ✓ |
| FR-016 | 白名单归 auth | §4.1.5 步骤 4 | ✓ |
| FR-017 | 受保护操作前确认 token 有效 | 本地 JWT 验签（OQ-02） | N/A（OQ-02 裁决，理由经 r1 核验认可） |
| FR-018 | introspect 带 hint | 不内省 | N/A（OQ-02） |
| FR-019 | introspect 判定 | 不内省 | N/A（OQ-02） |
| FR-020 | introspect fail-closed | 由本地验签失败承担 | N/A（OQ-02，OQ-03 fail-open 不适用） |
| FR-021 | client_secret 保护 | §8.2 安全 #7 | ✓ |
| FR-022 | 日志脱敏 | §8.2 安全 #9 | ✓ |
| FR-023 | IDP 限流 | AD-10 | ✓ |
| FR-024 | SSO 用户侧接口限流 | §8.2 安全 #8 | △ 页面级路径决策未回应（**AR2-012**） |
| FR-025 | 错误码 7 个 | §5.4 | ✓ |
| FR-026 | 文案不泄露内部细节 | §4.2 envelope | ✓ |

**FR 覆盖结论**：auth 26/27 有落点（FR-005 断裂）、token 24/26 有落点（2 项 N/A 理由成立）+ 1 项部分覆盖（FR-024）。唯一硬缺口为 returnTo（AR2-004）。

---

## 四、技术选型核对表（vs package.json 实际依赖）

| 架构 §3 选型 | package.json 实际版本 | 一致性 |
|-------------|----------------------|--------|
| Next.js 15.1.6（App Router） | `next 15.1.6` | ✓ |
| TypeScript ^5.7.3 | `typescript ^5.7.3` | ✓ |
| Tailwind CSS ^3.4.17 | `tailwindcss ^3.4.17` | ✓ |
| zod ^3.24.1（输入验证） | `zod ^3.24.1` | ✓ |
| lru-cache ^11.5.1（Discovery/JWKS 缓存） | `lru-cache ^11.5.1` | ✓ |
| jose ^6.2.8（**新增依赖**） | **package.json 无 jose** | ⚠ 无法核对版本存在性（AR2-006） |
| lucide-react ^1.21.0 | `lucide-react ^1.21.0` | ✓ |
| cva ^0.7.1 / tailwind-merge ^3.6.0 / clsx ^2.1.1 | 全部一致 | ✓ |
| Vitest ^3.0.0 / @playwright/test ^1.61.1 | 全部一致 | ✓ |
| 运行时环境 Node 22（dev-workflow 约定） | `@types/node ^22.10.7` | ✓ |

**技术选型结论**：除 jose（新增、版本待实施验证）外，全部与 package.json 吻合，无选型错误。

---


## 五、已确认决策（OQ-004 / OQ-002 / OQ-05）落地核验表

| 决策 | 决议内容 | v1.1 落地位置 | 核验 |
|------|---------|--------------|------|
| OQ-004（token spec） | refresh_token 持久化周期：默认 30 天 | §3（30 天）、§4.1.2 步骤 8（refresh cookie maxAge=30 天）、§7.2（SSO_REFRESH_TOKEN_MAX_AGE_DAYS 默认 30） | ✓ 落地完整 |
| OQ-002（token spec） | 内省适用范围：Node 仅本地验签，不内省 | §1.2、§4.1.3（M5 本地 JWT 验签）、§9.1 R-01（可激活内省兜底）、token FR-017~020 N/A | ✓ 落地完整 |
| OQ-05（token spec） | 多标签页并发刷新策略：localStorage 锁 + BroadcastChannel（候选①） | §1.2、§4.1.4 步骤 2（M4）、§9.3 候选对比 | ✓ 决策落地，但**实现载体存在缺陷**（AR2-003：广播后「更新 cookie」与 httpOnly 冲突） |

**决策落地结论**：三项决策均已落地并有对应章节承载；OQ-05 的落地实现存在需修订的技术矛盾（AR2-003）。

---

## 六、总体评价

### 6.1 本轮亮点

1. **第 1 轮问题全部落实**：11/11 解决率，且解决方式均有明确文档落点（AD 表、§4.1.x 步骤、§7.2、§11），非口头承诺；AR1-002/AR1-003 等结构性问题的修订（form 自动提交页、双写闭环）已融入正文而非补丁式附注。
2. **文档结构显著成熟**：AD 表、模块依赖图（§2.2）、异常流表（§4.2）、OQ 处理清单（§9.2）、实施步骤（§11）齐备，具备可实施基础；FR 矩阵拆分（R-13）后主文档 500 行内，行数约束达标。
3. **安全设计完整度高**：8 步验签、开放重定向防御、client_secret 保护、IDP 混淆防护（iss 校验 RFC 9207）、日志脱敏等条款覆盖了 OIDC SP 侧主要攻击面。
4. **数据流闭环意识强**：state/nonce/code_verifier 的生成→提交→校验→一次性消费链路、refresh 轮换的失效时序（FR-006~009）均有明确描述。

### 6.2 需要关注的结构性问题（第 2 轮新增）

1. **两层运行结构的边界自洽性**（AR2-001）：middleware 粗检作用域未豁免 SSO 自身端点，是本轮最严重的潜在运行时故障——登录/回调/登出端点被同一 middleware 拦截会导致登录流程死循环。修复成本低（明确豁免规则）但影响登录可用性，建议优先处理。
2. **token 生命周期实现的 cookie 写入通道**（AR2-002/AR2-003）：「后台异步刷新替换 cookie」与「广播后更新 cookie」在 httpOnly 约束下均不可行，说明 v1.1 在「服务端状态如何到达浏览器」这一核心数据流上仍存在抽象化表述；需在下一轮明确刷新端点/同步刷新的取舍。
3. **FR-005 returnTo 落点缺失**（AR2-004）：唯一 Spec 覆盖性缺口，且属于登录体验关键路径（登录后回跳），应在修订中补入状态 cookie 集合。

### 6.3 结论

**评审结论：需修订**。第 1 轮 11 项全部解决（11/11），第 2 轮新增 12 项问题（重要级 4 项 AR2-001~004、建议级 8 项 AR2-005~012）。其中 AR2-001（middleware 豁免）、AR2-002（cookie 写入通道）、AR2-003（跨标签页同步）、AR2-004（returnTo）四项建议在进入实施前修订完毕；建议级项可随实施步骤分批消化。

修订后建议进行第 3 轮评审（重点复核 AR2-001~004 的修订质量，并核对修订后文档与 FR 矩阵的同步性）。

---

*本评审仅针对文档内容与已核对的源码/依赖现状，未修改任何文件。*
