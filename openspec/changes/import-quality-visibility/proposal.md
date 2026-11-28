# Proposal

## Why

导入整理队列的汇总汇报只在会话文本里呈现：纠错修订提案计数、设定候选待审数、技法清单、分章异常都是纯文字，用户难以找到实际待审入口，感觉「整理了但什么都没发生」（Issue #32）。工作台设定树已有三类待审徽标（整理收件箱 / 清理修订）与技法库入口，但书架一层的待审可见性为零——用户离开工作台后没有任何提醒。

## What Changes

- **书级待审聚合端点**：新增 `GET /api/novel/pending-summary`，按 directory 一次聚合全书两源待审数（设定审阅收件箱 pending、章节清理修订 pending），group by novel_id，书架一次请求拿到全部书的徽标数据。
- **书架待审角标**：书架卡片显示待审总数徽标（>0 时显示）；点击角标预写该书工作台存档的设定树节点（清理修订待审 >0 直达「清理修订」，否则直达「整理」收件箱）并进入工作台，恢复链路自动选中目标面板。
- **汇总指引升级**：director 汇总汇报单元的提示文本明确指引待审入口（设定树节点名与书架角标），与实数统计并列输出。

**非目标**：

- 不做会话消息内嵌可点击跳转（侵入会话渲染，收益不成比例；入口可达性由书架角标与设定树徽标承载）。
- 不改汇总汇报的统计口径与输出形态（实数统计已在 chapter-cleanup-review 落地）。
- 不新增技法库的独立待审语义（技法为 unverified 列表，沿用技法库既有入口，不做角标）。

## Capabilities

### New Capabilities

- `import-quality-visibility`: 书级待审聚合查询与书架待审角标能力——按 directory 一次聚合全书审阅收件箱与清理修订待审数，书架卡片展示角标并直达对应审阅面板。

### Modified Capabilities

- `book-import-pipeline`: 汇总汇报在实数统计之外 SHALL 明确提示待审入口位置（设定树节点与书架角标）。

## Impact

- `packages/schema`：待审聚合结果 schema。
- `packages/protocol` / `packages/server`：`novel.pending-summary` 端点与 handler（novel-store 复用既有查询助手按 novel_id 聚合）；新端点同 PR 注册 httpapi-exercise 场景。
- `packages/client`：`bun run generate` 再生成 SDK，同步 codemode fixture。
- `packages/app`：书架卡片角标（usePendingSummary 查询 + per-book 存档预写导航）；文案进既有 locale 体系。
- `packages/plugin`：director 汇总指引文本更新。
- 数据兼容性：纯新增端点与查询，不动既有表；旧版本程序无感。
