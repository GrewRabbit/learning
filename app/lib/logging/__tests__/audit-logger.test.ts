// app/lib/logging/__tests__/audit-logger.test.ts
// audit-logger 审计日志单元测试（架构 §8.4 AR2-010，FR-026/FR-022 脱敏）
// 覆盖：输出格式 [ISO 时间] [AUDIT] event {context}、context 字段（code/detail/subject）
//       正确输出、敏感 key（token/secret/code/state/session）传入即抛错（fail-fast）、
//       受控事件枚举完整性。spy console，不依赖真实输出流。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogger } from '@/app/lib/logging/audit-logger';

describe('auditLogger（AR2-010 审计日志）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('输出格式：[ISO 时间] [AUDIT] event（含 context JSON）', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    auditLogger.log('login.success', { subject: 'user-1' });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line = infoSpy.mock.calls[0][0] as string;
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[AUDIT\] login\.success \{"subject":"user-1"\}$/,
    );
  });

  it('context 含 code/detail/subject 时全部输出', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    auditLogger.log('login.failure', {
      code: 'AUTH_LOGIN_STATE_MISMATCH',
      detail: 'state 校验失败',
      subject: 'user-1',
    });

    const line = infoSpy.mock.calls[0][0] as string;
    expect(line).toContain('"code":"AUTH_LOGIN_STATE_MISMATCH"');
    expect(line).toContain('"detail":"state 校验失败"');
    expect(line).toContain('"subject":"user-1"');
  });

  it('无 context 时不输出 context 段', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    auditLogger.log('logout.completed');

    const line = infoSpy.mock.calls[0][0] as string;
    expect(line).toContain('[AUDIT] logout.completed');
    expect(line.endsWith('logout.completed')).toBe(true);
  });

  it('敏感 key（token/secret/code/state/session）传入 context → 抛错且不输出（FR-026/022）', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const sensitiveKeys = [
      'access_token',
      'refresh_token',
      'id_token',
      'code_verifier',
      'client_secret',
      'state',
      'session_id',
    ];

    for (const key of sensitiveKeys) {
      expect(() =>
        auditLogger.log('login.failure', { [key]: 'secret-value' } as unknown as never),
      ).toThrow(/禁止将敏感字段写入审计日志/);
    }
    // 全部抛错，未向 console 输出任何敏感内容
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('受控事件枚举：全部事件可正常输出（禁用自由字符串）', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const events = [
      'login.success',
      'login.failure',
      'logout.completed',
      'logout.revoke_failed',
      'token.invalid_grant',
      'auth.session_invalid',
    ] as const;

    for (const event of events) {
      auditLogger.log(event);
    }

    expect(infoSpy).toHaveBeenCalledTimes(events.length);
    for (let i = 0; i < events.length; i += 1) {
      expect(infoSpy.mock.calls[i][0] as string).toContain(`[AUDIT] ${events[i]}`);
    }
  });
});
