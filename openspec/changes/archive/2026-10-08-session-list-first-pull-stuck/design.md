# Design

## Context

书内绑定会话列表由 `useBoundNovelSessions`（packages/app/src/context/novel-queries.ts）提供：并发拉取 `session-bindings` 与 `session.list`（roots+limit 1000），经 `boundNovelSessions` 纯函数取交集。该查询当前配置 `staleTime: 10_000`、`refetchOnMount: true`、`retry: 2`。桌面端 server 以 utilityProcess sidecar 启动，`Server.listen` resolve 后即向主进程发 ready，但 syncWorker 等内部初始化可能滞后——首拉可能落在"端口可连、内部未就绪"的窗口期。

关键差异：既有 `retry` 只在查询抛异常时生效；若首拉以空结果（200 空数组）收场，这是**合法成功结果**，会被缓存为 data。空缓存命中后：staleTime 10 秒内重新打开同一本书不触发重拉（refetchOnMount 对 fresh 数据无效）、应用全局禁用了 refetchOnWindowFocus/refetchOnReconnect（app.tsx QueryClient 默认）、无 refetchInterval——空态滞留到用户强制刷新（重载渲染进程清空缓存）为止。

机制说明：书库绑定表与会话表均为本地 SQLite 同步查询，“启动窗口期”的确切表现（空响应、DB 繁忙异常或纯粹的首拉失败后 error 滞留）尚未抓包确证；本设计按分支覆盖——D3（重进必拉）对任意坏首拉结果通用，D1（空守卫）专治空成功分支，异常分支由既有 retry 覆盖。即便机制假设不完全命中，两个决策各自独立成立。

## Goals / Non-Goals

Goals:
- 消除"假空态"：绑定关系存在但组合结果为空时，不把该次查询当作零绑定定论。
- 重新打开书籍工作台时总是重新拉取，不依赖用户强制刷新整窗。

Non-Goals:
- 不改服务端行为、不改 sidecar ready 时序（窗口期本身允许存在，客户端自愈即可）。
- 不引入全局 loading 状态或 UI 结构变化；切换器/自动回跳的现有渲染逻辑不动。

## Decisions

### D1: 空守卫采用"查询函数内有限重拉"，不新增状态字段

queryFn 内部：拉取 → 若结果为空**且** bindings 中存在该书记录 → 间隔等待后重拉，最多 N 次；超限仍空才返回 []。期间查询保持 pending，切换器显示加载占位（既有"列表加载中"路径）。

对比方案：
- 抛特殊错误走 `retry`：retry 语义是"失败重试"，空结果是成功而非失败，复用会污染 error 态统计与 retryDelay 节奏（指数退避上限 4s 不适合高频轮询）。
- `refetchInterval` 轮询：需要新增"结果不确定"状态字段驱动 interval 启停，组件层要感知该字段，改动面大。
- 函数内重拉：TanStack 语义标准（pending = 加载中），无需新状态、无需组件改动；延迟与次数完全可控。

实现形态：把"拉取一次并组合"提取为接收 fetcher 的辅助函数（`loadBoundSessionsWithEmptyGuard(fetchOnce)`，与既有纯函数 `boundNovelSessions` 命名区分开），fetchOnce 返回组合结果的同时须携带守卫判定所需的绑定信息（如 `{ options, bindings }`），守卫以 `bindings` 中是否存在该书记录作为零绑定判定依据；queryFn 传入真实 client 调用；测试注入“首次空、二次非空”的 fetcher 序列即可覆盖重拉路径——参数化依赖而非 mock 全局，符合仓库"避免 mock、测试实际实现"的约定。

### D2: 重拉触发条件从严，上限从紧

触发条件：`boundNovelSessions` 结果为空 **且** bindings 中存在 `novelID` 匹配的记录。真零绑定（无该书记录）立即返回 []，不进入重拉（新书打开即时呈现懒创建空态，零延迟）。上限：`maxAttempts` 定义为总拉取次数（含首次），默认 4（首次 + 最多 3 次间隔 1s 的重拉，重拉窗口约 3s）；与既有 retry（失败后 1s/2s 退避共 2 次重试）不叠加——守卫在 queryFn 内 settle 空结果后本次查询整体成功，不会触发 retry，仅当重拉过程中抛异常时才回落到 retry 路径。

过滤后为空但 bindings 有记录的情形（如绑定全是归档/子代理会话）也会触发重拉——该场景罕见，重拉 3 次后接受空结果，行为可接受。

### D3: `staleTime` 降为 0，依赖 `refetchOnMount` 实现"重进必拉"

staleTime 10s → 0：任何组件重挂载（重新打开书籍工作台）都触发 background refetch（stale-while-revalidate，先显缓存再更新）。queryKey 未变、observer 共享同一查询实例，会话内组件局部重挂载不会放大请求量（挂载去重）。

对比方案：
- 进书时手动 `invalidateQueries`：需要在路由层感知"进入书籍"事件，新增失效触发点；且 invalidate 会强制 pending 态（无缓存瞬显），体验反而倒退。
- 保持 10s + 缩短为 2-3s：治标不治本，窗口期空结果在 staleTime 内重进仍会直接复用。

注意：D1 落地后假空 [] 不再被 settle（不确定时保持 pending），D3 针对的是"真实数据变化后重进书"的滞留场景（如其他端新建/删除会话），两者互补。

## Risks / Trade-offs

- [重拉期间切换器长时间停在加载占位（最长约 3s+首拉耗时）] → 仅当"有绑定记录但结果空"这一异常组合时发生；正常书籍（含真零绑定新书）路径零延迟。上限从紧，超时后退回可接受的空态，且 D3 保证重进书自愈。
- [staleTime 0 使频繁进出书增加请求] → session-bindings + session.list 均为轻量本地查询（服务端在 loopback），且同一查询实例挂载去重；可忽略。
- [函数内 sleep 使 queryFn 测试变慢] → 测试中注入 0ms 间隔参数（生产默认 1s），用例保持毫秒级。

## Migration Plan

纯前端行为变更，无数据迁移。发布后用户重新打开书籍工作台即生效；此前滞留的空缓存随应用更新后的首次重挂载自然失效。

## Open Questions

无。