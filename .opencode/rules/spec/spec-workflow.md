# 需求文档（Spec）工作流规范

> 适用角色：`nextjs-spec-generator`、`nextjs-spec-reviewer`、`nextjs-architect`
> 优先级：高

本规则约束所有 Agent 在需求文档的生成、评审、修订与实施阶段的行为，确保任意时刻项目中只存在一份有效的 spec 文档。

---

## 一、目录结构约定

```
docs/
  specs/         ← 存放所有 spec 正文（唯一有效版本）
  reviews/       ← 存放评审意见文件（只读归档）
```

---

## 二、文件命名规范

### spec 正文

```
docs/specs/spec-[feature-slug]-v[major].[minor].md
```

示例：`docs/specs/spec-user-auth-v1.2.md`

### 评审意见

```
docs/reviews/spec-[feature-slug]-review-r[轮次].md
```

示例：`docs/reviews/spec-user-auth-review-r2.md`

### 规则

- `[feature-slug]` 全小写 kebab-case，与 spec 正文保持一致
- 版本号格式：`major.minor`，初稿为 `v1.0`，每轮评审修订后 minor +1
- 评审意见文件一旦归档**禁止修改**，轮次从 `r1` 开始递增

---

## 三、工作流程（强制执行）

```
步骤 1: 生成初稿
  └─ 角色: nextjs-spec-generator
  └─ 输出: docs/specs/spec-[feature]-v1.0.md（状态: draft）

步骤 2: 执行评审
  └─ 角色: nextjs-spec-reviewer
  └─ 输入: 当前最新版 spec 正文
  └─ 输出: docs/reviews/spec-[feature]-review-r[N].md
  └─ 约束: 评审角色只输出意见文件，禁止直接修改 spec 正文

步骤 3: 合并修订
  └─ 角色: nextjs-spec-generator
  └─ 输入: 当前 spec 正文 + 对应 review 文件
  └─ 操作: 在原 spec 正文上直接修订（不新建文件），版本号 minor +1
  └─ 约束: 禁止将评审意见文件的内容直接粘贴进 spec 正文

步骤 4: 循环直至通过
  └─ 重复步骤 2-3，每轮评审对应一个 review 文件
  └─ 评审结论为"通过"时，将 spec 状态更新为 approved，停止循环

步骤 5: 进入实施
  └─ approved 状态的 spec 是架构设计师、开发专家、测试专家的唯一输入依据
  └─ 其他角色禁止参考 draft 或 in-review 状态的 spec
```

---

## 四、关键禁止事项

- 禁止将评审意见文件（review）直接作为开发或架构设计的输入
- 禁止在 `docs/specs/` 中保留多个版本文件（始终只有一份，版本号写在文件内部）
- 禁止跳过评审直接将 draft 状态的 spec 交给开发专家实施
- 禁止评审角色修改 spec 正文（只能输出意见，修订由 spec-generator 执行）
- 禁止在 spec 未达到 approved 状态前启动架构设计或开发工作