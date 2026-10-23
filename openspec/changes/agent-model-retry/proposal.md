# Proposal: agent-model-retry

## Why

长流水线（整卷生成、全书审校）会发起成百上千次 LLM 调用，单点故障概率随调用量线性上升。穷尽式核实（2026-10-23）后的现状：

- `packages/llm/src/route/executor.ts` 已有 HTTP 层重试，但**预算硬编码**（`MAX_RETRIES = 2`）、**不可配置**、**零观测**（重试发生时不留任何痕迹，耗尽后错误也不携带重试历史）；
- **网络错误与超时零重试**：`TransportReason.retryable = false`（`packages/llm/src/schema/errors.ts:129`），网络抖动、连接重置、超时直接中断流水线——这正是长任务最常见的瞬时故障类别；
- 现状重试参数（0.5s 起步、10s 封顶、仅 2 次）面对真实的 provider 限流窗口（常以分钟计）明显不足。

上游 openCode 有成熟语义可移植：`model-retry.ts` 的共享退避策略（2s 指数→10s 封顶 ×10 次、`Retry-After` 采纳上限 15min、超时亚策略单独封顶 3 次）与 `provider-error.ts` 的 `isRetryable` 判定（含 `x-should-retry` 响应头覆盖）。

## What Changes

- **Transport 错误纳入可重试**：网络传输失败（含超时）按退避策略重试；超时类尝试单独计数并封顶（移植上游 `MAX_TIMEOUT_RETRIES = 3` 语义，防止已等待数分钟的超时尝试把总预算拖到过久）
- **重试策略收敛为命名 policy**：默认值对齐上游 `model-retry.ts`（指数 2s→10s 封顶、最多 10 次、`Retry-After` 采纳上限 15min），替换 executor 内 `MAX_RETRIES = 2` 硬编码；policy 可按 provider 维度配置（route defaults 携带，provider facade `.configure(...)` 传入）
- **重试行为可观测**：每次重试决策产出结构化日志（attempt / delay / reason），重试耗尽后的错误携带尝试次数，供调用链路上层（session runner、写作流水线）呈现
- **`x-should-retry` 响应头覆盖**：provider 显式指示时覆盖本地分类判定（移植上游 `isRetryable` 第一条规则）
- 移植追溯：实现提交 body 写 `Ported-from: 86c7f7c84048d776ba94b94bfab782b2b0a6d776`（上游 `model-retry.ts` 建立提交）；fork 侧适配点记录进 design.md

## Capabilities

### New Capabilities

- `agent-model-retry`：LLM 调用的可配置重试策略

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`llm`（错误分类、重试策略层、route defaults 配置面）
- **数据兼容性**：不涉及存储
- **依赖关系**：无前置；与 agent-background-job-recovery（已归档）协同——调用级重试耗尽才消耗作业级恢复预算，该顺序已由既有语义自然满足
- **优先级理由**：体量最小、风险最低、上游有直接参照——适合作为低风险热身项

## 非目标

- 不做 session runner 层的整轮重试与重试事件（V2 runner 的「Bound provider retries / persist retry notices」是独立 slice，见 `packages/core/src/session/runner/llm.ts` 清单）
- 不做按 agent / 调用类型区分预算（需 runner 层身份传导，随 runner 层 slice 一并讨论）
- 不做多 provider 故障转移（failover 到备用 provider 是独立议题）
- 不做请求级缓存与去重
- 不做流式响应的中断续传（流在 200 OK 之后中断不属本提案；runner 层 slice 决定整轮重试策略）
- 不改 LLM 协议实现本身（重试在调用策略层，不进 protocols/）
