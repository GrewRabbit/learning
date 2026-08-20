// scripts/migrate-fs-cache-to-db.ts
// 一次性导入：.data/gesp6/ 存量缓存 → PostgreSQL 3 张缓存表（D6，FR-023~026）
// 运行：npm run db:import（= tsx scripts/migrate-fs-cache-to-db.ts）
// 退出码：0 = 全部成功（含 skipped）；1 = 存在失败（GESP6_MIGRATION_VALIDATION_FAILED 语义，FR-033）
//
// 与设计文档 arch-db-integration-import.md 的两处等价实现偏差（实施决策，报告中说明）：
// 1. §3「每批一事务」→ 逐行调用 solutionDao.insertIfAbsent*（T2 定稿签名不收 tx 参数）：
//    pg 单条 INSERT ... ON CONFLICT DO NOTHING 语句本身原子；批次（≤500）仅作进度分片，
//    失败隔离粒度细化到行——单行 FK 违反（悬空索引，§2.4）/IO 异常仅该行入失败清单，
//    其余行继续导入（FR-025c）。108+22+9 行规模下单行语句开销可忽略，
//    DO NOTHING 幂等不依赖跨行原子性。
// 2. §2.1 createdAt「ISO 直接写入」→ DAO 签名不携带 createdAt，由 schema defaultNow()
//    兜底（与「缺失/非法 → now()」语义一致）；扫描期仍做 createdAt 校验与 WARN 提示。

import type { Dirent } from 'fs';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { Solution } from '@/app/lib/ai/types';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';
import { getDbConfig } from '@/app/lib/db/config';
import { getPool } from '@/app/lib/db/connection';

/** 批次大小上限（NFR-003/AR1-013：进度分片粒度） */
const BATCH_SIZE = 500;

/** 一条导入失败记录（明细报告用，FR-025） */
interface ImportFailure {
  /** 相对源路径（如 content/0e/abc123） */
  source: string;
  /** 失败原因（成对缺失/解析失败/FK 违反/IO 异常） */
  reason: string;
}

/** solutions 待导入行（content/{h2}/{hash}.html + .json 成对，设计 §2.1） */
interface SolutionRow {
  source: string;
  contentHash: string;
  html: string;
  validated: boolean;
  warning: string | null;
  /** 扫描期已归一；DAO 签名不携带，DB 端 defaultNow() 兜底 */
  createdAt: string;
}

/** primary_indexes 待导入行（primary/{platform}_{problemId}.json，设计 §2.2） */
interface PrimaryRow {
  source: string;
  platform: string;
  problemId: string;
  contentHash: string;
  createdAt: string;
}

/** sample_indexes 待导入行（sample/{fp2}/{fp}.json，设计 §2.3） */
interface SampleRow {
  source: string;
  sampleFp: string;
  contentHash: string;
  createdAt: string;
}

/** unknown → 错误消息（不含连接串等敏感信息，NFR-005） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 目录项按名称排序（保证扫描与导入顺序确定，报告可复现） */
function byName(a: Dirent, b: Dirent): number {
  return a.name.localeCompare(b.name);
}

/** 从 unknown 对象读字符串字段；非字符串/缺失返回 undefined */
function stringField(obj: unknown, field: string): string | undefined {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  const value = (obj as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

/** 读取并解析 JSON 文件（读取/解析失败上抛，由调用方计失败清单） */
async function readJsonFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** createdAt 归一：缺失/非法 ISO → 兜底 now() 并记 WARN（不阻塞，设计 §2.1） */
function normalizeCreatedAt(raw: string | undefined, source: string): string {
  if (raw !== undefined && !Number.isNaN(Date.parse(raw))) {
    return raw;
  }
  console.warn(`[WARN] ${source}: createdAt 缺失或非法，兜底 now()`);
  return new Date().toISOString();
}

/** AD-12/AR1-004：Node 22 内置加载 .env.local；失败仅告警（继续依赖进程环境变量） */
export function loadEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local 缺失时依赖进程环境变量（CI/部署注入），不阻断
  }
}

/** 扫描 content/：以文件名（去后缀）为 hash 键成对校验（FR-025a）；空目录/目录缺失不抛出 */
export async function scanContentDir(baseDir: string): Promise<{
  pairs: SolutionRow[];
  failures: ImportFailure[];
  htmlCount: number;
  jsonCount: number;
}> {
  const contentDir = path.join(baseDir, 'content');
  const pairs: SolutionRow[] = [];
  const failures: ImportFailure[] = [];
  const byHash = new Map<string, { htmlPath?: string; jsonPath?: string }>();
  let htmlCount = 0;
  let jsonCount = 0;

  let buckets: Dirent[];
  try {
    buckets = await readdir(contentDir, { withFileTypes: true });
  } catch (error) {
    failures.push({ source: 'content/', reason: `目录不可读：${errorMessage(error)}` });
    return { pairs, failures, htmlCount, jsonCount };
  }

  for (const bucket of buckets.filter((e) => e.isDirectory()).sort(byName)) {
    let files: Dirent[];
    try {
      files = await readdir(path.join(contentDir, bucket.name), { withFileTypes: true });
    } catch (error) {
      failures.push({
        source: `content/${bucket.name}/`,
        reason: `目录不可读：${errorMessage(error)}`,
      });
      continue;
    }
    for (const file of files.sort(byName)) {
      const hash = file.name.replace(/\.(html|json)$/, '');
      const entry = byHash.get(hash) ?? {};
      if (file.name.endsWith('.html')) {
        htmlCount += 1;
        entry.htmlPath = path.join(contentDir, bucket.name, file.name);
      } else if (file.name.endsWith('.json')) {
        jsonCount += 1;
        entry.jsonPath = path.join(contentDir, bucket.name, file.name);
      } else {
        continue; // 非缓存文件（如 .tmp）不计入
      }
      byHash.set(hash, entry);
    }
  }

  for (const [hash, entry] of [...byHash.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const source = `content/${hash.slice(0, 2)}/${hash}`;
    if (entry.htmlPath === undefined) {
      failures.push({ source, reason: '成对校验失败：缺少配对 .html 文件' });
      continue;
    }
    if (entry.jsonPath === undefined) {
      failures.push({ source, reason: '成对校验失败：缺少配对 .json 元数据文件' });
      continue;
    }
    let html: string;
    try {
      html = await readFile(entry.htmlPath, 'utf-8');
    } catch (error) {
      failures.push({ source, reason: `html 读取失败：${errorMessage(error)}` });
      continue;
    }
    let meta: unknown;
    try {
      meta = await readJsonFile(entry.jsonPath);
    } catch (error) {
      failures.push({ source, reason: `json 读取或解析失败：${errorMessage(error)}` });
      continue;
    }
    const validatedValue =
      typeof meta === 'object' && meta !== null
        ? (meta as Record<string, unknown>).validated
        : undefined;
    if (typeof validatedValue !== 'boolean') {
      failures.push({ source, reason: 'meta.validated 缺失或非 boolean' });
      continue;
    }
    pairs.push({
      source,
      contentHash: hash,
      html,
      validated: validatedValue,
      warning: stringField(meta, 'warning') ?? null,
      createdAt: normalizeCreatedAt(stringField(meta, 'createdAt'), source),
    });
  }
  return { pairs, failures, htmlCount, jsonCount };
}

/** 扫描 primary/：文件名按首个 `_` 分割（indexOf，防御 problemId 含 `_`，设计 §2.2/§7-3） */
export async function scanPrimaryDir(baseDir: string): Promise<{
  indexes: PrimaryRow[];
  failures: ImportFailure[];
}> {
  const primaryDir = path.join(baseDir, 'primary');
  const indexes: PrimaryRow[] = [];
  const failures: ImportFailure[] = [];

  let files: Dirent[];
  try {
    files = await readdir(primaryDir, { withFileTypes: true });
  } catch (error) {
    failures.push({ source: 'primary/', reason: `目录不可读：${errorMessage(error)}` });
    return { indexes, failures };
  }

  for (const file of files.filter((e) => e.isFile() && e.name.endsWith('.json')).sort(byName)) {
    const source = `primary/${file.name}`;
    const base = file.name.slice(0, -'.json'.length);
    const sepIndex = base.indexOf('_');
    if (sepIndex < 1 || sepIndex >= base.length - 1) {
      failures.push({ source, reason: '文件名无法按首个下划线分割为非空 platform/problemId' });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = await readJsonFile(path.join(primaryDir, file.name));
    } catch (error) {
      failures.push({ source, reason: `json 读取或解析失败：${errorMessage(error)}` });
      continue;
    }
    const contentHash = stringField(parsed, 'contentHash');
    if (contentHash === undefined || contentHash === '') {
      failures.push({ source, reason: 'contentHash 缺失或非字符串' });
      continue;
    }
    indexes.push({
      source,
      platform: base.slice(0, sepIndex),
      problemId: base.slice(sepIndex + 1),
      contentHash,
      createdAt: normalizeCreatedAt(stringField(parsed, 'createdAt'), source),
    });
  }
  return { indexes, failures };
}

/** 扫描 sample/：文件名（去 .json）即指纹（设计 §2.3） */
export async function scanSampleDir(baseDir: string): Promise<{
  indexes: SampleRow[];
  failures: ImportFailure[];
}> {
  const sampleDir = path.join(baseDir, 'sample');
  const indexes: SampleRow[] = [];
  const failures: ImportFailure[] = [];

  let buckets: Dirent[];
  try {
    buckets = await readdir(sampleDir, { withFileTypes: true });
  } catch (error) {
    failures.push({ source: 'sample/', reason: `目录不可读：${errorMessage(error)}` });
    return { indexes, failures };
  }

  for (const bucket of buckets.filter((e) => e.isDirectory()).sort(byName)) {
    let files: Dirent[];
    try {
      files = await readdir(path.join(sampleDir, bucket.name), { withFileTypes: true });
    } catch (error) {
      failures.push({
        source: `sample/${bucket.name}/`,
        reason: `目录不可读：${errorMessage(error)}`,
      });
      continue;
    }
    for (const file of files.filter((e) => e.isFile() && e.name.endsWith('.json')).sort(byName)) {
      const source = `sample/${bucket.name}/${file.name.slice(0, -'.json'.length)}`;
      let parsed: unknown;
      try {
        parsed = await readJsonFile(path.join(sampleDir, bucket.name, file.name));
      } catch (error) {
        failures.push({ source, reason: `json 读取或解析失败：${errorMessage(error)}` });
        continue;
      }
      const contentHash = stringField(parsed, 'contentHash');
      if (contentHash === undefined || contentHash === '') {
        failures.push({ source, reason: 'contentHash 缺失或非字符串' });
        continue;
      }
      indexes.push({
        source,
        sampleFp: file.name.slice(0, -'.json'.length),
        contentHash,
        createdAt: normalizeCreatedAt(stringField(parsed, 'createdAt'), source),
      });
    }
  }
  return { indexes, failures };
}

/** SolutionRow → insertIfAbsentSolution 所需 Solution 载荷（cached 为占位字段，DAO 不使用） */
function toSolutionPayload(row: SolutionRow): Solution {
  return {
    html: row.html,
    validated: row.validated,
    warning: row.warning ?? undefined,
    cached: false,
    contentHash: row.contentHash,
  };
}

/**
 * 逐行 insertIfAbsent 导入（DO NOTHING 幂等，设计 §5 冲突策略）：
 * - 返回 true=新插入（imported）/false=已存在跳过（skipped）
 * - 单行异常（FK 悬空索引/IO）仅该行入失败清单，继续后续行（FR-025c）
 * - BATCH_SIZE 分片保留设计 §4「每批 ≤500 行」的进度语义
 */
async function importRows<T extends { source: string }>(
  rows: T[],
  insertOne: (row: T) => Promise<boolean>,
): Promise<{ imported: number; skipped: number; failures: ImportFailure[] }> {
  const failures: ImportFailure[] = [];
  let imported = 0;
  let skipped = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    for (const row of batch) {
      try {
        const inserted = await insertOne(row);
        if (inserted) {
          imported += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failures.push({ source: row.source, reason: `导入失败：${errorMessage(error)}` });
      }
    }
  }
  return { imported, skipped, failures };
}

/** 单表报告行（FR-025b，格式对齐设计 §3 报告示例） */
function printReport(
  table: string,
  scanned: number,
  result: { imported: number; skipped: number; failures: ImportFailure[] },
): void {
  const label = `[${table}]`.padEnd(19);
  console.log(
    `${label} scanned=${scanned} imported=${result.imported} skipped=${result.skipped} failed=${result.failures.length}`,
  );
}

/** 连接池收尾（导入后进程不悬挂）；池未创建/收尾失败不阻断退出码 */
async function closePoolQuietly(): Promise<void> {
  try {
    await getPool().end();
  } catch {
    // DATABASE_URL 缺失等场景池未创建，忽略收尾错误
  }
}

/** 主流程：loadEnv → 配置校验 → 扫描 → 按序导入 → 汇总报告 → 退出码（设计 §3） */
export async function main(): Promise<number> {
  loadEnv();
  try {
    getDbConfig(); // 惰性校验：DATABASE_URL 缺失 → 抛错 → 退出码 1（AD-07）
  } catch (error) {
    console.error(`[migrate] ${errorMessage(error)}`);
    return 1;
  }

  try {
    const baseDir = process.env.GESP6_CACHE_FS_DIR ?? path.resolve(process.cwd(), '.data/gesp6');

    // —— 1. 扫描 + 成对校验（FR-025a），输出扫描统计（AC-021 比对依据）——
    const content = await scanContentDir(baseDir);
    const primary = await scanPrimaryDir(baseDir);
    const sample = await scanSampleDir(baseDir);
    console.log(
      `[scan] content: html=${content.htmlCount} json=${content.jsonCount} paired=${content.pairs.length} broken=${content.failures.length}`,
    );
    console.log(`[scan] primary: scanned=${primary.indexes.length} broken=${primary.failures.length}`);
    console.log(`[scan] sample: scanned=${sample.indexes.length} broken=${sample.failures.length}`);

    // —— 2. 按序导入：solutions → primary → sample（索引表 FK 依赖，设计 §1）——
    const rSolutions = await importRows(content.pairs, (row) =>
      solutionDao.insertIfAbsentSolution(row.contentHash, toSolutionPayload(row)),
    );
    const rPrimary = await importRows(primary.indexes, (row) =>
      solutionDao.insertIfAbsentPrimaryIndex(row.platform, row.problemId, row.contentHash),
    );
    const rSample = await importRows(sample.indexes, (row) =>
      solutionDao.insertIfAbsentSampleIndex(row.sampleFp, row.contentHash),
    );

    // —— 3. 汇总报告（FR-025b）——
    printReport('solutions', content.pairs.length, rSolutions);
    printReport('primary_indexes', primary.indexes.length, rPrimary);
    printReport('sample_indexes', sample.indexes.length, rSample);

    // —— 4. 失败明细 + 退出码（FR-025c/AC-023）——
    const scanFailures = [...content.failures, ...primary.failures, ...sample.failures];
    const importFailures = [...rSolutions.failures, ...rPrimary.failures, ...rSample.failures];
    for (const failure of scanFailures) {
      console.error(`[failure] ${failure.source}: ${failure.reason}`);
    }
    for (const failure of importFailures) {
      console.error(`[failure] ${failure.source}: ${failure.reason}`);
    }
    const code = scanFailures.length + importFailures.length > 0 ? 1 : 0;
    console.log(`[result] exit=${code}`);
    return code;
  } finally {
    await closePoolQuietly();
  }
}

// CLI 直跑判定（tsx 下 process.argv[1] 为本文件路径；被 import 时不触发，同 migrate.ts 模式）
const isDirectRun =
  process.argv[1] !== undefined && process.argv[1].endsWith('migrate-fs-cache-to-db.ts');
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`[migrate] 未预期失败：${errorMessage(error)}`);
      process.exit(1);
    });
}
