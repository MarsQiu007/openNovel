## Context

`novel-store` 为每本小说维护本地 SQLite 数据，表结构由 Drizzle 定义和 `CREATE TABLE IF NOT EXISTS` DDL 组成；历史字段升级集中在 `runMigrations` 中做幂等修复。现有地图入口只是前端占位，后端没有地图表。公开 API 由 Schema、Protocol、Server 组成，公开契约变化后必须从 `packages/client` 重新生成客户端。

## Goals / Non-Goals

**Goals:**

- 为世界地图、地图要素和角色图钉建立可查询、可校验的关系模型。
- 用数据库约束保证每本小说最多一个 `active` 和一个 `draft` 地图。
- 提供一次返回完整地图聚合的读取 API。
- 保证存量数据库可以增量升级，并在删除小说时不残留地图数据。

**Non-Goals:**

- 不选择或集成前端地图库。
- 不定义地图渲染、编辑交互或 AI 生成流程。
- 不做地图版本历史、层级地图、路线或地理投影。

## Decisions

### 使用三张关系表而非 JSON 文档

新增 `world_maps`、`world_map_features` 和 `character_map_pins` 三张表。地图元数据、地图要素和角色图钉有不同的生命周期和外键行为；拆表可以直接表达小说、地图、世界观条目、角色和图钉关系，也便于后续增量编辑。整体 JSON 文档会让关联完整性、局部更新和后续 AI 校验都依赖应用层手工保证。

### 用状态和部分唯一索引约束生命周期

`world_maps.status` 只允许 `draft` 和 `active`，并建立按 `novel_id` 的部分唯一索引：

- 一个小说最多一条 `status = active`；
- 一个小说最多一条 `status = draft`。

“采用草稿”在数据库事务中执行：先删除旧 `active` 及其子数据，再把目标 `draft` 更新为 `active`。这样替代“多版本表 + 归档”的方案，符合第一版不保留版本历史的共识。

### 几何使用局部坐标与紧凑 JSON

地图统一使用 `0..10000` 的局部平面网格。地点使用 `real` 类型的 `x/y` 列；区域使用 JSON 数组保存多边形顶点，顶点仍逐点校验坐标范围。不引入 GeoJSON 或经纬度字段，避免把幻想地图绑定为地理投影，也让前端渲染层可以在读取后转换成 Leaflet 坐标。

### 关联删除遵循“保地图，断引用”

- `world_map_features.world_entry_id` 使用 `ON DELETE SET NULL`，世界观条目消失时地图形状仍保留；
- `character_map_pins.feature_id` 使用 `ON DELETE SET NULL`，要素删除只让图钉回到自由坐标；
- `character_map_pins.character_id` 使用 `ON DELETE CASCADE`，角色删除后不残留图钉；
- 三张表都通过 `novel_id` 与 `novels` 级联，小说删除时清理完整地图数据。

### 提供地图聚合读取

除单表 CRUD 外，提供按 `status` 读取地图聚合的 API，一次返回地图、要素和图钉。渲染提案只需要一次请求即可构建场景，避免前端拼装多个请求。创建、更新、删除仍保持资源级 API，便于后续编辑器和 AI 草稿局部写入。

### 公共契约变更后重新生成客户端

在 `packages/schema` 中定义地图和输入结构，在 `packages/protocol` 中扩展小说相关的 API group，在 `packages/opennovel` 的 Server handler 中调用 `novel-store`。契约和路由完成后，从 `packages/client` 运行 `bun run generate`，不手工修改生成目录。

## Risks / Trade-offs

- [区域多边形格式错误] → 在公共 schema 和存储层校验顶点数量与坐标范围，只接受有限数值数组。
- [草稿提升事务中部分失败] → 使用单个 SQLite 事务，失败时整体回滚，保留原地图状态。
- [坐标精度漂移] → 数据库使用实数保存 `0..10000` 局部坐标，渲染层只做视图缩放，不回写像素坐标。
- [不保留版本历史] → 用户确认草稿后无法恢复旧正式地图；该取舍已在本提案范围中明确接受。

## Migration Plan

实现时把新表和索引加入 `novel-store` DDL，并通过 `runMigrations` 或幂等 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 路径补齐。不需要回填或改写存量数据。回滚时可以仅删除新增地图表；本提案不提供运行时卸载迁移。

## Open Questions

_none_