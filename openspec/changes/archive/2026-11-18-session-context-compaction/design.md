# Design

## Context

动机见 [proposal.md](./proposal.md)。当前 `packages/core/src/session/compaction.ts` 只有约 245 行，主动压缩依赖请求 JSON 的字符估算，溢出恢复依赖 `packages/llm/src/provider-error.ts` 的分类；`packages/app/src/components/session/session-context-metrics.ts` 则使用 assistant usage，前后端没有共同水位。

V2 Session 已具备本方案需要的约束与扩展点：

- `SessionV2` 负责 durable input 与事件写入，`SessionExecution` 按 Session ID 唤醒进程内 drain。
- `SessionRunCoordinator` 联合同一 Session 的活跃执行，不同 Session 可并发。
- `SessionRunner` 在 Location 层内加载投影历史，每个 provider turn 显式调用一次 `llm.stream(request)`，并在 continuation 前重新进入 run loop。
- 实时消息更新与历史 replay 分别经过 message updater 和 projector；公开事件由 `packages/schema` 的 durable manifest 约束。
- 非 durable 事件可只发布到现有事件总线，适合派生水位刷新；durable 压缩生命周期必须进入事件日志和消息投影。

当前 `SessionV2.compact` 直接调用 Location 内的 `SessionRunner.compact`，绕过上述 drain，是本次必须移除的旁路。上游最新实现可移植水位、后台摘要和状态语义，但其 Session 内存模型不能替代 fork 的 V2 调度。

## Goals / Non-Goals

**Goals:**

- 用同一个派生水位驱动自动触发、溢出恢复和 UI 展示。
- 让手动与自动压缩都只在一个 Session 的安全 provider-turn 边界修改历史。
- 用可 replay 的事件表达压缩生命周期，同时把后台候选摘要保持为易失优化。
- 保持旧事件、旧压缩消息和既有数值配置可读取。
- 将上游移植限定为语义与局部算法，保留 fork 的 Location、SessionExecution 和 durable input 不变量。

**Non-Goals:**

- 不新增跨进程执行所有权或崩溃后的自动 provider 重放。
- 不把派生水位或后台候选摘要另存为第二份持久化事实。
- 不修改通用 `Token.estimate` 的所有调用方；中文保守估算只用于上下文压缩域。
- 不引入 provider 原生 compaction、每会话阈值或小说领域摘要规则。

## Decisions

### 1. 建立单一的 ContextWatermark 读模型

在 `packages/schema` 定义公开、可序列化的 `ContextWatermark`，至少包含：

- 当前模型引用与可用 context window。
- `measured`、`estimated`、`total` token。
- 配置触发比例、实际触发 token 和当前水位比例。
- `source: "measured" | "estimated" | "mixed"`。
- 无窗口或可靠锚点时的降级原因，供 UI 显示而不是伪造百分比。

Core 从投影历史反向寻找最近一个 provider、model、variant 均匹配且带 usage 的 assistant：

```text
measured = input + cache.read + cache.write + output + reasoning
estimated = 锚点之后尚未被该 usage 覆盖的消息与工具结果估算
total = measured + estimated
```

agent、系统上下文或工具定义的变化通过请求指纹使锚点失效；失效后重新对完整请求保守估算。不得跨模型复用 usage，也不得把 cache token 漏出水位。

无实测锚点时，上下文域使用保守的 Unicode 权重：ASCII 延续约 4 字符/token，CJK 等非 ASCII 内容按不低于 1 token/字估算。该估算可能偏早但不应偏晚；首个匹配 usage 返回后自动校准。UI 与自动压缩都读取 Core 的同一结果。

水位是投影派生值，不建 SQLite 表。初始值随 V2 Session 快照读取，后续在消息落定、模型或压缩配置变化后通过非 durable 事件刷新；重连直接重新读取快照，不依赖曾经收到刷新事件。

### 2. 沿用 buffer 作为唯一阈值配置

`compaction.buffer` 扩展为 `number | 百分比字符串`，`auto` 保持原有语义，新增 `background: boolean`，`keep.tokens` 保留。

- 未配置 buffer 时，采用上游默认值：预留 `max(window * 15%, 16k)`；窗口不足以同时给出 16k 时按上游小窗口规则退化。
- 显式 `"15%"` 表示预留 15%，即在约 85% 时触发；数值仍表示固定 token。
- 最终至少保留模型 output 空间：`trigger = window - max(configuredReserve, outputLimit)`。未知窗口不伪造自动阈值，只保留溢出恢复。
- UI 显示“达到 X% 时自动压缩”，写入 `100 - X` 的百分比 buffer；固定数值模式作为高级配置保留。
- 百分比解析必须严格校验范围和格式，非法配置进入现有配置健康诊断，不静默换成另一个阈值。

V1 的 `reserved` 字段类型放宽为 `NonNegativeInt | 百分比字符串` 并映射到 V2 `buffer`；V1 新增 `background: boolean` 键，迁移时透传到 V2 `background`（当前 `migrate.ts` 只透传 `auto/prune/keep.tokens/reserved`，需补齐 `background`）。App 通过 `serverSync.updateConfig` 写服务端配置，不新建浏览器本地存储来源。

### 3. 用 durable CompactionRequested 消除手动旁路

新增 durable 排队事件，并复用 Started/Ended，新增 Failed/Interrupted：

```text
Compaction.Queued     -> 创建 queued 操作
Compaction.Started    -> queued 转 running
Compaction.Delta      -> 非 durable 实时摘要增量
Compaction.Ended      -> running 转 completed
Compaction.Failed     -> running 转 failed
Compaction.Interrupted -> queued/running 转 interrupted
```

`SessionV2.compact` 的流程改为：

1. 在 Session 级 singleflight 内检查是否已有 queued/running 操作；有则返回该操作，没有则发布 Queued。
2. durable 事件和消息投影提交后，调用 `SessionExecution.wake(sessionID)`。
3. 立即返回操作 ID 和当前状态，不等待活跃 drain 完成；现有忽略响应体的调用方仍可使用同一入口。

活跃 drain 在每个安全边界重新读取投影并执行 queued 操作；空闲 wake 则启动一次只处理压缩的 drain。RunCoordinator 的 pending wake 防止请求落在 drain 退出窗口后丢失。自动阈值和溢出恢复也通过同一 `ensureQueued -> run` 路径，避免自动与手动各写一份历史。

singleflight 只解决当前进程内的准入竞态，不伪装成集群锁。重试失败操作会创建带 `retryOf` 关联的新操作，旧失败记录保持不可变。

### 4. 压缩只能发生在安全边界，并继续原始 durable input

runner 在首次 provider 调用和每次 continuation 前按以下顺序处理：

1. 重新加载投影和请求上下文。
2. 若存在 queued 操作，转为 running 并执行。
3. 否则计算水位；达到阈值时创建并执行自动操作。
4. 压缩成功后丢弃旧 request，重新从投影构建 request，再继续触发它的原始 input。
5. 压缩失败则发布 Failed 并结束本轮恢复，不立即创建另一个自动操作。

摘要调用属于压缩操作，不计作原始 provider turn；原始 turn 仍只能有一次正常 `llm.stream(request)`。不得桥接旧 `SessionPrompt.loop`，不得把原始 prompt 再插入一次 inbox。

provider 已拒绝且 assistant 尚未开始时才允许 overflow 恢复；已有 assistant 输出时不得原样重发。`auto: false` 同时关闭阈值和溢出自动恢复，手动压缩仍可用。

排队中的手动操作可单独撤销。运行中取消沿用 `SessionExecution.interrupt` 的所有权链，由压缩 finalizer 发布 Interrupted，并且不再发送已经超阈值的原始请求；原始 durable input 保留，只有显式重试或后续唤醒才继续。

### 5. 用统一状态转换同时支持实时更新和 replay

`SessionMessage.Compaction` 改为带 `status` 的 tagged union，公共字段保留 `reason`，完成态保留现有 `summary/recent`，失败态包含脱敏的结构化错误，中断态包含原因；完成态可带压缩前后水位和摘要 usage。

实时 message updater 与 replay projector 复用同一个纯状态转换函数，避免“实时能看到、刷新后消失”或双份逻辑漂移。Delta 不写 durable 日志；重连后运行中操作仍显示 running，已接收的瞬时摘要片段可以重新等待，不伪造为 completed。

旧消息没有 status 时按 completed 解码；旧 Ended 没有前置 Queued 时仍直接生成 completed 消息。新 Ended 只增加可选指标，不改变既有字段含义。所有终态转换必须幂等，重复 replay 不得追加重复消息。

### 6. 后台摘要属于进程内候选，不是提前完成的压缩

`SessionCompaction` 在 Location runner scope 内维护每 Session 一个候选 fiber 和结果，不落 durable 状态：

- 仅在 auto/background 均开启、存在同模型实测锚点且 prompt cache 仍有至少 30 秒余量时启动。
- 起点为 `trigger - min(60k, (trigger - cycleStart) / 2)`，与上游一致，避免小窗口过早摘要。
- 快照记录首条消息 ID、保留起点 ID、覆盖的消息前缀、模型/配置指纹和 `tailLimit = floor(trigger * 0.4)`。
- 后台调用不发送 Delta，不阻塞正常 provider turn，也不改变消息历史。
- 达到阈值时，首条消息和保留起点仍匹配、指纹未变且尾部不超过 tailLimit，才等待并应用候选；否则中断或丢弃候选并同步摘要。
- 候选已就绪不等于压缩完成，只有 durable Ended 才能创建 completed。
- 同一周期后台连续失败两次后停止新的后台尝试；真正到阈值时仍允许一次有界前台压缩。

候选和 fiber 由同一 Location runner 所有，进程结束自然消失。摘要费用在实际完成时记录，并关联到最终应用它的压缩操作；未使用的候选仍计入 Session usage，但不能伪造压缩完成指标。

### 7. 摘要生成采用有界缩减和明确错误

摘要请求保留上游“结构化 checkpoint + 最近原文尾部”的形态，并遵循：

- 根据当前实测水位和模型 output 上限设置摘要输出预算。
- 摘要请求自身 overflow 时按 `[0.85, 0.7, 0.5, 0.35]` 缩减输入，每一级都比上一级更小。
- 必要时使用上游的工具输入/输出裁剪层级，但不得把某些交换同时从摘要输入和最近尾部中静默丢弃。
- 回复缺少约定结构时最多 nudge 一次；空摘要或再次不符合结构即 Failed。
- 自动恢复不在同一原始 turn 内无限循环；后台失败计数与前台失败事件分开。

`packages/llm` 移植最新 context-overflow pattern 和 raw body 扫描，至少覆盖 DashScope `range of input length should be` 与 Z.ai `prompt too long/超长`，保留 rate limit、配额和 output 参数错误排除项。展示给用户的错误不包含原始响应体、请求头或凭据。

### 8. 进程恢复只结算，不重放

Location runner 建立时扫描本 Session 投影中的 queued/running 操作：

- 当前进程正常拥有的操作不结算。
- 上次进程遗留的操作发布幂等 Interrupted，原因标记为 restart。
- 不自动启动摘要 fiber，不自动继续原始 provider turn。
- 用户重试创建新操作；后续正常 prompt 可按当时水位重新触发自动压缩。

若崩溃发生在摘要返回之后、Ended 提交之前，候选直接丢弃，原历史保持有效；若 Ended 已提交，则 replay 得到 completed，后续显式唤醒从压缩后的投影继续。

### 9. App 复用现有时间线与设置链路

`server-session` 不再忽略压缩 Started/Delta；V2 translator 将各状态映射到既有 Compaction part，timeline 在现有 TurnDivider 区域扩展状态卡：

- queued：显示排队原因和撤销入口。
- running：显示自动/手动、实时摘要和停止入口。
- completed：保留分隔线，可展开摘要及压缩前后估算。
- failed：显示脱敏原因和重试按钮。
- interrupted：区分用户停止与进程恢复。

`session-context-usage` 使用服务端 ContextWatermark 显示当前比例和触发阈值，并显示后台准备状态；不根据前端消息重新决定触发。新增文案进入既有 locale 体系，默认简体中文。设置复用通用设置页与服务端配置同步，不增加平行存储。

公开 Schema/Protocol/HttpApi 修改后，从仓库根运行 `bun ./script/generate.ts` 再生成协议产物，并从 `packages/client` 运行 `bun run generate`；不得手改 `src/generated` 或 `src/generated-effect`。新增或改变的 HttpApi 场景同步登记 `httpapi-exercise`。

### 10. 上游移植按语义拆分并记录来源

优先移植算法和测试用例，不复制上游整个 Session 文件：

- `bdf019a9acef1df662f724527c538ac7dbd0f5b5`：DashScope overflow。
- `a931e8a9fd4fd75cdd41b2db05bd26bf4923df5d`：Z.ai overflow。
- `6700dd87b5d9`：百分比 buffer。
- `bc175f675ca1`：实测水位。
- `a0c6df8fdedb`、`edd88bd3fe57`：后台预生成及默认开启。
- `6597f6cd6c1e`：provider 拒绝后不得原样重发。

每个实际移植提交记录对应完整 `Ported-from`；fork 自有适配集中在水位读模型、durable 生命周期和 V2 drain，不在移植提交中夹带无关重构。

## Risks / Trade-offs

- [无 usage 时仍无法得到 provider 精确 token] → 使用 CJK 保守估算，允许偏早；获得 usage 后校准，并保留 overflow 兜底。
- [实测锚点可能因动态 system/tools 变化失效] → 请求指纹匹配，无法证明兼容时退回完整估算。
- [后台摘要增加费用并可能很快过期] → 缓存 TTL、尾部预算、每 Session 单候选和失败熔断；提供独立开关，未使用候选如实计 usage。
- [排队事件与 drain 退出之间可能丢唤醒] → durable Queued 是事实来源，wake 只是 advisory；RunCoordinator pending wake 与空闲 drain 检查共同兜底。
- [并发手动请求可能产生多个排队消息] → Session 级 singleflight 检查并复用活跃操作，runner 再做终态幂等保护。
- [取消摘要后继续原请求仍会 overflow] → 运行中取消同时停止当前 drain，原始 input 保持 durable，只有显式后续唤醒才继续。
- [新增 durable 事件影响旧二进制回滚] → 不重写历史数据；一旦新事件写入，不回滚到无法识别这些事件的旧二进制，采用前向修复或从升级前备份恢复。
- [时间线新增运行态可能影响虚拟滚动] → 复用现有 Compaction row，保持消息 ID 稳定，并覆盖流式更新、历史加载和锚定测试。

## Migration Plan

1. 先加入向后兼容的 Schema、配置解析和事件定义，完成双 SDK 生成及旧事件 replay 测试。
2. 上线统一水位和 durable 生命周期，再把自动/手动路径切换到同一 drain；此阶段后台摘要可关闭。
3. 加入后台候选、溢出缩减和进程恢复结算，最后接入 App 状态卡与设置。
4. 旧数值 buffer、旧 V1 配置和无 status 压缩消息无需批量迁移；读取时按原语义或 completed 兼容。
5. 升级前保留本地数据库备份。回滚仅适用于尚未写入新事件的数据库；已写入新事件时使用能识别新契约的版本前向修复，不让旧版本静默丢事件。
6. 验收顺序遵循仓库节奏：聚焦测试与包内 `bun typecheck` 先行，用户冒烟通过后再跑受影响目录全量和仓库级 CI 等价检查。

## Open Questions

无。默认 85% 触发、后台摘要默认开启、仅全局阈值和重启后只结算不重放均已在本设计中确定。
