## Why

设定数量增长后会出现分类混乱、重复条目、空字段和长单段内容，现有 lint / rename / 单条 update 工具缺少统一整理闭环。本提案先建立“分析 → 计划 → 校验 → 执行 → 复查”的核心能力，并优先覆盖风险较低的 world_entry。

## What Changes

- 新增 `organize_settings` agent 工具。
- 支持 `analyze`：扫描 world_entry 的非标准分类、同标题重复、空字段、长单段内容和相似标题候选。
- 支持 `apply`：接受结构化 `plan_json`，先 dry_run 校验，再执行 world_entry 的 update / merge / delete；所有修改后的长文本必须是纯文本，禁止 Markdown 语法。
- analyze 支持识别存量 Markdown 语法，作为需要整理的格式问题。
- 真实修改写入 description_history；title / content 变化继续触发 scanReferences 和 cascade。
- 更新 director 提示词，要求先 analyze、生成计划、dry_run、用户确认后再 apply。
- 本提案依赖 `setting-readability` 提供的 read / search 能力先落地。

### 非目标

- 不做一键自动重写全部设定。
- 不在工具内部调用 LLM 做语义判断。
- 不自动删除所有空条目或相似条目。
- 不在第一阶段扩展 character / plot_thread / foreshadowing / relationship。

## Capabilities

### New Capabilities

- `setting-reorganization`: 设定整理闭环，包括分析、计划校验、dry run、受控执行和历史记录。

### Modified Capabilities

（无）

## Impact

- `packages/plugin`: 新增 organize_settings 工具、计划校验逻辑、director 提示词更新和单元测试。
- `packages/novel-store`: 预计无 schema 变更。
- 现有本地数据兼容：不迁移数据，只通过显式计划修改指定记录。
