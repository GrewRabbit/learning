// app/lib/ai/services/prompt-loader.ts
// Prompt 与知识点库加载器（从 orchestrator.ts 抽出，CR1-001 拆分）
// 带缓存，避免每次调用都读文件

import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '@/app/lib/logging/logger';

/** skill Prompt 文件路径 */
const SKILL_PROMPT_PATH = path.join(
  process.cwd(),
  'app/lib/ai/prompts/gesp6-skill.md',
);

/** C++ 知识点体系库文件路径（供第五章思维导图按层级组织） */
const KNOWLEDGE_BASE_PATH = path.join(
  process.cwd(),
  'app/lib/ai/data/cpp-knowledge.md',
);

/**
 * Prompt 与知识点库加载器（带缓存）
 *
 * - skill Prompt：GESP6 解题 skill 全文（由调用方注入 LLM system 消息）
 * - 知识点库：C++ 知识体系，用于第五章思维导图按系统化分类分层级组织
 *
 * 文件缺失时降级为空字符串并记录 warn 日志，不阻断主流程（架构 §4.4 降级）。
 */
export class PromptLoader {
  private skillPromptCache: string | null = null;
  private knowledgeBaseCache: string | null = null;

  /**
   * 加载 skill Prompt（带缓存，避免每次调用都读文件）
   */
  async loadSkillPrompt(): Promise<string> {
    if (this.skillPromptCache !== null) {
      return this.skillPromptCache;
    }
    try {
      this.skillPromptCache = await readFile(SKILL_PROMPT_PATH, 'utf-8');
    } catch {
      logger.warn(
        `[Orchestrator] skill prompt 文件不存在：${SKILL_PROMPT_PATH}`,
      );
      this.skillPromptCache = '';
    }
    return this.skillPromptCache;
  }

  /**
   * 加载 C++ 知识点体系库（带缓存）
   * 用于第五章思维导图按系统化分类分层级组织，避免 LLM 自由发挥
   */
  async loadKnowledgeBase(): Promise<string> {
    if (this.knowledgeBaseCache !== null) {
      return this.knowledgeBaseCache;
    }
    try {
      this.knowledgeBaseCache = await readFile(KNOWLEDGE_BASE_PATH, 'utf-8');
    } catch {
      logger.warn(
        `[Orchestrator] 知识点库文件不存在：${KNOWLEDGE_BASE_PATH}`,
      );
      this.knowledgeBaseCache = '';
    }
    return this.knowledgeBaseCache;
  }
}

/** 单例导出（api-conventions.md §二：直接导出单例） */
export const promptLoader = new PromptLoader();
