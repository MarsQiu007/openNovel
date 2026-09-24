## Context

现状：两张同构批注表 + 两套端点 + 两个面板组件 + 共享的 `annotation-utils`（单段锚点）。

```
chapter_annotations        world_entry_annotations
  chapter_id FK              world_entry_id FK
  其余列完全相同 ←──────────┘
```

目标态：批注挂在手动编辑目录上，一个模型覆盖所有可修改面。

```
ManualEditDirectory（已有注册表：实体/字段/类别/AI感知策略）
        ↑ target = (entity, entityId, field)
┌──────────────────────────────────────────────┐
│ annotations（统一表）                          │
│  文本目标 → 区间锚点 + quote                   │
│  结构目标 → 字段级引用（anchor 全空）           │
└──────────────────────────────────────────────┘
        ↓ 执行路由
  正文类 → 章节修订流程    设定类 → setting-impact-flow
  一切落库 → manual-edit-transaction（派生同步走既有队列）
```

## Decisions

### 1. 多态单表，放弃每面一表

```
annotations (
  id, novel_id, parent_id,
  target_type,      -- chapter | chapter_outline | volume_outline | master_outline
                     -- | world_entry | character | ... （后续扩展）
  target_id,        -- 实体 ID；单例目标（master_outline / style_guide / soul）可为空
  field,            -- content | outline | description | ... 对齐编辑目录字段名
  anchor_type, paragraph_index, end_paragraph_index, start_offset, end_offset,
  quote, comment, suggested_replacement, status, source,
  author_session_id, execution_round_id, created_at, updated_at
)
```

- 放弃 DB 级多态外键，目标存在性由服务端编辑目录校验（与 manual-edit-transaction 的 requireEntity 同一套）。
- `target_type` 词汇表由编辑目录驱动：新批注面 = 目录注册 + UI 接入，不加表。

### 2. 数据迁移：一次性搬移，旧表退役

- `chapter_annotations` → `target_type=chapter, target_id=chapter_id, field=content`
- `world_entry_annotations` → `target_type=world_entry, target_id=world_entry_id, field=description`
- `end_paragraph_index` 来自 multi-paragraph-annotation 已加的列，直接搬移。
- 旧表保留一个版本周期只读（回滚保险），下个版本 DROP——具体节奏由 tasks 定。

### 3. API：一套端点，目标类型判别

- `POST /api/novel/{id}/annotations`（body 带 targetType/targetId/field/anchor）
- `GET /api/novel/{id}/annotations?targetType=&targetId=`
- 既有两套端点由 server 内部转发到新模型或直接下线换前端切换——倾向直接切换（桌面端前后端同版本发布，无兼容负担）。

### 4. 执行路由：复用既有落库通道

- 执行 prompt 增加目标上下文（targetType/field/目标片段），AI 输出修订建议。
- 正文类：沿用章节修订/审批流程。
- 设定类：沿用 setting-impact-flow（影响任务生成与门禁）。
- 大纲类（新）：按正文类处理，写入 targets 为 outline 字段，走 manual-edit-transaction。
- 所有写入经过统一事务层 → 派生同步状态自动进入既有队列，不产生第二套同步语义。

### 5. UI：一个面板组件 + 一个选区锚定辅助

- `AnnotationPanel` 按 (targetType, targetId) 上下文实例化，样式与交互沿用现有两个面板。
- `chapter-reader` / `world-reader` / `outline-reader` 共用选区创建与区间装饰。
- 非文本目标（Phase C）用"对象级批注"入口（卡片右键/角标），不做文本选区。

## Open Questions（留给提案评审）

1. 旧端点是直接切换还是保留一个兼容期？（桌面端同版本发布，倾向直接切换）
2. Phase B 三个大纲面的阅读器是否已具备选区渲染条件，还是需要先补分段渲染？
3. Phase C 结构化目标的批注入口形态（右键菜单 vs 角标按钮）需要 UX 决策。
