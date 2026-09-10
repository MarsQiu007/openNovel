# Design

## Context

`setting-formatting` 已让设定详情按段落渲染并保留 `data-paragraph-index`；`setting-agent-tools` 已提供 `read_setting` / `search_settings`，AI 可以获取真实设定全文。章节侧已有 `chapter_annotations`、`annotation_execution_rounds`、选区工具、高亮逻辑和执行轮次编排，可作为架构参照。

本提案只把批注能力引入 world_entry，不改变已有章节批注行为。

## Goals / Non-Goals

### Goals

- 复用选区偏移、段落分段、快照和轮次编排思路，避免章节与设定交互语义漂移。
- 用数据库外键和执行轮次保证批注随条目删除、历史可追溯。
- 把 AI 修改限制在目标 world_entry 的 content，并复用现有设定文本格式校验和描述历史。
- UI 修改后刷新 world_entry、批注和执行历史。

### Non-Goals

- 不做跨实体批注、复杂 diff 编辑器或多版本设定树。
- 不新增 UI 自动触发 AI 的后台任务。
- 不把设定批注表泛化为多态表；第一版保持 world_entry 专属，后续需要时再演进。

## Decisions

### D1. 新增两张 world_entry 专属表

新增：

- `world_entry_annotations`
- `world_entry_annotation_rounds`

批注字段沿用章节批注的核心结构：`id`、`novel_id`、`world_entry_id`、`parent_id`、`source`、`anchor_type`、`paragraph_index`、`start_offset`、`end_offset`、`quote`、`comment`、`suggested_replacement`、`status`、`author_session_id`、`execution_round_id`、时间戳。

轮次字段为：`id`、`novel_id`、`world_entry_id`、`prompt_snapshot`、`status`、`annotations_snapshot`、`result_summary`、`content_history_id`、`created_at`。`content_history_id` 可空，用于关联 description_history；AI 未修改内容或失败时为空。

两张表都通过 `novel_id` / `world_entry_id` 外键级联删除。新表可放入 `CREATE_TABLES_SQL`，新库与旧库首次打开时都会创建，不需要重建旧表。

### D2. novel-store 提供窄 CRUD

novel-store 新增以下函数，server 与 plugin 共用：

- `createWorldEntryAnnotation`
- `listWorldEntryAnnotations`
- `updateWorldEntryAnnotation`
- `deleteWorldEntryAnnotation`
- `createWorldEntryAnnotationRound`
- `getWorldEntryAnnotationRounds`
- `updateWorldEntryAnnotationRound`

列表按 `paragraph_index` 升序、创建时间倒序；轮次按创建时间倒序。store 函数不判断 UI 状态机，只负责持久化。

### D3. Protocol 暴露条目内批注和轮次

NovelGroup 新增端点：

- `GET /:novelID/world-entries/:entryID/annotations`
- `POST /:novelID/world-entries/:entryID/annotations`
- `PATCH /:novelID/setting-annotations/:annotationID`
- `DELETE /:novelID/setting-annotations/:annotationID`
- `GET /:novelID/world-entries/:entryID/annotation-rounds`
- `POST /:novelID/world-entries/:entryID/annotation-rounds`
- `PATCH /:novelID/setting-annotation-rounds/:roundID`

schema 使用 `WorldEntryAnnotation`、`WorldEntryAnnotationExecutionRound` 和对应 input。修改公开 Protocol 后在 `packages/client` 重新生成 SDK。

### D4. Plugin 工具只做真实记录和回填

`annotate_setting` 接收 `entry_id`、锚点、评论和可选替换建议，创建 `source=ai` 批注。`list_setting_annotations` 支持状态过滤。`resolve_setting_annotation` 更新状态和评论。`report_setting_annotation_execution` 只更新已有轮次。

director 提示词新增约束：

1. 先 `read_setting` 获取全文，再分析批注。
2. 只使用 `list_setting_annotations` 返回的真实 ID 和锚点。
3. 修改 content 时使用 `update_setting`，保持纯文本和空行分段。
4. 不虚构设定、不删除无关事实、不写 Markdown、不绕过轮次。
5. 成功或失败都必须调用 `report_setting_annotation_execution`。

### D5. UI 复用选区工具，但使用设定专属执行 prompt

设定详情继续按段落渲染，并改用 `segmentParagraph` 合并批注装饰。选区、偏移量和重叠检测复用 `annotation-utils` 的纯函数。新增 `SettingAnnotationPanel` 展示当前批注和历史轮次，并提供执行入口。

新增 `setting-annotation-execution.ts`：

- 复用 `buildAnnotationsSnapshot` 生成快照。
- 新增 `formatSettingExecutionPrompt`，目标改为 `world_entry_id`。
- prompt 中包含 `read_setting`、目标 ID、批注锚点、原文段落、selected_quote、comment、suggested_replacement。
- 复用轮次编排流程：创建轮次 → 保存 prompt → 发送会话 → 关联批注；失败时保存失败原因。

### D6. AI 修改内容后由 UI 刷新

AI 使用既有 `update_setting` 修改 content，从而继续获得文本规范化、格式校验、描述历史和引用级联行为。UI 不直接把 AI 输出写库。执行后 UI 刷新 world_entries、world_entry 批注和执行轮次；`content_history_id` 可在回填后关联最近一条 description_history，用于追溯。

## Risks / Trade-offs

- [旧内容段落变化导致偏移失效] → 高亮按锚点渲染；执行 prompt 要求先精确匹配引用文本，无法定位时不猜测修改。
- [AI 只报告完成但未真正修改] → 轮次只表示执行结果；UI 刷新后仍显示真实 content，描述历史和描述内容用于核对。
- [批注叠加导致段落渲染复杂] → 阻止 open 批注重叠，并沿用“遇到重叠跳过后批注”的安全分段兜底。
- [发送 prompt 后会话长时间运行] → 轮次保持 running，用户可查看状态；失败由回填或发送异常显式记录。

## Migration Plan

1. 新增两张表和 store CRUD。
2. 新增 schema / protocol / client SDK。
3. 新增 server handler。
4. 新增 plugin 工具和提示词约束。
5. 新增设定批注面板、选区装饰和执行逻辑。
6. 用单元测试覆盖偏移、状态、prompt 和工具；人工验收真实选区和执行流程。

## Open Questions

（无）
