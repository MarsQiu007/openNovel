# Design

## Context

见 proposal.md。已核实的现状要点（行号为 2026-10-28 工作树）：

- **写入端两份、桶只有一个**：`part_text_accum_delta` 是 SolidJS store 里的扁平 `Record<string, string>`，键为裸 `part.id`。两个事件写入层都往里追加：
  - `packages/app/src/context/server-session.ts`（v2 活跃 store）：delta 追加 :1184-1188、`deltaBases` 基线表 :216（同为裸 part.id）、part 更新/移除清理 :1101-1104 / :1147-1148、`replaceParts` 的 preserveDelta 保护 :592-604 与清理扫描 :614-625、乐观确认/回滚清理 :1313-1321 / :1332-1336、`deleteMessageParts` :217-226、会话逐出 :469-471。
  - `packages/app/src/context/global-sync/event-reducer.ts`：delta 追加 :317-321、part 更新/移除/消息删除清理 :263 / :289 / :250。
- **读取端**：`packages/session-ui/src/components/message-part-text.ts` 的 `readPartText(accum, part)` = `accum?.[part.id] ?? part.text`，被 `message-part.tsx` 的 TextPartDisplay（:1713）与 ReasoningPartDisplay（:1774）调用。
- **数据事实**：活库会话 ses_e7f63d2f2ffeVLpaBZxo3C7Eyp 中 8 条助手消息的 part ID 全部为索引式（`text-0`/`reasoning-0`），跨消息必然冲突；被查文本在库中仅存一份（seq 23）。
- **第二症状面（清理越界）**：`replaceParts` 清理扫描与 preserveDelta 判定同样按裸 part.id 查表——一条消息的刷新会误删另一条消息正在流式的桶/基线；preserveDelta 的 `startsWith` 检查在跨消息冲突时实际比较的是别家文本，保护名存实亡。
- **类型与外围**：store 形状声明在 `packages/app/src/context/global-sync/types.ts:81`、`packages/session-ui/src/context/data.tsx:35`、`global-sync/session-cache.ts:21`（按 part.id 删除，:30 可取到 `part.sessionID`，part 对象本身带 messageID）；`global-sync/child-store.ts:259` 初始化；`directory-sync.ts:20` 的会话字段代理清单只按字段名转发，键格式对它透明。SDK `Part` 联合类型（`packages/sdk/js/src/v2/view-model.ts:295`）每个成员都带 `messageID: string`。

## Goals / Non-Goals

**Goals:**

- 增量桶与基线表的键改为 `messageID:partID` 复合键，跨消息（乃至跨会话）同 ID part 完全隔离。
- 读取端按同一复合索引命中，无命中回退 part 自身文本（行为不变，仅命中范围收窄）。
- 清理路径（part/消息/会话三级生命周期）只触碰自己的复合键。
- 单测锁定「同 part ID 两消息互不串写」与「清理不越界」两个形状。

**Non-Goals:**

- 不改协议/服务端/数据库，不做 part ID 全局唯一化（上游问题另立 change）。
- 不动 `part_text_accum_delta` 的存在性本身、不动 preserveDelta 逻辑语义（只换查表键）。
- 不做持久化迁移（桶与基线均为内存态，无落盘格式）。
- 不改 TUI 渲染（TUI 不经该 store）。

## Decisions

### D1：扁平复合键 `messageID:partID`，不改成嵌套结构

键串取 `` `${messageID}:${partID}` ``。备选 `Record<messageID, Record<partID, string>>` 嵌套——语义等价，但 store 路径从一层变两层，触及所有 `setData("part_text_accum_delta", ...)` 与 produce 清理块的寻址方式，`directory-sync` 代理与类型声明也要跟着改，改动面显著更大；扁平复合键只改键计算，结构不变。`:` 在 JS 对象键与 SolidJS store 路径中无特殊含义（store 字符串路径按字面键处理），安全。

### D2：键计算单一事实源——session-ui 导出，app 导入

`partAccumKey(messageID, partID)`（返回 `` `${messageID}:${partID}` ``）定义在 session-ui 的 `message-part-text.ts`（零依赖纯模块，已有 `./message-part-text` 独立导出路径）并导出；`readPartText` 内部用它索引，app 侧 `server-session.ts`、`event-reducer.ts`、`session-cache.ts` 从 `@opennovel-ai/session-ui/message-part-text` 导入同一函数。依赖方向 app → session-ui 合法，两包不可能各自漂移出第二份键格式。备选「app 本地一份、session-ui 内联一份，靠单测互锁」被否——同一魔法格式写两遍，漂移只有出了 bug 才会被发现。readPartText 签名从 `{ id; text? }` 扩为 `{ messageID: string; id: string; text? }`：全仓仅 `message-part.tsx` 两处调用（传完整 part）与自身单测引用，无需改调用形态。

### D3：`deltaBases` 保留值形状 `{ base, sessionID }`，只换键

会话逐出（`evict`）依赖值里的 `sessionID` 判断归属；换键后逐出仍按值过滤，`deleteMessageParts`/清理块改为按复合键删。不把 sessionID 编进键（消息 ID 已全局唯一，键里冗余会话 ID 只会加大漂移面）。

### D4：preserveDelta 与清理扫描保持逻辑原样，仅换查表键

`replaceParts` 的 preserveDelta 判定、清理扫描、乐观确认/回滚、`deleteMessageParts` 全部维持现有控制流，逐触点把 `part.id` 查表换成 `partAccumKey(part.messageID, part.id)`。修复后 preserveDelta 的 `startsWith` 比较才第一次真正作用于「同一条 part」的 base/accum/fetch 三方。

## Risks / Trade-offs

- [触点多、遗漏一处即造成写入/清理键不一致] → tasks 按「追加 / part 生命周期清理 / 消息级清理 / 会话级清理 / 类型声明」五组分列，组内逐触点勾选；两组单测（串写隔离、清理不越界）在 server-session 与 event-reducer 各自锁定。
- [既有测试按裸键断言，改键后批量失效] → 属预期更新：断言键换成复合键，顺带在测试工厂里让两条消息持有同名 part ID 以覆盖回归形状。
- [readPartText 签名扩展对 session-ui 其他导出消费者的影响] → 全仓只有 message-part.tsx 两处调用与自身单测引用；`data.tsx` 与 `global-sync/types.ts` 两处 store 形状声明的键注释同步说明复合格式。
- [上游 part ID 仍不唯一，未来新写入层可能再犯] → 键计算函数成为单一事实源并在注释说明「part ID 不保证跨消息唯一」；上游唯一化另立 change 跟进。

## Migration Plan

纯内存态键格式切换，随版本发布即生效，无数据迁移；回滚即还原代码。刷新页面后旧键桶自然消失（store 重建）。

## Open Questions

- 流水线为何为每条助手消息生成索引式 part ID（`text-0`/`reasoning-0`）——上游设计问题，不影响本 change 方案与拆解，另行跟进。
