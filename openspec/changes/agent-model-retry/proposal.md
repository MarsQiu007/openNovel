# Proposal: agent-model-retry

## Why

长流水线（整卷生成、全书审校）会发起成百上千次 LLM 调用，单点故障概率随调用量线性上升：provider 限流（429）、瞬时 5xx、网络抖动。当前单次调用失败即中断流水线（或依赖上游调用方的粗粒度重试），长任务 therefore 脆弱。上游 openCode 有专门的 `model-retry.ts`（针对模型调用的重试策略层）与 `model-resolver.ts`（模型解析），语义成熟，且 upstream-sync playbook 已有对位事实：上游 `packages/ai` 的 provider 层修复落点即 fork `packages/llm` 同名文件（架构同构，ai-package-alignment 结论）。

## What Changes

- 在 `packages/llm` 调用链路引入重试策略层：可重试错误（429/5xx/网络错误）按退避策略自动重试，不可重试错误（认证、schema 拒绝）立即失败
- 策略可配置：按 provider/按调用类型（起草的重试预算可大于审计）——配置面形态待讨论
- 重试行为可观测：复用现有 observability 记录重试次数与原因
- 与上游对位：优先移植 `model-retry.ts` 语义（Ported-from 流程），fork 侧适配点记录进 design.md

## Capabilities

### New Capabilities

- `agent-model-retry`：LLM 调用的可配置重试策略

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`llm`（重试策略层）、`core`（session 调用链路传入策略）、`plugin`（流水线调用配置）
- **数据兼容性**：不涉及存储
- **依赖关系**：无前置；与 agent-background-job-recovery 协同（重试耗尽才升级为作业失败）
- **优先级理由**：体量最小、风险最低、上游有直接参照——适合作为低风险热身项，但单独价值有限（长流水线不常态化时收益不明显）

## 非目标

- 不做多 provider 故障转移（failover 到备用 provider 是独立议题）
- 不做请求级缓存与去重
- 不做流式响应的中断续传（流断了就整次重试）
- 不改 LLM 协议实现本身（重试在调用策略层，不进 protocols/）
