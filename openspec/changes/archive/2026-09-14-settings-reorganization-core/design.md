## Context

`setting-readability` 已落地 read / search 与写入端纯文本约束，但存量 world_entry 仍可能保留 Markdown、长单段、空字段、非标准分类和重复标题。现有 `update_setting`、`delete_setting`、`rename_world_category` 是单条或单类操作，缺少统一的“分析 → 计划 → 校验 → 确认 → 执行 → 复查”闭环。

本提案不新增数据库表，不改公开 HttpApi；工具实现在 plugin 内完成，继续使用 `description_history`、`EntityRefTable` 和现有级联任务。

## Goals / Non-Goals

**Goals:**

- 为 director 提供一个 `organize_settings` 工具，覆盖 `analyze`、`dry_run` 和 `apply`
- 第一阶段只处理 `world_entry`，并生成结构化、可测试的问题报告
- 通过计划白名单、重复 ID 检查、分类校验、纯文本校验、引用冲突检查和运行时确认控制风险
- 保持字段历史、引用追踪和章节级联行为与现有单条修改一致

**Non-Goals:**

- 不在工具内部调用 LLM 做语义合并或语义去重
- 不做一键自动重写、自动删除相似条目或跨书整理
- 不扩展 character / plot_thread / foreshadowing / relationship
- 不新增前端整理界面，后续由 `settings-organization-ui` 承接

## Decisions

### D1: 新增独立的设定整理模块

**选择**：在 plugin 的 novel-writer 目录下新增 setting-reorganization 模块，承载问题分析、计划校验和执行辅助逻辑；`organize_settings` tool 负责参数解析、结果输出和运行时确认。

**备选方案**：
- 全部写在 novel-writer.ts 内：主文件已经很大，整理规则也不适合继续扩散
- 放到 novel-store：分析规则属于写作插件工作流，不属于通用数据层

**理由**：整理规则会被后续实体扩展和 UI 提案复用，独立模块便于单元测试，同时不改变运行时依赖方向。

### D2: analyze 使用确定性规则

**选择**：直接扫描 world_entry，输出以下问题类型：

- `nonstandard_category`：主分类不在标准分类白名单
- `duplicate_title`：标题去除首尾空白后完全一致
- `similar_title`：标题规范化后使用编辑距离相似度判定，阈值取 `>= 0.85`
- `empty_field`：标题或内容为空白
- `long_single_paragraph`：内容超过 200 字且没有任何换行
- `markdown_syntax`：内容命中现有纯文本校验规则

**备选方案**：
- 交给 LLM 判断相似度：不稳定、不可复现，也不适合批量扫描
- 使用 FTS5 或向量检索：设定数据量小，当前问题主要是标题和格式，不是召回

**理由**：规则可解释、可复现、可测试；结果只作为候选，不自动决定保留或删除。

### D3: 计划采用显式 JSON 结构

**选择**：`plan_json` 使用版本 1 结构：

```json
{
  "version": 1,
  "entity_type": "world_entry",
  "operations": [
    { "action": "update", "id": "...", "fields": { "category": "力量体系", "title": "境界体系", "content": "第一段\n\n第二段" }, "reason": "修复分类和格式" },
    { "action": "merge", "target_id": "...", "source_ids": ["..."], "fields": { "content": "合并后的分段内容" }, "reason": "合并重复标题" },
    { "action": "delete", "id": "...", "reason": "删除无引用空条目" }
  ]
}
```

`update` 只允许 `category / title / content`；`merge` 只允许 `category / title / content`；`delete` 不接受字段修改。所有操作必须有非空 `reason`。

**备选方案**：
- 使用自然语言指令：无法稳定校验，也不能保证幂等
- 直接让 AI 连续调用 update/delete：缺少整体影响预览和原子审查入口

**理由**：结构化计划能被 dry run、apply、测试和后续 UI 复用，也让 AI 的每一步影响都可解释。

### D4: dry run 与 apply 使用同一套校验器

**选择**：`dry_run` 只校验并输出影响预览。`apply` 先用同一套校验器重新校验当前数据库状态，再通过 `ToolContext.ask` 请求用户确认；确认拒绝时直接返回未执行。

**备选方案**：
- 只依赖 dry run 结果或 confirmation token：数据库可能已经变化，旧结果不再可信
- 只靠提示词约束：无法阻止模型跳过关键步骤

**理由**：重新校验能避免基于过期数据执行；运行时确认比纯提示词更硬。

### D5: 删除与合并都检查活跃引用

**选择**：删除目标或 merge 源条目时，如果 `EntityRefTable` 中仍有指向该条目的活跃引用，dry run 返回引用冲突，apply 不执行该计划。被引用条目应先合并、改写引用或通过单条设定流程处理。

**备选方案**：
- 删除后清理引用：会让章节中既有称谓失去追踪，容易破坏叙事
- 允许 force 删除：第一版风险过高

**理由**：整理的第一阶段优先保守，宁可提示用户先处理引用，也不自动截断正文与设定的联系。

### D6: 执行保持现有副作用模型

**选择**：`update` 与 `merge` 的目标条目字段变化写入 `description_history`；目标条目 title 或 content 变化后重建引用追踪并调用现有级联任务逻辑。`delete` 只在无引用时执行，不写入字段历史。

**备选方案**：
- 为删除另建审计表：超出本提案范围
- 复用 `update_setting` 逐条执行：会拆散计划，无法统一校验和统一返回

**理由**：保持与现有设定修改一致，不引入迁移；删除的条目本身不再存在，字段历史恢复语义不适用于删除操作。

### D7: 提示词只引导，不替代工具校验

**选择**：director 提示词和 tool description 明确完整流程、确认要求、ID 真实性和纯文本要求；工具仍然独立校验计划。

**备选方案**：
- 只在提示词里写流程：模型可能跳步
- 只在工具里校验：AI 可能在错误上下文中生成无意义计划

**理由**：提示词决定模型如何组织工作，工具校验决定系统如何拒绝危险输入。

## Risks / Trade-offs

- [相似标题规则误报] → 相似结果只作为候选，必须由用户或 AI 人工判断，不自动删除
- [LLM 生成过于庞大的计划] → 限制第一版只处理 world_entry，校验器逐条报错；后续 UI 可提供分批确认
- [执行中部分失败] → 先完整校验降低失败概率；失败时停止后续操作并返回操作级结果，用户可重新 analyze 后生成新计划
- [删除检查只覆盖现有引用追踪] → 提示词要求 AI 只删除空条目或确认无引用的重复条目；引用追踪缺失时由复查和用户验收兜底
- [工具能力被误用于批量破坏] → 字段白名单、分类白名单、纯文本校验、运行时确认和无引用删除规则共同限制影响面

## Migration Plan

无数据库迁移，发布即生效。回滚时 revert 对应 plugin 提交即可；`organize_settings` 是新增工具，不改变既有调用方。已由该工具产生的字段修改仍保留在现有 `description_history` 中，可继续用现有工具查看和恢复。

## Open Questions

（无）
