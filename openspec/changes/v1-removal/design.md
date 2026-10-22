# v1-removal Design

> v1-retirement-roadmap 第③格。前置：runtime-v2-cutover（第②格）已归档并合并 main（`58f584f039`）。
> 本文以两份专项侦察（V1 代码面清单、V1 数据迁移面）与上游 `v1-migration.bun.ts`（基线 `9d90d892dc`，本地镜像 `D:\AI\Codes\opencode`）为输入，所有关键事实均已对照 fork 现状核实。

## 1. 对 proposal 骨架的修订

侦察结论与骨架表述存在四处出入，按「依据优先于直觉」修订：

1. **「死代码」表述不成立**。`opennovel` legacy session 面（约 20 模块）由 instance httpapi legacy 端点、workspace 控制面（fork 活功能）、share 面驱动；legacy config 管线是 fork 现役配置系统（30+ 消费方）。本格主体是**活契约束删除**，不是死代码清理。
2. **config 不是删除而是冻结**。V1 配置文件形状是活兼容契约：`core` Config.Service 的 `ConfigMigrateV1` 迁移路径（用户 `opennovel.json` 大量为 V1 形状，e2e `providerCfg` 亦然）、`core/src/plugin/provider/opennovel.ts` 远端响应解码（`RemoteResponse = { config: ConfigV1.Info }`）、opennovel legacy 管线基类型。处置：整体冻结搬迁，见 §7。
3. **share/import 面删除而非移植**。share 的 wire 契约是 V1 形状、目标是上游托管外部服务（`opncd.ai`）；「移植」等于长期维护一个 V1 转换层，与本格目标直接冲突。app 侧 share 入口在②格已对 V2 会话隐藏，删除是自然收口。
4. **create/remove 的 V1 发布是投影机制本身**，不只是兼容通知：`SessionV2.create` 发布 `SessionV1.Event.Created`（durable），projector 对应分支执行 SessionTable 插入；`remove` 同理。删除 V1 词汇前必须先有 V2 生命周期事件接班，见 §5。

## 2. 现状关键事实（已核实）

### 2.1 数据模型

- V1/V2 会话共享一张 `session` 表（V1 会话由 projector 投影进同表）——**迁移不需搬 session 行**，只需回填汇总列。
- V1 内容在 `message`（data = SessionV1.Info 去 id/sessionID）与 `part`（data = SessionV1.Part 去三键）两表；V2 在 `session_message`（type+seq+data，`SessionMessage.Message` 8 类型标签联合：AgentSwitched / ModelSwitched / User / Synthetic / System / Shell / Assistant / Compaction）与 `session_input`。
- `session_message` 有 `UNIQUE(session_id, seq)`；`session_input` 有 `UNIQUE(session_id, admitted_seq)` 与 `UNIQUE(session_id, promoted_seq)`——seq 空间与 durable 事件 seq 同源（projector 写行时 `seq = event.durable.seq`）。
- `event` / `event_sequence`：durable 事件表。**全部 V1 session 事件均为 durable**（`aggregate: "sessionID"`, `version: 1`，见 `schema/src/v1/session.ts:502`），因此每个 V1 会话聚合在 `event_sequence` 已有水位行。新事件分配 `seq = latest + 1`（0 起，`core/src/event.ts:249,294`）。
- `todo` 表是 V2 活表（`core/src/session/todo.ts`，`@opennovel/v2/SessionTodo`），**不在删除范围**；`opennovel/src/session/todo.ts` 是 legacy 面，随删。
- `data_migration` 表（`{name TEXT PK, time_completed INTEGER}`）全仓零引用——作为迁移完成幂等锚点。
- DB 位置：`OPENNOVEL_DB` 环境变量优先，否则 `Global.Path.data` 下渠道制 `opennovel.db` / `opennovel-local.db`（本机开发库即后者）。项目级 `.novel/novel.db` 只存小说内容，与会话无关。

### 2.2 事件流

- `EventV2.replay` / `replayAll` 的生产调用方只有两处：`server/routes/instance/httpapi/handlers/sync.ts:54` 与 `control-plane/workspace.ts:351,402`——均在②格 §7.4 保留清单（本格删除/改造）。`project()` 是 live 订阅；`server/init-projectors.ts` 是空操作——**不存在启动全量回放**。replay 遇未知 durable 事件类型会 `Effect.die`（`event.ts:447-449`）。
- V1 事件发布面：`core/src/session.ts:302`（Created）、`:571`（Deleted）+ opennovel legacy session 面（`session/session.ts:533,616,625,631,740`、`message-v2.ts:56-58`，随面删除）。
- app（`packages/app`）消费 `session.created` / `session.updated` / `session.deleted`（V1 词汇）与 `session.next.updated`（V2）：`context/global-sync/event-reducer.ts`、`context/server-session.ts:947-965`、`context/server-sync.tsx:400`。

### 2.3 代码面

- `core/src/v1/`：`session.ts`、`permission.ts`（均近纯转发 schema v1）+ `config/`（17 模块，活契约）。
- `packages/schema/src/v1/`：`session.ts`、`permission.ts`、`question.ts`、`legacy-event.ts` + 顶层转发壳 `session-v1.ts`、`permission-v1.ts`、`question-v1.ts`。`durable-event-manifest.ts:13` 聚合 V1 durable 定义。
- `opennovel` legacy session 面：`src/session/`（prompt 循环、processor、message-v2、revert、retry、compaction 等约 20 模块）、`src/agent/`、`src/tool/` 注册表、`src/permission/`、`src/question/`、`src/command/` 的 LegacyEvent 发布。
- ②格 §7.4 保留清单（本格全部处置）：V1 `/session/*` 路由组与 handler、`permission` 组、`tui` 组、`handlers/sync.ts`、`middleware/workspace-routing.ts`、`handlers/experimental.ts` 的 session 部分、V1 plugin host（auth 插件活路径）、`EventV2Bridge`。
- `control-plane/workspace.ts`（973 行）是 fork **活功能**（workspace 同步 / session warp），骑在 legacy 面上：`Session.Service`（`setWorkspace`、`remove`）、`SessionPrompt.Service`（`cancel`）、`EventV2Bridge.Service`（`replay`、`claim`）。SessionV2 目前**无 move**（`OperationUnavailableError` 词表 `"move"` 残留即此），但 `SessionEvent.Moved` 的 projector 分支已存在（`projector.ts:243-258`，含 `workspace_id` 更新与 `SessionContextEpoch.reset`）。
- `share/`：`share-next.ts` POST 到 `(yield* cfg.get()).enterprise?.url ?? "https://opncd.ai"`，wire 契约 V1 形状（session/message/part/session_diff/model key 体系）；`share/session.ts` 为旧 share。app 调用点：`session-header`、`open-in-app`、`use-session-commands`、`message-timeline`。`.github/` 无 share 引用。
- `packages/{server,client,protocol,tui}` src 零 V1 残留。

### 2.4 fork 与上游迁移场景的实质差

1. fork 无上游的 `session_v2` 表——不搬 session 行，只回填汇总列。
2. fork 无 `opencode-next.db` 导入场景——单库。
3. fork 的 V2 消息形状与上游 5 处实质差（transform 不能原样照抄）：① `Compaction.recent` 必填（上游可选）；② content 项要求 `id`（需合成）；③ 错误词汇只有 `{type:"unknown", message}`（上游的细分错误类型全部塌缩）；④ `ToolStateCompleted.structured` 必填且无 `metadata`（给 `{}`，V1 metadata 丢弃）；⑤ `FileAttachment` 用 `uri` 不带 base64（V1 `url` 原样进 `uri`）。
4. 工具名差（全量核对结论）：唯一改名 `task` → `subagent`（参数 `subagent_type`→`agent`、`task_id`→`sessionID`）；`read`/`edit`/`write` 的 `filePath`→`path`。上游的 `bash→shell`、`apply_patch→patch`、todowrite 移除、skill `name→id` 均不适用 fork。V1 有而 V2 无的历史 part 类型（invalid / lsp / plan_exit / execute 等）原名保留。

## 3. 决策汇总

| # | 决策点 | 定案 |
|---|--------|------|
| D1 | 迁移范围 | `message`/`part` → `session_message` + `session` 汇总列回填 + `event_sequence` 水位续号 + V1 durable 事件行清理。不搬 session 行、不动 `session_input`（V1 无 inbox 概念）、不动 `todo` |
| D2 | 迁移代码的 V1 形状依赖 | 迁移模块**自含冻结 V1 形状子集**（从 `schema/src/v1/session.ts` 机械复制所需消息/part 解码定义），不 import `core/src/v1` 或 `schema/src/v1`——删除面与迁移层零牵连 |
| D3 | 转换规则 | 按 §2.4 fork 形状差改造上游 `transformSession`；工具名改写仅 `task→subagent` 与 `filePath→path` |
| D4 | 幂等与断点 | 双层：`data_migration` 插入 `name='v1-session-migration'` 为完成锚点（启动短路）；KV 表记 `{cursor}` 断点续跑。每会话一事务、`session_message` 先 DELETE 后 INSERT、`Semaphore(1)` |
| D5 | seq 水位 | 迁移为该会话分配的 seq 从 `event_sequence` 现有水位续号；事务内写回水位；删除该聚合 V1 event 行（保留水位行）——后续 V2 drain 续号不撞 `UNIQUE(session_id, seq)` |
| D6 | 触发面 | opennovel 启动自动跑（core 提供 `V1Migration.layer`，forkScoped 后台执行，完成锚点短路），**不加状态 HTTP 端点**（日志可查，避免冗余面） |
| D7 | 竞态窗口 | 迁移完成前对 V1 会话发起 drain 会读到空 history——同上游口径接受（迁移秒级完成、仅影响首次启动瞬间的历史会话续聊），design 记录不额外设计闸门 |
| D8 | 原表处置 | **不删行**：`message`/`part` 物理保留，代码定义（`MessageTable`/`PartTable`）删除，drizzle 不产出 DROP 迁移（快照手工维护） |
| D9 | V1 durable 事件行 | 迁移事务内删除该会话聚合的 event 行（V1 词汇在事件表绝迹，杜绝未来任何 replay 路径 `die`）；水位行保留（D5）。推论：迁移后 `SessionV2.events` 对历史会话返回空——src 无消费方，可接受 |
| D10 | 生命周期事件 | 新增 `session.next.created` / `session.next.deleted`（durable，V2 形状）；`SessionV2.create`/`remove` 改发新词汇，projector 新分支接替 SessionTable 插入/删除；app reducer 改消费新词汇 |
| D11 | SessionV2.move 补全 | 实现 `SessionV2.move`（发布 `SessionEvent.Moved`，projector 分支已存在）——control-plane `sessionWarp` 改造的前置；`OperationUnavailableError` 词表残留（`["move","shell","skill","switchAgent"]`）随 shell/skill 一并清理 |
| D12 | control-plane 改造 | `Session.Service` → `SessionV2`（`remove`、新增 `move`）；`SessionPrompt.cancel` → `SessionV2.interrupt`；`EventV2Bridge` → 直接用 `EventV2.Service`（`replay`/`claim` 为原生方法） |
| D13 | share/import 删除 | `share-next.ts`、`share/session.ts`、`cli/cmd/import.ts`、app 四处调用点、`SessionShareTable` 代码定义（物理表保留同 D8）。`cli/cmd/export.ts` 实现时核实其数据源后处置（若读 V1 表则改读 `session_message`） |
| D14 | config 冻结 | `core/src/v1/config/` 整体搬迁至 `core/src/config/v1/`（所有权从 V1 遗产转为 core config 子系统的冻结文件格式契约），core migrate 路径、远端 provider 解码、opennovel legacy 管线统一改引新位置——单一所有权、零重复副本、机械搬运零重写 |
| D15 | EventV2Bridge 删除 | 随 share 面与 control-plane 改造（D12/D13）删除 `src/event-v2-bridge.ts` 及其接线 |
| D16 | V1 plugin host | ②格 §7.4 标注「auth 插件活路径」——实施时核实 auth 插件实际消费的 host 面，保留活路径所需最小面、删除其余 |
| D17 | schema 删除 | `schema/src/v1/` 四文件 + 三转发壳删除；`durable-event-manifest.ts` 移除 V1 聚合；`event-manifest` 同步收敛，`Latest.size` 硬编码计数更新 + 新增事件入清单 |
| D18 | SessionTable.permission 列 | 列数据不动，类型从 `PermissionV1.Ruleset` 改注 core PermissionV2 规则集类型；形状不兼容处由迁移在回填时转换（实施时以两边 schema 对照为准） |
| D19 | SDK/生成物 | 端点裁撤后 `packages/client` `bun run generate` + `packages/sdk/js/script/build.ts` 双重生（AGENTS.md 规则） |
| D20 | 分组顺序 | G1 迁移层 → G2 生命周期事件与 move → G3 opennovel 面删除 → G4 share/import → G5 config 冻结与 core/schema 删除 → G6 生成物与全量收尾 |

## 4. G1：数据迁移层

### 4.1 模块与形状

新模块 `packages/core/src/session/v1-migration.ts`（平台条件入口仿上游 `#v1-migration`：bun → 真实现，node → noop）。自含冻结 V1 形状子集（D2）：从 `schema/src/v1/session.ts` 机械复制 `Info`（User/Assistant）与 `Part` union 中迁移实际消费的定义，放 `v1-migration/` 子目录或同文件内，标注「冻结契约——仅迁移使用，禁止新引用」。

### 4.2 流程（移植上游模式，`Ported-from` 标注）

1. 完成锚点检查：`data_migration` 存在 `name='v1-session-migration'` 行 → 整体短路。
2. 判据：`message` 表 `SELECT DISTINCT session_id`（按 session id DESC 游标，KV 表存 `{cursor}` 断点）。
3. 每会话一事务（`immediate`）：
   a. 读该会话全部 message + part 行，按 §4.3 转换；
   b. `session_message` 先 `DELETE WHERE session_id=?` 后 INSERT（幂等）；
   c. seq 分配：从 `event_sequence` 该聚合现有水位续号，事务内写回水位（D5）；
   d. 删除该聚合 V1 event 行（D9）；
   e. `session` 汇总列回填（cost/tokens/time_updated 等由 step-finish 与消息时间推导——实现时对照 projector `applyUsage` 语义）；
   f. 写 KV 游标。
4. 全部完成后插 `data_migration` 锚点行。
5. `Semaphore(1)` 防并发重入。

### 4.3 转换规则要点

- V1 User 消息 + text/file/agent parts → V2 `User`（text 拼接、files 进 `FileAttachment(uri)`、agents 进 agents 字段）。
- V1 Assistant 消息 + parts → V2 `Assistant`：`text`→`AssistantText`、`reasoning`→`AssistantReasoning`、`tool`→`AssistantTool`（name 改写 + state 映射：completed → `structured: {}`、error → `{type:"unknown", message}`）；`step-finish` 不回填 content 项，只用于 Assistant 行 `finish`/`cost`/`tokens` 与 `session` 汇总列。
- content 项 `id` 合成（沿用 part id 或派生），满足 §2.4-③。
- 会话级 summary/compacting 痕迹映射 V2 `Compaction`（`recent` 必填——无对应数据时给空串，实现时定夺并注明）。
- 工具名改写仅 D3 两组；其余原名保留。
- 上游 `packages/core/test/v1-migration.test.ts`（1400+ 行）测试模式可移植，提交 body 写 `Ported-from: <完整 SHA>`；按 fork 形状差重写断言。

### 4.4 接线

core 提供 `V1Migration.layer`（forkScoped 立即后台跑）；opennovel server/runtime 在 Database 就绪后、会话服务可用前接线。CLI 一次性进程同样触发（幂等无妨）。

### 4.5 演练

迁移测试除单元层外，必须在**真实数据副本**（本机 `opennovel-local.db` 复制件）上跑一遍：迁移后 V2 面可见历史会话（消息/工具调用/父子关系完整）、锚点短路生效、重复跑零变化。另加一项**续聊冒烟**：对迁移会话发起一轮 V2 prompt（`SessionContextEpoch` 对无 epoch 行会话懒初始化，已核实 `context-epoch.ts:27` 容忍缺失）——确认 history 装载与 drain 全链路不炸。

## 5. G2：V2 生命周期事件与 move 补全

- `schema/src/session-event.ts` 新增 `Created`（`session.next.created`，durable）与 `Deleted`（`session.next.deleted`，durable）。Created payload 承载投影所需字段的 V2 形状（id/projectID/directory/path/workspaceID/parentID/slug/title/agent/model/version/metadata/permission/time）——不嵌 V1 SessionInfo。
- projector 新分支：Created → SessionTable 插入（含 WorkspaceTable.time_used 更新，现 `projector.ts:215-234` 逻辑平移）；Deleted → SessionTable 删除（FK 级联清各会话表，现 `:259-261` 平移）。
- `SessionV2.create` 改发 Created（保留 `SessionAlreadyProjected` 竞态语义）；`remove` 改发 Deleted + 保留 `events.remove(sessionID)`；删除 `legacyInfo` 与 `SessionV1` import。
- app：`event-reducer.ts` / `server-session.ts` / `server-sync.tsx` 的 `session.created`/`session.deleted` 分支改新词汇；`session.updated`（V1）分支删除（V2 标题/归档更新走 `session.next.updated`，已消费）。
- `SessionV2.move`：发布 `SessionEvent.Moved`（projector 分支已存在）；`OperationUnavailableError` 词表收敛（shell/skill 仍 throw 但词表更新为实际状态，或随 HTTP 面无触发面整体删除——实现时定夺并注明）。
- 事件清单：`EventManifest.Latest` 加两个新事件、移除 V1 聚合，`Latest.size` 更新。

## 6. G3：opennovel legacy 面删除

1. **端点裁撤**（先行）：`groups/session.ts` V1 部分、`groups/permission.ts`、`groups/question.ts`、`groups/tui.ts`、`groups/sync.ts`、`middleware/workspace-routing.ts`、`groups/experimental.ts` 与 `handlers/experimental.ts` 的 session 部分，及对应 handlers。
2. **驱动面删除**：`src/session/` legacy 模块（prompt/、processor、message-v2、session、revert、retry、compaction、overflow、reminders、run-state、summary、todo、instruction、llm 面中仅服务 V1 的部分——逐一核实，V2 复用的保留）、`src/agent/` legacy registry、`src/tool/` legacy 注册表（保留 V2 工具实现）、`src/permission/index.ts`、`src/question/index.ts`、`src/command/index.ts` 的 LegacyEvent 发布。
3. **调用方改造**：`control-plane/workspace.ts`（D12）；`app-runtime` / `project/bootstrap` 接线摘除；`plugin/index.ts`、`skill/index.ts`、`image/image.ts`、`lsp/`、`mcp/`、`project/`、`cli/cmd/run.ts` 等对 legacy 面的引用逐一改造或随删；auth 插件活路径按 D16 核实。
4. **测试面**：pin 已删面的测试随删（参照②格 F② 处置法）；保留套件改 V2 装置。

## 7. G4：share/import 删除

- 删 `src/share/`（share-next、session）、`cli/cmd/import.ts`、app 四处调用点（`session-header`、`open-in-app`、`use-session-commands`、`message-timeline` 的 share 入口）。
- `SessionShareTable` 代码定义删除、物理表保留（同 D8）；`session.share_url` 列保留（历史数据，不再写入）。
- `cli/cmd/export.ts` 按 D13 核实处置。
- ShareNext 账号体系（`Account.Service`）是账号面，不动。

## 8. G5：config 冻结与 core/schema V1 删除

1. `core/src/v1/config/` → `core/src/config/v1/` 机械搬迁（17 模块）；`core/src/config.ts`、`core/src/plugin/provider/opennovel.ts`、opennovel legacy 管线（30+ 消费方）、`opennovel/script/schema.ts`（config JSON schema 生成，消费 `ConfigV1.Info`）import 统一改新路径。
2. 删 `core/src/v1/session.ts`、`core/src/v1/permission.ts`；`core/src/session/sql.ts` 删 `MessageTable`/`PartTable`（D8）、`SessionTable.permission` 类型改注（D18）。
3. projector 删 V1 分支（`:36-110` 的 V1 辅助、`:215-241` Created/Updated、`:259-330` Deleted/Message*/Part*）。
4. `core/src/session.ts` 删 SessionV1 import 与兼容发布（G2 已切换）。
5. 删 `schema/src/v1/` 四文件 + `session-v1.ts`/`permission-v1.ts`/`question-v1.ts` 转发壳；manifest 收敛（D17）。
6. drizzle 快照手工维护：确认无 DROP TABLE 产出（物理表保留原则）。

## 9. G6：生成物与收尾

- `packages/client` `bun run generate`；`packages/sdk/js/script/build.ts` 重生（D19）。
- 全量回归：`bun typecheck`（各包目录）、`bunx oxlint`（仓库根，0 errors）、`bun test` 全量 4/4 分片（**组收尾必须跑全量而非受影响面**——②格 §11-28 分片遮蔽教训）。
- `openspec validate v1-removal`；收集 `OpenSpec-Change: v1-removal` 提交写入 tasks.md。

## 10. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 首次对历史数据做形状转换 | 真实数据副本演练（§4.5）为验收硬门槛；迁移幂等可重跑；原表不删行（D8）——迁移产出有误可删 `session_message` 行与锚点重来 |
| 迁移窗口内历史会话续聊读空 history | D7 口径接受；日志明确迁移进度 |
| 删除面误伤活路径（auth 插件、export、control-plane） | D16/D13/D12 实施时逐一核实消费方；每组收尾全量回归 |
| 事件词汇切换期 app 与 server 版本错位 | fork 单仓同发；app reducer 对新词汇未知时忽略不炸（实施时核实 reducer 默认分支行为） |
| config 搬迁引入 import 漂移 | 机械搬运 + 全仓 typecheck；冻结层禁止新增引用（注释标注） |

## 11. 落地核实

（实现时填写：实际删除/改造清单与侦察结论的偏差、D13/D16/D18 核实结果、演练记录、全量回归数据。）
