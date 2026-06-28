---
name: "gesp6-solution"
description: "Analyzes programming problems and generates solution webpages with flowcharts, mind maps, and code. Invoke when user submits a programming problem (text, screenshot/image, or Luogu problem ID like P15800) and wants a detailed solution explanation webpage."
---

# GESP6 解题网页生成器

当用户提交编程题目（文字、截图、或洛谷题号）时，按照以下完整流程生成解题讲解网页。

## 环境与路径配置（跨平台，必读）

本技能同时支持 **Windows** 与 **Ubuntu 22.04 / Linux**。开始执行前，先运行 `uname -s` 判定操作系统：返回 `Linux` 走"Linux"列，否则走"Windows"列。后续步骤统一引用下列变量名。

### 路径变量对照表

| 变量 | Windows | Ubuntu 22.04 / Linux |
|------|---------|----------------------|
| `OUTPUT_BASE`（代码与网页统一输出根目录） | `\var\learning\workZone`（解析为当前盘符根，通常为 `C:\var\learning\workZone`） | `/var/learning/workZone` |
| `PROBLEM_DIR`（每题独立子目录，存放 C++ 代码与网页） | `<OUTPUT_BASE>\<题号>\` | `<OUTPUT_BASE>/<题号>/` |
| `SKILL_DIR`（本技能目录） | `c:\Users\Administrator\.trae-cn\builtin\work\default\skills\gesp6-solution\` | `/var/learning/.trae/skills/gesp6-solution` |
| `ASSETS_JS`（mermaid 等本地 JS） | `<SKILL_DIR>\assets\js\` | `<SKILL_DIR>/assets/js/` |
| `FONTS_DIR`（本地字体） | `<SKILL_DIR>\fonts\` | `<SKILL_DIR>/fonts/` |

- C++ 代码文件、编译产物、题目 md、网页文件**全部**统一存放在 `<PROBLEM_DIR>`（即 `<OUTPUT_BASE>/<题号>/`）下，不再使用独立的临时工作目录。
- 网页最终路径统一为 `<PROBLEM_DIR>/<题号>.html`，资源目录 `<PROBLEM_DIR>/_shared/`。
- 各题目通过独立的 `<PROBLEM_DIR>` 子文件夹隔离，天然支持多题并行，无需 `<session_id>`。
- **目录独立性与保留原则（重要）**：不同题号使用不同子目录，**严禁删除任何已存在的题目目录**。每道题开始前按下方"前置检查流程"处理目录。
- 跨平台路径分隔符差异：Linux 用 `/`，Windows 用 `\`；创建目录与拼路径时按当前系统使用对应分隔符。

### 前置检查流程（必做，禁止跳过）

每道题开始执行前，必须先对目标 `<PROBLEM_DIR>` 做以下检查，根据结果选择对应分支：

| 情形 | 判定方法 | 处理方式 |
|------|---------|---------|
| 目录不存在 | `ls <PROBLEM_DIR>` 报错或不存在 | 直接 `mkdir -p <PROBLEM_DIR>` 创建新目录，正常进入后续流程 |
| 目录存在且为同一题 | 读取 `<PROBLEM_DIR>/<题号>.md` 首行，确认题号与本次一致；并对比题目描述关键段落与本次获取的题目内容一致 | **直接复用原有结果**：跳过编译、生成 HTML 等步骤，仅向用户返回已生成的 `<PROBLEM_DIR>/<题号>.html` 路径 |
| 目录存在但题号不一致 | `<PROBLEM_DIR>/<题号>.md` 不存在，或首行题号与本次不一致 | **停止操作并向用户确认**：列出目录现有内容、本次题号，询问用户该如何处理（如改用其他目录名、手动迁移等），**严禁自行删除或覆盖** |
| 目录存在但内容空/损坏 | 目录存在但无 `<题号>.md` 或文件为空 | 保留目录，仅补充写入缺失文件，不删除已有任何文件 |

**绝对禁止的操作**（无论何种情形）：
- `rm -rf <PROBLEM_DIR>`
- `Remove-Item -Recurse -Force <PROBLEM_DIR>`
- 删除目录下任何已存在的 `.cpp` / `.html` / `.md` / `_shared/` 文件
- 覆盖写入已存在的同名文件前未读取确认

**同一题号复用结果的细化判定**：当目录已存在且题号一致时，需进一步确认"题目内容是否完全相同"——对比题目描述、输入输出格式、样例三部分。三者完全一致才视为"同一题目"，直接复用；任一不一致视为"题号被复用但题目不同"，按"题号不一致"分支处理（停止并向用户确认）。

### Ubuntu 22.04 一次性环境准备（仅首次，必做）

Linux 环境首次使用前，**必须**运行一次准备脚本（幂等，可重复执行，已安装的组件会跳过）：

```bash
bash <SKILL_DIR>/scripts/setup-ubuntu.sh
```

该脚本一次性安装并缓存：① Playwright 系统依赖（libnspr4 / libnss3 / libpango 等 apt 包，持久）；② Chromium 浏览器（持久，存于 `~/.cache/ms-playwright/`）；③ 全局 `playwright` npm 包（持久）；④ `assets/js/mermaid.min.js`（预缓存，避免每次从 CDN 下载）；⑤ `fonts/*.woff2` 字体（可选，失败回退系统字体）。完成后，后续调用本技能无需重复安装，验证步骤秒级启动。

Windows 环境无需此脚本，资源来自内置 `html-report` skill 的 `canvas-fonts/` 与 `assets/js/`。

## 触发条件

- 用户提交一道编程题目（文字描述、截图、或图片）
- 用户提供单个洛谷题号（如 P15800），要求读题并解题
- **用户提供多个洛谷题号**（如"P15800、P11376、P15800"），要求并行处理
- 用户要求"做这道题"、"解这道题"、"分析这道题"
- 用户贴出题目 + 要求生成网页/流程图/思维导图
- 用户说"按照之前的流程"或"按照之前的办法"

## 多题号并行处理流程

当用户提供**多个洛谷题号**时，按以下流程并行处理：

### 阶段一：批量获取题目内容（主 agent 串行执行）

浏览器只有一个，无法并行操作，所以先由主 agent 串行获取所有题目 Markdown：

1. 对每个题号，依次执行：
   - browser_navigate 打开 `https://www.luogu.com.cn/problem/<题号>`
   - browser_evaluate 执行 fetch API 获取题目 Markdown（见下方方式 A 的 JavaScript 代码）
   - **按"前置检查流程"处理目录**（严禁 `rm -rf`）：若 `<OUTPUT_BASE>/<题号>/` 不存在则 `mkdir -p` 创建；若已存在则读取 `<题号>.md` 首行核对题号与题目内容，题号且题目一致则**跳过此题的后续生成步骤、直接复用原有 HTML**；题号不一致则停止并向用户确认。只有目录不存在或内容空/损坏时才写入新的 Markdown 到 `<OUTPUT_BASE>/<题号>/<题号>.md`
2. 获取完所有题目后，browser_unlock 释放浏览器锁
3. 注意：每道题的获取很快（只是一个 API 调用），串行也不会太慢

### 阶段二：并行启动子 agent（主 agent 一次性发出多个 Task 调用）

用 Task 工具启动多个 `general_purpose_task` 子 agent，**在一条消息中发出所有 Task 调用**以实现并行。

每个子 agent 的任务描述必须包含以下完整信息（因为子 agent 看不到主会话的历史）：

```
请完成洛谷题目 <题号> 的解题网页生成，完整流程如下：

【环境判定】先运行 `uname -s`：返回 Linux 时
  OUTPUT_BASE=/var/learning/workZone
  SKILL_DIR=/var/learning/.trae/skills/gesp6-solution
  PROBLEM_DIR=<OUTPUT_BASE>/<题号>
否则（Windows）
  OUTPUT_BASE=\var\learning\workZone
  SKILL_DIR=c:\Users\Administrator\.trae-cn\builtin\work\default\skills\gesp6-solution
  PROBLEM_DIR=<OUTPUT_BASE>\<题号>
ASSETS_JS=<SKILL_DIR>/assets/js   FONTS_DIR=<SKILL_DIR>/fonts
（C++ 代码、编译产物、网页文件全部统一存放在 <PROBLEM_DIR> 下，不再使用独立的临时工作目录）

1. 读取题目内容：用 Read 工具读取文件 <PROBLEM_DIR>/<题号>.md，这是题目的完整 Markdown 内容。

2. 编写 GESP6 考试风格 C++ 代码，规范如下：
   - 头文件用 #include <bits/stdc++.h> 和 using namespace std;
   - 不使用迭代器，用下标循环：int cnt = vec[u].size(); for (int i = 0; i < cnt; i++) { int v = vec[u][i]; }
   - 输入输出用 scanf / printf
   - 大数用 long long，注意溢出
   - 注释用中文

3. 编译验证：**按"前置检查流程"处理 <PROBLEM_DIR>**（严禁 `rm -rf`）：
   - 若 <PROBLEM_DIR> 不存在：`mkdir -p <PROBLEM_DIR>` 创建
   - 若 <PROBLEM_DIR> 已存在：读取 <PROBLEM_DIR>/<题号>.md 首行核对题号，并对比题目描述、输入输出格式、样例三部分是否与本次完全一致
     * 题号且题目内容完全一致 → **直接复用原有结果**：跳过编译、生成 HTML 等所有步骤，仅返回 <PROBLEM_DIR>/<题号>.html 路径
     * 题号不一致或题目内容不同 → 停止操作，向主 agent 报告冲突，**严禁删除或覆盖**
     * 目录存在但 <题号>.md 缺失或为空 → 保留目录，仅补充写入缺失文件
   把代码保存到 <PROBLEM_DIR>/<题号>.cpp（若已存在则先 Read 确认内容再决定是否覆盖），用 g++ -O2 编译，用题目所有样例逐一测试，确认输出正确。

4. 创建资源子目录（跨平台，不依赖 powershell）：
   - 创建 <PROBLEM_DIR>/_shared/js/ 与 <PROBLEM_DIR>/_shared/fonts/
   - Linux 用 `mkdir -p`；Windows 用 `New-Item -ItemType Directory -Force`

5. 复制本地资源文件（来自本技能目录，不再依赖 html-report skill）：
   - mermaid.min.js：从 <ASSETS_JS>/mermaid.min.js 复制到 <PROBLEM_DIR>/_shared/js/
   - 字体文件：从 <FONTS_DIR>/ 复制 Outfit-Regular、Outfit-Bold、JetBrainsMono-Regular、JetBrainsMono-Bold（.woff2 或 .ttf，按实际存在文件名）到 _shared/fonts/

6. 编写完整的 HTML 文件到 <PROBLEM_DIR>/<题号>.html，包含八个章节：
   - 第一章：题目小故事（小学生语言）
   - 第二章：关键发现/数学推导
   - 第三章：算法策略
   - 第四章：程序流程图（Mermaid flowchart TD，节点文本不用特殊符号）。**必须**用 `.flowchart-section` Grid 容器把流程图（左列 `.flowchart-wrap`）与讲解卡片（右列 `.flowchart-cards`）并排包裹；每张讲解卡必须加 `data-nodes` 属性，值为对应 Mermaid 节点显示文本（多个用英文逗号分隔），用于点击节点高亮卡片交互。具体 CSS/JS 见 SKILL"流程图并排布局与交互样式"章节
   - 第五章：知识点思维导图（Mermaid mindmap，不用 emoji 和 ::icon）
   - 第六章：完整代码+逐段解析（HTML 转义 < > &）
   - 第七章：样例模拟（表格展示中间过程）
   - 第八章：总结口诀
   - @font-face 引用 ./_shared/fonts/ 下字体（存在时）；CSS --font/--font-mono 已带系统字体回退
   - Mermaid 初始化必须用 `theme: 'default'`（禁止 neutral/dark），并配 `themeVariables` 与页面 CSS 变量协调；`<style>` 必须含 `pre.mermaid { background: transparent !important }` 覆盖代码块黑底污染

7. 验证：
   - Linux：`python3 -m http.server <端口> --directory <OUTPUT_BASE>`，再执行
     `node <SKILL_DIR>/scripts/verify-page.js http://localhost:<端口>/<题号>/<题号>.html`
     预期输出 SVG_COUNT>=2 且 RESULT=PASS（该脚本用本地 Chromium，绕过 MCP Playwright 版本不匹配问题）。
   - Windows：用 python -m http.server 启动服务器，用 browser_navigate 打开网页检查 Mermaid 渲染（应有 2 个 SVG）。

CSS 变量：--bg:#fffdf7 --bg2:#f0ebe1 --ink:#2d2a26 --muted:#7a756d --rule:#e3ddd1 --accent:#e76f51 --accent2:#2a9d8f --accent3:#4a90e2

Mermaid 初始化：mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose', flowchart: { curve: 'basis' } })

**Mermaid 容器样式（必须）**：代码块 `<pre>` 通常用深色背景（黑底白字），会污染 `<pre class="mermaid">` 导致流程图变黑底。必须在 CSS 中显式覆盖：

```css
pre.mermaid, .mermaid {
  background: transparent !important;
  padding: 0 !important;
  color: var(--ink) !important;
  text-align: center;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}
pre.mermaid code, .mermaid code { background: transparent; padding: 0; color: inherit; }
```

主题说明：用 `theme: 'default'`（浅色柔和色调），与本页奶油色背景 `--bg:#fffdf7` 协调；**禁止**用 `neutral`（灰黑）或 `dark`（黑底）。如需自定义配色，可用 `themeVariables` 覆盖（如 `primaryColor: '#f0ebe1'` 等），但默认 'default' 已足够。

最终返回生成的网页文件路径。
```

### 阶段三：汇总结果

所有子 agent 完成后，主 agent 汇总各题目的网页链接，一次性返回给用户。

**并行注意事项：**
- 最多同时启动 3 个子 agent（遵循系统限制）
- 如果超过 3 个题目，分批启动，每批最多 3 个
- 每个子 agent 的代码文件和报告目录是独立的，不会冲突
- 子 agent 无法使用浏览器，所以题目内容必须提前由主 agent 获取并存入文件

## 单题号完整工作流程

### 第一步：获取题目内容

根据用户提供的输入形式，选择对应方式获取题目内容：

#### 方式 A：用户提供洛谷题号（优先判断）

当用户提供类似"P15800"、"P11376"等洛谷题号时：

1. 构造洛谷题目 URL：`https://www.luogu.com.cn/problem/<题号>`
2. 构造 API URL：`https://www.luogu.com.cn/problem/<题号>?_contentOnly=1`
3. 用 browser_navigate 打开洛谷题目页面（确保浏览器在洛谷域名下，避免 CORS 问题）
4. 用 browser_evaluate 执行以下 JavaScript，通过洛谷 API 获取题目 Markdown：

```javascript
var response = await fetch('https://www.luogu.com.cn/problem/<题号>?_contentOnly=1');
var data = await response.json();
var problem = data.currentData.problem;
var md = '';
md += '# ' + problem.title + '\n\n';
md += '## 题目描述\n\n' + problem.description + '\n\n';
md += '## 输入格式\n\n' + problem.inputFormat + '\n\n';
md += '## 输出格式\n\n' + problem.outputFormat + '\n\n';
md += '## 说明/提示\n\n' + (problem.hint || '') + '\n\n';
if (problem.samples) {
    for (var i = 0; i < problem.samples.length; i++) {
        md += '## 样例 ' + (i+1) + '\n\n';
        md += '### 输入\n\n```\n' + problem.samples[i][0] + '\n```\n\n';
        md += '### 输出\n\n```\n' + problem.samples[i][1] + '\n```\n\n';
    }
}
return md;
```

5. 拿到 Markdown 后，提取题目描述、输入输出格式、样例、数据范围等关键信息
6. 用 browser_unlock 释放浏览器锁

**注意事项：**
- 必须先 navigate 到洛谷页面，再执行 fetch，否则会有跨域问题
- `<题号>` 要替换为实际的题号，如 P15800
- 如果 API 返回失败，回退到 browser_snapshot 从页面 DOM 中提取题目文本

#### 方式 B：用户提供图片/截图

1. 用 Read 工具读取图片，提取题目文字、公式、已知条件
2. 分析题目类型和数据范围

#### 方式 C：用户直接提供文字

直接使用用户提供的题目文字内容

### 第二步：分析题目

1. 分析题目类型（贪心、递归、树、图、动态规划等）
2. 确认输入输出格式和数据范围
3. 如果用户还提供了满分参考代码，仔细分析其思路

### 第三步：编写 GESP6 考试风格代码

**必须遵守的编码规范：**

- 头文件用 `#include <bits/stdc++.h>` 和 `using namespace std;`
- **不使用迭代器**，改用下标循环遍历：
  ```cpp
  // 正确写法（下标循环）
  int cnt = vec[u].size();
  for (int i = 0; i < cnt; i++) {
      int v = vec[u][i];
      // ...
  }
  
  // 错误写法（迭代器，禁止使用）
  for (auto &v : vec[u]) { ... }
  ```
- 先把 `size()` 存到 `int` 变量，再用 `for` 循环，避免无符号数比较的坑
- 输入输出用 `scanf` / `printf`（考试风格）
- 大数用 `long long`，乘法中间结果也要注意溢出
- 数组大小开到比数据范围上限多 5-10 个元素
- 代码结构清晰：全局变量 → 结构体 → 比较函数 → dfs/核心函数 → main
- 注释用中文，简洁明了

### 第四步：编译验证

1. **按"前置检查流程"处理 `<PROBLEM_DIR>`**（严禁 `rm -rf`、严禁删除已有目录）：
   - 若 `<PROBLEM_DIR>` 不存在：`mkdir -p <PROBLEM_DIR>` 创建新目录
   - 若 `<PROBLEM_DIR>` 已存在：用 Read 读取 `<PROBLEM_DIR>/<题号>.md` 首行核对题号，并对比题目描述、输入输出格式、样例三部分是否与本次完全一致
     * 题号且题目内容完全一致 → **直接复用原有结果**：跳过编译、生成 HTML 等所有后续步骤，仅向用户返回 `<PROBLEM_DIR>/<题号>.html` 路径
     * 题号不一致或题目内容不同 → 停止操作并向用户确认，**严禁自行删除或覆盖**
     * 目录存在但 `<题号>.md` 缺失或为空 → 保留目录，仅补充写入缺失文件
2. 将代码保存到 `<PROBLEM_DIR>/<题号>.cpp`（若文件已存在，先 Read 确认内容，再决定是否覆盖；禁止无脑覆盖）
3. 用 `g++` 编译（加 `-O2` 优化），编译产物也落在 `<PROBLEM_DIR>/` 下
4. 用题目提供的所有样例逐一测试
5. 确认所有样例输出正确后才继续

### 第五步：创建资源子目录与复制资源（跨平台）

> 说明：原依赖 `html-report` skill 与 `new-report.ps1` 仅 Windows 内置环境可用。现已改为本技能自带资源 + 跨平台目录创建，Windows 与 Linux 通用。

1. 创建资源子目录：`<PROBLEM_DIR>/_shared/js/`、`<PROBLEM_DIR>/_shared/fonts/`（`<PROBLEM_DIR>` 本身已在第四步创建，用于存放 C++ 代码与网页）
   - Linux：`mkdir -p <PROBLEM_DIR>/_shared/js <PROBLEM_DIR>/_shared/fonts`
   - Windows：`New-Item -ItemType Directory -Force <PROBLEM_DIR>\_shared\js`（fonts 同理）
2. 复制 mermaid.min.js：从 `<ASSETS_JS>/mermaid.min.js` → `<PROBLEM_DIR>/_shared/js/mermaid.min.js`
3. 复制字体文件：从 `<FONTS_DIR>/` 复制 Outfit-Regular、Outfit-Bold、JetBrainsMono-Regular、JetBrainsMono-Bold（按实际存在的 `.woff2`/`.ttf` 文件名）→ `_shared/fonts/`
4. 编写完整的 HTML 文件到 `<PROBLEM_DIR>/<题号>.html`

### 第六步：网页内容结构（共八个章节）

网页必须包含以下八个章节，缺一不可：

#### 第一章：题目小故事
- 用小学生听得懂的语言重新描述题目
- 用生活化的比喻（如"物流队长"、"大树"等）
- 把数学公式用白话解释
- 用 `<span class="key">` 标记关键术语

#### 第二章：关键发现 / 数学推导
- 推导核心公式，用 `<div class="formula">` 展示
- 用 `.card` 卡片解释每一步的含义
- 让读者理解"为什么要这样做"

#### 第三章：算法策略
- 用卡片分步骤讲解贪心/递归/动态规划的思路
- 解释"为什么这样是最优的"

#### 第四章：程序流程图
- 使用 Mermaid `flowchart TD` 语法
- **Mermaid 语法限制（重要）：**
  - 节点文本不要用特殊符号（`=`, `*`, `+`, `-`, `<`, `>`, `()`, `[]` 等会被解析为语法）
  - 用中文文字描述代替符号，如"ans 加 1"而不是"ans += 1"
  - 判断条件用"是xxx吗"的问句形式
  - 分支用 `|是|` 和 `|否|` 标注
- **流程图布局规范（重要，必须遵守）：**
  - **必须符合中国人基本阅读顺序：从左到右，从上到下**
  - **开始节点必须位于视觉最上方**（主流程纵向排列时），或主流程左侧水平位置的最上方（纵向不便时）
  - **结束节点必须位于视觉最下方**（主流程纵向排列时），或主流程右侧水平位置的最下方（纵向不便时）
  - 开始节点和结束节点都不能被循环体包裹在中间
  - 主循环体必须用 `subgraph` 分组，把循环内的所有节点包围起来，避免与开始/结束节点混在同一层
  - 开始节点只发出一条边到主流程的第一个节点，**不接受任何回边**（避免 dagre 把开始节点排到中间）
  - 结束节点只接受最终判断节点（主循环条件不满足）的"否"分支进入，不接受循环体内任何节点的直接边
  - 回边（循环回到判断）必须限制在 subgraph 内部，不能跨越到 subgraph 外
  - subgraph 命名用中文，简洁描述循环作用（如 `subgraph 循环体` / `subgraph 主循环`）
  - **标准结构示例（必须按此结构组织）：**
    ```
    flowchart TD
        A([开始]) --> B[初始化变量]
        B --> C{还有数据吗}
        subgraph 主循环
          C -->|是| D[读取当前数据]
          D --> E[处理数据]
          E --> F[更新指针]
          F --> C
        end
        C -->|否| G[输出结果]
        G --> H([结束])
    ```
  - **错误示例（禁止）：**
    - 把 `G --> H` 写在循环体内部，或让循环回边指向 G/H，会导致 dagre 把结束节点排在中间被循环包裹
    - 让任何边指向开始节点 A（如 `X --> A`），会导致 dagre 把开始节点排到中间或下方
    - 把开始节点 A 放进 subgraph 内部，会导致开始节点被循环体包裹
- 流程图后必须附"流程图每一步讲解"，用 `.card` 卡片逐个解释每个步骤
- **并排布局与节点-卡片映射（必须遵守）：**
  - 流程图与讲解卡片**必须**并排展示（左流程图，右讲解卡片），用 `.flowchart-section` Grid 容器包裹
  - **HTML 结构约定（必须按此结构组织）：**
    ```html
    <div class="flowchart-section">
      <!-- 左列：流程图 -->
      <div class="flowchart-wrap">
        <pre class="mermaid">
        flowchart TD
            A([开始]) --> B[初始化变量]
            ...
        </pre>
      </div>
      <!-- 右列：讲解卡片，data-nodes 填写该卡对应的 Mermaid 节点文本，多个用英文逗号分隔 -->
      <div class="flowchart-cards">
        <h3>流程图每一步讲解</h3>
        <div class="card" data-nodes="初始化变量">
          <div class="card-title">初始化变量</div>
          <p>...</p>
        </div>
        <div class="card green" data-nodes="读取当前数据,处理数据,更新指针">
          <div class="card-title">主循环：读取-处理-更新</div>
          <p>...</p>
        </div>
        ...
      </div>
    </div>
    ```
  - **`data-nodes` 属性规范（重要）：**
    - 每张讲解卡**必须**有 `data-nodes` 属性，值为该卡对应的 Mermaid 节点显示文本（不是节点 id 字母），多个用英文逗号分隔
    - 节点文本必须与 Mermaid 源码中节点 `[...]`、`{...}`、`(...)` 里的文字**完全一致**（含空格、标点）
    - 一张卡可对应多个节点（如循环体多步合并讲解）；不必为"开始""结束"等无足轻重的节点单独建卡
    - 此属性是点击节点 → 高亮对应卡片交互的映射依据，缺失则该节点点击无响应
  - **生成时的对应规则：** 先写 Mermaid 流程图（确定每个节点的显示文本），再写讲解卡时逐一回填 `data-nodes`，确保文本严格一致

#### 第五章：知识点思维导图
- 使用 Mermaid `mindmap` 语法
- **思维导图语法限制（重要）：**
  - 节点文本不要用特殊符号和 emoji 图标 `::icon()`（容易渲染失败）
  - 用纯中文文字描述
  - 缩进表示层级关系
- **思维导图交互规范（重要，必须遵守）：**
  - **默认只渲染 Mermaid mindmap，不预显示任何讲解卡片**（取消"精选知识点"默认展示）
  - 讲解卡片初始全部 `display:none`，仅当用户点击对应思维导图节点时才显示
  - 选中的思维导图节点必须加高亮边框（视觉反馈，类似流程图节点选中态）
  - 显示的讲解卡片带边框颜色提示（用 `.card` 不同颜色变体区分知识点类型）
  - 同一时刻只显示一张讲解卡片（点击新节点时自动隐藏前一张）
  - **HTML 结构约定（思维导图区域必须用 `<div class="mindmap-section">` 包裹）：**
    ```html
    <div class="mindmap-section">
      <!-- Mermaid 思维导图 -->
      <pre class="mermaid">
      mindmap
        root((素数统计))
          试除法
          试到平方根
          循环嵌套
      </pre>

      <!-- 讲解卡片（data-node 对应思维导图节点文本，初始全部隐藏） -->
      <div class="card mindmap-card" data-node="试除法" style="display:none;">
        <div class="card-title">试除法</div>
        <p>判断素数最基础的方法：从 2 试到平方根...</p>
      </div>
      <div class="card mindmap-card green" data-node="循环嵌套" style="display:none;">
        <div class="card-title">循环嵌套</div>
        <p>外层遍历 + 内层试除...</p>
      </div>
    </div>
    ```
  - **JS 交互实现（必须包含在生成的 HTML 中）：**
    ```javascript
    function initMindmapInteraction() {
      var section = document.querySelector('.mindmap-section');
      if (!section) return;
      var cards = section.querySelectorAll('.mindmap-card');
      // 默认全部隐藏（兜底）
      cards.forEach(function(c) { c.style.display = 'none'; c.classList.remove('active'); });

      // 第一步：收集所有含形状子元素 + text 子元素的 g（任意层级）
      // Mermaid 渲染后 SVG 无 .mindmap 类，不能用 .mindmap .node 选择器
      var allG = section.querySelectorAll('svg g');
      var candidates = [];
      allG.forEach(function(g) {
        var hasShape = g.querySelector('rect, circle, polygon');
        var textEl = g.querySelector('text');
        if (hasShape && textEl && textEl.textContent.trim()) {
          candidates.push(g);
        }
      });

      // 第二步：只保留"最内层"的 g（不包含其他候选 g），过滤掉父级容器
      var nodes = candidates.filter(function(g) {
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i] === g) continue;
          if (g.contains(candidates[i])) return false;
        }
        return true;
      });

      nodes.forEach(function(node) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', function(e) {
          e.stopPropagation();
          var textEl = node.querySelector('text');
          var text = textEl ? textEl.textContent.trim() : '';
          if (!text) return;

          // 清除所有节点高亮 + 隐藏所有卡片
          nodes.forEach(function(n) { n.classList.remove('active'); });
          cards.forEach(function(c) { c.style.display = 'none'; c.classList.remove('active'); });

          // 高亮当前节点 + 显示对应卡片（CSS.escape 处理特殊字符）
          node.classList.add('active');
          var card = section.querySelector('.mindmap-card[data-node="' + CSS.escape(text) + '"]');
          if (card) {
            card.style.display = 'block';
            card.classList.add('active');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      });
    }
    // Mermaid 渲染完成后初始化（startOnLoad 时序）
    setTimeout(initMindmapInteraction, 600);
    ```
- 思维导图区域必须保留"思维导图知识点讲解"标题，但卡片按需显示（点击节点后才出现）

#### 第六章：完整代码 + 逐段解析
- 用 `<pre><code>` 展示完整代码
- HTML 转义所有特殊字符（`<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`）
- 代码后附"代码逐段解析"，用 `.card` 卡片逐段解释每个关键部分

#### 第七章：样例模拟
- 对每个样例进行手动模拟
- 用 `<table>` 展示中间计算过程
- 每一步的计算过程要清晰可见
- 最终答案用 `<span class="key">` 标记并加 ✓ 确认

#### 第八章：总结
- 用 `.card.yellow` 卡片给出核心口诀（朗朗上口的押韵短句）
- 总结本题用到的所有知识点

### 第七步：验证网页渲染

> Linux 环境下，MCP Playwright 服务期望的浏览器版本可能与本地已装版本不一致（如 1200 vs 1228），导致 `browser_navigate` 报 "Executable doesn't exist"。此时改用本技能自带的 `verify-page.js`（通过 `executablePath` 直接调用本地 Chromium，绕过版本校验）。

**Linux（推荐）：**

1. 启动服务器：`python3 -m http.server <端口> --directory <OUTPUT_BASE>`
2. 执行验证脚本：`node <SKILL_DIR>/scripts/verify-page.js http://localhost:<端口>/<题号>/<题号>.html`
3. 检查输出：`SVG_COUNT>=2` 且 `RESULT=PASS` 即通过（脚本同时保存全页截图到 `/tmp/gesp6-verify.png`）
4. 确认无误后给出网页 URL

**Windows：**

1. 用 `python -m http.server` 启动本地服务器
2. 用 browser_navigate 打开网页
3. 检查 Mermaid 图表是否正确渲染（应有 2 个 SVG）
4. 截图检查流程图和思维导图的显示效果
5. 确认无误后给出 `computer://` 链接

## 设计系统规范

### CSS 变量

```css
:root {
  --bg: #fffdf7;
  --bg2: #f0ebe1;
  --ink: #2d2a26;
  --muted: #7a756d;
  --rule: #e3ddd1;
  --accent: #e76f51;
  --accent2: #2a9d8f;
  --accent3: #4a90e2;
  --font: 'Outfit', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrainsMono', 'Consolas', monospace;
  --max: 920px;
}
```

### 字体

从本技能自带 `<FONTS_DIR>/` 复制（Linux 由 `setup-ubuntu.sh` 预缓存为 `.woff2`；Windows 内置环境为 `.ttf`，按实际存在文件名取用）：
- `Outfit-Regular`（.woff2 / .ttf）
- `Outfit-Bold`（.woff2 / .ttf）
- `JetBrainsMono-Regular`（.woff2 / .ttf）
- `JetBrainsMono-Bold`（.woff2 / .ttf）

> 字体缺失不影响渲染：CSS 中 `--font`/`--font-mono` 已带 `PingFang SC` / `Microsoft YaHei` / `Consolas` 系统字体回退。

### 必须复制的 JS 库

从本技能自带 `<ASSETS_JS>/` 复制：
- `mermaid.min.js` → `_shared/js/mermaid.min.js`

### Mermaid 初始化

```html
<script src="./_shared/js/mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: { curve: 'basis' }
  });
</script>
```

### 卡片样式

- `.card` 默认（橙色左边框 `--accent`）
- `.card.green`（绿色左边框 `--accent2`）
- `.card.blue`（蓝色左边框 `--accent3`）
- `.card.yellow`（黄色左边框 `#e9c46a`）

### Mermaid 容器样式（必须包含，避免黑底污染）

代码块 `<pre>` 通常配深色背景（黑底白字）以提升代码可读性，但 Mermaid 图表也用 `<pre class="mermaid">` 标签，会被同一条 CSS 规则污染成黑底。**必须**在 `<style>` 中显式覆盖（与思维导图、流程图通用）：

```css
pre.mermaid, .mermaid {
  background: transparent !important;
  padding: 0 !important;
  color: var(--ink) !important;
  text-align: center;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}
pre.mermaid code, .mermaid code { background: transparent; padding: 0; color: inherit; }
.mermaid svg { max-width: 100%; height: auto; }
```

**主题选择**：`mermaid.initialize` 必须用 `theme: 'default'`（浅色柔和），与本页奶油色背景 `--bg:#fffdf7` 协调；**禁止** `neutral`（灰黑单调）或 `dark`（黑底）。若需更贴合配色的自定义色，可用 `themeVariables`：

```javascript
mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { curve: 'basis' },
  themeVariables: {
    primaryColor: '#f0ebe1',      // 节点底色 = --bg2
    primaryTextColor: '#2d2a26',  // 节点文字 = --ink
    primaryBorderColor: '#e76f51',// 节点边框 = --accent
    lineColor: '#7a756d',         // 连线 = --muted
    secondaryColor: '#fdf6e3',
    tertiaryColor: '#fffdf7'
  }
});
```

### 流程图并排布局与交互样式（必须包含）

第四章流程图与讲解卡片必须并排展示（左流程图、右卡片），且点击流程图节点要高亮对应卡片并滚动到视口。所需 CSS 与 JS 如下，**所有生成的 HTML 必须包含**。

**CSS（加入 `<style>` 中）：**

```css
/* 流程图 + 卡片并排布局 */
.flowchart-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 28px;
  align-items: start;
  margin: 16px 0;
}
.flowchart-wrap {
  position: sticky;
  top: 16px;
  background: #fff;
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 16px;
  max-height: calc(100vh - 32px);
  overflow: auto;
}
.flowchart-wrap pre.mermaid {
  background: transparent !important;
  padding: 0 !important;
  text-align: center;
  margin: 0;
}
.flowchart-cards .card { transition: box-shadow 0.2s, border-color 0.2s; }

/* 点击节点后高亮对应卡片 */
.flowchart-cards .card.active {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px rgba(231, 111, 81, 0.25), 0 4px 12px rgba(231, 111, 81, 0.15);
}
/* 点击节点后高亮节点本身 */
.flowchart-wrap svg g.active > rect,
.flowchart-wrap svg g.active > circle,
.flowchart-wrap svg g.active > polygon {
  stroke: var(--accent) !important;
  stroke-width: 3 !important;
  filter: drop-shadow(0 0 6px rgba(231, 111, 81, 0.5));
}
.flowchart-wrap svg g { cursor: pointer; }

/* 移动端回落为单列 */
@media (max-width: 900px) {
  .flowchart-section { grid-template-columns: 1fr; }
  .flowchart-wrap { position: static; max-height: none; }
}
```

**JS 交互（必须包含在生成的 HTML 中，紧跟 `initMindmapInteraction` 之后）：**

```javascript
// 流程图节点点击 → 高亮对应讲解卡 + 滚动到视口
function initFlowchartInteraction() {
  var section = document.querySelector('.flowchart-section');
  if (!section) return;

  var wrap = section.querySelector('.flowchart-wrap');
  var cardsContainer = section.querySelector('.flowchart-cards');
  if (!wrap || !cardsContainer) return;

  var cards = cardsContainer.querySelectorAll('.card[data-nodes]');
  if (cards.length === 0) return;

  // 清除所有高亮
  function clearAll() {
    cards.forEach(function(c) { c.classList.remove('active'); });
    wrap.querySelectorAll('svg g.active').forEach(function(n) { n.classList.remove('active'); });
  }

  // 收集所有"含形状 + 含文本"的 g 元素（流程图节点）
  var allG = wrap.querySelectorAll('svg g');
  var candidates = [];
  allG.forEach(function(g) {
    var hasShape = g.querySelector('rect, circle, polygon');
    var textEl = g.querySelector('text');
    if (hasShape && textEl && textEl.textContent.trim()) {
      candidates.push(g);
    }
  });
  // 仅保留最内层 g（剔除父容器）
  var nodes = candidates.filter(function(g) {
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] === g) continue;
      if (g.contains(candidates[i])) return false;
    }
    return true;
  });

  // 构建 "节点文本 → 卡片" 映射表
  var textToCard = {};
  cards.forEach(function(c) {
    var attr = c.getAttribute('data-nodes') || '';
    attr.split(',').forEach(function(t) {
      textToCard[t.trim()] = c;
    });
  });

  nodes.forEach(function(node) {
    node.style.cursor = 'pointer';
    node.addEventListener('click', function(e) {
      e.stopPropagation();
      var textEl = node.querySelector('text');
      var text = textEl ? textEl.textContent.trim() : '';
      if (!text) return;

      clearAll();
      node.classList.add('active');

      var target = textToCard[text];
      if (target) {
        target.classList.add('active');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}
setTimeout(initFlowchartInteraction, 600);
```

**注意事项：**
- `initFlowchartInteraction` 与 `initMindmapInteraction` 互不影响，分别绑定到 `.flowchart-section` 与 `.mindmap-section` 容器内
- 若流程图节点文本与 `data-nodes` 不严格一致（如多空格），点击将无响应——生成时务必校对
- 移动端（<900px）自动回落为单列布局，sticky 失效，交互仍可用

### 思维导图交互样式（必须包含）

思维导图按需展示需要以下 CSS（加入 `<style>` 中）。
**注意**：Mermaid 渲染后 SVG 无 `.mindmap` 类，必须用容器 `.mindmap-section` 定位：

```css
/* 思维导图节点点击高亮（边框颜色提示，类似流程图节点选中态） */
.mindmap-section svg g.active > rect,
.mindmap-section svg g.active > circle,
.mindmap-section svg g.active > polygon {
  stroke: var(--accent) !important;
  stroke-width: 3 !important;
  filter: drop-shadow(0 0 6px rgba(231, 111, 81, 0.5));
}

/* 思维导图节点鼠标指针提示可点击 */
.mindmap-section svg g {
  cursor: pointer;
}

/* 讲解卡片选中态（与思维导图节点联动） */
.mindmap-card.active {
  border-left-color: #e9c46a !important;
  background: #fffbeb;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

/* 讲解卡片显隐过渡 */
.mindmap-card {
  transition: all 0.2s ease;
}
```

### 流程图 subgraph 样式（可选优化）

为了让循环体 subgraph 视觉更清晰，可加入：

```css
/* subgraph 循环体边框淡化 */
.mermaid .cluster rect {
  fill: rgba(231, 111, 81, 0.04) !important;
  stroke: var(--rule) !important;
  stroke-dasharray: 4 4;
}
.mermaid .cluster text {
  fill: var(--muted) !important;
  font-size: 12px;
}
```

## 输出路径规范

- 统一输出根目录：`<OUTPUT_BASE>`（Windows: `\var\learning\workZone`，解析为当前盘符根，通常为 `C:\var\learning\workZone`；Linux: `/var/learning/workZone`）
- 每题独立子目录：`<PROBLEM_DIR>` = `<OUTPUT_BASE>/<题号>/`，存放该题的 C++ 源码、编译产物、题目 md、网页文件与资源，**不再使用独立的临时工作目录**。不同题号使用不同子目录，**严禁删除已存在的任何题目目录**，开始前按"前置检查流程"判定是创建、复用还是停止确认。
- C++ 源码：`<PROBLEM_DIR>/<题号>.cpp`
- 网页文件：`<PROBLEM_DIR>/<题号>.html`
- 资源目录：`<PROBLEM_DIR>/_shared/`（含 `js/`、`fonts/`）

## 语言要求

- 所有输出内容（代码注释、网页文字、卡片讲解）使用中文
- 讲解语言尽量用小学生听得懂的表达
- 用生活化的比喻代替抽象术语
- 数学公式要变形推导，让读者理解"为什么"

## 关键注意事项

1. **Mermaid 语法避坑**：节点文本中绝对不要出现 `=`, `*`, `+`, `-`, `<`, `>`, `()`, `[]`, `::` 等符号，用中文文字代替
2. **HTML 转义**：代码块中 `<` `>` `&` 必须转义
3. **先验证后生成**：代码必须先通过所有样例，再生成网页
4. **网页必须自包含**：所有资源用相对路径，不依赖外部 CDN
5. **资源来自本技能自带目录**：mermaid.min.js 与字体均从 `<SKILL_DIR>/assets/js/`、`<SKILL_DIR>/fonts/` 复制，不再依赖 `html-report` skill 与 `new-report.ps1`（后者仅 Windows 内置环境可用）。Linux 首次使用前必运行 `scripts/setup-ubuntu.sh` 预缓存这些资源
6. **多题号并行**：子 agent 无法使用浏览器，题目 Markdown 必须由主 agent 提前获取并存入文件
7. **并行上限**：每批最多 3 个子 agent，超过 3 个题目需分批启动
8. **子 agent 自包含**：子 agent 看不到主会话历史，任务描述必须包含完整的工作流程和所有必要信息
9. **Linux 验证用 verify-page.js**：MCP Playwright 可能因浏览器版本不匹配无法启动，Linux 下统一用 `node <SKILL_DIR>/scripts/verify-page.js <URL>` 验证
10. **目录独立性与保留原则（重要）**：不同题号使用不同 `<PROBLEM_DIR>` 子目录。**严禁删除任何已存在的题目目录**（禁止 `rm -rf`、禁止 `Remove-Item -Recurse -Force`）。开始前必须按"前置检查流程"判定：目录不存在则创建；目录存在且题号+题目内容完全一致则直接复用原结果；目录存在但题号/题目不一致则停止并向用户确认，不擅自删除或覆盖。
