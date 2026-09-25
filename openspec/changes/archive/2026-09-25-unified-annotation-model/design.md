## Context

现状：批注是两座孤岛——两张同构批注表 + 两张同构执行轮次表，配套两套共 14 个端点、两个面板组件、两套共 8 个 AI 工具，只有选区/装饰/重叠检测工具集（`annotation-utils`）是共享的。

```
chapter_annotations                world_entry_annotations
annotation_execution_rounds        world_entry_annotation_rounds
  chapter_id FK / chapter_version_id │ world_entry_id FK / content_history_id
  其余列完全同构 ←───────────────────┘
```

目标态：批注挂在手动编辑目录上，一个模型覆盖所有可修改面；Phase A 只替换底座，不新增批注面。

```
ManualEditDirectory（已有注册表：实体/字段/类别/AI感知策略）
        ↑ 词汇对齐（entity + field）
批注目标注册表（服务端：chapter.content / world_entry.content，可扩展）
        ↑ target = (targetType, targetId, field)
┌──────────────────────────────────────────────┐
│ annotations（统一批注表）                      │
│ annotation_rounds（统一执行轮次表）            │
│  文本目标 → 区间锚点 + quote                   │
│  结构目标 → 字段级引用（anchor 全空，Phase C）  │
└──────────────────────────────────────────────┘
        ↓ 执行路由（按 targetType）
  chapter → 章节修订流程   world_entry → 设定影响流程
  一切落库 → 手动编辑事务层（派生同步走既有队列）
```

## Decisions

### 1. 多态单表，放弃每面一表

```
annotations (
  id, novel_id, parent_id,
  target_type,      -- Phase A: chapter | world_entry；后续注册扩展
  target_id,        -- 实体 ID；未来单例目标（master_outline / style_guide / soul）可为空
  field,            -- content | outline | ... 对齐编辑目录字段词汇
  anchor_type, paragraph_index, end_paragraph_index, start_offset, end_offset,
  quote, comment, suggested_replacement, status, source,
  author_session_id, execution_round_id, created_at, updated_at
)
索引：(target_type, target_id, status)、(novel_id)
```

- 放弃 DB 级多态外键，目标存在性由服务端校验（与手动编辑事务的目标存在性校验同一套语义）。
- 列集合是既有两张批注表的并集（两表本就同构），新增仅 `target_type`、`target_id`、`field` 三列替换各自外键列。

### 2. 执行轮次同样统一，不留第二个岛

```
annotation_rounds (
  id, novel_id,
  target_type, target_id,
  prompt_snapshot, status, annotations_snapshot, result_summary,
  result_ref_id,    -- 结果引用：chapter → 章节版本 ID；world_entry → 描述历史 ID
  created_at
)
索引：(target_type, target_id, created_at)
```

- 既有两张轮次表唯一差异是结果引用列名（`chapter_version_id` / `content_history_id`），统一为单列 `result_ref_id`，语义随 `target_type` 而定。
- 快照 JSON 结构沿用共享的 `AnnotationExecutionSnapshot`，迁移时原样搬移。

### 3. 数据迁移：一次性搬移，旧表停用保留

- `chapter_annotations` → `target_type='chapter'`、`target_id=chapter_id`、`field='content'`
- `world_entry_annotations` → `target_type='world_entry'`、`target_id=world_entry_id`、`field='content'`（注意：设定正文字段是 `content`，不是 description）
- `annotation_execution_rounds` → `target_type='chapter'`、`result_ref_id=chapter_version_id`
- `world_entry_annotation_rounds` → `target_type='world_entry'`、`result_ref_id=content_history_id`
- 迁移幂等（按目标表已有 ID 集合跳过）；迁移后旧表不再被任何代码读写，物理保留一个版本周期作为回滚保险，DROP 另起任务。
- 保留原 ID 不变，批注与轮次的关联（`execution_round_id`）迁移后仍有效。

### 4. API：一套端点，直接切换

- 批注：`GET/POST /api/novel/:novelID/annotations`（创建 body 带 targetType/targetId/field/锚点；列表按 `targetType`+`targetId` 过滤）、`PATCH/DELETE /api/novel/:novelID/annotations/:annotationID`
- 轮次：`POST/GET /api/novel/:novelID/annotation-rounds`（body/查询带目标）、`PATCH /api/novel/:novelID/annotation-rounds/:roundID`
- 既有 14 个端点直接下线，不留兼容期——桌面端前后端同版本发布，无旧客户端存续；SDK 随协议变更重新生成。
- 端点收敛后，手动编辑目录中 9 条批注相关条目（annotation / setting_annotation / execution_round / setting_annotation_round 三类实体）合并为新端点的 `annotation` / `annotation_round` 条目，数据类别与 AI 感知策略维持 workflow_fact / flow_only。

### 5. 批注目标注册表：服务端权威，词汇与编辑目录对齐

- 注册表登记可批注的 `(targetType, field)` 组合及其目标实体解析方式；Phase A 只注册 `chapter.content` 与 `world_entry.content`。
- `targetType` 与 `field` 词汇直接采用手动编辑目录的 entity / fields 词汇（去重视图），保证"能编辑的地方"与"能批注的地方"共用同一本字典；新增批注面 = 注册表加一项 + UI 接入，不加表不加端点。
- 创建批注时校验：目标组合已注册 → 目标实体存在且属于当前 novel → 锚点在目标文本范围内（复用既有段落区间校验：单段严格 quote、跨段去空白宽松）。

### 6. 执行路由：通道统一，行为不变

- 执行入口按 `targetType` 路由 prompt 构建与结果回填：
  - `chapter` → 既有批量意图映射流程（applied/resolved/wontfix → 章节修订），轮次结果引用章节版本。
  - `world_entry` → 既有设定受控修改流程（读取全文、只改 content、纯文本约束），轮次结果引用描述历史。
- Phase A 两条流程的 prompt 模板与状态机原样保留，仅底层读写切到统一表；批注执行落库仍经过统一手动编辑事务层，派生同步进入既有队列，不新增同步语义。

### 7. UI：一个面板组件 + 数据访问层整体切换

- 单一 `AnnotationPanel` 按 `(targetType, targetId)` 上下文实例化；既有正文面板与设定面板的样式、交互、位置标签、历史面板原样保留（Phase A 用户无感的验收标准）。
- `novel-queries` 的批注查询键与 mutation 统一为按目标参数化的一套；`chapter-reader` / `world-reader` 继续共用既有选区创建与区间装饰工具集（multi-paragraph-annotation 已共享）。
- 两个执行模块（正文执行 / 设定执行）合并为一个按 `targetType` 路由的执行模块。

### 8. AI 工具：8 → 4，目标参数化

- 收敛为 `annotate`（targetType/targetId/field + 锚点 + 评论）、`list_annotations`（按目标过滤）、`resolve_annotation`、`report_annotation_execution` 四个工具。
- 正文侧三个工具名（`list_annotations` / `resolve_annotation` / `report_annotation_execution`）本就是通用名，内部实现切到统一表；`annotate_chapter`、`annotate_setting` 及设定侧三个 `*_setting_*` 工具下线。
- 工具描述与 director 提示词同步更新（含"禁止虚构 ID、绕过执行轮次"等既有约束），约束语义不变。

## Open Questions

无。原三问已拍板或移出：

1. 旧端点直接切换（决策 4），不留兼容期。
2. 大纲阅读器的选区渲染条件 → Phase B 提案的前置评估项。
3. 结构化目标的批注入口形态（右键菜单 vs 角标）→ Phase C 提案的 UX 决策。
