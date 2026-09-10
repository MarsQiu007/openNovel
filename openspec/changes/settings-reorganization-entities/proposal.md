## Why

`settings-reorganization-core` 先覆盖 world_entry；实际整理还涉及重复角色、重复关系、空剧情线和长文本伏笔。这些实体需要进入同一个“分析 → 计划 → 校验 → 确认 → 执行 → 复查”流程，否则用户仍要在多个工具间手工拼装整理过程。

## What Changes

- 将 `organize_settings.analyze` 扩展到 character / relationship / plot_thread / foreshadowing，并支持 `scope` 过滤。
- 分析报告覆盖实体重名或重复身份、空字段、Markdown 残留、长单段内容；world_entry 继续保留核心版本的分类和相似标题检查。
- 引入版本 2 的 `plan_json`，每个操作显式声明 `entity_type`；版本 1 继续按 world_entry 兼容解析。
- 将 `apply` 扩展为跨实体受控 `update` / `merge` / `delete`，字段白名单保守，不修改角色状态、伏笔状态、关系类型等生命周期或语义字段。
- character / relationship merge 复用既有去重策略：显式指定目标、合并独立描述段落、重定向关系与引用后删除源。
- 所有 description / content 类字段继续强制纯文本并分段；删除和 merge 源必须避开活跃引用、主角保护和已出场保护。
- 更新 director 提示词，要求版本 2 计划、dry_run、用户确认、apply 后复查，禁止虚构 ID 或自动合并/删除重复候选。

### 非目标

- 不引入工具内 LLM 语义判断。
- 不做跨书整理或全自动重写。
- 不做未经 dry_run 的批量删除。
- 不修改 character status、foreshadowing state、relationship type 等生命周期/语义字段。
- 不处理章节正文自动重写，仍由现有 cascade 机制接管。
- 不新增数据库表或公开 HttpApi。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `setting-reorganization`: 扩展 analyze / dry_run / apply 的实体类型、版本化计划、跨实体合并与删除保护。该能力先由 `settings-reorganization-core` 创建。

## Impact

- `packages/plugin`: 扩展 organize_settings、计划校验、实体执行逻辑、提示词和测试。
- `packages/novel-store`: 预计无 schema 变更；优先复用现有去重、历史、引用和级联机制。
- 现有本地数据兼容：仍不迁移数据，只执行显式计划；旧版本 1 计划继续可用。
