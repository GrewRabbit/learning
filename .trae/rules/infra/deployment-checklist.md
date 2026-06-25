# 部署上线检查清单

> 适用角色：`nextjs-devops-expert`、`nextjs-dev-expert`
> 优先级：中

---

## 一、构建前检查

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm run lint` 无警告
- [ ] 所有单元测试通过
- [ ] 集成测试通过（如有）
- [ ] `.env.production` 配置完整且未提交到版本控制
- [ ] `next.config.ts` 中 `output: 'standalone'`（如使用 Docker）

---

## 二、构建后验证

- [ ] `npm run build` 成功无错误
- [ ] `npm run start` 在本地生产模式正常运行
- [ ] E2E 测试通过（关键流程 `@critical`）
- [ ] 页面无 404 或 500 错误

---

## 三、安全配置

- [ ] CSP 头已配置（`next.config.ts` 中 `headers()`）
- [ ] 安全响应头已设置：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`
- [ ] Cookie 配置：`httpOnly` + `secure`（生产）+ `sameSite: 'lax'`
- [ ] 无 `NEXT_PUBLIC_` 变量包含敏感信息
- [ ] 服务端渲染页面无敏感数据泄露

---

## 四、性能优化

- [ ] 图片使用 `next/image` 组件（懒加载 + 自动优化）
- [ ] 字体使用 `next/font`（无外部请求）
- [ ] 动态导入大型非首屏组件（`next/dynamic`）
- [ ] Lighthouse 核心指标达标（LCP < 2.5s, FID < 100ms, CLS < 0.1）

---

## 五、监控与日志

- [ ] 应用日志输出到日志聚合平台
- [ ] 错误监控已配置（如 Sentry）
- [ ] 健康检查端点可用（`/api/health`）

---

## 六、回滚准备

- [ ] 上一版本构建产物已备份
- [ ] 数据库迁移有回滚方案
- [ ] 回滚步骤已文档化