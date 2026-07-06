// app/lib/ai/services/format-errors.ts
// 错误信息格式化（从 orchestrator.ts 抽出，CR1-001 拆分）
// 供 FIX_PROMPT_TEMPLATE 的 {{ERRORS}} 占位符使用

import type { ServiceResult, ValidationResult } from '@/app/lib/ai/types';

/**
 * 格式化验证错误信息（供 FIX_PROMPT_TEMPLATE 的 {{ERRORS}} 占位符）
 *
 * 输出格式：
 * - 验证异常：返回异常消息
 * - 编译失败：【编译错误】+ 错误列表
 * - 样例失败：【样例测试失败】+ 各样例输入/期望/实际
 */
export function formatErrors(
  validateResult: ServiceResult<ValidationResult>,
): string {
  if (!validateResult.success) {
    return `验证过程异常：${validateResult.error?.message ?? '未知错误'}`;
  }
  // 显式检查 data 存在，避免使用非空断言 `!`（CR1-014 修复）
  if (!validateResult.data) {
    return '验证结果数据缺失';
  }
  const data = validateResult.data;
  const parts: string[] = [];

  if (!data.compiled) {
    parts.push('【编译错误】');
    parts.push(data.errors.join('\n'));
  } else if (data.failures && data.failures.length > 0) {
    parts.push('【样例测试失败】');
    for (const f of data.failures) {
      parts.push(`\n样例 ${f.sampleIndex + 1}:`);
      parts.push(`输入:\n${f.input}`);
      parts.push(`期望输出:\n${f.expected}`);
      parts.push(`实际输出:\n${f.actual}`);
    }
  }
  return parts.join('\n');
}
