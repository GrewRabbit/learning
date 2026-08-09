# 开发流程规范

> 适用角色：`nextjs-frontend-expert`、`nextjs-backend-expert`、`nextjs-architect`、`nextjs-performance-optimizer`
> 优先级：高

---

## 一、Next.js App Router 组件选择

| 类型 | 场景 | 标记 |
|------|------|------|
| Server Component | 默认；数据获取、静态渲染 | 无 |
| Client Component | useState/useEffect、事件、浏览器 API | `'use client'` |
| Server Action | 数据突变、表单提交 | `'use server'` |

**IMPORTANT**：Server Component 获取数据后传递给 Client Component 处理交互。参考：`app/[locale]/dashboard/` 下现有页面。

---

## 二、数据获取

**优先 Server Actions**，避免 API Routes。

- Server Action 中通过 `cookies()` 获取认证信息
- 直接调用服务层，不经过 API 层
- 获取数据后通过 props 传递给 Client Component

---

## 三、Layout 拆分

```
layout.tsx（Server Component）
  └─ 仅渲染，不包含交互逻辑
  └─ 调用 layout-client.tsx

layout-client.tsx（Client Component）
  └─ 处理交互逻辑（useState、事件监听等）
```

---

## 四、页面粒度

| 规则 | 说明 |
|------|------|
| 单文件 ≤ 300 行 | 超出则拆分 |
| 拆分结构 | `page.tsx`(数据获取) + `components/`(子组件) + `actions.ts`(Server Actions) |

---

## 五、路由保护

使用 `middleware.ts` 做服务端认证检查：

- 未登录访问受保护路由 → 重定向至 `/login`
- 在 Edge Runtime 中运行，**禁止**使用 `logger`（只能用 `console`）

---

## 六、日志规范

| 场景 | 工具 | 说明 |
|------|------|------|
| 应用日志 | `@/app/lib/logging/logger` | `logger.info()` / `logger.error()` |
| 审计日志 | `auditLogger.log()` | 仅在 API Routes / Server Actions 层记录 |
| 中间件 | `console` | **禁止**使用 logger（Edge Runtime 限制） |
| 客户端组件 | `logClientError()` | **禁止**使用 logger（Client Runtime 限制），统一封装 `console.error` 带上下文输出 |

---

## 七、页面/组件开发流程

1. 阅读 `design/{skin-name}/DESIGN.md` 获取设计规范
2. 优先使用 Server Component 做数据获取
3. 需要交互时创建 Client Component 包裹交互部分
4. 数据变更通过 Server Action
5. 完成后验证（构建 + 类型检查 + 测试）