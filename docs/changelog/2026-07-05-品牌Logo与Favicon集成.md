# 品牌 Logo 与 Favicon 集成

**日期**：2026-07-05
**类型**：新增
**影响范围**：首页（app/page.tsx）、新增 Logo 组件（components/ui/logo.tsx）、静态资源（public/happyrabbit-logo.png）、Favicon（app/favicon.ico）

## 变更背景

项目根目录散落两个品牌 logo 资源文件（`happyrabbit-logo1(256).fw.png` 与 `happyrabbit-logo1.ico`），未接入应用 UI 与浏览器标签页。需要按 Web 开发最佳实践将其纳入标准静态资源目录，并在首页标题区上方集成响应式 Logo 组件、配置浏览器 Favicon，提升品牌识别度与专业感。

## 变更内容

### 1. 静态资源迁移与重命名

- `happyrabbit-logo1(256).fw.png` → `public/happyrabbit-logo.png`
  - 移至 Next.js 标准 `public/` 静态资源目录
  - 重命名去除 URL 不安全的括号字符 `(` `)` 与 Fireworks 后缀 `.fw`，避免 URL 编码问题
- `happyrabbit-logo1.ico` → `app/favicon.ico`
  - 按 Next.js App Router 约定放置（自动生成 `<link rel="icon">` 标签，无需手动修改 layout 头部）
  - 原始文件 247KB，PNG 为 256×256 方形图

### 2. 新增响应式 Logo 组件（components/ui/logo.tsx）

- 基于 `next/image`（`fill` 模式）+ `next/link`（点击跳转首页 `/`）
- 三档尺寸变体（mobile-first 响应式断点）：
  - `sm`：32px → 40px（sm）
  - `md`：48px → 56px（sm）→ 64px（md）
  - `lg`：64px → 80px（sm）→ 96px（md）
- `priority` 标记首屏优先加载（LCP 优化）
- `sizes` 属性与尺寸变体对齐，帮助 Next.js 生成正确 srcset
- `object-contain` + 圆形容器保持比例与视觉一致性
- `aria-label="返回首页 - 信奥赛 C++ 解题专家"` 提供无障碍可访问性

### 3. 首页标题区集成（app/page.tsx）

- 在 `<header>` 顶部添加 `<Logo size="lg" />`，置于 `<h1>` 上方
- `space-y-2` 调整为 `space-y-4`，给 Logo 与标题之间留出更舒适的呼吸空间
- 依赖父级 `<main>` 的 `flex flex-col items-center` 实现自动居中

### 4. Favicon 自动注入

- `app/favicon.ico` 由 Next.js App Router 自动检测并注入 `<link rel="icon" href="/favicon.ico" sizes="any">`
- 无需修改 `app/layout.tsx` 的 metadata 配置
- 主流浏览器（Chrome / Firefox / Safari / Edge）均通过 W3C 标准约定识别

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `public/happyrabbit-logo.png` | 新增（移动） | 从项目根目录迁移至 public/，重命名去除 URL 不安全字符 |
| `app/favicon.ico` | 新增（移动） | 从项目根目录迁移至 app/，Next.js App Router favicon 约定位置 |
| `components/ui/logo.tsx` | 新增 | 响应式 Logo 组件，next/image + next/link |
| `app/page.tsx` | 修改 | header 顶部集成 Logo（lg 尺寸），space-y 调整为 4 |

## 配置 / 环境变量变化

无

## 验证方式

- [x] 类型检查：`npx tsc --noEmit` 无错误
- [x] 静态资源路径校验：`/happyrabbit-logo.png` 由 CSP `img-src 'self' data:` 放行（同源）
- [x] Favicon 路径校验：`app/favicon.ico` 由 Next.js App Router 自动注入

## 后续影响 / 注意事项

1. **图片优化依赖 next/image**：`public/` 下的图片通过 `next/image` 引用时仍会经过 Next.js 图片优化器（按需生成 WebP/AVIF），生产环境需保证 `sharp` 已安装（Next.js 默认内置）
2. **CSP 已放行同源 img-src**：`next.config.ts` 中 `img-src 'self' data:` 已覆盖本场景，无需调整 CSP
3. **Logo 组件可复用**：`components/ui/logo.tsx` 可在其他页面（如未来 /solve、/result 页头）通过 `<Logo size="sm" />` 复用，无需重复实现
4. **favicon.ico 体积偏大（247KB）**：当前未做体积优化，若 Lighthouse 审计提示可后续用 ICO 多分辨率压缩工具（如 png-to-ico）生成 16/32/48 多尺寸版本
