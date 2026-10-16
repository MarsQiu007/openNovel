# Tasks: unified-transactions

## 1. novel-store 统一事务入口与助手双形态

- [x] 1.1 新增 `packages/novel-store/src/tx.ts`：导出 `withTransaction(db, fn)`——先经驱动特性探测（`inTransaction` / `isTransaction`）检测嵌套事务并抛可读错误；回调返回 thenable 即抛错回滚；正常路径走 ORM 同步回调事务。验证：`packages/novel-store` 下 `bun typecheck` 通过，新增 `tx` 的单元测试覆盖「正常提交 / 回调抛错回滚 / 异步回调拒绝 / 嵌套检测报错 / 驱动无检测能力时降级」五个场景且 `bun test` 通过。
- [x] 1.2 拆分实体引用扫描助手为双形态：`scanEntityReferencesTx`（首参事务对象、函数体同步、不得再开事务）+ `scanEntityReferences`（自包形态，内部经 `withTransaction` 调组合形态），对外签名与返回不变。验证：`packages/novel-store` 下 `bun test` 的 entity-refs 相关测试全绿、`bun typecheck` 通过。
- [x] 1.3 拆分手动编辑同步入队助手为双形态（`enqueueManualEditSyncTx` + 自包 `enqueueManualEditSync`），签名与去重语义不变。验证：`packages/novel-store` 下 manual-edit-sync 相关 `bun test` 全绿、`bun typecheck` 通过。
- [x] 1.4 拆分书籍元数据保存助手为双形态（`saveBookMetaTx` + 自包 `saveBookMeta`），签名与「书目 + 风格指南同事务」语义不变。验证：`packages/novel-store` 下 style-rules / manual-edit-sync 相关 `bun test` 全绿、`bun typecheck` 通过。
- [x] 1.5 拆分审批请求助手为双形态（`requestApprovalTx` + 自包 `requestApproval`），签名与错误类型不变。验证：`packages/novel-store` 下 `bun typecheck` 通过；审批相关测试（若存在）全绿。
- [x] 1.6 将 `ensureSegmentSummaries` 同步化（去 async/await——其 4 处 await 全是同步驱动返回的非 thenable，行为安全；调用方残留 await 兼容）。将 Phase 1 确定性回填四步（指纹基准 → 段摘要 → 实体引用 → legacy 主轴转换）整体包进 `withTransaction` 单事务，第 2 步调同步化后的函数、第 3 步改调组合形态，中途任一步失败整体回滚。验证：新增「第 3 步注入失败 → 第 1、2 步写入全部回滚、数据库回到执行前」的原子性测试，`packages/novel-store` 下 `bun test` 全绿。

## 2. plugin 手写事务清零与组合点归位

- [x] 2.1 转换 chapter-rollback.ts 的手写 BEGIN/COMMIT/ROLLBACK 为 `withTransaction` 同步回调（事务体内 `await db…run()` 改同步语句，异常路径的样板 try/catch 随 ROLLBACK 样板一并删除）。验证：`packages/plugin` 下章节回滚相关 `bun test` 全绿、`bun typecheck` 通过。
- [x] 2.2 转换 arc-progress.ts 的手写事务为 `withTransaction`，并清除「drizzle 事务不回滚」过时注释。验证：`packages/plugin` 下弧光进度相关 `bun test` 全绿、`bun typecheck` 通过。
- [x] 2.3 转换 arc-backfill.ts 的手写事务为 `withTransaction`，并清除同类过时注释。验证：`packages/plugin` 下弧光回填相关 `bun test` 全绿、`bun typecheck` 通过。
- [x] 2.4 转换 chapter-rebuild.ts 的手写事务为 `withTransaction`，事务体内实体引用扫描改调 `scanEntityReferencesTx`；`ensureSegmentSummaries`（已由 1.6 同步化）与 `syncChapterSummaryFts` 调用去 await（后者按 D7 同步化：去 async/await、保留 `.run()`）；保留段摘要重建的既有调用方式（其无自包事务）。验证：该文件全链路测试在 **node 运行时**下通过（临时以 `%TEMP%\verify-node.mjs` 同类脚本驱动真实 node:sqlite 跑章节重建事务体；**本机 Node 23.11 缺 `setReturnArrays`（drizzle node-sqlite 无条件依赖），须先 `nvm` 切到 Node ≥ 24 再跑**）；`packages/plugin` 下 `bun test` 全绿、`bun typecheck` 通过。
- [x] 2.5 转换 state-commit.ts 的手写事务为 `withTransaction`（事务体含 append-only 日志、物化视图、FTS、级联统改四组写入，是本次最大单点），清除「drizzle 事务不回滚」过时注释；事务体内辅助函数按 D7 同步化：`resetChapterScopedState`、`applyToMaterializedView`、`syncChapterSummaryFts`、`applyImpact` 去 async/await；日志写入的裸 `await db.insert(...).values(...)`（无 `.run()`、靠 thenable 触发执行）去 await 时**必须补 `.run()`**，否则语句不执行；Markdown 审计日志与主轴条目保持在事务提交后的既有位置不变。验证：state-commit 专属测试文件全绿；`packages/plugin` 下 `bun test` 全绿、`bun typecheck` 通过。
- [ ] 2.6 迁移 opennovel 手动编辑同步 worker 的落库事务：`manual-edit-sync-worker.ts` 的 `db.transaction((tx) => applySyncEntry(tx, …))` 改走 novel-store 的 `withTransaction`（事务体本就同步、只有直接写入，纯机械改动），worker 消费链自此全程受嵌套检测保护。验证：`packages/opennovel` 下 sync-worker 相关 `bun test` 全绿、`bun typecheck` 通过。

## 3. 防回归闸门

- [ ] 3.1 新增静态守卫测试（跟随 `packages/plugin` bun 测试跑）：扫描 `packages/plugin/src`、`packages/novel-store/src` 与 `packages/opennovel/src` 源码，出现 `` sql`BEGIN` `` 模板语句即失败（正则只匹配 drizzle 模板字面量，`migrate.ts` 的 `exec("BEGIN")` 字符串形态与纯注释文字不受影响——注释内出现模板字面量形态同样拦截）。验证：守卫测试在改造后的仓库上通过；临时在手写 BEGIN 还原一行时守卫测试失败（负向验证）。
- [ ] 3.2 新增静态守卫测试：扫描 4 个 `*Tx` 组合形态函数体，出现再开事务调用即失败并给出可读提示。验证：同 3.1 做正/负向双重验证。
- [ ] 3.3 新增 node-runtime 测试文件（`node:test` 风格，置于各包 `test-node/` 目录）：覆盖「同步队列消费 + 真实章节重建 handler」「Phase 1 四步原子性」「嵌套 savepoint 提交/回滚」「`withTransaction` 三错误形态」四类场景。验证：`bun build --target=node` 打包后 `node --test` 在 Node ≥ 24 下全部通过（本机 Node 23.11 缺 `setReturnArrays` 不可用，须以 bun 内嵌或 CI Node 24 验证）。
- [ ] 3.4 在 `.github/workflows/test.yml` 新增 node-runtime 测试 job：setup-node 固定 24.x → 安装依赖 → `bun build --target=node` 打包测试入口 → `node --test` 执行。验证：推送后该 job 在 CI 变绿；故意在分支上临时恢复一处手写 BEGIN 时该 job 或守卫 job 变红（负向验证可在合并前于功能分支试跑）。

## 4. 文档与收尾

- [ ] 4.1 在 `packages/novel-store/AGENTS.md`（无则新建）补事务纪律章节：唯一机制（`withTransaction`）、组合点开事务、双形态选用规则、同步回调约束、嵌套检测行为。验证：章节内容与 design.md 的 D1–D3 一致，-review 时对照 spec 可逐条指认。
- [ ] 4.2 运行全量质量门：`packages/novel-store`、`packages/plugin`、`packages/opennovel` 依次 `bun typecheck` 通过；从仓库根运行 oxlint 通过；上述三包 `bun test` 全绿。验证：三条命令零错误输出。
- [ ] 4.3 真机验收：以修复后代码对《执棋人》（`C:\Novels\XianXia`）在升级视图显式重试失败章节，队列条目最终标记 synced、章节摘要/引用/主轴落库。验证：novel.db 中该书 failed 条目清零、新指纹条目状态为 synced（验收后向用户出示 DB 行证据）。

## Workflow follow-up

- 实现提交按 `OpenSpec-Change: unified-transactions` footer 收集进本文件 `## Implementation Commits`（不含记录更新自身）。
- 归档前：`openspec validate unified-transactions --strict` → 同步 specs → 归档 → merge/push main → 清理分支。
- 归档目录移动提交不带本 change-id。
