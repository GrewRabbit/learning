# gesp6-solution 技能维护说明

> 本文件存放技能的维护约定，**不会被技能系统加载**，仅供开发者参考。
> 技能系统只加载 SKILL.md 作为 Agent 工作流提示词，本文件不参与 LLM 调用。

## C++ 知识点体系库同步

SKILL.md 末尾的"附录：C++ 知识点体系库"与 `app/lib/ai/data/cpp-knowledge.md` 保持同步，更新知识点时两处都要修改。

| 位置 | 用途 | 加载方式 |
|------|------|----------|
| [SKILL.md](file:///var/learning/.trae/skills/gesp6-solution/SKILL.md) 附录 | 独立技能使用，附录内联在文档末尾 | Agent 直接读取 SKILL.md |
| [cpp-knowledge.md](file:///var/learning/app/lib/ai/data/cpp-knowledge.md) | 程序技能使用 | orchestrator 运行时加载并拼接进 prompt（见 [orchestrator.ts:337-339](file:///var/learning/app/lib/ai/services/orchestrator.ts)） |

**同步规则**：新增/修改/删除知识点时，两处必须同步更新，保持内容一致。
