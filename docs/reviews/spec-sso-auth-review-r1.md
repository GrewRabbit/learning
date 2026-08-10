# SSO 登录认证、会话与登出 评审意见 — 第 1 轮

**评审对象**：spec-sso-auth-v1.0.md（v1.0，draft）
**评审时间**：2026-08-10
**评审结论**：需修订

## 问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| R1-001 | §3.7、§5 第 12 条、OQ-010 | 与 spec-sso-token-v1.0.md（同为 draft）范围重叠且错误码冲突：§3.7 声称 3 个错误码与 token spec FR-025 清单一致属实，但速率限制与会话失效两类语义在两份 spec 中命名不同（本 spec 的 AUTH_RATE_LIMITED / AUTH_SESSION_EXPIRED vs token spec 的 AUTH_IDP_RATE_LIMITED / AUTH_TOKEN_EXPIRED + AUTH_SESSION_INVALID），且本 spec 未收录 token FR-025 中的其余 6 个错误码；两份 spec 并存违反 spec-workflow.md「任意时刻只存在一份有效 spec」原则 | 阻塞 | 本轮必须明确划界或合并策略，不得仅以 OQ-010 挂起：(a) 若合并——将两份 spec 合并为一份完整 SSO spec，错误码表合并为单一事实来源；(b) 若独立演进——在 §3.7 声明错误码归属边界（token 生命周期类错误码归 token spec，登录流程专属错误码归本 spec），删除或标注冲突命名，并在两文件互相引用划界条款；未裁决前不得进入架构设计 |
| R1-002 | §2 US-002、FR-016、FR-018、§5 第 10 条 | 续期流程与 middleware 登录态判定存在内部矛盾：FR-016 以「cookie 存在且未过期」判定登录态（过期即视为未登录），而 FR-018 的续期触发条件是「受保护请求返回 401 时」——middleware 对过期会话返回的是重定向（302 至 /login）而非 401，/api/solve 场景下续期永不触发，用户将每 15 分钟被迫重新登录，与 US-002「自动续期、不频繁重登」直接冲突 | 阻塞 | 补一条 FR 或改写 FR-016 / FR-018，明确三层衔接：① middleware 校验深度（仅 cookie 存在性 vs 含 exp 解析）；② 受保护 API 的会话校验与过期续期在 Node 运行时执行（401/会话失效语义由 SP 内部定义，非依赖 IDP 401）；③ 或采纳「提前 60 秒主动续期」（token spec FR-004）作为唯一续期路径并规定浏览器端发起渠道；三种方案择一写入 spec，消除 US-002 与 FR-016 的矛盾 |
| R1-003 | FR-002、FR-003、FR-011 ⑧ | nonce 生命周期缺口：FR-002 生成 nonce、FR-004 要求 authorize 请求携带 nonce、FR-011 ⑧ 要求回调时校验 nonce 与 authorize 请求一致，但 FR-003 仅持久化 code_verifier 与 state——回调时服务端无法恢复 nonce，步骤 ⑧ 校验不可实现；另 nonce 长度未规格化（集成指南 §4.1 步骤 1 为 32 字符） | 重要 | FR-003 持久化范围扩展为 code_verifier + state + nonce（沿用双写容错），或显式规定 nonce 恢复机制；并在 FR-002 补充 nonce 长度要求（≥ 32 字符，加密随机源） |
| R1-004 | FR-016、§4 NFR | 未声明 Edge Runtime 约束下的校验边界与密钥安全：middleware 运行于 Edge（现状注释明确禁 Node 原生模块、仅 Web API），若在 middleware 中引用 SSO_CLIENT_SECRET 执行刷新/内省，Next.js 会将其内联进 Edge bundle（泄露风险）；FR-016「真实校验」未限定校验深度（仅解码 exp vs JWKS 验签 vs 委托 Node 端校验接口） | 重要 | 在 FR-016 或新增 NFR 中明确：middleware 禁止引用任何服务端 SSO 密钥环境变量；middleware 层校验深度限定为 cookie 存在性 / JWT 解码级，需验签或续期的深度校验一律在 Node 运行时（Route Handler / 服务层）完成；若需 middleware 做 JWKS 验签，须声明每次请求拉取 JWKS 的性能代价与缓存策略 |
| R1-005 | FR-006、FR-010 | 授权响应错误参数无处理需求：集成指南 §3.2 定义 IDP 以 error 参数回跳（含用户拒绝 consent 的 access_denied）及 400/401 JSON 错误；FR-006 仅覆盖 code/state/iss 缺失，FR-010 仅覆盖令牌交换失败，用户拒绝授权场景无对应错误码与用户提示要求 | 建议 | FR-006 补充回调含 error 参数时的分类处理：access_denied → 友好提示并清除一次性登录状态；其他 error → 归入 AUTH_LOGIN_IDP_ERROR；并补对应 AC |
| R1-006 | FR-009 | 令牌交换响应的 token_type 校验缺失：集成指南 §3.3 AI 执行清单要求 token_type 大小写不敏感比较（OIDC 规范化为小写） | 建议 | FR-009 补充「校验响应 token_type 为 Bearer（大小写不敏感）」，或标注由 token spec 覆盖（随 R1-001 划界决策） |
| R1-007 | FR-015 | 会话 cookie 未声明 path=/，与 token spec FR-001 / FR-002 的 cookie 属性描述不一致 | 建议 | FR-015 三个 cookie 补充 path=/，并与 token spec 的 cookie 属性定义保持单一描述来源 |
| R1-008 | FR-010、§3.7 | 用户可见错误文案脱敏缺失：FR-026 仅约束日志，未约束面向用户的错误提示不得含 client_secret / IDP 内部错误细节（token spec FR-026 有等价要求） | 建议 | 新增或引用要求：面向用户的错误仅返回错误码与安全通用文案，不泄露 IDP 内部错误码与配置细节；并补 AC |
| R1-009 | NFR-003、AC-033 | E2E 的 IDP 模拟策略未声明：@smoke 覆盖「登录→受保护接口→登出」依赖 IDP 行为，但 spec 未说明如何在不依赖真实 IDP 的情况下执行（集成指南 §2.1 提供 SSO_MOCK_ENABLED=1 本地 mock 模式） | 建议 | NFR-003 或 AC-033 明确 E2E 的 IDP 模拟方式（本地 mock IDP / Playwright route 拦截二选一），确保 @smoke / @no-llm 可离线稳定执行 |
| R1-010 | FR-014、NFR-001 | Discovery 拉取位置未明确：若在浏览器端拉取 Discovery/JWKS/UserInfo，将违反 next.config.ts 现有 CSP connect-src 'self'（浏览器无法直连 IDP 域名） | 建议 | 明确 Discovery/JWKS/UserInfo 调用全部在服务端执行（与 FR-009 服务端令牌交换一致），或声明同步调整 CSP；推荐前者 |
| R1-011 | §5 边界与排除项 | SAML/WS-Fed 与 Front-Channel Logout 未显式排除：集成指南 §1.6 声明 frontchannel_logout_supported=false，FCL 与 BCL 同属登出域易混淆 | 建议 | §5 补充：「不实现 SAML/WS-Fed 认证（协议不在集成指南范围）；不实现 Front-Channel Logout（IDP 不支持，§1.6）」 |
| R1-012 | FR-025 | 429 重试次数上限未规格化：集成指南 §6.5 定义网络错误/5xx 指数退避最多 3 次、429 按 Retry-After 等待；FR-025 仅要求「指数退避重试」，未限重试上限，存在放大限流风险 | 建议 | FR-025 补充重试上限（如最多 3 次）与退避边界，与集成指南 §6.5 一致 |
| R1-013 | FR-006~FR-009、FR-019 | 用户可控输入（回调参数、登出参数）未显式要求 Zod 输入验证：全局代码规范要求所有用户输入在 Server Actions 经 Zod 验证，spec 仅 FR-023 覆盖 returnTo 重定向校验 | 建议 | 在回调、登出处理需求处引用输入验证规范（Zod schema 校验参数格式与长度），与 FR-023 并列 |

## 评审总结

**总体评价**：结构完整（模板必备章节齐全），FR-001~FR-027 / AC-001~AC-033 / US / OQ 编号连续；每个 FR 均标注集成指南依据或源码现状，可追溯性良好；未照搬集成指南示例代码（仅引用契约/端点/安全约束）；未混入技术选型、模块划分、数据模型等架构设计内容；错误码格式符合 MODULE_CATEGORY_SPECIFIC；§5 边界与 §6 开放问题处理规范，未越权代替需求方做业务决策；安全覆盖（PKCE / state / id_token 8 步 / Cookie 标志 / 开放重定向 / 轮换 / client_secret / 限流 / 日志脱敏）与集成指南 §5 逐项对应。

**本轮需修订的核心方向**：

1. **双 spec 冲突裁决**（R1-001）：两份 SSO spec 均处于 draft 且范围重叠、错误码命名冲突，违反唯一有效 spec 原则，本轮必须给出划界或合并结论，不能仅以 OQ-010 挂起；
2. **续期流程内部矛盾**（R1-002）：US-002（自动续期）与 FR-016（过期即未登录）在 middleware 语义下互斥，需补齐续期触发衔接需求；
3. **nonce 持久化缺口**（R1-003）与 **Edge Runtime 约束未声明**（R1-004）为实施前必须明确的规格空白。

**低优先调整**：模板顺序偏移（§6 开放问题先于 §7 验收标准）不影响完整性，可于下轮修订时微调。

**结论**：需修订。存在 2 项阻塞与 2 项重要问题，修订方向见上表 R1-001~R1-004；修订后进入第 2 轮评审。
