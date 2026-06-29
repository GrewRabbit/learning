# iframe 渲染 CSP 修复（流程图/思维导图/复制按钮失效）

**日期**：2026-06-30
**类型**：修复
**影响范围**：`/result` 页面 iframe 内 Mermaid 流程图/思维导图渲染、复制代码按钮

## 变更背景

用户反馈 `/result` 页面中：
1. 流程图和思维导图不显示（本地直接打开 HTML 文件正常）
2. "六、完整代码"区域的复制代码按钮点击无反应（本地打开 HTML 文件正常）

经排查，**两个问题同一根因**：

`HtmlRenderer` 使用 `<iframe sandbox="allow-scripts" srcDoc={html}>` 渲染 LLM 生成的 HTML。根据 W3C CSP 规范（[initialize-document-csp](https://w3c.github.io/webappsec-csp/#initialize-document-csp)），**srcDoc iframe 会继承父页面的 CSP**。

原 `next.config.ts` 父页 CSP 为 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`，**不允许 `https://cdn.jsdelivr.net`**，导致：
- iframe 内 `<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js">` 被 CSP 拦截
- 抛出 `mermaid is not defined` 错误，中断后续脚本执行
- `initCopyButtons()` 未执行，复制按钮无事件绑定

原设计试图通过 iframe 的 `csp` DOM 属性 + meta CSP 注入绕开父页 CSP，但实测两者均无法覆盖继承的父页 CSP。

## 变更内容

### next.config.ts — 父页 CSP 放行 jsdelivr

- `script-src` 增加 `https://cdn.jsdelivr.net`（dev/prod 均加）
- `font-src` 增加 `https://cdn.jsdelivr.net`（LLM 生成的 HTML 通过 jsdelivr 加载 Outfit/JetBrainsMono 字体）
- 更新注释，说明 srcDoc iframe 继承父页 CSP 的规范行为

### app/result/components/html-renderer.tsx — 移除无效的 csp 属性

- 移除 `IFRAME_CSP` 常量与 `csp` 属性（React 19 虽能渲染到 DOM，但浏览器不用于限制 srcDoc 文档）
- 移除 `@ts-expect-error` 与相关注释
- 更新组件 JSDoc，说明 CSP 由父页 next.config.ts 控制

## 安全权衡

- 父页放行 jsdelivr 后，理论上父页本身也可加载 jsdelivr 脚本。但：
  - 父页是 Next.js 内部工具，React 自动转义降低 XSS 风险
  - jsdelivr 是可信 npm CDN，攻击者需先发布恶意 npm 包
  - iframe `sandbox="allow-scripts"`（无 `allow-same-origin`）使 iframe 为 opaque origin，即使加载恶意脚本也无法访问父页 DOM/Cookie
- 综合评估：风险可接受，且为 srcDoc 继承机制的必要妥协

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `next.config.ts` | 修改 | CSP `script-src`/`font-src` 增加 `https://cdn.jsdelivr.net` |
| `app/result/components/html-renderer.tsx` | 修改 | 移除无效的 `csp` 属性与 `IFRAME_CSP` 常量，更新注释 |

## 配置 / 环境变量变化

无

## 验证方式

- [x] 类型检查：`npx tsc --noEmit`（0 errors）
- [x] Lint：`npm run lint`（0 warnings）
- [x] 单元测试：`npm test`（102 passed, 4 skipped）
- [x] 端到端验证（Playwright 访问 `/result`，注入 sessionStorage）：
  - iframe 内 `window.mermaid` 已加载（`typeof === 'object'`）
  - SVG 数量 = 2（流程图 + 思维导图均渲染）
  - iframe console 无错误
  - 复制按钮点击后父页剪贴板读取到 1226 字符 C++ 代码（`#include <bits/stdc++.h>...`）

## 后续影响 / 注意事项

- **用户需重启 dev server**：`next.config.ts` 修改不会热重载，必须重启 `npm run dev` 才能生效
- **生产部署**：prod 环境 CSP 同样放行 jsdelivr，无需额外配置
- **架构文档 §8.2 偏差**：原架构设计假设"iframe csp 属性独立控制 srcDoc CSP"，实际 srcDoc 继承父页 CSP。后续架构文档修订时需补充此规范行为说明
