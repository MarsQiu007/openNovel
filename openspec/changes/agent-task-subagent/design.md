# Design: agent-task-subagent

> 移植底本：上游 openCode 基线 `9d90d892dc @ 2026-10-20`，主题提交组见 proposal。设计基于两轮代码侦查：fork V2 现状逐文件核实 + 上游参照件逐文件通读。按 upstream-sync 规则，逐项记录适配点；与 proposal 表述冲突处（§6）以核实结果为准。
>
> **激进决策（2026-10-21 用户定案）**：不保留 V1 双轨，全线切 V2。本 change 落 V2 全套能力 + 原生 agent 注册 + 拆除 V1 实验后台路径；V1 残余（task 工具、BackgroundJob 旧面）的死期钉死在紧随其后的运行时切换 change，不再有「冻结双轨期」。

## 0. 移植映射总表

| 上游件 | fork 落点 | 适配类型 |
| --- | --- | --- |
| `core/src/tool/plugin/subagent.ts`（插件工具，311 行） | `core/src/tool/subagent.ts`（canonical built-in） | 结构适配 |
| `core/src/job.ts`（492 行，KV 持久化 + Recovery） | `core/src/background-job.ts` 加法升级（现 370 行，纯内存） | 语义重对齐 |
| `core/src/kv.ts` + `core/src/kv/sql.ts` | **新增** `core/src/kv.ts` + KV 表 | 缺件补齐 |
| `core/src/session/subagent-job.ts`（76 行） | 同名移植 | 直接移植 |
| `core/src/session/subagent-completion.ts`（46 行） | 同名移植 + `Session.synthetic` 新面 | 移植 + 缺件 |
| `core/src/session/execution/restart.ts`（240 行） | 同名移植，**仅 subagent 范围** | 语义适配（§5） |
| `sessions.create({parentID, title, ...})` / `store.list({parentID})` | `session.ts` `CreateInput` 扩展 + children 查询 | 缺件补齐 |
| config 键 `experimental.subagent_depth` | fork V2 config 新增同名键 | 键位适配 |

**结构差异一（工具形态）**：上游 subagent 是插件工具（`ctx.tool.transform` 注册），fork V2 插件上下文（`packages/plugin/src/v2/effect/context.ts`）只有 agent/aisdk/catalog/command/integration/plugin/reference/skill 钩子——**没有 `ctx.tool`**，插件工具注册路径未 V2 化（`core/tool/AGENTS.md` 明列 gap，属 v1-retirement 第②格）；且 fork `builtins.ts:26-29` 的 TODO 明确把 task 列为待移植叶子。**决策：以 canonical built-in 形态落 `core/src/tool/subagent.ts`**，经 `Tools.Service.register` 注册。第②格 plugin 原生引导落地后若需迁形态再议（执行语义不变，只换注册壳）。

**结构差异二（Job 分叉）**：fork `background-job.ts` 与上游 `job.ts` 同源分叉——fork 是上游早期形态（promote/extend 线）的移植，纯内存、无 recovery/notificationID/block/KV；上游已演进为可恢复形态。fork 版被 V1 `BackgroundJob` wrapper（`opennovel/src/background/job.ts:17-33`）包着消费，且消费面不止 task 工具——`session/session.ts`、`session/run-state.ts`、`tool/registry.ts`、server experimental 路由都经 wrapper 依赖旧方法面（`list/extend/wait/waitForPromotion/promote/cancel`）。**决策：加法式升级**——补齐上游语义（见 §2），旧方法面在本 change 保留（V1 运行时还在跑产品，现在拔会让产品在迁移窗口内整体不可用）；**旧面 + V1 wrapper 的删除点钉死在紧随其后的运行时切换 change**，与 V1 task 工具同批执行，不是无期双轨。KV 持久化仅对带 `recovery`/`notificationID` 的作业生效（上游同款守卫 `persistBackground` 提前返回），V1 路径零行为变化。

## 1. 前置件：KV 持久化

fork core 无 KV（`packages/core/src/` 无 kv.ts），而上游 Job 持久化、恢复预算、未来 shell 后台作业都压在这一个底座上。按上游 `kv.ts` 形态移植：

- `KVTable`：`key` PK / `value`（json）/ `time_updated`，snake_case
- `KV.Service`：`get(key)` / `set(key, value)`（upsert）/ `remove(key)` / `scan({prefix, after?, limit?})`（前缀分页，恢复扫描用）

落点 `core/src/kv.ts` + `core/src/kv/sql.ts`，挂现有 core `Database`。这是本 change 唯一的新基建表。

## 2. Job 注册表升级（background-job.ts）

fork 现状（内存态 `make` 工厂）→ 补齐上游 `job.ts` 语义：

- **`Background` schema**（KV 记录）：`id` / `notificationID`（SessionMessage.ID）/ `recovery` / `status` / `output?` / `error?`，持久化键 `job.background/<notificationID>`
- **`Recovery` 联合类型**：shell / subagent 两个 kind 都定义（对齐上游 schema 形状），**本期只启用 subagent**；shell 的恢复面随 core `bash.ts` 的 durable status 设计另立（`bash.ts:73` TODO 已声明此顺序）
- **前台 block**：`block({id, sessionID})` → finished | backgrounded，raceFirst(done, backgrounded)，`blockingSessions` 计数支撑 `backgroundAll`
- **转后台**：`background(id)` / `backgroundAll({sessionID, type?})`，转后台即 `persistBackground`
- **恢复查询面**：`pendingBackground`（KV scan）/ `runningBackground`（内存中 running 且可恢复）/ `completeBackground(notificationID)`（KV remove + 内存清理）
- **消费历史上限**：已完成且无 notificationID 的作业保留最近 25 条（上游 `COMPLETED_LIMIT`）
- **失败细节保全**：settle 时 `errorText`（Cause prettyErrors 链式渲染）
- **保留** fork 既有 `list` / `extend` / `waitForPromotion` / `promote`（V1 wrapper 消费面）

依赖：`KV.node`（上游 job.ts 的 deps 同款）。

## 3. subagent 工具（core/src/tool/subagent.ts）

注册：`Tools.Service`，`name = "subagent"`。permission action 同名（对齐 `core/tool/AGENTS.md`「多数工具默认注册名」；edit/write/apply_patch 共享 action 的先例说明 action 可以不等于名，但此处语义就是工具本身）。

Input / Output / description 逐条平移上游：`agent` / `description`（3-5 词标签）/ `prompt` / `model?`（"providerID/modelID[#variant]"）/ `sessionID?`（续聊）/ `background?`；执行前空串参数清洗（上游 `execute.before` hook 的等价处理）；Output 含 `sessionID` / `status`(completed|running) / `output`，成功结果包 `<subagent sessionID="..." state="completed">` 包装。

执行序列（上游逻辑 1:1，服务名对齐 fork）：

1. `sessions.get(context.sessionID)` 取父会话，沿 `parentID` 上溯计深度
2. 深度上限：V2 config `experimental.subagent_depth ?? 1`。**键位适配**：V1 是顶层 `subagent_depth`（`v1/config/config.ts:109`），V2 对齐上游 `experimental.*` 命名（fork V2 config schema 增补该可选键）；写作场景的 `2` 落到 novel 项目配置文件——V2 config 是文件态，插件不能运行时注入全局键（原桥接方案的隐藏假设不成立），生成/引导处的具体落点实现时核对（§7、tasks 步骤 9）
3. `AgentV2.resolve(input.agent)`；`mode === "primary"` 拒绝
4. `PermissionV2.assert({action: "subagent", resources: [agent.id], save: [agent.id], sessionID, agent, source})`——source 形态按 `core/tool/AGENTS.md`：`{type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID}`（上游字段名 messageID/id 是其 context 形态，语义相同）
5. 续聊校验：`existing.parentID !== context.sessionID` → 拒绝
6. model override 解析与可用性校验（provider/model/variant 三级报错文案平移）
7. 续聊时 switchAgent/switchModel：`override ?? (切换了 agent ? agent.model : 不变)`（上游「显式 model > agent 配置 > 继承」注释语义照搬）
8. 新建子会话：`model = override ?? agent.model ?? parent.model`
9. **`sessions.prompt`（durable admission + wake）**——fork `SessionV2.prompt`（`session.ts:360-383`）已是持久 admit + `SessionExecution.wake` 语义，天然满足根 AGENTS.md「不在工具 execute 里同步嵌套跑 prompt 循环」约束；新会话 prompt 加 `"You are a subagent spawned by another session."` 前缀；`background && 新会话` → `resume: false` admit-only（作业启动后由 SubagentJob 的 run 显式 resume，避免 wake 抢跑——上游注释「Job.start joining a running child skips its run effect」语义同款）
10. `SubagentJob.start(recovery)`
11. background → `SubagentJob.background(recovery)` + 返回 running 文案（含「不要轮询/不要重复其工作」劝说段）；前台 → `jobs.block({id: child.id, sessionID})` + `onInterrupt`（child interrupt + job cancel）；`backgrounded` → `SubagentJob.notify`；error/cancelled → `ToolFailure` 且**保留 sessionID**（模型可续聊子会话）

**动态描述适配点**：上游经 `ctx.session.hook("context"/"compaction"/"generate")` 把可用子代理清单追加进工具描述（过滤 mode=primary、hidden、以及当前会话 agent 权限对 `subagent`/agent.id 为 deny 的）。fork V2 插件上下文无 session 钩子。语义要求不变：清单按当前会话 agent 的权限过滤后注入。落点候选：

- (a) registry definition 派生惰性化（definitions 每次派生时求值 description）
- (b) session context 组装处对工具描述的补写钩子（core/session 侧，非插件上下文）

任务阶段按 fork context 组装现状二选一；若两者都不顺，降级为注册时静态注入全量非 hidden 清单（权限过滤只剩 deny 一层在执行时兜底）——**不阻塞其余件**。

**落定（实现时）**：采用 (a)——`Tool.make` 增可选 `describe` 回调（收调用 agent 的权限 ruleset），`registry.materialize` 每次派生 definitions 时求值（`runner/llm.ts:203` 传入 agent permissions）；插件 boot 是位置树内 fork 异步启动，注册时静态求值会与 agent 注册竞态，故 (a) 是唯一可靠落点。连带结构事实：位置树成员依赖全局 `SessionV2.node` 会经 deps 错误通道反向到达 `LocationServiceMap.Service` 类基（其类型内嵌整棵位置树），构成 TS2506/TS2456 类型环——`SessionV2.node` 以显式注解读窄静态类型切断循环，运行时图不变；后续位置树成员依赖会话服务沿用该先例。

## 4. SubagentJob + SubagentCompletion（完成回传）

- `core/src/session/subagent-job.ts` 直接移植：全局 Scope fork + `Effect.context` 捕获（「Jobs and their completion observers outlive the plugin that launched them」——fork 语境下是「不随工具调用/插件 Scope/Location 死亡」）；`notifications` Set 按 `${childSessionID}:${startedAt}` 去重（一个作业代际一个观察者）；`start`（`jobs.start` 的 run = `execution.resume(child)` + 取最后一条 completed 无 error 的 assistant 消息提取文本）/ `background` / `notify`
- `core/src/session/subagent-completion.ts` 直接移植：`text()`（无文本 → `NO_TEXT = "Subagent completed without a text response."` 兜底）；`deliver()` 幂等注入——`<subagent sessionID="..." state="..." description="...">` 包装 + `notificationID` 复用作合成消息 ID（重启后重复 deliver 不产生第二条）+ `completeBackground` 清账 + `resume: false` 透传
- **缺件补齐 `Session.synthetic`**：fork V2 Session 服务无合成消息注入面。新增 `synthetic({id?, sessionID, text, resume?})`——持久化合成用户消息，走 V2 durable admission 路径（steer 语义：活跃 drain 在安全边界晋级，idle 由 wake 驱动；同 id 重复注入幂等）；`resume: false` 时只落库不 wake（恢复通知不惊动 idle 父会话）。**fork 适配**：上游面带 `description`/`metadata`，fork 的 admission 行无独立载体且无结构化消费方——结构信息（childID/state/description）由 `<subagent>` 文本块承载，不设这两个参数，出现真实消费方时再加。这是完成回传与崩溃恢复共用的唯一新 Session 面
- 取尾逻辑：fork `store.context(child)` 已可载入消息（`store.ts:42-44`），无需新查询

## 5. 崩溃恢复 restart.ts（subagent 范围）

根 AGENTS.md：「post-crash continuation recovery requires a separate explicit design before it may retry provider work」——**本节即该显式设计**（subagent 范围）。

落点 `core/src/session/execution/restart.ts`，`recoverSubagent` 主干平移上游：

- child 不存在 / `child.parentID !== recovery.parentSessionID` / 父不存在 → `completeBackground` 丢弃
- 已完结（status ≠ running）→ 直接 deliver
- running 且 child 在本进程 `execution.active` → 跳过（本进程已在跑）
- 否则预算检查 → `jobs.start({run: execution.resume(child) + 尾 assistant 提取})` + `jobs.background` + fork 等待通知

**fork 适配（与上游四处偏差，全部有因）**：

1. **恢复预算载体**。上游挂持久执行 claim（`store.countResume` / `release` / `listSuspended` / `releaseChildClaims` + 终态事件经 release hook 重置计数）——fork 无 durable claim 机制（local drains 进程本地，`run-coordinator` 无持久态），为本 change 引入整套 claim 不成比例。**改为 KV 作业记录内 `attempts` 计数**：每次 boot sweep 对 running 子代理 +1，超过 `maxAttempts`（默认 10，上游同值）→ 终态化（KV 记 terminal + deliver error 通知）。与上游意图一致：反复死亡的轮次不能跨重启 crash-loop；作业完成即终态，预算语义自然清零。
2. **范围收窄**。只恢复 subagent；shell 恢复不进本期（对齐 `bash.ts:73` TODO 的顺序声明）。上游的 `recoverShell` 及其 Bus 依赖（`SessionEvent.Execution.Failed` 发布）一并延后——fork 侧终态化直接写 KV + 通知，无 Bus 依赖。
3. **父会话一律不自动唤醒**。上游区分 suspended/idle 父（suspended 集合单独 resume，通知按集合带 `resume: false`）；fork drains 进程本地、进程死后父 drain 必然已死、fork 无跨进程父续跑设计——suspended/idle 之分不存在，**恢复通知统一 `resume: false`**，父的续跑由用户/模型决定。子代理的 resume 是本设计显式授权的 provider 重试，依据三条：child 的 prompt 已持久 admit（session_input 行在）、结果欠父会话（KV 恢复记录在）、预算防 crash-loop。这正是 AGENTS.md 要求的「separate explicit design」对 subagent 场景的满足；父会话自身的崩溃恢复仍不做。
4. **调用时机**。上游由 managed-server 协议在 boot 时调用（service inert until called）；fork 无此协议——保持 inert 语义，由 app/server 启动组合处显式调用一次（具体接线点任务阶段按 fork 启动序列核对）。

`prepareResume` 的「先持久化预算再 resume」时序语义保留（crash 在 resume 内也要被下次 sweep 计数）。

## 6. Session 写侧扩展（核实修正）

**核实修正**：proposal 写「补 V2 `SessionStore` 缺失的写侧 API」。核实结果：fork 的 `create` 本就在 Session 服务（`session.ts:115,208`），`SessionStore` 是刻意的只读视图（`store.ts:14-27` 四个只读方法）。落点修正为 Session 服务扩展，SessionStore 定位不动：

- `CreateInput` 扩展 `parentID?` / `title?`（现仅 `id?/agent?/model?/location`）；child 创建时继承父的 location / metadata / permission ruleset（上游 create 语义）
- children 查询：`SessionStore` 增加 `list({parentID})`（上游 `store.list({parentID})` 形态，drizzle eq 查询），Session 服务透出
- 存储：`session.parent_id` 列与 `session_parent_idx` 索引已存在（`sql.ts:31,64`），**无迁移**；`fromRow` 已解析 parentID（`info.ts:19`）

## 7. 写作 agent 的 V2 原生注册

**现状核实**：novel-writer 的 12 个写作 agent 走 V1 config hook（`novel-writer.ts:5962`，由 V1 plugin host `opennovel/src/plugin/index.ts:260-266` 消费）；V2 config-agent plugin（`core/src/config/plugin/agent.ts`）只处理配置文件 agent；opennovel 包内零 `AgentV2` 引用。**结论：V2 会话当前看不到 12 个写作 agent**——不接线则 V2 subagent 工具 resolve 不到 director/writer/auditor，本 change 对产品无效。

**接线方案（原生，不做桥接）**：V2 外部插件加载通路已存在——`core/src/config/plugin/external.ts` 从 config `plugins` 条目（npm 包 / `file://` / 相对路径）或 `{plugin,plugins}/*.{ts,js}` 目录发现插件，加载 `default {id, effect}` 形态模块进 V2 宿主。novel-writer 新增 V2 入口（plugin 包内薄入口文件，`default {id, effect}`）：

- `ctx.agent.transform` 注册 12 个写作 agent（字段映射：mode / system / description / permissions / model / steps / hidden / color——对照 config-agent plugin 的写法）
- `default_agent: "director"` → `draft.default`
- 禁用 `build` / `plan`（对齐 V1 hook 的 `disable: true`）
- 深度覆写：`experimental.subagent_depth: 2` 写入 novel 项目配置文件（V2 config 文件态，插件不注入运行时配置；生成处落点实现时核对）

V1 config hook 原样保留到运行时切换（两套注册表互不干扰：V1 host 只调 config hook，V2 宿主只跑 V2 入口的 agent 注册，无重复执行）；切换 change 落地时 V1 hook 与 host 一起删。**不造桥接模块**——桥接是为「不动 novel-writer 宿主形态」付出的临时复杂度，激进路线下直接动形态更省。

## 8. agent 分类字段 category

- `schema/src/agent.ts` `Agent.Info` 增加可选 `category`（字面量联合，取值集命名任务阶段定，初版映射见 proposal §3，不在此重复）
- V1 `Agent.Info`（`opennovel/src/agent/agent.ts:35-55`）与两级 config schema 同步加列
- `agents/` 目录导出形态收敛：4 个带 interface 的 `*AgentConfig` 与 8 个裸对象统一为一种形态（收敛方向任务阶段按多数派定）
- 消费方（director 按类路由、UI 分组、权限基线模板）本期只落数据不落逻辑，随各自 change 渐进接线

## 9. 命名、V1 拆除与退役衔接

- V2 工具名与 permission action 均为 `subagent`（对齐上游，移植零阻力）
- **本 change 拆 V1 的实验后台路径**：`opennovel/src/tool/task.ts` 的 `OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门禁与后台分支整段删除（proposal 缺口二——不可靠、作业不持久化、崩溃即丢；其替代品本 change 已在 V2 落地）。flag 仅存的另外两处引用一并退役：experimental `capabilities` 端点（上报 `backgroundSubagents` 位）与 `experimental/session/:id/background` 提升端点（opennovel 侧无消费方）。V1 task 的前台路径保留——流水线还在 V1 运行时上经它调度，运行时切换 change 落地前拔掉 = 产品当场断
- **V1 task 工具 = 死代码缓期执行**：死期钉死在紧随其后的运行时切换 change（产品会话面切 V2 后即删），不设冻结双轨期、不再接任何 V1 新面
- 历史会话：不做运行时 legacy notice 垫片——历史 V1 会话数据在运行时切换后的 V1 删除 change 里一次性迁移（上游 `v1-migration.bun.ts` 模式：数据迁进 V2 存储、`RENAMED_TOOLS = {task: "subagent", ...}` 在迁移中改写工具名），迁完删码
- 权限规则过渡：V1 配置里的 `task/*` 规则对 V2 action=`subagent` 不匹配 → `PermissionV2.evaluate` 落默认 ask——首次使用显式询问，不静默放行也不静默拒绝；作者确认后经 PermissionV2 saved 面写入 V2 规则
- 数据：`session.parent_id` 已存在，KV 表纯新增，本 change 无历史数据迁移（迁移属 V1 删除 change）

## 10. 测试与实施顺序

测试：每件 focused test（core 包内 `bun test`，禁止从仓库根跑）；KV / Job / 恢复用真实内存 sqlite（沿 core 既有 Database 测试基建）；不 mock 全局。恢复测试覆盖：作业记录丢失 / child 缺失 / parentID 不匹配 / 已完结重通知 / running 重试 / 预算耗尽终态化。

顺序（依赖序，每步提交带 Ported-from 上游 SHA）：

1. KV 表 + `KV.Service`
2. `background-job.ts` 加法升级（V1 wrapper 回归核对；旧方法面 + wrapper 的删除点记入运行时切换 change 的 tasks）
3. Session `CreateInput` 扩展 + children 查询 + `Session.synthetic`
4. `subagent.ts` 前台路径（深度 / 权限 / 模型链 / 续聊校验）
5. `subagent-job.ts` + `subagent-completion.ts` + background 路径 + block/onInterrupt
6. `restart.ts` 恢复 + 启动接线
7. V1 task 实验后台路径拆除（`OPENNOVEL_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门禁 + 后台分支；必须在第 5 步之后，能力不断档）
8. category 字段 + `agents/` 导出收敛
9. novel-writer V2 原生注册入口（agent transform + default + 禁用 build/plan）+ V2 外部插件加载接线 + 深度配置落位
10. 缺口补齐审查（proposal §4：12 个写作子代理与其余 7 个 agent-* 提案的衔接核对），结论写入各 change 的 design
