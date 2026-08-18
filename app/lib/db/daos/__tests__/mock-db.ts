// app/lib/db/daos/__tests__/mock-db.ts
// drizzle 链式调用 mock 构造器（仅测试用，禁止连真实库）
//
// 覆盖 DAO 用到的链式形态：
// - insert(t).values(v)                                     （普通 insert，可直接 await）
// - insert(t).values(v).onConflictDoNothing({ target }).returning(fields)
// - insert(t).values(v).onConflictDoUpdate({ target, set })
// - select(fields).from(t).where(cond).limit(1)
// - update(t).set(values).where(cond)
// - execute(sql)（deductFreeFirst 单条 CASE WHEN 用）
//
// 按调用顺序记录 ops：insert 在 values() 时即记录（conflict 初始 'none'），
// 后续 onConflictDoNothing/DoUpdate 回填冲突策略，供断言表对象、
// 冲突策略（AR1-001）与字段映射。

import { vi } from 'vitest';

/** insert 链路记录（conflict 区分 DO UPDATE / DO NOTHING / 无冲突子句，AR1-001） */
export interface InsertOp {
  op: 'insert';
  /** 表对象（与 schema 导出对象做同一性比较） */
  table: unknown;
  values: Record<string, unknown>;
  conflict: 'doUpdate' | 'doNothing' | 'none';
  target: unknown;
  set: Record<string, unknown> | undefined;
}

/** select 链路记录 */
export interface SelectOp {
  op: 'select';
  table: unknown;
  fields: unknown;
  /** 实际返回的行（由 selectRows 按表配置） */
  rows: readonly unknown[];
}

/** update 链路记录 */
export interface UpdateOp {
  op: 'update';
  table: unknown;
  set: Record<string, unknown>;
}

export type DbOp = InsertOp | SelectOp | UpdateOp;

export interface CreateMockDbOptions {
  /** select 按 table 返回的行（未配置的表返回 []） */
  selectRows?: ReadonlyMap<unknown, readonly unknown[]>;
  /** insert ... returning 按表返回的行（空数组 = 冲突跳过/未插入） */
  insertReturningRows?: ReadonlyMap<unknown, readonly unknown[]>;
  /** execute(sql) 返回的 rows（deductFreeFirst 的 RETURNING 结果） */
  executeRows?: readonly unknown[];
}

export interface MockDb {
  /** 链式 mock 对象（作 getDb() 返回值或事务 tx 注入值） */
  db: Record<string, unknown>;
  /** 按调用顺序记录的操作（断言用） */
  ops: DbOp[];
  /** execute(sql) 的 mock 函数（断言 SQL 形态用） */
  execute: ReturnType<typeof vi.fn>;
}

/** 构造链式 mock db（含 select/insert/update/execute） */
export function createMockDb(options: CreateMockDbOptions = {}): MockDb {
  const ops: DbOp[] = [];
  const execute = vi.fn(async () => ({ rows: [...(options.executeRows ?? [])] }));

  const db: Record<string, unknown> = {
    execute,
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const record: InsertOp = {
          op: 'insert',
          table,
          values,
          conflict: 'none',
          target: undefined,
          set: undefined,
        };
        ops.push(record);
        return {
          // 普通 insert 可直接 await（drizzle 的 values 结果本身是 thenable builder）
          then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown): Promise<unknown> =>
            Promise.resolve({ rows: [] }).then(resolve, reject),
          onConflictDoNothing: (config?: { target?: unknown }) => {
            record.conflict = 'doNothing';
            record.target = config?.target;
            return {
              returning: (): Promise<unknown[]> => {
                const rows = options.insertReturningRows?.get(table) ?? [];
                return Promise.resolve([...rows]);
              },
            };
          },
          onConflictDoUpdate: (config: { target: unknown; set: Record<string, unknown> }) => {
            record.conflict = 'doUpdate';
            record.target = config.target;
            record.set = config.set;
            return Promise.resolve({ rows: [] });
          },
        };
      },
    }),
    select: (fields: unknown) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: (): Promise<unknown[]> => {
            const rows = options.selectRows?.get(table) ?? [];
            ops.push({ op: 'select', table, fields, rows });
            return Promise.resolve([...rows]);
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          ops.push({ op: 'update', table, set });
          return Promise.resolve({ rows: [] });
        },
      }),
    }),
  };

  return { db, ops, execute };
}

/** 包装为带 transaction 的 getDb 返回值；默认以 mock db 自身作为 tx 执行回调 */
export function attachTransaction(
  db: Record<string, unknown>,
  behavior?: () => Promise<unknown>,
): Record<string, unknown> {
  return {
    ...db,
    transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>): Promise<unknown> => {
      if (behavior !== undefined) {
        return behavior();
      }
      return callback(db);
    },
  };
}

/** 构造带 code 的连接类错误 */
export function connectionError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
