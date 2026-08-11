# Mermaid 资源本地化与去 CDN 依赖

**日期**：2026-08-11
**类型**：优化
**影响范围**：`next.config.ts`（CSP 头）、`app/result/components/html-renderer.tsx`（注释）、`app/lib/ai/prompts/gesp6-skill.md`（生成 HTML 的资源引用）、`public/_shared/`（新增静态资源目录）

## 变更背景

生成结果页的 srcDoc iframe 原从 jsDelivr CDN 加载 Mermaid 脚本与字体。为消除对外部 CDN 的运行时依赖、避免加载失败影响渲染，现将资源本地化到同源 `/public/_shared/`，并以绝对路径引用（srcDoc iframe 的 base URI 继承父页面，可加载同源资源）。

## 变更内容

### CSP（next.config.ts）

- `script-src`：移除 `https://cdn.jsdelivr.net`，dev 保留 `'unsafe-eval'`、prod 纯同源
- `font-src`：移除 jsdelivr，改 `'self'`
- 注释同步更新：资源走同源绝对路径，无需放行外部 CDN

### 本地资源（public/_shared/）

- `js/mermaid.min.js`（v10.9.1）
- `fonts/Outfit-Regular.woff2`、`fonts/Outfit-Bold.woff2`
- `fonts/JetBrainsMono-Regular.woff2`、`fonts/JetBrainsMono-Bold.woff2`

### 引用水焕（gesp6-skill.md / html-renderer.tsx）

- 字体与 Mermaid JS 的生成引用由 jsDelivr URL 改为绝对路径 `/_shared/...`
- 安全隔离语义不变：`sandbox="allow-scripts"`（无 allow-same-origin，opaque origin）

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `public/_shared/js/mermaid.min.js` | 新增 | Mermaid 本地脚本 |
| `public/_shared/fonts/*.woff2` | 新增 | 4 个字体文件（Outfit / JetBrainsMono 各 Regular、Bold） |
| `next.config.ts` | 修改 | CSP 移除 jsdelivr 放行 |
| `app/lib/ai/prompts/gesp6-skill.md` | 修改 | 生成 HTML 的资源引用改为同源路径 |
| `app/result/components/html-renderer.tsx` | 修改 | 安全策略注释同步更新 |

## 配置 / 环境变量变化

无

## 验证方式

- [ ] 类型检查：`npm run type-check`
- [ ] Lint：`npm run lint`
- [ ] 单元测试：`npm test`
- [ ] 手动验证：生成一份结果页，确认 iframe 内 Mermaid 渲染与字体加载正常

## 后续影响 / 注意事项

- 生成结果页不再依赖 jsDelivr，离线/内网环境渲染可用