## 1. 数据层

- [x] 1.1 在 `novels` 表新增 `master_outline` text 列（默认空字符串），更新 DDL 和旧库迁移（`PRAGMA table_info` 补列），在 `packages/novel-store` 用单元测试验证读写和旧库升级
- [x] 1.2 在 `volumes` 表新增 `outline` text 列（默认空字符串），更新 DDL 和旧库迁移，在 `packages/novel-store` 用单元测试验证读写和旧库升级
- [x] 1.3 实现总纲/卷纲的存量 Markdown 文件懒导入逻辑，覆盖文件缺失、可导入和导入失败三类路径

## 2. 插件读写

- [x] 2.1 `generateMasterOutline` 写入 `novels.master_outline` 列，不再写文件，通过插件测试验证
- [x] 2.2 `generateVolumeOutline` 写入 `volumes.outline` 列，不再写文件，通过插件测试验证
- [x] 2.3 `read_outline` 对所有层级改为读数据库列，总纲/卷纲为空时懒导入旧文件，不再读文件兜底
- [x] 2.4 `resolveChapterOutline` 移除文件兜底，简化为数据库唯一来源（保留懒导入）

## 3. 服务端与前端

- [x] 3.1 服务端 `getOutlineBundle` 对 master/volume 部分改为读数据库列（含懒导入），不再读文件
- [x] 3.2 服务端 `updateOutline` 对所有层级改为写数据库列，不再写文件
- [x] 3.3 在 `packages/app` 通过 `bun typecheck`，确认无前端结构改动导致的回归

## 4. 质量收尾

- [x] 4.1 在 `packages/novel-store`、`packages/plugin`、`packages/server`、`packages/app` 分别通过 `bun typecheck`，并运行相关包测试
- [x] 4.2 在仓库根目录通过 `bun run typecheck` 与 `bun run lint`
- [x] 4.3 通过 `openspec validate outline-db-persistence --type change`

## Implementation Commits

- `c17732929` docs(openspec): 提案大纲全量入库并移除文件依赖
- `d6c524175` feat(novel-store): 新增大纲数据库列并迁移旧库
- `e61497cd6` feat(novel-store): 实现总纲/卷纲懒导入解析函数
- `e5b9b10fc` feat(plugin): 大纲生成与读取工具切换为数据库读写
- `250e57b0e` feat(server): 大纲面板读写切换为数据库
- `1c6c5dc0f` test(server,plugin): 更新大纲测试以匹配数据库唯一来源
- `c9e79b779` docs(openspec): 标记大纲数据库持久化任务全部完成