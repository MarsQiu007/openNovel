## 1. 数据层与迁移（novel-store）

- [ ] 1.1 新建 `annotations` 统一批注表：`target_type` / `target_id` / `field` 替换实体外键，其余列与既有两张批注表一致（含 `end_paragraph_index` 区间锚点列），索引 `(target_type, target_id, status)` 与 `(novel_id)`；同步 drizzle 表定义与 `CREATE_TABLES_SQL`，并从建表 SQL 中移除四张旧表语句（新库不再建旧表）
- [ ] 1.2 新建 `annotation_rounds` 统一执行轮次表：`target_type` / `target_id` + `prompt_snapshot` / `status` / `annotations_snapshot` / `result_summary` / `result_ref_id` / `created_at`，索引 `(target_type, target_id, created_at)`；同步 drizzle 定义与建表 SQL
- [ ] 1.3 一次性数据迁移（幂等）：`chapter_annotations` → `target_type='chapter', field='content'`；`world_entry_annotations` → `target_type='world_entry', field='content'`；两张旧轮次表 → 统一轮次表（`result_ref_id` 分别来自 `chapter_version_id` / `content_history_id`）；保留原 ID 与 `execution_round_id` 关联；旧表不存在时跳过；迁移测试覆盖旧库打开、数据完整搬移、重复执行幂等
- [ ] 1.4 统一批注与轮次 store 函数：创建 / 按目标过滤列表 / 更新 / 删除；删除既有两套批注与轮次 store 函数及旧 drizzle 表导出（物理旧表保留只读，代码不再读写）

## 2. 契约与 SDK（schema / protocol / client）

- [ ] 2.1 `packages/schema`：新增统一 `Annotation`（`targetType` / `targetId` / `field` + 可选区间锚点 + quote / comment / suggestedReplacement / status / source / parentId / authorSessionId / executionRoundId）、统一 `AnnotationRound`（含 `resultRefId`）及各自 Create / Update 输入结构；移除 `ChapterAnnotation`、`WorldEntryAnnotation`、两套轮次结构及其输入结构
- [ ] 2.2 `packages/protocol`：统一端点 `GET/POST /api/novel/:novelID/annotations`、`PATCH/DELETE /api/novel/:novelID/annotations/:annotationID`、`POST/GET /api/novel/:novelID/annotation-rounds`、`PATCH /api/novel/:novelID/annotation-rounds/:roundID`；下线既有 14 个批注与轮次端点
- [ ] 2.3 在 `packages/client` 运行 `bun run generate` 重新生成 SDK，并用 typecheck 验证类型导出

## 3. 服务端（server）

- [ ] 3.1 批注目标注册表：Phase A 注册 `chapter.content` 与 `world_entry.content`；`targetType` / `field` 词汇取自手动编辑目录 entity / fields 去重视图；创建校验链——目标组合已注册 → 目标实体存在且属于当前 novel → 锚点校验（复用既有段落区间校验：单段严格 quote、跨段去空白宽松、结束段落索引不小于起始段落索引）
- [ ] 3.2 统一批注 handler：创建（注册表 + 存在性 + 锚点校验）、按目标过滤列表、更新、删除，替换正文与设定两套 handler；旧端点下线
- [ ] 3.3 统一轮次 handler：创建（目标校验 + 快照固定）、按目标列表、更新（`result_ref_id` 透传），替换两套轮次 handler；旧轮次端点下线
- [ ] 3.4 手动编辑目录条目收敛：`annotation` / `setting_annotation` / `execution_round` / `setting_annotation_round` 四类共 9 条旧条目替换为新统一端点的 `annotation` / `annotation_round` 条目，数据类别与 AI 感知策略维持 workflow_fact / flow_only；目录一致性测试同步更新
- [ ] 3.5 API 测试：未注册目标组合拒绝、目标不存在拒绝、非法锚点拒绝、跨目标列表隔离、轮次归属与结果引用正确、迁移后读写统一表

## 4. 前端（app）

- [ ] 4.1 `novel-queries` 数据访问层：批注与轮次的 query key 和 mutation 统一为按 `(targetType, targetId)` 参数化的一套，切换到统一端点；删除正文 / 设定两套旧 key 与 mutation
- [ ] 4.2 统一批注面板：两个面板组件合并为单一 `AnnotationPanel`（按目标上下文实例化），样式、交互、区间位置标签、历史面板、重新激活行为与现状一致；`chapter-reader` / `world-reader` / 编辑器提示条接入点同步更新
- [ ] 4.3 执行模块合并：`annotation-execution` 与 `setting-annotation-execution` 合并为按 `targetType` 路由的统一执行模块；正文批量意图映射与设定受控修改两条 prompt 模板及状态机原样保留
- [ ] 4.4 组件与单元测试：正文与设定两个上下文下的面板渲染、创建、重叠拦截、执行按钮激活条件、历史面板分组与重新激活行为不变；选区锚定与装饰工具集复用既有共享实现

## 5. 插件（plugin）

- [ ] 5.1 统一 `annotate` 工具（`targetType` / `targetId` / `field` + 区间锚点 + 评论 + 可选替换建议），替换 `annotate_chapter` / `annotate_setting`；目标与锚点校验走统一端点语义，工具测试覆盖 chapter 与 world_entry 两类目标
- [ ] 5.2 `list_annotations` / `resolve_annotation` / `report_annotation_execution` 切换为按目标参数化并读写统一存储；`list_setting_annotations` / `resolve_setting_annotation` / `report_setting_annotation_execution` 下线
- [ ] 5.3 director 提示词与工具描述同步更新：引用新工具名，保留禁止虚构 ID、绕过执行轮次、自动删除设定、写入 Markdown 等既有约束
- [ ] 5.4 工具测试：统一工具创建 / 列表 / 标记状态 / 执行回填（含设定目标完整链路）；断言旧工具名不再注册

## 6. 集成验收

- [ ] 6.1 端到端（正文）：选区创建（单段 / 跨段）→ 区间装饰 → 重叠拦截 → 状态管理 → 采纳 / 执行 → 轮次归档 → 历史面板 → 重新激活，行为与升级前一致
- [ ] 6.2 端到端（设定）：选区创建 → 装饰 → 重叠拦截 → 显式执行轮次 → AI 受控修改 → 统一工具回填 → 描述历史与轮次历史刷新，行为与升级前一致
- [ ] 6.3 迁移场景：含旧批注与旧轮次的小说升级后全部数据完整可见、关联正确；新建批注与轮次只写统一表；旧表数据保持只读不变
- [ ] 6.4 全仓检索旧端点标识（`create-annotation` / `update-annotation` / `setting-annotations` / `setting-annotation-rounds` / `create-execution-round` / `execution-rounds` 及嵌套在 chapters、world-entries 下的旧批注路由路径）与旧工具名（`annotate_chapter` / `annotate_setting` / `list_setting_annotations` / `resolve_setting_annotation` / `report_setting_annotation_execution`）确认无残留引用；注意新统一端点 `annotation-rounds` 为保留项，不误删
- [ ] 6.5 运行 packages/novel-store、packages/schema、packages/server、packages/app、packages/plugin、packages/client 的 `bun test` 与 `bun typecheck`，以及全仓 `bun run typecheck` 和 `bun run lint`，确认退出码均为 0
