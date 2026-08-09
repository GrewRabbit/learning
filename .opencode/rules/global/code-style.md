# 代码风格与质量规范

> 适用角色：所有 Agent | 优先级：最高

---

## 一、技术查询

讨论技术最佳实践时**必须**调用 Context7：`resolve-library-id` → `query-docs` → 基于官方文档回答。

---

## 二、TypeScript 规范

| 规范 | 要求 |
|------|------|
| 返回类型 | 函数/方法**必须**显式声明返回类型 |
| 禁止 `any` | **禁止**使用 `any`，不确定类型使用 `unknown` |
| 类型导入 | 优先使用 `import type` 导入纯类型 |

---

## 三、导入规范

| 规则 | 说明 |
|------|------|
| 禁止跨模块 `../` | 跨模块引用**必须**使用 `@/` 绝对路径 |
| 同目录优先 `./` | 同目录文件使用 `./` 相对路径 |
| 顺序 | 第三方库 → `@/` 绝对路径 → `./` 相对路径 |

```typescript
// ✅ 正确
import { useState } from 'react';
import { userService } from '@/app/services/user';
import { formatDate } from './utils';

// ❌ 错误
import { userService } from '../../../services/user';
```

---

## 四、文件大小

| 类型 | 上限 |
|------|------|
| 单文件 | ≤ 500 行 |
| 页面文件 | ≤ 300 行（复杂页面拆分为 `page.tsx` + `components/` + `actions.ts`） |

---

## 五、安全规范

### Cookie 配置

```
httpOnly: true
secure: true（生产环境）
sameSite: 'lax'
maxAge: 15 分钟
```

### 输入验证

**CRITICAL**：所有用户输入必须在 Server Actions 中经 Zod 验证，禁止信任客户端输入。

```typescript
// ✅ 正确
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
const parsed = schema.safeParse(formData);

// ❌ 错误：直接使用未验证的输入
await userService.create(formData);
```

---

## 六、代码简洁原则

- 不实现超出需求范围的功能
- 不为一次性代码做抽象
- 不添加未经要求的"灵活性"或"可配置性"
- 不为不可能发生的场景编写错误处理
- 匹配现有代码风格，不做无关"改进"