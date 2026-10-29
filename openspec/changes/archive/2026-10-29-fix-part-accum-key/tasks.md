# Tasks

## 1. 键计算与读取端（session-ui）

- [x] 1.1 在 `packages/session-ui/src/components/message-part-text.ts` 新增导出 `partAccumKey(messageID, partID)`（返回 `` `${messageID}:${partID}` ``），注释说明「part ID 不保证跨消息唯一，桶与基线表一律用复合键」；从包目录 `bun typecheck` 验证
- [x] 1.2 扩展 `packages/session-ui/src/components/message-part-text.ts` 的 `readPartText`：part 入参要求 `messageID`，桶索引改用 `partAccumKey(part.messageID, part.id)`（无命中回退 `part.text` 行为不变）；更新 `message-part.test.ts` 既有断言并新增「同 id 不同 messageID 互不命中」用例，`bunx bun@1.3.14 test src/components/message-part.test.ts`（session-ui 目录）通过
- [x] 1.3 更新 `packages/session-ui/src/context/data.tsx` 与 `packages/app/src/context/global-sync/types.ts` 两处 `part_text_accum_delta` 的类型键注释为复合格式（无行为改动），`bun typecheck` 通过

## 2. server-session 写入端切换（packages/app）

- [x] 2.1 delta 追加与基线登记：`message.part.delta` 处理器中 `deltaBases` 读写与 `part_text_accum_delta` 追加改用复合键（server-session.ts:1182-1188）
- [x] 2.2 part 生命周期清理：`message.part.updated`（:1101-1104）、`message.part.removed`（:1147-1148）按复合键删除
- [x] 2.3 消息级清理：`deleteMessageParts`（:217-226）、`replaceParts` 的 preserveDelta 查表与清理扫描（:592-604、:614-625）、乐观确认与回滚（:1313-1321、:1332-1336）改用复合键
- [x] 2.4 会话级清理：`evict` 的 `deltaBases` 遍历（:469-471）保持按值过滤、键改复合；确认删除 `deltaBases` 裸键的所有残余读写（`rg "deltaBases" packages/app/src/context/server-session.ts` 无裸 part.id 键访问），`bun typecheck` 通过

## 3. global-sync 写入端切换（packages/app）

- [x] 3.1 `event-reducer.ts` 四处触点（消息删除 :250、part 更新 :263、part 移除 :289、delta 追加 :317-321）改用复合键
- [x] 3.2 `session-cache.ts` 的 `dropSessionCaches`（:31-32）改用复合键；`child-store.ts` 初始化与 `directory-sync.ts` 字段清单确认无需变更，`bun typecheck` 通过

## 4. 回归测试：同 part ID 隔离与清理不越界

- [x] 4.1 `server-session.test.ts` 新增两组用例：两条消息持同名 part ID 时各自 delta 追加互不串写（含读取端 fallback 断言）；一条消息 part 最终更新后另一条消息同名 part 的桶与基线仍完好；既有按裸键断言更新为复合键；`bunx bun@1.3.14 test src/context/server-session.test.ts`（app 目录，带 happydom preload）通过
- [x] 4.2 `event-reducer.test.ts` 新增同 part ID 两消息 delta 隔离用例并更新既有断言（:166 一带）；`session-cache.test.ts` 更新 `dropSessionCaches` 删除断言为复合键；两个套件从 app 目录跑通

## 5. 质量门

- [x] 5.1 `packages/app` 与 `packages/session-ui` 分别通过 `bun typecheck`；oxlint 全仓 JSON 输出按改动行区间核对无新增告警
- [x] 5.2 相关既有套件无回归：app `bunx bun@1.3.14 test src/context`（happydom preload）、session-ui `bunx bun@1.3.14 test src/components/message-part.test.ts`

## Implementation Commits

- 366af56100 fix(session-ui): 流式增量读取按消息+part 复合键
- c1a38df4b4 fix(app): 流式增量桶与基线表改用消息+part 复合键

## Workflow follow-up

- 归档流程：实现提交（含 `OpenSpec-Change: fix-part-accum-key` footer）→ 收集提交写入本文件 `Implementation Commits` → 单独提交记录更新 → `openspec validate fix-part-accum-key --strict` → 有 delta specs 先同步主 specs → `npx openspec archive --yes` → 合并推送 → 清理分支
- 遗留跟进（另立 change）：流水线/上游为何产出索引式 part ID（`text-0`/`reasoning-0`），评估 part ID 全局唯一化
- 用户侧验收：重启桌面端后在出问题会话（或重跑一次写作流水线）确认同一输出不再重复渲染、正文不被顶掉
