# Design

## Context

`chapters.order` 是全书阅读顺序定位键：正文写作、章纲、上下文快照、记忆注入、卷级汇总、弧线节拍锚定全部按「第N章」定位。关联审计结论（见 proposal.md - Why）：

- 写入口四处且守卫不一：`generateChapterOutline`（plugin `outline.ts`，直连 `ChapterTable.insert`，调用方传号、只防重不防跳）、`delete_chapter` 工具（约 10 条级联裸删，无事务、不补位）、`moveChapter`（`novel-store/src/index.ts`，up/down 同卷交换无派生同步；to-volume 取目标卷内 max+1 不补位 → 与后卷撞号）、`deleteVolume`（卷号不补位）。
- 删除存在**两条已分叉的路径**：插件工具显式级联 + store 删除；UI 走 `deleteChapterEndpoint`（server `handlers/novel.ts`）直连 store 删除、零级联，行为与工具路径不一致。
- 按号码的派生点位 8 处：`tension_log.chapter_number`、`arc_beats.chapter_order`、`story_spine_entries.chapter_order`、`chapter_summary_fts.chapter_order`、`story_arcs` 起止章号（planned/actual × start/end 四字段）、`segment_summaries.start/end_chapter`、`technique_shadow_log.chapter_number`、`memory_injection_snapshot.payload`（内嵌号码的快照）；另有 `writing_batch` 按号记账的进度态。
- 孤儿旧号隐患：`arc_beats` 与 `story_spine_entries` 的 chapter_id 均为 `ON DELETE SET NULL`——删章后条目保留但旧章号残留，`syncArcProgress` 按 chapter_order 匹配 pending 节拍，会把孤儿节拍锚到平移后占据该号的别章。
- 按 `chapter_id` 关联的表（版本/评审/角色状态/摘要/记忆卡/伏笔/快照等）对重排天然免疫，不处理。
- 既有事务纪律：`withTransaction` 双形态帮手约定（`store-transaction-discipline`），静态守卫扫描手写 BEGIN。
- 既有检测：`checkTimelineContinuity` 的「事件顺序」维度只查缺口、WARN 级。

## Goals / Non-Goals

**Goals:**

- 单一事务原语承载「摘出 → 区间平移 → 落位 → 派生同步 → FTS 维护」，删除/移卷/交换是其三个参数化形态。
- 全部序号写路径收口到 novel-store 帮手，plugin 不再直连 chapters 表写入。
- 检测升维 + 显式修复工具，存量脏库有闭环路径。

**Non-Goals:**

- 不改 schema、不加唯一索引；不做拖拽排序或跨卷任意位置插入；不改 LLM 元文本中的「第N章」字样；不解决跨进程并发写。

## Decisions

### D1：唯一事务原语 `relocateChaptersTx(tx, novelId, plan)`

`plan` 描述「哪些章从旧号搬到新号」：内部统一执行 ① 受影响章 oldOrder 快照（id → order 映射）② 摘出章 order 置临时负值（避免区间重叠双写）③ 摘出点后区间 -1 ④ 落点后区间 +1 ⑤ 落位 ⑥ 派生同步 ⑦ FTS 删插。全程 `tx` 同步语句，任一步失败整体回滚。

- **为什么一个原语**：删除 = 摘出后不插；交换 = 摘出插到邻位；移卷 = 摘出插到目标卷末位。三个写入口共用不变量逻辑，单点实现杜绝「修一处漏两处」。
- **替代方案**：各入口分别实现（必然漂移）；DB 唯一索引（novel-store 规定 schema 只增不改且无迁移服务器，存量脏库建索引直接失败；且索引只防重复不防缺口，放弃了）。
- **双形态**：`relocateChapters` 自包 / `relocateChaptersTx` 组合，遵守仓库事务帮手约定。删除形态的具体承载（级联清单、解锚、调用方收口）由 D4 的统一删除帮手负责，renumber/repair/move 走自包或组合形态。
- **派生同步在同一 tx 内按 id → newOrder 映射执行**：`tension_log` 按旧号集合映射新号平移；`arc_beats` / `story_spine_entries` 按 chapter_id 回写；`story_arcs` 起止章号四字段平移；`technique_shadow_log` 平移；`segment_summaries` 与受影响区间相交的段删除（懒重建）；`memory_injection_snapshot` 受影响章删行（下章审批时走既有 `rebuildNextChapterSnapshot` 重建）；`chapter_summary_fts` 删受影响 novel 行后 INSERT-SELECT 联 chapters 重建；`writing_batch` running → cancelled（见 D5）。删除形态在进入 relocate 前先「解锚」：把 `arc_beats` / `story_spine_entries` 中 chapter_id = 被删章的行的 chapter_order 置空（条目保留，FK SET NULL 前主动清，杜绝孤儿旧号错配）。
- 指标桶（`.novel/evaluate/metrics.jsonl`）条目的可选 chapter 字段是旁路观测数据，不参与同步：旧条目按章过滤精度轻微受影响，接受。
- 区间平移是两条 ranged UPDATE（语句数 O(1)，非逐行），内存中维护 id → newOrder 映射供派生同步。

### D2：移卷 = 落到目标卷阅读末位，未分组 = 只摘标签

落点沿用现状公式「目标卷末章 + 1」，新增的是补位重排：原位置 -1、落点 +1 全在同一 tx。目标卷为空 → 落点 = 前一卷末章 + 1（前无卷则为 1）。移到「未分组」不调用 relocate，仅更新 `volume_id`。

- **替代方案**：A2 保号移卷（已被用户否决：卷列表里出现异号章，「看21章位置看到的是第5章」）；目标卷首插入（同样需要全书重排，且「追加到卷末」符合下拉选卷的心智，首插留给将来的拖拽排序）。

### D3：跳号拒绝下沉 novel-store 插入路径

`generateChapterOutline` 的「按号查重 → 复用或插入」整段下沉为 novel-store 帮手（自包 + 组合双形态），事务内执行：N>1 时查 N-1 存在性（不存在则拒绝），按 `(novel_id, order)` 判重复（重复则复用更新）。plugin `outline.ts` 不再直连 `ChapterTable`，工具层把拒绝翻译成用户可读消息（报缺失的章号与先补前置章的指引）。N-1 存在即可，不要求与 N 同卷（跨卷连续号合法）。

### D4：统一删除帮手，`delete_chapter` 工具与 `deleteChapterEndpoint` 共用

把 novel-store 的 `deleteChapter` 升级为完整删除帮手（自包 + 组合双形态）：解锚（节拍/主线 chapter_order 置空）→ 级联清理（版本/摘要/评审/角色状态/状态日志/钩子轮值/实体引用/批注×2/伏笔置空/张力按旧号删）→ 摘出补位重排 → 派生同步，全部在一个 `withTransaction` 回调内。插件 `delete_chapter` 工具与 server `deleteChapterEndpoint` 均改接该帮手，消除两条删除路径的级联行为分叉（endpoint 现状零级联的缺陷一并修复）。

### D5：连续性检查升维，保持 WARN

`checkTimelineContinuity` 的「事件顺序」维度内扩展：序号重复（group by order 计数 >1）+ 派生漂移（`tension_log` / `arc_beats` / `story_spine_entries` 联 chapters 比对按号定位与当前号）。状态保持 WARN——存量脏库不应卡死审批流；检出消息附修复指引（调用 `repair_chapter_sequence`）。

### D6：`repair_chapter_sequence` 工具（plugin 工具面）

调用 novel-store 自包形态 relocate：读取当前序，已连续则返回「无需修复」；否则重排 1..N 并输出旧→新映射（正文文本表 + metadata 映射数组）供用户核对。绝不自动执行。

### D7：`deleteVolume` 卷号补位（同 tx）

章全部置 `volume_id = null`（现状保留），后续卷 -1。volumes.order 无任何派生引用（`chapter.volume_id` 按 ID 关联、注入上下文读时联表），自包含。

## Risks / Trade-offs

- 跨进程并发写同一项目库（server + CLI 同开）→ SQLite 文件锁使后写者 BUSY 失败而非静默损坏；relocate 单事务缩短临界区。接受，记录为非目标。
- LLM 元文本（摘要/记忆卡/审计）中的「第N章」字样在重排后轻度过期 → 已知残留；正文受坐标泄漏守卫免疫；摘要体系本有重建路径（upgrade），不机械改写。
- FTS 重建成本 → 只删插受影响 novel 的行，单库规模可控。
- bun / node:sqlite 双运行时事务差异 → 复用既有 `withTransaction`（守卫强制），node-runtime CI 任务覆盖。
- Protocol 兼容：`moveChapterEndpoint` 输入输出契约不变（仅服务端行为修正），无需 SDK 再生成、无 HttpApi 变更。

## Migration Plan

零 schema 变更，随版本发布即生效。存量缺口/重号库不被自动改写，由 continuity 报告 + `repair_chapter_sequence` 显式修复闭环。无回滚需求：自发布起每个写操作都维持新不变量。
