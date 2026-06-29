# 规则索引

> Agent 启动时优先读取本文件，按角色按需加载具体规则文件。

---

## 目录结构

```
.trae/rules/
├── INDEX.md                  ← 本文件：规则导航入口
├── global/                   ← 全局适用，所有角色必读
│   ├── code-style.md         # 代码风格、质量、安全
│   ├── naming-conventions.md # 命名规范、README 规范
│   ├── git-commit.md         # Git 提交规范
│   └── changelog.md          # 更新日志规范（何时记录、文件命名、模板）
├── spec/                     ← 需求阶段
│   ├── spec-workflow.md      # Spec 工作流（生成→评审→修订→实施）
│   └── spec-template.md      # Spec 正文模板
├── dev/                      ← 开发阶段
│   ├── dev-workflow.md       # Next.js 开发流程、日志规范
│   ├── api-conventions.md    # Server Action、服务层、LDAP 规范
│   ├── component-rules.md    # 组件规范、UI 样式规范
│   └── testing-standards.md  # 测试规范
└── infra/                    ← 基础设施
    ├── cicd-workflow.md      # CI/CD 流水线规范
    ├── env-management.md     # 环境变量管理规范
    └── deployment-checklist.md # 部署上线检查清单
```

---

## 角色 → 规则映射

| 角色 (Agent) | 必读规则 | 说明 |
|---|---|---|
| **所有角色** | `global/*` | 代码风格、命名、Git 提交、更新日志为全局约束 |
| `nextjs-spec-generator` | `spec/*` | Spec 生成与修订 |
| `nextjs-spec-reviewer` | `spec/*` | Spec 评审 |
| `nextjs-architect` | `spec/*` + `dev/*` | 架构设计需了解 spec 输出与开发约束 |
| `nextjs-dev-expert` | `dev/*` | 全部开发规范 |
| `nextjs-testing-expert` | `dev/testing-standards.md` | 测试规范 |
| `nextjs-performance-optimizer` | `dev/dev-workflow.md` + `dev/component-rules.md` | 性能优化需了解开发与组件约束 |
| `nextjs-devops-expert` | `infra/*` | 基础设施规范 |
| `ts-nextjs-db-modeler` | `dev/api-conventions.md` | 服务层与数据访问规范 |
| `general_purpose_task` | `global/*` + 按任务类型加载对应文件 | 通用任务按需加载 |

---

## 加载策略

1. **启动时**：读取本 `INDEX.md`，确定角色与所需规则文件列表
2. **按需加载**：仅在执行相关任务时读取对应规则文件，避免一次性加载全部
3. **规则冲突**：`global/` > `dev/` > `spec/` > `infra/`（全局规则优先级最高）

---

## 维护说明

- 新增规则文件：在本文件补充条目 + 更新角色映射
- 删除规则文件：在本文件移除条目 + 更新角色映射 + 检查交叉引用
- 修改规则文件：无需改动本文件（除非文件职责发生变更）

---

> 原始规则文件 `ProjectRule.md` 已拆分至上述各文件，本索引为唯一入口。