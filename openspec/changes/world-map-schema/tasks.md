## Tasks

### 数据层

- [x] 在 `packages/novel-store` 中定义 `world_maps`、`world_map_features`、`character_map_pins` 的 Drizzle 表和类型。
- [x] 在 SQLite DDL 中新增三张表、状态检查、外键、普通索引和每本小说一个 `active` / 一个 `draft` 的部分唯一索引。
- [x] 补齐幂等迁移路径，验证旧库打开时自动创建新表且既有数据不变。
- [x] 实现地图、地图要素和角色图钉的基础 CRUD 查询。
- [x] 实现聚合读取和草稿提升事务。
- [x] 为坐标越界、重复生命周期状态、关联置空和级联删除补测试。

### API 契约

- [x] 在 `packages/schema` 中定义地图、地图要素、角色图钉及其创建/更新输入。
- [x] 在 `packages/protocol` 中新增地图 CRUD 和聚合读取端点。
- [x] 在 `packages/opennovel` 中实现 Server handler，并校验小说归属和父级归属。
- [x] 从 `packages/client` 运行 `bun run generate` 重新生成客户端 API。

### 验证

- [x] 从 `packages/novel-store` 运行测试。
- [x] 从受影响包分别运行 `bun typecheck`。
- [x] 运行 `openspec validate world-map-schema`。
- [x] 用临时数据库手动验证旧库迁移、小说删除级联和草稿替换事务。