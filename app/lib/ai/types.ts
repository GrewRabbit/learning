// app/lib/ai/types.ts
// 共享类型定义（架构 §5.2）
// 仅包含跨模块共享的 type 别名；interface 定义在各自实现文件中（Phase 2 实施）

/**
 * 统一服务返回格式（api-conventions.md）
 * 读操作返回 ServiceResult<T>；写操作 set 返回 void（见架构 §4.4，缓存写入失败仅记日志不阻断）
 */
export type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

/**
 * 题目输入（架构 §5.2）
 * type: text 原文 / image base64 / platform 完整 URL
 * platform/problemId 由 Route Handler 据 platforms.config.ts 解析后填入（仅 platform 类型有）
 */
export type Problem = {
  type: 'text' | 'image' | 'platform';
  content: string;
  platform?: string;      // 如 'luogu' | 'youdao'，仅 platform 类型有
  problemId?: string;     // 如 'P11447' | '7997'，仅 platform 类型有
};

/**
 * 解题结果（架构 §5.2）
 * cached: 是否来自缓存（双 key 缓存命中时为 true）
 * contentHash: 必填（FR-029，AD-08）——由 Orchestrator 在所有成功返回路径返回前统一填充
 *              （缓存命中/Plan B/compute 降级全覆盖；计费与解题记录的前提）
 * sampleFp: 可选（多解法 spec 引入，落地后按需必填）——同样由 Orchestrator 返回前统一填充
 */
export type Solution = {
  html: string;
  validated: boolean;
  warning?: string;
  cached: boolean;
  contentHash: string;
  sampleFp?: string;
};

/**
 * sessionStorage 中暂存 Solution 的 key（/solve → /result 跨页传递，架构 §6）
 * 定义在此处以供 /solve 与 /result 共享（Next.js 页面文件禁止导出非组件常量）
 */
export const SOLUTION_STORAGE_KEY = 'gesp6:solution';

/**
 * sessionStorage 中暂存计费信息的 key（架构 §5.2，FR-022/AD-09）
 * 供 /solve → /result 传递 charged（本次是否计费）与 balanceRemaining（计费后剩余额度，
 * null=额度暂不可用，如 fail-open 放行期间）；由轮询 done 分支写入（AD-10，T9 落地）
 */
export const BILLING_INFO_STORAGE_KEY = 'gesp6:billing-info';

/**
 * sessionStorage 中暂存原始 Problem 的 key（供 /result 页"重新生成"功能读取并回传 /solve）
 * 与 SOLUTION_STORAGE_KEY 同生命周期：/solve 完成 job 时同时写入，/result 重新生成时读取
 */
export const PROBLEM_STORAGE_KEY = 'gesp6:problem';

/**
 * LLM 输出的元数据（架构 §5.2）
 * code: C++ 源代码（g++ 编译验证对象）
 * samples: 样例（stdin/stdout 比对）
 */
export type Meta = {
  code: string;
  samples: Sample[];
};

export type Sample = {
  input: string;
  expectedOutput: string;
};

/**
 * LLM 流式 chunk（思考过程 / 最终回答）
 * - reasoning: GLM-5.x thinking 模式下的 reasoning_content（思考过程）
 * - content: 最终回答片段
 */
export type LLMChunk = { type: 'reasoning' | 'content'; text: string };

/**
 * LLM 调用输入（架构 §5.2）
 * history: 修正循环时携带的历史消息
 */
export type LLMInput = {
  prompt: string;
  problem: Problem;
  history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /**
   * 流式回调：GLM-5.x thinking 模式下，逐片段传出 reasoning_content（思考过程）和 content（最终回答）。
   * 用于前端实时展示思考过程，未传则忽略（向后兼容）。
   */
  onChunk?: (chunk: LLMChunk) => void;
};

/**
 * LLM 调用输出（架构 §5.2）
 * raw: LLM 原始响应文本（含 <<<META>>>{...}<<<HTML>>>... 双段，由 HtmlParser 解析）
 */
export type LLMOutput = { raw: string };

/**
 * 编译验证结果（架构 §5.2）
 * trimEnabled: 是否启用"忽略末尾空白字符"容错（见 §4.2 样例比对策略）
 * failures: 失败样例信息（部分失败时全部携带进入修正循环）
 */
export type ValidationResult = {
  compiled: boolean;
  passed: boolean;
  errors: string[];
  trimEnabled: boolean;
  failures?: Array<{
    sampleIndex: number;
    input: string;
    expected: string;
    actual: string;
  }>;
};
