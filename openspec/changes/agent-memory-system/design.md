# Design: agent-memory-system

> 本设计经六轮讨论收敛（2026-10-20 五轮：存储形态、生命周期、来源扩展、冲突裁决、召回与整理；2026-10-21 第六轮：与既有 observer→reflector→state-commit 管线对齐）。外部参照：OpenHands 双层记忆模式、vectorize-io/hindsight（只吸收设计，不引入实现）。

## 0. 与既有状态管线的对齐（第六轮修订核心）

fork 已有一条完整的正文事实沉淀链路，本设计**复用它而不是平行新造**：

```
起草(第3步) → 状态提取(第6步, observer) → 校验(reflector) → 落库(commitState)
                                                │
              10 种 fact_type：character / relationship / plot_thread / foreshadow /
              world_entry / chapter_summary / style / timeline / location / tension
              （state-commit.ts:60-70）
                                                │
              importance 分流（state-commit.ts:455-460）：
                0   → 丢弃（仅日志）
                1   → 候选区 PendingSettingTable（status: pending，novel-store/src/index.ts:389）
                2-3 → 正式物化表（characters / relationships / world_entries / …）
```

三条对齐结论：

1. **正文事实的登记路径 = 既有链路**，不新增起草期 `memory_register` 工具。状态机起点从「起草登记」改为「状态提取」（流水线第 6 步），章审批前的登记事实照常"当章生效、下一章降权注入"——时机语义不变，登记主体从 writer 自登记改为 observer 统一提取。
2. **`memory_fact` 是既有管线的补全层，不是平行事实表**：只承接**无实体归宿的 delta**——`timeline` 类型现状"仅记录日志，不更新物化视图"（state-commit.ts:995-996，十类中唯一无表归宿）、importance=1 但非实体形态的长尾事实、作者手记（UI 通道，`created_by: author`）。实体事实（角色/关系/世界观/伏笔）的归宿仍是既有表（唯一本体），溯源靠候选区已有的 `source_chapter_id` 与既有表加列（§2.3）。
3. **技巧层复用既有 `techniques` / `technique_feedback` / `technique_shadow_log` 三表**（novel-store/src/index.ts:725-770，auditor shadow-mode 反馈已是其写入方）：instruction/principle、evidence、confidence、status、scope、usage_count + last_used_at（账本雏形）均已存在，本设计只做扩展（§2.2），不建平行技巧卡表。

**出处扩展**：`StateDeltaEntry`（fact_type/action/entity_id/data，state-commit.ts:83-88）增加可选出处字段（如 `data.quote` / `data.quote_span`，Zod schema 向后兼容）；observer 提示词同步要求对 WARN/FAIL 级事实携带引句。出处强制原则对自由事实卡生效；实体事实以 `source_chapter_id` + 加列溯源。

## 1. 总体架构

```
                +-------------------------------------------+
                |  注入召回包（物化视图，章通过时预计算）      |
                |  起草时 = 一次数据库读                      |
                +---------------------^---------------------+
                                      | 组装器
                +---------------------+---------------------+
                |     横切状态层: pending -> reviewed ->     |
                |     approved -> stale -> retired          |
                +--------+-----------+-------------+--------+
                         |           |             |
              +----------+--+ +------+------+ +-----+--------+
              | 自由事实表   | | 设定引用     | | 技巧层        |
              | memory_fact | | (既有表+    | | (既有三表     |
              | (delta 补全 | |  落文状态)   | |  +扩展列)     |
              |  层,新增)   | |             | |              |
              +----------+--+ +------+------+ +-----+--------+
                         |           |             |
              +----------v-----------v-------------v--------+
              |  既有本体：角色 / 关系 / 世界观 / 伏笔 / 张力   |
              |  （不动，唯一本体）+ 候选区 + FTS5 检索        |
              +----------------------------------------------+
                    SQLite 单库，无向量库、无外部服务
```

核心不变量：

- **单一数据世界**：一切记忆都在 novel-store 的 SQLite。文件不是存储本体（导出快照是旁路功能，远期）。
- **既有本体不动**：角色/关系/世界观/伏笔/张力表是各自事实的唯一本体；`memory_fact` 只收无实体归宿的 delta，永不重复存实体事实。
- **出处强制**：自由事实卡无出处不存在（章号 + 原文引句）；实体事实以 `source_chapter_id`（候选区已有）+ 落文状态列溯源；技巧以评审事件链溯源。
- **本书硬隔离**：所有新增记忆结构带 `novel_id`（对齐 novel-store 既有命名），注入/检索第一道过滤永远是 `WHERE novel_id = ?`。跨书共享在数据层不可能，不靠 agent 自觉。

## 2. 数据模型（novel-store 新增/扩展）

### 2.1 自由事实表 `memory_fact`（新增，delta 补全层）

```
id              PK
novel_id        FK -> novels        -- 硬隔离（对齐既有 novel_id 命名）
chapter_id      FK -> chapters      -- 出处章（observer 提取来源）
fact_type       TEXT                -- 复用 StateDelta FactType（state-commit.ts:72），主要为 timeline
quote           TEXT?               -- 原文引句（逐字，校准锚点；StateDelta 出处字段扩展）
quote_span      TEXT?               -- 引句定位（偏移区间）
entity_hint     TEXT?               -- 关联实体提示（可空，后续合并升级用）
text            TEXT                -- 结构化事实陈述（保留原文语态，不改写归一）
status          TEXT                -- pending | reviewed | approved | stale | retired
confidence      INTEGER             -- 0-100；来源分级：作者裁决 > 审计校准 > observer 登记
proof_count     INTEGER DEFAULT 1   -- 独立支撑章数（吸收 Hindsight observations）
created_by      TEXT                -- observer | author（UI 手记）
created_at / updated_at
```

- 写入方只有两个：`commitState` 对 timeline/长尾 delta 的落库分支（主路）、记忆界面的作者手记（旁路）。**没有第三条路**——起草期不登记。
- FTS5 虚表 `memory_fact_fts`（text 列），触发器同步。
- `timeline` 从"仅记日志"升级为有表归宿；落地后删除 `report` 里的 timeline 日志-only 分支（state-commit.ts:995-998）。

### 2.2 技巧层（复用既有三表 + 扩展）

既有：`techniques`（name/principle/instruction/scene_types/level/evidence/common_misuse/confidence/status/scope/embedding/usage_count/last_used_at）、`technique_feedback`（auditor shadow-mode 逐章评分）、`technique_shadow_log`（检索命中日志）。扩展列：

- `techniques.usage_ledger` JSON——饱和度账本细化（近期按卷/章的使用分布；`usage_count`+`last_used_at` 只有总量，防口口癖需要分布）
- `techniques.promoted_from` FK?——晋升来源留痕链（retired 不删行）
- `techniques.novel_id`?——书级技巧与通用库的分域明确化（现 scope 列语义含混：`general` vs 本书，需在实施时以数据核对后定列；见 tasks）
- 作者确认转正门槛：`status` 从 `unverified` 流转需作者显式确认（对齐横切状态机 `approved` 语义，映射关系在实施时落任务）

> 既有 `embedding` 列是预留位：本变更不启用向量检索（FTS5 + 结构化过滤先行验证够不够），列保留不动。

### 2.3 既有表加列

- 世界观/角色条目：`establishment` 列（`planned | established`）+ `established_chapter_id?`——设定落文状态。伏笔表已有埋设/回收语义，不加列。

### 2.4 物化注入包 `memory_injection_snapshot`（新增）

```
novel_id + chapter_id   联合键（为"下一章"预计算）
payload                 JSON    -- 五件套序列化结果
built_at / budget_used  元数据
```

章审批通过事件触发重建；起草开始时一次读。同一输入必得同一注入包（可测试、确定性）。

## 3. 生命周期状态机

```
状态提取(observer,第6步)   审计校准(auditor)      章审批(既有闸门)       文本变更(diff命中引句)
[候选区/内存fact pending] --> [reviewed] --------> [approved] --+------> [stale] --> 重新提取+校准
 当章生效，        出处核实，           事实正式确立  |                        |
 下一章降权注入    冲突已裁决                        |                        v
                                                 未命中引句          [reviewed] 或
                                                 保持 approved       [retired]（设定被删，留痕）
```

- **pending ≈ 既有候选区**：importance=1 的实体 delta 走 `PendingSettingTable`（不新造起点）；自由事实 delta 走 `memory_fact`（status=pending）。两者共用同一审批闸门语义。
- **审计校准的执行者 = auditor**（38 维审计的证据链即 `reviewed` 状态的生产者）。
- **pending 的空窗风险**（提取未审计就出错）由"下一章注入时 pending 卡降权"兜底。
- **触发器挂文本变更事件**（章节状态提交、编辑器保存），agent 修订与作者手改两条路自动汇合——不挂 agent 流程步骤，否则手改静默过期。
- **diff 范围失效**：正文修改时，diff 与 `quote_span` 比对，只失效命中的卡；改正别字不惊动全书记忆，避免修订循环的状态抖动。
- **retired 不删行**：同"角色只能退场不能删除"哲学。

## 4. 冲突处理

新事实与既有卡矛盾（含设定引用与正文事实矛盾）时：

1. 不自动裁决。生成冲突单：双方卡片 + 两方向影响成本对比
   - 方向 A（顺正文改设定/旧记忆）：动 N 张卡
   - 方向 B（逆设定改正文）：受影响章节清单
2. 走现有审批闸门，作者裁决。
3. 裁决 A：更新本体/记忆，状态机自动流转。
4. 裁决 B：生成回改任务清单（引用关系可查询——结构化存储的核心红利）。

既有衔接：设定间冲突标注已存在 `WorldEntryConflictTable`（state-commit.ts:179 起，"不污染 WorldEntryTable.content"）——冲突单优先复用/扩展它，不另起炉灶。

原则：**已写正文 > 设定**（读者只见正文）。系统摆成本，作者定方向。

## 5. 召回

### 5.1 注入召回（被动，五件套）

| 序 | 内容 | 数据来源 | 说明 |
| --- | --- | --- | --- |
| 1 | 本章出场角色卡 | 活跃角色快照（既有） | 复用现有"已出场/活跃"概念 |
| 2 | 活跃伏笔卡 | 伏笔表 | 已埋设未回收 |
| 3 | 相邻章新事实 | `memory_fact` + 既有表 `establishment` 列 | 前 2-3 章的 approved 卡 / 新落文设定 |
| 4 | 当前卷 planned 设定 | 既有设定表 | 提示可用弹药 |
| 5 | 本书技巧卡 | `techniques`（含 feedback 聚合） | 含饱和度账本（"断章悬念卷二已用 11/14 章"） |

体量预算（目标 <4K tokens）内按权重三信号（引用频次 + 近因 + 确认级别）排序截断。审校子代理同样吃技巧卡（审"是否遵守已验证经验"）。

### 5.2 检索召回（主动）= librarian 工具族扩展

librarian 已有三个查询工具（`lookup_dormant_characters` / `lookup_closed_threads` / `lookup_past_volumes`，`agents/librarian.ts`，底层 archive.ts）——检索召回**扩展这个工具族**，不建平行检索面：

- `memory_search(query, filters?)`（第 4 个 lookup 工具）：FTS5 全文（`memory_fact_fts` + 既有 FTS 虚表）+ 结构化过滤（实体/类型/状态/章节范围）
- `memory_lookup(entityID)`（第 5 个）：实体全史（"银瞳症在哪几章出现过"）

- 检索入口保持 librarian 单一通道（director 调度），3 条记录限制按工具放宽为可配参数；writer/auditor 不直接持检索工具，需要时经 pipeline 注入——保持子代理上下文最小化。
- 多语言原则：`text` 与 `quote` 保留原文语态，禁止翻译/改写归一（吸收 Hindsight multilingual 的动机；中文语料天然成立，写入约束防未来漂移）。

## 6. 整理与合并

| 触发 | 时机 | 动作 | 风险级别 |
| --- | --- | --- | --- |
| 事件驱动（主） | 章审批通过时 | 本章相关卡去重、同义合并、账本更新 | 自动 + 可撤销 |
| 阈值触发 | 注入组装超预算 | 针对性瘦身（低权重卡出包） | 自动 + 可撤销 |
| 定时兜底 | 后台 job | 僵尸卡清扫、planned 滞留提醒、retired 归档统计 | 报告制，不自动删 |

合并升级三通道（全部单向、过审批、原卡 retired 留痕）：

1. 自由事实碎片（`memory_fact`）-> 正式实体条目（角色/世界观表，走既有候选区批准流程）
2. 计划设定 -> 落文正文事实（establishment 流转）
3. 技巧经验 -> 分层规范文件（agent-instruction-layering 领地），技巧层随之 retired（`promoted_from` 留痕）

记忆系统定位：**从 agent 学到的流动知识，向作者确认的固化知识的上升管道**。

## 7. 与其他 change 的协同边界

- **agent-instruction-layering**：规范（作者写的、稳定、分层文件）与记忆（增长的、agent 沉淀）注入通道独立，互不吞并；技巧固化的落点在对方。
- **agent-task-subagent**：审校子代理的干净上下文 = 设定集 + 目标章节 + 技巧卡；审校产出的评审事件是技巧层的上游来源；librarian 是记忆检索的现成调度通道。
- **38 维审计**：本变更不改审计维度；审计是记忆校准的执行者之一（reviewed 状态的生产者）。
- **v1-retirement-roadmap**：本变更的工具注册与流水线挂钩在哪个运行时落地，遵循路线图的迁移排序，不双轨新增 V1 功能。
- 文风统计基线：语料现算的 computed metric，存书级元数据，**不进记忆**（记卡必漂移）。

## 8. 迁移与实施顺序（tasks 阶段细化）

1. `StateDeltaEntry` 出处字段扩展（Zod 向后兼容）+ observer 提示词引句要求
2. novel-store：`memory_fact` 表 + 既有表加列 + `techniques` 扩展列 + FTS5 虚表 + 迁移脚本
3. `commitState` 落库分支扩展：timeline/长尾入 `memory_fact`（替换日志-only）
4. 组装器 + 物化注入包（先只做五件套，预算截断）
5. librarian 工具族扩展：`memory_search` / `memory_lookup`（archive.ts 落点）+ system prompt 起草纪律
6. 流水线挂钩：审计校准、审批预计算、文本变更事件失效
7. 冲突裁决单（复用/扩展 `WorldEntryConflictTable`）+ 审批闸门对接
8. 技巧层扩展列 + 账本 + 晋升/固化通道
9. 整理 job + 滞留提醒
10. app 记忆查看/编辑/手记界面（可拆独立后续 change）
