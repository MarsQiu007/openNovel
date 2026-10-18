# Tasks

## 1. 对账收编同事务入队

- [x] 1.1 修改 `packages/server/src/handlers/novel.ts` 对账 `toPending` 分支（约 3192-3194）：在既有 `withTransaction` 内对每章调用 `enqueueManualEditSyncTx`（import 自 novel-store），`sourceFingerprint` 取该章 `content_fingerprint`、`source: "upgrade"`，复用其指纹去重语义（同指纹 failed → 重置 pending 清失败原因；同指纹 pending → 去重跳过）；验证：`packages/server` 下 `bun typecheck` 通过
- [x] 1.2 在 `packages/server/test/` 新增对账收编集成测试：预置「无活跃 run + 孤儿 failed 条目（指纹不匹配摘要）」书库，执行状态查询触发对账，断言队列对应条目变为 pending 且 `failure_reason` 清空、run_chapter 与队列在途条目一一对应；验证：`packages/server` 下 `bun run test` 通过

## 2. 活跃 run 反向脱节自愈

- [x] 2.1 修改同文件活跃 run 自愈分支（约 3090-3114）：在 staleChapters 正向自愈与 return 之间，扫描活跃 run 内 `pending` / `running` 章节，凡该章在队列中**没有 `pending` 条目**（failed / skipped / synced 均不可被 worker 消费）的，同事务 `enqueueManualEditSyncTx` 补入队（同指纹 failed 重置为 pending，无失败条目则新入队）；`terminal` 章节不得触碰；验证：`packages/server` 下 `bun typecheck` 通过
- [x] 2.2 新增反向自愈集成测试：预置「活跃 run + run_chapter 全 pending + 队列全 failed」书库（复现线上 b0884c60 形态），执行状态查询，断言队列出现 pending 条目、run_chapter 未被标 terminal；再预置「活跃 run + terminal 章节」断言 terminal 不被自动重置；验证：`packages/server` 下 `bun run test` 通过

## 3. 回归与验证

- [x] 3.1 运行 `packages/server`、`packages/novel-store` 全量测试（`bun run test`）与 `bun typecheck`，确认无回归；验证：全部通过
- [x] 3.2 从仓库根目录对全部改动文件运行 oxlint；验证：无新增告警
- [x] 3.3 本地书库实弹验证：以修复版本对本地《筛选队友，我是专业的》书库（run `b0884c60` 卡死实例）执行一次升级状态查询，断言 5 章队列条目恢复 pending 并被 worker 消费推进（模型配置已确认正常），run 最终到达终态、横幅消失；验证：观察符合预期

## Workflow follow-up

- 实现提交遵循仓库约定：conventional commit + `OpenSpec-Change: fix-reconcile-enqueue` footer，一个提交一个 change-id。
- 合并前刷新本地 `main`，优先 `git merge --ff-only`；推送后确认 CI 全绿再归档。
- 归档时运行 `openspec validate fix-reconcile-enqueue --strict`，同步主 specs 后归档，归档移动单独提交。
