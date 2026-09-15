# 大纲全量入库并移除 Markdown 文件依赖（outline-db-persistence）

## Why

当前大纲存储分裂在两个位置：章纲已入库（`chapters.outline`），但总纲和卷纲仍存放在 `.novel/outlines/` 目录下的 Markdown 文件中。云盘同步基于 SQLite 数据库整体快照（`vacuumInto`），不同步任何文件——这意味着总纲和卷纲目前跨设备根本不会被同步。同时，DB + 文件双写引入了同步分叉风险，文件 I/O 增加了不必要的错误处理分支。

## What Changes

- 在 `novels` 表新增 `master_outline` text 列，总纲作为小说记录的一等数据保存。
- 在 `volumes` 表新增 `outline` text 列，卷纲作为卷记录的一等数据保存。
- 插件 `generateMasterOutline` / `generateVolumeOutline` 写数据库列，不再写文件。
- 插件 `read_outline` 读数据库列，不再读文件。
- 服务端 `getOutlineBundle` / `updateOutline` 对所有层级改为数据库读写。
- 章纲 `resolveChapterOutline` 简化为数据库唯一来源，移除文件兜底。
- 旧项目的 Markdown 文件通过懒导入一次性写入数据库，之后不再读写文件。
- 修改 `chapter-outline-persistence` capability：移除双写和文件兜底要求，改为数据库唯一来源。

## Capabilities

### New Capabilities

- `outline-db-persistence`: 总纲和卷纲的数据库存储、存量文件懒导入和读取要求。

### Modified Capabilities

- `chapter-outline-persistence`: 移除双写和文件兜底，章纲完全以数据库为唯一权威来源。

## Impact

- `packages/novel-store`：`novels` 表新增 `master_outline` 列，`volumes` 表新增 `outline` 列，补充旧库迁移。
- `packages/plugin`：大纲生成/读取工具从文件 I/O 切换到数据库读写。
- `packages/server`：大纲 bundle 和大纲编辑从文件 I/O 切换到数据库读写。
- `packages/app`：无结构性改动，继续消费大纲 bundle。
- **云盘同步**：总纲和卷纲入库后自动被数据库快照同步覆盖，修复当前不同步的问题。
- **本地数据兼容性**：已有 `.novel/outlines/*.md` 通过懒导入写入数据库，旧文件成为无害残留。
