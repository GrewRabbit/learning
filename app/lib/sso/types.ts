// app/lib/sso/types.ts
// SSO 集成共享类型定义（架构 §11，SSO 集成步骤 2，模块 M2/M8）
// 纯类型文件：仅导出类型，不包含运行时逻辑；跨模块引用一律 import type

/** ID token 验证模式：strict 拒登 / soft 记日志降级 */
export type IdTokenVerifyMode = 'strict' | 'soft';

/** SSO 运行配置（由 getSsoEnv() 映射而来，模块级缓存，见 config.ts） */
export interface SsoConfig {
  /** 服务端 issuer（SSO_ISSUER，Discovery/iss 校验契约） */
  issuer: string;
  /** 服务端 client_id（SSO_CLIENT_ID，Node 侧权威） */
  clientId: string;
  /** 服务端 client_secret（SSO_CLIENT_SECRET，mock 模式可缺省；仅 Node 层引用） */
  clientSecret?: string;
  /** id_token 验证模式：strict 拒登 / soft 记日志 */
  idTokenVerifyMode: IdTokenVerifyMode;
  /** refresh_token cookie 持久化天数 */
  refreshTokenMaxAgeDays: number;
  /** mock IDP 开关（测试/联调环境） */
  mockEnabled: boolean;
  /** IDP 调用重试上限 */
  retryMax: number;
  /** 浏览器可见 scope（必含 openid + offline_access） */
  scope: string;
  /** 浏览器可见：IDP issuer（NEXT_PUBLIC_SSO_ISSUER） */
  publicIssuer?: string;
  /** 浏览器可见：client_id（NEXT_PUBLIC_SSO_CLIENT_ID） */
  publicClientId?: string;
  /** 浏览器可见：回调地址（NEXT_PUBLIC_SSO_REDIRECT_URI） */
  publicRedirectUri?: string;
  /**
   * 登出后重定向白名单（OQ-007 默认方案 A：仅首页 '/'；集中定义于 config.ts）
   * FR-022：post_logout_redirect_uri 须命中该注册列表；为空时回退 redirectUris（publicRedirectUri）
   */
  logoutRedirectWhitelist?: string[];
}

/** OIDC token 端点响应（RFC 6749 §5.1 + OIDC Core §3.1.3.3） */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  /** 仅 token 交换响应必含；刷新响应不返回 id_token（FR-008） */
  id_token?: string;
  scope?: string;
}

/** ID Token 解析后的标准声明（OIDC Core §2，含 groups 扩展声明） */
export interface IdTokenClaims {
  /** 主体标识（用户在 IDP 的唯一 ID） */
  sub: string;
  /** 签发者（必须与 SsoConfig.issuer 一致） */
  iss: string;
  /** 受众（必须包含 client_id） */
  aud: string | string[];
  /** 过期时间（Unix 秒） */
  exp: number;
  /** 签发时间（Unix 秒） */
  iat: number;
  /** 防重放 nonce（与授权请求发出的一致） */
  nonce?: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  /** 用户组（扩展声明，供授权判断） */
  groups?: string[];
}

/** Access Token JWT 声明（部分 IDP 签发 JWT 格式 access_token 时使用） */
export interface AccessTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  /** 认证时间 */
  auth_time?: number;
  /** 会话 ID */
  sid?: string;
  scope?: string;
  /** 允许承载 IDP 附加声明，不强制全部字段 */
  [key: string]: unknown;
}

/** 授权码换令牌参数（token 端点请求体） */
export interface ExchangeCodeParams {
  /** 授权码（回调时 IDP 下发） */
  code: string;
  /** PKCE code_verifier（与授权请求发出的一致，S256 校验） */
  code_verifier: string;
  /** 回调地址（必须与授权请求一致） */
  redirect_uri: string;
}

/** 刷新令牌参数（token 端点 refresh_token grant） */
export interface RefreshTokenParams {
  refresh_token: string;
  scope?: string;
}

/** 登出（end_session）参数（OIDC RP-Initiated Logout） */
export interface EndSessionParams {
  /** 当前 id_token（用于标识要终结的会话） */
  idTokenHint?: string;
  /** 登出后跳转地址（需在 IDP 白名单内） */
  postLogoutRedirectUri?: string;
  /** 防 CSRF 状态值（与登出请求发出的一致） */
  state?: string;
}

/** Discovery 文档标准端点名（OIDC Discovery §4） */
export type DiscoveryEndpoint =
  | 'authorization_endpoint'
  | 'token_endpoint'
  | 'userinfo_endpoint'
  | 'revocation_endpoint'
  | 'end_session_endpoint'
  | 'jwks_uri';

/** 宽松 Discovery 文档：标准端点 + 允许额外字段 */
export type DiscoveryDocument = Partial<Record<DiscoveryEndpoint, string>> & {
  [key: string]: unknown;
};

/** JWKS 响应体（密钥集合；keys 元素结构宽松，后续验证逻辑按需解析） */
export interface JsonWebKeySet {
  keys: unknown[];
}

/** access_token / refresh_token / id_token cookie 持久化载荷 */
export interface TokenCookieData {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  /** 过期时刻（Unix 秒） */
  expiresAt: number;
  /** refresh_token 过期时刻（Unix 秒），有 refreshToken 时存在 */
  refreshExpiresAt?: number;
}

/** 发起授权（authorize）所需的 PKCE/状态参数（登录按钮生成） */
export interface AuthorizeParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
  /** 登录成功后的同源回跳路径（可选，默认为首页） */
  returnTo?: string;
}