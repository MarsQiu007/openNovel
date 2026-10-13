# Design

## Context

见 proposal.md - Why。关键事实（均已对照源码、本地复现与 CI 日志核实）：

- CI unit 门禁：`.github/workflows/test.yml` 的 `bun turbo test` → packages/app 的 `test` =
  `test:unit && test:browser`。失败点在 `test:browser`
  （`bun test --conditions=browser --preload ./happydom.ts ./test-browser`）：28 pass / 1 fail，
  与 windows unit job 相同一处失败，e2e 作业不受影响。
- 失败链路：`createPromptSession(ServerScope.local, { draftID })` → `promptTarget` 已无
  draftID 分支 → `Persist.serverScoped(scope, undefined, undefined, ...)` →
  `serverWorkspaceTarget` → `pathKey(undefined)` 内 `value[1]` 抛 TypeError。
  该测试只验证"异步存储水合完成前 ready 为 false、完成后读到持久化内容"，与草稿概念无关：
  desktop 平台 storage 天然异步，ready 门控防止默认值覆盖已持久化输入。因此以任意目录
  scope 等价覆盖即可，不需要新机制。
- 残留审计（`git grep` 全仓 + 逐文件人工核对，`packages/app/src` 内 draftID / draftPrompt /
  draftPage / newDraft / Persist.draft 的引用面）：
  - `tabs.test.ts` 的 legacy 会话/草稿标签迁移用例**保留**——`migrateTabs` 对遗留标签的
    清除是「会话归属书籍」要求的契约（遗留标签自动清除），不是死代码。
  - 其余引用即本变更要清理的五处（见 Decisions D2）。
  - `e2e/performance/timeline/` 手动基准套件仍引用草稿路由与会话标签，见非目标。

## Goals / Non-Goals

**Goals:**

- packages/app `bun run test`（unit + browser）恢复全绿，CI unit 双平台转绿。
- session-book-only 草稿链路残留死代码清零：`packages/app/src` 内上述符号无关键零引用。

**Non-Goals:**

- 无产品行为变化；不动持久化格式与遗留数据。
- 不迁移 / 重设计性能基准套件（手动运行，另行评估）。

## Decisions

### D1: browser 测试迁移为目录 scope，而非删除

异步水合门控仍是现行行为（desktop 异步 storage 路径），该测试是其唯一契约覆盖；改为
`{ dir: "test-directory" }` 即可保留覆盖面。删测会丢失 ready 门控保护。用例名去掉 draft
措辞（"waits for an async persisted prompt to hydrate before reporting ready"），避免与已退役
的草稿概念混淆。

### D2: 死代码删除以「零引用 + 功能已退役」为准

- `prompt.tsx` scopeKey：`PromptScope` 已无 draftID 成员，`"draftID" in scope` 分支不可达。
- `directory-layout.tsx` draftID prop：全仓调用方均不传参。
- `sessions.tsx` HomeSessionsEmpty onNewSession：唯一调用点（sessions.tsx:960）已不传参，
  Show 分支不可达；随之为空态的 ButtonV2 引用一并清理。
- `home.tsx` newSessionProject memo：其唯一消费链（openNewSession / openProjectNewSession /
  项目列 prop 链）已由 session-book-only 移除，memo 无引用。
- `persist.ts` Persist.draft / draftStorage / draftPersistedKeys：全仓 grep 仅 persist.test.ts
  引用（draftPersistedKeys 零引用）；删除后同步删除 persist.test.ts 中两个 draft 目标用例。
- 备选：保留以上基建待未来复用 → 否决：仓库风格反对预防性抽象（AGENTS.md「Do not extract
  single-use helpers preemptively」），且 draft 概念已整体退役，残留 API 只会误导后续读者。
