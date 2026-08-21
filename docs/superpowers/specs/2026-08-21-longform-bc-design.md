# 长篇创作 B/C 阶段：结构质量与协作体验 — 设计文档

日期：2026-08-21
状态：已批准，执行中
分支：在当前工作树进行（不使用 worktree）

## 背景与目标

A 阶段解决“长篇不崩”：上下文预算、历史召回、状态提交事务、候选区幂等和 FTS 等基础已经稳定。B/C 阶段要在这个基础上提升小说质量与作者参与度。

B 阶段目标是“结构不失控”：让作者和 agent 在 100-1000 章写作过程中持续看见主线、角色弧、卷结构和全书风险，而不是只检查章节内连续性。

C 阶段目标是“协作不断线”：作者可以对段落直接批注、请求局部润色，并在可视化大纲画布中重排卷章和结构线；agent 的建议落在可审阅、可解决、可追踪的协作对象上，而不是混入正文或一次性聊天回复。

## 已确认范围

### B：结构质量

1. 叙事弧追踪：维护主线、支线、角色线的开始、转折、高潮、结局节点。
2. 角色弧光追踪：记录角色在关键章节的状态、欲望、误解、抉择和变化。
3. 卷末复盘：在卷完成后生成结构、节奏、角色、线索、伏笔和下卷牵引的复盘报告。
4. 全书主编视角：聚合章节摘要、卷复盘、线索、伏笔、张力和弧节点，指出跨卷结构风险。
5. Agent 接入：architect 管理结构线，auditor/reflector 记录章节结构观察，director 在卷末或风险出现时调度复盘。

### C：协作体验

1. 段落级批注：按章节段落锚定用户或 AI 批注，支持 open/resolved/wontfix。
2. 段落级润色：对指定段落生成替换建议，保存为批注建议，作者可采纳、拒绝或稍后处理。
3. 作者批注工作流：章节阅读页和编辑页可以看到段落锚点、批注列表、状态筛选。
4. 可视化大纲画布：以卷/章卡片和结构线泳道展示大纲；支持移动章节和调整卷归属；画布坐标单独存储，不污染 Markdown 大纲。
5. Agent 接入：writer/reviser 可以根据批注修改，auditor 可以创建 AI 批注，director 可以把批注整理成待办。

## 非目标

- 不引入向量数据库或嵌入模型。
- 不做实时多人协同编辑或 CRDT。
- 不把所有评审都改成 LLM 生成；确定性结构规则优先，LLM 负责摘要和建议。
- 不把画布布局写入 `.novel/outlines/*.md`，大纲正文仍以 Markdown 为权威。
- 不改变 A 阶段的快照预算和召回契约；结构报告通过工具按需查询，不默认塞进 writer 上下文。

## 数据模型

在 `novel.db` 中增量新增表，全部通过 `CREATE TABLE IF NOT EXISTS` 自动建表，并补充外键级联。

### story_arcs

结构线主表。

- `id`
- `novel_id`
- `arc_type`：`narrative` / `character` / `subplot`
- `title`
- `summary`
- `status`：`planned` / `active` / `completed` / `abandoned`
- `target_character_id`：角色线可空
- `planned_start_chapter`、`planned_end_chapter`
- `actual_start_chapter`、`actual_end_chapter`
- `created_at`、`updated_at`

### arc_beats

结构节点，挂在结构线下，可锚定真实章节或规划章节序号。

- `id`
- `novel_id`
- `arc_id`
- `chapter_id`：已写章节可空
- `chapter_order`：规划章节序号，未创建章节时也可存在
- `label`
- `kind`：`setup` / `rising` / `turn` / `midpoint` / `crisis` / `climax` / `resolution` / `note`
- `summary`
- `status`：`planned` / `drafted` / `reviewed`
- `created_at`、`updated_at`

### volume_reviews

卷末复盘。每卷每轮可保存一条最新复盘或多条历史，初版保留多条历史以便审计。

- `id`
- `novel_id`
- `volume_id`
- `round`
- `overall`
- `score`
- `strengths_json`
- `weaknesses_json`
- `structure_json`
- `character_arcs_json`
- `open_threads_json`
- `recommendations_json`
- `created_at`

### editorial_reports

全书或跨卷主编报告。

- `id`
- `novel_id`
- `scope_type`：`book` / `arc` / `volume_range`
- `scope_id`
- `summary`
- `risks_json`
- `recommendations_json`
- `created_at`

### chapter_annotations

段落批注和润色建议的统一表。`suggested_replacement` 非空时，它既是批注也是润色建议。

- `id`
- `novel_id`
- `chapter_id`
- `parent_id`：预留简单回复串
- `source`：`user` / `ai`
- `anchor_type`：`paragraph` / `range` / `chapter`
- `paragraph_index`
- `start_offset`、`end_offset`
- `quote`
- `comment`
- `suggested_replacement`
- `status`：`open` / `resolved` / `wontfix` / `applied`
- `author_session_id`
- `created_at`、`updated_at`

### outline_canvas_layout

每本小说一行画布布局，只存 UI 坐标和视图状态。

- `novel_id`：主键
- `layout_json`
- `updated_at`

## 后端模块边界

### novel-store

负责所有新表定义、DDL、CRUD 和删除级联。不引入 Effect，不依赖 plugin。

新增或导出：

- `StoryArcTable`、`ArcBeatTable`、`VolumeReviewTable`、`EditorialReportTable`、`ChapterAnnotationTable`、`OutlineCanvasLayoutTable`
- Story arc / beat / volume review / editorial report / annotation / canvas layout 的 CRUD
- `listStructureForEditor`：聚合弧、节点、卷、章节、线索、伏笔、张力，供主编工具和前端一次读取
- `listChapterAnnotations`、`createChapterAnnotation`、`updateChapterAnnotation`、`deleteChapterAnnotation`

### plugin

新增纯逻辑和工具，不把大报告默认注入写作上下文。

- `structure.ts`：确定性结构检查和聚合函数。
- `annotation.ts`：段落切分、quote 校验、批注锚点定位、润色建议状态转换。
- `outline-canvas.ts`：布局 schema 和迁移/校验。
- novel-writer 工具：
  - `plan_story_arc`
  - `record_arc_beat`
  - `review_volume`
  - `editorial_review`
  - `annotate_chapter`
  - `list_annotations`
  - `resolve_annotation`
  - `polish_paragraph`
  - `read_outline_canvas`
  - `write_outline_canvas`

工具返回结构化 metadata，方便前端直接展示，不只返回 Markdown。

### schema/protocol/server/app

B/C 的 UI 数据走现有 HttpApi 生成链路：

1. `packages/schema/src/novel.ts` 新增 schema。
2. `packages/protocol/src/groups/novel.ts` 新增 endpoints。
3. `packages/server/src/handlers/novel.ts` 实现。
4. `packages/client` 运行 `bun run generate`。
5. `packages/app/src/context/novel-queries.ts` 新增 query/mutation hooks。
6. `packages/app/src/pages/novel` 新增结构面板、批注面板和画布视图。

## Agent 行为

- `architect`：创建/更新叙事弧和关键节点；在大纲阶段校验卷章是否覆盖弧节点。
- `observer`：从章节中提取角色变化和结构事件，但只写建议，不自动把节点标为 reviewed。
- `auditor`：检查伏笔回收、线索闭合、张力单调/塌陷、弧节点缺失，创建 AI 批注或主编风险。
- `reflector`：章节完成后提出段落级问题或润色建议。
- `reviser`：根据 open 批注修改正文；采纳润色建议时保存新版本，并把批注标为 applied。
- `director`：卷最后一章完成后调度卷末复盘；发现高风险结构问题时暂停推进。

## 前端体验

- 小说工作台新增“结构”tab：左侧为卷章轴，主区域为结构线泳道，节点按章节定位。
- 阅读页选中段落时显示批注/润色操作；右侧展示批注列表。
- 编辑页显示批注标记，修订时可引用批注 ID。
- 大纲区域新增“画布”视图：卷为列，章为卡，结构线为横向泳道；拖拽章节调用已有 move chapter 能力，坐标写入 canvas layout。
- 保持现有 UI 风格：紧凑、工作区优先、无营销式卡片堆叠。

## 错误处理

- 批注锚点找不到段落时不删除批注，返回 `stale` 状态和 quote，作者可手动解决。
- 画布布局 JSON 损坏时回退到自动布局，不阻塞大纲读写。
- 结构报告缺少卷或章节时返回部分数据并标记缺口。
- 所有新工具在 novel/章节不存在时返回可读错误，不抛未捕获异常。
- 润色建议不直接覆盖正文；必须通过修订流程产生 chapter version。

## 测试策略

- `packages/novel-store`：新表 CRUD、外键级联、画布 upsert、批注状态更新、结构聚合排序。
- `packages/plugin`：段落锚点、stale quote、润色建议状态、结构检查规则、卷复盘聚合、工具输出 metadata。
- `packages/server`：新 endpoints 的成功和 404/校验失败路径。
- `packages/app`：批注选择状态、结构面板空状态、画布拖拽回调、布局保存。
- 回归：A 阶段插件全量测试必须继续通过，尤其 `state-commit-reliability`、`recall`、`scale`、`e2e`。

## 验收标准

- B 阶段可以创建叙事弧/角色弧、记录关键节点、生成卷末复盘和全书主编风险。
- C 阶段可以对章节段落创建/解决批注，生成并采纳/拒绝润色建议，并在可视化画布中查看和调整卷章结构。
- 新能力均有 HTTP API、前端 hooks、UI 入口和测试覆盖。
- A 阶段 12K 快照预算和召回可靠性不回退。
- `packages/plugin` 全量 `bun test` 通过。
- 受影响包 `bun typecheck` 通过。
- 完成严重/重要/一般分级自审，且无未处理严重问题。