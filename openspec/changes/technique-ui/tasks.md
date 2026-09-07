## 1. 协议与数据层

- [x] 1.1 新增技法契约 schema，覆盖技法、详情、创建/更新入参、注入开关和错误模型，并在 packages/schema 通过 `bun typecheck`
- [x] 1.2 新增技法 HTTP 协议组并在 packages/client 执行 `bun run generate`，确认 generated client 暴露技法端点
- [x] 1.3 在 novel-store 实现技法列表、详情、创建、更新、删除与反馈查询，并在 packages/novel-store 通过 `bun test` 与 `bun typecheck`
- [x] 1.4 在 novel-store 实现技法注入开关读写，验证写入保留既有配置字段且非法值默认关闭

## 2. 服务端

- [x] 2.1 新增技法 handler，实现列表、详情、创建、更新、删除与注入开关端点，并在 packages/server 通过 `bun typecheck`
- [x] 2.2 为技法 handler 增加最小 HTTP/store 测试，覆盖创建、更新、删除和开关读写，并通过 `bun test`

## 3. 前端

- [x] 3.1 新增技法查询与 mutation hooks，覆盖列表、详情、创建、更新、删除和开关切换，并在 packages/app 通过 `bun typecheck`
- [x] 3.2 新增技法库面板，实现列表筛选、详情、创建/编辑表单和删除确认，并通过面板组件的单元测试或既有前端测试
- [x] 3.3 将技法库面板接入书籍工作台右栏，验证面板切换、展开/收起和空态显示

## 4. 验证与交付

- [x] 4.1 通过 `openspec validate technique-ui --type change`
- [x] 4.2 在相关包运行 `bun typecheck` 与测试，再通过根目录 `bun run typecheck` 与 `bun run lint`
- [ ] 4.3 记录实现提交并更新提案 artifacts，准备同步规格、归档、合并 main 和清理分支