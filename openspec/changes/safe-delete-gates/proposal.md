## Why

两处工具权限与实际破坏性不匹配：

1. `restore_chapter_version` 采用**追加新版本**语义（不删除任何历史版本，把目标版本复制为新的 latest），是纯可逆操作，却被 director 标记为 `ask`，每次回滚都打断自动化——纯噪音。
2. `backfill_story_arcs` 的 `replace_all` / `replace_matching` 模式会在事务内**先硬删旧弧光与节点**再重建（不可恢复），却对 architect 静默 `allow`。现有确认门只存在于 director 的 system prompt（软约束），执行链上没有任何权限门——若 LLM 未遵守 prompt 约定或走其他路径，弧光数据会被无门禁删除。而 `create_only` 模式是纯增量补建，是旧项目自动补建弧光的正常流程，不应被拦截。

## What Changes

- director agent 权限表中 `restore_chapter_version` 从 `ask` 改为 `allow`：可逆操作不再打断审批流。
- `backfill_story_arcs` 工具体内按模式增加确认门，使用**独立权限键**（`arc_rebuild`，不与工具 ID 同键——architect 规则表中的 `backfill_story_arcs: "allow"` 模式为 `*`，同键 ask 会被现有 allow 规则吞掉）：
  - `mode=create_only`（默认）：保持静默执行，不影响"写下一章时旧项目自动补建弧光"的自动化流程。
  - `mode=replace_all` / `replace_matching`：在执行删除前通过插件工具的 `ctx.ask`（桥已由 ToolRegistry 提供）发起 `arc_rebuild` 权限请求，请求 pattern 即模式名，元数据携带影响面（将被删除的弧光数、模式、重建目标）；审批 UI、once/always/reject 回复语义、`permission.asked` 事件链全部复用现有权限系统（子 agent 会话的审批请求已有通知与会话卡片链路）。
  - always 记忆与用户配置按模式粒度生效：`permission: { arc_rebuild: { "replace_all": "allow" } }` 可预先放行，不开新配置面；`replace_all` 与 `replace_matching` 各自独立记忆。

### 非目标

- 不引入软删除、回收站或章节删除的版本保护（`delete_chapter` 仍为 `ask`，硬删链路不动）。
- 不做批量阈值（如 `delete_setting` 删 N 条以上才问）。
- 不修改 director 的弧光重建对话确认流程（保留第一道自然语言确认门，工具内 ask 是第二道硬门）。
- 不调整 `cascade_execute`、去重、`update_project_config` 等其他既有 `ask` 清单。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `plugin-tool-permission`: "High-impact bundled tool confirmation" 需求的确认范围变更——`restore_chapter_version` 移出高影响确认清单（可逆操作放行）；`backfill_story_arcs` 的删除性模式（`replace_all` / `replace_matching`）加入确认门，且确认在工具内部按模式触发并携带影响面元数据，`create_only` 不受影响。

## Impact

- **packages/plugin**：`novel-writer.ts`（director 权限表一行 + `backfill_story_arcs` 工具体增加模式分流与 `ctx.ask` 调用、删除前统计受影响弧光数）。
- **不受影响的包**：novel-store / opennovel / app / desktop 均无改动——权限配置格式、审批事件、UI 链路全部复用现有机制，无 API 契约变更，无需重新生成 SDK。
- **本地数据兼容性**：不改任何数据模型（弧光表、章节版本表、弧光节点表结构不动），`backfillStoryArcs` 的删除/重建事务逻辑不变，仅在删除前新增审批暂停点。现有项目零迁移。
