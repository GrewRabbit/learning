// scripts/__tests__/migrate-fs-cache-to-db.test.ts
// 一次性导入脚本单元测试（FR-023~026 / AC-021~023 的纯逻辑层验证，全 mock 无真实 DB）：
// - 成对校验（缺 html / 缺 json / json 非法 / validated 缺失 → failures）
// - warning 缺失 → null；createdAt 非法 → 兜底 now() 不阻塞
// - primary 文件名首个下划线分割（含 problemId 带 `_` 场景）
// - 悬空索引 FK 抛错 → 失败清单继续其余导入；幂等 DO NOTHING → skipped 计数
// - 退出码：有失败 → 1；全成功（含 skipped）→ 0
//
// 测试隔离：vi.mock fs/promises + config/connection/solution-dao；
// 占位连接串不出现真实凭据；GESP6_CACHE_FS_DIR 指向 /base 隔离真实数据目录。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Dirent } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { getDbConfig } from '@/app/lib/db/config';
import { getPool } from '@/app/lib/db/connection';
import { solutionDao } from '@/app/lib/db/daos/solution-dao';

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('@/app/lib/db/config', () => ({ getDbConfig: vi.fn() }));
vi.mock('@/app/lib/db/connection', () => ({ getPool: vi.fn() }));
vi.mock('@/app/lib/db/daos/solution-dao', () => ({
  solutionDao: {
    insertIfAbsentSolution: vi.fn(),
    insertIfAbsentPrimaryIndex: vi.fn(),
    insertIfAbsentSampleIndex: vi.fn(),
  },
}));

import {
  loadEnv,
  main,
  scanContentDir,
  scanPrimaryDir,
  scanSampleDir,
} from '../migrate-fs-cache-to-db';

const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);
const getDbConfigMock = vi.mocked(getDbConfig);
const getPoolMock = vi.mocked(getPool);
const insertSolutionMock = vi.mocked(solutionDao.insertIfAbsentSolution);
const insertPrimaryMock = vi.mocked(solutionDao.insertIfAbsentPrimaryIndex);
const insertSampleMock = vi.mocked(solutionDao.insertIfAbsentSampleIndex);

const HTML_OK = '<html>ok</html>';
const CREATED_AT = '2026-01-02T03:04:05.000Z';
const META_WARNING = `{"validated":true,"warning":"w1","createdAt":"${CREATED_AT}"}`;
const META_PLAIN = `{"validated":true,"createdAt":"${CREATED_AT}"}`;
const META_FALSE = `{"validated":false,"createdAt":"${CREATED_AT}"}`;
const INDEX_JSON = `{"contentHash":"aabbcc","createdAt":"${CREATED_AT}"}`;

/** 构造 readdir(withFileTypes) 返回的目录项（仅实现本脚本用到的判定方法） */
function dirEntry(name: string, kind: 'dir' | 'file'): Dirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  } as unknown as Dirent;
}

/** 为 Error 附加 errno 风格 code（模拟 pg SQLSTATE / fs ENOENT） */
function withCode<T extends Error>(error: T, code: string): T {
  return Object.assign(error, { code });
}

// —— 按精确路径路由的 fs mock（共享存储，helper 注册路由）——
let readdirRoutes: Record<string, Dirent[]> = {};
let readFileRoutes: Record<string, string> = {};

function resetRoutes(): void {
  readdirRoutes = {};
  readFileRoutes = {};
}

function installRouteMocks(): void {
  readdirMock.mockImplementation(
    ((dir: string) => {
      const entries = readdirRoutes[dir];
      if (entries === undefined) {
        return Promise.reject(withCode(new Error(`ENOENT: no mock route for ${dir}`), 'ENOENT'));
      }
      return Promise.resolve(entries);
    }) as unknown as typeof readdir,
  );
  readFileMock.mockImplementation(
    ((filePath: string) => {
      const content = readFileRoutes[filePath];
      if (content === undefined) {
        return Promise.reject(new Error(`EACCES: no mock route for ${filePath}`));
      }
      return Promise.resolve(content);
    }) as unknown as typeof readFile,
  );
}

/** 注册 content/{h2}/{hash} 下的一对文件（null 表示该侧缺失，模拟成对破坏） */
function routeContent(hash: string, html: string | null, meta: string | null): void {
  const bucket = hash.slice(0, 2);
  const bucketKey = `/base/content/${bucket}`;
  const roots = (readdirRoutes['/base/content'] ??= []);
  if (!roots.some((entry) => entry.name === bucket)) {
    roots.push(dirEntry(bucket, 'dir'));
  }
  const files = (readdirRoutes[bucketKey] ??= []);
  if (html !== null) {
    files.push(dirEntry(`${hash}.html`, 'file'));
    readFileRoutes[`${bucketKey}/${hash}.html`] = html;
  }
  if (meta !== null) {
    files.push(dirEntry(`${hash}.json`, 'file'));
    readFileRoutes[`${bucketKey}/${hash}.json`] = meta;
  }
}

/** 注册 primary/{file}（json=null 表示文件存在但内容读取失败场景前置，不注册读取路由） */
function routePrimary(file: string, json: string | null): void {
  (readdirRoutes['/base/primary'] ??= []).push(dirEntry(file, 'file'));
  if (json !== null) {
    readFileRoutes[`/base/primary/${file}`] = json;
  }
}

/** 注册 sample/{fp2}/{fp}.json（json=null 同上） */
function routeSample(fp: string, json: string | null): void {
  const bucketKey = `/base/sample/${fp.slice(0, 2)}`;
  (readdirRoutes['/base/sample'] ??= []).push(dirEntry(fp.slice(0, 2), 'dir'));
  (readdirRoutes[bucketKey] ??= []).push(dirEntry(`${fp}.json`, 'file'));
  if (json !== null) {
    readFileRoutes[`${bucketKey}/${fp}.json`] = json;
  }
}

/** getDbConfig 默认成功（占位值，脚本不打印其内容） */
function stubDbConfigOk(): void {
  getDbConfigMock.mockReturnValue({
    url: 'postgres://placeholder@example.invalid:5432/placeholder',
    poolMin: 2,
    poolMax: 10,
    statementTimeoutMs: 5000,
    connectTimeoutMs: 5000,
  });
}

/** getPool 返回带 end() 的替身（main 收尾调用） */
function stubPool(): void {
  getPoolMock.mockReturnValue({
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getPool>);
}

/** 静默 console（main 输出报告/失败明细） */
function silenceConsole(): void {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

/** 汇总 console 输出文本（断言报告/失败明细） */
function consoleText(method: 'log' | 'error'): string {
  return vi.mocked(console[method]).mock.calls.map((args) => args.join(' ')).join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRoutes();
  installRouteMocks();
  stubDbConfigOk();
  stubPool();
  silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('scanContentDir 成对校验（FR-025a）', () => {
  test('成对完整的 hash 生成待导入行（validated/warning/createdAt/html 映射）', async () => {
    routeContent('aabbcc', HTML_OK, META_WARNING);
    const result = await scanContentDir('/base');
    expect(result.failures).toEqual([]);
    expect(result.htmlCount).toBe(1);
    expect(result.jsonCount).toBe(1);
    expect(result.pairs).toEqual([
      {
        source: 'content/aa/aabbcc',
        contentHash: 'aabbcc',
        html: HTML_OK,
        validated: true,
        warning: 'w1',
        createdAt: CREATED_AT,
      },
    ]);
  });

  test('缺少 .html 配对 → 该 hash 计入失败清单且不导入', async () => {
    routeContent('aabbcc', null, META_PLAIN);
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source).toBe('content/aa/aabbcc');
    expect(result.failures[0]?.reason).toContain('html');
  });

  test('缺少 .json 配对 → 该 hash 计入失败清单且不导入', async () => {
    routeContent('aabbcc', HTML_OK, null);
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain('json');
  });

  test('json 解析失败 → 计入失败清单', async () => {
    routeContent('aabbcc', HTML_OK, '{invalid-json');
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures[0]?.source).toBe('content/aa/aabbcc');
    expect(result.failures[0]?.reason).toContain('解析失败');
  });

  test('validated 缺失或非 boolean → 计入失败清单', async () => {
    routeContent('aabbcc', HTML_OK, `{"createdAt":"${CREATED_AT}"}`);
    routeContent('bbccdd', HTML_OK, `{"validated":"yes","createdAt":"${CREATED_AT}"}`);
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((f) => f.reason.includes('validated'))).toBe(true);
  });

  test('warning 缺失 → 映射为 null', async () => {
    routeContent('aabbcc', HTML_OK, META_FALSE);
    const result = await scanContentDir('/base');
    expect(result.failures).toHaveLength(0);
    expect(result.pairs[0]?.warning).toBeNull();
    expect(result.pairs[0]?.validated).toBe(false);
  });

  test('createdAt 非法 → 兜底 now() 记 WARN 不阻塞（不进失败清单）', async () => {
    routeContent('aabbcc', HTML_OK, '{"validated":true,"createdAt":"not-a-date"}');
    const before = Date.now();
    const result = await scanContentDir('/base');
    const after = Date.now();
    expect(result.failures).toHaveLength(0);
    expect(result.pairs).toHaveLength(1);
    const fallback = result.pairs[0]?.createdAt;
    expect(fallback).toBeDefined();
    const parsed = fallback !== undefined ? Date.parse(fallback) : Number.NaN;
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  test('html 读取 IO 失败 → 计入失败清单', async () => {
    routeContent('aabbcc', HTML_OK, META_PLAIN);
    readFileMock.mockImplementation(
      ((filePath: string) =>
        filePath.endsWith('.json')
          ? Promise.resolve(META_PLAIN)
          : Promise.reject(new Error('EACCES: permission denied'))) as unknown as typeof readFile,
    );
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures[0]?.reason).toContain('html');
  });

  test('content 目录不存在 → 返回失败清单且 pairs 为空（不抛出）', async () => {
    const result = await scanContentDir('/base');
    expect(result.pairs).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.source).toBe('content/');
  });
});

describe('scanPrimaryDir 文件名分割（设计 §2.2，首个下划线）', () => {
  test('正常分割（youdao_7911 样式）', async () => {
    routePrimary('youdao_7911.json', INDEX_JSON);
    const result = await scanPrimaryDir('/base');
    expect(result.failures).toHaveLength(0);
    expect(result.indexes).toEqual([
      {
        source: 'primary/youdao_7911.json',
        platform: 'youdao',
        problemId: '7911',
        contentHash: 'aabbcc',
        createdAt: CREATED_AT,
      },
    ]);
  });

  test('problemId 含下划线：按首个下划线分割', async () => {
    routePrimary('luogu_P1001_extra.json', INDEX_JSON);
    const result = await scanPrimaryDir('/base');
    expect(result.failures).toHaveLength(0);
    expect(result.indexes[0]?.platform).toBe('luogu');
    expect(result.indexes[0]?.problemId).toBe('P1001_extra');
  });

  test('无下划线 / platform 空 / problemId 空 → 计入失败清单', async () => {
    routePrimary('nounderscore.json', null);
    routePrimary('_ leading.json', null);
    routePrimary('trailing_.json', null);
    const result = await scanPrimaryDir('/base');
    expect(result.indexes).toHaveLength(0);
    expect(result.failures).toHaveLength(3);
  });

  test('contentHash 缺失 → 计入失败清单', async () => {
    routePrimary('luogu_P1001.json', `{"createdAt":"${CREATED_AT}"}`);
    const result = await scanPrimaryDir('/base');
    expect(result.indexes).toHaveLength(0);
    expect(result.failures[0]?.reason).toContain('contentHash');
  });

  test('json 解析失败 → 计入失败清单', async () => {
    routePrimary('luogu_P1001.json', '{invalid');
    const result = await scanPrimaryDir('/base');
    expect(result.indexes).toHaveLength(0);
    expect(result.failures[0]?.reason).toContain('解析失败');
  });
});

describe('scanSampleDir（设计 §2.3，文件名即指纹）', () => {
  test('正常：文件名（去后缀）即 sampleFp', async () => {
    routeSample('ff0011', INDEX_JSON);
    const result = await scanSampleDir('/base');
    expect(result.failures).toHaveLength(0);
    expect(result.indexes).toEqual([
      {
        source: 'sample/ff/ff0011',
        sampleFp: 'ff0011',
        contentHash: 'aabbcc',
        createdAt: CREATED_AT,
      },
    ]);
  });

  test('json 解析失败 → 计入失败清单', async () => {
    routeSample('ff0011', '{invalid');
    const result = await scanSampleDir('/base');
    expect(result.indexes).toHaveLength(0);
    expect(result.failures[0]?.source).toBe('sample/ff/ff0011');
  });

  test('contentHash 缺失 → 计入失败清单', async () => {
    routeSample('ff0011', `{"createdAt":"${CREATED_AT}"}`);
    const result = await scanSampleDir('/base');
    expect(result.indexes).toHaveLength(0);
    expect(result.failures[0]?.reason).toContain('contentHash');
  });
});

describe('main 导入编排（顺序/幂等/失败隔离/退出码）', () => {
  /** 标准 3 表样例路由：1 解法 + 2 primary + 1 sample */
  function routeHappyPath(): void {
    routeContent('aabbcc', HTML_OK, META_PLAIN);
    routePrimary('luogu_P1001.json', INDEX_JSON);
    routePrimary('youdao_7911.json', INDEX_JSON);
    routeSample('ff0011', INDEX_JSON);
  }

  beforeEach(() => {
    vi.stubEnv('GESP6_CACHE_FS_DIR', '/base');
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
  });

  test('全成功：导入顺序 solutions → primary → sample，计数正确，exit 0，收尾连接池', async () => {
    routeHappyPath();
    insertSolutionMock.mockResolvedValue(true);
    insertPrimaryMock.mockResolvedValue(true);
    insertSampleMock.mockResolvedValue(true);

    const code = await main();

    expect(code).toBe(0);
    expect(insertSolutionMock).toHaveBeenCalledTimes(1);
    expect(insertSolutionMock).toHaveBeenCalledWith('aabbcc', {
      html: HTML_OK,
      validated: true,
      warning: undefined,
      cached: false,
      contentHash: 'aabbcc',
    });
    expect(insertPrimaryMock).toHaveBeenCalledWith('luogu', 'P1001', 'aabbcc');
    expect(insertPrimaryMock).toHaveBeenCalledWith('youdao', '7911', 'aabbcc');
    expect(insertSampleMock).toHaveBeenCalledWith('ff0011', 'aabbcc');
    // FK 依赖顺序：solutions 全部先于两个索引表（设计 §1）
    expect(insertSolutionMock.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      insertPrimaryMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(insertPrimaryMock.mock.invocationCallOrder[1] ?? 0).toBeLessThan(
      insertSampleMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    // 报告行（FR-025b）与扫描统计（AC-021 比对依据）
    const logText = consoleText('log');
    expect(logText).toContain('[scan] content: html=1 json=1 paired=1 broken=0');
    expect(logText).toContain('[solutions]');
    expect(logText).toContain('scanned=1 imported=1 skipped=0 failed=0');
    expect(logText).toContain('[primary_indexes]');
    expect(logText).toContain('scanned=2 imported=2 skipped=0 failed=0');
    expect(logText).toContain('[sample_indexes]');
    expect(logText).toContain('scanned=1 imported=1 skipped=0 failed=0');
    expect(logText).toContain('[result] exit=0');
    expect(getPoolMock).toHaveBeenCalledTimes(1); // 连接池收尾
  });

  test('幂等（AC-022 语义）：insertIfAbsent 全返回 false → skipped=扫描数、imported=0、exit 0', async () => {
    routeHappyPath();
    insertSolutionMock.mockResolvedValue(false);
    insertPrimaryMock.mockResolvedValue(false);
    insertSampleMock.mockResolvedValue(false);

    const code = await main();

    expect(code).toBe(0);
    const logText = consoleText('log');
    expect(logText).toContain('scanned=1 imported=0 skipped=1 failed=0');
    expect(logText).toContain('scanned=2 imported=0 skipped=2 failed=0');
    expect(logText).toContain('scanned=1 imported=0 skipped=1 failed=0');
  });

  test('悬空索引 FK 违反（23503）：该行进失败清单、其余继续导入、exit 1（FR-025c/AC-023 语义）', async () => {
    routeHappyPath();
    insertSolutionMock.mockResolvedValue(true);
    insertPrimaryMock
      .mockResolvedValueOnce(true) // luogu_P1001 正常
      .mockRejectedValueOnce(
        withCode(
          new Error('insert or update on table "primary_indexes" violates foreign key constraint'),
          '23503',
        ),
      );
    insertSampleMock.mockResolvedValue(true);

    const code = await main();

    expect(code).toBe(1);
    // 失败仅限 youdao 行，luogu/sample 照常导入
    const logText = consoleText('log');
    expect(logText).toContain('[primary_indexes]');
    expect(logText).toContain('scanned=2 imported=1 skipped=0 failed=1');
    expect(logText).toContain('[sample_indexes]');
    expect(logText).toContain('scanned=1 imported=1 skipped=0 failed=0');
    expect(consoleText('error')).toContain('[failure] primary/youdao_7911.json');
  });

  test('扫描期损坏（缺 json 配对）：该 hash 进失败清单、其余导入成功、exit 1', async () => {
    routeContent('aabbcc', HTML_OK, null); // 缺 aabbcc.json
    routePrimary('luogu_P1001.json', INDEX_JSON);
    routeSample('ff0011', INDEX_JSON);
    insertSolutionMock.mockResolvedValue(true);
    // solutions 缺失 → 两个索引悬空 FK 违反（设计 §2.4：不落悬空行）
    insertPrimaryMock.mockRejectedValue(withCode(new Error('fk violation'), '23503'));
    insertSampleMock.mockRejectedValue(withCode(new Error('fk violation'), '23503'));

    const code = await main();

    expect(code).toBe(1);
    const logText = consoleText('log');
    expect(logText).toContain('[scan] content: html=1 json=0 paired=0 broken=1');
    expect(logText).toContain('[solutions]');
    expect(logText).toContain('scanned=0 imported=0 skipped=0 failed=0');
    expect(consoleText('error')).toContain('[failure] content/aa/aabbcc');
  });

  test('DATABASE_URL 缺失（getDbConfig 抛错）→ exit 1 且不触发扫描与导入', async () => {
    getDbConfigMock.mockImplementation(() => {
      throw new Error('GESP6_DB_UNAVAILABLE: DATABASE_URL 未配置');
    });

    const code = await main();

    expect(code).toBe(1);
    expect(readdirMock).not.toHaveBeenCalled();
    expect(insertSolutionMock).not.toHaveBeenCalled();
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(consoleText('error')).toContain('GESP6_DB_UNAVAILABLE');
  });
});

describe('loadEnv（AD-12/AR1-004）', () => {
  test('.env.local 缺失（loadEnvFile 抛错）→ 不抛出、依赖进程环境变量', () => {
    const spy = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {
      throw new Error('ENOENT: .env.local');
    });

    expect(() => loadEnv()).not.toThrow();
    expect(spy).toHaveBeenCalledWith('.env.local');
  });

  test('.env.local 存在 → 正常调用加载', () => {
    const spy = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    expect(() => loadEnv()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
