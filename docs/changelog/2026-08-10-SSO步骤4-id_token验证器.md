# SSO 步骤4：id_token 验证器（id-token-verifier）

**日期**：2026-08-10
**类型**：新增
**影响范围**：`app/lib/sso/id-token-verifier.ts`（模块 M2）；登录回调流程（步骤 5 callback-flow 复用）

## 变更背景

实施 SSO 集成步骤 4（架构 §11 步骤 4 / 模块 M2）：OIDC id_token 8 步验证器。登录回调获取 id_token 后须按 spec-sso-auth FR-011 完成 8 步验证（格式 / 算法白名单 / JWKS 匹配 / 签名 / iss / aud / exp / nonce），并支持 `ID_TOKEN_VERIFY_MODE` strict/soft 两档（FR-011、AC-012/AC-013）。

## 变更内容

### `app/lib/sso/id-token-verifier.ts`（新服务层模块 M2）

- 导出 `class IdTokenVerifier`（构造注入 `{ fetchFn? }`，fetchFn 注入时创建独立 DiscoveryService 便于单测 mock）+ 单例 `export const idTokenVerifier`
- `verifyIdToken(idToken, expectedNonce?): Promise<ServiceResult<IdTokenClaims>>` 按 8 步验证：
  ① JWT 三段格式（decodeProtectedHeader 抛错 → 失败）；② alg 白名单仅 `RS256`（拒绝 none/HS256）；③ 按 `kid` 经 `discoveryService.getJwks(kid)` 取公钥（kid 未命中自动刷新缓存重取，FR-012）；④ `importJWK` + `jwtVerify({algorithms:['RS256']})` 验签；⑤ iss 与 `SSO_ISSUER` 一致；⑥ aud 含 `SSO_CLIENT_ID`；⑦ exp 未过期（`CLOCK_TOLERANCE_SECONDS=60`）；⑧ nonce 手动比对（payload.nonce === expectedNonce）
- strict（默认）任一失败 → `{success:false, error:{code:'AUTH_ID_TOKEN_INVALID'}}`；soft → logger.warn + decodeJwt 尽力解析返回 success（AC-013）
- **关键实现偏差**：jose v6.2.8 的 `JWTClaimVerificationOptions` 无 nonce 选项（静默忽略未知选项），第 8 步改为验证后手动比对 payload.nonce

### 测试（`app/lib/sso/__tests__/id-token-verifier.test.ts`，16 例）

- AC-012 参数化 8 项 strict 拒绝（格式错误 / alg=none / kid 不匹配后 JWKS 刷新重试成功 / 刷新仍无 / 签名错误 / iss 不符 / aud 不含 client_id / exp 过期 120s）
- 成功 3 例（真实 SignJWT + RSA 密钥 + JWKS mock）；时钟容差（过期 <60s 通过）；AC-013 soft 3 例

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `app/lib/sso/id-token-verifier.ts` | 新增 | id_token 8 步验证器（strict/soft） |
| `app/lib/sso/__tests__/id-token-verifier.test.ts` | 新增 | 16 个单元测试（AC-012/AC-013） |

## 配置 / 环境变量变化

无（复用 `ID_TOKEN_VERIFY_MODE` 与 `SSO_ISSUER`/`SSO_CLIENT_ID`，见步骤 1 changelog）。

## 验证方式

- [x] 类型检查：`npm run type-check`
- [x] 单元测试：`npm test`（lib/sso 全绿）
- [x] Lint：`npm run lint`
- [x] 手动验证：无（纯服务层，随步骤 5 回调流程联调）

## 后续影响 / 注意事项

- 被 `callback-flow.ts`（步骤 5）在令牌交换后调用；strict 模式下验证失败拒绝登录
- jose v6.2.8 nonce 无内建支持为手动比对，后续升级 jose 时复查是否提供该选项
