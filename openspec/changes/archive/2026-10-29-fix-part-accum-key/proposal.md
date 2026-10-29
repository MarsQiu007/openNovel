# Proposal

## Why

写作流水线的会话时间线出现「同一段助手输出重复渲染多次、真实正文被顶掉」的严重显示错误（用户实测截图：seq 13/23/33 三条消息的 text 行显示同一段文本）。已定位根因：客户端流式增量桶 `part_text_accum_delta`（以及配套 `deltaBases`）只按裸 `part.id` 索引，而流水线产出的每条助手消息 part ID 都是索引式的（`text-0`/`reasoning-0`，已在活库逐条核实 8 条消息全部冲突），导致跨消息共用同一个桶——任一消息流式时，其他消息的 text/reasoning 行经 `readPartText` 优先读到桶里的别家文本。数据层无脏数据（库中重复文本仅存在一份），纯属前端存储键设计缺陷。

## What Changes

- 客户端流式增量桶（`part_text_accum_delta`）与增量基线表（`deltaBases`）的键从裸 `part.id` 改为 `messageID:partID` 复合键，两个写入层（`packages/app/src/context/server-session.ts` 与 `packages/app/src/context/global-sync/event-reducer.ts`）及其清理路径（part 更新/移除、消息删除、乐观确认、会话逐出、目录切换、缓存丢弃）全部同步切换。
- 读取端 `readPartText`（packages/session-ui）改为用 `part.messageID + part.id` 复合索引桶（`Part` 联合类型各成员已带 `messageID`，无需协议变更）。
- 修复两种症状：流式期间其他消息的 text/reasoning 行「变字」（被流经桶的别家增量覆盖显示）；流结束后残留桶把多条消息的正文永久定格为同一段文本。
- 补单测锁定「两条消息同 part ID 时增量互不串写」与「一条消息的清理不影响另一条消息的桶」两个回归形状。

## Capabilities

### New Capabilities

- `session-part-text-accum`: 会话时间线客户端流式文本增量的作用域与生命周期——增量桶必须按（所属消息, part）复合身份隔离，任何消息的增量写入、清理、逐出都不得影响其他消息的增量状态；无增量命中时回退显示 part 自带文本。

### Modified Capabilities

（无——现有 specs 未覆盖该能力。）

## Impact

- **packages/app**：`src/context/server-session.ts`（deltaBases 表 + 约 10 处桶读写/清理触点）、`src/context/global-sync/event-reducer.ts`（4 处触点）、`src/context/global-sync/session-cache.ts`（三处均从 `@opennovel-ai/session-ui/message-part-text` 导入键计算函数）、`src/context/global-sync/types.ts`（键注释）、`src/context/global-sync/child-store.ts` 与 `src/context/directory-sync.ts`（确认无需变更），相应测试文件（`server-session.test.ts`、`event-reducer.test.ts`、`session-cache.test.ts`）。
- **packages/session-ui**：`src/components/message-part-text.ts`（新增导出 `partAccumKey`，readPartText 复合索引）、`src/context/data.tsx`（store 类型声明的键注释）、`src/components/message-part.tsx`（两处读取调用不变，仍传整个 part）。
- **兼容性**：桶与基线表均为内存态（SolidJS store），不落盘、不入 SQLite、无持久化格式，切换键无数据迁移；协议、服务端、数据库均不改动。
- **不涉及**：novel-store / plugin / opennovel / desktop / schema / protocol / TUI。
