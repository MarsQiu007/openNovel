# Tasks

## 1. Schema 与数据层

- [x] 1.1 在 `packages/novel-store/src/schema.ts`（或既有 schema 文件）新增 `upgrade_run` 与 `upgrade_run_chapter` 两张表，运行 drizzle migration 生成 SQL，并验证表结构与设计 D1 一致（字段、默认值、外键）
- [x] 1.2 在 `packages/novel-store/src/upgrade.ts` 新增 `createUpgradeRunTx`（组合形态，首参 Tx）：创建 run 并批量插入 run_chapter 目标集合，验证在新测试中用 `withTransaction` 包裹后能读到 run 与全部章节行
- [x] 1.3 在 `packages/novel-store/src/upgrade.ts` 新增 `getActiveUpgradeRun(novelID, directory?)`：返回该小说 `status = 'active'` 的 run（至多一个），验证无活跃 run 时返回 null、有多个时取最新
- [x] 1.4 在 `packages/novel-store/src/upgrade.ts` 新增 `updateRunChapterStatusTx`（组合形态）：更新单章状态机字段（status / attempts / started_at / completed_at / resume_at / failure_* / queue_entry_id），验证状态字段写入后可通过 `getActiveUpgradeRun` 聚合查询读出

## 2. 失败分类器

- [x] 2.1 在 `packages/novel-store/src/sync-error-classifier.ts` 新建 `classifySyncError(error: unknown): FailureClassification`，覆盖六类分类（transient_quota / transient_rate / transient_network / terminal_parse / terminal_model / terminal_unknown），验证单元测试用真实错误文本样例（含「额度将于 2026-10-16 20:51:41 可用」）断言分类与 resumeAt 解析正确
- [x] 2.2 在分类器中实现指数退避计算 `computeBackoffMs(attempts: number): number`（1min 起步、上限 30min、±20% jitter），验证单元测试断言边界值与随机范围

## 3. Worker 消费回写

- [x] 3.1 修改 `packages/opennovel/src/novel/manual-edit-sync-worker.ts` `processSyncQueue`：worker 开始消费某章时，在同一事务内把对应 `upgrade_run_chapter` 置为 `running`、写 `started_at` 与 `queue_entry_id`；验证集成测试断言消费开始后 run_chapter 状态为 running
- [x] 3.2 在同一文件：重建成功时同事务置 `synced` + `completed_at`；重建失败时先调分类器，按分类置 `waiting_retry`（写 resume_at）或 `terminal`（写 failure_*），或 attempts < MAX 时重置 `pending`；验证集成测试覆盖三种失败路径
- [x] 3.3 在同一文件：保留「observer 重建 handler 未注册时升级任务禁止确定性 fallback」的诚实性保护（`entry.source === "upgrade" && !handler?.handleChapterContent` 时抛错），新增回归测试断言该保护未被破坏；验证 `bun test` 通过
- [x] 3.4 在 worker 轮询入口记录模块级 `lastPollAt = Date.now()`，新增 `getWorkerLastPollAt()` 导出；验证单元测试模拟两次轮询后时间戳更新

## 4. 服务端端点改造

- [x] 4.1 修改 `packages/server/src/handlers/novel.ts` `upgradeStartEndpoint`：Phase 1 完成后创建 `upgrade_run`（目标集合 = Phase 1 后待重建章节），再入队 Phase 2 条目；同事务完成；验证集成测试断言 start 后 run 存在且章节数与入队条目数一致
- [x] 4.2 修改 `upgradeProgressEndpoint`：有活跃 run 时按 `upgrade_run_chapter` 聚合（total / synced / failed / pending / waiting_retry / running），负载新增 `current_chapter_id`、`current_chapter_started_at`、`worker_last_poll_at`、`eta_ms`、`waiting_retry_list`；无活跃 run 时回退旧逻辑；验证集成测试覆盖有 run / 无 run / 有 waiting_retry 三种情况
- [x] 4.3 修改 `syncRetryEndpoint`（`packages/server/src/handlers/novel.ts:2911`）：接收 `chapterIds: string[]`（从 `ManualEditSyncRetryInput.entryIds` 改为新字段），在 run 内重置 terminal / waiting_retry 章节为 pending（清失败字段、attempts 归零），同步重置对应队列条目；无活跃队列条目时用 `enqueueManualEditSyncTx` 入队；验证集成测试断言重试后 run_chapter 状态为 pending 且队列条目状态同步
- [x] 4.4 在 `upgradeStatusEndpoint` 加对账触发：检测到孤儿队列条目（不限 source——upgrade 或 manual 源都可能是孤儿）且无活跃 run 时，同步执行对账（按设计 D6 算法，单事务、零 AI 调用）；验证集成测试用预置孤儿 skipped 条目断言对账后该章被收编为 synced、横幅分母不再含幽灵条目
- [x] 4.5 修改 `upgradePauseEndpoint` / `upgradeResumeEndpoint`：废弃 `upgrade_state` 表，改为更新 `upgrade_run.status`（active ↔ paused），暂停后 worker 跳过 upgrade 来源条目；验证集成测试断言暂停后 run.status = paused 且 worker 不再消费、resume 后恢复消费

## 5. Protocol 契约更新

- [x] 5.1 在 `packages/schema`（或 `packages/protocol`）更新升级进度 / 重试 / 暂停 / 续跑的请求响应类型，新增 `current_chapter_id`、`current_chapter_started_at`、`worker_last_poll_at`、`eta_ms`、`waiting_retry_list` 字段；重试请求从 `entryIds` 改为 `chapterIds`；运行 `cd packages/client && bun run generate` 重新生成 SDK，验证生成产物包含新字段且无手改痕迹

## 6. App 横幅与进度展示

- [x] 6.1 修改 `packages/app/src/pages/novel/upgrade-banner.tsx`：横幅状态机改为 `hidden | prompt | running | waiting | done-with-failures`，waiting 态显示「模型额度已用尽，预计 {time} 自动恢复」；running 态显示当前章节与 ETA；验证 Storybook 或单元测试覆盖五态渲染
- [x] 6.2 修改 `packages/app/src/pages/novel/upgrade-banner.tsx` 失败列表：展示 `failure_message`（人话说明）+ `failure_action`（行动建议），原始错误文本折叠在细节里；重试按钮传 `chapterIds` 而非 `entryIds`；验证单元测试断言人话文本渲染、原始文本默认隐藏
- [x] 6.3 修改 `packages/app/src/context/novel-queries.ts` `useUpgradeProgress`：轮询间隔改为有活跃 run 时 5s、无 run 时停止；响应带 `worker_last_poll_at` 时若超 10s 无更新显示「同步未在运行」；验证单元测试模拟超时场景断言提示出现
- [x] 6.4 在 `packages/app` 新增 Phase 1 执行期间的「确定性回填执行中」本地状态：点击确认后、start 请求返回前显示；验证单元测试断言请求 pending 时文案渲染

## 7. 对账与集成验证

- [x] 7.1 在 `packages/novel-store/test/` 新增对账集成测试：预置含幽灵 skipped 条目（upgrade 源）+ manual 源 synced 条目的数据库，断言对账后该章在 run 内为 synced、total 分母不含 skipped、横幅聚合到达完成态；再预置 manual 源孤儿 failed 条目（无活跃 run），断言对账后该章被纳入新建 run；验证 `bun test` 通过
- [x] 7.2 在 `packages/novel-store/test/` 新增 run 生命周期集成测试：创建 run → 模拟消费 → 成功路径 / 瞬时失败退避路径 / 终态失败路径 → run 终态判定；验证 `bun test` 通过
- [x] 7.3 在 `packages/server/test/` 新增端点集成测试：覆盖 start / progress / retry / pause / resume 全链路，断言负载形状与 design D4 / D5 一致；验证 `bun test` 通过
- [x] 7.4 全量回归：在 `packages/novel-store`、`packages/server`、`packages/app`、`packages/opennovel` 分别运行 `bun typecheck` 与 `bun run oxlint`，零错误；在 `packages/novel-store`、`packages/server`、`packages/app` 运行 `bun test`，全绿

## Implementation Commits

- `97f68150` feat(novel-store): 升级运行实体与失败分类器
- `3aa8fd7c` feat(schema): 升级进度负载新增 run 驱动字段
- `ab22e40e` feat(opennovel): worker 消费回写 run 章节状态与心跳
- `43b42424` feat(server): 升级端点改为 run 驱动聚合
- `97c2334e` fix(server): de-await withTransaction 消除 await-thenable 警告
- `d5e61fbf` feat(app): 升级横幅 run 驱动五态与进度轮询
- `020d118d` test(novel-store): run 生命周期与对账集成测试

### 归档后收尾修复

- `250bb9a1` fix(server): 对账自愈活跃 run 内已完成章节并修复 worker run 查询时序竞争 — 线上《执棋人》run cf4f6888 卡 pending 的根因有两个：(1) start endpoint 在 worker 查询 activeRun 之后创建 run，worker 消费成功但 run_chapter 永远 pending；(2) reconcileUpgradeState 遇活跃 run 直接返回，不校验 run_chapter 是否实际已完成。修复：worker 事务内动态查找活跃 run；对账有活跃 run 时也校验指纹匹配并自愈。
- `ff6242ce` fix(server): 收编孤儿条目时同步标记队列条目为 synced 防止重复收编 — 对账收编创建 terminal run 后未更新原始 skipped 队列条目，下次对账又发现同样条目再创建新 run，无限循环（线上累积 92 个 run）。修复：收编同事务将对应章节的 pending/failed/skipped 条目标记为 synced。

## Workflow follow-up

- 归档前收集实现提交，写入 `tasks.md` 的 `## Implementation Commits`。
- 运行 `openspec validate upgrade-reliability --strict` 确认提案有效。
- 归档并提交归档移动。
- 合并后确认 CI 全绿，删除功能分支。
