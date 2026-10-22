# Design: runtime-v2-cutover

> 基于三路全量侦查（opennovel V1 触点 / fork V2 面与上游参照 / novel-writer V1 耦合面）与关键机制逐一核实（SystemContext 代数、Context Epoch、canonical Tool、V2 压缩接线、插件宿主桥接）。上游参照：本机 checkout `D:\AI\Codes\opencode`（`4d5965762e`，基线 `9d90d892dc @ 2026-10-20`）。按 upstream-sync 规则逐项记录适配点；与 proposal 表述冲突处以核实结果为准。

## 0. 移植映射总表

| 上游件 | fork 落点 | 适配类型 |
| --- | --- | --- |
| `plugin/src/effect/tool.ts`（ToolDomain/ToolEditor）+ `core/src/tool.ts`（State.Transformable） | `plugin/src/v2/effect/tool.ts` 契约 + core `plugin/host.ts` 桥（包装 canonical `Tool.make` 经 `Tools.Service.register`） | 结构适配（收窄见 §1） |
| `PluginContext.location: Location.Info` / `app: App` | `ctx.location` + `ctx.paths`（全局 config 目录） | 收窄移植 |
| session 域（SessionDomain） | `ctx.session` 最小读域（`get(id)`） | 收窄移植 |
| session `command` 端点与执行语义 | `SessionV2.command` + protocol/server 端点 | 语义移植 |
| `wait` 端点语义 | `SessionV2.wait`（等当前 drain 落定） | 语义移植 |
| 手动 compact（上游 compaction 面） | `SessionV2.compact` 接通 fork 既有 `SessionCompaction` | 缺件补齐 |
| 插件压缩注入 hook（SessionCompaction hook） | **不移植**——V2 Context Epoch 架构下职责消解（§4） | 架构性省略 |
| `experimental.chat.system.transform`（V1） | SystemContext 源（`ctx.systemContext.register`） | fork 原生路径（根 AGENTS.md 既定架构） |

**结构总差异（工具注册通道）**：上游 core 工具面是 `State.Transformable`（editor 直接改全局工具态）；fork canonical 面是 scoped 注册（`ToolRegistry`，后注册赢、关 registration 露出下一个，`core/tool/AGENTS.md` 明令「不要第二种可执行入口」）。fork 的 ctx.tool 桥因此是「staging editor → 包装 canonical → scoped register」，不引入 Transformable（§1）。

## 1. ctx.tool 域（插件工具注册 V2 化）

**契约**（`plugin/src/v2/effect/tool.ts`，新增）：

- `PluginTool.Info`：`{ name, description, input: Schema.Codec, permission?, execute(input, ctx) => Effect<Result, Failure> | Promise<Result> }`；`Result = string | { title?, output, metadata? }`（插件契约内定义一次 effect Schema；**收窄**：上游 Result 的 attachments 在 88 个工具中零使用，不落；出现了再加）。
- `PluginTool.Context`：`{ sessionID, agent, messageID, directory, ask }`——对齐 88 个工具的真实用量（`ctx.directory`×174、`sessionID`×15、`agent`×2、`ask`×2；V1 的 worktree/abort/metadata/messageID 零使用，messageID 保留仅为契约对齐）。`ask` 签名对齐 V1 `AskInput {permission, patterns, always, metadata}`，宿主桥转 `PermissionV2.ask`。
- `ToolEditor`：`list/get/add/update/remove`（上游同名，**去掉 `namespace()`**——fork 无消费方）。
- `ToolDomain`：`transform(callback)` 沿用 `Hooks<Spec>` 形状（返回 `Effect<Registration, never, Scope>`）；`reload`/`list` 随 Hooks 惯例。**`execute.before/after` 拦截钩不落**——88 工具无需求，registry settle 链无插件拦截点，需要时独立设计。

**schema 收窄（关键决策）**：契约只收 effect Schema codec，不接上游 ValueSchema 三选一（effect Schema | StandardSchemaV1 | 裸 JsonSchema）。依据：canonical `Tool.make` 的 `input`/`output` 必须是 effect Schema codec（JSON Schema 由 `Schema.toJsonSchemaDocument` 生成），effect 4.0.0-beta.83 只有 `toStandardSchemaV1` 正向适配、无 `fromJsonSchema` 反向——支持 zod 必须造转换层，而转换层绕不开 canonical 的类型墙。88 个工具的 args 一次性机械迁移（§3），契约保持单一 schema 形态。

**宿主桥**（core `plugin/host.ts` 扩展）：`PluginHost.make` 增 yield `Tools.Service` / `Location.Service` / `PermissionV2.Service` / `SessionStore.Service` / `SystemContextRegistry.Service` / `Global.Service`（均 Location 树内节点，`location-services.ts:45-70` 核实；PluginV2 本身是 Location 节点，`plugin.ts:154-167`）。tool 域桥语义：

1. 每次 `transform(callback)` 建 staging editor（空表 + 当前已注册快照的只读视图）；`add` 校验名（`Tool.validateName`）并暂存；`update/remove` 只作用于本次 staging（跨注册摘除走 `Registration.dispose`——与 registry「关 registration 露出下一个」语义天然对齐）。
2. callback 返回后，staging 条目逐个包装为 canonical `Tool.make`：`input` = 插件 codec；`output` = 契约 Result schema；`execute` = 映射 canonical `Context`（`assistantMessageID→messageID`、Location 捕获的 `directory`、`ask` 桥）后调插件 execute（Promise 经 `Effect.promise`，错误收敛 `ToolFailure`）；`toModelOutput` = string 直出 / struct 取 `output` 字段为 text；`structured` 携 `title`/`metadata`。
3. 一次 `Tools.Service.register(staging)` 挂进该 transform 的 Registration scope（registration 关闭即整批摘除）。同名覆盖遵循 registry 既有语义（后注册赢；插件 boot 在内置之后，与 V1 插件工具同名优先行为一致）。
4. permission：默认 action = 工具名（与内置同款约定），`withPermission` 装饰接入 definition 过滤；写作 agent 的 `"*": "allow"` 通配自然放行，ideator 白名单按名过滤——与 V1 权限语义对齐。

落地后更新 `core/tool/AGENTS.md`「Current Gaps」首条（插件工具注册已定案，形态即本节）。

## 2. 其余插件域（location / paths / session / systemContext）

- **`ctx.location`**：`Location.Info`（`@opennovel-ai/schema/location`，插件包已依赖 schema，类型零成本）；桥 = 直传 Location.Service 快照。用途：88 工具的 `directory`（与 V1 `ctx.directory` 同语义：会话目录 = Location 目录）。
- **`ctx.paths`**：`{ config: string }`（core `Global.Service` 的全局 config 目录）。唯一消费方是全局灵魂文件 `soul.md`（server `handlers/soul.ts:9` 证实存储位置；V1 插件因「无 core/xdg 依赖不能解析全局路径」被迫走 HTTP 自调，V2 桥直给路径，TTL 缓存与 clientV2 调用一并删除）。
- **`ctx.session`**：`{ get(id): Effect<{id, parentID?} | undefined> }`，桥到 `SessionStore.get`（Location 节点，无 SessionV2 全局类型环）。唯一消费方：`resolveSessionNovel` 的父链归属继承（12 个工具 + 注入源使用），替代 V1 的 `clientV2.session.get` HTTP 自调。
- **`ctx.systemContext`**：`register(source: SourceDescriptor) => Effect<Registration, never, Scope>`。描述子 = `{ key, codec, load: Effect<Option<A>>, baseline, update, removed? }`（Option.None 映射 core `unavailable`；key 宿主侧按 `SystemContext.Key` 模式校验）。桥：`SystemContext.make` 包装 + `SystemContextRegistry.register`（scope 随 Registration）。代数/注册表/built-ins 留在 core `src/system-context`（根 AGENTS.md 既定），producer 随观察域留在插件——职责边界不变。

## 3. novel-writer 工具迁移（88 个）

- **新 V2 helper**：`plugin/src/v2/tool.ts`（或 `novel-writer/` 内部模块，实现时按复用面定）`defineTool({description, args: Schema.Struct.Fields, permission?, execute(args, ctx): Promise<ToolResult>})`——execute 保持 Promise 形态，**88 个函数体零改动**；args 从 zod raw shape 迁到 effect Schema fields（`tool.schema.string().describe(x)` → `Schema.String.annotate({description: x})` 级机械替换；`.optional()` → `Schema.optional`；`.default()` → 解码默认值构造；`.enum()` → `Schema.Literal` 联合）。
- **搬移**：工具定义从 `novel-writer.ts:537-5954` 搬入 `novel-writer/tools/`（按侦查归并的 13 个域分组，每域一文件），`novel-writer.ts` 本体随 §8 删除。纯逻辑模块（~50 个，零宿主依赖）原位不动。
- **`ctx.ask` 两处**（`organize_settings.apply`、`arc_rebuild`）：签名平移到 V2 ctx.ask，语义经 PermissionV2 ask 管线（durable `Permission.Event.Asked` + reply 端点）——比 V1 内存 Deferred 更强（重启可恢复询问态），无行为回退。
- **`ctx.agent` 两处**（写 `chapter_versions.created_by`）：V2 canonical Context 自带 `agent`，直传。
- **注册**：novel-writer V2 入口 `ctx.tool.transform` 一次注册全部 88 个。

## 4. 上下文注入 → SystemContext 源（含 compacting 消解论证）

V1 `experimental.chat.system.transform`（`novel-writer.ts:480-512`）三段注入的 V2 映射——**单一源** `novel-writer/context`：

- **value** = `{ mode, soul, snapshot }`：mode（`.novel/config.json` writing_mode/override，复用 `injectModeContext` 组装）、soul（`chooseSoul` 小说灵魂 + `ctx.paths.config/soul.md` 全局灵魂）、snapshot（复用 `injectSystemContext` 的 novel-store 组装：蓝图/角色/线索/伏笔/弧光/风格/世界观/题材规则）。
- **baseline** = V1 同序同文的三段拼装（模式契约 → 灵魂 → 快照）——新会话首轮即得与 V1 等价的完整注入。
- **update(prev, curr) 分支渲染**（依据 Context Epoch 语义，`context-epoch.ts:63-77`：`Updated` 保留旧 baseline、把 update 文本发为 durable `ContextUpdated` 系统消息）：
  - mode 或 soul 变化（罕见、语义关键——mode 管审批闸门）→ 渲染**全量新文本**；
  - 仅 snapshot 变化（每个写作步骤都变）→ 渲染**一行简短通知**（「小说上下文快照已更新，需要最新细节请调用 assemble_context_snapshot」），避免每轮把数千 token 快照重灌进历史。完整快照的权威通道本来就是流水线的 `assemble_context_snapshot`（步骤 2 显式调用），director 长会话退化为「基线快照 + 变更通知 + 按需刷新」。
- **条件注册**：Location 启动时 `.novel/` 存在才注册该源（非小说目录零污染；`unavailable` 会阻塞整会话初始化、`requireText` 禁止空渲染，两条路都排除过）。窗口边角：Location 已开后才 `novel init` 的目录需重开 Location 获得注入——桌面端「建项目→开目录」主流程不受影响，记为已知行为。
- **compacting 注入不重建（论证）**：V1 `experimental.session.compacting` 向压缩请求注入蓝图/活跃角色/当前卷摘要，是因为 V1 压缩整体替换消息列表、系统上下文随之蒸发。V2 压缩只截断历史（`history.ts:38` 按 compaction seq 截断），**SystemContext baseline 不随压缩消失**——小说上下文作为源常驻系统提示，V1 hook 的存在理由在架构上消解。摘要保真由既有 `SUMMARY_TEMPLATE` + recent 尾部保留（`compaction.ts:128-159`）承接。
- **顺序事实**：registry 按 key 排序组装 baseline（`registry.ts:40`），`core/builtins`（env/date）在 `novel-writer/*` 之前——与 V1「模式契约 unshift 到 system[0]」的绝对首位不同，但注入信息完整性与相对次序（模式→灵魂→快照）在源内保持，模型可见差异可忽略。

## 5. dispatch 契约与 permission 迁移（窗口时序）

- **契约差异**：V1 `task(subagent_type, prompt, task_id?, command?)` → V2 `subagent(agent, description, prompt, model?, sessionID?, background?)`。prompt 文本引用集中在 `agents/pipeline.ts`（11 处）与 `agents/director.ts`（4 处），其余 9 个 agent 零引用（已核实）。
- **时序（关键）**：`agents/*.ts` 的 prompt 与 permission map 是 V1/V2 双 runtime 的单源。组 D（消费方切换）完成前新产品会话仍可能是 V1——过早改 prompt/permission 会让 V1 流水线失配。因此：
  1. 组 B 只落 V2 基础设施与注册（V1 入口照旧，窗口内 V1 流水线不受影响；`novel-writer-v2.ts` 的 `task→subagent` 转换 shim 保留）；
  2. 组 D 完成、V1 会话创建面归零后，**组 E 首提交**切 prompt 文本（task→subagent 参数形状）+ permission map 键更名（`task: "allow"` → `subagent: "allow"`）+ 删转换 shim；
  3. 同批删 V1 task 工具与 novel-writer V1 入口（§8）。
- **权限派生语义差异（知情接受）**：V1 `deriveSubagentSessionPermission` 让子会话继承父的 `external_directory` 与 deny 规则；V2 子会话直接用子 agent 注册 ruleset（第①格设计）。写作 agent 的 permission map 自包含（10 个通配 allow + ideator 白名单），不依赖父级 deny 继承——迁移无行为回退；`subagent-permissions.ts` 随 task.ts 删除。
- **嵌套深度**：`experimental.subagent_depth=2`（第①格已落 config 与 init 接线），director(0)→pipeline(1)→执行者(2) 语义不变。

## 6. V2 Session 面补齐（core + protocol + server + SDK）

- **`SessionV2.wait`**：等当前 drain 落定（无 drain 即返回）。`SessionRunCoordinator` 已知 drain 生命周期，实现为订阅式等待；接通既有 protocol `POST /api/session/:id/wait`（当前处理器走 service 必然抛 `OperationUnavailableError`）。消费方：CLI `run` sync 流程、github 替代面、ACP（后两者随删除决策落空——wait 的实际消费方以 run 为准，仍属必要面）。
- **`SessionV2.command`**：斜杠命令执行（app `submit.ts:84` 的 `client.session.command` 是活 UX：命令面板 + `/` 前缀）。语义：CommandV2 解析命令名 → 模板展开（arguments 代入）→ 作为用户 prompt 走 durable admission + wake（不新建执行通道）。端点参照上游 `POST /api/session/:id/command` 补齐 protocol/server。
- **`SessionV2.compact`（手动）**：接通 runner 既有 `SessionCompaction.compactAfterOverflow`（事件 reason 增 `"manual"`；`Compaction.Started/Ended` 投影已就绪），替代 V1 `/session/:id/summarize`（app 命令面板有入口）。自动压缩第①格前已在 V2 接线（`llm.ts:215,370`），无需新增。
- **`SessionV2.shell` / `SessionV2.skill`：不实现**。两端点均无 app/CLI 消费方（已核实：submit.ts 只调 command/promptAsync/abort；`debug skill` 仅列技能不走会话执行）；保持 `OperationUnavailableError`，shell 留 fast-follow 独立 change。
- **端点补齐原则**：app 切换中逐页核对 V2 面够用性（已知候选：session title 更新、分页消息列表——V2 现有 `context` 整包 + `history` + 单条 `message`）；缺则参照上游 `protocol/src/groups/session.ts` 补，**契约变更后在 `packages/client` 跑 `bun run generate` 重生成 SDK**（禁手改 generated）。

## 7. 消费方切换

### 7.1 app（`client.session.*` → V2 面）

| 调用点 | 切换目标 |
| --- | --- |
| `components/prompt-input/submit.ts:84,155,236`（command / promptAsync / abort） | `POST /api/session/:id/command` / `prompt`（异步语义：客户端不等 drain）/ `interrupt` |
| `pages/novel/session-switcher.tsx:75`、`workspace-data.ts:120,123,166`、`workspace-frame.tsx:742,809`（create/prompt/abort） | V2 create/prompt/interrupt |
| `pages/session.tsx:1800`、`use-session-commands.tsx:319`（abort、summarize 等） | interrupt / compact |
| `context/directory-sync.ts:126,136`（list/update） | V2 list；title 更新走 C 组新增 `session.update`（PATCH） |
| `context/permission.tsx:238`（respond）+ 自动应答 | V2 `permission/reply`、`question/reply|reject` 端点；pending 对账切 V2 全局 `permission.request.list` / `question.request.list`（C 组既有面），事件流增量走 `Permission.Event.Asked`（durable） |
| `context/global-sync/event-reducer.ts` 等事件消费 | V1 `session.*` 事件词汇 → V2 `session.next.*`（全局 SSE `client.v2.event.subscribe`） |
| `experimental.session.list`（2 处搜索面） | V2 `session.list`（带 search 参数） |
| share / unshare（message-timeline、use-session-commands、github.handler） | V2 会话无 V1 消息流同步源，share 入口对 V2 会话隐藏；share 服务留第③格 |
| composer shell 模式（submit.ts:449） | V2 不实现 shell（§6），入口禁用，fast-follow |
| revert / unrevert（5 处） | `revert.stage` / `revert.clear`；`revert.commit` 消费方不调（V2 runner 无自动 commit，已知差异记 §11） |
| busy/idle（SSE `session.status` 消费点全集） | 轮询 `GET /api/session/active`（durable 事件触发 + busy 期间定时）；`session.next.retried` 推导重试态；usage-exceeded upsell 的 action 字段 V2 无对应，降级通用重试提示 |

D 组侦察确认的三个端点缺口随 D0 补齐：`session.delete`（`SessionV2.remove` + DELETE 端点，app message-timeline 与 CLI `session delete` 共用；V1 remove 删不干净 V2 投影表）、`GET /api/session/:id/todo`（SessionTodo.get 只读）、`GET /api/session/:id/diff`（Snapshot.diff，语义=会话累计 diff：首个 snapshot.start → 最新）。会话列表事件口径：创建沿用 V1 durable `session.created`（V2 create 既有发布），更新 `session.next.updated`，删除沿用 V1 durable `session.deleted`（与 created 对称，§11-15）。

会话时间线渲染策略（定为方案 b）：store 层做 **V2→V1 消息适配器**——`SessionMessage.Message` union 适配为 V1 Message+Part 形状（assistant `content[]` → Text/Reasoning/Tool 伪 Part；`parentID` = 前最近 user；compaction → 合成 user 消息带 compaction part），timeline/session-ui/乐观层/导出链路零改动；system/synthetic/agent-switched/model-switched/shell 首版不渲染（跳过）。server-session.ts 双源对账层整体重写为 V2 durable 单源（首页 REST `session.messages` + SSE 增量，cursor 从 x-next-cursor 响应头改响应 body）。乐观更新简化：用 prompt/command 的 Admitted 回执构造乐观 user 消息，`session.next.prompted` 确认。

prompt/command 的单次 agent/model/variant 覆盖：提交前与会话当前值比较，不同则先 `switchAgent`/`switchModel` 再提交（durable 事件进时间线）；command 的图片 parts 丢弃。`map-view.tsx` 已走 V2（现存先例）。

### 7.2 CLI / opennovel 进程内消费

| 面 | 处置 |
| --- | --- |
| `cli/cmd/run.ts`（经 SDK 创建+prompt，:715-730 权限自动应答） | 切 V2 client：create → prompt → `wait` → 读尾消息；自动应答改 V2 reply 端点；死代码 `createFreshSession`/`runMini` 不搬（切换时删除） |
| `cli/cmd/session.ts`、`stats.ts`、`export.ts` | 读取面切 V2 Session/消息形状；`session delete` 走 D0 新增 DELETE 端点 |
| `cli/cmd/import.ts`（直写 V1 行，share 导入） | **保留**：share 服务活跃（app 仍调用），导入面随 share 整体留第③格 |
| `control-plane/workspace.ts:158,583`（仅 cancel） | 改 `SessionV2.interrupt`（`setWorkspace`/`remove` 等 SessionTable 直查面随第③格） |
| `cli/cmd/debug/agent.handler.ts` | 改 V2 create 或随 debug 面裁剪 |
| `cli/cmd/agent.ts`（agent 列表） | 改 AgentV2 面 |
| `cli/cmd/attach.ts` | 已停用（打印停用信息 exit 1），不动 |

### 7.3 继承面删除（决策，依据见下）

- **删 `github` / `pr` 命令**（`cli/cmd/github*.ts`、`pr.ts`，`index.ts:98` 注册）：GitHub Actions/PR 自动化是编程 agent 时代继承面，小说产品无 CI 场景；`github.handler.ts` 是 `SessionPrompt.prompt` 仅剩的进程内消费方之一，迁移 ~900 行纯浪费。
- **删 `acp` 子系统**（`src/acp/` 3454 行，`index.ts:81` 注册）：ACP 是代码编辑器（Zed 等）集成协议，桌面优先的小说产品无消费方；全链路吃 V1 消息/权限/事件形状，迁移成本最大且零产品价值。
- 两处删除均为「V1 面只等删除」既定原则的直接推论：不为无产品场景的继承面付迁移税。删除后 `SessionPrompt` 的进程内消费方仅剩 V1 server 路由本体（第③格处理）。

### 7.4 保留至第③格的面（本格不动）

V1 `/session/*` 路由组与 handler、`permission` 组、`tui` 组（远端控制面，无仓内消费方）、`handlers/sync.ts`、`middleware/workspace-routing.ts`、`handlers/experimental.ts` 的 session 部分、V1 plugin host（auth 插件活路径）、`EventV2Bridge`。这些面在组 D 后不再有新产品流量，第③格随 V1 子系统整体删除。

## 8. V1 面删除（本格内，组 D 完成后执行）

1. **task 工具链**：删 `tool/task.ts`；清理 `tool/registry.ts`（:12,103,234,257,267 引用与 `State.task`）、`session/prompt.ts`（:47,265,307,389,1224 的 TaskPromptOps/TaskTool 引用与 promptOps 构造）、`session/tools.ts`（:14,48,64 的 promptOps 注入）；删 `agent/subagent-permissions.ts`（唯一消费方是 task.ts）。
2. **BackgroundJob 旧面**：删 `opennovel/src/background/job.ts`；清 `session/session.ts:495,620,942-954` 与 `session/run-state.ts:32,78,111-143` 的级联取消、`tool/registry.ts:51,455` 与 `server.ts:10,248` 的 node 依赖残留、`effect/app-runtime.ts:51,82` 接线；core `background-job.ts` 删 `extend/waitForPromotion/promote`（`list/cancel` 是否可删以删除时全仓引用核实为准——V2 路径只用 start/background/block/pending/running/complete 新面）。
3. **novel-writer V1 入口 + V1 config hook**：`opennovel/src/plugin/index.ts:86` 从 `internalPlugins` 移除 `NovelWriterPlugin`、:263 摘除 config hook 消费（摘除前核实 auth 插件无 config hook 使用）；删 `plugin/src/novel-writer.ts` 本体（工具已搬 §3，注入已迁 §4，`readTechniqueInjection` 等具名导出的宿主反向 import 改指深路径：`sync-worker-composition.ts:14`、`setting-review-inbox.ts`、`setting-organization.ts`、`novel-reader.ts:20`）；删 `plugin/src/tool.ts`（V1 `tool()` helper，88 工具迁走后无消费方）。
4. 删除均为定点清除，V1 session 子系统其余部分（22 文件）留第③格。

## 9. 事件词汇迁移

app 事件消费（global-sync/server-sync 的 `session.created/updated` 等 V1 词汇）切到 V2 `session.next.*` durable 事件（SSE `GET /api/session/:id/event` 或等价全局流，以 protocol 现有面为准）。`EventV2Bridge` 保留（V1 路由面还在发布）；第③格随 V1 面一起拆。权限事件走 V2 `Permission.Event.Asked`（durable，重启不丢询问态）——V1 内存 Deferred 的会话内 pending 列表语义由事件流重建，app 侧按会话聚合。

## 10. 测试纪律与窗口行为

执行顺序与任务粒度以 tasks.md 为准（A → F 依赖序）；本节只记纪律与窗口论证。

测试纪律沿用：每步 focused test（包目录内 `bun test`，禁仓库根）；不 mock 全局；契约变更重生成 SDK；每组边界跑受影响包 `bun typecheck` + oxlint。已知既有 flake（`project_opennovel_test_timing_flakes`）：opennovel `llm.test.ts`/`read-only` smoke/`agent.test.ts` 5s 超时轮换，失败先按此归因。

**窗口行为（组 B 完成→组 E 完成之间）**：V1/V2 入口并存（两套注册表互不干扰，第①格同款共存）；新产品会话仍走 V1（组 D 未完成），流水线正常；V2 面已有 map-view 单点消费不受影响。组 E 首提交是切换点：此后新会话全 V2，在飞的 V1 会话下次请求会拿到新 prompt 文本（system.transform 每请求执行）——升级瞬间在飞写作会话可能失配，属可接受的升级窗口行为（V1 会话第③格即迁入 V2），记发布说明。

**风险与回退**：单 change 大面切换，回退 = 分支不合并；每组成组提交保证可二分。最大风险点在组 E 切换点后的端到端验证（组 F 首项），不达标不合并。

## 11. 落地核实（实现时填写）

（B 组完成时补记；后续组别的核实结论逐条追加。）

1. **「搬移」落地为窗口期复制转换**：§3 所述工具从 `novel-writer.ts` 搬入 `novel-writer/tools/*`，实际执行为复制转换——V2 版（effect Schema）落 `tools/*`，V1 zod 版原样保留在 `novel-writer.ts` 直至 E 组删除，与 §10 窗口行为一致；共享 helper（chapter-guards/context-render/paragraph-diff/project-config/shared/session-novel）抽取到 `tools/` 并由 V1 入口回引，两份工具代码之间零逻辑重复。
2. **会话感知的 SystemContext 观测机制（新增，本分叉原创）**：core `Source.load` 无会话参数，但注入源需按「会话→小说」绑定解析。落地为 `SystemContext.CurrentSessionID`（`Context.Reference<Option<string>>`，默认 none）+ context-epoch `initialize`/`prepare` 观测前 `Effect.provideService` 注入当前会话；plugin 契约 `SystemContextSource.load` 收 `LoadContext { sessionID?: string }`，host 桥负责 Reference→LoadContext 转换。effect 4.0.0-beta.83 无 FiberRef 模块，故用 Context.Reference 默认值语义承载。
3. **fetchGlobalSoul 删除时点随 E 组**：tasks B④的「删 fetchGlobalSoul 的 clientV2 自调与 TTL 缓存」落地为 V2 路径直读 `ctx.paths.config/soul.md`（`readGlobalSoulFile`，与 server soul handler 同一文件）；V1 hook 仍依赖 clientV2 HTTP 版 fetchGlobalSoul（plugin 包 host-agnostic，无法自解析全局 config 路径），其实际删除随 E 组 `novel-writer.ts` 一并进行。
4. **write_chapter 既有死代码逐字保留**：V1 源中 write_chapter 的 detectCoordinateLeak 校验块因缺少闭合花括号被嵌进 `if (outlineLeaks.length > 0) { … return }` 块内 return 之后，V1 中永不执行。为保持行为一致，V2 转换逐字保留该结构；修复会改变行为，应另起提案处理，不在本 change 顺手修。
5. **readonly 解码产物的机械偏差**：effect Schema.Struct/Array 解码类型带 readonly 修饰，V1 函数体中「原地改写 args 字段」「可变数组入参」两类写法在 V2 不合法。统一处理：原地改写改为局部变量（语义等价）；可变数组入参在 schema 侧用官方组合子 `Schema.mutable(Schema.Array(...))` 放宽（运行时行为不变，与 core 既有用法一致）；`interface` 返回对象赋 `metadata: Record<string, unknown>` 处用 `{ ...result }` 展开。以上均为类型层对齐，无运行时语义变化。

（C 组完成时补记。）

6. **V2 command 裁剪口径**：只移植 V1 `SessionPrompt.command` 的参数分词与模板展开语义（引号感知分词、`$1..$N` 逐一代入、最大序号占位符吞剩余、`$ARGUMENTS` 代原始串、无占位符且参数非空则尾插），随后走 durable admission + wake，与 prompt 完全同路。V1 的 shell `` !`cmd` `` 插值、subtask 标记、model 解析、agent 切换、plugin trigger 均不落（Command.Info 相应字段保留但 V2 不消费）；分词正则同步去掉 V1 的 `[Image N]` token（V2 prompt 无图片占位词汇）。展开逻辑收敛为 `command.ts` 的纯函数 `expandTemplate`，无 Effect 依赖。
7. **手动 compact 不与活跃 drain 互斥**：`SessionV2.compact` 经 LocationServiceMap 直驱 `SessionRunner.compact`，不经 SessionRunCoordinator 排队；与活跃 drain 并发时两侧事件可能交错。告诫记于此：手动压缩应在会话空闲时调用（CLI/app 切换时可先 `wait`），本格不引入 coordinator 互斥（避免 drain 内自调用死锁面）。
8. **新增 `session.next.updated` 事件与 `PATCH /api/session/:id` 端点**：C④ 逐页核对发现 app 两处写路径——title 重命名（titlebar-tab-nav）与归档（directory-sync `session.update({time:{archived}})`）——无 V2 对应面，故新增 durable `session.next.updated`（title?/archived? 条件字段）+ `SessionV2.update` + protocol `session.update` 端点；分页消息读取（server-session.ts）按 §7.1「映射到 V2 history/context」口径不新增端点，D 组切换时按页核对既有 `session.history`/`session.context` 端点是否够用。
9. **OperationUnavailableError 词汇收缩**：wait/compact/command 落地后，V1 遗留的 OperationUnavailableError literals 从 `["move","shell","skill","switchAgent","wait","compact","command"]` 收缩为 `["move","shell","skill","switchAgent"]`；server 处理器同步删除相应 catch 分支。
10. **Location.Ref key 形状陷阱（测试装置教训）**：LayerMap 按结构哈希 memoize location layer，effect Schema optional 字段「缺 key」与「key: undefined」结构不等价（`Ref.make({directory})` ≠ `Ref.make({directory, workspaceID: undefined})`），同一位置会被建成两份状态互不可见的 layer。app 内所有 Ref 均出自 `session/info.ts`（恒带 workspaceID 显式 key），形状一致无活体 bug；测试装置种 location 作用域状态时必须用 `session.get` 读出的 `info.location`，不得自建 Ref。曾在 lookup 内归一化 key 的修法无效（memoization key 是调用方传入的原对象），已回退。

（D 组完成时补记。）

11. **share 服务活跃，import 删除决策修订**：§7.2 原口径「核实 share 服务死活后删除 import」经 D 组侦察证伪——share 服务活着且 app 多处活跃调用（use-session-commands、message-timeline、仓根 github Action 脚本），故 import 保留至第③格随 share 面整体处置；导入的 V1 会话在 V2 读取面无消息投影，属已知窗口差异。app 侧对 V2 会话隐藏 share 入口（§7.1）。
12. **V2 revert 无自动 commit**：grep 确认 runner 与 run-coordinator 内无 revert 调用点，V2 `revert.commit` 只能显式调用（端点既有）。V1「revert 后下一 prompt 自动固化」的语义在 V2 不存在，app 映射只接 stage/clear（§7.1），会话 staged 态跨 prompt 存续属已知行为差异。
13. **V2 无 live `session.status` 事件**：ServerDefinitions 只含 durable 事件，busy/idle 权威源改为轮询 `GET /api/session/active`（§7.1）。`session.next.retried` durable 事件携带重试信息但无 V1 usage-exceeded upsell 的 action 字段，app 弹窗降级处理。
14. **legacy SDK（hey-api）`NullOr` 类型丢失**：`V2SessionUpdateData.body.time.archived` 生成类型为 `archived?: number`（null 被丢），解除归档传 null 在类型层受阻；app 切换时按需绕法（类型断言或只归档不解除），不为此改 schema 面。
15. **删除事件词汇修订为 V1 `session.deleted`**：D0 落地时放弃原拟新增的 `session.next.deleted`——V1 durable `session.deleted` 与 create 路径发布的 `session.created` 对称，同在 ServerDefinitions 全局流，projector 已有 Deleted 投影分支（删 session 行，各会话表 FK 级联清理），app 既有 reducer 直接消费；新增 per-aggregate 删除词汇属冗余且聚合删除后无存续意义。`SessionV2.remove` 语义：幂等、先 interrupt、递归子会话（parent_id 无 FK 级联）、publish Deleted、`events.remove` 清聚合事件历史。另记录同类陷阱：V1 `optional` 解码器拒绝显式 `key: undefined`（「缺 key」≠「key: undefined」），事件 payload 构造必须条件展开，否则 live payload 在严格解码方（监听/回放）炸掉而 durable 编码侧无症状。
