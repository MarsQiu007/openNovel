# Tasks

## 1. 会话不存在判定

- [x] 1.1 在 packages/app/src/utils/server-errors.test.ts 补充失败用例：`cause.body`、`cause` 直接为命名错误体、本地合成消息三种形状均判定为会话不存在，`sessionID` 不匹配或 `_tag` 为其他错误时判定为否；从 packages/app 运行 `bunx bun@1.3.14 test --preload ./happydom.ts ./src/utils/server-errors.test.ts` 确认先红后绿
- [x] 1.2 扩展 `unwrapNamedError` 支持 `cause` 直接承载命名错误体，保持 `cause.body` 路径与本地消息谓词不变；同套件通过且 `bun typecheck` 干净

## 2. lineage 失败归一

- [x] 2.1 在 packages/app/test-browser/session-lineage.test.ts 补充 lineage 用例：`resolve` 以命名 404 失败时抛出的错误可被 not-found 谓词识别，网络类失败保留原始错误；确认用例先失败（Solid 1.9 的 `createEffect`/memo 只在 `--conditions=browser` 下求值，`src` 单测落在 server 构建，故用例放在 browser 套件；失败经 `ErrorBoundary` 采集，对应当前会话失败在写入点抛出的真实路径）
- [x] 2.2 在 `createSessionLineage` 的 resolve 失败分支把可判定为会话不存在的失败归一为本地 not-found 语义，其余失败原样上报；同套件通过（`bunx bun@1.3.14 test --conditions=browser --preload ./happydom.ts ./test-browser/session-lineage.test.ts`，9 pass）

## 3. 删除当前会话后的定位

- [x] 3.1 书内删除当前会话改为「先等待归属会话集合重新拉取，再在同一同步块内移除同步缓存并导航」；工作台按刷新后的集合同步清理失效会话记忆（新增 `settleRememberedSession`，刷新中不清理）。用 `novel-queries` 用例验证刷新后的集合与清理后的记忆不会选中被删除会话（`bunx bun@1.3.14 test --preload ./happydom.ts ./src/context/novel-queries.test.ts`，39 pass）
- [x] 3.2 删除最后一个会话的用例验证定位为空、保持懒创建空态；同套件与 `session-switcher.test.ts`、`server-errors.test.ts` 通过（68 pass）
- [x] 3.3 给 `SessionRouteErrorBoundary` 增加可选 `returnTo`，书内工作台传 `/${dir}/novel/${novelID}`，默认仍为 `/`；复用既有 `session.error.notFound*` 文案，独立会话路由未传值时行为不变
- [x] 3.4 验收发现记忆清理与记忆写入两个 effect 互相触发（约 50Hz 写入回环，最终在深层 effect 波次抛 `RangeError`）：根因是持久化序列化遍历在调用方追踪上下文中执行，把写入存档的 computation 订阅到整个 store（design D6）。`persisted` 改为传入整体 `untrack` 的 `serialize`，`snapshot` 同样 untrack；`persist.test.ts` 先红（外部写入使 computation 重跑 2 次）后绿（13 pass）

## 4. 集成验证

- [x] 4.1 桌面端真实书内会话验收：新建会话后在时间线“更多选项 → 删除…”删除当前会话，面板落到另一有效会话，无“出了点问题”、无“找不到此会话”；刷新后仍停留在有效会话且无错误页；把路由指向不存在的 `ses_test_missing_0000` 后刷新，面板显示“找不到此会话”兜底（含会话标识与关闭入口），点击关闭回到工作台基础视图并由既有回跳落到有效会话；验收期间修复后 2.5 分钟以上无 `RangeError`/fatal renderer（修复前约 60 秒必崩），坏会话路由不再被记忆写回（存档 `sessionId` 清理为有效会话）
- [x] 4.2 回归：`persist`/`server-errors`/`novel-queries` 共 65 pass，`test-browser/session-lineage.test.ts` 9 pass；`packages/app` 下 `bun typecheck` 通过；仓库根对改动文件运行 `bunx oxlint` 为 0 error、无新增告警

## Implementation Commits

- `fdbe10e103` fix(app): 会话不存在时按面板兜底并清理失效会话记忆

## Workflow follow-up

- 实施提交带 `OpenSpec-Change: session-not-found-fallback` footer 并登记到 `Implementation Commits`。
- 已运行 `openspec validate session-not-found-fallback --strict`，同步主 specs 并归档。
