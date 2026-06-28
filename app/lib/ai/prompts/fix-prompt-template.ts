// app/lib/ai/prompts/fix-prompt-template.ts
// 修正循环阶段的 Prompt 模板（架构 §4.2 步骤 5）
//
// 用途：当 LLM 生成的代码在 g++ 编译或样例测试中失败时，使用此模板要求 LLM 修正代码。
// 占位符（由编排层替换）：
//   {{ORIGINAL_CODE}}  - 原 META 中的 C++ 代码（编译/样例失败的代码）
//   {{SAMPLES_JSON}}   - 原 META 中的 samples 数组（JSON 字符串），供 LLM 理解题目
//   {{ERRORS}}         - 错误信息文本（编译错误 + 失败样例，由编排层格式化）
// 输出：仅 <<<META>>> 块（含修正后的 code + 原 samples），<<<HTML>>> 标记后无内容
//       编排层解析后用原 HTML 拼接（架构 §4.2：HTML 块保持原文不变）

export const FIX_PROMPT_TEMPLATE = `# 代码修正任务

你是 GESP6 解题代码修正专家。前一次生成的 C++ 代码在编译或样例测试中失败了。请根据下方错误信息修正代码，使所有样例通过。

## 输入

### 原始代码（需修正）

\`\`\`cpp
{{ORIGINAL_CODE}}
\`\`\`

### 题目样例（用于理解题意，请勿修改样例本身）

{{SAMPLES_JSON}}

### 失败信息

{{ERRORS}}

## 输出要求

**仅输出 META 块**，不要输出 HTML 内容（HTML 保持原文不变，由程序自动拼接）。

输出格式（严格遵守，不要添加任何额外文字、解释或 Markdown 代码围栏）：

<<<META>>>{JSON}<<<HTML>>>

说明：
- 以 \`<<<META>>>\` 开头，紧跟一个 JSON 对象（**紧凑格式，不要换行缩进**）
- JSON 后紧跟 \`<<<HTML>>>\` 标记，标记后**无任何内容**（程序会自动填充原 HTML）
- 不要在输出中包含实际的 HTML 文档
- 不要在 \`<<<META>>>\` 前或 \`<<<HTML>>>\` 后添加任何字符

### META JSON 结构

\`\`\`typescript
type Meta = {
  code: string;        // 修正后的完整 C++ 代码
  samples: Sample[];   // 原样例，必须原样保留，不要修改
};
type Sample = {
  input: string;          // 样例输入
  expectedOutput: string; // 样例输出
};
\`\`\`

**字段要求：**

- \`code\`：修正后的完整、可编译运行的 C++ 源代码。JSON 字符串中换行用 \`\\n\`，引号用 \`\\\\"\`，反斜杠用 \`\\\\\`。
- \`samples\`：**必须**与上方"题目样例"完全一致，原样转写，不要 trim、不要补全、不要修改任何字符。

## 修正原则

1. **针对错误修正**：
   - 编译错误 → 修正语法问题（如缺少分号、类型不匹配、未声明变量、数组越界等）
   - 样例失败 → 修正算法逻辑，确保**所有样例**通过（不仅是失败的样例，已通过的也要保持）
2. **最小改动**：尽量在原代码基础上修正，不要重写整个程序（除非逻辑根本错误）
3. **保持 GESP6 考试风格**（见下方规范）
4. **只修正 code 字段**：\`samples\` 字段必须原样保留

## GESP6 考试风格编码规范（必须遵守）

- 头文件用 \`#include <bits/stdc++.h>\` 和 \`using namespace std;\`
- **不使用迭代器**，改用下标循环遍历：

\`\`\`cpp
// 正确写法（下标循环）
int cnt = vec[u].size();
for (int i = 0; i < cnt; i++) {
    int v = vec[u][i];
}

// 错误写法（迭代器，禁止使用）
for (auto &v : vec[u]) { ... }
\`\`\`

- 先把 \`size()\` 存到 \`int\` 变量，再用 \`for\` 循环，避免无符号数比较的坑
- 输入输出用 \`scanf\` / \`printf\`（考试风格）
- 大数用 \`long long\`，乘法中间结果也要注意溢出
- 数组大小开到比数据范围上限多 5-10 个元素
- 代码结构清晰：全局变量 → 结构体 → 比较函数 → dfs/核心函数 → main
- 注释用中文，简洁明了

## 输出示例

<<<META>>>{"code":"#include <bits/stdc++.h>\\nusing namespace std;\\nint main(){\\n  int a, b;\\n  scanf(\\"%d %d\\", &a, &b);\\n  printf(\\"%d\\", a + b);\\n  return 0;\\n}","samples":[{"input":"1 2","expectedOutput":"3"}]}<<<HTML>>>
`;
