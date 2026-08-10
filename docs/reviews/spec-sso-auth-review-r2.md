# SSO 登录认证、会话与登出 评审意见 — 第 2 轮

**评审对象**：spec-sso-auth-v1.1.md（v1.1，draft）
**评审时间**：2026-08-10
**评审结论**：需修订

## 一、上轮问题核对（R1-001 ~ R1-013）

| 编号 | 上轮严重程度 | v1.1 解决状态 | 说明 |
|------|------------|--------------|------|
| R1-001 | 阻塞 | 部分解决 | 划界声明已落地（§5 第 12 条、§3.7 归属边界、§7 OQ-010），但 `AUTH_LOGIN_INVALID_CREDENTIALS` 出现两份 spec 互指、无事实来源的残留（见 R2-001） |
| R1-002 | 阻塞 | 部分解决 | 三层衔接已补（FR-016 middleware 深度限定、FR-018 Node 层续期、提前 60 秒主动续期采纳），但 FR-016 / FR-017 / AC-019 的"过期→续期"边界语义仍不一致（见 R2-002） |
| R1-003 | 重要 | 已解决 | nonce 纳入持久化（FR-003）、nonce 长度 ≥32 规格化（FR-002），AC-003 覆盖 |
| R1-004 | 重要 | 已解决 | FR-016/FR-024 明确 middleware 禁止引用 SSO 密钥环境变量、校验深度限定为 JWT 解码级，AC-018 静态检查覆盖 |
| R1-005 | 建议 | 已解决 | FR-006 补充 error 分类（access_denied → 友好提示；其他 → AUTH_LOGIN_IDP_ERROR），AC-006 覆盖 |
| R1-006 | 建议 | 已解决 | FR-009 补充 token_type 校验（大小写不敏感），AC-010 覆盖 |
| R1-007 | 建议 | 已解决 | FR-015 三个 cookie 均声明 path=/，AC-017 覆盖 |
| R1-008 | 建议 | 已解决 | FR-010/FR-026 约束面向用户文案仅返回错误码与安全通用文案，AC-030 覆盖 |
| R1-009 | 建议 | 已解决 | NFR-003/AC-033 明确本地 mock IDP（SSO_MOCK_ENABLED=1）或 Playwright route 拦截 |
| R1-010 | 建议 | 已解决 | FR-014 明确 Discovery/JWKS/UserInfo 全部服务端执行、不调整 CSP，AC-016 覆盖 |
| R1-011 | 建议 | 已解决 | §5 第 13 条补 SAML/WS-Fed 与 Front-Channel Logout 排除 |
| R1-012 | 建议 | 已解决 | FR-025 补重试上限 3 次，AC-029 覆盖 |
| R1-013 | 建议 | 已解决 | FR-006/FR-019 补 Zod 输入验证要求 |

**上轮解决率：11/13 已解决（84.6%），2 项部分解决（R1-001、R1-002），0 项未解决。**

## 二、问题清单（第 2 轮）

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R2-001 | §3.7 归属边界注释、§7 OQ-010、token spec FR-025 | `AUTH_LOGIN_INVALID_CREDENTIALS` 归属互指、无事实来源：本 spec §3.7 注释声称该码"以 token spec FR-025 为唯一事实来源"，而 token spec FR-025 声称"登录流程错误码清单以 spec-sso-auth §3.7 为事实来源"，但本 spec §3.7 表中并无该码；且 SSO 登录流程中凭证校验由 IDP 登录页承担，SP 侧不存在产生 invalid_credentials 的触发场景（疑为 LDAP 本地认证风格遗留码） | 重要 | 本 spec §3.7 明确声明"`AUTH_LOGIN_INVALID_CREDENTIALS` 不适用于 SSO 流程（凭证校验在 IDP 侧），本 spec 不收录"，并同步 OQ-010 表述；同时在变更记录标注该结论需 token spec 生成方在下一轮修订其 FR-025 的"两个 AUTH_LOGIN_*"表述 |
| R2-002 | FR-016、FR-017、AC-019 | "过期→续期"边界语义不一致：FR-016 规定 middleware 对 exp 过期 cookie 直接 302 重定向；FR-017 定义会话失效为"access_token 过期**且续期失败**"（暗示过期后可尝试续期）；AC-019 验收"过期且续期失败 → 清除 cookie 跳转登录"。按 FR-016 行为，exp 过期请求在 middleware 即被 302 拦截，Node 层续期（FR-018）在"已过期"场景不可达，"过期且续期失败"状态无法产生，AC-019 测试前提与 FR-016 矛盾；另"提前 60 秒主动续期"（token spec FR-004）的触发载体在本 spec 未说明（每请求进入 Node 层时检查剩余有效期？） | 重要 | 在 FR-016/FR-017 明确过期边界策略并统一表述，二选一：(a) 若"过期即重登"为设计意图——FR-017 改为"会话失效定义为 access_token 过期（不尝试续期）或 refresh_token 被撤销"，AC-019 删除"续期失败"前提；(b) 若"过期后静默续期"为设计意图——middleware 在 access_token 过期但存在 refresh_token cookie 时放行至 Node 层尝试续期（或 middleware 仅判 cookie 存在性），续期失败再 302。并补一句"Node 运行时在受保护请求进入时检查剩余有效期 <60 秒即触发续期（token spec FR-004 的落地点）" |
| R2-003 | FR-003、AC-003 | 状态 cookie 的 httpOnly 属性与写入方未明确：FR-003 仅说"状态 cookie 需满足安全标志要求（§4.1 步骤 2）"，未列明属性；集成指南步骤 2 称 cookie 为 httpOnly + sameSite=lax，但前端 JS 无法设置 httpOnly cookie（document.cookie 限制），集成指南示例 savePKCEParams 为前端函数，双写容错的前端写路径与 httpOnly 矛盾；code_verifier 为可兑换授权码的高敏凭据，其存储路径是安全关键决策；AC-003 仅断言 sameSite=lax，未覆盖 httpOnly | 重要 | FR-003 明确状态 cookie 属性与写入方，二选一：(a) 状态 cookie 由服务端（登录发起 API）设置 httpOnly + sameSite=lax，sessionStorage 由前端写入，双写语义为"服务端读 cookie、前端读 sessionStorage"；(b) 若保持前端写入，须显式声明状态 cookie 非 httpOnly 并说明 XSS 场景下 code_verifier 暴露的接受风险（不建议）。AC-003 按所选方案同步断言 httpOnly |
| R2-004 | FR-019 | 登出时 id_token_hint 缺失/失效的 client_id 回退路径未规格化：集成指南 §3.8 身份校验逻辑第 2 条与 AI 清单第 2 条要求"若无 id_token_hint，传 client_id + post_logout_redirect_uri"；本 spec FR-019 仅要求携带 id_token_hint、post_logout_redirect_uri、state，未覆盖 sso_id_token cookie 丢失/验签失败场景，此时 IDP 无法确认 RP 身份（§3.8 逻辑 3 → 400），IDP 端会话无法清除 | 建议 | FR-019 补充"id_token_hint 不可用或验签失败时，携带 client_id 参数回退（§3.8 身份校验逻辑 2）"，并补对应 AC |
| R2-005 | FR-005 | returnTo 的持久化与恢复机制未规格化：集成指南 §4.1 步骤 2 有 saveReturnTo(returnTo)（cookie 存储，回调后恢复）；本 spec FR-005 仅说"支持携带 returnTo，登录成功后跳回"，未定义 returnTo 与 PKCE 状态一并持久化及回调后的恢复来源，实现时易遗漏导致回跳失效 | 建议 | FR-005 补充"returnTo 与 code_verifier/state/nonce 一并持久化（沿用 FR-003 机制），回调认证成功后再恢复并校验（FR-023）" |
| R2-006 | FR-019、FR-021 | 登出 state 的生成与回传校验未定义：集成指南 §3.8 定义 state 为"原样回传的 CSRF 串"（SP 生成、IDP 307 回传）；本 spec FR-019 要求携带 state 但未定义其生成（集成指南示例为 16 字符，与登录 state ≥32 不同）与回传后的校验，FR-021 仅说"正确跟随" | 建议 | FR-019/FR-021 补充登出 state 的生成要求（加密随机源，长度与登录 state 对齐 ≥32 或按集成指南示例）及回传校验（不一致时仍视为登出完成、不跳转第三方） |
| R2-007 | FR-019 | end_session 提交方式未限定，id_token_hint 含 PII 不宜走 URL query：id_token 含 sub/name 等 PII，若以 GET query 提交（集成指南 §3.8 示例含 GET 方式），id_token_hint 将进入浏览器历史与服务器访问日志；集成指南 §3.8 同时支持 POST（form）方式；next.config.ts 现有 Referrer-Policy strict-origin-when-cross-origin 可缓解 Referer 泄露但无法缓解日志/历史 | 建议 | FR-019 明确 end_session 以 POST（application/x-www-form-urlencoded）方式提交参数（§3.8 Content-Type 处理表），避免 id_token_hint 进入 URL |
| R2-008 | FR-006 | access_denied 依据标注与集成指南不符：集成指南 §3.2 错误响应表与 §6.1 标准错误码表均未收录 access_denied；FR-006 引入"error=access_denied（用户拒绝授权）"分类并标注"依据：§3.2、§4.1"，引用不实（access_denied 实为 RFC 6749 §4.1.2.1 标准错误，IDP consent 拒绝场景，集成指南错误表遗漏） | 建议 | FR-006 的 access_denied 依据改为"RFC 6749 §4.1.2.1 标准错误（集成指南错误表未收录，为 OAuth 标准行为补充）"，或列入开放问题请业务/IDP 侧确认实际回调行为 |
| R2-009 | FR-025 | 429 与指数退避两条重试路径的上限表述合并易误读：集成指南 §6.5 仅对网络错误/5xx 限定"最多 3 次"，429 仅要求"按 Retry-After 等待后重试"（未限定次数）；FR-025 将"重试上限 3 次"合并表述，可能被实现为"429 也最多 3 次"——虽为合理强化，但与契约对应关系不清晰 | 建议 | FR-025 拆分为两条路径分别表述：429 按 Retry-After 精确等待后重试（重试上限与 token spec FR-010 约定一致或明确 3 次）；网络错误/5xx 指数退避最多 3 次 |
| R2-010 | FR-016、§5 第 6 条 | Node 运行时层深度校验对象表述错误：FR-016 写"受保护 API 的深度校验（id_token 验签或内省，fail-closed）"——id_token 有效期 30 天（FR-015），其验签仅能证明身份、无法证明 access_token 未过期/未被撤销，不能作为受保护 API 的有效性校验手段；且与 §5 第 6 条"本 spec 不消费 introspection 内省端点"矛盾（内省归 token spec FR-017~FR-020），与 token spec FR-017"受保护操作放行前必须确认 access_token 有效（本地 JWT 校验或内省）"的语义不一致 | 重要 | FR-016 改为"Node 运行时层——受保护 API 的深度校验为 access_token 的本地 JWT 验签（验签 + iss/aud/exp 结构性校验，fail-closed），或按 token spec FR-017~FR-020 的内省分工执行（本 spec 不重复定义内省细节）"，消除与 §5 第 6 条及 token spec FR-017 的矛盾 |

## 三、评审总结

**总体评价**：v1.1 已解决 r1 评审 13 项中的 11 项（解决率 84.6%），两项阻塞问题（R1-001 双 spec 冲突、R1-002 续期矛盾）经划界声明与三层衔接修订后已大幅缓解，但各残留一处边界不一致（R2-001、R2-002）。本轮未发现阻塞级问题，存在 4 项重要与 6 项建议。

**各维度结论**：

1. **完整性**：模板必备章节齐全（背景/用户故事/FR/NFR/边界/AC/开放问题/变更记录），FR-001~027、AC-001~033、US-001~005、OQ-001~010、NFR-001~006 编号连续；§6/§7 章节顺序已按 r1 意见修正。
2. **可追溯性**：每个 FR 均标注集成指南章节或源码现状依据，未发现超范围需求；FR-006 的 access_denied 依据引用不实（R2-008）。
3. **准确性**：授权码+PKCE 流程、端点契约（Discovery/Authorize/Token/UserInfo/Revoke/End Session）、cookie 属性、8 步 id_token 验证、scope→claim（仅消费 sub）均与集成指南一致；FR-016 深度校验对象错误（R2-010）。
4. **第三方对齐**：SP-Initiated 全流程与集成指南 §4.1/§4.3.1 逐步骤一致；登出身份校验的 client_id 回退路径缺失（R2-004）；access_denied 分类超出集成指南错误表（R2-008）。
5. **可测试性**：AC 均标注测试方式并映射 V-xxx 条目，@smoke/@no-llm 离线策略明确（本地 mock IDP + route 拦截）；AC-019 的测试前提与 FR-016 行为矛盾（R2-002）。
6. **边界清晰度**：§5 第 1-13 条完整（SAML/FCL/IdP-Initiated/DPoP/PAR/BCL/DCR/introspect/LDAP/groups/限流/多实例/双 spec 划界）；错误码分区制基本清晰，但 AUTH_LOGIN_INVALID_CREDENTIALS 归属互指（R2-001）。
7. **合规性**：错误码格式符合 MODULE_CATEGORY_SPECIFIC；未照搬集成指南示例代码；未混入模块划分/数据模型等架构设计；未代替需求方做业务决策（业务缺口均列 OQ）；符合 spec-workflow 评审角色约束。
8. **一致性**：FR↔AC 分组一一对应无冗余遗漏；FR-016/FR-017/AC-019 过期语义不一致（R2-002）；FR-016 与 §5 第 6 条内省边界矛盾（R2-010）。
9. **安全性**：PKCE/state CSRF/nonce 持久化/id_token 8 步/Cookie 标志/client_secret 保护/开放重定向/日志脱敏/速率限制覆盖完整；缺口为状态 cookie（含 code_verifier）的 httpOnly 属性与写入方未定（R2-003，重要）与 end_session 的 id_token_hint PII 泄露风险（R2-007）。
10. **现状对齐**：middleware.ts 匿名钩子切换、Edge Runtime 密钥约束、限流参数与 /api/health 白名单、env.ts 扩展方向、next.config.ts CSP connect-src 'self'（服务端拉取 IDP 端点）均与源码现状一致。

**本轮需修订的核心方向**：优先处理 4 项重要问题——R2-001（AUTH_LOGIN_INVALID_CREDENTIALS 归属裁决）、R2-002（过期/续期边界统一，涉及 FR-016/FR-017/AC-019 联动改写）、R2-003（状态 cookie 写入方与 httpOnly 决策）、R2-010（FR-016 深度校验对象修正）；6 项建议级问题（R2-004~R2-009）可同轮一并修订。

**结论**：需修订。存在 4 项重要级问题（R2-001、R2-002、R2-003、R2-010），修订后进入第 2 轮修订（产出 v1.2）。
