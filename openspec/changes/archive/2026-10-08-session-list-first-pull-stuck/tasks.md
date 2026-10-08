# Tasks

依据：proposal.md、design.md（D1–D3）。

## 1. 空守卫重拉（D1/D2）

- [x] 1.1 在 `packages/app/src/context/novel-queries.ts` 导出可注入 fetcher 的组合函数 `loadBoundSessionsWithEmptyGuard`：接收"拉取一次 bindings+sessions 并组合"的 fetch 函数与 `{ novelID, maxAttempts, delayMs }`，当组合结果为空且 bindings 中存在该书记录时按 delayMs 间隔重拉，直到结果非空或总拉取次数达到 maxAttempts；真零绑定（无该书记录）立即返回空。生产参数：delayMs 1s、maxAttempts 4（首次 + 最多 3 次重拉）
- [x] 1.2 `useBoundNovelSessions` 的 queryFn 改用 1.1 的组合函数，传入真实 client 调用；既有 `retry: 2` 异常重试与 `refetchOnMount: true` 保持不变（验证：`packages/app` `bun typecheck` 通过）

## 2. 缓存策略（D3）

- [x] 2.1 `useBoundNovelSessions` 的 `staleTime` 由 `10_000` 降为 `0`，使重新打开书籍工作台总是触发 background refetch（验证：阅读 query 配置确认 refetchOnMount 仍为 true；typecheck 通过）

## 3. 测试

- [x] 3.1 重拉路径单测：注入"首次组合结果为空且 bindings 有该书记录、第二次非空"的 fetcher，断言最终返回非空列表、fetcher 被调用 2 次（验证：`packages/app` 相关测试通过）
- [x] 3.2 上限路径单测：fetcher 恒返回"有绑定记录但组合为空"，断言 fetcher 恰被调用 maxAttempts 次后返回空，不无限循环（验证：测试通过）
- [x] 3.3 真零绑定路径单测：fetcher 返回"无该书记录"，断言仅调用 1 次立即返回空（新书零延迟空态不回退）（验证：测试通过）
- [x] 3.4 既有回归：`boundNovelSessions`、`sessionSwitcherTrigger`、`resolveAutoAdoptTarget` 既有用例全部不修改且通过（验证：`packages/app` 测试全绿）

## 4. 门禁

- [x] 4.1 仓库根 `bun run lint`（0 errors，warnings 不新增）+ `packages/app` `bun typecheck`（验证：命令输出）
- [x] 4.2 提交推送，footer 带 `OpenSpec-Change: session-list-first-pull-stuck`（验证：推送成功）

## Implementation Commits

- `895e6641` fix(app): 书内会话列表首拉空守卫与重进必拉