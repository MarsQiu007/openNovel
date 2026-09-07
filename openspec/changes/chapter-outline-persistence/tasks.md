## 1. 数据层

- [x] 1.1 在 `chapters` 表新增 `outline` 字段，更新新建库 DDL、旧库迁移和数据层更新函数，并在 `packages/novel-store` 用单元测试验证读写和旧库升级
- [x] 1.2 实现章纲数据库优先 + 存量 Markdown 文件懒导入逻辑，覆盖文件缺失、可导入和导入失败三类路径，并通过单元测试验证

## 2. 插件读写

- [x] 2.1 `generate_chapter_outline` 保存数据库章纲并同步写 Markdown，通过插件测试验证生成后可直接从数据库读取
- [x] 2.2 `read_chapter_outline` 和 `read_outline` 改为数据库优先、文件兜底，空模板或文件缺失时输出可操作的章纲缺失提示
- [x] 2.3 写作快照读取数据库章纲，数据库为空时回退文件导入，并通过测试验证不再依赖文件存在

## 3. 服务端与前端

- [x] 3.1 大纲 bundle 的 chapters 部分改为数据库优先、文件兜底，并用服务端测试验证前端契约不变
- [x] 3.2 WebUI 保存 `section=chapter` 时更新数据库并同步 Markdown 文件，master/volume 行为保持不变
- [x] 3.3 在 `packages/app` 通过 `bun typecheck`，确认无前端结构改动导致的回归

## 4. 质量收尾

- [x] 4.1 在 `packages/novel-store`、`packages/plugin`、`packages/server`、`packages/app` 分别通过 `bun typecheck`，并运行相关包测试
- [x] 4.2 在仓库根目录通过 `bun run typecheck` 与 `bun run lint`
- [x] 4.3 通过 `openspec validate chapter-outline-persistence --type change`