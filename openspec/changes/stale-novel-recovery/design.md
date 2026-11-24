# Design

## 识别方式

HTTP 404 在 SDK 层表现为带状态/名称可判定的错误对象（OpenNovel 客户端错误）。在 detail 查询与 for-session 查询的 error 分支判定 NotFound：是则进入自愈，否则维持现状。

## 自愈动作

1. 清除当前书籍引用（novel 上下文 currentNovel 置空、错误清空），UI 回落书架空态。
2. 清理按书持久化状态中该 novelID 的键（novel-workspace-per-book-state 存档），避免残留。
3. for-session 404 视为「无绑定」返回 null，不设错误。

## 防重发

自愈后查询的 enabled 条件依赖已清除的引用，引用为空即不再发请求；不做负缓存等额外机制。

## 测试策略

- app 包单测：detail 404 → 引用清除且不再请求；非 404 错误 → 行为不变；for-session 404 → 返回 null。
- packages/app 目录 typecheck + oxlint。