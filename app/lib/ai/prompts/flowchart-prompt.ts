// app/lib/ai/prompts/flowchart-prompt.ts
// 流程图 Prompt（含 schema 说明 + few-shot 示例，FR-019/020）

import type { ChatMessage } from '@/app/lib/ai/types';

/**
 * Stage 2 流程图生成 Prompt 输入
 */
export interface FlowchartPromptInput {
  problem: string;
  code: string;
}

const SYSTEM_PROMPT = `你是一位流程图设计专家，擅长将 C++ 代码转化为清晰的解题流程图。

【输出格式要求】
你必须输出一个合法的 JSON 对象，不要输出任何其他内容（不要 Markdown 代码块标记）。

【JSON Schema 说明】
{
  "nodes": [
    {
      "id": "节点唯一标识（如 n1, n2）",
      "type": "节点类型，枚举值：start | process | decision | loop | data | end",
      "label": "节点显示名称",
      "codeRef": "对应代码行号范围（如 "5-10"），可选",
      "requirementRef": "对应题目要求编号（如 "R1"），可选",
      "explanation": "节点说明（hover 时展示）"
    }
  ],
  "edges": [
    {
      "source": "源节点 id",
      "target": "目标节点 id",
      "label": "边标签（decision 出边用，如 "是"/"否"），可选",
      "explanation": "边路径说明（hover 时展示），可选",
      "isBackEdge": "是否为回边（loop 循环回边设为 true），可选"
    }
  ]
}

【节点类型说明】
- start: 起始节点（程序入口）
- process: 处理节点（普通操作）
- decision: 判断节点（条件分支）
- loop: 循环节点（循环操作）
- data: 数据节点（输入/输出）
- end: 结束节点（程序出口）

【设计规则】
1. 必须包含一个 start 节点和一个 end 节点
2. decision 节点的出边必须标注 label（如 "是"/"否"）
3. loop 节点的回边必须设置 isBackEdge: true
4. codeRef 尽量对应代码实际行号
5. requirementRef 根据题目要求自动编号（R1, R2...）
6. 每个节点必须有清晰的 explanation

【few-shot 示例】
输入：求两数之和
输出：
{
  "nodes": [
    { "id": "n1", "type": "start", "label": "开始", "explanation": "程序入口" },
    { "id": "n2", "type": "data", "label": "读取输入", "codeRef": "5-6", "requirementRef": "R1", "explanation": "读取两个整数" },
    { "id": "n3", "type": "process", "label": "计算和", "codeRef": "7", "explanation": "将两数相加" },
    { "id": "n4", "type": "data", "label": "输出结果", "codeRef": "8", "explanation": "输出计算结果" },
    { "id": "n5", "type": "end", "label": "结束", "explanation": "程序结束" }
  ],
  "edges": [
    { "source": "n1", "target": "n2" },
    { "source": "n2", "target": "n3" },
    { "source": "n3", "target": "n4" },
    { "source": "n4", "target": "n5" }
  ]
}`;

/**
 * 构建 Stage 2 流程图生成 Prompt
 * @param input 题目与代码
 * @returns 聊天消息数组
 */
export function buildFlowchartPrompt(input: FlowchartPromptInput): ChatMessage[] {
  const userPrompt = `请为以下 C++ 题目与代码生成解题流程图 JSON。\n\n【题目】\n${input.problem}\n\n【代码】\n${input.code}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}

/**
 * 构建重试 Prompt（附错误信息让模型修正）
 * @param originalMessages 原始消息数组
 * @param errorMessage 上次校验失败错误信息
 * @returns 追加修正提示的消息数组
 */
export function buildFlowchartRetryPrompt(
  originalMessages: ChatMessage[],
  errorMessage: string,
): ChatMessage[] {
  return [
    ...originalMessages,
    {
      role: 'user',
      content: `上一次输出的 JSON 格式有误：${errorMessage}\n请修正格式错误，重新输出合法的流程图 JSON。`,
    },
  ];
}
