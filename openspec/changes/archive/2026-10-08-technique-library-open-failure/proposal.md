# Proposal

## Why

技法库面板（书内"技法库"页）当前对所有书籍一律打开失败（"操作失败"）。根因有两层：

1. 代码层：novel-store 的 `toTechnique` 对从未使用的技法（`last_used_at = NULL`，存量中的绝大多数）产出**显式带 key 的 `lastUsedAt: undefined`**，而 effect 4.0.0-beta.83 的 `optional(Schema.Int)` 允许 key 缺失、拒绝显式 undefined。`Technique` schema 解码因此在每条这样的行上失败，`technique.list`/`technique.detail` 响应无法编码，接口整体报错。
2. 数据层：`save_technique` 工具直写数据库绕过协议校验，部分已入库技法的证据条目缺少必填的 `sourceTitle`，同样使响应编码失败；即使修复代码层，这些脏数据仍会让列表挂掉。

## What Changes

- **A. store 层修复**：`toTechnique` 的 `lastUsedAt` 改为条件展开（NULL 时不携带该 key），一处改动覆盖 list/detail/create/update 四个出口。
- **B. 数据修复与防再犯**：
  - 存量回填：新增幂等迁移，证据条目缺失的字符串字段按规则补全（`sourceTitle` 缺省取 `sourceLocation`，其余补空串），书库与全局库统一执行。
  - 入库校验：`save_technique` 入库前经统一的证据规范化（基于 `TechniqueEvidence` schema 校验+补全），不可修复的候选被拒绝并说明原因。
- **C. 列表行级容错**：`technique.list` 对单行 schema 不合规的数据跳过该坏行（记 WARN 日志，含技法 id 与原因）并返回其余行，不再整体失败。
- **D. 回归测试**：覆盖 lastUsedAt 编码链路、回填迁移幂等、入库校验、列表容错的测试。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `technique-library`: 新增"技法库列表接口对坏数据行容错"与"技法证据入库完整性校验"两条需求（管理接口的编码健壮性与入库把关）。

## Impact

- **packages/novel-store**：`toTechnique` 修复、新增证据回填迁移与证据规范化导出函数。
- **packages/plugin**：`saveTechnique` 入库前接入证据规范化。
- **packages/server**：`listTechniquesForDirectory` 增加逐条解码容错与 WARN 日志。
- **无协议/schema 变更**（`Technique.lastUsedAt` 维持 optional 契约，修复在数据层遵守契约）；**app 无改动**，面板行为随接口恢复自然正常。
- **兼容性**：回填迁移幂等、只补缺失字段不改已有值；与现有本地数据完全兼容。