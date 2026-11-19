# Proposal: pending-setting-tool-usability

## Why

候选设定（pending_settings）相关工具存在 4 个可用性缺陷，全部在实际写作会话中产生 user_report 或 tool_failed 证据：

**relationship 候选接受时 FK 失败（功能性阻断）**：`accept_pending_setting` 处理 relationship 类型候选时报 `FOREIGN KEY constraint failed`。根因是关系候选的 payload 中 `char_a_id`/`char_b_id` 使用角色候选创建时的临时 ID（如 `char_lixinbo`），但角色候选被接受后入库的实际 ID 可能不同，导致外键约束失败。关系类候选完全无法通过工具接受。

**`list_pending_settings` 缺 `all` 状态枚举（agent 反复失败）**：工具 schema 只允许 `pending|accepted|rejected|merged`，agent 多次试图传 `status: "all"` 查看全部候选，全部失败（已产生 5 条 tool_failed 证据）。缺少一次性查看所有候选的能力迫使 agent 分四次调用。

**展示 ID 与接受 ID 格式不一致（agent 必须两步操作）**：`list_pending_settings` 展示短 ID 前缀（如 `[4a0a1eea]`），但 `accept_pending_setting` 需要完整 UUID（如 `4a0a1eea-59ee-466d-b340-61d27e1797ea`）。agent 必须先调用一次获取完整 ID 再接受，增加误操作率和 token 消耗。

**缺少批量接受候选入口（效率问题）**：处理 27 条候选时只能逐个调用 `accept_pending_setting` 或使用 `code_mode` 绕过系统，缺少正规的批量接受工具。

**收件箱徽标计数不按状态过滤（UI 计数虚高）**：服务端 `countsOf()` 统计候选数时没有过滤 `status = 'pending'`，accepted/rejected/merged 的候选也被计入徽标。用户看到徽标「21」但列表实际为空（pending=0），误以为接受操作没生效。同时 UI 条目不渲染 status 字段，用户无法分辨已处理和待审条目。

## What Changes

- **relationship 候选接受修复**：`accept_pending_setting` 在写入关系正式表前，先解析 `char_a_id`/`char_b_id` 对应角色的正式 ID（通过角色名或候选关联表查找），再执行 INSERT。找不到对应角色时报明确错误而非 FK 异常。
- **`list_pending_settings` 增加 `all` 状态**：schema 枚举扩展为 `pending|accepted|rejected|merged|all`，默认值保持 `pending` 不变。
- **列表返回完整 ID**：`list_pending_settings` 的返回结构中每条候选直接携带完整 UUID 格式的 `id` 字段（不再只给短前缀），agent 可直接用于 `accept_pending_setting`。
- **新增 `batch_accept_pending_settings` 工具**：接受 `ids: string[]` 和可选 `status` 过滤，逐条调用共享服务接受，返回每条的接受结果（成功/失败/原因）。

- **收件箱徽标计数修复**：服务端 `countsOf()` 只统计 `status = 'pending'` 的候选数，已处理候选不再计入徽标。
- **收件箱条目状态可见性**：UI 条目渲染 status 徽标（pending / accepted / rejected / merged），默认只显示 pending 状态条目；提供「显示已处理」开关，打开时追加显示已处理条目。

## Capabilities

### New Capabilities

（无——本变更全部落在既有 `setting-review-hub` 能力的工具层修复和扩展上）

### Modified Capabilities

- `setting-review-hub`：
  - 「候选审阅复用既有操作语义」补充需求：接受 relationship 候选时 MUST 先将临时角色 ID 解析为正式角色 ID 再写入关系表；找不到对应角色时报明确错误。
  - 新增需求：列表工具 MUST 在返回中携带完整 ID；提供批量接受工具支持一次接受多条候选。

## Impact

- **packages/plugin**（`src/novel-writer/session-store.ts` 或 `src/novel-writer/tools/pending-settings.ts` 附近）：
  - `accept_pending_setting` relationship 分支：补角色 ID 解析逻辑。
  - `list_pending_settings`：schema 扩展 `all` 枚举 + 返回结构带完整 ID。
  - 新增 `batch_accept_pending_settings` 工具定义和实现。
- **不涉及 packages/protocol、packages/schema、packages/client**（无 SDK 再生成）。
- **packages/app**（`src/pages/novel/setting-review-inbox.tsx`）：条目状态徽标渲染 +「显示已处理」开关。
- **数据兼容**：不改变 pending_settings 表结构，不迁移既有数据。
