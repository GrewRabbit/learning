// app/lib/ai/prompts/fix-prompt-template.ts
// 占位文件（Phase 1 创建，Phase 3 填充实际文本）
//
// 用途：修正循环阶段的 Prompt 模板（架构 §4.2 步骤 5）
// 输入：[原 HTML] + [META] + [错误信息/失败样例] + [要求"仅输出 META 块（含修正后的 code），HTML 块保持原文不变"]
// 输出：新的 <<<META>>> + <<<HTML>>>
//
// Phase 1 仅创建占位，确保 LLMCaller 在 Phase 2 编译通过；
// Phase 3 将填充实际 Prompt 模板文本。

export const FIX_PROMPT_TEMPLATE = '';
