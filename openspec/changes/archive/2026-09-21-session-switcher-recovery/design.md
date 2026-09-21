## Context

- `useBoundNovelSessions`（packages/app/src/context/novel-queries.ts）在 `queryFn` 中用
  `Promise.all` 并发请求 `session-bindings` 与 `session.list`；客户端 SDK 以
  `throwOnError: true` 创建，任一请求失败整个查询进入 error 态，`data` 保持 `undefined`。
- 切换器（session-switcher.tsx）与自动回跳 effect（workspace-frame.tsx）都只消费
  `boundSessions.data`：`undefined`（加载中或错误）与 `[]`（确认空）渲染结果相同，
  effect 中 `if (!list) return` 对两种情况都静默放弃。
- 全局 QueryClient（app.tsx）配置 `refetchOnWindowFocus: false`、`refetchOnReconnect: false`，
  error 态查询没有自动恢复路径；目前唯一可靠的恢复入口是 message-timeline 发送消息后
  `invalidateQueries(["novel", "bound-sessions"])`，这正是用户"发一条消息后列表才恢复"的原因。
- i18n locale 文件保持不动；书内面板已有内联中文文案 + `refetch` 重试按钮的先例
  （panel-ai-artifacts.tsx），本变更沿用该模式。

## Goals / Non-Goals

**Goals:**

- 切换器三态渲染（加载 / 失败 / 空），错误可见且可恢复。
- 查询失败自愈：查询级有限重试 + 手动重试入口。
- 自动回跳在查询失败时不误判为零会话、不落入懒创建空态。

**Non-Goals:**

- 不改服务端 API 与 novel-live 失效广播的整体架构。
- 不为 `session.list` 默认 50 条上限设计滚动加载。
- 不改变自动回跳的产品语义。

## Decisions

1. **三态判定收敛到 sessionSwitcherTrigger 纯函数扩展**
   为 trigger 输入增加必填的列表状态（pending / error / ready）与对应占位文案
   （pendingLabel / errorLabel），输出在 `{label, disabled}` 基础上增加 `showRetry`：
   仅确认空列表才禁用下拉，error 态返回失败占位与重试标记；组件层只消费结果渲染。
   现有测试因输出结构变化本就需要更新，status 无需为兼容旧测试而设缺省。
   选择纯函数而非组件内分支，是与仓库 `bun:test` 纯函数测试约定一致，错误分支
   可被直接验证；备选：组件内直接分支——仓库无组件级测试设施，错误态回归无法
   落地验证，拒绝。

2. **重试用查询级 retry 配置，不用轮询、不改全局默认**
   为 `useBoundNovelSessions` 单独配置有限次数重试（`retry: 2`）与指数退避
   （`retryDelay`）。重试耗尽后保持 error 态，由切换器"重试"按钮调用 `refetch()` 兜底。
   备选：`refetchInterval` 轮询——服务端未就绪窗口通常仅秒级，轮询浪费请求且掩盖错误；
   全局改 QueryClient 默认 retry——影响所有查询，风险不可控，均拒绝。

3. **自动回跳 effect 保持"等待 data"语义，不感知重试细节**
   effect 现有 `if (!list) return` 已天然等待 `undefined`；查询层补上重试后，重试成功
   产生的 `data` 更新会重新触发 effect 完成回跳。effect 无需 error 分支——错误态的
   区分只服务于渲染层。备选：effect 内读取 `boundSessions.error` 做额外判定——与
   渲染层重复，拒绝。

4. **文案沿用 panel-ai-artifacts 的内联中文先例**
   加载态显示"加载中"占位；失败态显示"会话列表加载失败" + "重试"按钮，不新增
   i18n key，不改动 locale 文件。

## Risks / Trade-offs

- [重试放大启动期服务端压力] → 有限 2 次重试 + 退避；耗尽后不自动轮询。
- [error 态期间"+"新建仍可用，用户可能建出看似多余的新会话] → 保留现状：新建是
  显式动作，本就不依赖列表；失败占位同时提示可先重试。
- [重试成功与旧缓存竞争] → 重试即 `refetch`，成功后以最新结果为准；`staleTime`
  只影响挂载策略，不影响重试路径。
- [若运行时证实存在"成功但瞬时为空"的服务端响应] → 当前重试只覆盖 error 路径，
  空结果仍按零会话呈现；此时需另立 follow-up（如按书记忆感知的一次性重拉），
  不在本提案范围内臆测实现。

## Migration Plan

纯前端行为修复，无数据迁移与协议变更。合入后随常规版本发布；如需回滚，还原对应
提交即可。
