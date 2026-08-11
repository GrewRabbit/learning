# 全站 Header（页头）改造 — 方案说明

**日期**：2026-08-11（方案版）
**类型**：实施任务 · 轻量设计记录（不产 spec/arch 全文档）
**前置**：SSO SP 登录/登出/回调链已上线（middleware 认证墙、`/login?returnTo=` 回跳、`/api/sso/*` 回调链）

---

## 一、需求决策（已与需求方确认）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 注册页 URL 来源 | 新增环境变量 `NEXT_PUBLIC_SSO_REGISTER_URI`（不硬编码） |
| 2 | 首页 `/` | **显示精简 Header**（未登录游客也能看到注册/登录入口） |
| 3 | `/login` 页 | **隐藏 Header**（登录页自身不渲染页头） |
| 4 | 已登录下拉菜单 | 仅「用户信息」（→ dashboard 用户中心）+「退出登录」两项；**暂不做**解题记录/帮助/首页菜单（后两者无页面与数据库，后续再开发） |
| 5 | Dashboard 地址 | 环境变量 `NEXT_PUBLIC_SSO_DASHBOARD_URL`，不硬编码（默认指向 `https://auth.happyrabbit.top/dashboard` 的 IDP 用户中心） |
| 6 | 现有登录跳转 | `/login?returnTo=%2Fsolve` 行为保持不变，不回归 |

---

## 二、组件设计

### 2.1 组件树

```
app/layout.tsx（RSC 根布局）
└── <SiteHeader />                       ← RSC：读 cookie 判定登录态（粗检 exp，同 login/page.tsx）
    └── <HeaderBar isAuthenticated />    ← 'use client'：usePathname() 控制 /login 隐藏
        ├── <Logo size="sm" />           ← 左上角，Link → /
        ├── 未登录：<注册（外链）> + <LoginButton returnTo={当前路径} />
        └── 已登录：<UserMenu />          ← 'use client'：头像下拉
            ├── 用户信息 → NEXT_PUBLIC_SSO_DASHBOARD_URL（新标签页）
            └── <LogoutButton />         ← 复用现有，POST /api/sso/logout
```

### 2.2 关键点

- **登录态判定**：RSC 侧 `cookies()` 读 `sso_access_token`，解码 exp（不验签），语义与 `app/login/page.tsx` / `middleware.ts` 一致（FR-016 粗检）。
- **登录入口**：复用 `components/auth/login-button.tsx`（`LoginButton`），传 `returnTo={usePathname()}` —— 未登录在业务页点击登录，回跳当前页，符合现有 `/login?returnTo=` 协议。
- **注册入口**：外链 `<a href={NEXT_PUBLIC_SSO_REGISTER_URI} target="_blank">`（IDP 注册页为跨域站点，须新标签页打开，避免离开业务站）。
- **登出**：复用 `components/auth/logout-button.tsx`（`LogoutButton`），表单 POST `/api/sso/logout`。
- **下拉菜单**：需引入 `@radix-ui/react-dropdown-menu`（shadcn 标准方案，项目已用 radix 系 slot/label/tabs）。
- **/login 隐藏**：`HeaderBar` 用 `usePathname()`；命中顶层 `/login` 或 `/{locale}/login` 时返回 `null`（与 login/page.tsx 的 `isLoginPath` 同一判定逻辑）。
- **不硬编码**：Dashboard 与注册 URL 均读 `process.env.NEXT_PUBLIC_*`；缺失时对应入口隐藏（fail-safe，防止渲染死链给用户）。

---

## 三、涉及文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `.env.local.example` | 修改 | 新增 `NEXT_PUBLIC_SSO_REGISTER_URI`、`NEXT_PUBLIC_SSO_DASHBOARD_URL` 示例 |
| `.env.local` | 修改 | 补充上述两变量（注册页 URL 待确认后填） |
| `app/lib/env.ts` | 修改 | `SsoEnvConfig` 扩展两字段 + 读取（缺失仅警告，不阻断） |
| `components/site-header/site-header.tsx` | 新增 | RSC：cookie 粗检 + env 读取 + 组合 HeaderBar |
| `components/site-header/header-bar.tsx` | 新增 | 'use client'：路径判定 + 未登录/已登录两分支 |
| `components/site-header/user-menu.tsx` | 新增 | 'use client'：radix 下拉菜单（用户信息/退出登录） |
| `app/layout.tsx` | 修改 | `<body>` 顶部渲染 `<SiteHeader />` |
| `package.json` | 修改 | 新增 `@radix-ui/react-dropdown-menu` |

---

## 四、验证方案

1. `npm run type-check` + `npm run lint`
2. `npm test`（单元+集成不回归；可补充 site-header 判定/隐藏逻辑的单元测试）
3. `npm run test:e2e:smoke`（登录墙冒烟，确认 Header 不破坏现有路由）
4. 手动验证（需真实 IDP 或 mock）：未登录首页/业务页可见注册登录；登录后头像下拉；`/login` 无 Header；`/login?returnTo=%2Fsolve` 登录后回跳 `/solve`；登出后回落地页

---

## 五、待确认

- `NEXT_PUBLIC_SSO_REGISTER_URI` 具体值：能否提供 IDP 的注册页完整 URL？
- `NEXT_PUBLIC_SSO_DASHBOARD_URL`：确认即 `https://auth.happyrabbit.top/dashboard`？
- 登出落地页沿用现状白名单 `['/']`（登出后回首页），是否调整？