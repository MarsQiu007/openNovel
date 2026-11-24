# Tasks

## 1. 协议

- [ ] 1.1 SessionsDirectoryQuery.directory 接受 `global` 哨兵（Union: AbsolutePath | Literal global）
- [ ] 1.2 在 packages/client 运行 bun run generate 重新生成 SDK 并确认 diff 仅含预期变更

## 2. 服务端

- [ ] 2.1 LocationMiddleware 目录解析对哨兵 `global` 映射 Global.Path.data（查询参数与 x-opennovel-directory 头两处）
- [ ] 2.2 session.list 目录过滤在 core 存储层解析哨兵为 Global.Path.data

## 3. 验证

- [ ] 3.1 server 包新增/更新单测：哨兵解析、session 全局过滤、非哨兵路径回归
- [ ] 3.2 packages/server 目录 bun typecheck 与 oxlint 通过
- [ ] 3.3 cd packages/opennovel && bun run script/httpapi-exercise.ts coverage 全绿
- [ ] 3.4 桌面端人工冒烟：全局页 boot 不再 500（Failed to finish bootstrap instance 消失）