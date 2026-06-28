// app/lib/models.config.ts
// 模型能力声明式配置（架构 §5.2 ModelConfig + §6 目录结构）
// P0（架构 §14.4）：.env.local 模型能力对齐——通过本文件登记当前环境用到的模型及其能力
//
// 配置来源（架构 §5.2 注释）：
//   - models.config.ts 为静态声明式配置，LLMCaller 构造时据环境变量 LLM_MODEL 选取对应 ModelConfig
//   - supportsTool 为预留字段，当前架构未使用，为未来 Agent API 集成预留（§8.3）
//
// 与 app/lib/ai/config.ts 的关系：
//   - 本文件仅声明模型"能力"（supportsImage/supportsTool），不涉及 API Key/BaseURL
//   - app/lib/ai/config.ts 提供 getTextConfig()/getVisionConfig() 从环境变量读取 provider/apiKey/baseUrl
//   - LLMCaller（Phase 2 实施）将综合两者：按 LLM_MODEL 或 AI_TEXT_MODEL/AI_VISION_MODEL 选取 ModelConfig，
//     并通过 ai/config.ts 获取运行时凭证

/**
 * 模型能力配置（架构 §5.2）
 */
export type ModelConfig = {
  name: string;
  supportsImage: boolean;
  supportsTool: boolean;
};

/**
 * 已登记模型能力列表（P0：与 .env.local.example 对齐）
 * - glm-5.2: 当前 AI_TEXT_MODEL 配置，纯文本模型（不支持图片）
 * - kimi-vision: 当前 AI_VISION_MODEL 配置，多模态模型（支持图片）
 *
 * 后续新增模型（如 GLM-4V、Qwen-Vision）仅需在数组中追加条目（P2 项，见架构 §14.4）。
 */
export const MODELS: readonly ModelConfig[] = [
  {
    name: 'glm-5.2',
    supportsImage: false,
    supportsTool: false,
  },
  {
    name: 'kimi-vision',
    supportsImage: true,
    supportsTool: false,
  },
];

/**
 * 按模型名查找能力配置（架构 §5.2：LLMCaller 构造时据环境变量 LLM_MODEL 选取）
 * @param name 模型名（如 'glm-5.2'、'kimi-vision'）
 * @returns 命中返回 ModelConfig，未命中返回 null
 */
export function findModelByName(name: string): ModelConfig | null {
  return MODELS.find((m) => m.name === name) ?? null;
}
