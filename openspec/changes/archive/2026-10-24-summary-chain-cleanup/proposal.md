# Proposal: summary-chain-cleanup

## Why

V2 wire 的 `SessionMessageUser` 没有 `summary` 字段（`sdk/js/src/v2/gen/types.gen.ts:3016-3028`），`adaptUser`（`packages/app/src/utils/v2-adapter.ts:284-326`）不产出 summary，view-model 的 `UserMessage.summary` 恒为 `undefined`。依附其上的两条 UI 链因此在 V2 下恒空、永不渲染，成为纯死代码：

1. **时间线 DiffSummary 行**：`rows.ts:141` 的 `userMessage.summary?.diffs` 恒空，DiffSummary 行永不入列（timeline-stability-v2 已把该子场景从套件删除并注明「产品侧清理另立提案」）。
2. **review 面板「turn」模式**：`session.tsx:596` 的 `turnDiffs` 恒空，「turn」模式对 git 项目永远显示「无变更」，对 nogit 项目仅剩 git 初始化引导壳。

同链还有 view-model 的 `Session.summary`（additions/deletions/files/diffs）与 `AssistantMessage.summary?: boolean`——全仓侦察确认无生产者、无消费者。

## What Changes

- **删 view-model 死字段**（`packages/sdk/js/src/v2/view-model.ts`）：`UserMessage.summary`、`Session.summary`、`AssistantMessage.summary`。
- **删 app 时间线 DiffSummary 链**：`rows.ts` 的 DiffSummary 行类型与入列分支、`timeline/summary-diffs.ts` 整文件、`timeline-row.ts` 的 DiffSummary 类/联合成员/key case、`message-timeline.tsx` 的 `TimelineDiffSummaryRow` 组件与渲染 case。
- **删 review「turn」模式链**（`session.tsx`、`context/layout.tsx`）：`turnDiffs`、`changesOptions` 的 `"turn"` 选项、`reviewDiffs`/`reviewEmpty`/`reviewEmptyV2` 的 turn 分支、`ReviewChangeMode` 与本地 `ChangeMode` 的 `"turn"` 成员。persisted `review.mode="turn"` 由既有自校正 effect（`session.tsx:1024-1035`，模式不在 options 时回落 `list[0]`）自动迁移，不手写迁移。nogit 项目的 review 空态直接呈现 git 初始化引导（原 turn+nogit 分支提为默认空态）。
- **删 session-ui 组件内 summary 死分支**：`session-turn.tsx`（`SummaryDiff` 类型、`summaryDiff` 守卫、`diffs` memo 及 showAll/expanded 折叠 UI 段）、`message-nav.tsx`（`DiffChanges` 角标与 `summary?.title` 回落）。
- **删 `utils/diffs.ts` 的 `message()` 消毒器**及其调用点（`server-session.ts` ×3、`global-sync/event-reducer.ts` ×1）——summary 字段消失后 user 分支消毒无对象；`diffs()` 本体保留（VCS `session_diff` 管线是活链）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——session 时间线/review 面板行为不在 `openspec/specs/` 覆盖范围）

> `skip_specs: true`。

## Impact

- **受影响包**：`sdk`（js view-model 类型）、`app`、`session-ui`。
- **行为变化**：review 面板不再有「turn」模式（V2 下恒空，删除无功能损失）；时间线不再有可能出现的 DiffSummary 行（V2 下本就不出现）。
- **enterprise**：share 页使用 `SessionTurn`/`MessageNav` 但不注入 summary（share 数据管线无此字段），删组件内死分支不改变其渲染。
- **i18n**：按仓库约定不动 locale 文件；`ui.sessionTurn.diffs.*`、`session.review.noChanges` 等死键保留，另注记。
- **CI**：无新增工作流；守门走既有 typecheck/lint/单测/e2e 基线比对。

## 非目标

- 不删 `SessionTurn`/`MessageNav` 组件本体（enterprise share 在用）。
- 不动 i18n locale 文件（`packages/app/src/i18n/*.ts`），死键清理另议。
- 不动 VCS diff 活链（git/branch 模式、`session_diff` 数据管线、`utils/diffs.ts` 的 `diffs()`）。
- 不动 compaction 相关 UI（`adaptCompaction` 产出的 compaction part 是活链）。
- 不动 view-model 其他 V1 残留字段（本提案只清 summary 链，其余字段另行逐案核实）。
