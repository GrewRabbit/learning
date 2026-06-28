# GESP6 解题网页生成器（Web HTML 架构）终审意见

**评审对象**：arch-gesp6-web-html-v1.0.md（v1.2, 598 行）
**对照参考**：r2 评审意见（arch-gesp6-web-html-review-r2.md）
**评审时间**：2026-06-29
**评审结论**：通过（approved）

---

## 一、r2 重要问题解决验证

| r2 编号 | 问题描述（摘要） | 判定 | v1.2 中的解决位置 | 验证内容 |
|---------|----------------|------|------------------|---------|
| AR2-001 | CSP 应用方式未明确（父页 CSP 不继承到 srcDoc）+ CSP 缺 `font-src` 导致 Mermaid 字体被阻断 | 已解决 | §8.2 第 421 行；§9 第 454 行 | ①应用方式已明确为"**CSP 通过 iframe 的 `csp` 属性应用到 srcDoc 内的 HTML**"，并解释原因"srcDoc 创建独立浏览上下文，父页 CSP 不继承"；②给出系统硬编码示例 `<iframe sandbox="allow-scripts" csp="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self';" srcDoc={html}>`；③明确"CSP 策略由系统控制，不依赖 LLM 输出，避免 LLM 生成 HTML 篡改 CSP"；④`font-src 'self'` 已补充，并明确"确保 Mermaid 字体可加载"；⑤§9 风险表"HTML 含恶意脚本"对策同步更新为引用 iframe `csp` 属性 + `font-src 'self'`。两处一致，r2 推荐方案①完整落地 |
| AR2-002 | 洛谷抓取执行时机与模块依赖图矛盾（§4.2 步骤 6 要求抓取前置，但 §2.2 依赖图与 §4.2 步骤 1 未体现） | 已解决 | §2.2 第 77/90 行；§4.1 第 138 行；§4.2 步骤 1 第 144 行 | ①§2.2 依赖图已重构：洛谷抓取模块（第 77 行）现位于缓存模块（第 79 行）之前，并补充关键说明第 2 条（第 90 行）"洛谷抓取模块必须前置到缓存检查之前——缓存 key 为'标准化题目内容'的 SHA-256 hash，洛谷题号输入时需先抓取 Markdown 再 hash"；②§4.2 步骤 1（第 144 行）已补充"**前置**：若输入为洛谷题号，先调用洛谷抓取模块获取 Markdown（启用单飞），抓取失败直接返回 `GESP6_LUOGU_FETCH_FAILED`；再用 Markdown 文本的 SHA-256 hash 作为缓存 key"；③§4.1 输入数据流（第 138 行）补充"前置处理说明"，明确洛谷题号分支必须在缓存检查之前完成抓取。r2 推荐三处修订全部落地，依赖图、步骤 1、输入数据流三处一致 |

**r2 重要问题解决率：2/2 = 100%**

---

## 二、阻塞问题扫描

扫描范围：v1.2 全文 598 行，重点核查是否存在导致开发 agent 无法实施的阻塞问题（违反硬性规则、接口不合规、类型缺失、流程矛盾等）。

扫描结论：**未发现阻塞问题**。具体核查如下：

1. **流程一致性**：洛谷抓取时机在 §2.2 依赖图、§4.1 输入数据流、§4.2 步骤 1 三处表述一致（前置到缓存检查之前），无矛盾。缓存模块在依赖图中仅出现一次（§2.2 第 89 行明确"仅出现一次"，`[读]`/`[写]` 为操作类型标注），AR1-012 在 v1.2 中已完全解决。

2. **格式重试链路闭环**：§4.2 步骤 3（第 153 行）+ §4.4（第 208 行）明确"格式重试成功后回到步骤 3 重新解析，正常进入步骤 4 编译验证，编译/样例失败仍可进入步骤 5 修正循环（配额不变，最多 3 次）"；§5.4（第 324 行）明确 `GESP6_LLM_FORMAT_ERROR` 完整链路（HtmlParser 返回 → Orchestrator 触发格式重试 → 降级成功返回不再使用此错误码）。链路自洽，无歧义。

3. **类型完整性**：§5.2 给出 ServiceResult<T>、Problem、Solution、Meta、Sample、LLMInput、LLMOutput、ValidationResult 共 8 个共享类型定义，ValidationResult 已含 `trimEnabled: boolean` 字段，4 个接口签名与类型定义匹配。

4. **安全设计可实现**：§8.2 CSP 应用方式（iframe `csp` 属性）+ iframe sandbox 策略 + g++ ulimit 具体值（`-t 10 -v 262144 -n 64 -u 1`）+ 速率限制实现（middleware 内存 Map）均具体可实施。

5. **目录与依赖**：§6 目录结构完整，含 health/route.ts、logging/logger.ts、env.ts、components/ui/；§3.2 标注 lru-cache 为待新增依赖并给出安装命令。

---

## 三、合规性快速核查

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 4 接口返回 ServiceResult<T> | ✅ | §5.1 第 223/228/233/238 行：LLMCaller.generate、HtmlParser.parseMetaAndHtml、CodeValidator.validate、Orchestrator.solve 四个接口均返回 `ServiceResult<T>`（或 `Promise<ServiceResult<T>>`）；§5.2 第 246 行补充 ServiceResult<T> 类型定义 |
| Route Handler 有 Zod + try-catch | ✅ | §5.3 第 286-315 行：`solveRequestSchema` 定义完整（含 type enum + content refine 校验），POST 骨架含 try-catch、400（校验失败）/500（内部错误）分支；Zod 错误消息用法已修正为 `parsed.error.issues[0]?.message ?? '输入校验失败'`（AR2-004 已解决） |
| 无 any 类型 | ✅ | 全文 Grep `: any` 无匹配；类型定义均使用具体类型或泛型；NFR-005 明确"无 any 类型"约束 |
| 无跨模块 ../ 导入 | ✅ | 全文 Grep `\.\./` 仅命中 NFR-008（"禁止 `../` 跨模块"约束条文）；§6 第 366 行约束"`@/` 绝对路径导入"；NFR-008 明确约束 |

**附加核查**：

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 错误码符合 MODULE_CATEGORY_SPECIFIC | ✅ | §5.4 六个错误码（GESP6_INPUT_INVALID、GESP6_LUOGU_FETCH_FAILED、GESP6_LLM_TIMEOUT、GESP6_LLM_FORMAT_ERROR、GESP6_COMPILE_ENV_ERROR、GESP6_INTERNAL_ERROR）均符合 `MODULE_CATEGORY_SPECIFIC` 格式 |
| 单例导出 | ✅ | §7.2 复用清单含"单例导出"；NFR-017 明确约束 |
| 洛谷题号正则覆盖主流前缀 | ✅ | §5.3 第 295 行 / FR-003 / §8.2 均为 `^(P\|B\|T\|CF\|SP\|AT\|UVA)\w+$`（AR2-009 已解决） |

---

## 四、终审结论

### 4.1 核心结论

- **r2 重要问题解决率**：2/2 = 100%（AR2-001、AR2-002 均实质性解决，已找到具体位置与内容验证，非"声称"解决）
- **r2 建议问题**：9 项建议问题（AR2-003 ~ AR2-011）经核查均在 v1.2 中已修订（不作为终审否决条件，且实际已落地）
- **新发现阻塞问题数**：0
- **合规性核查**：全部通过（4 接口 ServiceResult<T> ✅ / Route Handler Zod+try-catch ✅ / 无 any ✅ / 无跨模块 ../ ✅ / 错误码格式 ✅ / 单例导出 ✅）
- **终审结论**：**通过（approved）**

### 4.2 状态更新建议

建议将文档状态从 `draft` 更新为 `approved`。理由：

1. r2 评审提出的 2 个重要问题（AR2-001 CSP 应用方式 + font-src、AR2-002 洛谷抓取时机前置）在 v1.2 中均已实质性解决，解决位置明确、内容可验证、多处表述一致。
2. 全文扫描未发现新的阻塞问题：流程一致（洛谷抓取时机三处一致、缓存模块单一节点、格式重试链路闭环）、类型完整（8 个共享类型 + 4 接口签名匹配）、安全设计可实现（CSP/sandbox/ulimit/速率限制均具体）。
3. 合规性核查全部通过，符合 api-conventions.md、code-style.md、naming-conventions.md 等全局规则。
4. 文档已历经完整评审闭环（v1.0 → r1 → v1.1 → r2 → v1.2），r1 解决率 20/21、r2 重要问题解决率 2/2，修订质量稳定。
5. 文档长度 598 行已有设计文档例外说明（第 9 行），不违反 code-style.md 500 行上限（该上限针对代码文件）。

### 4.3 后续行动

终审通过，文档可进入开发实施阶段：

1. **状态更新**：由 spec-generator（或文档维护者）将 `arch-gesp6-web-html-v1.0.md` 第 4 行状态从 `draft` 更新为 `approved`，并在变更记录追加终审通过记录。
2. **进入实施**：approved 状态的架构文档是 nextjs-architect、nextjs-dev-expert、nextjs-testing-expert 的唯一输入依据。实施阶段建议优先级：
   - P1：搭建目录骨架（§6）+ 待新增依赖安装（`npm install lru-cache@^11.0.0`）
   - P1：实现 4 个核心接口（§5.1）+ 共享类型（§5.2）
   - P1：HtmlParser 状态机（§4.2 解析规则，含 5 类边界）+ 单元测试
   - P1：CodeValidator g++ 沙箱（§8.2 ulimit 配置）+ 单元测试
   - P2：FixedLoopOrchestrator 编排流程（§4.2，含洛谷抓取前置 + 格式重试独立配额 + 修正循环 3 次）
   - P2：iframe 渲染 + CSP `csp` 属性硬编码（§8.2）
3. **实施阶段优化项**（r2 建议问题，不阻塞实施）：可在开发中持续打磨，无需返修架构文档。
