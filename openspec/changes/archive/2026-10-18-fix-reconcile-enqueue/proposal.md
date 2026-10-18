# Proposal

## Why

升级对账（reconcileUpgradeState）发现「上一轮升级失败残留的孤儿队列条目」时，会把对应章节纳入**新建升级 run**，但实现只写了 run 与 run_chapter 记录，**没有把队列条目恢复为可消费状态**。worker 只消费 `manual_edit_sync_queue` 里的 pending 条目，run 只是记账——于是 run 永远 active、章节永远 pending、队列永远 failed，进度一动不动；active run 的存在又挡住后续对账自愈，形成自锁。线上实例：`D:/AI/Novels/projects/末日`《筛选队友，我是专业的》run `b0884c60` 5 章全 pending、队列 5 条 failed（failure_reason=「无可用语言模型：无法加载模型」，模型问题已排除），用户无任何操作入口。

## What Changes

- 对账收编入 run 时（`toPending` 分支），**在同一事务内**按来源指纹去重入队（复用 `enqueueManualEditSyncTx`：同指纹 failed 条目重置为 pending、清 failure_reason），使 run 目标章节与队列在途条目原子一致。
- 对账/状态查询的活跃 run 自愈分支增加**反向脱节检测**：run_chapter 处于 pending / running 但对应章节在队列中无在途（pending / failed 非跳过）条目时，判定为「run 记账与消费侧脱节」，同事务补入队恢复消费。
- spec 层明确「中断恢复」与「终态重试」的边界：孤儿收编恢复消费属于**续跑**（上一轮用户已确认的工作被中断，恢复不消耗用户显式重试语义）；用户对终态失败的**显式**重试入口与语义不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `derived-data-upgrade`: 「存量数据对账」需求补充对账收编时恢复队列消费的规约，并明确中断续跑与用户显式重试的边界。

## Impact

- **packages/server**：`src/handlers/novel.ts` 对账 `reconcileUpgradeState` 函数体（约 3080-3200 区间：活跃 run 自愈分支与孤儿收编分支）。
- **packages/novel-store**：复用既有 `enqueueManualEditSyncTx`（`src/manual-edit-sync.ts`），无 schema 变更。
- **既有数据兼容**：修复上线后，已卡死的活跃 run（如线上 `b0884c60`）会在下一次状态查询时经反向自愈自动恢复消费，无需手工清库；队列条目与 run 记录均为既有表，无迁移。
- **非目标**：不改 worker 消费管线、不改重试端点语义（`syncRetryEndpoint` 行为不变）、不改横幅 UI、不动「升级任务注册表」的待升级检测；本次不处理「对账建 terminal run 呈现失败」等替代交互方案。

## 验收口径

- 复现路径集成测试：预置「无活跃 run + 孤儿 failed 条目 + 活跃 run 内 run_chapter 与队列脱节」两种数据库，断言对账/状态查询后队列存在 pending 条目且 run 章节可被 worker 推进至 synced。
- 本地验证：本地《筛选队友，我是专业的》书库在修复版本下状态查询一次后，卡死 run `b0884c60` 的 5 章进入消费并最终全部 synced（模型配置已确认正常）。
