## Why

`settings-reorganization-core` 先覆盖 world_entry；实际整理往往还涉及重复角色、重复关系、空剧情线、过期伏笔等。本提案将整理闭环扩展到更多设定实体，复用既有安全规则。

## What Changes

- 将 `organize_settings` 的 analyze 扩展到 character / plot_thread / foreshadowing / relationship。
- 将 apply 扩展到这些实体的受控 update / delete；所有 description / content / summary 类字段继续强制纯文本，拒绝 Markdown 语法。
- 复用现有 deduplicate_characters 和 deduplicate_relationships 的检查与合并策略，不重写语义。
- analyze 报告改为跨类型结构化结果，可按 scope 过滤。
- 本提案依赖 `settings-reorganization-core` 先完成。

### 非目标

- 不引入工具内 LLM 语义判断。
- 不做跨书整理。
- 不做未经 dry_run 的批量删除。
- 不处理章节正文自动重写，仍由现有 cascade 机制接管。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `setting-reorganization`: 扩展 analyze / apply 支持的实体类型和跨类型报告。此能力先由 `settings-reorganization-core` 创建。

## Impact

- `packages/plugin`: 扩展 organize_settings、计划校验、测试和 director 提示词。
- `packages/novel-store`: 预计无 schema 变更；优先复用现有去重和历史机制。
- 现有本地数据兼容：仍不迁移数据，只执行显式计划。
