# Proposal

## Why

桌面端首页/全局启动链路以保留名 `global` 作为 location 目录发起请求（`directory=global` 与 `location[directory]=global`），服务端 LocationMiddleware 把它当字面路径处理：

- 旧构建把它解析为相对路径（落到服务端 CWD 下不存在的 `<cwd>/global`），触发 FileSystem.realPath ENOENT；
- 新构建 `AbsolutePath.make("global")` 直接抛 "Path is not absolute: global"。

两类表现同一根因：服务端从未定义 `global` 哨兵语义。结果是 /api/agent、/api/command、/api/reference、/api/session、/api/permission/request、/api/question/request 等全部 500，首页 boot 失败（Failed to finish bootstrap instance / Failed to load sessions），全局页完全不可用。

## What Changes

- 服务端 HTTP location 解析（LocationMiddleware 的目录解析）接受保留哨兵值 `global`，并将其解析为服务端全局数据目录（Global 数据目录，绝对路径）；其余值行为不变。
- session.list 按目录过滤的查询协议接受 `global` 哨兵，服务端按解析后的全局数据目录过滤会话；会话创建落在全局 location 时落库 directory 为解析后的全局数据目录。
- 修改 Protocol 后在 packages/client 重新生成 SDK；桌面端重启后全局 boot 链路恢复可用。

## Capabilities

### New Capabilities

- `global-directory-resolution`：服务端 HTTP location 与会话目录过滤对保留哨兵 `global` 的解析语义。

### Modified Capabilities

- 无

## Impact

- 受影响包：packages/server（location middleware、session handler）、packages/protocol（session 目录过滤查询 schema）、packages/core（session 存储过滤的哨兵解析）、packages/client（生成代码再生成）、packages/desktop（随构建获得修复，无代码改动）。
- 兼容性：既有会话落库 directory 均为绝对路径，不受哨兵语法影响；`global` 仅为查询参数保留值，不得作为文件系统字面路径参与任何解析。
- 验证影响面：HttpApi 行为变更，需跑 httpapi exerciser coverage；Protocol 变更需 generate 再验。

## 非目标

- 不改应用端 global sync 的目录键与事件路由架构（event.directory 归一逻辑维持现状）。
- 不为 workspace 引入类似哨兵；不处理 `global` 以外的伪路径值。
- 不改变全局数据目录的位置或内容（Global.Path.data 现状）。