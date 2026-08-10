// app/lib/logging/audit-logger.ts
// SSO 审计日志（架构 §8.4 可观测性，AR2-010；token spec NFR-006）
// - 记录 SSO 安全事件：登录成功/失败、登出、刷新 invalid_grant 安全告警
// - 与 logger 独立存在：logger 面向应用运行日志，auditLogger 面向安全审计（不可互相替代）
// - 仅 API/Server Action 层调用（route handlers：callback/logout/refresh，及 guard/token-refresher 告警处）
// - 脱敏约束（FR-026/FR-022）：禁止把 access_token/refresh_token/id_token、code、state、
//   code_verifier、client_secret、会话标识写入 context——这些敏感值绝不进入审计日志

/** 受控审计事件名（禁用自由字符串，架构 AR2-010） */
export type AuditEvent =
  | 'login.success' // 登录成功（subject 记录 id_token 的 sub）
  | 'login.failure' // 登录失败（code 关联 AUTH_* 错误码）
  | 'logout.completed' // 登出完成（revoke 后）
  | 'logout.revoke_failed' // revoke 失败（不阻断登出，FR-020）
  | 'token.invalid_grant' // 刷新收到 invalid_grant 安全告警（FR-009，最重要）
  | 'auth.session_invalid'; // 受保护 API 会话校验失败（guard，AUTH_SESSION_INVALID）

/**
 * 审计 context：仅含非敏感字段
 * - code：关联错误码（AUTH_*，token spec FR-025）
 * - detail：脱敏后的简要描述（禁止含 token/state/code_verifier 等明文）
 * - subject：事件主体（如 id_token/userinfo 的 sub——公开标识可记录，FR-026）
 */
export interface AuditContext {
  code?: string;
  detail?: string;
  subject?: string;
}

/**
 * 敏感字段 key 黑名单（防御性声明，FR-026/022）：命中即拒绝写入审计日志。
 * 注意不含裸 'code'——AuditContext.code 承载 AUTH_* 错误码（合法字段）；
 * 授权码等敏感值由下方 ERROR_CODE_PATTERN 对 code 值做格式校验拦截。
 */
const SENSITIVE_KEY_PATTERN = /token|secret|state|session|code_verifier/i;

/** 错误码格式（naming-conventions 错误码规范）：AUTH_* 大写枚举。code 值不符合即视为敏感值泄漏（如 OAuth 授权码） */
const ERROR_CODE_PATTERN = /^AUTH_[A-Z_]+$/;

/** 审计行格式：[ISO 时间] [AUDIT] <event> {<context>} */
function formatAudit(event: AuditEvent, context?: AuditContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [AUDIT] ${event}${contextStr}`;
}

/**
 * 审计日志单例（架构 AR2-010）
 * 调用约束：
 * 1. 仅 API/Server Action 层调用（route handlers：callback/logout/refresh，及 guard/token-refresher 告警处）
 * 2. event 必须为 AuditEvent 受控枚举
 * 3. context 禁止含敏感值——access_token/refresh_token/id_token、code、state、
 *    code_verifier、client_secret、会话标识一律不得写入（FR-026/FR-022）；
 *    本模块对 context key 做黑名单拦截，误用即抛错（fail-fast）
 */
export const auditLogger = {
  log(event: AuditEvent, context?: AuditContext): void {
    if (context) {
      for (const key of Object.keys(context)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          throw new Error(`auditLogger: 禁止将敏感字段写入审计日志: ${key}`);
        }
      }
      // code 仅允许 AUTH_* 错误码：OAuth 授权码、token 值等敏感明文无法通过该校验（FR-026/022）
      if (context.code !== undefined && !ERROR_CODE_PATTERN.test(context.code)) {
        throw new Error('auditLogger: code 字段仅允许 AUTH_* 错误码，禁止写入敏感值');
      }
    }
    console.info(formatAudit(event, context));
  },
};
