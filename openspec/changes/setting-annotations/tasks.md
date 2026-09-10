## 1. 数据层

- [x] 1.1 新增 world_entry_annotations 和 world_entry_annotation_rounds 表定义、外键索引与初始建表 SQL，并运行 `packages/novel-store` 的 `bun typecheck`
- [x] 1.2 实现批注 CRUD 与执行轮次读写函数，覆盖状态过滤、排序和字段更新
- [x] 1.3 为 store CRUD 和外键级联删除添加定向测试；在 `packages/novel-store` 运行 `bun test`

## 2. API 契约

- [x] 2.1 新增批注和执行轮次的 schema 结构，覆盖锚点、状态、来源、快照和结果摘要
- [x] 2.2 在 NovelGroup 新增批注 CRUD 和轮次端点，并运行 `openspec validate setting-annotations --json`
- [x] 2.3 在 `packages/client` 运行 `bun run generate`，确认不手工编辑 generated 文件
- [x] 2.4 新增 server handler 并校验 novel 与 world_entry 归属；在 `packages/server` 运行 `bun typecheck`

## 3. Plugin 工具与提示词

- [x] 3.1 新增 `annotate_setting` 与 `list_setting_annotations` 工具，校验真实条目并返回结构化 metadata
- [x] 3.2 新增 `resolve_setting_annotation` 与 `report_setting_annotation_execution` 工具，处理不存在 ID、非法状态，并在成功后关联最近描述历史
- [x] 3.3 更新 director 工具表和整理流程提示词，约束先读取设定、使用真实锚点、纯文本分段、通过 update_setting 修改和显式回填
- [x] 3.4 为四个工具的创建、查询、状态变更、回填和错误路径添加定向测试；在 `packages/plugin` 运行 `bun test`

## 4. UI 工作流

- [ ] 4.1 添加设定批注、轮次的 query 和 mutation，并处理加载、错误和刷新
- [ ] 4.2 在设定详情接入选区锚点、重叠拦截和批注创建表单
- [ ] 4.3 按锚点渲染批注装饰、悬浮提示和当前批注列表，支持状态变更与删除
- [ ] 4.4 新增设定批注执行 prompt 构造与轮次编排逻辑，确保快照、关联、失败回填完整
- [ ] 4.5 新增批注面板和历史轮次展示，提供受会话状态控制的执行入口，并在执行后刷新设定内容
- [ ] 4.6 为偏移锚点、重叠拦截、prompt 约束和轮次编排添加定向测试；在 `packages/app` 运行定向测试

## 5. 质量验证

- [ ] 5.1 在 `packages/novel-store`、`packages/schema`、`packages/protocol`、`packages/client`、`packages/server`、`packages/plugin`、`packages/app` 运行 `bun typecheck`
- [ ] 5.2 对新增或修改源文件运行 oxlint，确认 0 errors
- [ ] 5.3 运行 `openspec validate setting-annotations --json`，并核对 spec、设计、任务与实现一致
- [ ] 5.4 人工验收：在真实 world_entry 上选中文字创建批注、查看高亮、执行 AI 批注、确认纯文本分段和历史轮次，再验证章节批注流程不受影响
