# Design

## Context

升级对账（`packages/server/src/handlers/novel.ts` 的 `reconcileUpgradeState`）在状态查询路径触发，分两条路：

- **有活跃 run**：仅做正向自愈（队列条目已 synced 但 run_chapter 仍 pending → 补记 synced，250bb9a1 引入），随后直接 return。
- **无活跃 run + 存在非 synced 孤儿队列条目**：按章判定——指纹匹配收编为 synced（同事务标记队列条目，ff6242ce 引入）；指纹不匹配且有 pending/failed 条目 → 建**活跃 run** + 章节全 pending，**事务到此为止**。

worker（`packages/opennovel/src/novel/manual-edit-sync-worker.ts`）只消费 `manual_edit_sync_queue` 中的 pending 条目；run 与 run_chapter 是纯记账。两路数据只靠消费回写与端点动作手工对齐，对账恰好是两条数据的交汇点，却遗漏了「run 记了账、队列没有活」的脱节对齐。

线上实例（D:/AI/Novels/projects/末日《筛选队友，我是专业的》）：run `b0884c60` 5 章全 pending、队列 5 条 failed（「无可用语言模型：无法加载模型」），集合完全一致，进度永冻。

## Goals / Non-Goals

**Goals:**

- 对账收编入 run 与队列恢复消费**原子一致**（同事务）。
- 已卡死的活跃 run 在修复后的首次状态查询中自动恢复消费（模型配置已确认正常的前提下用户零操作）。
- 中断续跑与用户显式重试的语义边界在代码与 spec 双重明确。

**Non-Goals:**

- 不改 worker 消费管线、闸门语义、重试端点（`syncRetryEndpoint`）行为。
- 不引入 terminal-run 失败呈现方案（对账建 terminal run + 放开重试端点的方案已评估，见 D1 备选）。
- 不做跨进程唤醒：对账恢复消费后依赖 worker 既有轮询（≤ 数秒）接力，不新增通知通道。

## Decisions

### D1 对账收编同事务入队，而不是改呈现层

`toPending` 分支在创建 run 的同一事务内，对每章调用 `enqueueManualEditSyncTx`（`packages/novel-store/src/manual-edit-sync.ts`），`sourceFingerprint` 取 `chapter.content_fingerprint`（Phase 1 已写基线）。复用其既有去重语义：

- 同指纹 failed → 重置 pending、清 `failure_reason`（本次主路径）。
- 同指纹 pending → deduped，幂等。
- 指纹不同 → 旧条目标 skipped + 入队新条目（取代链语义不变）。

**备选（否决）：对账建 terminal run + 章节标 failed，重试端点放开 terminal run。** 评估结论：呈现闭环更「显式」，但 `retryChapters` 只认活跃 run，需同时改重试端点与 run 终态语义；且 terminal run 不挡对账，需另加「terminal run 已覆盖章节则不重复建」的防爆炸约束（ff6242ce 曾修同类 92-run 累积）。改动面与回归风险均大于主方案。

**备选（否决）：对账不建 run，失败孤儿回到待升级集合等用户确认。** 注册任务已执行过，待升级横幅不会再出现，失败章节对用户不可见，死胡同。

### D2 活跃 run 分支加反向脱节自愈

正向自愈（staleChapters）之后、return 之前，扫描活跃 run 内 `pending` / `running` 章节：若该章在队列中**没有 `pending` 条目**（`failed` / `skipped` / `synced` 均不可被 worker 消费），判定为「run 记账等待消费、队列无活可干」的脱节，同事务补入队（走 `enqueueManualEditSyncTx` 指纹去重：同指纹 failed 重置为 pending，无失败条目则新入队）。`terminal` 章节不触碰——用户显式重试语义不变。

判定刻意用「无 pending 条目」而非「无 failed 条目」：线上卡死形态恰恰是 run_chapter 全 `pending` + 队列全 `failed`——failed 是消费已终结状态，run 却仍在等它推进，正是最需要恢复的脱节。安全性上队列无消费中中间态（worker 处理期间条目保持 `pending`），故「有 pending 即不触发」天然避开与在跑条目的竞争；`enqueueManualEditSyncTx` 的去重（同指纹 pending 跳过）提供第二道幂等保护。

### D3 自愈不绕过消费闸门

两条修复路径只恢复**数据**（队列条目 pending），不直接唤醒 worker。闸门（全局 `upgrade_state` + run paused，`11db170b` 修复后的双条件）下 worker 继续跳过 upgrade 条目，行为与「暂停保留队列」契约一致。暂停期间自愈入队的条目在续跑后被消费。

### D4 事务边界沿用 withTransaction 组合形态

两处修复都落在 `reconcileUpgradeState` 既有事务内（`toPending` 分支已包事务；活跃 run 分支正向自愈已包事务），不新开嵌套事务，遵守 novel-store 事务纪律。`enqueueManualEditSyncTx` 首参传外层 `tx`。

## Risks / Trade-offs

- **[terminal 类失败（如模型不可用）被自动续跑后再次失败]** → 失败分类器会把 run_chapter 标 terminal 并展示人话建议，用户按既有失败列表显式处理；续跑不消耗显式重试语义，重试按钮行为不变。
- **[自愈误把用户有意放弃的章节重新排队]** → 用户侧没有「放弃章节」的显式状态（跳过仅体现在 skipped 取代链），孤儿 failed 即中断残留；误判面可控。
- **[状态查询路径变重]** → 反向自愈每轮只扫描活跃 run 的章节集合（通常 ≤ 百级），且仅在集合非空时执行；幂等，重复执行无副作用。
- **[线上 run `b0884c60` 自愈后若模型仍异常会再次失败]** → 用户已确认模型配置正常；即使失败也落入 terminal 呈现，比无限 pending 更可操作。

## Migration Plan

纯代码修复，无 schema 变更、无数据迁移。修复版本首次对线上书库做状态查询时：

1. 活跃 run 分支反向自愈把 5 章队列 failed 重置 pending。
2. worker 轮询消费，run 推进至 synced / terminal。
3. 若全部 synced，run 终态判定（既有 `remaining.every` 逻辑）自动标 terminal，横幅消失。
