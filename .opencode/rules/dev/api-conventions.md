# API 与服务层规范

> 适用角色：`nextjs-backend-expert`、`nextjs-db-modeler`、`nextjs-architect`
> 优先级：高

---

## 一、Server Actions 规范

### 位置

| 场景 | 位置 |
|------|------|
| 页面专属 | 同目录 `actions.ts` |
| 共享 Action | 父级目录 `actions.ts` |

### 流程

```
Zod 验证 → 调用服务层 → revalidatePath 刷新缓存
```

### 表单处理

```typescript
// 使用 useActionState 配合 <form action={action}>
const [state, action, isPending] = useActionState(serverAction, initialState);

// isPending 控制提交状态
<Button disabled={isPending} type="submit">提交</Button>
```

### 错误处理

所有 Server Actions **必须**添加 `try-catch`：

```typescript
'use server';

export async function myAction(formData: FormData): Promise<ServiceResult<Data>> {
  try {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: '...' } };
    }
    const result = await myService.doSomething(parsed.data);
    revalidatePath('/path');
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: { code: 'INTERNAL_ERROR', message: '...' } };
  }
}
```

**禁止**直接抛出未捕获异常。

---

## 二、服务层规范

### 统一返回格式

```typescript
type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;    // MODULE_CATEGORY_SPECIFIC 格式
    message: string;
  };
};
```

### 错误码格式

```
MODULE_CATEGORY_SPECIFIC

示例:
  AUTH_LOGIN_INVALID_CREDENTIALS
  USER_PROFILE_NOT_FOUND
  LDAP_BIND_FAILED
```

### 单例导出

```typescript
// ✅ 正确：直接导出单例
export const userService = new UserService();

// ❌ 错误：懒加载函数
export function getUserService() { return new UserService(); }
```

---

## 三、LDAP 规范

### 连接模式

每次操作独立创建连接，使用 `withLdapClient<T>()` 模式：

```
bind → operation → unbind（finally）
```

### 配置要求

- **必须**配置 `timeout` + `connectTimeout`
- 优先使用 ldapts 类型化异常（`InvalidCredentialsError` 等）
- 避免泛化 catch

### 禁止事项

- 连接池
- 长连接复用
- 裸 Client 创建（无 bind/unbind 管理）