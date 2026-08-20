// tests/e2e-tests/helpers/billing-db.ts
// 计费测试数据库 helper：直接连接 DB 预置/重置测试账户额度与访问记录（供 E2E 使用）。
//
// 设计（对齐团队约定「计费测试提前调整余额」）：
// - 常规计费/解题用例（需在余额充足下运行）→ 调用 setBalance(sub, 大值) 预留充足余量，
//   防止整轮 E2E 中途因余额不足中断（如 auth.setup 对共享账户 a0000000 预置 1000）。
// - 专测「余额不足」的用例 → setBalance(sub, 0/1) + clearUserAccess(sub) 精确构造触发条件
//   （清访问使题目变回「首次获取」，缓存命中 + settle 首次计费时触发扣费不足）。
//
// fail-soft：DATABASE_URL 未配置或连接失败时仅告警并返回 false，不阻断用例。

import { Client } from 'pg';

function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // 无 .env.local 则依赖进程 env
  }
}

/** 建立 DB 连接（DATABASE_URL 缺失返回 null） */
async function openClient(): Promise<Client | null> {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    console.warn('[E2E] billing-db 跳过：DATABASE_URL 未配置');
    return null;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function getUserId(
  client: Client,
  sub: string,
): Promise<string | undefined> {
  const user = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE sso_sub = $1',
    [sub],
  );
  return user.rows[0]?.id;
}

/** 将账户免费额度精确设为 freeBalance（不存在 quota 行则插入；DB 不可用返回 false） */
export async function setBalance(
  sub: string,
  freeBalance: number,
): Promise<boolean> {
  const client = await openClient();
  if (!client) return false;
  try {
    await client.query('BEGIN');
    const userId = await getUserId(client, sub);
    if (userId) {
      await client.query(
        `INSERT INTO quota_accounts (user_id, free_balance, recharge_balance)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_id)
         DO UPDATE SET free_balance = $2, recharge_balance = 0, updated_at = now()`,
        [userId, freeBalance],
      );
    }
    await client.query('COMMIT');
    return userId !== undefined;
  } catch (error) {
    await client.query('ROLLBACK');
    console.warn(`[E2E] setBalance(${sub}) 失败：`, error);
    return false;
  } finally {
    await client.end();
  }
}

/** 清空用户已获取访问记录（user_solution_access），用于构造「首次获取 → 计费/余额不足」场景 */
export async function clearUserAccess(sub: string): Promise<boolean> {
  const client = await openClient();
  if (!client) return false;
  try {
    await client.query('BEGIN');
    const userId = await getUserId(client, sub);
    if (userId) {
      await client.query('DELETE FROM user_solution_access WHERE user_id = $1', [
        userId,
      ]);
    }
    await client.query('COMMIT');
    return userId !== undefined;
  } catch (error) {
    await client.query('ROLLBACK');
    console.warn(`[E2E] clearUserAccess(${sub}) 失败：`, error);
    return false;
  } finally {
    await client.end();
  }
}