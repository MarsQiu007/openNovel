# 长篇创作 A 阶段：上下文工程与状态可靠性 — 设计文档

日期：2026-08-21
状态：已批准，执行中（2026-08-21 深度审查后修订）
分支：在当前工作树进行（不使用 worktree）

## 背景与目标

openNovel 的 novel-writer 插件已具备 10 个专职 agent、8 步写作流水线、37 维连续性检查、候选区与级联一致性等能力。但在长篇（100 章以上）场景下存在两类会导致质量崩塌的问题：

1. **状态提交不可靠**：若干已确认的确定性 bug 会在反复修订/重试中放大，污染候选区、冲突表与世界观硬约束。
2. **上下文工程不随章数扩展**：写第 N 章时只保留最近 3 章摘要，世界观/关系全量塞入工具返回，且预算系统（`applyBudget`）从未接入生产路径。

本阶段（A）目标是"长篇不崩"：在不引入外部嵌入模型的前提下，让 100-1000 章规模下的上下文始终可控、相关、可追查，并消除已知的状态提交缺陷。后续 B（结构质量）、C（协作体验）阶段另行立项。

## 深度审查发现（2026-08-21 修订）

审查中发现了比初版设计更严重的事实，在此记录：

1. **`applyBudget` 从未在生产代码中调用**，仅 `scale-test.ts` 使用。`assemble_context_snapshot` 工具直接渲染全量 P5 content/volumeList/relationships，writer 收到的上下文没有任何预算保护。这不是"P5 没进预算"，而是整个预算层未接线。
2. **存在两条快照路径，行为不同**：
   - `injectSystemContext`（每次 LLM 请求注入系统提示词）：世界观只渲染标题导览，轻量。
   - `assemble_context_snapshot` 工具（pipeline 步骤2 调用，结果传给 writer）：渲染世界观全文、全部卷、全部关系，无预算。
   - 预算和召回只需接到工具路径；系统注入路径保持轻量。
3. **章节大纲存储在文件系统** `.novel/outlines/chapter-{n}.md`，不在 DB 中。`read_chapter_outline` 工具只读 chapters 表元信息（标题/字数/状态），不读章纲正文。`read_outline` 工具才读 Markdown 原文。召回输入由 `assembleWriterSnapshot` 内部读取该文件。
4. **`scanReferences` 只扫描 character / world_entry / plot_thread 三种实体**，不扫描 foreshadowing。伏笔召回直接走 foreshadowing 表的 planted_chapter_id。
5. **`scanReferences` 对每个实体每 source 只记录首次出现**（indexOf + continue），对召回足够（知道某章引用了某实体即可）。
6. **`world_entries` 表无 importance 字段**，截断排序用"关联实体数 × 时效"。
7. **`plot_threads` 表无章节关联字段**，相关章节通过 entity_refs 召回。
8. **FTS5 trigram 对 3 字以上中文有效**，2 字词（人名如"陆沉"）不命中。2 字词靠 entity_refs 的精确名称匹配兜底（scanReferences 用 indexOf，不依赖分词）。
9. **writer 当前看不到章纲内容**：快照中无章纲字段，pipeline 步骤1 只读元信息。本次将章纲纳入快照，补此缺口。

## 非目标

- 不做叙事弧、角色弧光、卷末复盘等宏观结构能力（B 阶段）。
- 不做段落级人机协作、可视化大纲画布（C 阶段）。
- 不引入向量数据库或嵌入模型。
- 不建立正文 FTS 全文索引（摘要级召回 + 正文 instr 定位已满足本阶段需求）。
- 不改动 V2 Session Core / SystemContext 架构。
- 不改 `injectSystemContext` 的轻量行为（标题导览已足够）。

## 总体方案

分三块：

- **A1 止血**：修复 7 个已确认的确定性 bug。
- **A2 检索召回**：写第 N 章时按本章大纲相关性召回历史，替代"3 章摘要 + 全量世界观"，并把预算层真正接线。
- **A3 查询工具**：新增 `recall_history` 工具，供 writer/observer/auditor 主动深挖。

## A1：止血（确定性修复）

以下问题均有记忆中的代码审查记录，具体行号以实现时为准。

1. **预算层接线（含 P5）**：在 `assemble_context_snapshot` 工具路径调用 `applyBudget`（含新增的 P5/P6 裁剪），而非仅在测试中使用。`injectSystemContext` 路径不变。
2. **`commitStateWithReport` 事务化**：将"写 novel_state_log + resetChapterScopedState + 物化视图更新 + 候选入队 + 冲突标注 + FTS 同步"包进 `db.transaction`，任一步失败整体回滚，杜绝半更新状态与日志膨胀。
3. **重跑 observer 幂等**：`resetChapterScopedState` 当前只清 character_states/chapter_summaries/tension_log，需额外删除同 `source_chapter_id` 的 pending_settings 和 world_entry_conflicts，使修订/重试/重跑不产生重复候选与冲突。
4. **accept 候选不制造重复设定**：world_entry 候选 accept 前按 `novel_id + category + title` 查重，命中则改为 update 或拒绝并提示合并；确认 character 候选 accept 路径走已有的 `resolveCharacterId` 姓名解析，避免主键冲突与重复硬约束。
5. **`merge_pending_settings` 校验 novel_id**：所有被合并候选必须同属一本小说，拒绝跨书合并。
6. **`conflict_kind` 不再硬编码**：提交报告使用 `recordConflict` 实际写入的 conflict_kind，而非固定 `semantic_conflict`。
7. **observer prompt 指令统一**：修正"必须先识别已有实体再区分 create/update"与"不确定优先 create"的矛盾，统一为"先识别已有实体；确实无法归属才 create"。

附带：`list_pending_settings` 增加可选 `source_chapter_id` 过滤参数，使 pipeline 能只列本章新增候选。

## A2：检索召回上下文

### 新分层预算

`assemble_context_snapshot` 工具返回的快照预算从 8K（名义，实际未执行）上调至 12K token：

| 层 | 预算 | 内容 |
|---|---|---|
| P0 蓝图 | 1K | novelTitle / genre / synopsis |
| P1 活跃角色 | 1.5K | 章纲涉及的出场角色（description + 最新 location/mood/summary） |
| P2 近期+卷纲 | 2K | 最近 3 章摘要 + 当前卷摘要 |
| P3 线索+伏笔 | 2K | open 线索 + 未回收伏笔 |
| P4 风格+规则 | 1K | styleGuide + 题材规则 |
| P5 设定硬约束 | 2K | 相关世界观全文 + 无关世界观标题导览 + 相关关系 |
| P6 召回历史 | 2.5K | 按本章大纲相关性召回的历史章节摘要 |
| 章纲 | 含在 P0 区 | chapter-{n}.md 原文（截断到 1.5K） |

### 模块划分

- `context.ts`：保持 `assembleSnapshot` 为原始数据组装器（不裁剪、不召回），新增可选字段 `chapterOutline`。
- 新建 `recall.ts`：导出召回与相关性纯函数（`runRecall`、`selectRelevantWorldEntries`、`searchFts`、`recallByQuery`），可独立测试。
- `budget.ts`：新增 `applyP5Budget`、`applyP6Budget`，在 `applyBudget` 中调用。
- 新函数 `assembleWriterSnapshot(novelId, chapterNumber, directory?)`：读章纲文件 → 调 assembleSnapshot → 调 runRecall → 调 applyBudget，返回裁剪后的 packet。`assemble_context_snapshot` 工具改用此函数。

### 章纲读取

`assembleWriterSnapshot` 内部读取 `.novel/outlines/chapter-{chapterNumber}.md`（directory 即项目根，DB 路径为 `directory/.novel/novel.db`）。文件不存在或为空模板时，降级用"小说 synopsis + open 线索标题 + 活跃角色名"作为召回查询，并标记 `chapterOutline` 为 null。章纲内容（截断 1.5K）纳入快照，让 writer 能看到本章目标。

### P5 相关性裁剪

worldEntries 分两级：

- **核心设定（全文）**：通过以下信号判断与本章相关：
  1. 章纲文本中 indexOf 匹配 world_entry.title（标题长度 >= 2）。
  2. 出场角色的 entity_refs（source_type='character', target_type='world_entry'）引用的设定。
  3. 最近 3 章正文 entity_refs 引用的设定（延续性）。
  合并去重后按关联信号数排序，总量上限 2K，超出截断。
- **设定导览（仅标题）**：其余条目按 category 分组，只渲染 `category: title1、title2…`。模型需全文时调 `recall_history` 或 `check_novel_settings`。

relationships：只保留至少一方为出场角色的关系。
volumeList：只保留当前卷 ± 1 卷。

### 出场角色识别

从章纲 Markdown 中 indexOf 匹配所有 character.name（长度 >= 2），命中者为出场角色。匹配不到时退回现有逻辑（active=1 的前 N 个角色）。P1 只列出场角色而非全部 active 角色。

### P6 三路混合召回

三路召回合并去重，按得分排序取 top 5-8 条 chapter_summaries：

1. **实体重叠（最高权重）**：从章纲提取命中的 character / world_entry / plot_thread ID，查 entity_refs（source_type='chapter', target_type IN 这三类, target_id IN 命中ID），按章节分组统计重叠实体数。得分 = 重叠实体数 × 时效衰减（章节越近分越高）。排除最近 3 章（已在 P2）。
2. **FTS5 短语检索（补充）**：新建 `chapter_summary_fts` 虚表（trigram 分词），用章纲中的关键短语检索。从章纲提取 3-8 字的中文片段作为查询（去掉标点和停用词）。命中章节按 FTS rank 排序。
3. **伏笔强制召回**：章纲中提及的 foreshadow（按 content 关键词匹配或 ID 引用），若其 planted_chapter_id 不在最近 3 章，强制召回埋设章摘要。

每条结果标注 `matchedBy`（'entity' / 'fts' / 'foreshadow'）和 `matchedEntities`，渲染为 `[第12章·实体召回: 陆沉/金丹期]`。

### FTS5 表

在 `novel-store/src/index.ts` 的 `CREATE_TABLES_SQL` 中新增：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chapter_summary_fts USING fts5(
  novel_id UNINDEXED, chapter_id UNINDEXED, chapter_order UNINDEXED,
  title, body, tokenize = 'trigram'
);
```

维护时机：
- `commitStateWithReport` 写入/更新 chapter_summaries 后，在同一事务内 upsert FTS 行（先删后插）。
- `cascade_rebuild_refs` 扩展为同时重建 FTS。
- body = summary + key_events.join(' ')。

技术验证：bun:sqlite 3.53.0 FTS5 trigram 对 3 字以上中文有效；2 字词由实体召回兜底。

### recall_history 工具（A3 预览）

A3 实现工具，A2 的 recall.ts 已包含其核心查询逻辑。

## A3：recall_history 工具

新增工具，供 writer/observer/auditor 使用：

```
recall_history({ query: string, limit?: number, scope?: "summary" | "snippet" })
```

- `query`：自然语言关键词。
- `scope`：`summary`（默认）返回匹配章节摘要；`snippet` 返回正文中匹配位置前后各 200 字。
- 内部：FTS5 检索摘要（query 长度 >= 3 走 FTS MATCH；短词走 entity_refs 名称匹配）+ entity_refs 反查章节。
- `snippet` 模式在 ChapterTable.content 上用 SQL `instr` + substring 定位。
- 无命中返回空数组与提示，不报错。

## 数据流变化

`assemble_context_snapshot` 工具内部改用 `assembleWriterSnapshot`：
1. 读 `.novel/outlines/chapter-{n}.md`。
2. assembleSnapshot 查全量数据。
3. 识别出场角色、相关设定。
4. runRecall 三路召回历史。
5. applyBudget（含 P5/P6）裁剪。
6. 渲染文本（新增"本章大纲""召回历史"段，P5 核心全文 + 标题导览分级）。

pipeline 步骤2 的调用方式不变（工具参数不变），召回在工具内部自动完成。

## 错误处理

- 章纲文件不存在/读取失败：降级查询，不阻断。
- FTS 查询失败（表不存在/损坏）：降级为仅实体重叠，记录 warning 不阻断。
- `recall_history` 无命中：返回空数组。
- 事务回滚后抛出含步骤信息的错误，pipeline 上报。
- FTS 重建幂等，可重复执行。

## 测试

在 `packages/plugin` 目录下运行。

- **budget 单测**：200 世界观 + 50 角色 + 1000 章 mock packet，P5+P6 后总包 ≤ 12K；核心全文、非核心仅标题。
- **recall 单测**：内存 SQLite 构造 entity_refs + chapter_summaries，验证实体重叠打分、伏笔强制召回、三路合并去重、时效衰减、2 字词走实体不走 FTS。
- **FTS5 集成测试**：中文摘要 trigram 写入与查询。
- **state-commit 事务测试**：中途失败验证日志/候选/冲突/FTS 全部回滚。
- **幂等测试**：同章连续 commit 两次，pending_settings / world_entry_conflicts 不翻倍。
- **accept/merge 测试**：同标题世界观候选 accept 走 update 或拒绝；跨 novel_id 合并被拒。
- **scale-test 更新**：P5/P6 纳入 100/500/1000 章断言。
- **assembleWriterSnapshot 集成测试**：有章纲/无章纲两种路径的降级行为。
- **recall_history 工具测试**：summary/snippet 两 scope。

## 明确不做

- 嵌入模型 / 向量检索。
- 叙事弧 / 角色弧光 / 卷末复盘 / 全书主编（B 阶段）。
- 段落级润色 / 作者批注 / 可视化画布（C 阶段）。
- 正文 FTS。
- V2 Session Core 改动。
- injectSystemContext 路径改动。