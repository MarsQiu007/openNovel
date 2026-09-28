# Proposal

## Why

手动编辑同步与书籍升级会把失败任务保留为 `failed`，但当前没有可用的显式重试路径：升级续跑只切换消费闸门，worker 只消费 `pending`，同步面板的重试按钮也是空操作。用户修复运行环境后，历史失败任务仍会永久显示为失败。

## What Changes

- 增加同步失败任务的显式重试契约：只允许把 `failed` 任务重置为 `pending`，不得伪造 `synced`。
- 修正同指纹失败任务的重试入队语义：复用原任务记录，清空失败原因，不生成重复队列条目。
- 新增按条目 ID 重试同步任务的 API，供手动同步面板与升级失败横幅共用。
- 升级进度返回失败条目的队列 ID，失败横幅提供「重试失败章节」操作。
- 同步状态面板的重试按钮改为调用真实 API，并在成功后刷新状态。
- 保持 worker 只消费 `pending` 的模型；不自动重试 `failed`，避免用户无意间触发模型调用。

### 非目标

- 不新增 `processing` 队列状态，不改变 `pending / synced / failed / skipped` 状态机。
- 不自动扫描或自动重试所有失败任务。
- 不修改 observer 重建实现、模型解析或升级 Phase 1 / Phase 2 流程。
- 不提供按章节内容或指纹批量重试的独立接口；本变更只按队列条目 ID 重试。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `manual-edit-sync`: 增加失败任务显式重试行为与同指纹重试的去重语义。
- `derived-data-upgrade`: 升级进度暴露失败条目 ID，并允许用户显式重试失败章节。

## Impact

- **packages/novel-store**：同步队列重试语义与状态更新。
- **packages/schema**：新增重试请求 / 响应契约，扩展升级失败条目字段。
- **packages/protocol**：新增同步重试端点。
- **packages/client**：重新生成 SDK。
- **packages/server**：实现同步重试端点与升级进度字段。
- **packages/app**：升级横幅与同步状态面板接入真实重试操作。
- **既有本地数据**：无 schema 迁移；历史 `failed` 记录保持原样，用户显式重试后复用原记录并回到 `pending`。
