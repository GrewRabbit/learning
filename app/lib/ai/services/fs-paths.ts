// app/lib/ai/services/fs-paths.ts
// FsHtmlCache 路径与索引计算工具（CR1-002 拆分自 fs-html-cache.ts）
//
// 职责：
// 1. 主 key / 内容 key / sample 索引文件路径计算（架构 §5.1，FR-009 目录结构）
// 2. 主 key 构造与解析（架构 §4.2，与 DualKeyHtmlCache 保持一致）
// 3. 多候选 sampleFp 提取（方案 B 辅助函数）
// 4. 主 key 索引 / 内容元数据 / sample 索引文件结构定义
//
// 设计要点：纯函数，无副作用，不持有状态，便于单元测试与复用。

import path from 'path';
import type { SampleFingerprint } from './problem-fetchers/types';

/** 主 key 前缀（架构 §4.2，与 DualKeyHtmlCache 保持一致） */
export const PRIMARY_KEY_PREFIX = 'gesp6:platform:';

/** 主 key 索引文件结构 */
export interface PrimaryIndex {
  contentHash: string;
  createdAt: string;
}

/** 内容 key 元数据文件结构 */
export interface SolutionMeta {
  validated: boolean;
  warning?: string;
  createdAt: string;
}

/**
 * sample 索引文件结构（FR-010，与 primary 索引一致）
 * 文件路径：{baseDir}/sample/{fp前2位}/{fp}.json（FR-009）
 */
export interface SampleIndex {
  contentHash: string;
  createdAt: string;
}

/**
 * 从多候选 sampleFp 中提取非空候选指纹列表（方案 B 辅助函数）
 *
 * 顺序：`[all, first]`，过滤掉空字符串。
 * sampleFp 为 undefined 或 all/first 均为空时返回空数组（调用方据此跳过 sample 查询路径）。
 * 与 DualKeyHtmlCache 中的同名函数保持一致（模块独立，避免循环依赖）。
 */
export function getCandidateFingerprints(sampleFp?: SampleFingerprint): string[] {
  if (!sampleFp) return [];
  return [sampleFp.all, sampleFp.first].filter((fp): fp is string => Boolean(fp));
}

/** 构造主 key（gesp6:platform:{platform}:{problemId}） */
export function buildPrimaryKey(platform: string, problemId: string): string {
  return `${PRIMARY_KEY_PREFIX}${platform}:${problemId}`;
}

/** 解析主 key（gesp6:platform:{platform}:{problemId}），格式不匹配返回空字符串 */
export function parsePrimaryKey(primaryKey: string): { platform: string; problemId: string } {
  if (!primaryKey.startsWith(PRIMARY_KEY_PREFIX)) {
    return { platform: '', problemId: '' };
  }
  const rest = primaryKey.slice(PRIMARY_KEY_PREFIX.length);
  const sepIndex = rest.indexOf(':');
  if (sepIndex === -1) return { platform: '', problemId: '' };
  return {
    platform: rest.slice(0, sepIndex),
    problemId: rest.slice(sepIndex + 1),
  };
}

/** 主 key 索引文件路径：{primaryDir}/{platform}_{problemId}.json */
export function getPrimaryIndexPath(
  primaryDir: string,
  platform: string,
  problemId: string,
): string {
  return path.join(primaryDir, `${platform}_${problemId}.json`);
}

/** 内容 HTML 文件路径：{contentDir}/{hash前2位}/{hash}.html */
export function getContentHtmlPath(contentDir: string, contentHash: string): string {
  const bucket = contentHash.slice(0, 2);
  return path.join(contentDir, bucket, `${contentHash}.html`);
}

/** 内容元数据文件路径：{contentDir}/{hash前2位}/{hash}.json */
export function getContentMetaPath(contentDir: string, contentHash: string): string {
  const bucket = contentHash.slice(0, 2);
  return path.join(contentDir, bucket, `${contentHash}.json`);
}

/** sample 索引文件路径：{sampleDir}/{fp前2位}/{fp}.json（FR-009） */
export function getSampleIndexPath(sampleDir: string, sampleFp: string): string {
  const bucket = sampleFp.slice(0, 2);
  return path.join(sampleDir, bucket, `${sampleFp}.json`);
}
