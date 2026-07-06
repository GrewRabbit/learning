// app/lib/ai/services/fs-json-io.ts
// FsHtmlCache JSON 文件 IO 工具（CR1-002 拆分自 fs-html-cache.ts）
//
// 职责：
// 1. ensureDirSync：同步确保目录存在（不存在则递归创建）
// 2. readJsonSync：同步读取 JSON 文件（不存在/损坏返回 null，不抛错）
// 3. writeJsonAsync：异步写入 JSON 文件（带格式化缩进）
//
// 设计要点：
// - 读操作同步（fs.readFileSync）—— FsHtmlCache 接口签名要求同步返回
// - JSON 解析失败 → 返回 null（视为缓存未命中，触发 LLM 重新生成）
// - writeJsonAsync 仅负责 JSON 序列化与写入，不含 fire-and-forget 调度（调用方自行处理）

import { existsSync, mkdirSync, readFileSync, promises as fsAsync } from 'fs';

/** 同步确保目录存在（不存在则递归创建） */
export function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 同步读取 JSON 文件（不存在/损坏返回 null，不抛错）
 *
 * 文件不存在或 JSON 解析失败均视为缓存未命中，触发上层重新生成（架构 §4.4）。
 */
export function readJsonSync<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    // JSON 解析失败 → 视为缓存未命中（文件损坏，触发 LLM 重新生成）
    return null;
  }
}

/** 异步写入 JSON 文件（带 2 空格缩进格式化） */
export async function writeJsonAsync(filePath: string, data: unknown): Promise<void> {
  await fsAsync.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
