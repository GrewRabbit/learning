# CI/CD 流水线规范

> 适用角色：`nextjs-devops-expert` | 优先级：中

---

## 一、流水线阶段

```
代码提交 → 类型检查 → Lint → 单元测试 → 构建 → 集成测试 → E2E 测试 → 部署
```

---

## 二、GitHub Actions 工作流

### PR 检查流水线（每次 PR 触发）

```yaml
name: PR Check
on: [pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsc --noEmit        # 类型检查
      - run: npm run lint            # Lint
      - run: npm test                # 单元测试
      - run: npm run build           # 构建验证
```

### 部署流水线（合并到 main 后触发）

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: npm run test:e2e        # E2E 测试
      # 部署步骤根据目标平台配置
```

---

## 三、Docker 构建

使用 Next.js 官方推荐的多阶段构建：

```
Stage 1: 依赖安装（npm ci）
Stage 2: 构建（npm run build + standalone 模式）
Stage 3: 运行时（node server.js，最小镜像）
```

关键配置：
- `output: 'standalone'`（`next.config.ts`）
- 运行阶段仅复制 `.next/standalone` + `.next/static` + `public/`
- 以非 root 用户运行

---

## 四、关键禁止事项

- **禁止**跳过类型检查或测试直接部署
- **禁止**在 CI 环境中使用 `.env.local`（使用 CI Secrets）
- **禁止**将构建产物提交到版本控制
- **禁止**在流水线中硬编码敏感信息