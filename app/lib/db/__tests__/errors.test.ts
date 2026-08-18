// app/lib/db/__tests__/errors.test.ts
// DB 错误分类单元测试（架构 §5.3 / §4.2 连接类故障集合；全 mock，不连真实库）

import { describe, test, expect } from 'vitest';
import {
  classifyDbError,
  isDbUnavailable,
  isForeignKeyViolation,
  isUniqueViolation,
} from '@/app/lib/db/errors';

/** 构造带 code 的 pg 风格错误 */
function pgError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe('isDbUnavailable（连接类故障判定）', () => {
  test.each([
    ['ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432'],
    ['ECONNRESET', 'read ECONNRESET'],
    ['ETIMEDOUT', 'connect ETIMEDOUT'],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.invalid'],
    ['28P01', 'password authentication failed for user "gesp6"'],
    ['28000', 'no pg_hba.conf entry for host'],
    ['57P03', 'the database system is starting up'],
    ['57P01', 'terminating connection due to administrator command'],
    ['53300', 'sorry, too many clients already'],
    ['57014', 'canceling statement due to statement timeout'],
  ])('pg 错误 code=%s → true', (code, message) => {
    expect(isDbUnavailable(pgError(code, message))).toBe(true);
  });

  test('getDbConfig 抛出的 DATABASE_URL 未配置错误（message 含 GESP6_DB_UNAVAILABLE）→ true', () => {
    expect(isDbUnavailable(new Error('GESP6_DB_UNAVAILABLE: DATABASE_URL 未配置'))).toBe(true);
  });

  test('连接超时类 Error message（无 code）→ true', () => {
    expect(isDbUnavailable(new Error('timeout expired when trying to connect'))).toBe(true);
    expect(isDbUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  test('语句超时类 Error message（无 code，drizzle 包装层丢失 SQLSTATE 时兜底）→ true', () => {
    expect(isDbUnavailable(new Error('canceling statement due to statement timeout'))).toBe(true);
  });

  test('普通业务错误（无连接类 code/message）→ false', () => {
    expect(isDbUnavailable(new Error('字段校验失败'))).toBe(false);
    expect(isDbUnavailable(pgError('23505', 'duplicate key value violates unique constraint'))).toBe(false);
  });

  test('非 Error 输入（string/undefined/普通对象）→ false', () => {
    expect(isDbUnavailable('ECONNREFUSED')).toBe(false);
    expect(isDbUnavailable(undefined)).toBe(false);
    expect(isDbUnavailable({ code: 'ECONNREFUSED' })).toBe(true); // 结构化 code 仍可判定
  });
});

describe('classifyDbError（两域映射）', () => {
  test('连接类错误 + generic 域 → GESP6_DB_UNAVAILABLE', () => {
    expect(classifyDbError(pgError('ECONNREFUSED', 'connect ECONNREFUSED'), 'generic')).toEqual({
      code: 'GESP6_DB_UNAVAILABLE',
    });
  });

  test('连接类错误 + billing 域 → GESP6_BILLING_DB_UNAVAILABLE', () => {
    expect(classifyDbError(pgError('53300', 'too many connections'), 'billing')).toEqual({
      code: 'GESP6_BILLING_DB_UNAVAILABLE',
    });
    expect(
      classifyDbError(new Error('GESP6_DB_UNAVAILABLE: DATABASE_URL 未配置'), 'billing'),
    ).toEqual({ code: 'GESP6_BILLING_DB_UNAVAILABLE' });
  });

  test('非连接类错误 → null（透传给调用方归类，不吞错）', () => {
    expect(classifyDbError(new Error('余额写入失败'), 'billing')).toBeNull();
    expect(classifyDbError(pgError('23505', 'duplicate key'), 'generic')).toBeNull();
  });
});

describe('isUniqueViolation（pg SQLSTATE 23505）', () => {
  test('code=23505 → true', () => {
    expect(isUniqueViolation(pgError('23505', 'duplicate key value violates unique constraint'))).toBe(true);
  });

  test('其他 code / 普通 Error / 非 Error 输入 → false', () => {
    expect(isUniqueViolation(pgError('23503', 'violates foreign key constraint'))).toBe(false);
    expect(isUniqueViolation(new Error('字段校验失败'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe('isForeignKeyViolation（pg SQLSTATE 23503）', () => {
  test('code=23503 → true', () => {
    expect(isForeignKeyViolation(pgError('23503', 'insert or update on table violates foreign key constraint'))).toBe(true);
  });

  test('其他 code / 普通 Error / 非 Error 输入 → false', () => {
    expect(isForeignKeyViolation(pgError('23505', 'duplicate key'))).toBe(false);
    expect(isForeignKeyViolation(new Error('字段校验失败'))).toBe(false);
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true); // 与 isDbUnavailable 一致：结构化 code 可判定
  });
});
