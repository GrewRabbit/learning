# Fetcher 样例提取与 normalize 修正

**日期**：2026-07-05
**类型**：修复 + 优化
**影响范围**：题目抓取层（youdao-fetcher、luogu-fetcher）、样例指纹生成

## 变更背景

线上日志分析发现，有道小图灵 URL 输入答题时 `sampleFpAll=""`、`sampleFpFirst=""`、`hasSampleFp=false`，导致后续文本/图片输入无法命中 sample 索引缓存。同时用户反馈：有些题目确实没有输入只有输出（如 Hello,World!），fetcher 不能因输入为"无"就认为值为空。

排查发现两个根本问题：

1. **有道 fetcher 缺少专用选择器**：有道小图灵使用 CSS Modules（类名带 hash 后缀，如 `QuestionDetail_section__2bSNz`），旧 fetcher 只有通用选择器（`.problem-content` 等），全部不匹配，回退到 body 文本只抓到 109 字符导航文本，无代码块无"输入：/输出："模式，触发 FR-003 降级返回空指纹。
2. **fetcher 预先 normalize 破坏 markdown 结构**：orchestrator L173 注释明确说"用原始 markdown"，但 youdao-fetcher 和 luogu-fetcher 都在返回前调用了 `normalizeContent`，把 markdown 换行合并为空格。这导致 `extractSampleFingerprint` 的 `^#{2,4}\s` 无法识别"## 样例"章节标题（不在行首），只能 fallback 到全文提取代码块。虽然简单题目仍能生成 sampleFp，但"说明/提示"中的代码块会被错误地包含进样例指纹，造成跨输入类型缓存 miss。

## 变更内容

### 有道 fetcher 专用选择器（youdao-fetcher.ts）

- 新增 `extractYoudaoContent` 方法：用属性前缀选择器 `section[class*="QuestionDetail_section"]` 提取各 section，按"题目描述/输入描述/输出描述/样例/提示"结构拼接 markdown
- 新增 `extractYoudaoExamples` 方法：成对提取 `QuestionDetail_examples_header` + `QuestionDetail_examples_display`，格式化为 markdown 代码块
- **保留"无"作为有效输入值**：有些题目只有输出没有输入（如 Hello,World!），输入为"无"也写入代码块 ` ```\n无\n``` `，参与 sampleFp 计算
- 移除"复制"按钮文本（`QuestionDetail_copyBtn`）的干扰

### fetcher 返回原始 markdown（youdao-fetcher.ts + luogu-fetcher.ts）

- 两个 fetcher 都移除 `normalizeContent(content)` 调用，返回原始 markdown
- orchestrator（L171）已有 `normalizeContent(rawContent)` 调用，负责统一标准化用于 contentHash
- `extractSampleFingerprint(rawContent)`（L174）拿到原始 markdown，能正确识别"## 样例"章节标题
- 修正后 fetcher 职责清晰：抓取 + 拼接 markdown；orchestrator 职责：normalize + contentHash + sampleFp

### 跨平台 sampleFp 一致性验证

测试验证：同一题目（输入"无"+输出"Hello,World!"）无论从 luogu 还是有道抓取，都生成完全相同的 sampleFp：
```
sampleFpAll  = 3c527f4329f1a52fb6bd398711f7bc9088c643fc820bbc2ea034c1dde415b249
sampleFpFirst = 3c527f4329f1a52fb6bd398711f7bc9088c643fc820bbc2ea034c1dde415b249
```
且 `usedFallback: false`（正确识别了"## 样例"章节，未 fallback 到全文）。

## 涉及文件

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `app/lib/ai/services/problem-fetchers/youdao-fetcher.ts` | 修改 | 新增 extractYoudaoContent/extractYoudaoExamples 方法（CSS Modules 选择器 + 保留"无"）+ 移除 normalizeContent 调用 + 新增 domhandler AnyNode 类型导入 |
| `app/lib/ai/services/problem-fetchers/luogu-fetcher.ts` | 修改 | 移除 normalizeContent 调用，返回原始 markdown（与 youdao 保持一致） |
| `app/lib/ai/services/problem-fetchers/__tests__/problem-fetchers.test.ts` | 修改 | 新增 buildYoudaoHtml 辅助函数 + 4 个 youdao 专用选择器测试用例 + 1 个 luogu"输入为无"sampleFp 生成测试用例 |

## 配置 / 环境变量变化

无。

## 验证方式

- [x] 类型检查：`npx tsc --noEmit` 无错误
- [x] 单元测试：`npx vitest run` 294 passed / 4 skipped（新增 5 用例：youdao 4 + luogu 1）
- [x] 关键测试套件：problem-fetchers.test.ts 25 用例全通过
- [x] 跨平台一致性：luogu 和 youdao 对同一题目生成相同 sampleFp

## 后续影响 / 注意事项

1. **旧缓存失效**：有道小图灵之前抓取的内容（109 字符导航文本）对应的 contentHash 与新抓取内容不同，旧 primary 索引会 miss，触发重新抓取 + LLM 生成。这是预期行为，新缓存的 sampleFp 才是有效的。
2. **sample 索引重建**：旧的 sample 索引（基于空 sampleFp，未写入）本就不存在，新抓取会按新 sampleFp 写入索引，后续文本/图片输入可命中。
3. **不影响 luogu 现有缓存**：luogu 之前抓取的 markdown 内容本身正确（只是被 normalize 了换行），contentHash 由 orchestrator 统一 normalize 后计算，所以 luogu 的 primary 索引和 content 文件仍然有效。变化的是 sampleFp 的提取路径（从 fallback 全文改为精准章节匹配），sample 索引可能需要重建。
4. **设计原则确认**：fetcher 返回原始 markdown，orchestrator 统一 normalize。这一原则现已落实到两个 fetcher，后续新增 fetcher 应遵循同样模式。
