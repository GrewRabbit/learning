# 项目规则与工作方式

> 本项目规则源自 Trae（`.trae/rules`、`.trae/skills`），现由 opencode 开发。
> opencode 副本位于 `.opencode/`，两套配置共存，以 `.opencode/` 为准。

## 项目简介

- Next.js 15（App Router，含 `[locale]` 国际化）+ TypeScript + Tailwind CSS
- 功能：洛谷题目（GESP 六级）解题网页生成，含流程图/思维导图/代码；调用 OpenAI 模型生成
- 测试：Vitest（单元/集成，全 mock 无需模型）+ Playwright（E2E，`@smoke`/`@no-llm`/`@llm` 分级）
- 认证：middleware.ts 服务端校验，登录页 `/login`；数据变更优先 Server Actions

## 常用命令

```bash
npm run dev              # 开发服务器
npm run build            # 生产构建
# 代码规范
npm run lint             # ESLint
npm run type-check       # tsc --noEmit
# 单元/集成测试（vitest）
npm run test:unit        # 仅单元测试（__tests__）
npm run test:integration # 仅集成测试（tests/integration-tests/）
npm test                 # 单元 + 集成
# E2E 测试（Playwright，按业务分类）
npm run test:e2e:smoke      # 冒烟核心（smoke + navigation）
npm run test:e2e:solve      # 解题主流程（solve-text/image/platform，需模型）
npm run test:e2e:sso        # SSO 认证（需真实 IDP）
npm run test:e2e:validation # 输入校验（validation + platform-input + api-contract）
npm run test:e2e:resilience # 结果容错（result-resilience）
npm run test:e2e:image      # 图片上传（image-upload）
npm run test:e2e         # 全部 E2E（聚合所有业务小类）
npm run test:e2e:no-llm  # E2E 无需模型（@no-llm 标签筛选）
npm run test:e2e:llm     # E2E 需要模型（@llm 标签筛选）
# 聚合命令
npm run test:quick       # 单元 + 集成 + E2E 无需模型（本地快速反馈）
npm run test:full        # 单元 + 集成 + 全部 E2E（发布前完整验证）
```

## 规则加载

- `global/*`（代码风格、命名、Git 提交、更新日志）通过 `opencode.json` 的 `instructions` **会话启动时自动注入**，所有角色生效。
- 打开 `.opencode/rules/INDEX.md` 确定角色所需的其他规则文件，按需用 Read 加载，不预加载全部。优先级：`global/` > `dev/` > `spec/` > `infra/`。
- 开发任务读 `.opencode/rules/dev/*`
- 需求/架构任务读 `.opencode/rules/spec/*`
- 部署/运维读 `.opencode/rules/infra/*`

## 可用 Skills（.opencode/skills）

工作流类：brainstorming、writing-plans、executing-plans、subagent-driven-development、using-git-worktrees、finishing-a-development-branch、requesting-code-review、receiving-code-review、verification-before-completion
技术类：test-driven-development、systematic-debugging、next-best-practices、playwright、gesp6-solution、pencil-batch-design、dispatching-parallel-agents、using-superpowers、writing-skills

需要时通过 skill 工具按名加载。子代理（agents）位于 `.opencode/agents/`。

## MCP 服务器

- context7（官方文档查询）、pencil（.pen 设计文件）配置于全局 `~/.config/opencode/opencode.json`（含 API key，不提交仓库）。
- 换环境需在全局配置中重建这两个 MCP，项目文件不包含机器特定路径。

## 关键约定

- 提交描述使用中文，格式 `<类型>: <简短描述>`
- 禁止 force push / reset --hard 等破坏性命令；`git add <specific-files>` 而非 `-A`
- 不提交敏感信息（.env 等）
- **本地存储约定**：程序生成的**正式数据**（缓存、日志、中间记录文件）统一存放于 `.data/` 目录（如缓存根 `.data/gesp6`、日志 `.data/log/`），**不使用 `data/` 目录**；**临时文件**保留在 `tmp/`（gitignore `/tmp/`），不放入 `.data/`。部署/更新时排除或整体迁移 `.data/` 即可，不影响源码。
