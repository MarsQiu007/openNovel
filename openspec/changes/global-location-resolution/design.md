# Design

## 哨兵语义

`global` 是应用端 sync 层的既定伪目录键（home 全局页）。服务端将其映射为 `Global.Path.data`（全局数据目录），理由：

1. 绝对路径，满足 AbsolutePath 校验；
2. 不在任何 git 仓库内（Project.resolve 回落 ID.global，与「全局项目」语义一致）；
3. location 层构建时 Config 快照只含全局配置（无项目覆盖），正是全局 agent/command/reference 期望的数据源。

## 改动点

1. packages/server/src/location.ts：ref() 解析 `location[directory]` 与 x-opennovel-directory 头时，值精确等于 `global`（区分大小写）则替换为 Global.Path.data 再走 AbsolutePath.make；sharedRef 的已知 ref 失效机制不变。
2. packages/protocol/src/groups/session.ts：SessionsDirectoryQuery.directory 由 AbsolutePath 改为 Union([AbsolutePath, Literal("global")])；cursor 编解码沿用同一 schema，自动兼容。
3. packages/core/src/session.ts：ListDirectoryInput.directory 改为 Union([AbsolutePath, Literal("global")])；list 过滤（conditions.push(eq(SessionTable.directory, ...)) 处）对哨兵解析为 Global.Path.data；会话创建时落库 directory 已是 location 解析后的绝对路径，无需额外处理。
4. packages/client：bun run generate 重新生成。

## 权衡

- 备选「应用端不发 directory=global、改用全量查询客户端过滤」被否：客户端无法得知服务端全局数据目录路径，过滤不了。
- 哨兵精确匹配不做大小写归一，避免与真实名为 Global 的目录冲突；文档明确保留值。

## 测试策略

- server 包单测：middleware 对 `global` 的解析结果等于 Global.Path.data；非哨兵路径行为不变。
- server 包单测：session.list 哨兵过滤命中全局目录会话。
- httpapi exerciser coverage 模式全绿；typecheck + oxlint。