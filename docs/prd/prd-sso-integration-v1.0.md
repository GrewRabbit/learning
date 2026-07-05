# GESP6 信奥赛解题网页生成器 — SSO 集成 PRD

---

## 1. 文档元信息

| 项目 | 内容 |
|------|------|
| 标题 | GESP6 信奥赛 C++ 解题网页生成器 SSO 集成产品需求文档 |
| 文档版本 | v1.0 |
| 状态 | draft |
| 创建时间 | 2026-07-05 |
| 作者 | 待定 |
| 适用项目 | `/var/learning`（gesp6-web-html） |
| 文档类型 | PRD（产品需求文档） |
| 评审状态 | 待评审 |

---

## 2. 目录

- [1. 文档元信息](#1-文档元信息)
- [2. 目录](#2-目录)
- [3. 引言](#3-引言)
  - [3.1 文档目的](#31-文档目的)
  - [3.2 适用范围](#32-适用范围)
  - [3.3 术语定义](#33-术语定义)
- [4. 需求背景](#4-需求背景)
  - [4.1 当前痛点](#41-当前痛点)
  - [4.2 业务目标](#42-业务目标)
  - [4.3 项目现状摘要](#43-项目现状摘要)
- [5. 文档类型评估](#5-文档类型评估)
  - [5.1 PRD 适用性分析](#51-prd-适用性分析)
  - [5.2 Spec 适用性分析](#52-spec-适用性分析)
  - [5.3 架构设计文档适用性分析](#53-架构设计文档适用性分析)
  - [5.4 推荐建议及理由](#54-推荐建议及理由)
- [6. 功能需求](#6-功能需求)
  - [6.1 SSO 登录 / 登出](#61-sso-登录--登出)
  - [6.2 用户会话管理](#62-用户会话管理)
  - [6.3 结果中继页面（/dashboard/jobs）](#63-结果中继页面dashboardjobs)
  - [6.4 JobStore 用户隔离](#64-jobstore-用户隔离)
  - [6.5 用量计量（计费基础）](#65-用量计量计费基础)
  - [6.6 匿名试用模式（可选）](#66-匿名试用模式可选)
- [7. 非功能需求](#7-非功能需求)
- [8. 技术方案分析](#8-技术方案分析)
  - [8.1 方案 A：NGINX + SSO](#81-方案-anginx--sso)
  - [8.2 方案 B：现有程序 + SSO](#82-方案-b现有程序--sso)
  - [8.3 方案对比](#83-方案对比)
- [9. 集成方案建议](#9-集成方案建议)
- [10. 数据库设计方案](#10-数据库设计方案)
  - [10.1 方案 A 数据库设计（NGINX + SSO）](#101-方案-a-数据库设计nginx--sso)
  - [10.2 方案 B 数据库设计（现有程序 + SSO）— 推荐方案](#102-方案-b-数据库设计现有程序--sso--推荐方案)
- [11. 最佳方案推荐](#11-最佳方案推荐)
- [12. 实施计划](#12-实施计划)
- [13. 风险评估](#13-风险评估)
- [14. 附录](#14-附录)

---

## 3. 引言

### 3.1 文档目的

本 PRD 旨在明确 GESP6 信奥赛 C++ 解题网页生成器（以下简称"GESP6 解题器"）下一阶段集成 SSO（Single Sign-On，单点登录）认证、用户体系、结果中继页面及用量计量的产品需求，为后续架构设计、Spec 细化、开发实施与测试验收提供唯一输入依据。

文档覆盖以下内容：

1. 现状分析与业务目标对齐；
2. 文档类型选型论证（PRD / Spec / 架构设计文档）；
3. 完整功能需求与非功能需求清单；
4. 两套技术方案（NGINX + SSO / 现有程序 + SSO）的客观对比；
5. 推荐方案的数据库设计、实施路径与风险控制。

### 3.2 适用范围

| 维度 | 说明 |
|------|------|
| 项目 | `/var/learning`（Next.js 15.1.6 App Router） |
| 模块 | 认证、会话、用户体系、结果中继、用量计量、JobStore 改造 |
| 不涉及 | 计费系统的最终落地实现（仅预留数据基础，归入远期阶段） |
| 读者 | 产品、架构师、Next.js 开发专家、测试专家、DevOps |

### 3.3 术语定义

| 术语 | 全称 | 说明 |
|------|------|------|
| SSO | Single Sign-On | 单点登录，用户一次认证即可访问多个相互信任的应用 |
| IdP | Identity Provider | 身份提供者，负责认证用户并签发断言/令牌（用户已有 IdP 端程序） |
| SP | Service Provider | 服务提供者，即 GESP6 解题器，依赖 IdP 完成用户认证 |
| OIDC | OpenID Connect | 基于 OAuth2 的身份认证协议，使用 ID Token 表达用户身份 |
| SAML | Security Assertion Markup Language | 基于 XML 的身份联邦协议，常见于企业 IdP |
| OAuth2 | OAuth 2.0 | 授权框架，OIDC 在其之上扩展身份认证 |
| Session | 会话 | 用户登录后在 SP 端维持的状态 |
| JobStore | 任务存储 | GESP6 解题器中保存异步任务记录的内存 Map 实现 |
| HtmlCache | HTML 缓存 | 已生成解题页面的缓存层（双 key：primary + sample） |
| JobId | 任务 ID | 提交解题请求后返回的唯一标识，前端轮询查询结果 |
| TTL | Time To Live | 生存时间，过期自动清理 |
| CSP | Content Security Policy | 内容安全策略，通过 HTTP 头限制资源加载来源 |
| CSRF | Cross-Site Request Forgery | 跨站请求伪造攻击 |
| IdP 故障降级 | — | 当 IdP 不可用时，SP 采取的兜底策略（如只读模式或本地兜底账号） |

---

## 4. 需求背景

### 4.1 当前痛点

当前 GESP6 解题器完全匿名运行，存在以下核心痛点：

| 痛点编号 | 痛点 | 影响 |
|---------|------|------|
| P-001 | 匿名使用，无用户身份 | 无法识别用户，无法提供个性化体验 |
| P-002 | 任务记录仅存于浏览器 `sessionStorage` | 用户关闭/刷新浏览器后历史结果丢失，无法跨设备查看 |
| P-003 | JobStore 为进程内存 Map，30 分钟 TTL，重启即丢 | 服务重启或多实例部署后，进行中任务无法恢复 |
| P-004 | 无用量计量 | 无法统计单用户调用次数，未来计费缺乏数据基础 |
| P-005 | 无配额管控 | 单用户可无限调用，存在资源滥用与成本失控风险 |
| P-006 | 无越权防护 | 任何人持有 jobId 即可查询他人任务结果（虽 jobId 为 UUID，但非主动隔离） |
| P-007 | 速率限制基于 IP（`middleware.ts` 中 20 次/分钟/IP） | NAT 网关下多用户共享 IP 互相影响，且单用户切换网络即可绕过 |
| P-008 | 跨页结果传递依赖 `sessionStorage` | 移动端隐私模式下 sessionStorage 可能受限，导致结果丢失 |

### 4.2 业务目标

| 目标编号 | 目标 | 衡量指标 |
|---------|------|---------|
| G-001 | 建立用户体系，用户可登录登出 | 登录成功率 ≥ 99%；登录响应 < 1s |
| G-002 | 提供结果中继页面，用户可查看历史任务 | `/dashboard/jobs` 可展示近 30 天任务列表 |
| G-003 | 实现用户隔离，jobId 仅本人可访问 | 越权访问返回 403，覆盖率 100% |
| G-004 | 记录用量数据，为计费打基础 | 每次调用生成 `usage_logs` 记录，字段完整 |
| G-005 | 预留配额机制 | `user_quotas` 表落地，超配额请求被拒绝 |
| G-006 | 平滑过渡，不破坏现有匿名体验 | 灰度阶段匿名用户仍可使用核心功能 |
| G-007 | 为多实例部署打基础 | 会话与任务存储可外部化（Redis / 数据库） |

### 4.3 项目现状摘要

**技术栈**：

- Next.js 15.1.6（App Router）+ React 19.0.0 + TypeScript 5.7.3
- Tailwind CSS 3.4.17 + shadcn/ui（基于 Radix UI）
- Vitest 3.0（单元测试）+ Playwright 1.61（E2E 测试）
- Zod 3.24（输入校验）+ cheerio 1.2（HTML 解析）

**现有架构层次**：

```
页面层：  /（首页）  /solve（输入页）  /result（结果页）
API 层：  /api/solve（POST 提交 / GET 轮询 / DELETE 取消）  /api/health（健康检查）
服务层：  Orchestrator（编排） + HtmlCache（双 key 缓存） + FsHtmlCache（文件系统缓存）
         LLMCaller + CodeValidator + ImageRecognizer + ConcurrencyLimiter + HtmlParser
任务层：  JobStore（内存 Map，30 分钟 TTL）
中间件：  middleware.ts（速率限制 20 次/分钟/IP，仅 /api/* 生效）
```

**关键文件清单**（已调研确认）：

| 文件路径 | 职责 | SSO 改造相关性 |
|---------|------|---------------|
| `middleware.ts` | 速率限制（IP 维度，内存 Map） | SSO 认证接入点，需扩展认证检查逻辑 |
| `app/layout.tsx` | 根布局，仅渲染 `LayoutClient` | SessionProvider 注入点 |
| `app/layout-client.tsx` | 布局客户端组件，当前为空壳 | 包裹 SessionProvider，提供会话上下文 |
| `app/api/solve/route.ts` | 主业务接口，Zod 校验后创建 Job | 需读取会话用户，关联 jobId 与 user_id |
| `app/lib/job-store.ts` | 内存任务队列，30 分钟 TTL | 需扩展 user_id 字段，未来迁移至数据库 |
| `app/lib/ai/services/orchestrator.ts` | 编排核心 | 用量计量埋点 |
| `app/lib/ai/services/fs-html-cache.ts` | 文件系统 HTML 缓存（三层结构） | 数据库迁移目标 |
| `app/lib/env.ts` | 环境变量验证（含模块级缓存） | 需新增 SSO 相关环境变量校验 |
| `next.config.ts` | 安全头配置，CSP 含 jsdelivr 白名单 | CSP 需调整以放行 IdP 域名 |

**数据存储现状**：

| 数据 | 存储位置 | 特征 |
|------|---------|------|
| HTML 缓存 | 文件系统 `/var/learning/data/gesp6/`（primary/content/sample 三层） | 跨进程持久化，单机部署 |
| JobStore | 进程内存 Map | 30 分钟 TTL，重启丢失 |
| 速率限制 | 进程内存 Map | 多实例不共享 |
| 跨页结果传递 | 浏览器 `sessionStorage` | 仅当前会话有效 |
| 用户身份 | 无 | 完全匿名 |

**已预置的规范**（`.trae/rules/`）：

- `dev/api-conventions.md` §三：LDAP 连接规范（`withLdapClient` 模式，禁止连接池，禁止长连接复用）
- `global/code-style.md` §五：Cookie 配置（`httpOnly: true` + `secure: true`（生产） + `sameSite: 'lax'` + `maxAge: 15 分钟`）
- `dev/dev-workflow.md` §五：`middleware.ts` 做服务端认证检查，未登录重定向至 `/login`
- `dev/dev-workflow.md` §六：中间件仅可用 `console`，禁止 `logger`（Edge Runtime 限制）
- `infra/env-management.md`：环境变量命名与文件约定（无前缀=服务端，`NEXT_PUBLIC_`=客户端可见）

---

## 5. 文档类型评估

在进入功能需求之前，需先论证为何本阶段采用 PRD 而非 Spec 或架构设计文档作为顶层输入。

### 5.1 PRD 适用性分析

| 维度 | 评估 |
|------|------|
| 适用性 | **高**。SSO 集成涉及业务目标、用户故事、多方案选型、数据库设计与实施计划，需要从产品视角定义"做什么"与"为什么做" |
| 优势 | 1) 涵盖业务背景与目标，便于非技术干系人理解；2) 支持多方案对比与推荐论证；3) 可承载完整数据库设计与实施路径；4) 直接驱动后续 Spec 与架构设计 |
| 局限 | 1) 不规定接口字段级契约（需 Spec 补充）；2) 不规定模块依赖与运行时拓扑（需架构设计文档补充）；3) PRD 不进入 `.trae/rules/spec/` 工作流，不产生 review 文件 |

### 5.2 Spec 适用性分析

参考 `.trae/rules/spec/spec-template.md` 与 `.trae/rules/spec/spec-workflow.md`：

| 维度 | 评估 |
|------|------|
| 适用性 | **中**。Spec 模板聚焦"功能需求 + 非功能需求 + 验收标准"，适合已确定方案后的细化阶段 |
| 优势 | 1) 严格的工作流（生成 → 评审 → 修订 → approved），保证需求质量；2) 强制验收标准（AC-XXX checkbox），便于测试对齐；3) 与 `.trae/rules/` 体系无缝衔接，approved 后即可驱动开发 |
| 局限 | 1) Spec 模板无"方案对比 / 推荐论证"章节，不适合承载方案选型讨论；2) Spec 工作流要求单一功能聚焦，SSO 集成涉及认证、用户、中继、计量多个子模块，需拆分多份 Spec；3) Spec 不承载数据库 ER 设计（属架构设计范畴） |

### 5.3 架构设计文档适用性分析

| 维度 | 评估 |
|------|------|
| 适用性 | **中**。架构设计文档聚焦模块边界、数据流、运行时拓扑、依赖关系，适合方案确定后的技术落地设计 |
| 优势 | 1) 明确模块划分与依赖方向；2) 定义数据流与调用链；3) 承载部署拓扑与多实例方案 |
| 局限 | 1) 不承载业务目标与用户故事；2) 不承载方案选型论证；3) 项目历史已归档 `docs/architecture/archived/arch-gesp6-web-html-v1.0.md`，新增 SSO 架构应基于 PRD approved 后再产出 |

### 5.4 推荐建议及理由

**推荐：以 PRD 为顶层输入，approved 后拆分多份 Spec 并产出 SSO 架构设计文档。**

理由：

1. **当前阶段核心矛盾是方案选型**（NGINX + SSO vs 现有程序 + SSO）与**业务目标对齐**，PRD 是承载此类内容的最佳载体；
2. PRD 的"技术方案分析 + 推荐方案 + 数据库设计"章节可直接作为后续架构设计的输入；
3. PRD approved 后，按 `.trae/rules/spec/spec-workflow.md` 拆分为：
   - `spec-sso-auth-v1.0.md`（SSO 登录登出与会话）
   - `spec-user-dashboard-v1.0.md`（结果中继页面）
   - `spec-usage-metering-v1.0.md`（用量计量与配额）
4. Spec 工作流强制评审，保证细节质量；架构设计文档则基于 Spec 产出，避免过早进入技术细节；
5. 避免在 PRD 阶段就被 Spec 工作流约束（如禁止多版本并存、强制 review 文件等），保留方案讨论的灵活性。

---

## 6. 功能需求

### 6.1 SSO 登录 / 登出

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-001 | 支持通过外部 IdP 完成 SSO 登录 | P0 | 用户点击"登录"按钮后，重定向至 IdP 认证页面；IdP 完成认证后回调本应用 |
| FR-002 | 支持 OIDC 协议接入 | P0 | 优先支持 OIDC（Authorization Code Flow + PKCE），适配现代 IdP |
| FR-003 | 支持 SAML 2.0 协议接入（可选） | P2 | 若用户 IdP 仅支持 SAML，提供 SAML 接入能力 |
| FR-004 | 登录成功后创建本地会话 | P0 | IdP 回调成功后，SP 端建立会话，写入 Cookie（遵循 `code-style.md` §五配置） |
| FR-005 | 登录成功后重定向回原页面 | P0 | 登录前记录 `next` 参数，登录成功后重定向回该路径 |
| FR-006 | 支持登出 | P0 | 登出时同时清除 SP 会话 Cookie 并重定向至 IdP 的 end session 端点（若 IdP 支持） |
| FR-007 | 支持单点登出（SLO，可选） | P2 | IdP 登出时通知 SP 清除会话 |
| FR-008 | 登录失败时显示明确错误 | P0 | 区分"IdP 不可达"、"用户拒绝授权"、"断言校验失败"等错误类型，对应错误码 `AUTH_LOGIN_*` |
| FR-009 | 首次登录自动创建本地用户记录 | P0 | IdP 回调携带的用户标识在本地 `users` 表不存在时，自动插入一条记录 |
| FR-010 | 登录状态在所有页面可见 | P0 | 根布局通过 `SessionProvider` 向所有页面注入当前用户信息（未登录时为 null） |
| FR-011 | 支持"记住我"延长会话 | P1 | 默认会话 15 分钟（Cookie maxAge），勾选"记住我"延长至 7 天 |

### 6.2 用户会话管理

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-012 | 会话以 Cookie 维持，禁止 URL 携带 | P0 | Cookie 配置遵循 `code-style.md` §五：`httpOnly` + `secure`（生产）+ `sameSite=lax` |
| FR-013 | 会话校验在 `middleware.ts` 完成 | P0 | Edge Runtime 中校验 Cookie，未登录访问受保护路由重定向 `/login?next=...` |
| FR-014 | 公开路由白名单 | P0 | `/`、`/solve`、`/api/health`、`/login`、`/api/auth/*` 为公开路由，无需登录可访问 |
| FR-015 | 受保护路由强制登录 | P0 | `/dashboard/*`、`/api/solve`（POST）为受保护路由，未登录返回 401（API）或重定向（页面） |
| FR-016 | 会话过期自动清理 | P0 | `sessions` 表过期记录由定时任务清理；Cookie 过期后下次请求视为未登录 |
| FR-017 | 支持会话续期 | P1 | 用户活跃期间自动延长会话（滑动过期），避免使用中突然掉线 |
| FR-018 | 支持强制下线 | P2 | 管理员可将某用户的所有会话标记为失效（`sessions.revoked_at`） |

### 6.3 结果中继页面（/dashboard/jobs）

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-019 | 提供 `/dashboard/jobs` 页面展示用户历史任务 | P0 | 列表展示当前登录用户的任务记录，按 `created_at` 倒序 |
| FR-020 | 任务列表分页 | P1 | 默认每页 20 条，支持翻页 |
| FR-021 | 任务列表展示关键字段 | P0 | 字段：任务 ID、平台、题目标识、状态、创建时间、耗时、是否命中缓存 |
| FR-022 | 支持点击任务跳转至结果页 | P0 | 点击列表项跳转至 `/result?jobId=xxx`，结果页校验 jobId 归属当前用户 |
| FR-023 | 支持按状态筛选 | P1 | 筛选项：全部 / 处理中 / 成功 / 失败 / 已取消 |
| FR-024 | 支持按时间范围筛选 | P2 | 时间范围选择器（近 1 天 / 7 天 / 30 天） |
| FR-025 | 任务列表仅展示当前用户任务 | P0 | 数据查询以 `user_id` 为过滤条件，越权访问返回 403 |
| FR-026 | 支持删除自己的任务记录 | P2 | 软删除（`deleted_at`），不实际删除物理记录 |
| FR-027 | 进行中任务实时刷新 | P1 | 列表页对 `processing` 状态任务每 3 秒轮询一次状态 |
| FR-028 | 结果页 `/result` 支持从历史任务恢复 | P0 | 结果页改造：从 `sessionStorage` 读取改为优先从 JobStore/数据库读取（按 jobId + user_id 校验） |

### 6.4 JobStore 用户隔离

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-029 | `JobRecord` 增加 `userId` 字段 | P0 | 创建任务时记录当前用户 ID（匿名用户为 null 或特殊值 `anonymous`） |
| FR-030 | `GET /api/solve?jobId=xxx` 校验归属 | P0 | 查询任务时校验 `job.userId === currentUserId`，不匹配返回 403 |
| FR-031 | `DELETE /api/solve?jobId=xxx` 校验归属 | P0 | 取消任务时同样校验归属 |
| FR-032 | 任务列表查询支持 `userId` 过滤 | P0 | `/dashboard/jobs` 通过 `userId` 查询当前用户任务 |
| FR-033 | JobStore 数据结构预留数据库迁移 | P1 | 接口设计兼容未来从内存 Map 迁移至数据库/Redis，调用方无感知 |

### 6.5 用量计量（计费基础）

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-034 | 每次提交任务记录一条 `usage_logs` | P0 | 字段：user_id、job_id、platform、problem_id、llm_call_count、token_usage、cached、created_at |
| FR-035 | 记录 LLM 调用次数与 token 消耗 | P0 | 在 `orchestrator.ts` 修正循环中累计 `llm_call_count`，从 LLM 响应提取 token 用量 |
| FR-036 | 区分命中缓存与新生成 | P0 | `cached` 字段标记本次结果是否来自 HtmlCache，命中缓存不计费或计费减半 |
| FR-037 | 维护用户配额 `user_quotas` | P1 | 字段：user_id、quota_period（daily/monthly）、quota_limit、quota_used、reset_at |
| FR-038 | 提交任务前校验配额 | P1 | 超出配额返回 `429` + 错误码 `GESP6_QUOTA_EXCEEDED` |
| FR-039 | 配额用量在配额周期重置后归零 | P1 | 定时任务或查询时惰性重置 `quota_used` |
| FR-040 | 提供用量统计查询接口（管理后台远期） | P2 | `/api/admin/usage` 查询用户用量，仅管理员可访问 |

### 6.6 匿名试用模式（可选）

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| FR-041 | 未登录用户可试用 N 次/天（按 IP+浏览器指纹） | P2 | 匿名配额独立于登录用户，防止滥用 |
| FR-042 | 匿名用户提交时弹出登录引导 | P2 | 达到试用上限后引导登录，登录后可继续使用 |
| FR-043 | 匿名用户的任务记录仅存于 `sessionStorage` | P2 | 不写入 `jobs` 表，仅内存 JobStore |
| FR-044 | 匿名用户登录后可关联历史任务（可选） | P3 | 通过浏览器指纹或临时 token 关联，体验复杂，远期考虑 |

---

## 7. 非功能需求

### 7.1 性能

| 编号 | 需求 | 指标 |
|------|------|------|
| NFR-001 | 登录响应时间 | IdP 回调到 SP 完成会话创建 < 1s（不含 IdP 自身耗时） |
| NFR-002 | 会话校验开销 | `middleware.ts` 中会话校验 < 5ms（Edge Runtime 内，避免数据库查询，使用 JWT 或 Redis 缓存） |
| NFR-003 | `/dashboard/jobs` 列表加载 | 首屏 < 500ms（20 条记录，含分页查询） |
| NFR-004 | 用量记录写入不阻塞主流程 | `usage_logs` 写入异步，失败仅记日志不阻断任务 |
| NFR-005 | JobStore 用户隔离校验零额外开销 | `userId` 比较为 O(1)，不引入性能损耗 |

### 7.2 安全

| 编号 | 需求 | 说明 |
|------|------|------|
| NFR-006 | Cookie 配置遵循 `code-style.md` §五 | `httpOnly: true` + `secure: true`（生产）+ `sameSite: 'lax'` + `maxAge: 15min` |
| NFR-007 | CSP 调整放行 IdP 域名 | `next.config.ts` 的 `connect-src` 增加 IdP 域名；`script-src` / `frame-src` 按需调整 |
| NFR-008 | CSRF 防护 | 状态变更操作（POST/DELETE）使用 `SameSite=lax` Cookie + Origin 校验；OIDC 使用 PKCE |
| NFR-009 | 越权防护 | 所有按 jobId 查询/操作的接口校验 `userId` 归属，越权返回 403 |
| NFR-010 | IdP 断言校验 | OIDC ID Token 必须校验签名、`iss`、`aud`、`exp`、`nonce` |
| NFR-011 | 会话固定攻击防护 | 登录成功后重新生成 session_id，不复用匿名阶段 session |
| NFR-012 | 敏感信息不入 `NEXT_PUBLIC_` | IdP client_secret、数据库连接串等仅服务端可见 |
| NFR-013 | 日志脱敏 | 日志中不输出完整 token、密码、Cookie 值（遵循 `dev-workflow.md` §六） |
| NFR-014 | middleware 仅用 `console` | Edge Runtime 禁止 `logger`，遵循 `dev-workflow.md` §六 |

### 7.3 可用性

| 编号 | 需求 | 说明 |
|------|------|------|
| NFR-015 | SSO IdP 故障降级 | IdP 不可达时，登录页显示友好错误；已登录用户会话不受影响；匿名用户仍可使用试用模式 |
| NFR-016 | 数据库故障降级 | 数据库不可用时，JobStore 降级为内存模式（仅当前进程有效），用量记录暂存日志待恢复后补录 |
| NFR-017 | 会话存储故障降级 | Redis 不可用时（远期），会话降级为 JWT 自包含校验，避免单点故障 |

### 7.4 兼容性

| 编号 | 需求 | 说明 |
|------|------|------|
| NFR-018 | 现有匿名用户平滑过渡 | 灰度阶段匿名用户仍可访问 `/` 和 `/solve`，不强制登录 |
| NFR-019 | 现有 `sessionStorage` 结果传递兼容 | 结果页改造后，优先从 JobStore 读取，`sessionStorage` 作为兜底 |
| NFR-020 | 现有 API 契约不破坏 | `/api/solve` POST/GET/DELETE 接口签名不变，仅增加 `userId` 内部字段 |
| NFR-021 | 浏览器兼容性 | 兼容 Chrome 90+ / Firefox 88+ / Safari 14+（Cookie `SameSite=lax` 全面支持） |

### 7.5 可扩展性

| 编号 | 需求 | 说明 |
|------|------|------|
| NFR-022 | 多实例部署预留 | 会话与 JobStore 数据结构设计兼容未来迁移至 Redis |
| NFR-023 | Redis 引入时机 | 当出现以下任一情况时引入 Redis：① 多实例部署；② JobStore 需跨进程共享；③ 速率限制需精确 |
| NFR-024 | 数据库选型预留 | 表结构使用通用 SQL 类型，兼容 PostgreSQL / MySQL，便于切换 |
| NFR-025 | 计费系统接入预留 | `usage_logs` 与 `user_quotas` 表结构覆盖计费所需字段，未来接入计费引擎无需重构 |

---

## 8. 技术方案分析

### 8.1 方案 A：NGINX + SSO

#### 原理

NGINX 作为反向代理前置，集成 SSO 认证模块（如 `nginx-sso`、`vouch-proxy`、`oauth2-proxy`）。所有请求到达 Next.js 之前，NGINX 先完成认证：

```
浏览器 → NGINX（SSO 模块）→ [未登录] 重定向 IdP → 回调 NGINX → 设置 Cookie
                            → [已登录] 注入 HTTP Header（如 X-Auth-User）→ 转发 Next.js
```

Next.js 通过读取 NGINX 注入的 HTTP Header 获取用户身份，自身不参与认证流程。

#### 技术可行性

| 维度 | 评估 |
|------|------|
| 协议支持 | 依赖所选 NGINX SSO 模块，`oauth2-proxy` 支持 OIDC/OAuth2，`vouch-proxy` 同样支持；SAML 需额外组件 |
| Next.js 集成 | Next.js 仅需读取 Header，无需引入认证库；`middleware.ts` 中读取 `X-Auth-User` 即可 |
| 现有架构改造 | `middleware.ts` 改造为"读 Header → 注入请求上下文"，移除原有速率限制逻辑（由 NGINX 承担） |

#### 安全性

| 维度 | 评估 |
|------|------|
| 认证逻辑隔离 | 认证完全在 NGINX 层，Next.js 不接触 token，降低 token 泄露风险 |
| Header 伪造风险 | **关键风险**：若 Next.js 直接对外暴露（绕过 NGINX），攻击者可伪造 `X-Auth-User` Header。必须确保 Next.js 仅监听内网端口 |
| Cookie 管理 | Cookie 由 NGINX 设置，Next.js 无法直接控制 `httpOnly`/`secure` 配置，需在 NGINX 配置中严格对齐 `code-style.md` §五 |
| CSP 兼容 | NGINX 与 Next.js 都可设置 CSP，需统一避免冲突 |

#### 性能影响

| 维度 | 评估 |
|------|------|
| 认证延迟 | NGINX 层校验 Cookie，开销极低（< 1ms） |
| Next.js 负担 | 无认证逻辑，请求处理更快 |
| 资源占用 | 多一个 NGINX 进程，但 NGINX 极轻量 |

#### 实施复杂度

| 维度 | 评估 |
|------|------|
| 部署复杂度 | 高，需额外维护 NGINX + SSO 模块的部署、配置、证书 |
| 开发复杂度 | 低，Next.js 侧改动极小 |
| 运维复杂度 | 高，NGINX 配置变更需重启，SSO 模块升级需独立流程 |
| 调试难度 | 高，认证问题需在 NGINX 日志与 Next.js 日志间切换 |

#### 适用场景

- 已有成熟 NGINX + SSO 基础设施的组织
- 多应用统一认证（NGINX SSO 可同时保护多个后端服务）
- Next.js 应用本身不希望承担认证职责
- 团队对 NGINX 配置熟悉，且有专门运维人员

---

### 8.2 方案 B：现有程序 + SSO

#### 原理

在 Next.js 应用层直接集成 SSO，使用 `next-auth.js` v5（Auth.js）或自建认证模块。认证流程完全在 Next.js 内完成：

```
浏览器 → Next.js middleware（校验会话 Cookie）
       → [未登录] 重定向 /api/auth/signin → IdP → 回调 /api/auth/callback → 设置会话 Cookie
       → [已登录] 注入会话上下文 → 业务逻辑
```

#### 技术可行性

| 维度 | 评估 |
|------|------|
| 协议支持 | `next-auth.js` v5 原生支持 OIDC/OAuth2/SAML（部分），社区 Provider 丰富；自建方案可基于 `openid-client` / `panva/node-saml` |
| Next.js 集成 | `next-auth.js` 提供 `SessionProvider`、`getServerSession`、middleware 集成，与 App Router 兼容（v5 支持 RSC） |
| 现有架构改造 | `middleware.ts` 增加 `getSession()` 校验；`app/layout-client.tsx` 包裹 `SessionProvider`；`app/api/solve/route.ts` 读取 session 获取 userId |
| Edge Runtime 兼容 | `next-auth.js` v5 middleware 在 Edge Runtime 可用；JWT 策略无需数据库查询，会话校验 < 5ms |

#### 安全性

| 维度 | 评估 |
|------|------|
| 认证逻辑内聚 | 认证与业务在同一进程，便于端到端审计与单测覆盖 |
| Cookie 完全可控 | `next-auth.js` 支持自定义 Cookie 配置，可直接对齐 `code-style.md` §五 |
| CSRF 防护 | `next-auth.js` 内置 CSRF token 机制 |
| Header 伪造风险 | 无此风险，认证状态由应用自身签名 Cookie 决定 |
| 秘钥管理 | `AUTH_SECRET` 必须妥善保管，泄露会导致会话伪造 |

#### 性能影响

| 维度 | 评估 |
|------|------|
| 认证延迟 | JWT 策略下会话校验为本地签名验证（< 5ms）；database 策略需查询数据库（建议 Redis 缓存） |
| Next.js 负担 | 增加认证逻辑，但 `next-auth.js` 高度优化，影响可忽略 |
| 资源占用 | 无额外进程，复用 Next.js 进程 |

#### 实施复杂度

| 维度 | 评估 |
|------|------|
| 部署复杂度 | 低，无需额外组件，Next.js 单进程即可 |
| 开发复杂度 | 中，需熟悉 `next-auth.js` v5 API 与 App Router 集成方式 |
| 运维复杂度 | 低，认证配置与应用一同部署，无独立运维流程 |
| 调试难度 | 低，认证日志与应用日志统一 |

#### 适用场景

- 单应用认证场景
- 希望认证逻辑与应用深度集成（如基于用户身份的业务逻辑）
- 无独立 NGINX 运维团队
- 未来可能扩展为多应用，但当前以单应用为主
- 需要在应用层精细控制会话与用量

---

### 8.3 方案对比

| 维度 | 方案 A（NGINX + SSO） | 方案 B（现有程序 + SSO） |
|------|----------------------|------------------------|
| 开发成本 | 低（Next.js 改动小） | 中（需集成 next-auth.js + 会话管理） |
| 维护难度 | 高（NGINX + SSO 模块独立运维） | 低（与应用一同迭代） |
| 扩展性 | 中（多应用共享认证，但 NGINX 配置扩展繁琐） | 高（应用内可灵活扩展认证逻辑） |
| 兼容性 | 中（依赖 NGINX 部署拓扑） | 高（纯 Next.js，部署拓扑无关） |
| 用户深度集成 | 弱（Header 注入，应用层无法感知登录流程） | 强（应用层完全掌控会话、用量、配额） |
| 计费支持 | 弱（NGINX 层难以关联业务用量） | 强（用量记录直接关联 user_id，可实时校验配额） |
| 多实例部署 | 中（NGINX 需独立会话共享方案） | 高（JWT 自包含 / Redis 共享均可） |
| Header 伪造风险 | 高（需严格内网隔离） | 无 |
| Cookie 配置可控性 | 低（依赖 NGINX 配置） | 高（应用层直接控制） |
| 调试体验 | 差（跨进程日志） | 好（统一日志） |
| 与现有规范契合度 | 中（`middleware.ts` 改造为读 Header，偏离 `dev-workflow.md` §五原意） | 高（`middleware.ts` 直接做认证检查，完全契合 `dev-workflow.md` §五） |
| 与 LDAP 规范契合度 | 弱（NGINX 层认证，应用层无法应用 `api-conventions.md` §三 LDAP 规范） | 强（应用层可直接调用 `withLdapClient` 模式，若需 LDAP 集成） |

---

## 9. 集成方案建议

基于 §8.3 对比，**强烈推荐方案 B（现有程序 + SSO）**，理由如下：

### 9.1 与项目规范高度契合

- `dev-workflow.md` §五已明确"使用 `middleware.ts` 做服务端认证检查"，方案 B 直接落地此规范；
- `api-conventions.md` §三 LDAP 规范（`withLdapClient` 模式）仅在应用层可执行，方案 A 无法应用；
- `code-style.md` §五 Cookie 配置需应用层可控，方案 B 通过 `next-auth.js` 配置直接对齐。

### 9.2 计费与用量计量强需求

本 PRD 的核心目标之一是为计费打基础（G-004、G-005）。方案 B 的优势在于：

1. **用量记录直接关联 user_id**：`/api/solve` POST 时即可从 session 获取 userId，写入 `usage_logs`，无需 Header 中转；
2. **配额实时校验**：提交任务前查询 `user_quotas`，超配额拒绝，逻辑内聚于应用层；
3. **缓存命中计费**：`orchestrator.ts` 已知 `cached` 状态，可直接写入用量记录，方案 A 难以感知。

### 9.3 用户深度集成

- 结果中继页面 `/dashboard/jobs` 需按 user_id 过滤任务，方案 B 在数据查询层直接关联，无需 Header 解析；
- 用户隔离（FR-030、FR-031）依赖 session 内的 userId，方案 B 自然支持；
- 未来"记住我"、会话续期、强制下线等高级特性，方案 B 在应用层实现更灵活。

### 9.4 部署与运维简化

- 当前项目为单 Next.js 应用，无既有 NGINX SSO 基础设施；
- 方案 B 无需引入额外进程，部署复杂度低；
- 调试体验好，认证日志与业务日志统一；
- 与项目 CI/CD 流水线（`cicd-workflow.md`）契合，无需为 NGINX 独立流水线。

### 9.5 风险可控

- 方案 A 的 Header 伪造风险需严格的网络隔离保障，引入额外安全责任；
- 方案 B 的认证逻辑内聚，安全审计与单测覆盖更完整；
- `next-auth.js` v5 社区成熟，CVE 跟踪及时。

### 9.6 实施路径概述

```
阶段 1（基础）：SSO 登录登出 + 会话管理 + 用户体系
  └─ next-auth.js v5 集成 + middleware 认证 + users/sessions 表
  └─ 验证：登录登出可用、受保护路由生效

阶段 2（中继）：结果中继页面 + JobStore 用户隔离
  └─ /dashboard/jobs + jobs 表 + userId 隔离
  └─ 验证：历史任务可查、越权访问被拒

阶段 3（远期）：用量计量 + 配额 + 数据库迁移
  └─ usage_logs + user_quotas + HtmlCache 迁移至 solutions/primary_index/sample_index
  └─ 验证：用量记录准确、配额生效、缓存迁移无丢失
```

---

## 10. 数据库设计方案

本节给出两套方案各自的数据库设计。**方案 B 为推荐方案**（§11 详述），其表结构为后续 Spec 与架构设计的输入。

### 10.1 方案 A 数据库设计（NGINX + SSO）

#### 10.1.1 数据模型（ER 描述）

```
users 1 ──── N sessions
users 1 ──── N jobs
users 1 ──── N usage_logs
users 1 ──── 1 user_quotas
jobs  1 ──── 1 solutions（可选，jobs 表可直接存 solution）
```

#### 10.1.2 表结构

**users 表**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| external_id | VARCHAR(255) | NOT NULL UNIQUE | NGINX 注入的 `X-Auth-User` 标识 |
| display_name | VARCHAR(100) | NULL | 显示名（从 Header 提取或首次登录写入） |
| email | VARCHAR(255) | NULL | 邮箱（从 Header 提取） |
| role | VARCHAR(20) | NOT NULL DEFAULT 'user' | 角色：user / admin |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 更新时间 |

**sessions 表**（方案 A 下会话由 NGINX 管理，此表可选用于审计）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 会话 ID |
| user_id | BIGINT | FK → users.id, NOT NULL | 用户 ID |
| idp_session_id | VARCHAR(255) | NULL | IdP 侧会话标识（用于 SLO） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| expires_at | TIMESTAMPTZ | NOT NULL | 过期时间 |
| revoked_at | TIMESTAMPTZ | NULL | 撤销时间（强制下线） |

**jobs 表**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 任务 ID（与现有 JobStore 一致） |
| user_id | BIGINT | FK → users.id, NOT NULL | 归属用户 |
| platform | VARCHAR(50) | NOT NULL | 平台标识 |
| problem_id | VARCHAR(100) | NULL | 题目标识 |
| status | VARCHAR(20) | NOT NULL | processing/done/error/cancelled |
| result | JSONB | NULL | Solution 结果（done 时填充） |
| error_code | VARCHAR(50) | NULL | 错误码（error 时填充） |
| error_message | TEXT | NULL | 错误消息 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| completed_at | TIMESTAMPTZ | NULL | 完成时间 |
| deleted_at | TIMESTAMPTZ | NULL | 软删除时间 |

**索引**：
- `idx_jobs_user_created` ON (user_id, created_at DESC)
- `idx_jobs_status` ON (status)

**数据同步机制**：

- 会话由 NGINX 管理，`sessions` 表仅在需要 SLO 时同步（NGINX 通过 webhook 通知 Next.js）；
- 用户身份通过 Header 注入，`users` 表在首次请求时按 `external_id` upsert；
- 用量记录与方案 B 一致（见 §10.2.2 `usage_logs`）。

#### 10.1.3 方案 A 局限

- `users` 表的 `external_id` 依赖 NGINX Header，Header 字段变更需同步数据库；
- 会话状态分散在 NGINX 与数据库两处，一致性维护复杂；
- 用量计量仍需应用层主动写入，与方案 A "认证外置"的初衷部分冲突。

---

### 10.2 方案 B 数据库设计（现有程序 + SSO）— 推荐方案

#### 10.2.1 数据模型（ER 描述）

```
┌─────────┐     ┌──────────┐     ┌──────────────┐
│ users   │1───N│ sessions │     │ user_quotas  │1
 │         │1──────────────────1│              │
 │         │1───N┌──────────┐   └──────────────┘
 │         │     │ jobs     │1
 │         │     │          │1──1 solutions (可选)
 │         │1───N│ usage_logs│
 │         │     └──────────┘
 │         │
 │         │  primary_index (无 user 关联，全局缓存索引)
 │         │  sample_index   (无 user 关联，全局缓存索引)
└─────────┘
```

关系说明：
- `users` 1—N `sessions`：一个用户可有多个会话（多设备登录）
- `users` 1—N `jobs`：一个用户可提交多个任务
- `users` 1—N `usage_logs`：每次提交任务产生一条用量记录
- `users` 1—1 `user_quotas`：每个用户一份配额（按周期重置）
- `jobs` 1—1 `solutions`：任务完成后可关联解题内容（也可直接存于 jobs.result）
- `primary_index` / `sample_index`：全局缓存索引，无用户关联，对应现有 FsHtmlCache 的 primary/sample 层

#### 10.2.2 完整表结构

##### 表 1：users（用户表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| external_id | VARCHAR(255) | NOT NULL UNIQUE | IdP 返回的用户唯一标识（sub） |
| provider | VARCHAR(50) | NOT NULL | IdP 标识（如 `keycloak`、`authing`） |
| email | VARCHAR(255) | NULL | 邮箱（IdP 提供） |
| display_name | VARCHAR(100) | NULL | 显示名（IdP 提供） |
| avatar_url | VARCHAR(500) | NULL | 头像 URL（IdP 提供） |
| role | VARCHAR(20) | NOT NULL DEFAULT 'user' | 角色：user / admin |
| status | VARCHAR(20) | NOT NULL DEFAULT 'active' | 状态：active / disabled |
| last_login_at | TIMESTAMPTZ | NULL | 最后登录时间 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 更新时间 |

**索引**：
- `uniq_users_external_provider` UNIQUE ON (provider, external_id)
- `idx_users_email` ON (email)

**说明**：
- `external_id` 与 `provider` 联合唯一，支持多 IdP 接入；
- `role` 为未来管理后台预留；
- `status` 用于禁用用户（disabled 用户登录被拒）。

##### 表 2：sessions（会话表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 会话 ID（next-auth.js session token） |
| user_id | BIGINT | FK → users.id, NOT NULL | 用户 ID |
| session_token | VARCHAR(255) | NOT NULL UNIQUE | 会话 token（Cookie 值的哈希） |
| idp_id_token | TEXT | NULL | IdP 签发的 ID Token（用于 SLO） |
| idp_refresh_token | TEXT | NULL | IdP 刷新 token（用于续期） |
| expires_at | TIMESTAMPTZ | NOT NULL | 过期时间 |
| ip_address | VARCHAR(45) | NULL | 创建会话时的 IP（审计用） |
| user_agent | VARCHAR(500) | NULL | 创建会话时的 UA（审计用） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| revoked_at | TIMESTAMPTZ | NULL | 撤销时间（强制下线） |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 更新时间（续期时更新） |

**索引**：
- `idx_sessions_user` ON (user_id)
- `idx_sessions_expires` ON (expires_at) — 用于清理过期会话

**说明**：
- 若使用 `next-auth.js` JWT 策略，此表可不存 session_token，仅用于 SLO 审计；
- `idp_id_token` / `idp_refresh_token` 加密存储，避免明文泄露；
- `revoked_at` 支持强制下线（FR-018）。

##### 表 3：jobs（任务表，关联 user_id）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 任务 ID（与现有 JobStore 的 jobId 一致） |
| user_id | BIGINT | FK → users.id, NULL | 归属用户（NULL 表示匿名任务，FR-043） |
| platform | VARCHAR(50) | NOT NULL | 平台标识（luogu / ybondao 等） |
| problem_id | VARCHAR(100) | NULL | 题目标识（platform+problemId 组合） |
| problem_input_type | VARCHAR(20) | NOT NULL | text / image / platform |
| problem_input_hash | VARCHAR(64) | NULL | 输入内容哈希（用于去重与脱敏存储） |
| status | VARCHAR(20) | NOT NULL | processing / done / error / cancelled |
| result | JSONB | NULL | Solution 结果（done 时填充，对应 `app/lib/ai/types.ts` 的 Solution） |
| error_code | VARCHAR(50) | NULL | 错误码（error 时填充，如 `GESP6_LLM_TIMEOUT`） |
| error_message | TEXT | NULL | 错误消息 |
| llm_call_count | INT | NOT NULL DEFAULT 0 | LLM 调用次数（修正循环累计） |
| cached | BOOLEAN | NOT NULL DEFAULT FALSE | 是否命中缓存 |
| thinking_content | TEXT | NULL | 思考过程内容（对应 JobRecord.thinkingContent） |
| organizing_content | TEXT | NULL | 组织回答内容（对应 JobRecord.organizingContent） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| completed_at | TIMESTAMPTZ | NULL | 完成时间（done/error/cancelled 时填充） |
| deleted_at | TIMESTAMPTZ | NULL | 软删除时间（FR-026） |

**索引**：
- `idx_jobs_user_created` ON (user_id, created_at DESC) — 支持结果中继页面查询
- `idx_jobs_status` ON (status) — 支持按状态筛选
- `idx_jobs_user_status_created` ON (user_id, status, created_at DESC) — 支持用户+状态+时间组合查询

**说明**：
- `user_id` 允许 NULL，兼容匿名试用模式（FR-043）；
- `problem_input_hash` 用于脱敏存储输入内容指纹，避免存储原始题目内容（隐私与体积考虑）；
- `thinking_content` / `organizing_content` 可考虑独立子表或文件系统存储，避免主表膨胀（远期优化）。

##### 表 4：usage_logs（用量记录表，为计费打基础）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| user_id | BIGINT | FK → users.id, NULL | 用户 ID（NULL 表示匿名） |
| job_id | UUID | FK → jobs.id, NOT NULL | 关联任务 |
| platform | VARCHAR(50) | NOT NULL | 平台标识 |
| problem_id | VARCHAR(100) | NULL | 题目标识 |
| llm_call_count | INT | NOT NULL DEFAULT 0 | LLM 调用次数 |
| token_input | INT | NULL | 输入 token 数 |
| token_output | INT | NULL | 输出 token 数 |
| token_total | INT | NULL | 总 token 数（input + output） |
| cached | BOOLEAN | NOT NULL DEFAULT FALSE | 是否命中缓存（命中不计费或减半） |
| cost_estimate | DECIMAL(10,4) | NULL | 预估成本（用于内部成本核算） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |

**索引**：
- `idx_usage_logs_user_created` ON (user_id, created_at DESC) — 用户用量查询
- `idx_usage_logs_created` ON (created_at) — 全局用量统计

**说明**：
- 此表为追加型（append-only），不更新不删除，便于审计与对账；
- `cost_estimate` 为未来计费引擎预留，可按 `provider` × `model` 的费率表计算；
- `cached=true` 的记录在计费时可按 0 成本或折扣成本计算（业务规则待定）。

##### 表 5：user_quotas（用户配额表，为计费打基础）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| user_id | BIGINT | FK → users.id, UNIQUE NOT NULL | 用户 ID（一对一） |
| quota_period | VARCHAR(20) | NOT NULL DEFAULT 'daily' | 配额周期：daily / monthly |
| quota_limit | INT | NOT NULL DEFAULT 20 | 配额上限（默认每日 20 次） |
| quota_used | INT | NOT NULL DEFAULT 0 | 已用配额 |
| reset_at | TIMESTAMPTZ | NOT NULL | 下次重置时间 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 更新时间 |

**索引**：
- `uniq_user_quotas_user` UNIQUE ON (user_id)

**说明**：
- 默认配额与现有速率限制（20 次/分钟/IP）对齐，但维度从 IP 改为 user；
- `reset_at` 到期后由定时任务或惰性重置逻辑将 `quota_used` 归零并更新 `reset_at`；
- 未来计费系统可扩展此表支持付费配额、按量计费等模式。

##### 表 6：solutions（解题内容表，从文件系统迁移）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| content_hash | VARCHAR(64) | PK | 内容哈希（SHA-256，对应现有 FsHtmlCache 的 contentHash） |
| html_content | TEXT | NOT NULL | HTML 内容（LLM 原始输出） |
| validated | BOOLEAN | NOT NULL DEFAULT FALSE | 是否通过 CodeValidator 校验 |
| warning | TEXT | NULL | 校验警告信息 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |

**索引**：
- `idx_solutions_created` ON (created_at) — 用于清理过期内容

**说明**：
- 对应现有 `FsHtmlCache` 的 `content/{hash前2位}/{hash}.html` + `.json` 两文件合并；
- `html_content` 可考虑压缩存储（如 gzip）或大对象存储（远期优化）；
- 迁移阶段可保持双写（文件系统 + 数据库），验证一致性后切换读取源。

##### 表 7：primary_index（主索引表，platform+problemId → contentHash）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| platform | VARCHAR(50) | NOT NULL | 平台标识 |
| problem_id | VARCHAR(100) | NOT NULL | 题目标识 |
| content_hash | VARCHAR(64) | FK → solutions.content_hash, NOT NULL | 指向解题内容 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 更新时间 |

**索引**：
- `uniq_primary_index_platform_problem` UNIQUE ON (platform, problem_id)

**说明**：
- 对应现有 `FsHtmlCache` 的 `primary/{platform}_{problemId}.json` 文件；
- `(platform, problem_id)` 唯一约束保证一个题目对应一个内容哈希；
- 缓存更新时 upsert 此表。

##### 表 8：sample_index（样例指纹索引表，sampleFp → contentHash）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | BIGSERIAL | PK | 自增主键 |
| sample_fp | VARCHAR(64) | NOT NULL | 样例指纹（对应现有 SampleFingerprint） |
| sample_type | VARCHAR(20) | NOT NULL | 指纹类型：all / first（对应多候选） |
| content_hash | VARCHAR(64) | FK → solutions.content_hash, NOT NULL | 指向解题内容 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 创建时间 |

**索引**：
- `uniq_sample_index_fp_type` UNIQUE ON (sample_fp, sample_type)
- `idx_sample_index_fp` ON (sample_fp) — 支持按指纹查询

**说明**：
- 对应现有 `FsHtmlCache` 的 `sample/{fp前2位}/{fp}.json` 文件；
- `sample_type` 区分 `all` 与 `first` 两种候选指纹（参考 `fs-html-cache.ts` 的 `getCandidateFingerprints`）；
- 一个 `sample_fp` 可能对应多个 `content_hash`（多解法场景，参考 `spec-multi-solution-v1.0.md`），但当前实现为单映射，未来扩展时需调整约束。

#### 10.2.3 关系设计与索引策略汇总

**外键关系**：

```
sessions.user_id        → users.id
jobs.user_id            → users.id
usage_logs.user_id      → users.id
usage_logs.job_id       → jobs.id
user_quotas.user_id     → users.id  (UNIQUE)
solutions               (无外键，被引用)
primary_index.content_hash → solutions.content_hash
sample_index.content_hash  → solutions.content_hash
```

**索引策略**：

| 表 | 索引 | 类型 | 用途 |
|----|------|------|------|
| users | (provider, external_id) | UNIQUE | 登录时查询用户 |
| users | (email) | 普通 | 邮箱查询 |
| sessions | (user_id) | 普通 | 查询用户所有会话 |
| sessions | (expires_at) | 普通 | 清理过期会话 |
| jobs | (user_id, created_at DESC) | 普通 | 结果中继页面查询 |
| jobs | (status) | 普通 | 按状态筛选 |
| jobs | (user_id, status, created_at DESC) | 普通 | 组合筛选 |
| usage_logs | (user_id, created_at DESC) | 普通 | 用户用量查询 |
| usage_logs | (created_at) | 普通 | 全局统计 |
| user_quotas | (user_id) | UNIQUE | 配额查询 |
| primary_index | (platform, problem_id) | UNIQUE | 缓存主 key 查询 |
| sample_index | (sample_fp, sample_type) | UNIQUE | 缓存样例指纹查询 |
| sample_index | (sample_fp) | 普通 | 单字段查询 |

#### 10.2.4 数据同步机制

**会话同步**：

- 默认采用 `next-auth.js` JWT 策略，会话自包含，无需数据库查询（满足 NFR-002 < 5ms）；
- `sessions` 表用于审计与 SLO，由 `next-auth.js` events（`signIn` / `signOut`）回调写入；
- 强制下线时，将 `sessions.revoked_at` 置为当前时间，middleware 在 JWT 校验通过后额外检查此字段（需 Redis 缓存 revoked 列表，避免每次查库）。

**用量记录同步**：

- `/api/solve` POST 成功创建任务后，同步写入 `usage_logs` 一条记录（status 字段先留空，任务完成时更新）；
- 任务完成（`completeJob`）时更新 `usage_logs.llm_call_count` / `token_*` / `cached` 字段；
- 写入失败仅记日志不阻断主流程（NFR-004）。

**配额同步**：

- 提交任务前查询 `user_quotas`，校验 `quota_used < quota_limit`；
- 提交成功后 `quota_used += 1`（事务内完成，避免并发超卖）；
- `reset_at` 到期后，下次查询时惰性重置：`quota_used = 0`，`reset_at = next_reset_time`。

**HtmlCache 迁移同步**（阶段 3）：

- 阶段 1-2：保持现有 `FsHtmlCache` 不变，`primary_index` / `sample_index` / `solutions` 表暂不启用；
- 阶段 3：启用双写模式，`FsHtmlCache` 写入的同时写入数据库表；
- 双写稳定后（如运行 7 天无差异），切换读取源为数据库；
- 最终下线 `FsHtmlCache`，清理 `/var/learning/data/gesp6/` 文件。

---

## 11. 最佳方案推荐

### 11.1 推荐结论

**推荐方案：方案 B（现有程序 + SSO）**，使用 `next-auth.js` v5 作为认证框架。

### 11.2 推荐理由

| 维度 | 方案 B 优势 |
|------|------------|
| 规范契合 | 与 `dev-workflow.md` §五、`api-conventions.md` §三、`code-style.md` §五完全契合 |
| 计费基础 | 用量记录与配额校验在应用层自然实现，无需跨进程协作 |
| 用户深度集成 | sessionId / userId 在应用层全局可取，结果中继与用户隔离天然支持 |
| 部署简化 | 单 Next.js 进程，无额外组件，CI/CD 流水线无需调整 |
| 安全可控 | 认证逻辑内聚，无 Header 伪造风险，Cookie 配置完全可控 |
| 调试友好 | 认证日志与业务日志统一，问题定位高效 |
| 扩展灵活 | 多实例部署时可通过 Redis 共享会话，无需重构认证层 |

### 11.3 完整实施路径

```
┌─────────────────────────────────────────────────────────────┐
│ 阶段 1：SSO + 用户体系（基础）                                  │
│   - next-auth.js v5 集成（OIDC Provider）                      │
│   - middleware.ts 改造（会话校验 + 受保护路由）                  │
│   - users / sessions 表落地                                    │
│   - app/layout-client.tsx 包裹 SessionProvider                 │
│   - /login 页面 + 登录登出按钮                                  │
│   - CSP 调整（放行 IdP 域名）                                   │
│   验证：登录登出可用、受保护路由生效、Cookie 配置符合规范            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 阶段 2：结果中继页面                                            │
│   - jobs 表落地（关联 user_id）                                 │
│   - JobStore 改造（增加 userId 字段，双写数据库）                │
│   - /api/solve POST/GET/DELETE 增加 userId 校验                │
│   - /dashboard/jobs 页面（列表 + 分页 + 筛选）                  │
│   - /result 改造（优先从数据库读取，sessionStorage 兜底）         │
│   验证：历史任务可查、越权访问被拒、跨设备可查看                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 阶段 3：计费系统（远期）                                        │
│   - usage_logs / user_quotas 表落地                            │
│   - orchestrator.ts 用量埋点（llm_call_count / token）          │
│   - 提交前配额校验                                              │
│   - solutions / primary_index / sample_index 表落地            │
│   - FsHtmlCache → DbHtmlCache 迁移（双写 → 切换 → 下线）         │
│   验证：用量记录准确、配额生效、缓存迁移无丢失                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. 实施计划

### 12.1 阶段 1：SSO + 用户体系（基础）

| 项目 | 内容 |
|------|------|
| 目标 | 用户可通过 IdP 登录登出，受保护路由强制认证，会话管理符合规范 |
| 范围 | next-auth.js 集成、middleware 改造、users/sessions 表、/login 页面、CSP 调整 |
| 关键任务 | T1-1 调研 IdP 端支持的协议（OIDC/SAML）与端点；T1-2 引入 `next-auth.js` v5 依赖；T1-3 配置 OIDC Provider（含 PKCE）；T1-4 创建 users/sessions 表迁移脚本；T1-5 改造 `middleware.ts` 增加会话校验与白名单；T1-6 改造 `app/layout-client.tsx` 包裹 SessionProvider；T1-7 实现 `/login` 页面与登录登出按钮；T1-8 调整 `next.config.ts` CSP 放行 IdP 域名；T1-9 新增 SSO 相关环境变量至 `app/lib/env.ts` |
| 交付物 | next-auth.js 配置文件、users/sessions 迁移脚本、改造后的 middleware.ts、改造后的 layout-client.tsx、/login 页面、调整后的 next.config.ts、更新后的 env.ts |
| 验证标准 | AC-101：登录按钮可跳转 IdP 并回调成功；AC-102：登录后 Cookie 配置符合 `code-style.md` §五；AC-103：未登录访问 `/dashboard/*` 重定向 `/login?next=...`；AC-104：登录状态在所有页面可见；AC-105：登出后会话 Cookie 清除；AC-106：`npm run type-check` 与 `npm test` 通过；AC-107：`npm run lint` 无警告 |

### 12.2 阶段 2：结果中继页面

| 项目 | 内容 |
|------|------|
| 目标 | 用户可查看历史任务，任务记录跨设备可用，jobId 用户隔离生效 |
| 范围 | jobs 表、JobStore 改造、/api/solve userId 校验、/dashboard/jobs 页面、/result 改造 |
| 关键任务 | T2-1 创建 jobs 表迁移脚本；T2-2 `app/lib/job-store.ts` 增加 `userId` 字段，双写数据库（内存 + DB）；T2-3 `/api/solve` POST 创建任务时写入 userId；T2-4 `/api/solve` GET/DELETE 校验 userId 归属；T2-5 实现 `/dashboard/jobs` 页面（列表 + 分页 + 状态筛选）；T2-6 改造 `/result` 页面优先从数据库读取任务；T2-7 进行中任务轮询刷新；T2-8 单元测试覆盖越权场景 |
| 交付物 | jobs 迁移脚本、改造后的 job-store.ts、改造后的 solve/route.ts、/dashboard/jobs 页面及组件、改造后的 /result 页面、越权防护测试 |
| 验证标准 | AC-201：`/dashboard/jobs` 展示当前用户任务列表；AC-202：分页与状态筛选功能正常；AC-203：用户 A 持有用户 B 的 jobId 查询返回 403；AC-204：`/result?jobId=xxx` 跨设备可访问（登录后）；AC-205：进行中任务列表自动刷新；AC-206：`npm run test:e2e:critical` 通过；AC-207：任务记录软删除生效 |

### 12.3 阶段 3：计费系统（远期）

| 项目 | 内容 |
|------|------|
| 目标 | 用量数据完整记录，配额管控生效，HtmlCache 迁移至数据库 |
| 范围 | usage_logs/user_quotas/solutions/primary_index/sample_index 表、用量埋点、配额校验、HtmlCache 迁移 |
| 关键任务 | T3-1 创建 usage_logs/user_quotas 迁移脚本；T3-2 `orchestrator.ts` 增加 token 与 llm_call_count 埋点；T3-3 `/api/solve` POST 提交前校验配额；T3-4 实现配额惰性重置逻辑；T3-5 创建 solutions/primary_index/sample_index 迁移脚本；T3-6 实现 DbHtmlCache（数据库版 HtmlCache）；T3-7 启用双写（FsHtmlCache + DbHtmlCache）；T3-8 双写稳定后切换读取源；T3-9 下线 FsHtmlCache；T3-10 计费规则配置（费率表，远期） |
| 交付物 | usage_logs/user_quotas/solutions/primary_index/sample_index 迁移脚本、改造后的 orchestrator.ts、DbHtmlCache 实现、配额校验逻辑、HtmlCache 迁移脚本与验证报告 |
| 验证标准 | AC-301：每次提交任务生成 usage_logs 记录且字段完整；AC-302：超配额请求返回 429 + `GESP6_QUOTA_EXCEEDED`；AC-303：配额周期重置后 `quota_used` 归零；AC-304：DbHtmlCache 读取结果与 FsHtmlCache 完全一致；AC-305：双写阶段 7 天无差异后切换读取源成功；AC-306：FsHtmlCache 下线后所有缓存查询正常；AC-307：`npm run test:full` 通过 |

---

## 13. 风险评估

| 风险编号 | 风险 | 影响 | 概率 | 缓解措施 |
|---------|------|------|------|---------|
| R-001 | SSO IdP 故障 | 用户无法登录，已登录用户会话不受影响但无法续期 | 中 | 1) 登录页显示友好错误并支持重试；2) 已登录用户会话 JWT 自包含，IdP 短时故障不影响使用；3) 远期考虑 IdP 多副本或本地兜底账号 |
| R-002 | 多实例部署会话共享问题 | 多实例下会话状态不一致，用户被踢出登录 | 低（阶段 1-2 单实例） | 1) 默认 JWT 策略会话自包含，无共享问题；2) 多实例时引入 Redis 共享 session；3) `sessions` 表的 `revoked_at` 通过 Redis 缓存同步 |
| R-003 | 数据迁移风险（HtmlCache 迁移） | 缓存丢失或损坏，用户解题结果不可用 | 中 | 1) 双写阶段充分验证一致性；2) 保留 FsHtmlCache 作为兜底，切换读取源前不删除文件；3) 迁移脚本支持断点续传与回滚 |
| R-004 | CSP 调整风险 | IdP 域名未放行导致登录失败；调整过度引入安全漏洞 | 中 | 1) 调整前在测试环境完整验证登录流程；2) 仅放行必要的 IdP 域名与端点，最小化授权；3) 使用 `report-uri` 或 `report-to` 收集 CSP 违规报告 |
| R-005 | 性能影响 | 会话校验增加请求延迟；数据库写入用量记录拖慢响应 | 低 | 1) JWT 策略会话校验 < 5ms（NFR-002）；2) 用量记录异步写入，不阻塞主流程（NFR-004）；3) 配额查询走索引，开销 < 10ms |
| R-006 | 兼容性风险 | 现有匿名用户使用受阻；sessionStorage 结果传递失效 | 中 | 1) 灰度阶段匿名用户仍可访问 `/` 和 `/solve`（FR-041）；2) `/result` 改造后 sessionStorage 作为兜底（FR-028 + NFR-019）；3) 兼容性测试覆盖主流浏览器 |
| R-007 | 越权防护遗漏 | 用户可查询/操作他人任务 | 高（影响安全） | 1) 所有 jobId 查询强制校验 userId 归属；2) 单元测试覆盖越权场景（用户 A 持用户 B jobId）；3) E2E 测试包含越权用例；4) 代码评审强制检查 |
| R-008 | next-auth.js v5 升级风险 | v5 仍在演进，API 可能变化 | 中 | 1) 锁定具体版本；2) 关注官方迁移指南；3) 封装认证调用，便于后续替换 |
| R-009 | Edge Runtime 限制 | middleware 中无法使用部分 Node.js API 与重型依赖 | 中 | 1) 严格遵循 `dev-workflow.md` §六，middleware 仅用 `console`；2) next-auth.js v5 已适配 Edge Runtime；3) 不在 middleware 中查询数据库 |
| R-010 | Cookie `SameSite=lax` 与 OIDC 回调冲突 | 跨站回调时 Cookie 被丢弃，登录失败 | 中 | 1) OIDC 回调为同源请求（IdP 通过 302 重定向回 SP），`SameSite=lax` 兼容；2) 测试环境验证完整登录流程；3) 若有问题，回退至 `SameSite=none; Secure`（仅生产 HTTPS） |

---

## 14. 附录

### 14.1 环境变量清单（新增）

| 变量名 | 可见性 | 必填 | 默认值 | 说明 |
|--------|--------|------|--------|------|
| `AUTH_SECRET` | 服务端 | 是 | — | next-auth.js 签名密钥（用于 JWT 签名与会话加密） |
| `AUTH_TRUST_HOST` | 服务端 | 是 | `false` | 信任 Host header（生产设为 `true`，反向代理后必需） |
| `SSO_PROVIDER` | 服务端 | 是 | — | IdP 标识（如 `keycloak`、`authing`） |
| `SSO_ISSUER` | 服务端 | 是 | — | IdP OIDC issuer URL（如 `https://idp.example.com/realms/master`） |
| `SSO_CLIENT_ID` | 服务端 | 是 | — | OIDC client id |
| `SSO_CLIENT_SECRET` | 服务端 | 是 | — | OIDC client secret（若使用 PKCE 可选） |
| `SSO_SCOPES` | 服务端 | 否 | `openid profile email` | OIDC scopes |
| `SSO_WELL_KNOWN` | 服务端 | 否 | `${SSO_ISSUER}/.well-known/openid-configuration` | OIDC discovery 端点 |
| `DATABASE_URL` | 服务端 | 是（阶段 2 起） | — | 数据库连接串（PostgreSQL / MySQL） |
| `NEXT_PUBLIC_APP_URL` | 客户端 | 是 | — | 应用根 URL（用于 OIDC 回调地址拼接，如 `https://gesp6.example.com`） |
| `QUOTA_DEFAULT_DAILY` | 服务端 | 否 | `20` | 默认每日配额上限 |
| `QUOTA_RESET_HOUR` | 服务端 | 否 | `0` | 配额重置小时（UTC，0-23） |
| `SESSION_MAX_AGE_MINUTES` | 服务端 | 否 | `15` | 会话最大时长（分钟），对齐 `code-style.md` §五 |
| `SESSION_REMEMBER_ME_DAYS` | 服务端 | 否 | `7` | "记住我"时长（天） |
| `HTML_CACHE_DRIVER` | 服务端 | 否（阶段 3） | `fs` | 缓存驱动：`fs` / `db`（阶段 3 切换） |

> 遵循 `infra/env-management.md`：所有含敏感信息的变量（`AUTH_SECRET`、`SSO_CLIENT_SECRET`、`DATABASE_URL`）禁止使用 `NEXT_PUBLIC_` 前缀，仅服务端可见。

### 14.2 关键文件改造清单

| 文件路径 | 阶段 | 改造内容 |
|---------|------|---------|
| `package.json` | 1 | 新增 `next-auth@5` 依赖 |
| `app/lib/env.ts` | 1 | 新增 SSO 与数据库环境变量校验（参考现有 `requiredEnvVars` 模式） |
| `app/api/auth/[...nextauth]/route.ts` | 1 | 新增：next-auth.js 路由 handler |
| `app/lib/auth.ts` | 1 | 新增：next-auth.js 配置（OIDC Provider + JWT 策略 + 回调） |
| `middleware.ts` | 1 | 改造：增加 `getToken()` 会话校验，公开路由白名单，受保护路由重定向 |
| `app/layout-client.tsx` | 1 | 改造：包裹 `SessionProvider`，提供会话上下文 |
| `app/login/page.tsx` | 1 | 新增：登录页面，含登录按钮与错误展示 |
| `next.config.ts` | 1 | 改造：CSP `connect-src` 放行 IdP 域名 |
| `app/lib/db/client.ts` | 2 | 新增：数据库客户端（建议 Drizzle ORM 或 Prisma） |
| `app/lib/db/schema.ts` | 2 | 新增：表结构定义 |
| `app/lib/job-store.ts` | 2 | 改造：`JobRecord` 增加 `userId` 字段，双写数据库 |
| `app/api/solve/route.ts` | 2 | 改造：POST 写入 userId，GET/DELETE 校验归属 |
| `app/dashboard/jobs/page.tsx` | 2 | 新增：结果中继页面 |
| `app/dashboard/jobs/components/` | 2 | 新增：列表、分页、筛选组件 |
| `app/result/page.tsx` | 2 | 改造：优先从数据库读取，sessionStorage 兜底 |
| `app/lib/ai/services/orchestrator.ts` | 3 | 改造：增加 llm_call_count 与 token 用量埋点 |
| `app/lib/ai/services/db-html-cache.ts` | 3 | 新增：DbHtmlCache 实现（实现 `HtmlCache` 接口） |
| `app/lib/ai/services/html-cache.ts` | 3 | 改造：支持 driver 切换（fs / db） |
| `app/lib/quota/service.ts` | 3 | 新增：配额查询与扣减服务 |
| `app/lib/usage/service.ts` | 3 | 新增：用量记录服务 |

### 14.3 参考资料

#### 14.3.1 项目内文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 现有架构归档 | `docs/architecture/archived/arch-gesp6-web-html-v1.0.md` | 了解现有架构层次与边界 |
| 样例指纹缓存 Spec | `docs/specs/spec-sample-fingerprint-cache-v1.0.md` | 了解 FsHtmlCache 的 primary/sample 双 key 设计 |
| 多解法 Spec | `docs/specs/spec-multi-solution-v1.0.md` | 了解 sample_index 多候选支持 |
| HTML 本地文件缓存变更日志 | `docs/changelog/2026-06-30-HTML本地文件缓存.md` | 了解 FsHtmlCache 落地历史 |
| 日志排查指南 | `docs/operations/日志排查指南.md` | 了解现有日志规范 |
| 超时处理机制 | `docs/operations/超时处理机制与流程分析.md` | 了解任务超时处理 |

#### 14.3.2 项目内规范

| 规范 | 路径 | 相关章节 |
|------|------|---------|
| API 与服务层规范 | `.trae/rules/dev/api-conventions.md` | §三 LDAP 连接规范 |
| 组件与 UI 规范 | `.trae/rules/dev/component-rules.md` | UI 组件结构 |
| 开发流程规范 | `.trae/rules/dev/dev-workflow.md` | §五 middleware 认证、§六 日志规范 |
| 测试规范 | `.trae/rules/dev/testing-standards.md` | 测试类型与覆盖要求 |
| 代码风格规范 | `.trae/rules/global/code-style.md` | §五 Cookie 配置 |
| Git 提交规范 | `.trae/rules/global/git-commit.md` | 提交信息格式 |
| 更新日志规范 | `.trae/rules/global/changelog.md` | 结构化修改记录 |
| 环境变量管理 | `.trae/rules/infra/env-management.md` | 变量命名与文件约定 |
| 部署检查清单 | `.trae/rules/infra/deployment-checklist.md` | 安全与性能检查 |
| Spec 工作流 | `.trae/rules/spec/spec-workflow.md` | PRD approved 后拆分 Spec |
| Spec 模板 | `.trae/rules/spec/spec-template.md` | Spec 正文结构 |

#### 14.3.3 外部资料

| 资料 | 用途 |
|------|------|
| next-auth.js v5 官方文档 | 认证框架集成参考 |
| OIDC 规范（RFC 6749 + OpenID Connect Core 1.0） | 协议细节 |
| SAML 2.0 规范 | SAML 接入参考（FR-003 可选） |
| OWASP Authentication Cheat Sheet | 安全最佳实践 |
| Next.js App Router 文档 | middleware 与 RSC 集成 |
| PostgreSQL / MySQL 文档 | 数据库类型与索引优化 |

---

## 文档结束

> 本 PRD 为 draft 状态，待评审通过后转为 approved，并作为后续 Spec 拆分与架构设计的唯一输入依据。按 `.trae/rules/spec/spec-workflow.md`，PRD approved 后应拆分为以下 Spec：
>
> - `docs/specs/spec-sso-auth-v1.0.md`（覆盖 FR-001~FR-018，对应阶段 1）
> - `docs/specs/spec-user-dashboard-v1.0.md`（覆盖 FR-019~FR-033，对应阶段 2）
> - `docs/specs/spec-usage-metering-v1.0.md`（覆盖 FR-034~FR-044，对应阶段 3）
>
> 各 Spec 按工作流执行评审与修订，approved 后驱动开发实施。
