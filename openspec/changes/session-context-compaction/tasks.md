# Tasks

## 1. 配置与公开契约

- [x] 1.1 扩展 V1/V2 压缩配置以支持百分比 buffer、后台开关和默认 85% 触发，保留旧数值与 V1 迁移语义；新增配置解析、非法百分比和迁移测试，并从 `packages/core` 运行聚焦测试与 `bun typecheck`
- [x] 1.2 定义 ContextWatermark、带状态的 Compaction 消息及 Queued/Failed/Interrupted 事件契约，保持旧 Ended 和无状态消息兼容；从 `packages/schema`、`packages/core` 运行新增编解码与 replay 聚焦测试及 `bun typecheck`
- [x] 1.3 调整 V2 Session 快照、水位刷新和手动压缩受理响应的 Protocol/Server 契约，保持既有端点调用兼容；更新对应 `httpapi-exercise` 场景并验证覆盖检查通过
- [x] 1.4 从仓库根运行 `bun ./script/generate.ts`，再在 `packages/client` 运行 `bun run generate` 重新生成双 SDK；检查生成 diff 包含新契约且没有手改 generated 文件，并运行相关包 `bun typecheck`
- [x] 1.5 从仓库根对第 1 组改动路径运行 `bun run lint -- <路径>`，确认无新增 oxlint 问题，并检查配置键、事件定义和 SDK 产物不存在重复或无人消费的平行契约

## 2. 统一水位与 Provider 错误分类

- [x] 2.1 实现匹配 provider/model/variant 和请求指纹的实测锚点、未测量后缀及 CJK 保守回退；在 `packages/core` 新增中文冷启动、缓存 token、工具后缀、模型切换和未知窗口测试并验证通过
- [x] 2.2 实现 V2 初始水位快照与非 durable 刷新通知，使重连可直接读取最新派生值；验证客户端无需补收瞬时事件即可获得与自动决策一致的水位
- [x] 2.3 移植 DashScope、Z.ai 及 raw body 上下文溢出识别并保留限流、配额排除项；从 `packages/llm` 运行 `bun test test/provider-error.test.ts` 和新增真实错误回归用例
- [x] 2.4 从 `packages/core`、`packages/llm` 运行 `bun typecheck`，从仓库根运行本组 oxlint 检查，并确认旧前端独立 usage 计算尚未被误当作后端触发来源

## 3. 持久化状态机与安全调度

- [x] 3.1 实现实时 updater 与 replay projector 共用的 Compaction 状态转换，覆盖 queued/running/completed/failed/interrupted、旧消息兼容及幂等 replay；在 `packages/core` 运行投影与消息更新聚焦测试
- [x] 3.2 改造手动压缩为准入 durable 排队操作、Session 级 singleflight 和 advisory wake，移除直接调用活跃 runner 的旁路；验证活跃请求去重、受理后立即返回及 drain 退出窗口不丢操作
- [x] 3.3 在首次 provider turn 与 continuation 前接入统一排队和阈值检查，成功后重载投影再继续原始 durable input；用 runner 测试证明无半截 assistant 改写、无重复用户消息且原始 provider turn 只继续一次
- [x] 3.4 实现排队撤销、运行中停止、失败终态和一次原始 turn 的有界恢复；验证取消不删除原始 input、排队撤销不取消其他 assistant 工作、失败后无自动死循环
- [x] 3.5 实现进程恢复时对遗留 queued/running 的幂等中断结算，区分已完成操作且不自动重放 provider；用重建 Location/runner 的测试覆盖崩溃点在 Ended 前后两种形态
- [x] 3.6 从 `packages/core` 运行 `bun test test/session-compaction.test.ts test/session-runner.test.ts` 及新增调度/恢复用例和 `bun typecheck`，再从仓库根运行本组 oxlint 检查

## 4. 有界摘要与后台预生成

- [x] 4.1 实现摘要输出预算、四级溢出缩减、必要工具内容裁剪和一次结构 nudge，失败时写入脱敏错误；在 `packages/core` 验证逐级缩小、空摘要保护、最小级别失败和无敏感 payload 展示
- [x] 4.2 实现每 Session 单候选的后台预生成、缓存 TTL、周期起点和尾部预算校验；验证接近阈值才启动、候选不提前改历史、有效候选复用及失效候选回退前台
- [x] 4.3 实现后台两次失败熔断、阈值时一次有界前台机会和候选 usage 记账；验证未使用候选计入成本但不产生 completed，关闭 background 不影响阈值自动压缩
- [x] 4.4 从 `packages/core` 运行全部压缩与 runner 聚焦测试及 `bun typecheck`，从仓库根运行本组 oxlint 检查，并核对后台 fiber、旧同步路径和重试计数不存在无人调用或重复维护的实现

## 5. App 状态展示与设置

- [ ] 5.1 接入 server-session 与 V2 translator 的水位和 Compaction 全生命周期事件，保持消息/part ID 稳定；用 Bun 1.3.14 从 `packages/app` 运行 `v2-translator`、事件 reducer 和新增增量归属测试
- [ ] 5.2 实现时间线排队、运行、完成、失败和中断卡片及撤销、停止、重试、展开操作，复用现有 Compaction row；用组件测试和 `session-timeline` 聚焦 e2e 验证五类状态、错误可读性和操作后的状态
- [ ] 5.3 实现上下文用量圆环的统一水位、配置/实际阈值和后台准备状态，并通过 `serverSync.updateConfig` 提供自动开关、百分比阈值与后台开关；验证保存重载、安全上限说明和未知窗口降级
- [ ] 5.4 按仓库 locale 保护约束接入默认简体中文及既有 zh/en/zht 文案流程，不新增硬编码英文；运行 i18n parity、键盘焦点、明暗主题和减少动态效果相关聚焦测试
- [ ] 5.5 扩展会话 e2e fixture 以覆盖运行中刷新、重连、历史加载、虚拟滚动和重复增量，验证无重复卡片、跨消息串写、错误假完成或不可接受的锚点跳变
- [ ] 5.6 用 Bun 1.3.14 从 `packages/app` 运行受影响单测、聚焦 e2e、`bun typecheck` 与 `bun run typecheck:e2e`，再从仓库根运行本组 oxlint 检查

## 6. 端到端验收与收尾验证

- [ ] 6.1 使用隔离数据库和可控 provider 完成中文长会话端到端验收，取证阈值前自动压缩、DashScope 溢出兜底、手动/自动去重、失败重试和进程重启不自动重放，并将可重复断言固化为自动化用例
- [ ] 6.2 在用户完成会话 UI 冒烟验收后，运行受影响 core/llm/app 测试目录全量及受影响 e2e 目录全量；记录实际命令、结果和既有 flake 归因，不把未验收前的结果作为最终收尾证据
- [ ] 6.3 从仓库根运行 `bun run typecheck`、全量 oxlint、生成一致性检查和 HttpApi coverage 等价检查，确认达到 CI 等价要求；若有失败先按时间线和 diff 归因，不用重复重跑代替修复
- [ ] 6.4 检查并清理本 change 引入的同类、冗余和无用代码，重点确认旧手动旁路、旧独立水位消费、无人引用导出、死 import 和未消费查询通道；验证所有新增公开字段均有实际消费者或在规格中说明兼容用途
- [ ] 6.5 核对 proposal、design、两个 delta specs 与最终实现一致，运行 `openspec validate session-context-compaction --strict`，并确认所有实现提交含 `OpenSpec-Change: session-context-compaction` 及适用的完整 `Ported-from`

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: session-context-compaction" --format="%h %s"` 收集实现提交并写入 `## Implementation Commits`，不包含记录更新和归档移动自身。
- 单独提交记录更新，按仓库流程同步主 specs、归档并验证归档结果。
- 合并前确认工作树干净并更新 main；推送功能性代码后检查远端 generate、typecheck、test 全部通过。
