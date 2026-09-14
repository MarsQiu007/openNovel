## Context

`settings-reorganization-core` 已为 world_entry 建立分析、计划校验、运行时确认、受控执行、历史归档和级联复用。实际整理还需要覆盖 character、relationship、plot_thread 和 foreshadowing。现有 store 已有角色主角保护、已出场保护、角色/关系去重、description_history 和 EntityRef / PendingUpdate 机制；本提案不重写这些语义，而是把跨实体操作纳入同一审查流程。

## Goals / Non-Goals

**Goals:**

- 将 `organize_settings` 的 analyze 扩展为跨实体报告，并支持 scope 过滤
- 将 dry run / apply 扩展到 character、relationship、plot_thread 和 foreshadowing
- 复用角色与关系去重的保留、合并、重定向和保护策略
- 继续执行纯文本、字段白名单、活跃引用检查和运行时确认

**Non-Goals:**

- 不做语义重写、跨书整理或全自动去重
- 不新增数据库迁移或公开 HttpApi
- 不修改 character 状态、伏笔状态、关系类型等生命周期/语义字段
- 不处理章节正文自动重写，仍交给现有级联任务

## Decisions

### D1: 引入版本 2 计划，按操作声明实体类型

**选择**：版本 2 的每个 operation 都必须带 `entity_type`：

```json
{
  "version": 2,
  "operations": [
    { "entity_type": "character", "action": "update", "id": "...", "fields": { "description": "第一段\n\n第二段" }, "reason": "修复格式" }
  ]
}
```

版本 1 继续按 world_entry 解析，保持向后兼容。版本 2 只接受 `world_entry / character / relationship / plot_thread / foreshadowing`。

**备选方案**：
- 继续让顶层 `entity_type` 表示整份计划：无法表达跨实体批处理
- 用不同工具分实体处理：入口分散，用户确认和复查会割裂

**理由**：跨实体计划需要逐条标识身份和字段白名单；版本号能避免旧计划被误解释。

### D2: analyze 使用实体身份键和统一文本检查

**选择**：跨实体分析按下列身份键识别重复：

- character：`name.trim()`
- relationship：`char_a_id|char_b_id|type`
- plot_thread：`title.trim()`
- foreshadowing：`content.trim()`
- world_entry：保留核心版本的标题重复与相似标题规则

所有实体统一检查关键字段为空、常见 Markdown 和超过 200 字且无换行的长文本。`scope` 参数过滤返回结果，`all` 为默认。

**备选方案**：
- 用 LLM 判断“同一角色”：不可复现，风险高
- 对角色、剧情线也做相似标题匹配：第一阶段容易误报，故只保留世界观标题相似候选

**理由**：身份键与现有去重策略一致，报告稳定可测试；相似名称只在未来确认误报可控后再引入。

### D3: 字段白名单保持保守

**选择**：`update` 字段白名单如下：

| entity_type | 可更新字段 |
|---|---|
| world_entry | category / title / content |
| character | name / description |
| plot_thread | title / description |
| foreshadowing | content |
| relationship | description |

不开放 character 的 `role / status`、plot_thread 的 `status / priority`、foreshadowing 的 `state / resolved_chapter_id`、relationship 的 `type`。这些属于生命周期或叙事语义，不应被格式整理悄悄改变。

**备选方案**：
- 直接复用各自通用 update 工具字段：整理工具可能顺手改变状态，风险大
- 只开放纯文本字段：影响面小，足以解决空字段和格式残留

**理由**：跨实体整理第一阶段的目标是清理结构和格式，不是代替用户改变叙事状态。

### D4: 角色与关系合并沿用既有去重策略

**选择**：character merge 要求目标与源同名；relationship merge 要求角色对和关系类型相同。合并时以目标为保留条目，把源描述中目标尚未包含的独立段落并入，段落之间使用 `\n\n`。character 合并后重定向关系、EntityRef 和 PendingUpdate，再删除源；relationship 合并后删除源。

**备选方案**：
- 继续让系统自动选择描述最长的条目为保留条目：跨实体计划必须显式确认目标，不能隐藏选择
- 用 `force=true` 覆盖信息丢失警告：与“不自动删除”目标冲突

**理由**：显式目标、独立段落合并和引用重定向保留现有去重的价值，同时避免静默覆盖。

### D5: 删除和合并源都要求无活跃引用

**选择**：删除目标或 merge 源如果被 EntityRef、关系参与或章节引用，dry run 返回冲突。character 额外沿用主角保护和已出场保护。对被引用实体，应先合并、改写引用或退场，再另行确认。

**备选方案**：
- 删除后重定向或清理引用：可能让章节称谓失去追踪
- 提供 force 参数：第一阶段不引入

**理由**：跨实体批量操作比单条删除更容易破坏叙事；先拒绝再由用户处理是更安全的默认。

### D6: 副作用继续交给现有机制

**选择**：world_entry 和 character 的可级联变化重建引用并创建 PendingUpdate；plot_thread、foreshadowing、relationship 的格式修复只写历史，不新增级联类型。所有真实字段变更继续进入 description_history。

**备选方案**：
- 为每类实体新增级联规则：超出现有整理范围
- 不写历史：回滚和审计能力会退化

**理由**：本提案扩展整理范围，不改变级联模型；历史继续提供可恢复记录。

## Risks / Trade-offs

- [重名角色不一定重复] → analyze 只给候选；merge 必须显式指定目标和源并通过 dry run、用户确认
- [关系角色对相同但语义不同] → 仅相同 type 才可合并；type 本身不可被整理计划修改
- [合并描述仍可能遗漏信息] → 只追加目标未包含的独立段落，目标缩短时拒绝；输出保留/删除 ID 便于验收
- [活跃引用追踪不完整] → 现有引用扫描、复查分析和人工验收共同兜底
- [版本 1 / 版本 2 并存] → 校验器按版本分派；新提示词要求 AI 生成版本 2

## Migration Plan

无数据库迁移。部署后旧版本 1 计划仍可用，新 AI 工作流使用版本 2。回滚时 revert 对应 plugin 提交；已写入的 description_history 继续兼容现有恢复工具。

## Open Questions

（无）
