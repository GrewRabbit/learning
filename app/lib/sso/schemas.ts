// app/lib/sso/schemas.ts
// SSO 输入参数 Zod 校验（架构 §11，SSO 集成步骤 2，模块 M2）
// 覆盖：authorize 表单提交、OIDC 回调 query 参数

import { z } from 'zod';

// base64url 字符集（RFC 4648 §5，无填充）；S256 code_challenge 为 32 字节 SHA-256
// 摘要的 base64url 编码，恒为 43 字符（RFC 7636 §4.2）
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 同源相对路径校验：以 / 开头、非 //、非 javascript:/data: 等危险协议（防止开放重定向） */
const returnToSchema = z
  .string()
  .min(1, 'returnTo 不能为空')
  .refine(
    (value) =>
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !/^javascript:/i.test(value) &&
      !/^data:/i.test(value),
    {
      message: 'returnTo 必须是同源相对路径（以 / 开头，禁止 //、javascript:、data:）',
    },
  )
  .optional();

/** 登录表单（authorize 请求前置参数）Schema */
export const authorizeFormSchema = z.object({
  // PKCE code_verifier：43-128 位，仅允许 A-Za-z0-9-._~（RFC 7636 §4.1）
  code_verifier: z
    .string()
    .min(43, 'code_verifier 长度不得小于 43')
    .max(128, 'code_verifier 长度不得大于 128')
    .regex(/^[A-Za-z0-9\-._~]+$/, 'code_verifier 含非法字符'),
  // PKCE code_challenge：S256 模式，base64url 编码，恒为 43 字符（RFC 7636 §4.2）
  code_challenge: z
    .string()
    .length(43, 'code_challenge 必须是 S256 base64url（43 字符）')
    .regex(BASE64URL_PATTERN, 'code_challenge 必须是 base64url 字符集'),
  // CSRF 防护 state：至少 32 字符
  state: z.string().min(32, 'state 长度不得小于 32'),
  // 防重放 nonce：至少 32 字符（spec-sso-auth FR-002）
  nonce: z.string().min(32, 'nonce 长度不得小于 32'),
  // 同源回跳路径（可选）
  returnTo: returnToSchema,
});

/** OIDC 回调（callback 页 query 参数）Schema */
export const callbackQuerySchema = z.object({
  code: z.string(),
  state: z.string(),
  iss: z.string(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/**
 * 登出表单（/api/sso/logout）Schema（FR-019：登出参数为用户可控输入须 Zod 校验）
 * 仅校验格式与长度；同源/白名单语义由 logout-service.isLogoutRedirectAllowed 裁决
 * （FR-022/023，空白名单判断与开放重定向防御合并在服务层，单一事实来源）
 */
export const logoutFormSchema = z.object({
  post_logout_redirect_uri: z
    .string()
    .max(2048, 'post_logout_redirect_uri 长度超出限制')
    .optional(),
});

/** authorize 表单派生类型 */
export type AuthorizeForm = z.infer<typeof authorizeFormSchema>;

/** 回调 query 派生类型 */
export type CallbackQuery = z.infer<typeof callbackQuerySchema>;