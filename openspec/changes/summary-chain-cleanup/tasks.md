# Tasks: summary-chain-cleanup

> 实施梯度：先删类型（编译器立刻标出全部消费点），再按「app 时间线 → review turn 模式 → session-ui → 消毒器」收敛，最后守门。每组任务自带验证。

## 1. 类型层先行（编译器带路）

- [ ] 1.1 删 `packages/sdk/js/src/v2/view-model.ts` 的 `UserMessage.summary`、`Session.summary`、`AssistantMessage.summary` 三字段（design.md D4）。验证：`cd packages/app && bun typecheck` 与 `cd packages/session-ui && bun typecheck` 的报错清单恰好等于已知消费点（rows.ts/session.tsx/session-turn.tsx/message-nav.tsx/diffs.ts），无意外命中。

## 2. app 时间线 DiffSummary 链

- [ ] 2.1 删 `rows.ts` 的 DiffSummary 行类型条目与入列分支（含 `uniqueSummaryDiffs` import），删 `timeline/summary-diffs.ts` 整文件，删 `timeline-row.ts` 的 DiffSummary 类/联合成员/key case。验证：typecheck 剩余报错只剩 message-timeline.tsx 的渲染 case。
- [ ] 2.2 删 `message-timeline.tsx` 的 `TimelineDiffSummaryRow` 组件与 `case "DiffSummary"` 分支（含只被该组件使用的 import/state）。验证：`cd packages/app && bun typecheck` 时间线相关报错清零。

## 3. review「turn」模式链

- [ ] 3.1 删 `session.tsx` 的 `turnDiffs`、`ChangeMode` 的 `"turn"`、`changesOptions` 的 `list.push("turn")`、`reviewDiffs`/`reviewEmpty`/`reviewEmptyV2` 的 turn 分支；nogit 引导提为默认空态（D2）；`layout.tsx` 的 `ReviewChangeMode` 删 `"turn"`。验证：`bun typecheck` 绿；人工核对 `session.tsx` 不再有 turn 字样。
- [ ] 3.2 手测或 e2e 既有用例覆盖 review 面板：git 项目模式切换正常、nogit 项目空态呈现 git 初始化引导。验证：既有 e2e 守门套件相关用例不新增红。

## 4. session-ui 与消毒器

- [ ] 4.1 删 `session-turn.tsx` 的 `SummaryDiff`/`summaryDiff`/`emptyDiffs`/`diffs` memo/`MAX_FILES`/`showAll`/`expanded`/`overflow`/`visible`/`toggleAll` 及 diffs 折叠 UI 段；删 `message-nav.tsx` 的 `DiffChanges` 角标与 `summary?.title` 回落；stories 同步去 summary fixture。验证：`cd packages/session-ui && bun typecheck` 绿。
- [ ] 4.2 删 `utils/diffs.ts` 的 `message()` 与 `object()`（若仅 message 用），`server-session.ts:539,558,1001` 与 `global-sync/event-reducer.ts:216` 的 `cleanMessage` 调用点改为直接用原值；`diffs.ts` 相关测试同步删 message 分支用例。验证：`cd packages/app && bun typecheck` 绿、`bun test`（app 单测）无新增失败（基线 27 fail jsxDEV 既有红）。

## 5. 守门与收官

- [ ] 5.1 全量守门：`packages/app`、`packages/session-ui`、`packages/enterprise`、`packages/sdk/js` typecheck 绿；repo root `bun x oxlint` 0 errors 且 warnings 不超基线 5715；e2e 守门套件失败数不超 main 基线 3 个既有红。验证：各命令输出记录进实施注记。
- [ ] 5.2 收官：勾选本文件全部任务；`git log --grep "OpenSpec-Change: summary-chain-cleanup" --format="%h %s"` 收集实现提交写入 `## Implementation Commits`；`openspec validate summary-chain-cleanup` 通过。

## Implementation Commits

（收官时回填）

## Workflow follow-up

- `openspec validate summary-chain-cleanup`（skip_specs，零 delta 提示属预期）
- `npx openspec archive summary-chain-cleanup --yes` 归档，确认是纯 rename 无残留
- 合并前工作树干净，`git merge --ff-only summary-chain-cleanup` 合入 main，删除本地分支（不推送）
