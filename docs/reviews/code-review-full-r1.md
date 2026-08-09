# GESP6 Web HTML 项目 第 1 轮全量代码审核

**审核时间**：2026-07-06
**审核角色**：nextjs-code-reviewer
**审核范围**：`/var/learning` 项目全量源码（Next.js 15.1.6 App Router + TypeScript 5.7.3 + Tailwind 3.4.17 + Server Actions + Zod）
**审核依据**：
- `.trae/rules/global/*`（代码风格、命名、Git 提交、更新日志）
- `.trae/rules/dev/*`（开发流程、API 规范、组件规范、测试规范）
- `.trae/rules/infra/*`（环境变量、部署清单、CI/CD）
- `.trae/skills/next-best-practices/SKILL.md` 及全部子文档
- `docs/AI-Prompt使用规范.md` v2.5（§2.3 G1-G10 全局约束、§7.5 评审清单、§11.2 严重程度定义）
**扫描文件总数**：82 个 TypeScript/TSX 源文件
**评审轮次**：第 1 轮（r1）

---

## 一、自动化检查结果

### 1.1 TypeScript 类型检查

```bash
npx tsc --noEmit
```

**结果**：✅ 通过（exit code 0，无类型错误）

**说明**：strict 模式启用，所有类型检查通过。但 `tsc` 通过仅代表静态类型合法，不代表无运行时类型逃逸（见 CR1-005、CR1-014、CR1-015）。

### 1.2 ESLint 检查

```bash
npm run lint
```

**结果**：✅ 通过（No ESLint warnings or errors）

**说明**：基于 `next/core-web-vitals` 配置。注意 2 处 `eslint-disable` 指令见 CR1-016，未计入 lint 失败但需复审。

### 1.3 自动化检查小结

| 检查项 | 命令 | 结果 | 备注 |
|--------|------|------|------|
| 类型检查 | `npx tsc --noEmit` | ✅ 通过 | exit 0 |
| Lint | `npm run lint` | ✅ 通过 | 无警告无错误 |

---

## 二、扫描范围

### 2.1 已扫描目录

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `app/` | ~50 | 页面、布局、API 路由、lib（ai/logging/env/models/platforms）、错误边界 |
| `components/ui/` | 7 | shadcn/ui 基础组件（button/card/input/label/logo/tabs/textarea） |
| `lib/` | 1 | utils.ts（cn 函数） |
| `middleware.ts` | 1 | 根目录中间件 |
| `next.config.ts` | 1 | Next.js 配置 |
| `tailwind.config.ts` | 1 | Tailwind 配置 |
| `tsconfig.json` | 1 | TypeScript 配置 |
| `.eslintrc.json` | 1 | ESLint 配置 |
| `vitest.config.ts` | 1 | Vitest 配置 |
| `playwright.config.ts` | 1 | Playwright 配置 |
| `postcss.config.mjs` | 1 | PostCSS 配置 |
| **合计** | **82** | （不含测试文件的源文件） |

### 2.2 重点审查文件清单

- **核心业务**：`app/lib/ai/services/orchestrator.ts`、`llm-caller.ts`、`html-cache.ts`、`fs-html-cache.ts`、`code-validator.ts`、`image-recognizer.ts`、`html-parser.ts`
- **客户端**：`app/lib/ai/clients/llm-client.ts`
- **题库抓取**：`app/lib/ai/services/problem-fetchers/{types,luogu-fetcher,youdao-fetcher}.ts`
- **API 路由**：`app/api/solve/route.ts`、`app/api/health/route.ts`
- **页面**：`app/solve/page.tsx`、`app/result/page.tsx`、`app/error.tsx`、`app/global-error.tsx`
- **基础设施**：`middleware.ts`、`next.config.ts`、`tailwind.config.ts`

---

## 三、问题清单

| 编号 | 文件:行号 | 维度 | 问题描述 | 严重程度 | 修订建议 |
|------|-----------|------|----------|----------|----------|
| CR1-001 | [orchestrator.ts:1-655](file:///var/learning/app/lib/ai/services/orchestrator.ts#L1-L655) | 可维护性 | 文件 655 行，超过 `code-style.md` §四"单文件 ≤ 500 行"硬性限制 | 阻塞 | 拆分：保留 `orchestrator.ts`（主流程 solve 主线）+ 抽出 `format-errors.ts`（`formatErrors` 私有方法）+ 抽出 `prompt-loader.ts`（`loadSkillPrompt`/`loadKnowledgeBase` + 缓存） |
| CR1-002 | [fs-html-cache.ts:1-568](file:///var/learning/app/lib/ai/services/fs-html-cache.ts#L1-L568) | 可维护性 | 文件 568 行，超过 500 行限制 | 阻塞 | 拆分：保留 `fs-html-cache.ts`（FsHtmlCache 主类）+ 抽出 `fs-paths.ts`（`getPrimaryIndexPath`/`getContentHtmlPath`/`getContentMetaPath`/`getSampleIndexPath` 路径计算）+ 抽出 `fs-json-io.ts`（`readJsonSync`/`writeJsonAsync` IO 工具） |
| CR1-003 | [solve/page.tsx:1-466](file:///var/learning/app/solve/page.tsx#L1-L466) | 命名与编码规范 | 页面 466 行，超过 `dev-workflow.md` §四"页面文件 ≤ 300 行"限制 | 阻塞 | 拆分：`page.tsx`（入口 + 数据初始化）+ `components/solve-form.tsx`（表单/输入区）+ `hooks/use-job-polling.ts`（`pollJob`/`cancelJobOnServer`/轮询逻辑） |
| CR1-004 | [llm-caller.ts:175](file:///var/learning/app/lib/ai/services/llm-caller.ts#L175) | 类型安全 | 图片类型消息构造 Bug：`text: input.problem.content \|\| '请识别图片中的题目内容'`。`input.problem.content` 在 image 类型下是 base64 图片数据，非空时（图片场景必定非空）LLM 会收到 `text=<base64 串>` 作为文本，浪费 token 且干扰模型理解 | 阻塞 | 改为固定描述文本：`{ type: 'text', text: '请识别图片中的题目内容' }`。图片数据通过 `image_url` 字段传递即可 |
| CR1-005 | [llm-client.ts:42](file:///var/learning/app/lib/ai/clients/llm-client.ts#L42) | 类型安全 | `messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[]` 使用双重断言（`as unknown as`）绕过类型检查。`ChatMessage` 类型定义 `role: string` 过于宽松（见 CR1-015），导致无法直接赋值，被迫逃逸 | 阻塞 | 修复 `ChatMessage` 类型（见 CR1-015）后，可直接赋值无需断言。或直接使用 SDK 类型：`type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam` |
| CR1-006 | [orchestrator.ts:626](file:///var/learning/app/lib/ai/services/orchestrator.ts#L626), [orchestrator.ts:645](file:///var/learning/app/lib/ai/services/orchestrator.ts#L645), [image-recognizer.ts:119](file:///var/learning/app/lib/ai/services/image-recognizer.ts#L119), [youdao-fetcher.ts:47](file:///var/learning/app/lib/ai/services/problem-fetchers/youdao-fetcher.ts#L47), [youdao-fetcher.ts:119](file:///var/learning/app/lib/ai/services/problem-fetchers/youdao-fetcher.ts#L119) | 命名与编码规范 | 服务端代码 5 处使用 `console.warn` 而非 `logger.warn`，违反 `dev-workflow.md` §六"应用日志必须使用 `@/app/lib/logging/logger`" | 阻塞 | 全部替换为 `logger.warn(...)`，参数保持不变。`logger` 已在上述文件 import（如 fs-html-cache.ts 已正确使用） |
| CR1-007 | [error.tsx:31](file:///var/learning/app/error.tsx#L31), [global-error.tsx:28](file:///var/learning/app/global-error.tsx#L28) | 命名与编码规范 | 客户端组件 2 处使用 `console.error` 而非 `logClientError()`，违反 `dev-workflow.md` §六"客户端组件禁止使用 logger，统一用 `logClientError` 封装" | 阻塞 | 替换为 `logClientError('[route-error]', { message: error.message, digest: error.digest, stack: error.stack })`。需在文件顶部 `import { logClientError } from '@/app/lib/logging/logger'` |
| CR1-008 | [tailwind.config.ts:14-69](file:///var/learning/tailwind.config.ts#L14-L69) | 命名与编码规范 | `theme.extend.colors` 重复定义 border/input/primary/secondary/destructive/muted/accent/success/warning/info/popover/card 等语义色 Token，违反 `component-rules.md` §七"Tailwind 配置仅保留 content，禁止 theme.extend 重复定义设计 Token" | 阻塞 | 移除 `theme.extend.colors` 与 `theme.extend.borderRadius`，仅保留 `content`。语义色 Token 通过 `globals.css` 中 CSS 变量定义，组件通过 `bg-card`/`text-destructive` 等语义类名引用（Tailwind v4 自动解析 CSS 变量） |
| CR1-009 | [solve/page.tsx:185](file:///var/learning/app/solve/page.tsx#L185) | 安全性 | `sessionStorage.setItem(SOLUTION_STORAGE_KEY, JSON.stringify(data.data.result))` 未包裹 try-catch。当 Solution 对象过大时（HTML 内容 + 思考过程可能 > 5MB）会抛出 `QuotaExceededError`，导致整个轮询流程中断，用户看到未定义错误。注意：相邻第 189 行的 `PROBLEM_STORAGE_KEY` 写入已正确包裹 try-catch，存在不一致 | 阻塞 | 包裹 try-catch 降级处理：`try { sessionStorage.setItem(...) } catch { /* 配额超限，降级提示 */ setError('结果数据过大，无法缓存到本地'); }` |
| CR1-010 | [middleware.ts:42-71](file:///var/learning/middleware.ts#L42-L71) | 安全性 | 中间件仅实现速率限制，无任何认证检查。`dev-workflow.md` §五规定"middleware.ts 做服务端认证检查：未登录访问受保护路由 → 重定向至 /login"。项目背景提到 SSO/LDAP 需求，当前 `/api/solve` 完全开放，任何匿名用户可触发 LLM 调用消耗成本 | 重要 | 即使当前为匿名模式，也应预留认证钩子：`if (req.nextUrl.pathname.startsWith('/api/solve') && !isAuthenticated(req)) { return NextResponse.redirect(new URL('/login', req.url)); }`。`isAuthenticated` 可先返回 true 并注释 TODO |
| CR1-011 | [next.config.ts:61-72](file:///var/learning/next.config.ts#L61-L72) | Next.js 最佳实践 | 缺少 `output: 'standalone'` 配置。`deployment-checklist.md` §一要求 Docker 构建使用 standalone 模式，`cicd-workflow.md` §三明确要求 `output: 'standalone'`。当前配置下 Docker 镜像需打包全量 node_modules，体积显著增大 | 重要 | 在 `nextConfig` 中添加 `output: 'standalone'`。需同步更新 Dockerfile 采用多阶段构建（Stage 3 仅复制 `.next/standalone` + `.next/static` + `public/`） |
| CR1-012 | [html-cache.ts:425](file:///var/learning/app/lib/ai/services/html-cache.ts#L425) | 安全性 | `const baseDir = process.env.GESP6_CACHE_FS_DIR ?? '/var/learning/data/gesp6';` 默认值使用绝对路径 `/var/learning/data/gesp6`，在 Docker 容器或其他部署环境（路径不同）下不可移植，且与项目根目录耦合 | 重要 | 改为相对路径：`path.resolve(process.cwd(), 'data/gesp6')`，或要求必须配置 `GESP6_CACHE_FS_DIR` 环境变量（缺失时抛错而非用硬编码默认值）。参考 `env-management.md` §五环境变量验证模式 |
| CR1-013 | [code-validator.ts:254](file:///var/learning/app/lib/ai/services/code-validator.ts#L254), [code-validator.ts:282](file:///var/learning/app/lib/ai/services/code-validator.ts#L282) | 安全性 | `g++-13` 二进制名硬编码在多处（可用性检测 + 编译命令）。不同环境可能使用 `g++-12`/`g++-14` 或包名 `g++`，导致跨环境部署失败 | 重要 | 抽取为模块常量：`const GPP_BINARY = process.env.GESP6_GPP_BINARY ?? 'g++-13';`，所有 `g++-13` 引用替换为 `GPP_BINARY`。`.env.local.example` 补充说明 |
| CR1-014 | [orchestrator.ts:598](file:///var/learning/app/lib/ai/services/orchestrator.ts#L598) | 类型安全 | `const data = validateResult.data!;` 使用非空断言 `!`。虽然上一行已检查 `validateResult.success`，但 `!` 绕过类型检查，若 `ServiceResult<T>` 类型定义变化（如 data 改为可选）可能引入运行时错误 | 重要 | 改为显式检查：`if (!validateResult.data) { return '验证结果数据缺失'; } const data = validateResult.data;` |
| CR1-015 | [llm-client.ts:9](file:///var/learning/app/lib/ai/clients/llm-client.ts#L9) | 类型安全 | `type ChatMessage = { role: string; content: string };` 中 `role: string` 过于宽松，允许任意字符串（如 `'foo'`）通过编译，但 OpenAI API 仅接受 `'system' \| 'user' \| 'assistant' \| 'tool'` | 建议 | 改为联合类型：`type ChatMessage = { role: 'system' \| 'user' \| 'assistant'; content: string };`。修复后 CR1-005 的双重断言可移除 |
| CR1-016 | [solve/page.tsx:101](file:///var/learning/app/solve/page.tsx#L101), [image-uploader.tsx:302](file:///var/learning/app/solve/components/image-uploader.tsx#L302) | 命名与编码规范 | 2 处 `eslint-disable` 指令。`image-uploader.tsx:302` 的 `@next/next/no-img-element` 因使用 data URL（`next/image` 不支持 base64 data URL）合理可接受。`solve/page.tsx:101` 的 `react-hooks/exhaustive-deps` 应重新审视依赖数组，避免 useEffect 闭包过期 | 建议 | `page.tsx:101` 的 useEffect 应正确列出依赖（`handleSubmit` 等通过 ref 访问的函数可不列，但状态变量需列），或拆分 effect 使其只读 ref |
| CR1-017 | [code-validator.ts:282](file:///var/learning/app/lib/ai/services/code-validator.ts#L282) | 安全性 | `const cmd = \`${ulimitPrefix} g++-13 "${sourcePath}" -o "${binaryPath}" -O2 -std=c++11 -DONLINE_JUDGE\`;` 使用字符串插值构造 shell 命令。虽然 `sourcePath`/`binaryPath` 来自 `mkdtemp`（系统生成，安全），但模式上有命令注入风险，若后续路径来源变化（如用户输入文件名）会引入漏洞 | 建议 | 改用 `execFile`（数组参数形式，不经 shell 解析）：`execFile(GPP_BINARY, ['-O2', '-std=c++11', '-DONLINE_JUDGE', sourcePath, '-o', binaryPath], { env: { ...process.env, ...ulimitEnv } })` |
| CR1-018 | [html-cache.ts](file:///var/learning/app/lib/ai/services/html-cache.ts), [fs-html-cache.ts](file:///var/learning/app/lib/ai/services/fs-html-cache.ts) 等 | 可维护性 | 部分 `export interface`/`export class` 公共 API 缺少 JSDoc 注释（如 `HtmlCache` 接口的方法、`FsHtmlCacheOptions` 字段含义）。`code-style.md` §二要求"导出函数/组件有适当的 JSDoc 或类型注释" | 建议 | 为公共接口补充 JSDoc：方法用途、参数含义、返回值、异常情况。参考 `llm-caller.ts` 已有的 JSDoc 风格 |

---

## 四、维度统计

| 维度 | 阻塞 | 重要 | 建议 | 小计 |
|------|------|------|------|------|
| 1. 架构与目录结构 | 0 | 0 | 0 | 0 |
| 2. 命名与编码规范 | 4 | 0 | 1 | 5 |
| 3. 类型安全 | 3 | 1 | 1 | 5 |
| 4. 安全性 | 1 | 3 | 1 | 5 |
| 5. Next.js 最佳实践 | 0 | 1 | 0 | 1 |
| 6. 性能 | 0 | 0 | 0 | 0 |
| 7. 可维护性 | 2 | 0 | 1 | 3 |
| 8. 测试覆盖 | 0 | 0 | 0 | 0 |
| **合计** | **10** | **5** | **4** | **19** |

**注**：CR1-006/CR1-007 涉及多处文件，按维度归一计数；总计 18 个独立问题项，部分问题跨维度（如 CR1-009 同时涉及安全与健壮性，归入安全性）。

### 严重程度分布

| 严重程度 | 数量 | 占比 | 说明 |
|----------|------|------|------|
| 阻塞 | 9 | 50% | 必须修复才能合并，涉及文件超长、类型逃逸、日志规范、UI Token 单一来源、运行时 Bug |
| 重要 | 5 | 28% | 强烈建议修复，涉及认证缺失、部署配置、可移植性、类型安全 |
| 建议 | 4 | 22% | 可选优化，涉及类型严格性、ESLint 指令、命令构造、JSDoc |

---

## 五、修改优先级建议

### P0 - 阻塞项，必须在合并前修复（9 项）

| 优先级 | 编号 | 简述 | 预估工作量 |
|--------|------|------|-----------|
| P0 | CR1-004 | llm-caller.ts 图片消息 text 字段 Bug | 5 分钟（一行修改 + 验证） |
| P0 | CR1-006 | 服务端 5 处 console.warn → logger.warn | 10 分钟（机械替换） |
| P0 | CR1-007 | 客户端 2 处 console.error → logClientError | 10 分钟（import + 替换） |
| P0 | CR1-008 | tailwind.config.ts 移除 theme.extend | 30 分钟（需验证 globals.css 已定义全部 CSS 变量） |
| P0 | CR1-009 | solve/page.tsx sessionStorage 包裹 try-catch | 10 分钟（参照相邻代码模式） |
| P0 | CR1-005 | llm-client.ts 移除双重断言（依赖 CR1-015） | 15 分钟（先修类型再移除断言） |
| P0 | CR1-001 | orchestrator.ts 拆分（655 → ≤500） | 2 小时（拆分 3 文件 + 测试验证） |
| P0 | CR1-002 | fs-html-cache.ts 拆分（568 → ≤500） | 1.5 小时（拆分 3 文件 + 测试验证） |
| P0 | CR1-003 | solve/page.tsx 拆分（466 → ≤300） | 2 小时（拆分 page + component + hook） |

### P1 - 重要项，建议本迭代修复（5 项）

| 优先级 | 编号 | 简述 | 预估工作量 |
|--------|------|------|-----------|
| P1 | CR1-011 | next.config.ts 添加 output: 'standalone' | 5 分钟（一行 + Dockerfile 同步） |
| P1 | CR1-012 | html-cache.ts 硬编码路径改为相对/必填 | 15 分钟 |
| P1 | CR1-013 | code-validator.ts g++-13 抽取为常量 | 20 分钟（多处替换） |
| P1 | CR1-014 | orchestrator.ts:598 移除非空断言 | 5 分钟 |
| P1 | CR1-010 | middleware.ts 预留认证钩子 | 30 分钟（需确认 SSO 方案） |

### P2 - 建议项，可纳入技术债务 backlog（4 项）

| 优先级 | 编号 | 简述 | 预估工作量 |
|--------|------|------|-----------|
| P2 | CR1-015 | ChatMessage.role 改为联合类型 | 10 分钟 |
| P2 | CR1-016 | 复审 eslint-disable 指令 | 30 分钟（依赖数组审查） |
| P2 | CR1-017 | code-validator.ts 改用 execFile | 1 小时（需测试编译流程） |
| P2 | CR1-018 | 公共 API 补充 JSDoc | 2 小时（批量补注释） |

---

## 六、良好实践（值得保留）

以下代码体现了良好的工程实践，应在后续开发中保持：

1. **环境变量验证**（[env.ts](file:///var/learning/app/lib/env.ts)）：模块加载时校验必需环境变量并缓存结果，符合 `env-management.md` §五推荐模式。

2. **SSRF 防护**（[api/solve/route.ts](file:///var/learning/app/api/solve/route.ts)）：通过 `PLATFORMS` 配置的 `urlPattern` 正则白名单限制可抓取的题目 URL，避免任意 URL 抓取导致的 SSRF。

3. **iframe 沙箱**（[html-renderer.tsx](file:///var/learning/app/result/components/html-renderer.tsx)）：`sandbox="allow-scripts"`（无 `allow-same-origin`）渲染 LLM 生成的不可信 HTML，opaque origin 隔离 DOM 访问，安全模型正确。

4. **CSP 配置**（[next.config.ts:33-45](file:///var/learning/next.config.ts#L33-L45)）：dev/prod 环境差异化 CSP（dev 允许 `unsafe-eval` for HMR，prod 严格策略），并正确处理 srcDoc iframe 继承父页 CSP 的细节。

5. **LRU 双键缓存**（[html-cache.ts](file:///var/learning/app/lib/ai/services/html-cache.ts)）：primary key（platform+problemId）+ content hash 双键设计 + in-flight Promise Map 单飞机制，避免重复 LLM 调用，设计合理。

6. **应用层重试**（[llm-caller.ts:103-146](file:///var/learning/app/lib/ai/services/llm-caller.ts#L103-L146)）：指数退避（1s→2s→4s，max 3）仅针对 429/网络错误，超时不重试，符合 `AI-Prompt使用规范.md` 重试策略要求。

7. **ServiceResult 统一返回**（[types.ts](file:///var/learning/app/lib/ai/types.ts)）：`ServiceResult<T>` 统一格式 + 模块化错误码（`MODULE_CATEGORY_SPECIFIC`），符合 `api-conventions.md` §二规范。

8. **g++ 编译沙箱**（[code-validator.ts](file:///var/learning/app/lib/ai/services/code-validator.ts)）：`mkdtemp` 临时目录 + `ulimit` 资源限制 + 编译后 `rm -rf`，编译选项 `-O2 -std=c++11 -DONLINE_JUDGE` 与 GESP 官方一致。

9. **速率限制**（[middleware.ts](file:///var/learning/middleware.ts)）：单 IP 20 次/分钟，配额说明清晰（1 题最多 4 次 LLM 调用 → 5 题并发），健康检查豁免。

10. **shadcn/ui 标准组件**（[components/ui/](file:///var/learning/components/ui/)）：使用 `cva` 声明式变体、`React.forwardRef`、语义化 CSS 变量（`bg-background`/`border-input`），符合 `component-rules.md` §五对照表。

---

## 七、评审结论

### 7.1 总体评估

**结论：需修订**

项目整体架构清晰、安全意识到位（SSRF/CSP/iframe 沙箱/g++ 沙箱均有实现）、自动化检查（tsc/lint）全绿，工程质量较高。但存在 **9 项阻塞问题**，主要集中在：

1. **文件超长**（3 项）：3 个核心文件超过行数限制，违反 `code-style.md` §四硬性约束，影响可维护性。
2. **类型逃逸**（2 项）：双重断言 + 非空断言绕过类型检查，违背 `code-style.md` §二"禁止 any，禁止类型逃逸"精神。
3. **日志规范**（2 项）：7 处 console 使用违反 `dev-workflow.md` §六日志规范。
4. **运行时 Bug**（1 项）：llm-caller.ts 图片消息构造错误，影响功能正确性。
5. **UI Token 单一来源**（1 项）：tailwind.config.ts 重复定义设计 Token，违反 `component-rules.md` §七。

### 7.2 阻塞项修复路径建议

**Phase 1 - 快速修复（≤ 1 小时）**：CR1-004（Bug 修复）、CR1-006/CR1-007（日志替换）、CR1-009（异常捕获）、CR1-014（非空断言）、CR1-015 + CR1-005（类型修复联动）。

**Phase 2 - 配置类修复（≤ 1 小时）**：CR1-008（tailwind 配置）、CR1-011（standalone 输出）、CR1-012/CR1-013（硬编码抽取）。

**Phase 3 - 文件拆分（≤ 6 小时）**：CR1-001/CR1-002/CR1-003（三个超长文件拆分），需配合单元测试验证拆分后行为一致。

**Phase 4 - 认证预留（依赖 SSO 方案）**：CR1-010 需与架构师确认 SSO/LDAP 集成方案后实施。

### 7.3 后续行动

1. 本评审文件归档至 `docs/reviews/code-review-full-r1.md`，**禁止修改**（按 `spec-workflow.md` §三评审意见归档规则）。
2. 修订完成后，开发专家创建 `code-review-full-r1-response.md` 列逐项修复情况，触发第 2 轮评审。
3. 第 2 轮评审重点验证：阻塞项是否全部修复、拆分后文件行数是否达标、类型逃逸是否消除、日志规范是否全覆盖。

---

## 八、附录

### 8.1 已加载规则文件清单

| 规则文件 | 加载状态 |
|----------|----------|
| `.trae/rules/INDEX.md` | ✅ |
| `.trae/rules/global/code-style.md` | ✅ |
| `.trae/rules/global/naming-conventions.md` | ✅ |
| `.trae/rules/global/git-commit.md` | ✅ |
| `.trae/rules/global/changelog.md` | ✅ |
| `.trae/rules/dev/dev-workflow.md` | ✅ |
| `.trae/rules/dev/api-conventions.md` | ✅ |
| `.trae/rules/dev/component-rules.md` | ✅ |
| `.trae/rules/dev/testing-standards.md` | ✅ |
| `.trae/rules/infra/env-management.md` | ✅ |
| `.trae/rules/infra/deployment-checklist.md` | ✅ |
| `.trae/rules/infra/cicd-workflow.md` | ✅ |
| `.trae/rules/spec/spec-template.md` | ✅ |
| `.trae/rules/spec/spec-workflow.md` | ✅ |
| `docs/AI-Prompt使用规范.md` v2.5 | ✅ |

### 8.2 已加载 Skill 子文档

| Skill 子文档 | 加载状态 |
|--------------|----------|
| `next-best-practices/SKILL.md` | ✅ |
| `next-best-practices/file-conventions.md` | ✅ |
| `next-best-practices/rsc-boundaries.md` | ✅ |
| `next-best-practices/async-patterns.md` | ✅ |
| `next-best-practices/runtime-selection.md` | ✅ |
| `next-best-practices/directives.md` | ✅ |
| `next-best-practices/functions.md` | ✅ |
| `next-best-practices/error-handling.md` | ✅ |
| `next-best-practices/data-patterns.md` | ✅ |
| `next-best-practices/route-handlers.md` | ✅ |
| `next-best-practices/metadata.md` | ✅ |
| `next-best-practices/image.md` | ✅ |
| `next-best-practices/font.md` | ✅ |
| `next-best-practices/bundling.md` | ✅ |
| `next-best-practices/scripts.md` | ✅ |
| `next-best-practices/hydration-error.md` | ✅ |
| `next-best-practices/suspense-boundaries.md` | ✅ |
| `next-best-practices/parallel-routes.md` | ✅ |
| `next-best-practices/self-hosting.md` | ✅ |
| `next-best-practices/debug-tricks.md` | ✅ |

### 8.3 工具调用记录

- `find /var/learning -type f \( -name "*.ts" -o -name "*.tsx" \)`：扫描源文件总数 82
- `wc -l` 验证关键文件行数：orchestrator.ts=655、fs-html-cache.ts=568、solve/page.tsx=466、html-cache.ts=437、api/solve/route.ts=360、code-validator.ts=360、llm-caller.ts=257
- `npx tsc --noEmit`：exit 0
- `npm run lint`：No ESLint warnings or errors
- `Grep` 检索 `console.(warn|error|log)`、`eslint-disable`、`as unknown as`、`/var/learning/data`、`g++` 等模式定位问题行号

---

**评审人**：nextjs-code-reviewer
**评审完成时间**：2026-07-06
**评审文件归档**：本文件归档后禁止修改，修订响应请创建 `code-review-full-r1-response.md`
