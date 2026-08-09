# SSO 专项 Spec 阶段调度 Prompt 方案 评审意见 — 第 1 轮

**评审对象**：`docs/Spec阶段调度prompt方案-SSO专项.md`（v1.0，调度 prompt 方案，非 spec 正文）
**评审时间**：2026-08-10
**评审角色**：nextjs-spec-reviewer
**评审结论**：需修订

---

## 一、评审元信息

| 项 | 值 |
|----|----|
| 评审对象 | docs/Spec阶段调度prompt方案-SSO专项.md（v1.0） |
| 评审轮次 | r1 |
| 评审时间 | 2026-08-10 |
| 评审依据 | AI-Prompt使用规范（§3.1/§4.1/§5.5/§8.2/§9.3/§11.5）、.opencode/rules/spec/spec-workflow.md、.opencode/rules/spec/spec-template.md、SSO IDP SP 集成指南（§0.2 等必读章节）、现有源码现状 |
| 评审结论 | **需修订** |
| 问题统计 | 阻塞 1 / 重要 6 / 建议 8，共 15 项 |

---

## 二、逐维度结论

### 维度 1：结构完整性 — 通过（1 项建议）

§5.5.1 要求的必备章节核对：
- 任务拆分方案：§一 ✓
- 调度架构：§二 ✓
- Prompt 模板：§五-§八（Prompt A/B/C/D）✓
- 执行顺序：§九 ✓
- 关键设计要点：§十 ✓
- 文件清单：§十一 ✓
- 模板中的「参考项目读取流程（共用）」章节被 §四「背景知识」替代（含 4.2 方案输入文件表，其中集成指南按 §0.2 按需加载）——属合理适配（本项目以集成指南替代参考项目体系），但未显式说明替代理由，见 SR1-015。

### 维度 2：模板规范性 — 通过

Prompt A/B/C/D 均遵循 §3.1 标准格式：角色声明 / 任务描述 / 必读规则文件 / 输入文件 / 输出 / 硬性约束 / 验收标准 / 返回格式齐全（Prompt D 为总调度自查模板，与 §4.1.4 一致，无子 agent 返回格式属正常）。错误处理为 §3.2 可选章节（⚠️），方案在 §九 调度层统一覆盖，符合规范。

### 维度 3：参数表齐全性 — 存在 1 重要 + 1 建议

- 占位符一致性：Prompt A 使用的 {SPEC_NAME} / {SLUG} / {FRAMEWORK_SECTIONS} / {BUSINESS_INPUT_FILE} / {SOURCE_CONTEXT} / {PROJECT_ROOT} 均在参数填充表有值且两 spec 行齐全 ✓；Prompt B/C 的 {ROUND} / {VERSION} / {PREV_ROUND} / {CURRENT_VERSION} / {NEXT_VERSION} 均覆盖 ✓
- 缺口：Prompt D 使用 {SPEC_NAME} / {SLUG} / {FRAMEWORK_SECTIONS} 但无参数填充表，违反 §9.3「每个 Prompt 模板有对应参数填充表」，见 SR1-005
- 注：{BUSINESS_INPUT_FILE} 指向 docs/sso-business-goals.md，实际磁盘不存在，方案已以「如存在，否则省略并标注」兜底 ✓，但建议 §二 前置条件同步检查，见 SR1-010

### 维度 4：路径准确性 — 通过

实际打开核对（P8 版本一致）：
- 集成指南 docs/integration-guides/sso-idp-sp-integration-guide.md 存在 ✓
- 规则文件 .opencode/rules/spec/spec-template.md、spec-workflow.md、global/naming-conventions.md、global/code-style.md、INDEX.md 均存在 ✓
- 源码 middleware.ts、app/lib/env.ts、next.config.ts、app/api/solve/route.ts、app/layout.tsx、app/layout-client.tsx 均存在 ✓
- 集成指南章节号全部核实存在且标题匹配：§1.5（Scopes 与 Claims）、§1.6（IDP 能力声明）、§2（前置条件）、§3.1（Discovery）、§3.2（Authorize）、§3.3（Token）、§3.4（UserInfo）、§3.6（Introspect 内省）、§3.7（Revoke 撤销）、§3.8（End Session 登出）、§4.1（SP-Initiated 授权码+PKCE 核心流程）、§5（安全要求）、§5.6（Refresh Token 轮换）、§7（集成验证）——无不存在章节 ✓（章节分配与 §0.2 能力映射的偏差见维度 10 SR1-002/003/012/013）

### 维度 5：评审轮次控制 — 通过

- 强制满 2 轮明确声明（头部元信息 + §三 + §九 Step 2/4 + Prompt B 评审结论注意事项）✓
- 终审仅核查 r1/r2 阻塞问题、不发现新问题（§三 表格 + Prompt D 硬性约束 4）✓
- 轮次上限 2，仍阻塞 → blocked 人工介入，不进入第 3 轮（§三 + §九 Step 6 + Prompt D 任务 4）✓
- r2 评审必须逐条核对 r1 问题解决状态并给出解决率（§三 + Prompt B 硬性约束 5）✓
- 版本递增 v1.0→v1.1→v1.2 与修订绑定 ✓（但重命名执行细节有缺陷，见 SR1-001/004/011）

### 维度 6：角色隔离 — 通过

- reviewer 只输出意见文件、禁止修改 spec 正文（Prompt B 硬性约束 1、§三 表格）✓
- generator 只生成/修订、禁止新建版本文件（Prompt C 硬性约束 1）✓
- 终审由总调度执行（Prompt D 适用角色、§二 阶段6）✓
- 子 agent 不互相通信（§二 调度原则「单点决策」）✓

### 维度 7：合规声明 — 存在 2 重要 + 1 建议

- 禁止照搬示例代码（T12 生成侧）：Prompt A 硬性约束 1「禁止照搬集成指南的示例代码，仅参考协议/端点/安全约束」✓
- 缺口：Prompt B 评审维度 5「合规性」未含「是否照搬集成指南示例代码」检查项（评审侧防线缺失），见 SR1-006
- 缺口：Prompt C 修订原则未含禁止照搬约束，见 SR1-009
- 源码限定范围（P2）：Prompt A 输入文件 4 显式「禁止通读全量源码，仅读取与 SSO 集成直接相关的文件」✓；Prompt B/C 仅以 {SOURCE_CONTEXT} 列表隐含限定，未显式声明，见 SR1-007

### 维度 8：安全声明 — 通过（1 项建议）

Prompt A 硬性约束 10 完整覆盖评审要求的 7 项：PKCE 强制（code_challenge_method=S256）✓、state ≥ 32 字符随机串 + 校验（CSRF）✓、id_token 验证（签名/iss/aud/exp/nonce，strict 模式）✓、Cookie httpOnly + secure（生产）+ sameSite=lax ✓、client_secret 仅服务端（禁止 NEXT_PUBLIC_ 前缀）✓、开放重定向防御（白名单校验）✓、日志不输出 Token / Session ID ✓。
建议补充（集成指南 §5.4/§5.7/§5.8 存在但方案未列）：Cookie maxAge（access_token 15 分钟）、速率限制（429 + Retry-After）、前端禁止直连 token 端点，见 SR1-008。

### 维度 9：上下文隔离 — 存在 1 重要

- Prompt A：显式「仅读取上述章节，禁止全量加载（92KB 大文档）」✓（T2/T3）
- 缺口：Prompt B/C/D 的集成指南输入仅写「对照章节 / 核对章节」，未显式声明「禁止全量加载」，存在上下文爆炸风险（§8.4 上下文预算），见 SR1-007
- §二 调度原则「最小上下文」与 §四 4.2 方案输入文件表「92KB 大文档禁止全量」✓

### 维度 10：方案文档自洽性 — 存在 1 阻塞 + 3 重要 + 3 建议

- 交叉引用核对：§一→§5.3.4、§二→§5.1.3、§三→§5.5.3、§六→§11.2、§八→§4.1.4、§九→§5.4 / §5.4.3、§十→T5/T6/T7/T9/T10/T12/P2/P8 全部有效 ✓
- 阻塞：Prompt C 操作要求缺文件重命名步骤，与 §一/§九/§十一 产出假设矛盾（SR1-001）
- 重要：sso-token 章节分配缺 §4.2/§4.3（SR1-002）；sso-auth 缺 §4.3/§3.5（SR1-003）；版本策略与 T7 冲突（SR1-004）
- 建议：文件清单单文件语义标注（SR1-011）；§7 验证章节分配（SR1-012）；§3.6 用途说明（SR1-013）
- 两 spec 划分（登录/会话/登出 vs Token 生命周期与安全强化）符合 §5.3.4 可独立验收原则 ✓，但章节分配与 §0.2 能力分布存在上述偏差

### 维度 11：与项目现状一致性 — 通过

全部实际核对属实：
- docs/prd/ 为空（0 条目），「无 approved PRD」属实 ✓
- 无 /login 页面（app/ 下仅 page.tsx、solve/page.tsx、result/page.tsx）✓
- 无会话存储（app/lib 下无 session 相关文件）✓
- 无 SSO 环境变量（app/lib/env.ts 仅 AI_* 相关变量）✓
- middleware.ts：isAuthenticated 匿名模式返回 true、PROTECTED_API_PREFIX='/api/solve'、未认证重定向 /login、Edge Runtime 约束（无 logger/无 Node 原生模块）均属实 ✓
- next.config.ts：CSP 含 frame-src 'none'、connect-src 'self' 属实 ✓
- app/lib/env.ts：validateEnv() + 模块级缓存 envValidated 属实 ✓
- 技术栈：package.json next 15.1.6、typescript ^5.7.3、zod ^3.24.1、openai、tailwindcss ^3.4.17 属实 ✓

---

## 三、问题清单

| 编号 | 位置 | 问题描述 | 严重程度 | 修订建议 |
|------|------|---------|---------|---------|
| SR1-001 | §七 Prompt C「操作要求」 | Prompt C 操作要求仅含「在原文件修订 / 内部版本号更新 / 变更记录加行 / 状态保持 draft」，**缺「将文件重命名为 spec-{SLUG}-v{NEXT_VERSION}.md」步骤**；而 §一 输出列、§九 Step 3/4/5 产出验证（spec-v1.1 存在）、§十一 文件清单均假设文件名随版本更新。子 agent 按 Prompt C 执行后将产出 spec-{SLUG}-v1.0.md（内部版本 v1.1），Step 3 产出验证必然失败，重发 2 次仍失败 → blocked，闭环无法推进到 r2 | 阻塞 | 在 Prompt C「操作要求」新增步骤：「将文件重命名为 {PROJECT_ROOT}/docs/specs/spec-{SLUG}-v{NEXT_VERSION}.md（重命名后仅存最新版本文件）」；同步在「验收标准」增加「文件名已更新为 v{NEXT_VERSION}」；§九 Step 3/5 产出验证保留「文件名与内部版本号一致」检查 |
| SR1-002 | §一 功能域拆分表 / §五 Prompt A 参数表 {FRAMEWORK_SECTIONS}（sso-token 行） | sso-token 覆盖范围声明「access_token 续期（refresh_token 轮换）、token 撤销」，但 FRAMEWORK_SECTIONS 仅 §3.3、§3.6、§3.7、§5.6、§7，**缺过程层章节 §4.2（Token 续期 Refresh Token Rotation）与 §4.3（Token 撤销与登出）**；与集成指南 §0.2「实现 Token 续期：§3.3.2、§4.2、§5.6」「实现登出：§3.7、§3.8、§4.3」的能力映射不符，生成器将无法读到续期/撤销的完整流程契约（含轮换失败处理、重放检测、撤销不阻断登出等约束） | 重要 | 将 sso-token 的 {FRAMEWORK_SECTIONS} 调整为「§3.3、§3.6、§3.7、§4.2、§4.3、§5.6、§7」（§3.3 可细化至 §3.3.2 与 §0.2 一致）；同步更新 §一 功能域拆分表引用列 |
| SR1-003 | §一 功能域拆分表 / §五 参数表（sso-auth 行） | sso-auth 覆盖范围含「RP-Initiated 登出」，但 FRAMEWORK_SECTIONS 缺 **§4.3（Token 撤销与登出，§4.3.1 SP-Initiated Logout 为登出完整流程）与 §3.5（JWKS 公钥端点，§0.2 核心登录流程必读，id_token 验签必需）**；登出流程契约（revoke + 清除 cookie + 跳转 end_session + 白名单校验）与验签依赖将缺失 | 重要 | 将 sso-auth 的 {FRAMEWORK_SECTIONS} 调整为「§1.5、§1.6、§2、§3.1、§3.2、§3.3、§3.4、§3.5、§3.7、§3.8、§4.1、§4.3、§5」（与 §0.2 核心登录流程 + 登出映射对齐）；同步更新 §一 引用列 |
| SR1-004 | §三「版本与文件规则」/ §十一 说明 | 方案采用「文件名带版本号 + 每轮修订重命名文件（v1.0→v1.1→v1.2）」，与 AI-Prompt 规范 §8.2 T7「始终单文件，文件名不变，版本号写在文件内部」直接冲突；且对 spec-workflow.md §四「版本号写在文件内部」与 §二 命名规范（文件名含 v[major].[minor]）的解读张力未说明取舍依据，存在规则遵从性争议 | 重要 | 在 §三 或 §十一 显式声明取舍依据：「本项目以 spec-workflow.md §二 命名规范（文件名含版本号）为准，单文件 + 每轮重命名，任意时刻仅存一份；与 AI-Prompt 规范 T7『文件名不变』的差异为有意选择（便于评审轮次与文件版本一一对应）」。若选择遵循 T7，则需同步修改 §一/§九/§十一 全部文件路径为固定文件名 |
| SR1-005 | §八 Prompt D | Prompt D 使用 {SPEC_NAME}、{SLUG}、{FRAMEWORK_SECTIONS} 占位符，但**无参数填充表**，违反 §9.3 检查清单「参数表齐全：每个 Prompt 模板有对应参数填充表」 | 重要 | 为 Prompt D 补充参数填充表（值同 Prompt A：sso-auth / sso-token 两行），或在 §八 注明「参数与 Prompt A 参数表一致，复用」 |
| SR1-006 | §六 Prompt B「评审维度」5 合规性 | 合规性维度仅含「违反 spec-workflow.md 的 MUST/MUST NOT；混入架构设计；错误码格式」，**缺「是否照搬集成指南示例代码」检查项**；Prompt A 已声明禁止照搬（生成侧），但评审侧（对应 T12 的防线）缺失，照搬违规可能漏网 | 重要 | 在 Prompt B 评审维度 5 增加子项：「是否照搬集成指南示例代码（应仅体现契约 / 端点 / 安全约束，禁止代码级照搬）」；同步在 Prompt A 验收标准增加对应可验证项 |
| SR1-007 | §五/§六/§八 各 Prompt「输入文件」 | 集成指南「禁止全量加载（92KB）」的显式声明**仅存在于 Prompt A**；Prompt B/C/D 的集成指南输入仅写「对照章节 / 核对章节」，未声明禁止全量，存在上下文爆炸风险（§8.4 预算）；且 Prompt B/C 的源码输入未显式声明「仅读取列出的文件，禁止通读全量源码」（P2 仅覆盖 Prompt A） | 重要 | 在 Prompt B/C/D 的集成指南输入统一追加「仅读取上述章节，禁止全量加载（92KB 大文档，按 §0.2 按需加载）」；在 Prompt B/C 源码输入追加「仅读取上述文件，禁止通读全量源码」 |
| SR1-008 | §五 Prompt A「硬性约束」10 | 安全约束覆盖评审要求的 7 项（PKCE / state / id_token / Cookie / client_secret / 重定向 / 日志脱敏），但**未覆盖集成指南 §5.4 Cookie maxAge（access_token 15 分钟）、§5.8 速率限制（429 + Retry-After + 指数退避）、§5.7 前端禁止直接调用 token 端点（必须 SP 后端转发）** | 建议 | 在硬性约束 10 补充：Cookie 含 maxAge（access_token 15 分钟）；SSO 端点速率限制（429 + Retry-After + 指数退避）；token 交换 / 撤销必须经 SP 后端转发，前端不得直接调用 IDP 端点 |
| SR1-009 | §七 Prompt C「修订原则」 | 修订原则未含「禁止照搬集成指南示例代码」约束；修订阶段生成器可能按评审意见重写 FR 时引入示例代码 | 建议 | 在 Prompt C 修订原则增加：「修订内容同样禁止照搬集成指南示例代码，仅参考契约」 |
| SR1-010 | §二「前置条件检查」 | 前置条件仅检查集成指南存在 + 无 approved PRD，**未含「业务集成目标文件（docs/sso-business-goals.md）存在性」检查**；仅 §九 Step 1 提及，两处不一致 | 建议 | 在 §二 前置条件增加：「确认 docs/sso-business-goals.md 是否存在；不存在则省略输入并标注业务缺口为开放问题」 |
| SR1-011 | §十一 文件清单 | 文件清单以三行分别列出 spec-{SLUG}-v1.0.md / v1.1.md / v1.2.md，与说明「同一文件随版本重命名」并存，易误解为三个文件同时存在（与 spec-workflow.md §四 单文件原则的观感冲突） | 建议 | 在文件清单表头或说明处加注「三行为同一物理文件在不同轮次的版本名，任意时刻仅存一份」；或将三行合并为一行「docs/specs/spec-{SLUG}-v{major}.{minor}.md（单文件，随修订重命名 v1.0→v1.2）」 |
| SR1-012 | §一 功能域拆分表 / §五 参数表 | §7（集成验证）仅分配给 sso-token；但 §7.1.1 V-001~V-015 多为 SP-Initiated 登录流程验证（Discovery / authorize / token / id_token / userinfo / cookie 标志），属 sso-auth 范畴，分配失衡 | 建议 | 将 §7 同时纳入 sso-auth 的 {FRAMEWORK_SECTIONS}（或注明按 §7.1.x 子节拆分：sso-auth 读 7.1.1 / 7.1.3，sso-token 读 7.1.2 / 7.1.3） |
| SR1-013 | §五 参数表（sso-token 行） | §3.6（Introspect 内省）未出现在集成指南 §0.2 的能力映射表中（§0.2 仅映射续期 / 登出 / 验证等流程），方案将其纳入 sso-token 属自定义扩展，未说明用途（如会话超时有效性校验） | 建议 | 在参数表旁或 §一 覆盖范围注明 §3.6 用途（如「用于会话有效性内省校验」），或经 §0.2 确认后补充映射说明 |
| SR1-014 | 头部元信息 / §十二 版本历史 | 方案声明「依据 AI-Prompt 使用规范 v2.9」与规范文件头（v2.9）一致 ✓；但规范自身 §12.2 版本历史仅记录至 v2.5，缺 v2.6-v2.9 记录，属规范侧维护缺口，方案引用时无法核对 v2.6-v2.9 的变更内容 | 建议 | 无需修改方案正文；建议总调度知悉该缺口，并在规范补充版本历史后回查 §4.1 / §5.5 等引用章节是否有 v2.6-v2.9 变更影响本方案（如 §5.5.3 提前通过规则） |
| SR1-015 | §四「背景知识」 | §5.5.1 调度方案模板含「三、参考项目读取流程（共用）」章节；本方案以 §四「背景知识」（项目现状 + 方案输入文件表）替代，功能上覆盖（集成指南按 §0.2 按需加载），但未显式说明替代模板章节的理由 | 建议 | 在 §四 开头加一句说明：「本方案以集成指南替代参考项目体系，原『参考项目读取流程』章节对应实现为 §四 4.2 方案输入文件表（按集成指南 §0.2 按需加载）」 |

---

## 四、评审结论

**需修订**：存在 1 个阻塞级问题（SR1-001，Prompt C 缺重命名指令导致流水线卡死）与 6 个重要级问题（SR1-002~SR1-007），不满足「通过」条件。

---

## 五、评审总结

### 5.1 整体评价

本方案整体质量较高：§5.5.1 必备章节齐全、Prompt A/B/C/D 符合 §3.1 标准格式、强制满 2 轮与终审约束清晰、角色隔离与上下文隔离设计完整、全部路径 / 章节号 / 源码现状经实际核对属实（11 个维度中 7 个维度直接通过）。方案对「无 approved PRD」的需求基线处理（集成指南 + 业务目标 + 源码现状）与项目现状完全一致。

### 5.2 核心问题

1. **执行链路断裂（阻塞）**：Prompt C 的操作要求未包含文件重命名步骤，与调度流程各阶段的产出假设（v1.1 / v1.2 文件存在）矛盾，将导致 r1 修订后流水线卡死于产出验证。这是本轮唯一阻塞项，修订一行即可解决。
2. **章节分配与 §0.2 能力映射偏差（重要 ×2）**：sso-token 缺 §4.2 / §4.3、sso-auth 缺 §4.3 / §3.5，将直接导致生成器缺失续期 / 撤销 / 登出 / 验签的过程层契约，spec 内容覆盖不完整。
3. **规则遵从性争议（重要）**：版本文件策略（文件名带版本号 + 重命名）与 AI-Prompt 规范 T7（文件名不变）冲突，需显式声明取舍依据。
4. **评审 / 隔离声明覆盖不全（重要 ×2）**：Prompt B 缺「照搬示例代码」评审检查项；P2「禁止全量加载」声明未覆盖 Prompt B/C/D。
5. **Prompt D 缺参数表（重要）**：违反 §9.3「每个 Prompt 模板有对应参数填充表」。

### 5.3 修订方向

1. Prompt C 操作要求补文件重命名步骤（SR1-001）；
2. 按 §0.2 映射修正两个 spec 的 {FRAMEWORK_SECTIONS}（SR1-002 / SR1-003）；
3. §三 / §十一 声明版本策略取舍依据（SR1-004）；
4. Prompt D 补参数表或注明复用（SR1-005）；
5. Prompt B 合规维度补照搬检查；B/C/D 补禁止全量加载声明（SR1-006 / SR1-007）；
6. 建议级问题（SR1-008~SR1-015）酌情采纳。

> 注：按本方案「强制满 2 轮」要求，即使本轮修订后问题清零，仍需执行 r2 评审；本评审意见文件归档后禁止修改。
