# 后台管理员框架 架构评审意见 — 第 3 轮（实施前终评）

**评审对象**：arch-admin-framework-v1.0.md（内容版本 v1.2）
**评审时间**：2026-08-21
**评审结论**：需修订（轻量，纯文档增量）——修订后即通过，v1.3 为实施基线，无需第四轮全面评审

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R3-001 | §2.1 ADM-M13、§6 目录树、矩阵 AC-033/034 | **E2E 用例未被 playwright 项目配置收录，AC-033/034/035 将无法执行**。实测 playwright.config.ts：`chromium` 项目 testMatch 仅 `login-wall\|sso-login`，`chromium-auth` 项目 testMatch 为固定清单，均不含 `admin-framework.spec.ts`——该文件不匹配任何 project，用例会**静默不运行**（比失败更隐蔽）。且架构未定义用例-项目映射：E 路径用例需无认证上下文（chromium 项目，无 storageState），矩阵 AC-034 写明 D 正向用例「复用 auth.setup.ts 真实 IDP 登录态」（隐含 chromium-auth + storageState）。两路径同文件时，若文件挂 chromium-auth，E 路径「未登录访问 /admin」断言会被 storageState 的 SSO cookie 污染（登录页粗检会跳 `/admin`）；若只挂 chromium，D 用例又拿不到预置登录态 | ① `playwright.config.ts` testMatch 变更列入实施任务；② 写死映射：`admin-framework.spec.ts` 挂 **chromium** 项目（无认证上下文，E 路径主测），D 正向 `@llm` 用例经 `helpers/sso-login.ts` 自登录（对齐 sso-login.spec.ts 在 chromium 项目自登录的既有先例）；同步修正矩阵 AC-034 的「复用 auth.setup.ts」表述 |
| R3-002 | §4.2 关键语义 | 「verifyAccessToken 既有审计副作用」表述过宽：实测 guard.ts 中仅**非过期**失败分支触发 `auth.session_invalid` 审计（六处），`JWTExpired` 分支（AUTH_TOKEN_EXPIRED）**不产生审计事件**。而 §4.2② 明确「验签失败（含过期）」走清 cookie 续试——若开发/单测按「D 验签失败必有既有审计」写断言会误判 | 补精确化：「过期分支无既有审计事件，仅其余失败分支触发」 |
| R3-003 | §9 风险 4 | `loginAdminLocal`/`logoutAdmin` 将是**全仓首个 Server Action**（app/ 下现无任何 `'use server'` 文件）。风险 3「照搬既有 requireAuthPage 模式」仅覆盖 RSC 侧；Server Action 侧 `cookies().set + redirect()` 无仓内先例。经 Next.js 15 官方文档核验该模式为受支持的一等行为，风险 4 的「E2E 断言 Set-Cookie 头」对策方向正确 | 将「E2E 断言重定向响应 Set-Cookie 头」由候选验证升格为 spec **AC-019 硬性验收项**，注明「全仓首个 Server Action，无仓内先例，禁止跳过该断言」 |
| R3-004 | §2.1 模块清单 / §9 风险表 | **部署与运维文档缺口无人认领**：① 4 个 `ADMIN_*` 变量的生产部署登记；② `ADMIN_SESSION_SECRET` 密钥轮换流程（轮换会使在途 `admin_session` 立即验签失败 → 清 cookie 重登，行为可接受但应写明）；③ 日志排查指南增补 `admin.*` 三个审计事件条目。三项均不在 ADM-M01~M13 与 spec 附录 C 任务 1~13 内 | ADM-M12 扩展交付范围 + spec 附录 C 任务 12 同步（运维条目落点 `docs/operations/`，项目已有目录先例） |
| R3-005 | 文件命名（说明性，非缺陷） | 文件名 v1.0 与内容 v1.2 不一致：经核对为 AR2-001 裁决 + 矩阵 §3 明文固化的既定约定（文件名恒定、版本仅改文件头），当前 4 处引用一致、无悬空引用。但与 arch-sso-v1.3.md / spec 族「文件名含版本」惯例形成两套并存风格 | 接受现状（改名成本 > 收益）；后续新建架构文档时统一约定，避免第三种形态 |

## 评审总结

架构主体（Edge/Node 两层边界、并集守卫、恒时判定链、审计扩展、零新增依赖、全部既有代码复用点描述）经对照源码 18 项逐项核实**全部成立、无一处凭印象错报**；jose v6 HS256 候选用法经官方文档独立验证正确；历轮 AR1 13 项 + AR2 4 项问题 100% 闭环。唯一实质缺口 R3-001 使测试验收链路（AC-033/034/035）在当前 playwright 配置下不可执行——属「文档说有测试、配置跑不了测试」类问题，恰为终评应拦截项。修订均为 3-5 行级文档增量，不动摇任何架构决策；**执行 R3-001（必改）与 R3-002/003/004（宜一并落实）后可直接进入实施**。
