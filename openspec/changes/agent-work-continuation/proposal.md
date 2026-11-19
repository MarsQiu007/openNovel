# Proposal

## Why

长程且流程明确的任务（全书逐章审查、逐卷校对、批量修订）目前无法由 agent 自主维持到底：跑几个单元后 agent 会以纯文本结束回合、询问「要不要继续」，把节奏控制权交回用户。三线调研（openNovel 现状 / 上游 openCode / 业界产品）表明这是三层缺陷叠加，且业界无一家已有方案：

- **模型层**：模型天然倾向阶段性汇报；批量场景存在节奏漂移（Manus 观察：批量任务中段模型开始「只标注不处理」式的敷衍滑行）。
- **编排层**：工作进度只存在于上下文窗口里，压缩即丢，重启即断，没有任何跨回合的持久锚点。
- **基础设施层**：openNovel 已有 durable prompt admission（`SessionInput.Admitted` + `Delivery = ["steer", "queue"]`）、idle 边界 promote、BackgroundJob 崩溃恢复、max-steps 安全阀，唯独缺一道「工作队列非空时禁止纯文本停机」的编排守卫。上游 openCode 同样没有（SessionInbox 与 max-steps 均不含此契约）。

「续跑」不需要新的执行模型——编排层在 agent 纯文本结束回合时自动合成一条入站指令即可无缝续跑。基础设施已就位约 80%，本提案补上最后一块。

## What Changes

- **新增持久化工作队列实体**（session 域）：`WorkRun` —— 会话绑定的跨压缩、跨重启工作清单，含条目状态（pending / in_progress / done / skipped / blocked）与进度记录；模型经工具创建与推进（供模型声明工作、领取单元、标记完成、写入进度笔记），宿主与 UI 经服务读取。压缩后与重启后均从持久层恢复，不依赖上下文记忆。
- **新增续跑守卫**：agent 以纯文本正常结束回合（无工具调用，非 provider 失败结算）时，宿主检查该会话 WorkRun 是否存在可执行条目（待处理/进行中）——有则合成续跑入站指令（delivery="queue"，由 run 循环既有队列消费逻辑在回合边界提升）投回会话，指令内容指示模型继续队列中的下一单元；队列已空、挂起或无 WorkRun 则放行停机。步数到限的强制总结回合照常续跑（提升时配额重置），长队列不因到限反复停机。
- **新增提示词契约**：系统提示词注入两条约束——「会话存在活动工作队列时，禁止以纯文本结束回合」，以及 recitation 复述要求（每回合通过工具更新队列进度，使进度锚点常驻上下文近端并常态化保存进度）。
- **新增守卫安全阀**：两道阀门兜底失控消耗——单队列连续守卫续跑次数达到可配置上限时转挂起停机；连续多次续跑无单元状态变化（无进展熔断）时同样转挂起停机。用户打断时 WorkRun 转为挂起而非作废，用户可显式恢复续跑（恢复时计数重置）。
- **首个消费者**：plugin 侧逐章审查工作队列——全书 N 章审查场景经 WorkRun 工具集声明单元并逐章推进，作为通用能力的首个落地场景与验收锚点。
- **协议与 UI 面**：schema/protocol 新增 WorkRun 类型与查询/操作端点，`packages/client` 运行 `bun run generate` 再生 SDK；app 会话面板展示工作队列状态、单元进度与挂起/恢复操作。

## Capabilities

### New Capabilities

- `agent-work-continuation`: 通用 agent 长程执行能力——持久化工作队列实体（WorkRun）、纯文本停机守卫与合成续跑、提示词契约（禁停机 + recitation 复述）、守卫安全阀（续跑上限与无进展熔断、打断挂起可恢复），及逐章审查首个消费者与协议/UI 面。

### Modified Capabilities

（无——`multi-chapter-batch` 的批量写作契约行为不变，其「失败时中断并支持恢复」的既有 spec 语义不受本提案影响。）

## Impact

- **packages/core**：session runner 回合结束边界处新增守卫（`session/runner/llm.ts` 显式 provider-turn 循环的纯文本回合判定处）；新增 WorkRun 服务与 session db 持久化（新表，Drizzle）；续跑入站指令经既有 durable admission 路径投递，不改 `SessionV2.prompt` admission 语义。
- **packages/schema**：新增 WorkRun 相关 schema；`Delivery` 词汇保持 `["steer", "queue"]` 不变（续跑指令复用 queue 投递形态）。
- **packages/protocol / packages/client**：新增 WorkRun 查询与操作端点；改协议后必须从 `packages/client` 运行 `bun run generate` 再生 SDK（同时保留根脚本 `./packages/sdk/js/script/build.ts` 产物为最新）。
- **packages/server**：HttpApi 新增 WorkRun 端点并注册 httpapi-exercise 场景。
- **packages/plugin**：新增逐章审查工作队列工具集（首个消费者）。
- **packages/app**：会话面板新增工作队列进度展示与挂起/恢复操作。
- **数据兼容性**：session db 仅新增表，无既有数据迁移；旧会话无 WorkRun 数据时守卫自动放行，行为与现状一致。
- **依赖与协议**：无新增运行时依赖；涉及公开 Protocol 变更，按仓库约定双再生 SDK。

## 非目标

- 不改变 SessionV2 durable prompt admission 的既有语义与 delivery 词汇。
- 不做跨会话共享工作队列（WorkRun 严格会话绑定）。
- 不做云端同步与多设备工作队列合并。
- 不改 `multi-chapter-batch` 批量写作契约。
- 不做无人值守定时自动开工（恢复均为显式动作：续跑守卫只发生在一次 drain 内，跨进程重启后不自动续跑，一律由用户显式恢复触发）。
- 不引入 stop-hook 式的外部钩子机制（守卫内建在编排层，默认行为开箱即用，仅续跑上限提供可配置项）。
