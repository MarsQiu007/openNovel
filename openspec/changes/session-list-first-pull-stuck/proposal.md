# Proposal

## Why

novel-session-list-cutoff 修复了书内会话列表被全局 50 条分页截断的问题，但留下一个验收尾巴：打开书籍工作台时，若首拉绑定会话列表落在服务端启动窗口期（sidecar 已监听但内部初始化未完成的间隙），首拉可能以空结果（200 空数组）或失败收场；空结果会被当作合法数据缓存后，由于 `staleTime` 10 秒内重新打开同一本书不会重新拉取、应用全局已禁用 focus/reconnect 自动重拉（packages/app/src/app.tsx QueryClient 默认 `refetchOnWindowFocus: false`/`refetchOnReconnect: false`）、且无轮询机制，"暂无会话"假空态会一直滞留，用户只能强制刷新（重载渲染进程）才能看到已有会话。

## What Changes

- 绑定会话列表查询（`useBoundNovelSessions`）增加"空结果守卫"：当该书存在绑定关系记录但组合结果为空时，视为结果不确定，在查询函数内做有限间隔重拉（不 settle 为空），期间切换器保持加载占位；重拉上限内仍为空才接受空结果。仅对异常失败生效的既有 `retry` 机制保持不变。
- 书内会话列表缓存策略调整：`staleTime` 降为 0 并保持 `refetchOnMount`，重新打开书籍工作台时总是重新拉取（stale-while-revalidate），不再复用可能滞留的空缓存。
- 非目标：不改动服务端 session.list / session-bindings 行为；不改动 sidecar 启动与 ready 信号时序；不改动自动回跳的目标选择逻辑（resolveAutoAdoptTarget）；不改动懒创建流程。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-chat-panel`: 会话切换器与自动回跳对"查询返回空但该书存在绑定关系"的不确定态处理，以及重新打开书籍时的重拉策略。

## Impact

- `packages/app`：会话查询（`context/novel-queries.ts` 的 `useBoundNovelSessions`）与既有测试（`novel-queries.test.ts`），无协议/服务端/数据模型变更，与现有本地数据完全兼容。