# Design

## Context

见 proposal.md — Why（三层缺失诊断与业界调研）。本设计需要站在四块既有地基上（关键事实均已核实于 `packages/core/src/session/runner/llm.ts`）：

- **durable prompt admission**：`SessionInput.Admitted`（admittedSeq / delivery / prompt）经 `SessionEvent.PromptAdmitted` 落库；`Delivery = Schema.Literals(["steer", "queue"])`。
- **steer 合成注入已有编排原语**：`SessionV2.synthetic({sessionID, text, resume?})`（session.ts:378），详见 D6。
- **run 循环已内建队列消费**：`run` 函数外层 `while (shouldRun)` 在每轮内层回合循环退出后检查 `SessionInput.hasPending(db, sessionID, "queue")`（llm.ts:639）——有 pending queue 就以 `promotion="queue"` 重新进入回合循环。**守卫续跑不需要改循环结构**：纯文本回合结束时 admit 一条 queue 指令，外层循环自然消费。
- **promote 重置步数配额**：queue/steer promote 时 `currentStep = 1`（llm.ts:253）——每条续跑指令提升后获得完整的回合步数配额。
- **步数到限形态**：`isLastStep` 回合以 `toolChoice: "none"` 发送并注入 `MAX_STEPS_PROMPT`（llm.ts:275）——模型在到限回合**禁用工具**，只能输出文本总结；到限总结回合天然是纯文本回合（`needsContinuation=false`）。
- **needsContinuation 语义**：provider 响应含工具调用则 true（llm.ts:341），纯文本或 provider 失败则 false（:456 的 `!publisher.hasProviderError()` 保护区分不了这两者，守卫需自行判断失败回合）。
- **系统上下文每回合重载但有 epoch 缓存**：`runTurnAttempt` 每回合走 `SessionContextEpoch.initialize/prepare`（llm.ts:224-243），baseline 未变化时复用 epoch 快照。

会话域已有两种「清单」先例，但都不是本提案要的实体：SessionTodo 是会话级 UI 任务清单（全量替换、无编排语义）；tool-insight 复测运行记录是插件域的 run + 逐案例状态 + 崩溃恢复先例（形态可参考，域不同）。

上游 openCode 的 SessionInbox 有 Synthetic 条目类型（合成消息先例），但其编排层同样没有「队列非空禁停机」契约——本设计不移植上游，走 openNovel 自己的 durable admission 路径。

## Goals / Non-Goals

**Goals:**

- 工作进度有一个跨压缩、跨重启的持久锚点（WorkRun），模型经工具读写，编排层与 UI 经服务读取。
- 纯文本停机在队列未完结时被自动续跑，全程不需要新的执行模型，不改 run 循环结构。
- 长队列不因步数到限反复停机（到限回合照常续跑，配额随 promote 重置）；失控消耗由续跑上限与无进展熔断两道阀门兜底。
- 守卫对无队列会话严格零影响。
- 强退/崩溃后的恢复链路闭环：重启遗留状态由启动对账收敛为「挂起 + 待处理」，用户一次显式恢复即续跑（恢复指令投回 + 执行唤醒），不丢进度、不重复已完成单元。

**Non-Goals:**

- 不做跨进程崩溃后自动续跑 provider work（AGENTS.md 明确要求单独设计；本设计守卫只作用于同一 drain 进程内的回合边界，跨重启恢复一律用户显式触发；启动对账只做状态收敛，绝不自动续跑 provider work）。
- 不扩展 `Delivery` 词汇（复用 queue，见 D2）。
- 不动 SessionTodo 与既有 BackgroundJob。
- 不做工作队列质量门禁（敷衍滑行风险靠复述与消费者场景自身兜底，v1 接受）。

## Decisions

### D1: WorkRun 落在 core 会话域，双表持久化

WorkRun 是 agent 执行域实体，不是小说内容域实体——落 session db（core），新增 `work_run`（id / session_id / goal / status / progress_note / 续跑计数 / 时间戳）与 `work_run_item`（id / run_id / seq / title / status / note / 时间戳）两表，Drizzle snake_case，session_id 为普通关联列（与既有 session 表同模式，sqlite 不启用外键约束）。运行状态机：run ∈ {active, paused, complete}；item ∈ {pending, in_progress, done, skipped, blocked}。续跑计数（连续守卫续跑次数与上次计数重置以来的单元状态变化数）记在 run 行上，供阀门判定。

备选：落 novel-store（否——工作队列与书内容无关，且 core 不能依赖 novel-store）；单表 JSON blob（否——单元级状态推进需要逐条更新，扁平表与既有 session 表模式一致）。

服务提供模型侧工具绑定层（创建/领取/完成/推进/记笔记/重置受阻单元）与宿主侧读取层（守卫谓词、阀门判定、UI 查询）两组 API。

### D2: 续跑指令复用 queue 投递，不扩 Delivery 词汇

守卫续跑 = `SessionInput.admit(prompt=合成续跑指令, delivery="queue")`，走既有 durable admission 路径落库，由 run 循环外层的队列消费逻辑在回合边界提升（promoteNextQueued 按 admittedSeq 取下一条，与用户 queue 输入自然排序共存）。合成指令以明确的合成来源标记开头（如「[自动续跑]」），使 UI 与用户可分辨。

备选：扩展 Delivery 加 "synthetic" 字面量（否——「Keep delivery vocabulary explicit」要求词汇谨慎演进，queue 的回合边界消费语义与守卫时机完全吻合，新词汇在此无增量语义）；进程内直接注入消息、不走 durable admission（否——重启即丢，违背持久化目标；上游 SessionInbox Synthetic 是无 durable admission 的产物，不适用）。

### D3: 守卫挂在 runner 纯文本回合结算处，放行条件按可执行单元判定

守卫谓词实现在 runner 服务层。落点：`runTurn` 返回 `needsContinuation=false` 且本回合非 provider 失败结算时（模型正常纯文本结束回合），调用守卫——读该会话 WorkRun，run 状态为 active、存在 pending 或 in_progress 单元、阀门未触发 → admit 续跑指令；外层 `while (shouldRun)` 随后读到 pending queue 自动续跑。到限总结回合（isLastStep）也是纯文本回合，**照常触发守卫续跑**——promote 重置配额使长队列跨段持续推进（见 D5）。

放行条件：无队列 / run 非 active（paused 或 complete）/ 队列无 pending 与 in_progress 单元（全部 done/skipped/blocked——blocked-only 队列放行停机，UI 显示受阻徽标，blocked 重置交恢复流程）/ provider 失败回合（不区分则连续 provider 失败会被守卫反复续跑烧 token）/ 阀门触发。

备选：改外层循环结构直接读 WorkRun（否——守卫语义走 durable 指令，与用户 queue 输入统一排序消费，且指令本身对用户可见、可追溯）；SessionExecution idle 边界（否——idle 边界难以区分「纯文本回合结束」与「queue 消化完毕自然空闲」，且拿不到回合结算细节）。

### D4: 提示词契约走 System Context 条件源，纳入 epoch 失效

新增一个 System Context 注入源：会话存在 active WorkRun 时注入两条约束（禁纯文本停机 + 每回合复述更新进度），队列 paused/complete 时自动停止注入。与 novel-writer 的条件注入模式一致。**实现要点**：系统上下文走 SessionContextEpoch 缓存（baseline 未变则复用快照），WorkRun 状态迁移（创建/挂起/终结）必须纳入 epoch 失效语义（更新 epoch 键或发布失效），否则注入相对队列状态滞后一个周期。

备选：改 agent 定义静态注入（否——无法条件化，会污染无队列会话）。

### D5: 到限照常续跑，失控防护由两道阀门承担，不依赖到限放行

初始方案「到限总结回合守卫放行」存在实质缺陷：到限回合 `toolChoice=none` 禁工具，模型无法临时写入进度；promote 重置配额意味着若放行续跑则每段 N 步；若放行停机则长队列每 N 步停机一次、用户须反复手动恢复——两者都不达标。修正：到限总结回合照常触发守卫续跑（promote 重置配额，继续工作），进度的持久化由复述契约常态化承担（每回合更新，到限时进度已在 WorkRun 中）。失控防护改为两道显式阀门：

- **续跑上限**：单条队列的连续守卫续跑次数达到可配置上限（per-agent 配置，默认 100）→ run 转 paused，守卫放行停机；用户恢复时计数重置。给用户「跑到这里先停下来让我看看」的确认点。
- **无进展熔断**：连续 3 次守卫续跑期间无任何单元状态变化 → run 转 paused，放行停机。防止对无法推进的工作无限重复消耗。

两道阀门替代「三重保险」旧说（旧推理依赖到限放行终止循环，与 promote 重置配额组合后不成立）。守卫续跑指令消耗的是 promote 后的新配额，上限与熔断在 admit 前判定，无竞态。

### D6: 打断挂起挂 runner 的 onInterrupt，恢复编排下沉 core（resumeWorkRun）

用户打断沿既有 interrupt 所有权链传播，run 循环以 interrupt 结算退出、守卫不会执行——挂起翻转落点为 `run` 函数的 `Effect.onInterrupt` 处理器（与 queued compaction 的 onInterrupt 模式一致，llm.ts:645）：打断时把该会话 active WorkRun 置 paused，数据原样保留。

恢复编排落在 core session 域（独立模块 `work-run-recovery`，避免 work-run → execution 经 runner 的导入环），server handler 一行委托（server 约定 handler 薄）：`SessionWorkRunRecovery.resumeWorkRun(sessionID)` = ① `workrun.resume` 翻回 active 并重置续跑计数与上下文 epoch（队列转 active 后下一回合 initialize 才会重新注入约束）；② steer admit 合成恢复指令（带合成来源标记、对用户可见，文本指示模型按注入的队列状态与进度笔记继续，已完成单元不要重复）+ `SessionExecution.wake`——与 `SessionV2.synthetic` 同款原语组合，不依赖 session.ts；③ ②失败时补偿翻回 paused（admit/wake 与状态翻转在同一 effect 内成组，失败整体回滚，重试语义干净），错误照常上抛由端点返回。恢复后无需用户再发消息，drain 提升恢复指令后由守卫续跑接力。恢复指令常量 `WORK_RUN_RECOVERY_PROMPT` 出口在 work-run 模块（core session 域）；续跑守卫指令常量 `WORK_RUN_CONTINUATION_PROMPT` 一并迁入 work-run 模块——同一域两条合成指令文本同源维护。

实现后核查修正（修订记录）：初版 resume 端点只翻状态、不投指令不唤醒，与 spec「用户显式恢复」场景（THEN 一条恢复指令投回会话）不符——点恢复后队列空转，须用户手动发消息才续跑。评审进一步发现：编排放 handler 违反 server「handler 薄」约定，且翻状态成功、投指令失败会留半提交状态。本修订把编排下沉 core 并补补偿回滚。落地形态再修正：`resumeWorkRun` 以 **location 服务**（`SessionWorkRunRecovery.Service`，决策 8 同款 makeLocationNode）挂在 work-run-recovery 模块——编排依赖的 Database/EventV2/SessionExecution 是全局节点，在 location 单元层构建期接线；handler 必须在 `.handle` 请求上下文内 yield 该服务（sessionLocation 中间件逐请求提供单元层），group 构建期 yield 拿不到（location 服务无全局实现，server typecheck 以 R 缺失直接拒编）。

### D7: 协议面与 UI 面

schema/protocol 新增 WorkRun 类型与端点：`GET workRun`（按 sessionID 查询队列与单元）+ 挂起/恢复操作端点；面板挂起端点直接调用 WorkRun 服务翻 paused（不打断进行中回合，当前单元结算后守卫放行停机），恢复端点一行委托 core `resumeWorkRun`（见 D6）。从 `packages/client` 跑 `bun run generate` 再生 SDK（根脚本 `./packages/sdk/js/script/build.ts` 一并跑，遵守双再生约定）；HttpApi 新端点同步注册 httpapi-exercise 场景（CI coverage 门）。app 会话面板新增工作队列区块（目标、单元清单、实时进度、挂起/恢复按钮）；长队列区块支持头部 chevron 收纳/展开（条目区内滚动有界）——区块不随每次队列更新重挂载（不 keyed），收纳态在执行期推进中保持。实时更新由 WorkRun 服务在状态迁移时发布变更事件、UI 经既有会话事件流订阅实现，不引入轮询。

### D8: 逐章审查消费者挂在 novel-writer 工具集

首消费者不新建 agent：逐章审查请求经既有审查入口识别后，模型用 WorkRun 工具为全书未完结章节逐章声明审查单元并逐章推进。守卫与提示词契约自动生效。工作流向：识别请求 → 建队列（每章一单元）→ 逐章领取/审查/完成/记进度 → 全部完成 → 队列终结 → 守卫放行 → 总结汇报。

```
            +------------- provider turn 循环 (runner) ------------------+
  入站指令 ->| promote -> LLM -> 工具执行 -> (工具调用? 下一回合 : 纯文本) |
            |                                              |             |
            |                                              v             |
            |              +--------------------------------------------+ |
            |              | 守卫（纯文本回合结算处）:                    | |
            |              |  active 且有 pending/in_progress 且         | |
            |              |  阀门未触发 且 非失败回合 ->                 | |
            |              |    admit 续跑指令 (queue)                   | |
            |              |  其余（无队列/paused/无可执行单元/           | |
            |              |  失败回合/阀门触发）-> 放行                  | |
            |              +--------------------------------------------+ |
            |                                              |             |
            |     外层 while: hasPending(queue) <----------+             |
            |     有 -> promotion="queue" 续跑（配额重置）               |
            +------------------------------------------------------------+
```

### D9: 启动对账挂在独立 reconcile 节点，排除本进程在跑的会话（沿用决策 8 先例）

强退/崩溃后运行簿行仍写 active、被杀单元永卡 in_progress（无代码执行翻转），而 UI 侧 active 只配「挂起」按钮、resume 端点只认 paused——「点恢复队列」第一步就不存在。补偿机制 = **启动对账（reconcile）**：独立对账节点（`SessionWorkRun.reconcileNode`，随 location 层树构建执行一次的 `Layer.effectDiscard`）对本库执行一次——排除本进程仍在执行的会话后，遗留 active 运行簿翻 paused（**显式重置续跑/无进展计数**——`pause()` 本身不清计数，计数重置原实现在 resume；对账取 resume 前半截语义）、仅被翻转运行簿的 in_progress 单元集合式回退 pending（done/skipped/blocked 不动）；随后逐个被翻转运行簿重置该会话上下文 epoch 并发布变更事件。已 paused 运行簿的 in_progress 单元**不回退**——那是同进程暂停/恢复「先结算进行中单元」的蓄意标记；claimNext 对 in_progress 的拒绝不变，模型恢复后先结算再领取。对账不 admit 任何指令、不 wake 任何会话（非目标：不自动开工），幂等（第二次执行为空扫）。

挂点选型（评审修正）：初版挂服务 Layer 体内、以「构建时刻同进程内必无该库 drain 在跑」论证——不成立：全局配置变更（PATCH /global/config → `invalidateAllKnownLocations`）与 LayerMap 60 分钟 TTL 都会重建 location 层树并重跑 Layer 体，而 SessionExecution 是进程全局的，旧 drain 仍在跑——构建期扫 sweep 会把**活的**运行簿翻 paused。正解沿用 `SessionCompactionRecovery.settle`（design 决策 8）先例：对账节点依赖进程全局的 `SessionExecution`，**排除 `execution.active` 中的会话**（= 本进程仍拥有 drain 的会话）再收敛——层重建后重跑对账也不会误伤在跑队列。

边界备案：第二个进程或第二棵层树挂同一 session 库（如桌面端 + CLI 同开、目录正斜杠双形态 split）时对账无法感知对方的活动——多实例单库本就不在支持面内（V2 执行模型：drain 进程本地，聚类另案设计）；残余风险仅误翻对方运行簿，用户显式恢复即可无损续（计数重置无害）。

备选：挂在服务 Layer 体内（否——层重建会重跑且该处拿不到执行所有权，见上）；server 启动 fiber 逐库扫（否——组装面多一处 location 枚举，与既有服务自治模式不一致）；请求时惰性检查（否——读路径引入写竞态，且首个请求之前的窗口状态仍是错的）。

被回退单元的半成品处置是消费者职责：写作流程有断点续跑自检（pipeline 步骤 0）兜底半完成章节，审查类重做天然安全。

## Risks / Trade-offs

- [守卫与用户消息竞争] → 续跑指令走 queue 投递，promoteNextQueued 按 admittedSeq 排序消费，与用户 queue 输入共存无竞争面；用户 steer 始终优先。
- [模型敷衍滑行（长队列中质量下降）] → recitation 复述把进度常驻近端缓解节奏漂移；逐章审查消费者自身有 38 维审计兜底；无进展熔断同时能拦住「不推进但也不停机」的滑行；v1 不做质量门禁，观察期评估。
- [压缩把队列操作上下文裁掉，模型「忘记」队列] → WorkRun 持久化 + 提示词契约每回合注入 + recitation 强制更新，三路兜底；最坏情况模型纯文本停机也会被守卫续跑拉回。
- [WorkRun 与 SessionTodo 概念混淆] → SessionTodo 保持 UI 任务清单语义不动；WorkRun 是编排守卫数据源，两者可并存；文档与实现命名清晰区分。
- [recitation 未执行则到限时进度滞后一格] → 到限回合禁工具无法补写，丢失的只是最后一回合的进度；续跑后复述恢复，进度笔记覆盖式更新自然纠偏。
- [条件注入与 SessionContextEpoch 缓存] → WorkRun 状态迁移未纳入 epoch 失效会导致注入滞后（D4 已列实现要点），实现时以单测覆盖「队列终结当回合注入停止」。
- [续跑上限默认值的取舍] → 默认 100 次续跑（每次约 N 步配额）覆盖大部分书籍规模；上限可在 agent 配置调整；超限转挂起非作废，恢复即续。
- [启动对账误伤正常 active 运行簿？] → 对账排除本进程 `execution.active` 会话（决策 8 同款机制），location 层重建后重跑也不会误伤在跑队列；跨进程同库为支持面外边界（见 D9 备案）；对账幂等空扫。
- [进行中单元回退待处理导致半成品被重做] → 被回退单元的执行者已随进程死亡，「未完成→待处理」语义正确；半成品由消费者侧兜底（写作流程断点续跑自检、审查类重做安全）；重做单章的成本远小于永卡 in_progress 的队列死锁。
- [恢复指令与进行中回合竞争] → steer 投递在下一安全回合边界提升，与用户 steer 同优先级语义（D2/D6 一致）；恢复编排先翻状态再投指令，首回合系统上下文必见 active 队列约束。

## Migration Plan

session db 新增两表，无既有数据迁移。旧会话与无队列会话守卫自动放行，行为与现状一致；协议新增字段对旧客户端向后兼容（新增不改动）。回滚 = 移除守卫接线与工具注册，遗留表无副作用。

## Open Questions

- 续跑/恢复指令的用户可见呈现（消息文本前缀 vs 会话事件元数据驱动 UI 徽标）——UI 呈现细节，实现期定，不影响 spec 语义（spec 只要求可分辨）。
- 逐章审查的「该章已审查」判定来源（队列单元完成即权威 vs 章级持久标记）——消费者实现细节，实现期定。
