# v1-removal Tasks

> 分组与依赖见 design.md §3-D20。每组收尾跑**全量**测试（4/4 分片铁律，②格 §11-28），非仅受影响面。
> 每个实现提交带 `OpenSpec-Change: v1-removal` trailer；移植上游迁移模式的提交 body 写 `Ported-from: <完整 SHA>`。

## G1 数据迁移层（core）

- [x] 1.1 新建 `core/src/session/v1-migration.ts`（bun/node 平台条件入口），自含冻结 V1 消息/part 形状子集（从 `schema/src/v1/session.ts` 机械复制，标注冻结契约）
- [x] 1.2 实现迁移流程：完成锚点短路（`data_migration` 插 `v1-session-migration`）→ `message` 表 DISTINCT session_id 游标（KV 断点）→ 每会话一事务（先删后插 `session_message`、水位续号写回、删 V1 event 行、`session` 汇总列回填、写游标）→ 完成插锚点；`Semaphore(1)`
- [x] 1.3 转换规则：User/Assistant/part 逐类型映射（content 项 id 合成、ToolState structured={}、错误塌缩 unknown、FileAttachment uri、Compaction.recent 必填）、工具名改写 `task→subagent`（参数 `subagent_type→agent`、`task_id→sessionID`）与 `filePath→path`
- [x] 1.4 移植上游 `v1-migration.test.ts` 测试模式并按 fork 形状差重写断言
- [x] 1.5 接线：`V1Migration.layer` forkScoped，opennovel server/runtime 在 Database 就绪后接线
- [x] 1.6 真实数据副本演练（本机 `opennovel.db` 复制件，393 会话/4129 message）：历史会话 V2 面可见（4142 行全量 decode 零失败）、锚点短路、重复跑零变化——记录于 design §11

## G2 V2 生命周期事件与 move 补全（schema+core+app）

- [x] 2.1 `session.next.created` / `session.next.deleted` durable 事件定义（V2 形状 payload）
- [x] 2.2 projector 新分支（Created→SessionTable 插入含 WorkspaceTable.time_used；Deleted→删除）
- [x] 2.3 `SessionV2.create`/`remove` 改发新词汇，删 `legacyInfo`；保留 `SessionAlreadyProjected` 竞态语义
- [x] 2.4 `SessionV2.move` 实现（发布 `SessionEvent.Moved`）；`OperationUnavailableError` 词表清理
- [x] 2.5 app reducer 改消费新词汇（`event-reducer.ts`、`server-session.ts`、`server-sync.tsx`），删 `session.updated`（V1）分支
- [x] 2.6 `EventManifest.Latest` 加新事件、计数更新；protocol 文档串同步（`packages/protocol/src/groups/session.ts:282` 提及 `session.deleted`）

## G3 opennovel legacy 面删除

- [x] 3.1 端点裁撤：session（V1 部分）/permission/question/tui/sync 组、workspace-routing middleware、experimental 的 session 部分及对应 handlers
- [x] 3.2 删 `src/session/` legacy 模块（逐一核实，V2 复用的保留）、`src/agent/` legacy registry、`src/tool/` legacy 注册表、`src/permission/`、`src/question/`、command 的 LegacyEvent 发布
- [x] 3.3 `control-plane/workspace.ts` 改造：Session→SessionV2（remove/move）、SessionPrompt.cancel→interrupt、EventV2Bridge→EventV2 原生
- [x] 3.4 其余调用方改造：app-runtime/bootstrap 接线、plugin/skill/image/lsp/mcp/project/cli run；auth 插件活路径核实（D16）
- [x] 3.5 pin 已删面的测试随删；保留套件改 V2 装置
- [x] 3.6 `event-v2-bridge.ts` 删除（D15）：publish 消费方切 `EventV2.Service` + 位置附加助手；GlobalBus sync 信封桥接 re-home 为服务图节点

## G4 share/import 删除

- [x] 4.1 删 `src/share/`、`cli/cmd/import.ts`、app 四处 share 调用点
- [x] 4.2 `SessionShareTable` 代码定义删除（物理表保留）；`cli/cmd/export.ts` 数据源核实与处置（D13）

## G5 config 冻结与 core/schema V1 删除

- [x] 5.1 `core/src/v1/config/` → `core/src/config/v1/` 机械搬迁；core migrate 路径、远端 provider 解码（`plugin/provider/opennovel.ts`）、opennovel 管线（30+ 消费方）、`opennovel/script/schema.ts`（config JSON schema 生成）import 统一改新路径
- [x] 5.2 删 `core/src/v1/session.ts`、`core/src/v1/permission.ts`；sql.ts 删 `MessageTable`/`PartTable`、permission 列类型改注（D18）
- [x] 5.3 projector 删 V1 分支；`core/src/session.ts` 删 SessionV1 兼容发布与 import
- [x] 5.4 删 `schema/src/v1/` 四文件 + 三转发壳；durable/live manifest 收敛、`Latest.size` 更新
- [x] 5.5 drizzle 快照核实：无 DROP TABLE 产出

## G6 生成物与收尾

- [x] 6.1 `packages/client` `bun run generate` + `packages/sdk/js/script/build.ts` 重生
- [x] 6.2 全量回归：各包 `bun typecheck`、仓库根 `bunx oxlint`（0 errors）、`bun test` 4/4 全量
- [x] 6.3 design §11 落地核实补齐；`openspec validate v1-removal`

## Implementation Commits

（`git log --grep "OpenSpec-Change: v1-removal" --format="%h %s"` 收集，docs(openspec) 记录提交除外。）

- G1 数据迁移层：`82e0f0c449` feat(core): V1 会话数据迁移层；`0c4a83a86d` fix(core): 迁移兜底清理无消息会话的 V1 事件行
- G2 V2 生命周期事件：`82b29ed7a2` feat(core): V2 生命周期事件接班与 SessionV2.move；`b4a042402c` test(core): session 测试切换 V2 生命周期事件词汇；`e26d6b4b53` docs(protocol): session.delete 描述同步 session.next.deleted 事件名
- G3.1 端点裁撤：`cddc4d57ca` feat(opennovel): 裁撤 V1 端点面与 legacy 路由耦合
- G3.3 control-plane（Wave A）：`75f7d4effe` refactor(opennovel): control-plane 切 V2 会话面与事件原生面
- G4 share/import（Wave B）：`92ca8d95fa` feat(opennovel): 删除 share/import 面（opncd.ai 外部依赖 + V1 wire）
- G3.2/G3.4/G3.5（Wave C）：`d215246ab5` feat(opennovel): 裁撤 legacy /agent /command /experimental/tool 端点并切 V2 面；`d2f53d2286` refactor(opennovel): 调用方脱离 V1 事件/权限/消息面；`94392d6ae3` feat(opennovel): 删除 legacy session/tool/agent/permission/question/command 树
- G3.6 event-v2-bridge（Wave E）：`e33913d20e` feat(opennovel): 删除 event-v2-bridge 并落地 EventV2 位置附加与 GlobalEventBridge re-home
- G5 config 冻结与 V1 删除：`87f528abbf` refactor(core): 冻结 config 管线搬迁 core/src/v1/config 至 core/src/config/v1；`cdf9c4f0d2` refactor(core): 删除 core 与 schema 的 V1 残余并收敛事件 manifest
- G6 生成物与收尾：`794fe08581` refactor(sdk): 重生 client/SDK 生成物并冻结 V1 视图模型契约

### 归档后收尾修复

- `4fed136487` test(opennovel): workspace-adapter 层图补 SessionExecution 绑定——G3.3 让 Workspace 依赖全局 SessionV2（后者引用 unbound 的 SessionExecution.node），测试图缺生产图 buildLocationServiceMap 里的绑定，opennovel#test 自 2026-10-27 该提交进入 main 起编译期即抛 Unbound layer node
