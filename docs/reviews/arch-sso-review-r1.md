# SSO 集成模块架构评审意见（第 1 轮）

**评审对象**：docs/architecture/arch-sso-v1.0.md（架构 v1.0，状态 draft）
**评审人**：nextjs-architecture-reviewer
**评审轮次**：第 1 轮
**日期**：2026-08-10
**评审结论**：**需修订**

## 总体评价

架构 v1.0 质量整体良好：FR 覆盖完整（auth FR-001~027、token FR-001~026 全部有落点）、技术选型与 package.json 一致、三项已确认业务决策（OQ-004/002/05）全部落地、token FR-017~020 的 N/A 标注理由合理。问题总数 11（阻塞 0 / 重要 3 / 建议 8），无阻塞项，3 项重要级问题集中在两层运行结构、登出数据流与状态双写语义，需修订后进入第 2 轮。

## 问题清单

### 重要级（3 项）

| 编号 | 维度 | 问题描述 | 依据 | 修复建议 |
|---|---|---|---|---|
| AR1-001 | 两层结构/安全 | SSO 上线后未认证请求绕过限流：middleware.ts 认证检查（L82-87）先于限流（L89-106），无效 cookie 请求直接 302、不消耗 20 次/min 配额；架构 §4.1.3 步骤 1-2 写「限流→认证」与现状顺序矛盾，且 §1.4 将「middleware 限流改造」列为边界外 | middleware.ts L82-106、arch §4.1.3/§1.4 | 明确 SSO 上线后 middleware 限流与认证的先后顺序，或明确是否将限流改造纳入实施范围，消除与现状的顺序矛盾 |
| AR1-002 | 数据流/登出 | end_session 提交方式自相矛盾：§4.1.5 步骤 4 要求 POST x-www-form-urlencoded（auth FR-019 防 id_token 进历史），步骤 5 却写「302→IDP end_session」；302 无法携带 POST body | arch §4.1.5 步骤 4-5、spec-sso-auth §3.5 FR-019 | 明确载体为 HTML form 自动提交页（POST），移除/修正「302」表述 |
| AR1-003 | 数据流/双写 | httpOnly 状态 cookie 与 sessionStorage 双写矛盾：auth FR-003（R2-003）要求状态 cookie httpOnly，但 httpOnly 使前端 `document.cookie` 读不到值；§4.1.1 步骤 1-3 未定义前端 sessionStorage 的数据来源与生成主体（服务端生成→前端读不到；前端生成→未描述提交路径） | spec-sso-auth §3.1 FR-003 R2-003、arch §4.1.1/AD-08 | 明确状态双写的数据流：前端生成的 code_verifier/state/nonce 如何传递到服务端（提交路径）或服务端如何把状态值提供给前端 |

### 建议级（8 项）

| 编号 | 维度 | 问题描述 | 依据 | 修复建议 |
|---|---|---|---|---|
| AR1-004 | 目录结构 | §6 标注 `app/middleware.ts`，Next.js 15 约定 middleware 必须在根目录或 src/（Context7 官方 `isAtConventionLevel` 源码确认），app/ 内不生效；现状在根目录 | arch §6、Next.js 15 约定 | 目录结构改为根目录 `middleware.ts` |
| AR1-005 | 技术选型 | jose 版本写「最新稳定（待选型确认）」，未锁定版本范围 | arch §3 | 锁定 jose 版本范围 |
| AR1-006 | 模块划分 | §2.2「M5→M2(JWKS 缓存) 或 独立 jose 验签」二选一未定，开发 agent 无法确定实现路径 | arch §2.2 | 明确唯一实现路径 |
| AR1-007 | 接口规范 | oauth-client 以自由函数导出，与 api-conventions「服务单例 `export const x = new X()`」不一致（DiscoveryService/TokenRefresher 均为 class） | api-conventions.md | 统一为服务单例导出 |
| AR1-008 | 目录职责 | refresh-sync.ts（localStorage 锁+BroadcastChannel 工具）置于 components/auth/ 下，component-rules 规定 components 放 UI 组件 | component-rules.md、arch §6 | 移至 lib/sso/ |
| AR1-009 | 国际化 | middleware 302 目标 `/login`（middleware.ts:86）与 `[locale]/login` 路由未对齐，重定向不含 locale 前缀可能 404/错页 | middleware.ts:86、app/[locale]/ 结构 | 明确 locale 前缀处理 |
| AR1-010 | 环境变量 | AD-12 未展开 mock 模式（SSO_MOCK_ENABLED=1）下 SSO_CLIENT_SECRET/SSO_ISSUER 是否仍为 validateEnv() 必填 | arch AD-12 | 明确 mock 模式下环境变量必填性 |
| AR1-011 | 安全前提 | 集成指南 §3.5 JWKS 仅规格化 id_token 验签，access_token 本地验签（AD-02/AD-07）复用同一 JWKS 的假设未显式声明 | 集成指南 §3.5、arch AD-02/AD-07 | 显式声明该假设并列入实施首日实测确认 |

## FR 覆盖核验表

**无遗漏**。auth FR-001~027、token FR-001~026 全部有架构落点。

token FR-017~020 标注 N/A（OQ-002 决策）：
- FR-017：本地 JWT 验签履行「确认 access_token 有效」义务性要求
- FR-018：不内省，无需 token_type_hint
- FR-019：无内省响应可消费
- FR-020：无内省调用即无失败路径，fail-closed 由本地验签失败默认拒绝承担，OQ-03 fail-open 例外不适用

理由合理，同意 N/A 处理。

## 技术选型核对表

**无不一致**。§3 表格版本与 package.json 逐项吻合（Next 15.1.6、TS ^5.7.3、zod ^3.24.1、lru-cache ^11.5.1、lucide-react ^1.21.0、cva ^0.7.1、tailwind-merge ^3.6.0、clsx ^2.1.1、Vitest ^3.0.0、@playwright/test ^1.61.1 等）。

**jose 为唯一新增运行时依赖**：集成指南 §2.4 明确推荐，Edge/Node 双兼容，合理。需在修订中锁定版本范围（AR1-005）。

## 已确认决策落地核验

| 决策 | 落地情况 |
|---|---|
| OQ-004（offline_access→30 天持久会话+refresh 轮换，SSO_REFRESH_TOKEN_MAX_AGE_DAYS 默认 30，FR-004~010 全量） | ✓ |
| OQ-002（仅 /api/solve 受保护+Node 本地验签不内省，FR-017~020 N/A 并注明理由） | ✓ |
| OQ-05（localStorage 锁+BroadcastChannel，M4/AD-05/AD-13） | ✓ |

**无未落地项。**
