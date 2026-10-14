# Proposal

## Why

写作流水线的自动技法召回对推断场景为 `general` 的章节**结构性恒空**：检索侧用章节标题+梗概启发式推断场景，推断不出时回退 `general`，而技法库中学来的技法全部携带具体场景标签（无一含 `general`），匹配逻辑要求标签完全命中，导致候选恒为 0——写作时从未注入任何技法，shadow 日志与反馈闭环也无从积累。同时 `search_techniques` 空结果统一表述为"技法库无匹配条目"，agent 将"按 `status=verified` 过滤后无匹配"误读为"技法库为空"并如此回复用户，造成事实性误报。

## What Changes

- 召回匹配语义修复：场景查询为 `general`（推断不出/跨场景）时不再按场景标签过滤，按跨场景候选参与排序召回；具体场景查询的匹配行为不变。
- 召回取数顺序修复：先按场景匹配过滤、再排序取 `limit`，消除"SQL 先取前 N 条再内存过滤场景"导致的匹配项被任意序截断。
- `search_techniques` 空结果反馈区分两种情形：双库均无条目时明确"技法库为空"；有条目但过滤条件无匹配时返回库内总数并提示可移除过滤条件，不得表述为"库为空"。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `technique-injection`: 新增 general 场景查询的跨场景召回语义与"先过滤后取数"的召回完整性要求。
- `technique-library`: 新增检索工具空结果反馈语义（区分"库为空"与"过滤后无匹配"）。

## Impact

- **packages/plugin**：`technique-store.ts`（召回匹配与取数顺序）、`technique-learn.ts`（空结果反馈）、`novel-writer.ts`（`search_techniques` 工具描述措辞）。
- 无协议/schema 变更，无数据迁移；app / desktop / opennovel 无改动。
- **兼容性**：纯行为修复，与现有本地数据完全兼容；修复后原本召回为 0 的书籍将开始积累 shadow 日志与反馈，属预期行为。
- **非目标**：不修改 `inferSceneType` 启发式本身；不修改入库路径、层级判据与 unverified→verified 状态机；不修改注入开关、token 预算与 pipeline 提示词结构；不评估技法注入正文后的实际效果。
