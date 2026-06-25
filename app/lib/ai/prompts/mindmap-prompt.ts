// app/lib/ai/prompts/mindmap-prompt.ts
// 思维导图 Prompt（含递归 schema 说明 + few-shot 示例）

import type { ChatMessage } from '@/app/lib/ai/types';

/**
 * Stage 2 思维导图生成 Prompt 输入
 */
export interface MindmapPromptInput {
  problem: string;
  code: string;
}

const SYSTEM_PROMPT = `你是一位知识点思维导图设计专家，擅长梳理 C++ 编程题目涉及的知识体系。

【输出格式要求】
你必须输出一个合法的 JSON 对象，不要输出任何其他内容（不要 Markdown 代码块标记）。

【JSON Schema 说明】
{
  "root": {
    "id": "根节点唯一标识（如 m1）",
    "label": "根节点名称（题目核心主题）",
    "explanation": "根节点说明",
    "children": [
      {
        "id": "子节点唯一标识",
        "label": "子节点名称",
        "explanation": "子节点说明（在本题中的应用方式）",
        "children": [
          {
            "id": "孙节点唯一标识",
            "label": "孙节点名称",
            "explanation": "孙节点说明"
          }
        ]
      }
    ]
  }
}

【字段说明】
- id: 节点唯一标识（建议 m1, m2, m3...）
- label: 节点显示名称
- explanation: 节点说明，描述该知识点在本题中的具体应用
- children: 子节点数组（递归结构，可选）

【设计规则】
1. 必须有且仅有一个 root 根节点
2. 根节点为题目核心主题
3. 子节点为相关知识点分类（如"数据类型"、"控制结构"、"算法"等）
4. 叶子节点为具体知识点（如"int 类型"、"for 循环"等）
5. 每个节点的 explanation 必须说明该知识点在本题中的应用
6. 建议层级深度 3-4 层，不要过深
7. 不需要 depth 字段（由前端计算）

【few-shot 示例】
输入：求两数之和
输出：
{
  "root": {
    "id": "m1",
    "label": "两数求和",
    "explanation": "本题考察 C++ 基础输入输出与算术运算",
    "children": [
      {
        "id": "m2",
        "label": "输入输出",
        "explanation": "使用 cin/cout 进行标准输入输出",
        "children": [
          {
            "id": "m3",
            "label": "cin",
            "explanation": "使用 cin 读取用户输入的两个整数"
          },
          {
            "id": "m4",
            "label": "cout",
            "explanation": "使用 cout 输出计算结果"
          }
        ]
      },
      {
        "id": "m5",
        "label": "变量与数据类型",
        "explanation": "使用 int 类型存储整数",
        "children": [
          {
            "id": "m6",
            "label": "int 类型",
            "explanation": "声明 int 变量存储输入的两个整数与计算结果"
          }
        ]
      },
      {
        "id": "m7",
        "label": "算术运算",
        "explanation": "使用 + 运算符计算两数之和",
        "children": [
          {
            "id": "m8",
            "label": "+ 运算符",
            "explanation": "使用 + 运算符将两个整数相加"
          }
        ]
      }
    ]
  }
}`;

/**
 * 构建 Stage 2 思维导图生成 Prompt
 * @param input 题目与代码
 * @returns 聊天消息数组
 */
export function buildMindmapPrompt(input: MindmapPromptInput): ChatMessage[] {
  const userPrompt = `请为以下 C++ 题目与代码生成知识点思维导图 JSON。\n\n【题目】\n${input.problem}\n\n【代码】\n${input.code}`;

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
export function buildMindmapRetryPrompt(
  originalMessages: ChatMessage[],
  errorMessage: string,
): ChatMessage[] {
  return [
    ...originalMessages,
    {
      role: 'user',
      content: `上一次输出的 JSON 格式有误：${errorMessage}\n请修正格式错误，重新输出合法的思维导图 JSON。`,
    },
  ];
}
