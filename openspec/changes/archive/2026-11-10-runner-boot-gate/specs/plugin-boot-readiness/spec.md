# plugin-boot-readiness Specification

## Purpose
定义插件引导（PluginInternal catalog 批异步提交 + PluginBoot 放行门）与会话 drain 读路径的时序契约：凡读取插件填充状态（agent 名册、skill 来源、模型/供应方 catalog）的消费者，必须在引导门放行之后读取，保证首个 provider turn 的系统上下文与权限判定基于完整配置态。

## ADDED Requirements

### Requirement: 会话 drain 组装系统上下文前必须等待引导门放行

`SessionRunner` 的每次 provider turn（`runTurnAttempt`）与手动 compact 在 `agents.select` 及任何依赖插件填充状态的读取（`SkillGuidance.load`、`SessionContextEpoch.initialize/prepare`、工具物化）之前，MUST 先等待 `PluginBoot.ready` 放行；等待点位于 session 归属校验之后，避免跨 location 中断目标在门上无谓阻塞。无引导方的最小层图默认立即通过。

#### Scenario: 引导未完成时首个 prompt 到达

- **WHEN** location 层构建后插件引导 fork 尚未提交 catalog 批
- **AND** 该 location 的会话收到首个 prompt 并启动 drain
- **THEN** drain 在 `agents.select` 前阻塞于 `PluginBoot.ready` 直至批提交放行
- **AND** 首个 provider turn 的系统上下文包含已配置的 agent 与 skill 引导（如 `<available_skills>` 段）

#### Scenario: 无引导方的最小层图

- **WHEN** 层图未包含 PluginInternal（最小测试/嵌入场景）
- **AND** 会话启动 drain
- **THEN** `PluginBoot.ready` 立即通过，不产生额外等待

#### Scenario: 引导批失败落定

- **WHEN** catalog 批提交失败
- **THEN** 门仍随 `Effect.onExit(() => pluginBoot.release)` 放行
- **AND** drain 走正常的解析错误路径，不在门上挂死
