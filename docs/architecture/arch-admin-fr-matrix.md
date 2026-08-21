# 后台管理员框架 FR 覆盖矩阵（arch-admin-framework-v1.0.md 附属文件）

**归属**：`docs/architecture/arch-admin-framework-v1.0.md` §10（AR1-003 拆分落地）
**状态**：approved（随主文档同步演进；本文件不单独维护版本号、不回标主文档版本号，v1.2/AR2-002）
**目的**：admin spec FR-001~033 逐条架构落点 + AC 与既有基线核对；主文档 §10 保留引用指向，本文件为完整矩阵。
**修订标注**：v1.1 因 r1 评审修订（AR1-xxx）改变的落点以「（v1.1）」标注，其余继承 v1.0 初稿。

## 1. FR 覆盖矩阵（spec-admin-framework-v1.5，FR-001~033）

| FR | 落点章节（主文档 arch-admin-framework-v1.0.md） |
|----|----------|
| FR-001（4 个 admin env，禁 NEXT_PUBLIC_） | §1.3 AAD-08、§2 ADM-M02/ADM-M12、§5.4、§6 |
| FR-002（getAdminConfig 惰性校验，独立 config.ts） | §1.3 AAD-08、§2 ADM-M02、§5.2、§6 |
| FR-003（校验规则：secret≥32/用户名密码非空/subs trim） | §2 ADM-M02、§5.4 |
| FR-004（Edge-safe constants.ts，零依赖） | §1.3 AAD-09、§1.4、§2 ADM-M01、§6 |
| FR-005（isAdminSub 纯函数） | §2 ADM-M03、§5.2 |
| FR-006（sign/verifyAdminSession HS256 15min） | §1.3 AAD-03、§2 ADM-M04、§5.2、§8.2 |
| FR-007（admin_session cookie 属性 + cookieSecure export） | §2 ADM-M04/M05、§5.1、§5.2、§8.2 |
| FR-008（verifyAdminSession → ADMIN_SESSION_INVALID；session.ts 不导出 Edge 函数） | §1.3 AAD-04、§1.4、§2 ADM-M04、§4.1、§5.2、§9-风险 1 |
| FR-009（verifyAccessToken 仅 export 一行） | §1.3 AAD-10、§2 ADM-M05、§5.2；（v1.1：验签失败时既有 `auth.session_invalid` 审计副作用为预期行为，AR1-009 → §4.2 关键语义） |
| FR-010（requireAdminPage 并集守卫 + AdminClaims 归一化） | §2 ADM-M06、§4.2、§5.1、§5.2 |
| FR-011（授权失败先试 E，不清 SSO cookie，forbidden） | §1.3 AAD-05、§4.2、§4.4-X4、§9-风险 10 |
| FR-012（D 验签失败清 SSO 三 cookie，续试 E） | §4.2、§4.4-X3 |
| FR-013（E 验签失败清 admin_session） | §4.2、§4.4-X3 |
| FR-014（双失败 redirect /admin/login 无 returnTo） | §1.3 AAD-06、§4.2、§4.4-X6 |
| FR-015（/admin/login 入 isPublicPath） | §2 ADM-M07、§4.1 |
| FR-016（/admin/* 302 /admin/login?returnTo=） | §2 ADM-M07、§4.1；（v1.1：「302」为语义表述，实际载体 `NextResponse.redirect` 默认 **307**，E2E 断言最终 URL，AR1-011 → §4.1 状态码载体注记） |
| FR-017（双 cookie 粗检，本地 decodeJwtExp，不 import admin 服务模块） | §1.3 AAD-04、§1.4、§4.1、§7（静态检查）；（v1.1：§1.4 措辞修正——admin 模块仅允许 constants 引用，SSO 侧沿用既有 token-cookie 常量，AR1-010） |
| FR-018（顶层路径无 locale） | §1.2、§6、§8.3 |
| FR-019（/admin/login 公开页：E 表单 + D SSO 入口 returnTo 透传） | §2 ADM-M08、§6 |
| FR-020（admin-login-client.tsx co-locate，页面 ≤300 行） | §2 ADM-M08、§6、§8.3；（v1.1：co-locate 为 FR-020 已裁决合理偏离，未来跨页复用组件归 `components/admin/`，AR1-012 → §6 要点） |
| FR-021（error 参数展示：ADMIN_AUTH_FORBIDDEN 通用文案） | §4.4-X5、§6（page.tsx） |
| FR-022（已登录粗检 redirect /admin；error 参数跳过） | §1.2 A4、§4.3-N4、§4.4-X5 |
| FR-023（loginAdminLocal：Zod + 恒时比较 + returnTo 校验回退） | §2 ADM-M09、§5.3、§9-风险 5/6；（v1.1：username 判定并入 `verifyLocalCredentials` 双恒时比较，返回类型改 `AdminLoginState`，AR1-001/002 → §5.2/§5.3） |
| FR-024（凭据错误 → INVALID_CREDENTIALS + audit failure） | §2 ADM-M09、§4.4-X1、§5.5、§5.6；（v1.1：username 不匹配同属凭据错误，AR1-001；failure subject 约定明确，AR1-008 → §5.6） |
| FR-025（登录成功 audit success，subject 记录标识） | §1.3 AAD-15、§5.3、§5.6；（v1.1：subject = `ADMIN_LOCAL_USERNAME` 明确写死，AR1-008 → §5.6） |
| FR-026（logoutAdmin 删 cookie 不清 SSO + audit） | §2 ADM-M09、§5.3、§4.3-N1⑤ |
| FR-027（爆破依托既有 per-IP 限流，无账号锁定） | §1.3 AAD-14、§4.1、§4.4-X8、§8.2 |
| FR-028（(panel) layout：requireAdminPage + 侧边栏 + 头部 name??sub） | §2 ADM-M10、§6、§7 |
| FR-029（Dashboard 纯占位不查库） | §1.2、§2 ADM-M10、§6 |
| FR-030（users/resources 空框架占位） | §2 ADM-M10、§6、§8.3 |
| FR-031（不加 Header 入口） | §1.5 |
| FR-032（ERROR_CODE_PATTERN → /^(AUTH|ADMIN)_[A-Z_]+$/） | §1.3 AAD-12、§2 ADM-M11、§5.6 |
| FR-033（AuditEvent 新增 3 事件字面量） | §1.3 AAD-12、§2 ADM-M11、§5.6 |

## 2. AC 与既有基线核对（关键项抽查，v1.0 原附录迁入）

> 口径说明（v1.2/AR2-004；计数 v1.3 更新）：本节仅列关键 AC 抽查（当前 11/35 条），非全量核对；全量 AC-001~035 验收以 `docs/specs/spec-admin-framework-v1.5.md` §6 为唯一来源。

- **AC-001**：verifyAccessToken 导出不改行为 → §1.3 AAD-10（既有 SSO 单测/集成测试保持全绿为验收前提）
- **AC-009/AC-013/AC-017**：middleware 层 returnTo 携带、cookie 属性、Edge 禁 import admin 服务模块 → §4.1、§5.1、§7 静态检查项
- **AC-015/AC-019**：（v1.1 新增，AR1-011）「302」语义的实现载体注记——middleware 307 / Server Action 303 / E2E 断言最终 URL → §4.1 状态码载体注记；（v1.3 补充，R3-003）AC-019 增**硬性断言**：登录成功重定向响应携带 `admin_session` Set-Cookie 头（全仓首个 Server Action，无仓内先例，禁止跳过）→ §9-风险 4
- **AC-018**：顶层路径无 locale → §6
- **AC-032**：（v1.1 补充，AR1-006）actions 单测落点 `app/admin/__tests__/actions.test.ts` → §2 ADM-M13、§6
- **AC-033**：（v1.3 新增登记，R3-001）`admin-framework.spec.ts` 挂 **chromium 项目**（无 storageState，E 路径用例从无会话态开始）；`playwright.config.ts` chromium 项目 testMatch 增补 `admin-framework\.spec\.ts` **列入实施任务** → §2 ADM-M13、§6
- **AC-034**：（v1.1 明确，AR1-013；**v1.3 修正，R3-001**）D 正向用例载体：`admin-framework.spec.ts` 内标注 `@llm` 标签，经 `helpers/sso-login.ts` 自登录获真实 IDP 会话（**不依赖 auth.setup storageState**，对齐 sso-login.spec.ts 在 chromium 项目自登录的先例）+ 测试账号 sub 预入 `ADMIN_SSO_SUBS`；本地 IDP 不可达时跳过不阻塞 → §2 ADM-M13、§9-风险 8
- **AC-035**：E2E 环境 4 变量注入 → §5.4、§9-风险 9

## 3. 维护说明

- 本文件与主文档 `arch-admin-framework-v1.0.md` 同步演进；FR 落点变更**仅更新本文件对应行**，主文档 §10 不枚举具体 FR 号、仅保留指向本文件的引用（单向引用，v1.2/AR2-002）；
- **主文档文件名恒为 `arch-admin-framework-v1.0.md`**（单文件原则）：版本演进仅变更文件头版本号与变更记录，**禁止按版本重命名或新建文件**，引用主文档一律使用该文件名（v1.2/AR2-001）；
- 主文档行数约束（≤ 500 行，code-style §四）为拆分动因（AR1-003），拆分先例为 `arch-sso-fr-matrix.md`；
- 后续评审修订（r2+）改变的落点以「（v1.2）」等版本标注递增，其余继承上一版。
