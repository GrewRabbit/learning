# 组件与 UI 样式规范

> 适用角色：`nextjs-dev-expert`、`nextjs-performance-optimizer`
> 优先级：高

---

## 一、组件目录结构

```
components/
  ui/          ← 基础 UI 组件（Button、Input、Card 等）
  auth/        ← 认证相关业务组件
  admin/       ← 管理后台业务组件
app/
  [locale]/dashboard/components/  ← 页面级组件
```

---

## 二、图标

**禁止**内联 SVG，统一使用 `lucide-react` 图标组件：

```typescript
// ✅ 正确
import { User, Settings } from 'lucide-react';

// ❌ 错误
<svg viewBox="0 0 24 24">...</svg>
```

---

## 三、设计规范

- 生成 UI 时**必须**读取当前皮肤对应的 `design/{skin-name}/DESIGN.md`
- 设计规范标准：Google Stitch 九大板块
  - Visual Theme / Color Palette / Typography / Components / Layout / Depth / Do's & Don'ts / Responsive / Agent Prompt Guide

---

## 四、UI 样式核心原则

### 数据流

```
用户操作 → 外观管理方法 → Server Action → 持久化 → 根布局读取 → <html> 属性注入
                                                                    ↓
                                             皮肤：CSS 变量覆盖    布局：CSS Grid Areas
```

### 核心规则

| # | 类型 | 规则 |
|---|------|------|
| 1 | 禁止 | CSS 驱动，**禁止** JS 条件渲染切换皮肤/布局。组件级样式变体 prop（`size`/`variant`）不在此列，**推荐**使用 `cva` 声明式定义变体 |
| 2 | 禁止 | 零组件侵入，新增风格仅修改全局样式文件，**禁止**修改组件代码 |
| 3 | 禁止 | 仅根布局操作 `<html>` 属性，其他布局**禁止**操作 |
| 4 | 禁止 | 切换后 `window.location.reload()`，**禁止** `router.refresh()` |
| 5 | 禁止 | 外观管理方法**仅用于**外观管理页面，**禁止**业务组件读取外观值 |
| 6 | 流程 | 外观值由 Server Component 通过 props 传入业务组件 |
| 7 | 禁止 | Tailwind 配置仅保留 `content`，**禁止** `theme.extend` 重复定义设计 Token |
| 8 | 约束 | 组件仅允许定义组件级变量（`--{component}-xxx`），且必须引用语义层变量，**禁止**引用原始值 |

### 流程规范

- **降级/容错**：持久化读取失败时，回退到基础层默认值，不抛错不中断渲染
- **变量迁移**：重命名/删除变量时，旧变量保留为 alias 并标记 `/* @deprecated - 使用 --new-name 替代 */`，至少一个版本周期后移除
- **冲突优先级**：禁止 > 约束 > 流程

---

## 五、组件样式禁止/使用对照表

| 类别 | **禁止** | 使用 |
|------|----------|------|
| 圆角 | `rounded-xl`/`rounded-lg`/`rounded-md`/`rounded-2xl` | `rounded-(--radius-btn)` / `rounded-(--radius-input)` / `rounded-(--radius-card)` 等语义变量 |
| 高度 | `h-12` 等固定值 | `h-(--height-input)` |
| 颜色 | `bg-white`/`text-red-500`/`bg-gray-50`/`border-gray-300` | `bg-card`/`text-destructive`/`bg-muted`/`border-border` |
| 语义色背景 | `bg-green-50`/`bg-red-50`/`bg-yellow-50`/`bg-blue-50` | `bg-(--color-success-soft)` / `bg-(--color-destructive-soft)` 等 |
| 缩放 | `scale-102` | `scale-(--sidebar-item-scale)` |
| 阴影/动效硬编码 | `shadow-sm` / `transition-all` | `shadow-[var(--shadow-card)]` / `duration-(--transition-fast)` |

> Tailwind v4 语法：`-(--var-name)` 等价于 `-[var(--var-name)]`

---

## 六、布局组件规范

| 类别 | **禁止** | 使用 |
|------|----------|------|
| 导航方向 | JS 条件渲染不同组件 | 统一 Grid 容器 + CSS Grid Areas |
| 区域类名 | 自定义布局类 | 语义区域类名（见约定层） |
| 移动端适配 | JS 检测切换布局 | CSS 媒体查询 |
| RTL 支持 | JS 逻辑翻转 | CSS 选择器 `[dir="rtl"]` 自动翻转 |
| 内容宽度 | JS 控制容器宽度 | `data-content-width` + CSS `max-width` |
| 登录布局 | JS 条件渲染不同结构 | `data-auth-layout` + CSS Grid/Flex |

---

## 七、属性与类名约定

### 属性

| 属性 | 可选值 |
|------|--------|
| `data-skin` | 皮肤名称 |
| `data-site-nav` | `left` / `right` / `top` |
| `data-biz-nav` | `left` / `right` / `top` / `hidden` |
| `data-content-width` | `fluid` / `contained` |
| `data-auth-layout` | `centered` / `golden` / `golden-reverse` / `split` / `split-reverse` |

### 类名

| 类名 | 用途 |
|------|------|
| `.dashboard-grid` | Grid 容器 |
| `.region-site-nav` | 站点导航区域 |
| `.region-biz-nav` | 业务导航区域 |
| `.region-content` | 内容区域 |

### 默认值

| 类别 | 默认值 |
|------|--------|
| 皮肤 | `happyrabbit` |
| 布局 | `site-nav=left, biz-nav=left` |
| 移动端断点 | `@media (max-width: 767px)` |
| 外观注入位置 | `app/layout.tsx`（唯一拥有 `<html>` 元素的布局） |