# Tasks: agent-memory-system

> 依据 design.md §8 实施顺序拆波；app 记忆界面（§8 第 10 项）按 design 裁定拆独立后续 change，不在本 change 内。
> 协同前提已落地：agent-task-subagent（2026-10-22）、agent-instruction-layering（2026-10-23）、v1-retirement-roadmap（2026-10-23，V1 已全线退役）——所有挂钩直接落 V2 宿主。

## Wave 1 — 数据层（novel-store）

- [x] 1.1 `memory_fact` 表（design §2.1 字段全集：novel_id/chapter_id/fact_type/quote/quote_span/entity_hint/text/status/confidence/proof_count/created_by/时间戳）+ 迁移脚本
- [x] 1.2 `memory_fact_fts` FTS5 虚表（text 列）+ 触发器同步
- [x] 1.3 `world_entries` / `characters` 加 `establishment`（planned|established）+ `established_chapter_id?` 列（伏笔表不加，已有埋设/回收语义）
- [x] 1.4 `techniques` 扩展列：`usage_ledger` JSON（饱和度账本）、`promoted_from`（晋升留痕）；`novel_id` 列先以现存数据核对 `scope` 语义（general vs 本书）后定夺
- [x] 1.5 novel-store 单测：表结构、FTS 同步、迁移幂等

## Wave 2 — 出处扩展

- [x] 2.1 `StateDeltaEntry` 增加可选出处字段 `data.quote` / `data.quote_span`（Zod 向后兼容，state-commit.ts:83-88）
- [x] 2.2 observer 系统提示词（agents/observer.ts）要求 WARN/FAIL 级事实携带引句
- [x] 2.3 单测：无出处旧 delta 照常解码；带出处新 delta 保留字段

## Wave 3 — commitState 落库分支

- [x] 3.1 timeline delta 落 `memory_fact`（status=pending，created_by=observer），删除 state-commit.ts:1012-1016 的日志-only 分支
- [x] 3.2 importance=1 的非实体长尾（无实体归宿的 fact_type）落 `memory_fact`
- [x] 3.3 单测：timeline/长尾落库、实体事实仍走既有表不重复存储

## Wave 4 — 注入召回组装器

- [x] 4.1 五件套组装器（design §5.1：出场角色卡 / 活跃伏笔 / 相邻章新事实 / 当前卷 planned 设定 / 本书技巧卡含账本）
- [x] 4.2 权重三信号排序（引用频次 + 近因 + 确认级别）+ 体量预算截断（目标 <4K tokens）
- [x] 4.3 `memory_injection_snapshot` 物化表 + 确定性重建（同一输入必得同一注入包）
- [x] 4.4 单测：五件套组装、预算截断、确定性重建

## Wave 5 — librarian 检索召回

- [x] 5.1 `memory_search(query, filters?)`（第 4 个 lookup 工具）：FTS5 全文 + 结构化过滤（实体/类型/状态/章节范围），落点 archive.ts
- [x] 5.2 `memory_lookup(entityID)`（第 5 个）：实体全史
- [x] 5.3 起草纪律写入 system prompt（"先查记忆再动笔"；注入召回包与工具检索分工）
- [x] 5.4 单测：检索过滤、实体全史、记录限制可配

## Wave 6 — 生命周期流水线挂钩

- [x] 6.1 审计校准挂 reviewed 流转（auditor 证据链即 reviewed 生产者）
- [x] 6.2 章审批通过事件触发注入包预计算重建
- [x] 6.3 文本变更事件（状态提交、编辑器保存）触发 diff 范围失效：quote_span 命中 → stale；设定被删 → retired（留痕不删行）
- [x] 6.4 单测：状态机流转、diff 命中/未命中、retired 留痕

## Wave 7 — 冲突裁决

- [x] 7.1 冲突单复用/扩展 `WorldEntryConflictTable`：双方卡片 + 两方向影响成本对比（顺正文改设定动 N 张卡 / 逆设定改正文受影响章节清单）
- [x] 7.2 对接既有审批闸门：裁决 A 更新本体并流转状态机；裁决 B 生成回改任务清单
- [x] 7.3 单测：冲突单生成、两方向裁决后果

## Wave 8 — 技巧层扩展

- [x] 8.1 饱和度账本：`usage_ledger` 记录近期按卷/章使用分布，注入时输出（"断章悬念卷二已用 11/14 章"）
- [x] 8.2 作者确认转正门槛：`status` 从 `unverified` 流转需作者显式确认
- [x] 8.3 晋升/固化通道：技巧经验 → 分层规范文件（agent-instruction-layering 领地）后 retired + `promoted_from` 留痕
- [x] 8.4 单测：账本更新、转正门槛、晋升留痕

## Wave 9 — 整理与维护

- [x] 9.1 事件驱动整理：章审批通过时本章相关卡去重/同义合并（自动可撤销）
- [x] 9.2 阈值触发：注入组装超预算时低权重卡出包
- [x] 9.3 定时兜底 job：僵尸卡清扫 + planned 滞留提醒 + retired 归档统计（报告制，不自动删）
- [x] 9.4 单测：三触发路径

## Wave 10 — 守门

- [x] 10.1 `packages/novel-store`、`packages/plugin`、`packages/core`、`packages/opennovel` `bun typecheck` 绿
- [x] 10.2 相关包测试全绿；`bun run test:httpapi` 绿；根目录 oxlint 0 errors

## Implementation Commits

- `cba33d8eb8` feat(novel-store): 记忆系统数据层（memory_fact/注入快照/落文状态/技巧扩展列）
- `fb1f8a36c6` feat(plugin): StateDelta 出处字段扩展（quote/quote_span）
- `9e21f6d91c` feat(plugin): timeline delta 落 memory_fact（替换日志-only 分支）
- `707d0cd679` feat(plugin): 记忆注入召回组装器（五件套 + 权重三信号 + 物化快照）
- `d663560714` feat(plugin): librarian 检索召回扩展（memory_search / memory_lookup）
- `8fbdb19d56` feat(novel-store): 记忆生命周期挂钩（审计校准/审批预计算/文本失效/设定删除留痕）
- `6dc4658ea4` feat(novel-store): 冲突裁决单扩展（两方向成本对比 + 裁决 A/B 状态机联动）
- `4990cb62d6` feat(plugin): 技巧层扩展（饱和度账本/作者确认转正门槛/晋升固化通道）
- `3356e4f8b4` feat(novel-store): 记忆整理与维护（审批去重合并/僵尸卡与滞留巡检报告）

## 实施记录（与 design/tasks 字面表述的偏差裁定）

- **FTS 同步为应用级**（1.2 写"触发器同步"）：`memory_fact_fts` 由写入方应用级同步，同 `chapter_summary_fts` 既有惯例；DDL 保留一条回填式 INSERT 供建库时初始化。
- **planned 设定召回为全书口径**（4.1 写"当前卷"）：planned 语义是"未落文"，与卷无关，注入时全书 planned 皆入包。
- **账本注入汇总为卷级口径**（8.1）：`卷N已用 X/Y 章` 优先（目标章所属卷内有使用记录时），回退近 14 章窗口，再回退历史累计；无卷书稿直接用窗口口径。
- **memory_search 只查 memory_fact**（5.1）：章节摘要级检索归既有 recall_history，FTS 检索面不重复。
- **组装器/生命周期/冲突成本下沉 novel-store**：审批（server）与工具（plugin）双路径共同可达，存储层是双方唯一共同依赖；plugin 一律经 session-store shim 引用。
- **promoted_from 口径**：退休技法行上记录固化落点路径（`.novel/instructions/<layer>.md`），非反向指针。
- **裁决 B 回改任务落 pending_updates**（7.2）：trigger_type="world_entry_conflict"，写作门禁自然消化，不新建任务表。
- **opposing_fact_id 暂留空**：recordConflict 触发点无对应 memory_fact 可指，列已备，待审计路径产冲突单时填充。
- **技巧 retired 自动出注入候选**：组装器只取 verified，无需额外过滤。
- **9.2 阈值触发已由 Wave 4 覆盖**：`pickWithinBudget` 超预算时按权重三信号截断低分卡，即 design §6"针对性瘦身（低权重卡出包）"，不重复实现。
- **9.1 合并口径**：只并剔除全部空白后文本相同的卡（中文稿空白无语义），保留卡按确认级别 → 创建时间 → id 确定性决胜；语义级同义合并需模型判断，不在自动路径。`retired_into` 留痕支持撤销。
- **9.3 落地形态**：仓库无周期调度基础设施（plugin 纯事件驱动），定时兜底落为 librarian `memory_maintenance` 按需巡检工具（报告制，不自动删）+ 章审批事件顺带整理；planned 滞留阈值口径 = 设定创建后新增章数 ≥10。
- **Wave 10 守门偏差**：core typecheck 唯一红为 packages/http-recorder `Headers.entries` 既有红（main 同红，已对照验证，与本 change 零文件交集）；opennovel 套件 workspace-adapter 硬失败与 httpapi-instance-context 5s 超时 flake 均既有（main 对照 1/3 复现超时，归属成立）。

## Workflow follow-up

（归档后如有回归修复在此补充）
