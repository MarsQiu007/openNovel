# Proposal

## Why

当前会话自动压缩同时存在主动触发过晚、provider 溢出未被识别、失败静默和过程不可见等断点；中文长会话尤其容易直到 provider 拒绝请求仍未触发压缩，只能依赖手动 `/compact` 补救。需要把阈值判断、Session 调度、摘要生成、状态展示和失败恢复建设成一套完整的上下文生命周期，而不是继续叠加互不感知的局部补丁。

## What Changes

- 建立由后端统一计算的上下文水位：优先使用匹配模型的最近一次 provider 实测 usage，并叠加锚点之后尚未测量的输入和工具结果估算；无可靠锚点时采用保守回退。
- 扩展 `compaction.buffer` 支持百分比预留，设置界面以“达到指定百分比时自动压缩”呈现，默认等效于 85% 触发；同时覆盖 V1、V2 配置和 V1→V2 迁移。
- 在每个安全 provider-turn 边界检查自动压缩，并将手动 `/compact` 纳入同一 Session 调度链；活跃会话中的手动请求排队，同一 Session 的重复请求合并。
- 增加可配置的后台摘要预生成：接近阈值时暂存候选摘要，达到阈值且候选仍有效时应用，否则回退到同步压缩；预生成不得提前改写可见上下文。
- 将压缩消息扩展为排队、运行、完成、失败和中断的持久化生命周期，保留实时摘要增量，并在会话时间线、上下文用量圆环中展示状态、阈值和可操作的失败信息。
- 保留 provider 溢出兜底，补齐 DashScope、Z.ai 等最新上游识别；摘要请求自身溢出时按有界阶梯缩减历史并重试，禁止无限自动恢复。
- 刷新、重连和进程重启后恢复真实压缩状态；遗留的排队或运行中操作结算为中断，不在进程恢复后擅自重放 provider 请求。
- 保持历史压缩消息可读取，并保持既有手动压缩入口兼容；公开 Schema、Protocol 或 HttpApi 变化通过既有生成流程同步客户端。

## Capabilities

### New Capabilities

- `session-context-compaction`: 定义会话上下文水位、可配置自动压缩阈值、安全边界调度、后台摘要、持久化生命周期以及溢出和进程恢复行为。

### Modified Capabilities

- `session-conversation-presentation`: 增加压缩过程与终态在会话时间线中的分层展示、重连恢复和操作要求，并保持既有阅读流与滚动行为。

## Impact

- `packages/core`：压缩水位与状态机、V2 SessionRunner/RunCoordinator 调度、事件投影、V1/V2 配置及迁移。
- `packages/schema`：压缩消息、事件和上下文水位契约；历史数据采用向后兼容解码，不要求改写既有 SQLite 事件或消息。
- `packages/llm`：provider context-overflow 分类及真实错误回归用例。
- `packages/protocol`、`packages/server`：V2 Session 压缩与水位契约；若调整 HttpApi，须同步更新对应练习场景。
- `packages/client`：按仓库既有生成流程更新公开客户端产物，不直接编辑 generated 文件。
- `packages/app`：时间线、V2 事件翻译、上下文用量展示、设置和手动压缩命令。
- `packages/novel-store`、`packages/plugin`、`packages/desktop`：无直接数据模型或领域流程改动；桌面端复用 App 展示。
- 上游移植参考 `bdf019a9acef1df662f724527c538ac7dbd0f5b5`、`6700dd87b5d9`、`bc175f675ca1`、`a0c6df8fdedb`、`edd88bd3fe57`，实现时按仓库移植规则记录完整 `Ported-from`，不得 merge、cherry-pick 或整文件覆盖。

## 非目标

- 不引入每会话或每 agent 的独立自动压缩阈值；本期仅提供全局设置和每会话手动压缩。
- 不修改小说专用的上下文组装、章节摘要、创作记忆同步或写作流水线规则。
- 不实现跨进程 Session 执行所有权、集群压缩或进程崩溃后的自动 provider 重放。
- 不承诺无实测 usage 时的字符估算等同 provider 精确 tokenizer；冷启动偏差由保守估算和溢出兜底共同处理。
- 不迁移上游整套 Session 架构，不删除手动压缩，也不以本次变更为由替换无关 UI 或配置体系。
