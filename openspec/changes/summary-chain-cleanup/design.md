# Design: summary-chain-cleanup

## Context

### 死链证据清单（全部 file:line 核实）

| 环节 | 位置 | 事实 |
| --- | --- | --- |
| wire 无字段 | `sdk/js/src/v2/gen/types.gen.ts:3016-3028` | `SessionMessageUser` 无 `summary` |
| adapter 不产出 | `packages/app/src/utils/v2-adapter.ts:284-326` | `adaptUser` 构造的 `UserMessage` 无 summary；全文 grep 无 summary |
| 无字面量写入 | 全仓 `summary:` grep | 仅 v2-translator 的 compaction `summary: data.text`（另一字段）与测试夹具 |
| app DiffSummary 行 | `rows.ts:29,141-149`；`timeline-row.ts:31,50,68`；`message-timeline.tsx:141-230,1228-1233` | `uniqueSummaryDiffs(undefined)` 恒 `[]`，行永不入列 |
| app turn 模式 | `session.tsx:108,596,601-611,648-651,662,1103,1179-1182,1195-1197`；`layout.tsx:91` | `turnDiffs` 恒 `[]`；`changesOptions` 恒 push `"turn"` |
| session-ui | `session-turn.tsx:93-95,241-256` 及 diffs 折叠 UI 段；`message-nav.tsx:54,60,63` | 组件被 enterprise share 使用但 share 数据无 summary |
| view-model | `sdk/js/src/v2/view-model.ts:54,123,219` | `Session.summary`/`UserMessage.summary`/`AssistantMessage.summary` 均无生产者无消费者 |
| 消毒器 | `utils/diffs.ts:28-49` `message()`；调用点 `server-session.ts:539,558,1001`、`global-sync/event-reducer.ts:216` | 只消毒 user message 的 summary，字段删除后无对象 |

### 存活对照（勿误删）

- `utils/diffs.ts` 的 `diffs()`：`session_diff` VCS 管线在用（`server-session.ts:801,987`）。
- review 面板 git/branch 模式：`vcsQuery` + `sdk().client.vcs.diff` 活链。
- `v2-translator.ts:356` 的 compaction `summary`：compaction part 的字段，与 user summary 无关。
- nogit 引导 UI：`SessionReviewEmptyNoGitV2`/`createGit` 要保留并提为默认空态。

## Goals / Non-Goals

Goals：summary 死链三包清零（类型、生产侧、消费侧、消毒器）；「turn」模式从 review 面板移除且无持久化残留问题；typecheck/lint/单测/e2e 守门全绿。

Non-Goals：见 proposal.md「非目标」。

## Decisions

### D1：删「turn」模式而非保留空壳

「turn」在 V2 恒空（git 项目显示「无变更」误导用户），保留空壳违反「测真实实现/无冗余」。删除后：
- git 项目 options 为 `["git", "branch"?]`，不受影响。
- persisted `review.mode="turn"` 由既有自校正 effect（`session.tsx:1024-1035`：`list.includes(mode)` 否则回落 `list[0]`）自动迁移，无需手写迁移代码。
- `ReviewChangeMode`（layout.tsx:91）与本地 `ChangeMode`（session.tsx:108）同步删 `"turn"`。

### D2：nogit 空态提为默认

当前 nogit 项目 options 仅 `["turn"]`，其空态分支承载 git 初始化引导（`reviewEmpty` 的 `turn && nogit → createGit`，`reviewEmptyV2` 的 `turn && nogit → SessionReviewEmptyNoGitV2`）。删除 turn 后把该引导提为 nogit 项目的默认 review 空态（不看模式直接判 `nogit()`），保证引导入口不丢。

### D3：session-ui 只删 summary 死分支，不删组件

`SessionTurn`/`MessageNav` 被 enterprise share 页使用（`enterprise/src/routes/share/[shareID].tsx:253,320,334`），组件本体保留；只删内部 `summary?.diffs`/`summary?.title` 分支与配套状态（`diffs` memo、`showAll`/`expanded` 中仅服务 diffs 的部分需逐个核实——`expanded` 若服务其他折叠 UI 则保留）。stories 文件同步去掉 summary 相关 fixture 数据。

### D4：view-model 三字段同链删除

`UserMessage.summary`、`Session.summary`、`AssistantMessage.summary` 同属 V1 summary 残留、均无生产/消费。一次删净，避免「半死字段」残留。`SnapshotFileDiff` 类型保留（VCS 活链在用）。

### D5：消毒器 `message()` 随字段删除

`utils/diffs.ts` 的 `message()` 唯一职责是规整 user message 的 summary；字段删除后该函数整体删除，调用点改为直接使用原值（`cleanMessage(...)` → 原表达式）。`diffs()` 保留。

### D6：i18n 死键保留

按仓库约定不动 `packages/app/src/i18n/*.ts`。`ui.sessionTurn.diffs.*`、`session.review.noChanges` 等键成为死键，在本文件注记，不随本提案清理。

## Risks / Trade-offs

- [enterprise share 页渲染回归] → share 不注入 summary，删死分支不改变渲染；守门跑 enterprise typecheck 与既有 e2e 基线比对。
- [persisted `review.mode="turn"` 的旧客户端数据] → 既有自校正 effect 覆盖，首帧即回落 git。
- [view-model 字段被未侦察到的动态访问（如 `message["summary"]`）] → 全仓已 grep `.summary`/`summary:`/`["summary"]` 形态；守门 typecheck 兜底。

## Migration Plan

无需数据迁移。persisted layout 的 `review.mode="turn"` 由自校正 effect 回落。

## Open Questions

（无）
