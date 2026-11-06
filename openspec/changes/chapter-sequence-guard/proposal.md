# Proposal

## Why

章节序号（`chapters.order`）是全书级定位键：正文写作、章纲、上下文快照、记忆注入、卷级汇总、弧线节拍锚定全部按「第N章」定位。但序号的四个写入口守卫不一——`generate_chapter_outline` 允许跳号、`delete_chapter` 删后不重排留下永久缺口、UI 移卷取目标卷内 max+1 会与后卷**撞出重复序号**（按号读取静默读错章）、唯一的检测点（连续性检查的「事件顺序」维度）只查缺口不查重复且仅为 WARN。序号一旦漂移，弧线节拍按过期序号锚到错误的章、张力记录与章号脱钩，属于「读错章」级事故。需要工具层硬保证：任何创建/删除/变更之后，序号必须保持唯一且连续。

## What Changes

- novel-store 新增事务原语 `relocateChaptersTx`：摘出 → 区间平移 → 落位 → 派生序号同步 → FTS 重建，全程单事务；按仓库惯例提供自包/组合双形态帮手。
- `delete_chapter` 工具与 UI 删除接口（server `deleteChapterEndpoint`，现状直连 store 且无任何级联清理）统一改走 novel-store 完整删除帮手：单事务内完成级联清理、原位置补位重排、派生同步，并先解除被删章的按号锚定（弧线节拍与故事主线的章序号置空，条目保留），顺带修复两条删除路径行为分叉的既有缺陷。
- UI 移卷语义修正：落点 = 目标卷末章 + 1（沿用现状落点公式），原位置补位、插入点后区间 +1，全书区间事务内重排；每卷序号区间保持连续，第N章永远等于阅读第N位。同卷上下交换纳入同一原语。
- `generate_chapter_outline` 拒绝跳号：生成第 N 章（N>1）时第 N-1 章记录必须已存在，否则拒绝并指引先补前置章；插入/复用判重逻辑下沉 novel-store 并在事务内执行。
- 删除卷后 `volumes.order` 补位重排（章先全部置未分组，卷号 -1）。
- 连续性检查的「事件顺序」维度升维：新增重复序号检测与派生表漂移对账（张力/弧线节拍/故事主线按 chapter_id 联表比对当前序号），检出即报并给出修复指引。
- 新增 `repair_chapter_sequence` 工具：对存量缺号/重号库显式执行重排修复，输出旧→新映射清单；重排动作使进行中的批量写作任务作废并提示重新登记（批量进度是提示态，作废优于半错位）。
- 派生序号同步清单（重排事务内一并处理）：`tension_log.chapter_number` 平移、`arc_beats.chapter_order` 按 chapter_id 回写、`story_spine_entries.chapter_order` 回写、`chapter_summary_fts` 重建、`arcs` 起止章号（planned/actual × start/end 四字段）平移、`segment_summaries` 受影响段删后重建、`technique_shadow_log.chapter_number` 平移、`memory_injection_snapshot` 受影响行失效（下章审批时自然重建）。

## Capabilities

### New Capabilities

- `chapter-sequence`: 章节序号作为全书阅读顺序定位键的全生命周期一致性——创建不跳号、删除/移动后事务内重排补位、派生序号同步、存量修复工具，保证序号在任何变更后唯一且连续、卷区间与阅读顺序一致。

### Modified Capabilities

- `chapter-sequential-gate`: 「规划工作不受拦截」要求澄清为不受**审批状态**门禁影响；章纲生成仍受章节连续性门禁约束（前置章记录须存在），两个门禁的组合关系写明避免误读。
- `multi-chapter-batch`: 明确章节序号重排（删除/移卷/修复）使进行中的批量任务作废并提示重新登记，批量恢复语义与序号一致性协调。

## Impact

- **包**：`novel-store`（事务原语与全部同步逻辑）、`plugin`（delete_chapter 改走删除帮手、outline 跳号门禁、continuity 升维、repair 工具）、`server`（moveChapterEndpoint / deleteChapterEndpoint 改走新帮手）、`app`（无 UI 改动，移卷与删除行为修正自动生效）、`core`（无）。
- **数据模型**：零 schema 变更（不加唯一索引——novel-store 规定 schema 只增不改且无迁移服务器，存量脏库建索引会直接失败；唯一性由事务内重排保证）。全部章节关联按 `chapter_id`（UUID）绑定，重排天然免疫；只有 8 处按号码的派生点位需要同步，已全部列入事务清单。
- **存量本地数据兼容**：已存在缺口/重号的旧库不被自动改写（修复必须显式发起），`repair_chapter_sequence` 输出映射供用户核对。
- **非目标**：不改 `chapters` 表 schema、不加数据库唯一索引；不做拖拽排序或跨卷任意位置插入（移卷只支持「落到目标卷末位」）；不机械改写摘要/记忆卡等 LLM 元文本中的「第N章」字样（已知轻残留，摘要体系本有重建路径）；不解决跨进程并发写同一项目库（SQLite 文件锁保证失败而非静默损坏，记为设计风险）；不动正文坐标泄漏守卫；不新增 UI 交互。
