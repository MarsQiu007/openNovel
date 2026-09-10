## Why

设定数量增长后会出现分类混乱、重复条目、空字段、长单段内容和 Markdown 残留。现有 lint / rename / 单条 update 工具缺少统一整理闭环，无法先给用户展示整体影响，也无法在确认后按计划批量修复。

## What Changes

- 新增 `organize_settings` agent 工具，支持 `analyze`、`dry_run` 和 `apply`。
- `analyze` 扫描 world_entry 的非标准分类、同标题重复、相似标题候选、空字段、长单段内容和常见 Markdown 残留。
- `dry_run` 接受版本化 `plan_json`，只做影响预览和校验，不修改数据。
- `apply` 支持对 world_entry 执行受控 `update` / `merge` / `delete`；执行前重新校验，并通过运行时确认获得用户批准。
- 所有修改后的长文本必须是纯文本，禁止 Markdown 语法，并满足分段规则；category 必须使用标准分类。
- 真实字段修改写入 description_history；title / content 变化继续触发 scanReferences 和 cascade。
- 删除或作为 merge 源删除的条目必须没有活跃引用，避免破坏章节与设定的联系。
- 更新 director 提示词，要求先 analyze、生成计划、dry_run、向用户说明影响并等待确认后再 apply，最后复查。

### 非目标

- 不做一键自动重写全部设定。
- 不在工具内部调用 LLM 做语义判断。
- 不自动删除所有空条目或相似条目。
- 不在第一阶段扩展 character / plot_thread / foreshadowing / relationship。
- 不新增数据库表或公开 HttpApi。

## Capabilities

### New Capabilities

- `setting-reorganization`: 设定整理闭环，包括分析、计划校验、dry run、运行时确认、受控执行、历史与级联一致性。

### Modified Capabilities

（无）

## Impact

- `packages/plugin`: 新增 organize_settings 工具、整理分析与计划校验逻辑、director 提示词更新和单元测试。
- `packages/novel-store`: 预计无 schema 变更。
- 现有本地数据兼容：不迁移数据，只通过显式计划修改指定记录。
