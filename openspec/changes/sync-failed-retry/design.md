# Design

## Context

当前队列状态机已经区分 `pending / synced / failed / skipped`，worker 只消费 `pending`。`upgrade-resume` 只切换消费闸门，不改变条目状态；同步面板的重试处理没有调用服务端。同步入队对同指纹 `failed` 任务会插入新任务，但保留旧失败记录，导致进度聚合永久残留失败计数。

## Goals / Non-Goals

**Goals:**

- 让用户能显式把失败任务送回消费队列。
- 保证同指纹失败重试复用原记录，不产生重复计数。
- 让升级失败横幅与手动同步面板共用同一条重试链路。
- 保持 worker 消费模型与升级诚实性约束不变。

**Non-Goals:**

- 不自动重试失败任务。
- 不引入后台重试调度、重试次数或退避策略。
- 不修改 observer 重建与模型调用实现。

## Decisions

### D1: 重试状态转换放在 novel-store 队列层

新增队列层重试函数，输入小说 ID 与队列条目 ID 集合。函数只匹配属于该小说且状态为 `failed` 的条目，将其更新为 `pending` 并清除 `failure_reason`；其余条目保持不变。返回被重置数量与未重置数量，避免 UI 或调用方静默误解部分重试结果。

不在 worker 内重试的原因：worker 只应消费待处理任务；把 `failed` 直接纳入轮询会绕过用户显式确认，可能意外触发模型调用。

### D2: 同指纹 failed 入队复用原记录

调整入队去重逻辑：同指纹且状态为 `failed` 的既有条目不再插入新记录，而是把原记录重置为 `pending` 并清除失败原因。不同指纹仍按现有语义将旧任务标记为 `skipped` 后入队新任务。

这样升级进度与同步状态查询不会同时出现一条 `failed` 与一条同指纹 `pending`，历史失败计数能随重试消失。

### D3: 新增按条目重试 API

新增 `POST /api/novel/{novelID}/sync/retry`：

- 请求：`entryIds: string[]`
- 响应：`retried: number`、`unchanged: number`
- 错误：沿用小说不存在错误

按条目 ID 而不是按章节或指纹重试，可以精确表达用户选中的失败项，也能同时服务手动同步面板与升级失败横幅。协议变更后在 `packages/client` 运行 `bun run generate`，不手改 generated 目录。

### D4: 升级失败项携带队列条目 ID

升级进度中的失败项在章节 ID 与原因之外增加队列条目 ID。UI 用该 ID 调用同步重试 API；重试成功后刷新升级进度与同步状态。

这避免 UI 通过章节 ID 反查队列，也避免为升级单独复制一套重试端点。

### D5: 两个 UI 入口共用同一 mutation

应用侧新增同步重试 mutation。同步状态面板对单个失败条目调用一次；升级横幅在 `done-with-failures` 状态下提供「重试失败章节」，把当前失败项的队列 ID 一次性传入。操作成功后失效同步状态与升级进度查询，让现有轮询刷新聚合结果。

### D6: worker 与闸门行为保持不变

worker 继续只查询 `pending`。暂停闸门下重试后的条目保持 `pending`，续跑打开闸门后才被消费。进程重启不会自动改变 `failed` 状态。

## Risks / Trade-offs

- [用户重试会再次触发模型调用] -> 重试必须显式点击，接口不提供启动时自动重试路径。
- [请求中包含重复或非法条目 ID] -> 服务端按唯一 ID 计数，只重置属于当前小说且状态为 `failed` 的条目，其余计入 `unchanged`。
- [新增响应字段要求客户端与服务端版本匹配] -> 桌面端与 sidecar 同仓发布；SDK 通过 `packages/client` 重新生成，避免手写契约漂移。
- [重试后再次失败] -> 保留新的失败原因，用户可再次显式重试；不引入自动退避。

## Migration Plan

无数据库迁移。历史 `failed` 记录保持原状，用户点击重试后复用原记录回到 `pending`。回滚代码不影响队列数据；已重试但未消费的任务会保持 `pending`，由回滚后的 worker 语义决定是否继续消费。

## Open Questions

（无）
