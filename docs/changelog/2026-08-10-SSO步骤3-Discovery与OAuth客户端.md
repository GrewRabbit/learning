# SSO 步骤 3：Discovery / JWKS 与 OAuth Client

**日期**：2026-08-10
**类型**：新增
**影响范围**：`app/lib/sso/discovery-service.ts`、`app/lib/sso/oauth-client.ts` 及测试

## 变更背景

实施 SSO 集成架构 §11 步骤 3（模块 M2）：SP 与 IDP 的协议层交互。所有 IDP 端点必须取自 Discovery 响应（禁止硬编码，auth spec FR-014），token 端点 / userinfo / revoke / end_session 调用全部在服务端执行（CSP `connect-src 'self'` 约束，浏览器不直连 IDP）。

## 变更内容

### `app/lib/sso/discovery-service.ts`（新增）

- `class DiscoveryService`（构造注入 `{ fetchFn? }`，便于单测 mock）+ `export const discoveryService` 单例
- `getIssuer()` / `getEndpoint(name: DiscoveryEndpoint): Promise<ServiceResult<string>>` / `getJwks(kid?): Promise<ServiceResult<JsonWebKeySet>>` / `clearCache()`
- GET `{issuer}/.well-known/openid-configuration`；校验返回 `issuer` 与配置 `SSO_ISSUER` 一致；端点缺失/issuer 不符/非 2xx/JSON 解析失败 → `AUTH_IDP_DISCOVERY_FAILED`
- 10s 超时 + 重试（`min(retryMax,3)`，429 按 Retry-After、指数退避 100ms 底、封顶 3s）
- Discovery 文档与 JWKS 均缓存 1h；`getJwks(kid)` 若 kid 未命中强制刷新缓存重取一次（防密钥轮换，FR-012）

### `app/lib/sso/oauth-client.ts`（新增）

- `class OAuthClient`（注入 fetchFn）+ `export const oauthClient` 单例
- `exchangeCode(p)`：authorization_code 交换（code + redirect_uri + client_id + client_secret + code_verifier，URLSearchParams urlencoded）；校验 access_token/id_token 为 string、token_type=bearer，否则 `AUTH_TOKEN_EXCHANGE_FAILED`
- `refreshToken(p)`：refresh_token 轮换（scope 用 `p.scope ?? getSsoConfig().scope`）
- `getUserInfo(accessToken)`：Bearer 调 userinfo，返回 `ServiceResult<IdTokenClaims>`
- `revokeToken(token, hint)`：revoke（400 幂等成功，RFC 7009）
- `callEndSession(p)`：end_session，返回 `ServiceResult<{ url }>`；端点缺失 → `AUTH_IDP_DISCOVERY_FAILED`
- 错误映射：网络/超时 → `AUTH_IDP_UNREACHABLE`；exchange 遇 invalid_grant → `AUTH_TOKEN_EXCHANGE_FAILED`、refresh 遇 invalid_grant → `AUTH_INVALID_GRANT`；其他 → `AUTH_IDP_ERROR`；429 重试耗尽 → `AUTH_IDP_RATE_LIMITED`

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `app/lib/sso/discovery-service.ts` | 新增 | Discovery / JWKS 获取与缓存 |
| `app/lib/sso/oauth-client.ts` | 新增 | token / userinfo / revoke / end_session 客户端 |
| `app/lib/sso/__tests__/discovery-service.test.ts` | 新增 | 12 用例 |
| `app/lib/sso/__tests__/oauth-client.test.ts` | 新增 | 17 用例 |

## 配置 / 环境变量变化

无

## 验证方式

- [x] 类型检查：`npm run type-check`
- [x] Lint：`npm run lint`
- [x] 定向测试：`npx vitest run app/lib/sso`（59 passed，含步骤 2 用例）
- [x] 全量：`npm test`（无回归）

## 后续影响 / 注意事项

- 与既有代码一致采用 `ServiceResult<T>` 非判别联合，消费处显式守卫（同 image-recognizer.ts 模式）
- 429 重试耗尽错误码用 `AUTH_IDP_RATE_LIMITED`；`getJwks` 较架构增加可选 kid 参数（kid 未命中刷新重取，FR-012）
