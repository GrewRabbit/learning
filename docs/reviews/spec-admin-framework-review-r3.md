# 后台管理员框架 评审意见 — 第 3 轮（实施前终评）

**评审对象**：spec-admin-framework-v1.4.md
**评审时间**：2026-08-21
**评审结论**：需修订（勘误级微修订）——修订后即通过，v1.5 为 approved 实施基线

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| F-001 | FR-001、NFR-005 | 「token spec FR-024」引用不属实：token spec（v1.2）FR-024 实为「SSO 用户侧接口限流」；`NEXT_PUBLIC_` 禁止的真实出处是 **auth spec FR-024**（client_secret 保护）或 **token spec FR-021**。且本 spec 自身 FR-024 为「凭据错误」语义，三重 FR-024 并存加剧追溯混淆。该错误已传播至架构文档 §5.4 | 勘误为「auth spec FR-024，同 token spec FR-021」（spec 2 处 + 架构文档同步） |
| F-002 | 文档状态与评审闭环 | r2 结论为「需修订」且预告 v1.4 进入第 3 轮评审，但 `docs/reviews/` 无 review-r3——approved 状态翻转缺乏通过轮次评审记录支撑 | 本终评归档为 review-r3；F-001 勘误落地（v1.5）后即闭环 |
| F-003 | AC-016 | 缺「无有效 SSO 粗检会话」前置条件：FR-017 粗检为 SSO∨admin_session **或**语义，D 路径管理员 admin_session 过期但 SSO 有效时 middleware 应放行；AC-016 字面断言「exp 过期 → 302」会产出与 FR-017 矛盾的测试用例（对照 AC-007 已严谨补充前置条件的做法） | 302 断言补「且无有效 SSO 粗检会话时」前置条件 |
| F-004 | FR-026 × FR-022 交互边界 | D 路径管理员点「登出」：logoutAdmin 仅删 admin_session（D 管理员本无此 cookie）→ 302 `/admin/login` → FR-022 粗检见有效 `sso_access_token` → 302 `/admin`，登出后立即弹回后台。行为确定、无死循环，但 spec 未声明该边界；AC-023（Action 层）与 AC-033（E-only 管理员）均覆盖不到此路径 | 在 §5 边界显式声明（D 管理员真正退出需走全站 SSO 登出），并为 AC-023 标注 E 路径会话形态口径 |
| F-005 | FR-015 / FR-016 与上游关系 | middleware 白名单（+`/admin/login`）与 `/admin/*` 302 目标（→`/admin/login`）的修改，实质是对 auth spec FR-028（公开白名单）/ FR-029（302 目标）的 admin 域内扩展，但未声明该扩展关系——两份 SSO spec 间维持了严格交叉引用纪律（OQ-010/B-001），本 spec 应同等对待 | §3.5 补一句扩展关系声明 |
| F-006 | FR-003 | 「ADMIN_LOCAL_USERNAME/PASSWORD 非空（E 路径启用前提）」暗示条件性要求，但 spec 无 E 路径启用开关，AC-003 为无条件抛错——即 D-only 部署也必须配置本地凭据。措辞与 AC 口径不一致 | 明确「无条件必填」（显式声明不支持 D-only 部署形态），对齐 AC-003 |
| R3-003（联动） | AC-019 | `loginAdminLocal` 将是全仓首个 Server Action（`cookies().set` + `redirect()` 组合无仓内先例，arch r3 R3-003），架构风险 4 的「E2E 断言 Set-Cookie 头」目前仅为候选验证 | 升格为 AC-019 硬性验收项：登录成功重定向响应必须携带 `admin_session` Set-Cookie 头 |
| R3-004（联动） | 附录 C 任务 12 | `ADMIN_*` 生产 env 清单、`ADMIN_SESSION_SECRET` 轮换流程、日志排查指南 `admin.*` 三事件增补三项运维条目不在任务 1~13 内，交付归属缺失（arch r3 R3-004） | 任务 12 要点补运维条目交付（落点 `docs/operations/`） |

## 评审总结

v1.4 是三轮演进后成熟度很高的 spec：r1 全部 14 项 + r2 全部 10 项问题可验证地闭环，并集守卫、路由分组、Edge/Node 边界、错误码与审计扩展等关键设计内部自洽且与代码现状吻合（终评抽查 guard.ts / token-cookie.ts / middleware.ts / audit-logger.ts 四处承重前提全部成立）。本轮未发现任何会导向错误实现的结构性或安全性问题；遗留 2 项重要均为文档级缺陷（引用勘误 + 评审闭环归档），其余为边界声明与验收口径精确化。**完成 F-001 勘误与 F-002 归档后，本 spec 即达到可直接实施标准**；F-003~F-006 与两项联动随 v1.5 一并处理，不构成实施阻塞。
