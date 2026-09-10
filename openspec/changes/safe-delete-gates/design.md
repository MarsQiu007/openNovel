# safe-delete-gates Design

## Context

两处权限语义与破坏性不匹配的动机见 proposal.md。与本设计相关的现状机制：

- **注册表门**：插件工具执行前，`requiresPluginToolAsk(ruleset, permission)` 检查精确 allow 规则；architect 对 `backfill_story_arcs` 有 `{ permission, pattern: "*", action: "allow" }`，因此 replace 模式静默执行，这是要堵的洞。
- **director 对话门**：弧光重建仅靠 director 提示词约束（先在对话中征得用户同意才调用），属软门，无系统级保证。
- **ask 桥**：`PluginToolContext.ask` 已由注册表桥接到宿主的 `Permission.Service.ask`（Effect → Promise），工具体内可直接发起权限请求；子会话的 `permission.asked` 事件已有通知、审批卡片与血缘自动放行链路。
- **`Permission.Service.ask` 语义**：对每个请求 pattern 逐一 `evaluate`（last-match-wins，无匹配默认 `ask`）；`deny` 立即失败；`always` 回复把 `{ permission, pattern: <always 项>, action: "allow" }` 压入会话级 approved。
- **`backfillStoryArcs`**（arc-backfill.ts）：create_only 纯增量；replace_all 删除全部既有弧光；replace_matching 按 arc_type + target_character 过滤删除。受影响弧光的筛选逻辑目前内联在实现里。
- **审批 UI**：SessionPermissionDock 渲染 patterns（`<code>`）与可选的 i18n 描述键 `settings.permissions.tool.<permission>.description`（缺失则不显示）；请求 metadata 不上屏。现有 novel 工具（如 `delete_chapter`）本就没有 i18n 描述键。
- **`restore_chapter_version`**：将目标版本追加为新最新版本，不删除任何历史版本，纯可逆。

## Goals / Non-Goals

**Goals:**

- replace 模式的弧光重建获得系统级硬门：删除发生前必须通过权限审批
- 审批记忆按模式粒度生效（`replace_all` 放行不影响 `replace_matching`）
- `restore_chapter_version` 恢复为 allow，消除可逆操作的确认噪音
- 零 API 契约变更、零数据迁移（无需 SDK 再生成）

**Non-Goals:**

- 不扩展审批 UI（metadata 上屏、卡片渲染受影响弧光清单）
- 不新增 i18n 描述键（与现有 novel 工具审批卡片行为保持一致）
- 不移除 director 对话内的确认提示词（保留为第一道软门）
- 不修改 arc-backfill.ts 的删除/重建逻辑本身，只提取筛选函数
- 不为 `backfill_story_arcs` 增加参数或改返回结构

## Decisions

### 1. in-tool 门使用独立权限键 `arc_rebuild`

**决策**：工具体内的 `ctx.ask` 请求用 `permission: "arc_rebuild"`，patterns 与 always 均为 `[mode]`，不与工具 ID 同键。

**理由**：architect 规则表已有 `{ permission: "backfill_story_arcs", pattern: "*", action: "allow" }`。`evaluate()` 对请求 pattern（如 `replace_all`）与规则 pattern `*` 做通配匹配即命中 allow——同键请求会被现有规则吞掉，门完全失效。独立键在所有内置 agent 规则表中均无规则覆盖，默认评估为 `ask`，弹窗必然发生；`always` 回复按 `{ permission: "arc_rebuild", pattern: mode }` 记忆，天然实现模式粒度；用户也可用 `arc_rebuild: { "replace_all": "allow" }` 预放行（ConfigPermissionV1 的 rest record 支持任意键）。

**否决的替代方案**：

- 同键 + 模式细分（把 architect 的规则改成只 allow `create_only`）——注册表门 `requiresPluginToolAsk` 依赖精确 allow（pattern 匹配 `"*"`）判断，改窄后正常补建流程也会被拦截，破坏自动化。
- 在注册表层加"工具内模式门"钩子——通用化过度，两个场景不值得新框架。

### 2. 门的位置：工具体内、事务前、现有 try/catch 之外

**决策**：在 `backfill_story_arcs` 的 execute 中，模式判定为 replace 时，先计数受影响弧光，再 `await ctx.ask(...)`，两者都放在现有包裹 `backfillStoryArcs` 调用的 try/catch 之前。

**理由**：拒绝时 `RejectedError` 以工具错误冒泡（与注册表门拒绝的语义一致），不会被 catch 吞成普通输出文本；ask 在任何数据修改前发生，拒绝场景零副作用。

### 3. 计数复用：导出受影响弧光的筛选逻辑

**决策**：从 arc-backfill.ts 把"给定 mode 与 replace_match，从既有弧光中筛出将被删除的集合"的纯函数导出，backfillStoryArcs 内部与工具体（ask 前计数）复用同一函数。

**理由**：replace_matching 的过滤（arc_type 匹配 + 角色名解析到 ID 后比对）有真实复杂度，工具体内重写一份会漂移；同一函数保证"计数 = 实际将删除"。这符合"提取命名了真实概念的复用 helper"的风格约定。

**否决的替代方案**：把 ask 回调传进 backfillStoryArcs——让数据层依赖权限 UI，层次污染。

### 4. ask 请求形状

```ts
await ctx.ask({
  permission: "arc_rebuild",
  patterns: [mode],   // replace_all | replace_matching
  always: [mode],
  metadata: {
    toolId: "backfill_story_arcs",
    mode,
    arcs_to_delete: affected.length,
    replace_match: args.replace_match ?? null,
  },
})
```

patterns 渲染在审批卡片上（模式可见）；弧光数随请求进入事件流与日志。计数只用于展示，不参与删除判定（backfillStoryArcs 内部仍按自身逻辑删除）。

### 5. create_only 完全静默

不 ask、不预查询计数：该模式不删除任何既有弧光，且是"写下一章时自动补建"的常规路径，任何门都会打断既有自动化。注册表门已由 architect 的精确 allow 放行。

### 6. `restore_chapter_version: "allow"`

只改 director 权限表一处配置值。工具语义本身可逆（追加新版本），无需工具体内门。

## Risks / Trade-offs

- [双重确认：director 对话门 + 工具硬门，首次重建多一次点击] → always 记忆后同会话同模式免问；血缘自动放行开启时无感。第二道硬门正是本变更的目的。
- [replace_matching 零匹配时仍弹窗] → 罕见（重建意图本就意味着存在旧弧光）；保持模式级判定可预测，不做数据相关的条件门。
- [ask 挂起期间数据被并发修改导致计数漂移] → 单用户本地工作台，子会话内无并发写者；计数仅展示用，不影响正确性。
- [审批卡片不显示弧光数与 replace_match 细节] → 卡片显示模式名（patterns），与现有 novel 工具审批一致；metadata 已入事件流，UI 扩展留作后续独立变更。

## Migration Plan

无数据迁移、无契约变更、无 SDK 再生成。`arc_rebuild` 键未在用户配置中出现时默认 ask，行为向后兼容。回滚：revert 实现提交即可恢复原状。
