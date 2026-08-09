# 环境变量管理规范

> 适用角色：`nextjs-devops-expert`、`nextjs-backend-expert`
> 优先级：中

---

## 一、环境变量文件约定

| 文件 | 用途 | 版本控制 |
|------|------|---------|
| `.env` | 默认值（所有环境共享） | 提交（仅非敏感默认值） |
| `.env.local` | 本地覆盖 | **禁止**提交 |
| `.env.development` | 开发环境 | 提交（仅非敏感值） |
| `.env.production` | 生产环境 | **禁止**提交（敏感信息走 CI Secrets） |

---

## 二、变量命名规范

| 前缀 | 可见性 | 说明 |
|------|--------|------|
| 无前缀 | 仅服务端 | `DB_HOST`、`JWT_SECRET` |
| `NEXT_PUBLIC_` | 浏览器 + 服务端 | `NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_ANALYTICS_ID` |

---

## 三、安全规则

1. `.env*.local` 和 `.env.production` **必须**在 `.gitignore` 中
2. 敏感信息（密钥、密码、Token）**禁止**使用 `NEXT_PUBLIC_` 前缀
3. `NEXT_PUBLIC_` 变量值在构建时内联到 JS bundle，任何人可查看
4. CI/CD 环境变量通过平台 Secrets 管理，不写入文件

---

## 四、使用方式

### 服务端（Server Component / Server Action / Route Handler）

```typescript
// 直接访问 process.env
const dbHost = process.env.DB_HOST;
```

### 客户端（Client Component）

```typescript
// 仅可访问 NEXT_PUBLIC_ 前缀变量
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
```

---

## 五、环境变量验证

推荐在构建前验证必需的环境变量：

```typescript
// app/lib/env.ts
const requiredEnvVars = ['DB_HOST', 'JWT_SECRET'] as const;
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```