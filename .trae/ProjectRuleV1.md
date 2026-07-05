# 项目规则

> v1.37 | 2026-04-29

## 一、技术查询

讨论技术最佳实践时**必须**调用 Context7：`resolve-library-id` → `query-docs` → 基于官方文档回答

## 二、Next.js App Router

### 组件选择

| 类型 | 场景 | 标记 |
|------|------|------|
| Server Component | 默认；数据获取、静态渲染 | 无 |
| Client Component | useState/useEffect、事件、浏览器API | `'use client'` |
| Server Action | 数据突变、表单提交 | `'use server'` |

**IMPORTANT**: Server Component 获取数据后传递给 Client Component 处理交互，参考：`app/[locale]/dashboard/` 下现有页面。

### 数据获取

**优先 Server Actions**，避免 API Routes。Server Action 中通过 `cookies()` 获取认证信息，直接调用服务层。

### Layout 拆分

`layout.tsx`(Server) 仅渲染 → `layout-client.tsx`(Client) 处理交互逻辑（useState、事件等）。

### 页面粒度

单文件≤300行，复杂页面拆分：`page.tsx`(数据获取) + `components/`(子组件) + `actions.ts`(Server Actions)

### 路由保护

使用 `middleware.ts` 做服务端认证检查，未登录访问受保护路由重定向至 `/login`。

## 三、Server Actions

- **位置**：页面专属→同目录 `actions.ts`；共享→父级 `actions.ts`
- **流程**：Zod 验证 → 调用服务层 → `revalidatePath` 刷新缓存
- **表单**：使用 `useActionState` 配合 `<form action={action}>`，`isPending` 控制提交状态
- **错误处理**：所有 Server Actions **必须**添加 `try-catch`，异常时返回 `ServiceResult` 格式的错误对象，禁止直接抛出未捕获异常

## 四、服务层

- **统一返回**：`ServiceResult<T>` — `{ success, data?, error?: { code, message } }`
- **错误码格式**：`MODULE_CATEGORY_SPECIFIC`，如 `AUTH_LOGIN_INVALID_CREDENTIALS`
- **单例导出**：`export const userService = new UserService()`，**禁止**懒加载函数

## 五、安全

- **Cookie**：httpOnly + secure(生产) + sameSite:lax + maxAge:15min
- **输入验证**：**CRITICAL** 所有输入必须在 Server Actions 中经 Zod 验证

## 六、日志

| 场景 | 工具 | 说明 |
|------|------|------|
| 应用日志 | `@/app/lib/logging/logger` | `logger.info()` / `logger.error()` |
| 审计日志 | `auditLogger.log()` | 仅在 API Routes / Server Actions 层记录 |
| 中间件 | `console` | **禁止**使用 logger（Edge Runtime 限制） |
| 客户端组件 | `logClientError()` | **禁止**使用 logger（Client Runtime 限制），统一封装 `console.error` 带上下文输出 |

## 七、LDAP

- **连接模式**：每次操作独立创建连接，使用 `withLdapClient<T>()` 模式：bind → operation → unbind(finally)
- **超时**：必须配置 `timeout` + `connectTimeout`，应对网络不稳定
- **异常**：优先使用 ldapts 类型化异常（`InvalidCredentialsError` 等），避免泛化 catch
- **禁止**：连接池、长连接复用、裸 Client 创建（无 bind/unbind 管理）

## 八、组件

- 设计实现参考 `design/` 目录下的 `DESIGN.md`
- 目录：`components/ui/`(基础) → `components/auth|admin/`(业务) → `[locale]/dashboard/components/`(页面级)
- **图标**：**禁止**内联 SVG，使用 `lucide-react` 图标组件

## 九、README

### 需要编写

项目根目录、核心业务模块、数据访问层、路由分组、API目录、复杂页面（含多子组件/hooks/actions）

### 不需要编写

简单页面（仅入口+布局）、单一功能目录（≤2文件）、纯类型定义目录

### 必备内容

1. **目录结构**：树形图列出子目录和关键文件职责
2. **文件关系表**：文件 | 被谁调用 | 调用谁
3. **外部关系表**：本目录文件 | 调用外部 | 被外部调用

### 原则

只描述关系，不描述规范；表格形式；双向完整

## 十、Git

- **CRITICAL** 提交描述必须使用中文
- 格式：`<类型>: <简短描述>`，类型：新增/修复/优化/重构/文档/测试/样式
- 示例：`修复: 解决用户登录时验证码不显示的问题`

## 十一、代码质量

| 规范 | 要求 |
|------|------|
| TypeScript | 显式声明返回类型 |
| 导入 | 禁止跨模块使用 `../`；同目录 `./` 优先；跨模块必须 `@/` |
| 文件大小 | 单文件≤500行 |
| 类型 | **禁止** `any`，使用 `unknown` |

## 十二、测试

### 测试类型与工具
| 类型 | 工具 | 位置 | 说明 |
|------|------|------|------|
| 单元测试 | Vitest | `**/__tests__/**/*.test.ts` | 测试单个函数/组件 |
| 集成测试 | 任意 | `tests/integration-tests/` | 多模块协作、API/数据库集成测试 |
| E2E测试 | Playwright | `tests/e2e-tests/` | 从UI开始的端到端用户流程测试 |
| 辅助测试 | 任意 | `tests/auxiliary-tests/` | 环境检查、外部服务连通性等非核心测试 |

### 单元测试规范
- **文件位置**：`__tests__/` 子目录，与被测代码同位
- **命名**：`[name].test.ts`，与源文件同名
- **全局配置**：`__tests__/setup.ts`

### 集成测试规范
- **测试范围**：模块间接口、API端点、数据库操作、外部服务调用
- **测试入口**：直接调用API/服务，不经过浏览器
- **目录结构**：按业务模块分类，如 `auth/`、`user/`、`ldap/`
- **环境要求**：需要完整的服务环境（数据库、缓存等）

### E2E测试规范
- **测试范围**：从浏览器开始的完整用户流程
- **目录结构**：`pages/`(POM) + `specs/`(测试) + `fixtures/`(夹具)
- **认证复用**：使用 setup 文件预登录，避免重复
- **标签**：`@smoke`, `@critical`, `@fast` 标记测试优先级

## 十三、UI 样式

### 原则层

#### 数据流

```
用户操作 → 外观管理方法 → Server Action → 持久化 → 根布局读取 → <html> 属性注入
                                                                     ↓
                                              皮肤：CSS 变量覆盖    布局：CSS Grid Areas
```

#### 核心原则

| # | 类型 | 规则 |
|---|------|------|
| 1 | 禁止 | CSS 驱动，**禁止** JS 条件渲染切换皮肤/布局（组件级样式变体 prop 如 `size`/`variant` 不在此列，属于组件行为配置；**推荐**使用 `cva` 声明式定义变体，参考 `button.tsx`） |
| 2 | 禁止 | 零组件侵入，新增风格仅修改全局样式文件，**禁止**修改组件代码 |
| 3 | 禁止 | 仅根布局操作 `<html>` 属性，其他布局**禁止**操作 |
| 4 | 禁止 | 切换后 `window.location.reload()`，**禁止** `router.refresh()` |
| 5 | 禁止 | 外观管理方法**仅用于**外观管理页面，**禁止**业务组件读取外观值 |
| 6 | 流程 | 外观值由 Server Component 通过 props 传入业务组件 |
| 7 | 禁止 | Tailwind 配置仅保留 `content`，**禁止** `theme.extend` 重复定义设计 Token |
| 8 | 约束 | 组件仅允许定义组件级变量（`--{component}-xxx`），且必须引用语义层变量，**禁止**引用原始值 |

#### CSS 分层

CSS 文件分层与加载顺序详见 `app/styles/README.md`。

#### 流程规范

**降级/容错**：持久化读取失败时，回退到基础层默认值，不抛错不中断渲染

**变量迁移**：重命名/删除变量时，旧变量保留为 alias 并标记 `/* @deprecated - 使用 --new-name 替代 */`，至少一个版本周期后移除

**冲突优先级**：禁止 > 约束 > 流程

#### 组件样式（禁止/使用对照表）

| 类别 | **禁止** | 使用 |
|------|----------|------|
| 圆角 | `rounded-xl`/`rounded-lg`/`rounded-md`/`rounded-2xl` | `rounded-(--radius-btn)` / `rounded-(--radius-input)` / `rounded-(--radius-card)` 等语义变量 |
| 高度 | `h-12` 等固定值 | `h-(--height-input)` |
| 颜色 | `bg-white`/`text-red-500`/`bg-gray-50`/`border-gray-300` | `bg-card`/`text-destructive`/`bg-muted`/`border-border` |
| 语义色背景 | `bg-green-50`/`bg-red-50`/`bg-yellow-50`/`bg-blue-50` | `bg-(--color-success-soft)` / `bg-(--color-destructive-soft)` 等 |
| 缩放 | `scale-102` | `scale-(--sidebar-item-scale)` |
| 阴影/动效硬编码 | `shadow-sm` / `transition-all` | `shadow-[var(--shadow-card)]` / `duration-(--transition-fast)` |

Tailwind v4 语法：`-(--var-name)` 等价于 `-[var(--var-name)]`

#### 布局组件规范

| 类别 | **禁止** | 使用 |
|------|----------|------|
| 导航方向 | JS条件渲染不同组件 | 统一 Grid 容器 + CSS Grid Areas |
| 区域类名 | 自定义布局类 | 语义区域类名（见约定层） |
| 移动端适配 | JS检测切换布局 | CSS媒体查询 |
| RTL支持 | JS逻辑翻转 | CSS选择器 `[dir="rtl"]` 自动翻转 |
| 内容宽度 | JS控制容器宽度 | `data-content-width` + CSS `max-width` |
| 登录布局 | JS条件渲染不同结构 | `data-auth-layout` + CSS Grid/Flex |

---

### 约定层

#### 设计规范文件

| 项目 | 约定 |
|------|------|
| 文件名 | `DESIGN.md`（固定，每皮肤一个文件夹） |
| 目录结构 | `design/{skin-name}/DESIGN.md` |
| 标准 | Google Stitch 九大板块：Visual Theme / Color Palette / Typography / Components / Layout / Depth / Do's & Don'ts / Responsive / Agent Prompt Guide |
| AI 读取 | 生成 UI 时**必须**读取当前皮肤对应的 `design/{skin-name}/DESIGN.md` |

#### 属性与类名

| 类别 | 约定 |
|------|------|
| 皮肤属性 | `data-skin` |
| 布局属性 | `data-site-nav` / `data-biz-nav` / `data-content-width` / `data-auth-layout` |
| Grid 容器类名 | `.dashboard-grid` |
| 区域类名 | `.region-site-nav` / `.region-biz-nav` / `.region-content` |
| 焦点选择器 | `:is()` 限定可聚焦元素 |
| 移动端断点 | `@media (max-width: 767px)` |

#### 枚举值

| 属性 | 可选值 |
|------|--------|
| `data-site-nav` | `left` / `right` / `top` |
| `data-biz-nav` | `left` / `right` / `top` / `hidden` |
| `data-content-width` | `fluid` / `contained` |
| `data-auth-layout` | `centered` / `golden` / `golden-reverse` / `split` / `split-reverse` |

布局组合：`site-nav` × `biz-nav` 共 9 种（含 hidden），由 CSS Grid `[data-site-nav="x"][data-biz-nav="y"]` 定义

#### 持久化

| 项目 | 约定 |
|------|------|
| 注入位置 | `app/layout.tsx`（唯一拥有 `<html>` 元素的布局） |
| 外观管理 Hook | `useAppearance` |

#### 回退默认值

| 类别 | 默认值 |
|------|--------|
| 皮肤 | `happyrabbit` |
| 布局 | `site-nav=left, biz-nav=left` |

#### 变量命名前缀

变量命名前缀详见 `app/styles/README.md`。
