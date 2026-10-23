# Tasks: agent-model-retry

> 单波实现（全部落在 `packages/llm`）。设计依据见 design.md（现状盘点与上游语义对位表）。移植追溯：实现提交 body 写 `Ported-from: 86c7f7c84048d776ba94b94bfab782b2b0a6d776`。

## Wave 1 — llm 重试策略层增强

- [ ] 1.1 错误分类修正（`packages/llm/src/schema/errors.ts`）：`TransportReason.retryable` → true、`UnknownProviderReason.retryable` → true（对齐上游 `isRetryable`：传输失败与未分类瞬时故障可重试；认证/配额/内容策略/非法请求保持 false）
- [ ] 1.2 命名 `RetryPolicy`（`maxAttempts` / `baseDelay` / `maxDelay` / `retryAfterMax` / `maxTimeoutAttempts`），默认值对齐上游 model-retry.ts 语义（指数 2s→10s 封顶、最多 10 次、Retry-After 采纳上限 15min、超时亚策略封顶 3 次）；替换 executor 内 `MAX_RETRIES = 2` 等硬编码
- [ ] 1.3 配置面：route defaults 增加可选 `retry` 字段并传入 executor 判定，请求级可覆盖，未配置走默认 policy（provider facade `.configure({ retry })` 即按 provider 生效）
- [ ] 1.4 `x-should-retry` 响应头覆盖：executor 重试判定处优先尊重 provider 显式指示（`x-should-retry: true/false`），覆盖本地 reason 分类
- [ ] 1.5 观测：每次重试决策 `Effect.logWarning`（annotate attempt / delayMs / reason tag）；重试耗尽后的 `LLMError` message 携带尝试次数
- [ ] 1.6 单测（`packages/llm/test`，用 `scriptedResponses` 确定性脚本化响应，不进录制带）：Transport/超时重试与 3 次封顶、UnknownProvider 重试、认证/配额/内容策略不重试、`x-should-retry` 双向覆盖、Retry-After 采纳与 15min 封顶、耗尽错误携带尝试次数、自定义 policy 生效
- [ ] 1.7 **守门**：`packages/llm` `bun typecheck` 绿 + 测试全绿；根目录 oxlint 0 errors；`packages/core` typecheck 绿（llm 消费方面向下兼容核对）

## Implementation Commits

（实现完成后用 `git log --grep "OpenSpec-Change: agent-model-retry"` 收集填写）

## Workflow follow-up

（归档后如有回归修复在此补充）
