# 代码审核阶段 循环调度 Prompt 方案

> **用途**：总调度 agent 指挥子 agent 对现有项目进行循环式代码审核的标准化 prompt
> **范围**：全量源码审核（app/、components/、lib/、services/、middleware.ts、next.config.ts 等）
> **循环策略**：B 模式评审-修订闭环，最多 4 轮（轮1全面审核 → 轮2修订 → 轮3复审 → 轮4终审）
> **版本**：v1.0
> **创建时间**：2026-07-06
> **依据规范**：[AI-Prompt 使用规范 v2.5](./AI-Prompt使用规范.md) + next-best-practices skill + `.trae/rules/`

---

## 一、任务拆分方案

| 阶段 | 任务 | 目标 Agent | 输入 | 输出 | 优先级 |
|------|------|-----------|------|------|:----:|
| 轮 1 | 全量代码审核（8 维度） | nextjs-code-reviewer | 全量源码 + 规范文件 | `docs/reviews/code-review-full-r1.md` | P0 |
| 轮 2 | 修订实施（按 r1 问题清单） | nextjs-frontend-expert / nextjs-backend-expert | r1 评审文件 + 待修复文件 | 修复后的代码 + git commit | P0 |
| 轮 3 | 复审（核对 r1 + 新发现） | nextjs-code-reviewer | 修订后代码 + r1 评审文件 | `docs/reviews/code-review-full-r2.md` | P0 |
| 轮 4 | 终审决议 | 总调度自行执行 | r2 评审文件 + 最终代码 | 终审决议报告 | P0 |

**轮次控制**：
- 默认走满 4 轮
- 若轮 3 复审无阻塞问题 → 提前进入轮 4 终审，状态置为 approved（按 [§5.5.3 提前通过](./AI-Prompt使用规范.md)）
- 若轮 3 仍有阻塞 → 轮 4 仅决议是否需要再修订，最多追加 1 轮修订，仍阻塞则标记 blocked

---

## 二、调度架构

```
[启动] 总调度
  │
  ├─ [轮1: 全面审核] 调度 1× nextjs-code-reviewer
  │     ├─ 加载 .trae/rules/* + next-best-practices skill
  │     ├─ 全量扫描源码（8 维度）
  │     └─ 产出: docs/reviews/code-review-full-r1.md（问题清单）
  │
  ├─ [轮2: 修订实施] 总调度拆分 r1 问题 → 并行调度多个 dev agent
  │     ├─ 阻塞级问题 → nextjs-backend-expert / nextjs-frontend-expert
  │     ├─ 重要级问题 → 同上
  │     ├─ 建议级问题 → 总调度判断是否修复（可推迟）
  │     ├─ 修复后运行验证：tsc / lint / test / build
  │     ├─ 按规范生成更新日志（如触发条件）→ docs/changelog/
  │     └─ 提交 git（中文提交信息，引用 r1 问题编号）
  │
  ├─ [轮3: 复审] 调度 1× nextjs-code-reviewer
  │     ├─ 核对 r1 阻塞/重要问题是否解决
  │     ├─ 扫描修订引入的新问题
  │     └─ 产出: docs/reviews/code-review-full-r2.md
  │
  └─ [轮4: 终审] 总调度自行执行
        ├─ 核对 r2 是否仍有阻塞
        ├─ 决议：approved / blocked
        └─ 输出终审报告（直接回复，不写文件）
```

---

## 三、审核维度清单（8 维度）

> 每轮审核 agent 必须按以下维度逐项检查。**轮 1 全量覆盖**，**轮 3 仅核对 r1 遗留 + 修订引入的新问题**。

### 维度 1：架构合理性（P0）

- 模块边界清晰，无跨层调用（如 components/ 直接调用数据库）
- 依赖方向正确（app → services → data access）
- 单一职责：每个模块/文件职责单一
- 目录结构符合 [.trae/rules/dev/dev-workflow.md](../.trae/rules/dev/dev-workflow.md) 和 [.trae/rules/dev/component-rules.md](../.trae/rules/dev/component-rules.md)
- Server Component / Client Component 划分合理（[§7.1.2 N1](./AI-Prompt使用规范.md)）

### 维度 2：规范一致性（P0）

- 符合 `.trae/rules/global/*` 全部约束
- 符合 `.trae/rules/dev/*` 全部约束
- Server Action 流程：Zod 验证 → 服务层 → revalidatePath（[api-conventions.md](../.trae/rules/dev/api-conventions.md)）
- 错误码格式：`MODULE_CATEGORY_SPECIFIC`
- 服务层单例导出：`export const userService = new UserService()`

### 维度 3：类型安全（P0）

- [§7.1.1 Q1-Q4](./AI-Prompt使用规范.md)：`npx tsc --noEmit` 退出码 0
- 禁止 `any`（[G1](./AI-Prompt使用规范.md)）
- 禁止 `@ts-ignore` / `@ts-expect-error`（[G8](./AI-Prompt使用规范.md)）
- 所有函数显式声明返回类型
- `tsconfig.json` 中 `strict: true`（[G9](./AI-Prompt使用规范.md)）

### 维度 4：安全合规（P0）

- 所有用户输入经 Zod 验证（[§7.3.4](./AI-Prompt使用规范.md)）
- 无硬编码密钥/Token/连接字符串（[G4](./AI-Prompt使用规范.md)）
- 日志无敏感信息（Token/密码/Session ID）（[G5](./AI-Prompt使用规范.md)）
- Cookie 配置：httpOnly + secure(生产) + sameSite=lax（[code-style.md](../.trae/rules/global/code-style.md)）
- `dangerouslySetInnerHTML` 必须净化（[G7](./AI-Prompt使用规范.md)）
- 客户端组件不直接调用数据库（[G6](./AI-Prompt使用规范.md)）
- next.config.ts 安全头齐全（CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy）
- middleware.ts 路由保护正确

### 维度 5：Next.js 最佳实践（P1）

> **加载 next-best-practices skill 全部子文档作为审核依据**：

- **RSC 边界**：async client component 检测、non-serializable props 检测（rsc-boundaries.md）
- **Async API**：Next.js 15+ 的 async params/searchParams/cookies/headers（async-patterns.md）
- **运行时选择**：默认 Node.js，Edge 仅用于 middleware（runtime-selection.md）
- **指令使用**：`'use client'` / `'use server'` / `'use cache'` 正确（directives.md）
- **数据模式**：避免数据瀑布（Promise.all / Suspense / preload）（data-patterns.md）
- **Route Handler**：与 page.tsx 冲突检测、与 Server Action 选型（route-handlers.md）
- **Metadata**：静态/动态 metadata、OG image、文件式 metadata（metadata.md）
- **图片**：`next/image` 优先、remote images 配置、sizes、blur、priority（image.md）
- **字体**：`next/font`、Google/Local fonts、Tailwind 集成（font.md）
- **打包**：server-incompatible packages、CSS imports、ESM/CommonJS（bundling.md）
- **脚本**：`next/script`、inline script id、加载策略（scripts.md）
- **Hydration**：browser APIs、dates、invalid HTML（hydration-error.md）
- **Suspense 边界**：CSR bailout 检测（useSearchParams / usePathname）（suspense-boundaries.md）
- **并行/拦截路由**：`@slot` 模式、default.tsx、router.back()（parallel-routes.md）
- **自托管**：`output: 'standalone'`、cache handler（self-hosting.md）

### 维度 6：性能（P1）

- Bundle 体积合理（按需加载、Tree Shaking、动态导入非首屏组件）
- 数据获取并行化（Promise.all、流式渲染）
- CSR bailout 风险（useSearchParams / usePathname 需 Suspense 包裹）
- LCP/CLS/FID 指标（如可测量）
- 缓存策略合理（revalidatePath / unstable_cache）

### 维度 7：可维护性（P1）

- 命名规范符合 [.trae/rules/global/naming-conventions.md](../.trae/rules/global/naming-conventions.md)
- 单文件 ≤ 500 行；页面文件 ≤ 300 行（[G3](./AI-Prompt使用规范.md)）
- 导入规范：`@/` 绝对路径，禁止跨模块 `../`（[G2](./AI-Prompt使用规范.md)）
- 公共 API 有 JSDoc 注释（[§7.2.3](./AI-Prompt使用规范.md)）
- 无显而易见/被注释掉的代码（[§7.2.3 禁止](./AI-Prompt使用规范.md)）
- 图标统一 lucide-react（[G10](./AI-Prompt使用规范.md)）

### 维度 8：测试覆盖（P2）

- 核心业务逻辑有测试
- 测试覆盖 spec 中的 AC 验收标准
- E2E 仅覆盖关键流程，边界条件由单元测试覆盖（[testing-standards.md](../.trae/rules/dev/testing-standards.md)）
- 测试文件命名：`[name].test.ts`

---

## 四、Prompt A — 轮 1 全面审核

### 一、通用模板

```
你是 nextjs-code-reviewer，任务：对项目进行第 {ROUND} 轮全量代码审核。

【必读规则文件】（按顺序加载，禁止跳过）
1. {PROJECT_ROOT}/.trae/rules/INDEX.md — 规则索引，按角色加载具体规则
2. {PROJECT_ROOT}/.trae/rules/global/code-style.md — 代码风格与安全
3. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范
4. {PROJECT_ROOT}/.trae/rules/global/git-commit.md — Git 提交规范（用于核对历史提交）
5. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md — 开发流程
6. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md — API 与服务层规范
7. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md — 组件与 UI 规范
8. {PROJECT_ROOT}/.trae/rules/dev/testing-standards.md — 测试规范
9. {PROJECT_ROOT}/.trae/rules/infra/env-management.md — 环境变量管理
10. {PROJECT_ROOT}/.trae/rules/infra/deployment-checklist.md — 部署检查清单

【必加载 Skill】
- next-best-practices（Next.js 最佳实践，含 RSC 边界/async API/数据模式/路由/图片/字体等全部子文档）
  调用方式：通过 Skill 工具加载，逐项核对所有子章节

【输入文件】
1. 全量源码（按目录扫描）：
   - {PROJECT_ROOT}/app/**/*.{ts,tsx}
   - {PROJECT_ROOT}/components/**/*.{ts,tsx}
   - {PROJECT_ROOT}/lib/**/*.{ts,tsx}
   - {PROJECT_ROOT}/services/**/*.{ts,tsx}
   - {PROJECT_ROOT}/middleware.ts
   - {PROJECT_ROOT}/next.config.ts
   - {PROJECT_ROOT}/tsconfig.json
   - {PROJECT_ROOT}/package.json
   - {PROJECT_ROOT}/.env.example（如存在）
   - 其他 {PROJECT_ROOT} 根目录下的 .ts/.tsx 文件
2. {PROJECT_ROOT}/docs/AI-Prompt使用规范.md
   - 必读章节：§7 编码质量保障、§7.5 代码审查清单
3. 上轮评审文件（仅当 {ROUND} > 1）：
   - {PROJECT_ROOT}/docs/reviews/code-review-full-r{PREV_ROUND}.md
   - 用于核对上轮遗留问题

【扫描方式】
1. 先用 Glob 列出所有源码文件清单，统计总数
2. 按目录分批读取（避免单次上下文过大）：
   - 优先扫描核心业务模块（services/、lib/、app/api/、app/[locale]/dashboard/）
   - 其次扫描组件层（components/）
   - 最后扫描配置文件（middleware.ts、next.config.ts、tsconfig.json、package.json）
3. 对每个文件按"维度清单"逐项检查
4. 跨文件检查：导入关系、依赖方向、模块耦合

【审核维度】（逐项检查，每项给出结论）
1. 架构合理性（P0）：模块边界、依赖方向、单一职责、目录结构
2. 规范一致性（P0）：是否符合 .trae/rules/ 全套规范
3. 类型安全（P0）：no any、no @ts-ignore、显式返回类型、strict 模式
4. 安全合规（P0）：Zod 验证、密钥管理、Cookie、CSP、dangerouslySetInnerHTML、middleware 路由保护
5. Next.js 最佳实践（P1）：RSC 边界、async API、next/image、next/font、Metadata、Suspense、route handler
6. 性能（P1）：Bundle、并行数据获取、CSR bailout、缓存策略
7. 可维护性（P1）：命名、文件大小、导入规范、JSDoc、lucide-react
8. 测试覆盖（P2）：核心逻辑测试、AC 覆盖、E2E 关键流程

【输出】
- 文件路径：{PROJECT_ROOT}/docs/reviews/code-review-full-r{ROUND}.md
- 评审意见文件一旦归档禁止修改
- 文件结构：
  ## 审核概览
  - 审核时间、扫描文件数、按维度统计问题数
  ## 问题清单
  | 编号 | 文件:行号 | 维度 | 问题描述 | 严重程度 | 修订建议 |
  | CR{ROUND}-001 | app/.../page.tsx:42 | 类型安全 | 使用 any 类型 | 阻塞 | 改为 unknown + 类型守卫 |
  | CR{ROUND}-002 | services/user.ts:88 | 安全合规 | 硬编码密钥 | 阻塞 | 改用 process.env.SECRET_KEY |
  ## 维度统计
  - 维度 1 架构合理性：阻塞 X / 重要 Y / 建议 Z
  - ...
  ## 修订优先级建议
  - P0 阻塞问题（必须修复）：CR{ROUND}-001 ~ CR{ROUND}-NNN
  - P1 重要问题（必须修复或给理由）：CR{ROUND}-NNN ~ CR{ROUND}-NNN
  - P2 建议问题（酌情采纳）：CR{ROUND}-NNN ~ CR{ROUND}-NNN
  ## 评审结论
  - 需修订：存在阻塞或重要问题
  - 通过：仅剩建议级问题或无问题

【问题清单格式】
| 编号 | 文件:行号 | 维度 | 问题描述 | 严重程度 | 修订建议 |
- 严重程度：阻塞 / 重要 / 建议（按 [§11.2](./AI-Prompt使用规范.md)）
- 阻塞级问题必须导致"需修订"结论
- 编号格式：CR{ROUND}-001、CR{ROUND}-002...（CR = Code Review）

【硬性约束】
1. 适用全局代码约束（[§2.3 G1-G10](./AI-Prompt使用规范.md)）
2. 审核角色禁止直接修改代码，只输出意见文件
3. 禁止粘贴源码原文到评审文件（仅引用文件:行号）
4. 每个问题必须指向具体文件和行号
5. 每个问题必须给出具体修订建议，不可仅指出问题
6. 必须实际加载 next-best-practices skill，不得凭印象判断
7. 必须实际读取 .trae/rules/ 文件，不得跳过
8. {ROUND} > 1 时，必须核对上轮 r{PREV_ROUND} 问题是否已解决，并在新评审文件中标注"已解决/未解决/部分解决"

【错误处理】
- 文件不存在：跳过该文件，在评审文件"扫描范围"章节标注
- 文件过大（>500 行）：在评审文件中标注为问题（违反 G3），但仍需审核其内容
- 类型检查/lint 失败：在评审文件"自动化检查"章节记录失败详情

【验收标准】
- 评审文件已创建在 {PROJECT_ROOT}/docs/reviews/code-review-full-r{ROUND}.md
- 8 个维度全部检查并给出结论（不可遗漏）
- 问题编号连续（CR{ROUND}-001 起）
- 每个问题有文件:行号 + 严重程度 + 修订建议
- 维度统计表完整
- 评审结论明确（需修订 / 通过）
- {ROUND} > 1 时，上轮问题核对表完整

完成后返回：
- 评审文件路径
- 问题数量统计（阻塞/重要/建议）
- 各维度问题分布
- 评审结论
- {ROUND} > 1 时：上轮问题解决率（已解决数/上轮总数）
```

### 二、参数填充表（轮 1）

| 参数 | 值 |
|------|-----|
| `{AGENT_TYPE}` | nextjs-code-reviewer |
| `{ROUND}` | 1 |
| `{PROJECT_ROOT}` | /var/learning |

### 三、参数填充表（轮 3 复审）

| 参数 | 值 |
|------|-----|
| `{AGENT_TYPE}` | nextjs-code-reviewer |
| `{ROUND}` | 2 |
| `{PREV_ROUND}` | 1 |
| `{PROJECT_ROOT}` | /var/learning |

---

## 五、Prompt B — 轮 2 修订实施

### 一、通用模板

```
你是 {AGENT_TYPE}，任务：根据第 {ROUND} 轮代码审核意见修复【{MODULE_NAME}】模块的问题。

【必读规则文件】（按顺序加载）
1. {PROJECT_ROOT}/.trae/rules/INDEX.md — 规则索引
2. {PROJECT_ROOT}/.trae/rules/global/code-style.md — 代码风格与安全
3. {PROJECT_ROOT}/.trae/rules/global/naming-conventions.md — 命名规范
4. {PROJECT_ROOT}/.trae/rules/global/git-commit.md — Git 提交规范
5. {PROJECT_ROOT}/.trae/rules/global/changelog.md — 更新日志规范
6. {PROJECT_ROOT}/.trae/rules/dev/dev-workflow.md — 开发流程
7. {PROJECT_ROOT}/.trae/rules/dev/api-conventions.md — API 与服务层规范
8. {PROJECT_ROOT}/.trae/rules/dev/component-rules.md — 组件与 UI 规范
9. {PROJECT_ROOT}/.trae/rules/dev/testing-standards.md — 测试规范

【必加载 Skill】
- next-best-practices（按修复需要查阅对应子文档）

【输入文件】
1. 审核意见文件：{PROJECT_ROOT}/docs/reviews/code-review-full-r{ROUND}.md
   - 仅修复分配给本 agent 的问题编号（见下方"分配问题清单"）
2. 待修复文件清单：{AFFECTED_FILES}
   - 仅修改与分配问题相关的文件
3. 项目框架文档（如需了解架构背景）：{PROJECT_ROOT}/docs/AI-Prompt使用规范.md
   - 必读章节：§2.3 全局代码约束、§7 编码质量保障

【分配问题清单】
{ASSIGNED_ISSUES_TABLE}
| 编号 | 文件:行号 | 维度 | 问题描述 | 严重程度 | 修订建议 |
| CR{ROUND}-001 | ... | ... | ... | 阻塞 | ... |
（仅列出分配给本 agent 的问题，按严重程度降序排列）

【操作要求】
1. 按问题编号顺序逐条修复（先阻塞、再重要、最后建议）
2. 修复时遵循"手术刀式修改"原则：
   - 只动必须动的，不"改进"相邻代码
   - 匹配现有风格，即使自己会写得不一样
   - 不删除与本次修复无关的死代码
3. 修复涉及多文件时，保持文件间依赖关系一致
4. 修复完成后运行验证：
   - npx tsc --noEmit（退出码 0）
   - npm run lint（无警告无错误）
   - npm test（全部通过）
   - npm run build（构建成功）
5. 修复完成后按 [git-commit.md](../.trae/rules/global/git-commit.md) 规范提交 git：
   - 中文提交信息
   - 格式：`<类型>: <简短描述>`
   - 类型可选：修复 / 优化 / 重构 / 样式
   - 提交描述中引用问题编号（如"修复 CR1-001, CR1-003, CR1-005"）
   - 使用 `git add <specific-files>` 而非 `git add -A`
6. 如本次修复触发"结构化修改"条件（跨文件协同修改 ≥3 个、新增模块、影响业务流程等），
   按 [changelog.md](../.trae/rules/global/changelog.md) 规范在 {PROJECT_ROOT}/docs/changelog/ 下创建更新日志
   - 文件名：YYYY-MM-DD-代码审核修复-r{ROUND}.md
7. 禁止 push 到远程，仅本地 commit

【硬性约束】
1. 适用全局代码约束（[§2.3 G1-G10](./AI-Prompt使用规范.md)）
2. 严格遵循架构设计的目录结构和接口定义
3. Server Component 优先，需要交互时用 Client Component
4. 数据变更通过 Server Action，Zod 验证所有输入
5. 服务层返回 ServiceResult<T> 统一格式
6. 错误码遵循 MODULE_CATEGORY_SPECIFIC 格式
7. 禁止使用 any 类型
8. 禁止跨模块 ../ 引用，必须用 @/ 绝对路径
9. 单文件 ≤ 500 行，页面文件 ≤ 300 行
10. 图标统一使用 lucide-react，禁止内联 SVG
11. 禁止硬编码密钥、Token、连接字符串
12. 禁止改动与分配问题无关的代码
13. 禁止删除已有测试来让测试通过
14. 修复后必须运行全部验证（tsc / lint / test / build）
15. 禁止跳过类型检查或测试直接提交

【错误处理】
- 修复导致类型检查失败：立即修复类型错误，不可使用 @ts-ignore 绕过
- 修复导致测试失败：分析失败原因，要么修复代码要么修正测试（如测试本身有误），不可删除测试
- 修复导致构建失败：分析构建错误，调整修复方案
- 修复方案有冲突（如多个问题在同一文件互相矛盾）：报告总调度，请求决策

【验收标准】
- 分配的问题全部修复
- npx tsc --noEmit 退出码 0
- npm run lint 无警告无错误
- npm test 全部通过
- npm run build 构建成功
- git commit 已创建（中文提交信息，引用问题编号）
- 如触发更新日志条件，更新日志文件已创建在 docs/changelog/
- 输出修订对照表：CR{ROUND}-编号 | 是否解决 | 修改文件 | 修改行号

完成后返回：
- 修订对照表（CR{ROUND}-编号 | 是否解决 | 修改文件:行号）
- 验证结果（tsc / lint / test / build 各项通过状态）
- git commit hash
- 更新日志文件路径（如已创建）
- 阻塞问题（如有）
```

### 二、参数填充表（轮 2 修订）

| 参数 | 值 |
|------|-----|
| `{AGENT_TYPE}` | nextjs-frontend-expert / nextjs-backend-expert / ts-nextjs-db-modeler（按问题维度分配） |
| `{ROUND}` | 1 |
| `{PROJECT_ROOT}` | /var/learning |
| `{MODULE_NAME}` | 按问题归属模块填写（如"认证模块"、"缓存模块"等） |
| `{AFFECTED_FILES}` | 按 r1 评审文件中"文件:行号"列汇总 |
| `{ASSIGNED_ISSUES_TABLE}` | 总调度拆分后填入（按模块/agent 分组） |

---

## 六、Prompt C — 轮 3 复审

> 复审使用与 Prompt A 相同的模板，仅参数不同。重点：核对 r1 遗留 + 修订引入的新问题。

### 参数填充表（轮 3 复审）

| 参数 | 值 |
|------|-----|
| `{AGENT_TYPE}` | nextjs-code-reviewer |
| `{ROUND}` | 2 |
| `{PREV_ROUND}` | 1 |
| `{PROJECT_ROOT}` | /var/learning |

**复审重点**：
1. 核对 r1 问题清单中每条问题的解决状态（已解决/未解决/部分解决）
2. 扫描修订引入的新问题（如修复引入新的 any、新的安全问题等）
3. 重点关注：修订是否破坏了原有架构、是否引入新的类型不安全、是否降低测试覆盖
4. 复审文件结构增加"上轮问题核对表"章节：

```markdown
## 上轮问题核对表
| 编号 | r1 问题描述 | 解决状态 | 备注 |
| CR1-001 | 使用 any 类型 | ✅ 已解决 | 改为 unknown + 类型守卫 |
| CR1-002 | 硬编码密钥 | ⚠️ 部分解决 | 主路径已修复，边缘场景仍有 |
| CR1-003 | ... | ❌ 未解决 | 原因：...
```

---

## 七、Prompt D — 轮 4 终审决议

> **适用角色**：总调度 agent 自行执行（不调度子 agent）

```
你是总调度收尾 agent，任务：汇总代码审核的最后一轮复审结果，做最终决议。

【输入文件】
1. 最后一轮复审文件：{PROJECT_ROOT}/docs/reviews/code-review-full-r{FINAL_ROUND}.md
2. 上一轮审核文件（对比用）：{PROJECT_ROOT}/docs/reviews/code-review-full-r{PREV_FINAL_ROUND}.md
3. 修订期间的 git 提交历史：git log --oneline -20

【任务】
1. 读取最后一轮复审意见
2. 核对修订版是否已解决 r1 中的所有阻塞级问题
3. 核对修订是否引入新的阻塞级问题
4. 做决议：
   - 阻塞问题已全部解决 + 无新阻塞 → 项目状态置为 approved
   - 仍存在未解决的阻塞问题或引入新阻塞 → 标记为 blocked，列出剩余问题
5. 输出汇总报告（直接回复，不写文件）：
   - 代码审核终审状态（approved / blocked）
   - 各轮问题数量趋势（r1: 阻塞X/重要Y/建议Z → r2: 阻塞X'/重要Y'/建议Z'）
   - 阻塞问题解决率（已解决数/r1 阻塞总数）
   - 修订引入的新问题数
   - 验证状态（tsc / lint / test / build 最终状态）
   - 是否可进入下一阶段开发
   - 后续跟进建议（如未解决的建议级问题清单）

【硬性约束】
1. 仅核查最后一轮阻塞问题是否解决，不重新发现新问题（防止无限循环，按 [§5.5.3](./AI-Prompt使用规范.md)）
2. 若仍有阻塞问题，列出后请求人工介入，不无限循环修订
3. approved 状态后，本次审核循环结束
4. 决议结果同步到 docs/changelog/ 的最终更新日志中

完成后返回：终审决议报告（直接回复，不写文件）。
```

### 参数填充表（轮 4 终审）

| 参数 | 值 |
|------|-----|
| `{FINAL_ROUND}` | 2 |
| `{PREV_FINAL_ROUND}` | 1 |
| `{PROJECT_ROOT}` | /var/learning |

---

## 八、调度执行顺序

```
Step 1: 启动准备
  ├─ 总调度读取本方案文档 + AI-Prompt使用规范.md
  ├─ 确认项目快照：git status / git log --oneline -5
  └─ 创建 docs/reviews/ 目录（如不存在）

Step 2: 轮 1 全面审核（串行）
  ├─ 派发 Prompt A（参数：ROUND=1）给 nextjs-code-reviewer
  ├─ 等待返回评审文件 docs/reviews/code-review-full-r1.md
  └─ 验收：评审文件存在 + 8 维度全覆盖 + 问题编号连续

Step 3: 总调度拆分问题（串行）
  ├─ 读取 r1 评审文件
  ├─ 按"模块归属"拆分问题清单（如认证/缓存/解题/UI/配置等）
  ├─ 按问题严重程度排优先级（阻塞 > 重要 > 建议）
  ├─ 决定建议级问题是否修复（可推迟到下一里程碑）
  └─ 为每个 dev agent 准备 Prompt B 的 {ASSIGNED_ISSUES_TABLE}

Step 4: 轮 2 修订实施（并行）
  ├─ 并行调度多个 dev agent（按模块拆分）
  │   ├─ nextjs-backend-expert → 修复 services/lib 层问题
  │   ├─ nextjs-frontend-expert → 修复 components/UI 层问题
  │   └─ ts-nextjs-db-modeler → 修复数据访问层问题（如涉及）
  ├─ 每个 dev agent 独立完成：修复 → 验证 → git commit → 更新日志（如触发）
  └─ 等待所有 dev agent 返回修订对照表

Step 5: 总调度核对修订（串行）
  ├─ 汇总各 dev agent 的修订对照表
  ├─ 核对 git log 确认所有提交已创建
  ├─ 运行最终验证：tsc / lint / test / build
  └─ 准备复审输入

Step 6: 轮 3 复审（串行）
  ├─ 派发 Prompt C（参数：ROUND=2, PREV_ROUND=1）给 nextjs-code-reviewer
  ├─ 等待返回复审文件 docs/reviews/code-review-full-r2.md
  └─ 验收：r1 问题核对表完整 + 新发现问题清单

Step 7: 早停判断
  ├─ 若 r2 无阻塞问题 → 跳到 Step 9（提前通过）
  ├─ 若 r2 有阻塞问题但 ≤5 条 → 进入 Step 8（追加修订）
  └─ 若 r2 有阻塞问题且 >5 条或属根本性问题 → 跳到 Step 9（标记 blocked）

Step 8: 追加修订（如需要，最多 1 轮）
  ├─ 派发 Prompt B（参数：ROUND=2）修复 r2 阻塞问题
  ├─ dev agent 修复 → 验证 → git commit
  └─ 重新派发 Prompt C（参数：ROUND=3, PREV_ROUND=2）
  （注：此为兜底，最多追加 1 轮，避免无限循环）

Step 9: 轮 4 终审（串行）
  ├─ 总调度执行 Prompt D
  ├─ 读取最后一轮复审文件 + git log
  ├─ 做决议：approved / blocked
  └─ 输出终审报告

Step 10: 收尾
  ├─ 如 approved：归档本次审核记录，更新 docs/changelog/ 汇总日志
  ├─ 如 blocked：列出剩余阻塞问题，请求人工介入
  └─ 通知相关干系人
```

**超时设置**（按 [§5.4.3](./AI-Prompt使用规范.md)）：
- 轮 1 审核：15 分钟（全量扫描）
- 轮 2 修订：单 agent 10 分钟
- 轮 3 复审：15 分钟
- 轮 4 终审：5 分钟

**故障恢复**：
- 瞬时错误：自动重试 3 次（间隔 5s/15s/30s）
- 参数错误：修正后重新派发
- 逻辑错误（产出不达标）：修订 Prompt 后重新派发
- 阻塞问题：标记 blocked，请求人工介入

---

## 九、关键设计要点

### 9.1 角色隔离

- **审核角色**（nextjs-code-reviewer）：只输出意见文件，禁止修改代码
- **修复角色**（dev agent）：只按分配的问题修复，禁止越界改动
- **决策角色**（总调度）：拆分问题、编排调度、做终审决议

### 9.2 上下文隔离

- 审核 agent 加载 `.trae/rules/` 全套 + next-best-practices skill（必须实际加载，不可凭印象）
- 修复 agent 仅加载与本模块问题相关的规则文件
- 大型源码文件按目录分批扫描，避免单次上下文过大

### 9.3 版本控制

- 每轮评审文件独立编号：`code-review-full-r1.md`、`code-review-full-r2.md`
- 评审文件一旦归档禁止修改（按 [spec-workflow.md](../.trae/rules/spec/spec-workflow.md) 同款约束）
- 修订后 git commit 引用问题编号，便于追溯
- 更新日志按 [changelog.md](../.trae/rules/global/changelog.md) 规范执行

### 9.4 失败隔离

- 单个 dev agent 修复失败不阻塞其他独立模块的修复
- 单个维度的审核发现问题不影响其他维度审核
- 修复导致验证失败时，回滚该次修复并标记问题为"待人工介入"

### 9.5 循环收敛策略

| 轮次 | 收敛目标 | 退出条件 |
|------|---------|---------|
| 轮 1 | 全面发现问题 | 评审文件已生成 |
| 轮 2 | 修复全部阻塞 + 重要问题 | 验证全部通过 + git 已提交 |
| 轮 3 | 复核修复 + 发现新问题 | 复审文件已生成 |
| 轮 4 | 决议 | approved 或 blocked |

**收敛保护**：
- 最多 4 轮（默认）+ 1 轮兜底（如 r2 仍有少量阻塞）
- 终审仅核查阻塞问题，不发现新问题（防止无限循环）
- 超过 5 轮仍 blocked → 强制人工介入

---

## 十、文件清单（预期产出）

| 文件路径 | 类型 | 责任 agent | 说明 |
|---------|------|-----------|------|
| `docs/reviews/code-review-full-r1.md` | 评审文件 | nextjs-code-reviewer | 轮 1 全面审核意见 |
| `docs/reviews/code-review-full-r2.md` | 评审文件 | nextjs-code-reviewer | 轮 3 复审意见 |
| `docs/changelog/2026-07-06-代码审核修复-r1.md` | 更新日志 | dev agent（如触发） | 轮 2 修订的更新日志 |
| `docs/changelog/2026-07-06-代码审核修复-r2.md` | 更新日志 | dev agent（如触发） | 追加修订的更新日志 |
| `docs/changelog/2026-07-06-代码审核汇总.md` | 更新日志 | 总调度 | 终审后汇总日志 |
| 多个源码文件 | 代码 | dev agent | 按 r1/r2 问题清单修复 |
| 多个 git commit | 提交 | dev agent | 中文提交信息，引用问题编号 |

---

## 十一、验收标准（本方案文档自身）

- [x] 包含 §5.5.1 全部必备章节（任务拆分/调度架构/Prompt 模板/执行顺序/设计要点/文件清单）
- [x] 4 个 Prompt 模板（A/B/C/D）符合 [§3.1 标准格式](./AI-Prompt使用规范.md)
- [x] 每个 Prompt 模板附参数填充表
- [x] 8 个审核维度清单完整
- [x] 引用的规范文件路径与磁盘一致
- [x] 引用的 next-best-practices skill 子文档清单完整
- [x] 所有 Prompt 显式声明全局代码约束（G1-G10）
- [x] 所有 Prompt 显式声明安全约束（P9）
- [x] 审核 agent 与修复 agent 角色隔离
- [x] 循环收敛策略明确（最多 5 轮，终审不发现新问题）
- [x] 验证流程完整（tsc / lint / test / build）
- [x] git 提交规范引用 [git-commit.md](../.trae/rules/global/git-commit.md)
- [x] 更新日志规范引用 [changelog.md](../.trae/rules/global/changelog.md)
- [x] 故障恢复策略明确（重试 3 次 + 超时设置）
- [x] 失败隔离策略明确（单 agent 失败不阻塞其他）

---

## 十二、避坑核对（对照 [§8.2](./AI-Prompt使用规范.md)）

| 编号 | 避坑项 | 核对结果 |
|------|--------|---------|
| T1 | Prompt 引用了不存在的文件 | ✅ 所有路径已在方案中实际核对 |
| T2 | 大文档全量加载 | ✅ 源码按目录分批扫描，规范文件按章节引用 |
| T4 | 归档项目被误参考 | ⚠️ 本次审核不涉及参考项目，N/A |
| T5 | reviewer 直接改了代码 | ✅ Prompt A/C 显式声明"禁止修改代码" |
| T8 | 并行任务间相互依赖 | ✅ Step 4 中各 dev agent 按模块拆分，无相互依赖 |
| T10 | 子 agent 返回信息不足 | ✅ 每个 Prompt 末尾指定返回格式 |
| T11 | 未审核就进入开发 | ✅ 本次仅为审核循环，不进入新功能开发 |
| T13 | 硬编码密钥 | ✅ Prompt B 显式声明禁止硬编码 |
| T15 | Agent 间直接通信 | ✅ 所有跨 agent 数据通过文件系统 |
| T17 | 重试无限制 | ✅ 最多 3 次重试 + 最多 5 轮循环 |
| T18 | 代码审查遗漏安全项 | ✅ 维度 4 安全合规为 P0 必检项 |

---

## 十三、使用说明

### 13.1 启动方式

将本文件作为总调度的输入，按以下步骤执行：

```
1. 总调度读取本方案文档（你正在做的）
2. 执行 Step 1 启动准备
3. 按 §四 Prompt A 派发轮 1 审核
4. 接收返回 → 按 §五 Prompt B 派发轮 2 修订
5. 接收返回 → 按 §六 Prompt C 派发轮 3 复审
6. 接收返回 → 按 §七 Prompt D 执行轮 4 终审
7. 输出终审报告
```

### 13.2 早停条件

- 轮 1 即无任何问题 → 跳过轮 2/3/4，直接 approved
- 轮 3 复审无阻塞 → 跳过追加修订，直接进入轮 4 终审
- 轮 4 终审发现根本性问题 → 标记 blocked，请求人工介入

### 13.3 例外处理

- 如某模块代码量极大（如 services/ 超过 50 个文件），可拆分为多个并行的审核 agent
- 如某次修订涉及数据库 schema 变更，需追加 ts-nextjs-db-modeler 介入
- 如某次修订影响部署配置（next.config.ts / Dockerfile），需追加 nextjs-devops-expert 介入

---

> 本方案是活文档，执行过程中如发现不足（如新维度、新避坑点），及时更新并升级版本号。
