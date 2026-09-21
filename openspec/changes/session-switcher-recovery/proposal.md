## Why

重新打开书籍时，会话切换器依赖的 `bound-sessions` 查询可能在启动窗口期失败或返回空；由于"加载中""查询失败""零会话"三种状态在 UI 上渲染为同一个"暂无会话"禁用态，且全局 QueryClient 关闭了焦点/重连刷新，错误态没有任何自愈路径——用户必须在当前会话发出一条消息（触发失效刷新）才能让历史会话重新出现，期间完全无法切换会话。

## What Changes

- 会话切换器区分"加载中 / 查询失败 / 零绑定会话"三种状态：加载中显示占位、失败显示错误占位并允许手动重试，仅零绑定会话才显示"暂无会话"并禁用下拉。
- `bound-sessions` 查询失败时自动重试（有限次数、退避），不再让错误态无限期滞留。
- 未选中会话时的自动回跳逻辑对"查询失败"与"确实零会话"区别对待：失败时等待重试结果再决策，不静默落入懒创建空态。
- 发送首条消息后的失效刷新路径保留不变，作为兜底而非唯一恢复手段。

## Non-Goals

- 不修改 `session.list` / `session-bindings` 服务端 API 契约与实现。
- 不改变自动回跳的产品语义（记忆会话优先、回落最近活跃、零绑定保持懒创建空态）。
- 不处理 `session.list` 默认 50 条分页上限对超多会话书籍的影响。
- 不引入服务端推送驱动的绑定列表增量同步。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `novel-chat-panel`: 会话切换器的空态判定细化为三态（加载/失败/空），新增查询失败的自愈与手动重试要求；自动回跳要求在查询失败时不得误判为零会话。

## Impact

- 主要影响 `packages/app`：`novel-queries.ts`（useBoundNovelSessions 重试策略）、`workspace-data.ts` 与 `session-switcher.tsx`（三态判定与渲染）及其测试文件；`workspace-frame.tsx` 的自动回跳 effect 按设计预计无需改动，仅做回归验证。
- 不涉及 Protocol / Server HttpApi 改动，无需重新生成 SDK。
- 纯前端行为修复，不影响本地数据模型与既有书籍数据兼容性。
