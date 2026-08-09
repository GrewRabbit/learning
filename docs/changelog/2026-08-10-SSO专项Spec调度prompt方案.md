# SSO 专项 Spec 阶段调度 Prompt 方案

**日期**：2026-08-10
**类型**：新增
**影响范围**：docs/Spec阶段调度prompt方案-SSO专项.md、docs/reviews/spec-prompt-plan-sso-review-r1.md、docs/reviews/spec-prompt-plan-sso-review-r2.md

## 变更背景

- 通用 Spec 阶段调度方案（`docs/Spec阶段调度prompt方案.md`，v1.0）已提交，但其输入假设为「approved PRD 中一个内聚功能域」。
- SSO 集成当前**无 approved PRD**（旧 `prd-sso-integration-v1.0.md` 已删除），需求基线改为「SSO IDP SP 集成指南（第三方契约）+ 业务集成目标 + 现有源码现状」。
- 为 SSO 专项生成专用调度方案，使总调度 agent 能指挥子 agent 完成 SSO spec 的「制作 → 评审 → 修订 → 终审」完整闭环。

## 变更内容

### 通用方案 → SSO 专项方案

- 原 `docs/Spec阶段调度prompt方案.md`（通用版）删除，替换为 `docs/Spec阶段调度prompt方案-SSO专项.md`。
- 方案以「无 approved PRD」为前提，需求来源改为集成指南 + 业务目标 + 源码现状；新增 `docs/sso-business-goals.md` 可选业务输入（当前不存在，缺失时标注开放问题）。
- 功能域拆分：`spec-sso-auth`（P0，登录认证/会话/登出）与 `spec-sso-token`（P1，Token 生命周期与安全强化），章节分配按集成指南 §0.2 能力映射对齐。

### Prompt 模板（A 生成 / B 评审 / C 修订 / D 终审）

- 四个 Prompt 均遵循 AI-Prompt 使用规范 §3.1 标准格式（角色/任务/必读规则/输入/输出/硬性约束/验收标准/返回格式），各带参数填充表。
- 强制满 2 轮评审（r1→v1.1→r2→v1.2→终审），终审仅核查阻塞问题、由总调度执行；角色隔离（reviewer 只评审、generator 只修订）。

### 评审闭环（2 轮）

- r1 评审（nextjs-spec-reviewer）：15 项问题（阻塞 1 / 重要 6 / 建议 8）→ v1.1 全部解决（100%）。
  - 阻塞项：Prompt C 缺文件重命名步骤导致流水线卡死，已补重命名指令与产出验证。
  - 重要项：sso-auth/sso-token 章节分配与 §0.2 能力映射偏差（补 §3.5/§4.2/§4.3）；版本策略与 T7 取舍未声明；Prompt D 缺参数表；Prompt B 缺照搬示例代码检查；禁止全量加载声明未覆盖 B/C/D。
- r2 评审（nextjs-spec-reviewer）：r1 问题解决率 15/15；发现新问题 3 项（重要 1 / 建议 2）→ v1.2 全部解决。
  - 重要项：Prompt D 任务 1 引用已不存在的 v1.1 文件（SR1-001 重命名修订引入的回归），已改为读取最新版 v1.2。
  - 建议项：§三 回退路径列举不全（补 §五-§八）；middleware matcher 仅覆盖 /api/* 的约束未提示。
- 终审（总调度）：v1.2 已解决全部阻塞问题，需求基线覆盖，结论 approved。

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `docs/Spec阶段调度prompt方案-SSO专项.md` | 新增 | SSO 专项调度方案（v1.2，含 Prompt A/B/C/D 模板） |
| `docs/Spec阶段调度prompt方案.md` | 删除 | 通用版方案，被 SSO 专项版替换 |
| `docs/reviews/spec-prompt-plan-sso-review-r1.md` | 新增 | 第 1 轮评审意见（归档只读） |
| `docs/reviews/spec-prompt-plan-sso-review-r2.md` | 新增 | 第 2 轮评审意见（归档只读） |

## 配置 / 环境变量变化

无

## 验证方式

- [ ] 类型检查：`npm run type-check`
- [ ] 单元测试：`npm test`
- [ ] Lint：`npm run lint`
- [ ] 手动验证：方案经 2 轮独立评审（nextjs-spec-reviewer）逐条核对路径、章节号、源码现状全部属实；终审 approved

## 后续影响 / 注意事项

- 本方案为调度模板，实际产出 spec（sso-auth / sso-token）需在总调度派发时按参数填充表填充占位符。
- `docs/sso-business-goals.md` 当前不存在；业务集成目标缺失时，spec 生成以集成指南 + 源码现状为基线，业务缺口列为开放问题。
- 依据规范 AI-Prompt 使用规范 v2.9 自身版本历史仅记录至 v2.5，v2.6-v2.9 变更需在规范补全后回查确认是否影响本方案引用章节。
