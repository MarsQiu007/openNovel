# runner-boot-gate 提案

## 背景

`HttpApi SDK > includes project skills in REST API prompt context` 在 main 上长期 flake（基点本地隔离复现 10/10 红，全量跑约 2/3 红，CI 连续命中）。同一提交 3 次重跑限额已用满且全部撞上，属既有 flake 家族之外的独立缺陷，必须修复而非止血。

## 根因

插件引导（`PluginInternal.boot`）在层构建期以 `Effect.forkScoped` 异步提交 catalog 批（config-agent / config-skill 等 transform 把 agent 名册、skill 来源写入对应 State），并通过 `PluginBoot.ready` 门放行等待方。门的既有消费方只有两处：

- `SessionRunnerModel.resolve`（模型解析前等待，`core/src/session/runner/model.ts`）
- `PermissionJudge`（权限判定前等待，`core/src/permission/judge.ts`）

而 `SessionRunner.runTurnAttempt` 与手动 `compact` 在**门放行之前**就执行 `agents.select(session.agent)` 并以其结果组装系统上下文（`skillGuidance.load(agent)`、`SessionContextEpoch.initialize`）。引导 fork 未完成时 `AgentV2` 名册为空，`selection.info === undefined`，`SkillGuidance.load` 直接返回 `SystemContext.empty`——prompt 的 system 段缺失 `<available_skills>`，且首个 provider turn 会把这份残缺上下文固化进 context epoch 基线。竞争输赢决定测试红绿，与 skill 文件写入时序、skill 发现机制均无关。

实证（临时仪器，已还原）：失败 run 中 `SkillGuidance.load` 被调用且 `selection.info === undefined`，`SkillV2.list` 完全未到达。

## 方案

在 `SessionRunner.runTurnAttempt` 与手动 `compact` 读取 agent 状态前统一等待 `PluginBoot.ready`（`yield* pluginBoot.ready`），把引导门覆盖补齐到 drain 的完整读路径：

- 等待点位于 session 归属校验之后、`agents.select` 之前，避免跨 location 的中断目标无谓阻塞。
- `PluginBoot` 默认放行（无引导方的最小层图立即通过），不改变测试/嵌入场景行为。
- 模型解析已有自己的等待点，重复等待为 `Deferred.await`，放行后近乎零成本。

与既有纪律一致：读取插件填充状态的消费者自行等待引导门（model resolve、permission judge 同款模式），不在 `AgentV2.select` 内部藏等待（避免 boot transform 反向依赖 agent 时的自锁风险）。

## 影响面

- `packages/core/src/session/runner/llm.ts`：注入 `PluginBoot.Service`，两个读点等待门放行，node deps 增加 `PluginBoot.node`。
- 无协议/Schema 变更，无需再生成 SDK；无 i18n 文案。

## 风险

- 等待发生在 drain 内，引导批提交失败时门也会放行（`Effect.onExit(() => pluginBoot.release)`），不会引入挂死路径。
- 首个 turn 时序被推迟到引导完成之后，属于把本来就承诺的不变量（agents/skills 可见）变成真实，不新增用户可见行为差异。
