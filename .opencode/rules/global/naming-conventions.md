# 命名规范与文档规范

> 适用角色：所有 Agent | 优先级：最高

---

## 一、文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件文件 | kebab-case | `user-profile.tsx` |
| 工具函数 | kebab-case | `format-date.ts` |
| 类型定义 | kebab-case | `user-types.ts` |
| 测试文件 | `[name].test.ts` | `user-service.test.ts` |
| Server Action | `actions.ts`（同目录） | `app/dashboard/actions.ts` |

---

## 二、变量与函数命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `UserProfile` |
| 函数/变量 | camelCase | `getUserById` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase | `UserProfile`, `ServiceResult<T>` |
| 文件名 | kebab-case | `user-profile.tsx` |
| 服务单例 | camelCase | `export const userService = new UserService()` |

---

## 三、README 规范

### 需要编写 README

- 项目根目录
- 核心业务模块
- 数据访问层
- 路由分组
- API 目录
- 复杂页面（含多子组件/hooks/actions）

### 不需要编写 README

- 简单页面（仅入口+布局）
- 单一功能目录（≤ 2 文件）
- 纯类型定义目录

### README 必备内容

1. **目录结构**：树形图列出子目录和关键文件职责
2. **文件关系表**：文件 | 被谁调用 | 调用谁
3. **外部关系表**：本目录文件 | 调用外部 | 被外部调用

### 原则

- 只描述关系，不描述规范
- 表格形式
- 双向完整

---

## 四、错误码命名

格式：`MODULE_CATEGORY_SPECIFIC`（全大写，下划线分隔）

```
AUTH_LOGIN_INVALID_CREDENTIALS
USER_PROFILE_NOT_FOUND
LDAP_BIND_FAILED
```