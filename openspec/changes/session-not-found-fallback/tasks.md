# Tasks

## 1. 会话不存在判定

- [ ] 1.1 在 packages/app/src/utils/server-errors.test.ts 补充失败用例：`cause.body`、`cause` 直接为命名错误体、本地合成消息三种形状均判定为会话不存在，`sessionID` 不匹配或 `_tag` 为其他错误时判定为否；从 packages/app 运行 `bunx bun@1.3.14 test --preload ./happydom.ts ./src/utils/server-errors.test.ts` 确认先红后绿
- [ ] 1.2 扩展 `unwrapNamedError` 支持 `cause` 直接承载命名错误体，保持 `cause.body` 路径与本地消息谓词不变；同套件通过且 `bun typecheck` 干净

## 2. lineage 失败归一

- [ ] 2.1 在 packages/app/src/pages/session 补充 lineage 用例：`resolve` 以命名 404 失败时抛出的错误可被 not-found 谓词识别，网络类失败保留原始错误；确认用例先失败
- [ ] 2.2 在 `createSessionLineage` 的 resolve 失败分支把可判定为会话不存在的失败归一为本地 not-found 语义，其余失败原样上报；同套件通过

## 3. 删除当前会话后的定位

- [ ] 3.1 在书内删除流程中先清除指向被删除会话的会话记忆、从同步 store 移除会话及后代，再等待归属会话集合重新拉取完成，最后导航到工作台基础视图；用 `novel-queries` 既有组合函数补用例，验证刷新后的集合与清理后的记忆不会选中被删除会话
- [ ] 3.2 验证删除最后一个会话时不进入错误态、保持懒创建空态，并补对应单元用例；从 packages/app 运行 `bunx bun@1.3.14 test --preload ./happydom.ts ./src/context/novel-queries.test.ts ./src/pages/novel/session-switcher.test.ts` 通过
- [ ] 3.3 给 `SessionRouteErrorBoundary` 增加可选返回目标，书内工作台传工作台基础视图，默认仍为 `/`；复用既有 `session.error.notFound*` 文案，不新增 i18n key，并确认独立会话路由传入缺省值时行为不变

## 4. 集成验证

- [ ] 4.1 重建 packages/desktop 后在真实书内会话验收：删除当前会话后回到工作台基础视图或有效会话，不出现“出了点问题”；刷新不再进入错误页；其他客户端删除场景显示“会话无法找到”兜底，可返回工作台
- [ ] 4.2 运行 packages/app 相关回归套件与 `bun typecheck`，在仓库根对改动文件运行 oxlint 无新增告警

## Implementation Commits

## Workflow follow-up

- 实施提交带 `OpenSpec-Change: session-not-found-fallback` footer 并登记到 `Implementation Commits`
- 验收通过后运行 `openspec validate session-not-found-fallback --strict`，同步主 specs 并归档
