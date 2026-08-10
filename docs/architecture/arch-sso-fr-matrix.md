# SSO 集成模块 FR 覆盖矩阵（arch-sso-v1.2 附属文件）

**归属**：`docs/architecture/arch-sso-v1.2.md` §10（R-13 拆分计划落地）
**版本**：v1.2（2026-08-10，draft）
**目的**：auth FR-001~027、token FR-001~026 逐条架构落点；主文档 §10.1 保留模块↔FR 摘要表，本文件为完整矩阵。
**修订标注**：v1.1 因评审修订（AR1-xxx）改变的落点以「（v1.1）」标注；v1.2 因评审修订（AR2-xxx）改变的落点以「（v1.2）」标注，其余继承 v1.1。

## 1. auth spec（spec-sso-auth-v1.2，FR-001~FR-027）

| FR | 需求 | 架构落点 |
|----|------|----------|
| FR-001 | 登录入口触发 SP-Initiated Auth Code+PKCE | §4.1.1、M7 `login-button.tsx` → form POST `/api/sso/authorize`（v1.1：POST 提交） |
| FR-002 | code_verifier≥43 + S256 challenge；state≥32；nonce≥32 | §4.1.1 步骤 1、`lib/sso/pkce.ts`（前端生成，同构实现） |
| FR-003 | 状态持久化 sessionStorage+cookie 双写；服务端写状态 cookie | §4.1.1 步骤 2/4（前端写 sessionStorage、服务端写 httpOnly cookie，AR1-003 闭环）、`pkce.ts` + `token-cookie.ts` |
| FR-004 | authorize 必带参数 | §4.1.1 步骤 5、`lib/sso/oauth-client.ts`（URL 构造） |
| FR-005 | returnTo 持久化与恢复 | §4.1.1 步骤 2/4、§4.1.2 步骤 9、M7；**returnTo 入服务端状态 cookie `sso_return_to`（10min 一次性，服务端读，AR2-004 v1.2）**；开放重定向校验见 FR-023 |
| FR-006 | 回调参数校验/缺失 400；error 分类 | §5.3 callback、`lib/sso/schemas.ts`（含 authorize 提交参数）、`AUTH_LOGIN_MISSING_PARAMS`/`AUTH_LOGIN_IDP_ERROR` |
| FR-007 | state 比对（一次性） | §4.1.2 步骤 3、`AUTH_LOGIN_STATE_MISMATCH` |
| FR-008 | iss 校验（RFC 9207） | §4.1.2 步骤 4、`AUTH_LOGIN_ISS_MISMATCH` |
| FR-009 | 令牌交换仅服务端；token_type 须 Bearer | §4.1.2 步骤 5、`lib/sso/oauth-client.ts`、`AUTH_TOKEN_EXCHANGE_FAILED` |
| FR-010 | 交换失败 invalid_grant 处理；脱敏提示 | §4.2 异常流、`AUTH_TOKEN_EXCHANGE_FAILED` |
| FR-011 | id_token 8 步验证；VERIFY_MODE | §4.1.2 步骤 6、`lib/sso/id-token-verifier.ts`、`AUTH_ID_TOKEN_INVALID` |
| FR-012 | JWKS 缓存 1h；kid 未命中重试 | §3、`lib/sso/discovery-service.ts`（id_token/access_token 共用） |
| FR-013 | userinfo + sub 一致性；401 触发续期 | §4.1.2 步骤 7、`lib/sso/oauth-client.ts` |
| FR-014 | 端点取 Discovery；服务端执行 | §4.1.2、`lib/sso/discovery-service.ts`、`AUTH_IDP_DISCOVERY_FAILED` |
| FR-015 | 三 cookie 写入（属性） | §4.1.2 步骤 8、`lib/sso/token-cookie.ts` |
| FR-016 | 两层校验分层 | §4.1.3、middleware.ts（Edge 粗检，根目录 AR1-004）+ M5（Node 深校验） |
| FR-017 | 会话失效两路径 | §4.1.3 步骤 2、§4.1.4 步骤 4a、`AUTH_SESSION_INVALID`/`AUTH_TOKEN_INVALID_GRANT` |
| FR-018 | 续期触发衔接 | §4.1.3 步骤 5、§4.1.4、`lib/sso/token-refresher.ts` |
| FR-019 | 登出编排顺序；end_session POST form | §4.1.5、`lib/sso/logout-service.ts`（form 自动提交页，AR1-002 v1.1） |
| FR-020 | revoke 失败不阻断 | §4.1.5 步骤 2、`AUTH_TOKEN_REVOKE_FAILED` |
| FR-021 | end_session 回跳 state 校验；200 fallback | §4.1.5 步骤 5（v1.1：IDP 302/307 回跳，移除 302 提交表述） |
| FR-022 | post_logout_redirect_uri 白名单 | §4.1.5 步骤 4、`lib/sso/config.ts` |
| FR-023 | 开放重定向防御 | §8.2 安全 #5、`lib/sso/schemas.ts` 共享工具、`AUTH_LOGOUT_REDIRECT_INVALID` |
| FR-024 | client_secret 保护 | §7.2、R-03、§8.2 安全 #7 |
| FR-025 | IDP 限流重试两路径 | §4.1.4 步骤 4、`lib/sso/oauth-client.ts` 重试器、`AUTH_IDP_RATE_LIMITED` |
| FR-026 | 日志/提示脱敏 | §8.2 安全 #9、§8.4 |
| FR-027 | 环境变量分组 | §7.2、`lib/env.ts` 扩展（含 mock 分支，AR1-010 v1.1） |

## 2. token spec（spec-sso-token-v1.2，FR-001~FR-026）

| FR | 需求 | 架构落点 |
|----|------|----------|
| FR-001 | access_token cookie 属性与生命周期 | §4.1.2 步骤 8、§5 `token-cookie.ts`；初始写入归 auth FR-015 |
| FR-002 | refresh_token cookie 30 天可配置 | §7.2 `SSO_REFRESH_TOKEN_MAX_AGE_DAYS`（默认 30，OQ-004/OQ-01 确认） |
| FR-003 | 会话超时分层 + fail-closed | §4.1.3、middleware.ts（Edge）+ M5（Node）；JWKS 复用假设见 AD-02/R-11（AR1-011 v1.1） |
| FR-004 | 刷新触发（60s/401） | §4.1.4、`token-refresher.ts` |
| FR-005 | 单飞（同上下文 + 跨标签页） | §4.1.4 步骤 1-2、M4 `lib/sso/refresh-sync.ts`（OQ-05 落地，AR1-008 v1.1 迁址；**v1.2：广播仅「刷新完成」信号不传 token，他标签页主动调 /api/sso/refresh 或清前端 sessionStorage，AR2-003**） |
| FR-006 | 刷新成功立即替换 | §4.1.4 步骤 3（**v1.2：随响应 Set-Cookie 替换，后台异步无法写 cookie，AR2-002**） |
| FR-007 | 旧 refresh 立即失效 | §4.1.4 步骤 3 |
| FR-008 | 刷新响应无 id_token 不更新 | §4.1.4 步骤 3 |
| FR-009 | invalid_grant 处理 + 安全告警 | §4.1.4 步骤 4a、`AUTH_TOKEN_INVALID_GRANT` |
| FR-010 | 刷新失败分类（invalid_client/429/退避） | §4.1.4 步骤 4b/c |
| FR-011 | 登出 revoke access+refresh | §4.1.5 步骤 1 |
| FR-012 | revoke 仅 SP 后端转发 | §4.1.5 步骤 1、§8.2 安全 #7 |
| FR-013 | revoke 失败不阻断 | §4.1.5 步骤 2 |
| FR-014 | revoke 200 不作有效性判定 | §4.1.5 步骤 2（RFC 7009） |
| FR-015 | end_session 参数与编排 | §4.1.5 步骤 4-5（编排归 auth FR-019~21；v1.1：form POST 载体，AR1-002） |
| FR-016 | 白名单/开放重定向归 auth | §4.1.5（不重复规格化） |
| FR-017 | 受保护操作前确认 access_token 有效 | **N/A（OQ-02）**：义务性要求由本地 JWT 验签履行（AD-02）；不实现内省端点调用 |
| FR-018 | introspect 带 token_type_hint | **N/A（OQ-02）**：不内省，无需 hint；IDP 缺陷 R1-010 不构成影响 |
| FR-019 | active:true/false 判定 | **N/A（OQ-02）**：无内省响应消费；放行判定由本地验签结果承担 |
| FR-020 | 内省失败 fail-closed | **N/A（OQ-02）**：无内省调用即无失败路径；fail-closed 语义由本地验签失败默认拒绝承担；OQ-03（fail-open 例外）不适用 |
| FR-021 | client_secret 仅服务端 | §7.2、§8.2 安全 #7 |
| FR-022 | 日志脱敏 | §8.2 安全 #9 |
| FR-023 | IDP 限流 | §4.1.4 步骤 4、`oauth-client.ts` 重试器 |
| FR-024 | SSO 端点限流 | §8.2 安全 #8（限流先于认证，AR1-001 v1.1；**v1.2：/api/sso/* 豁免认证粗检仅限流 AR2-001 + 页面级 SSO 路径不扩展 matcher 的归属决策 AR2-012**；matcher 保持现状，OQ-10 说明） |
| FR-025 | 错误码清单（7 个） | §5.4 |
| FR-026 | 用户可见文案不泄露 | §5.4、§8.2 安全 #9 |

## 3. 维护说明

- 本文件与主文档 `arch-sso-v1.2.md` 同步演进；FR 落点变更须同步更新主文档 §10.1 索引与本文件对应行；
- N/A 标注（token FR-017~020）为 OQ-002 决策结果，理由经 arch-sso-review-r1 核验认可；
- 主文档行数约束（≤500 行）为拆分动因（R-13），后续修订超限时优先拆分 §4 数据流。
