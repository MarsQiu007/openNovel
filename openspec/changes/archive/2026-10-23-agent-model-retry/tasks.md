# Tasks: agent-model-retry

> 单波实现（全部落在 `packages/llm`）。设计依据见 design.md（现状盘点与上游语义对位表）。移植追溯：实现提交 body 写 `Ported-from: 86c7f7c84048d776ba94b94bfab782b2b0a6d776`。

## Wave 1 — llm 重试策略层增强

- [x] 1.1 错误分类修正（`packages/llm/src/schema/errors.ts`）：`TransportReason.retryable` → true、`UnknownProviderReason.retryable` → true（对齐上游 `isRetryable`：传输失败与未分类瞬时故障可重试；认证/配额/内容策略/非法请求保持 false）
- [x] 1.2 命名 `RetryOptions`（`maxRetries` / `baseDelayMs` / `maxDelayMs` / `retryAfterMaxMs` / `maxTimeoutRetries`），默认值对齐上游 model-retry.ts 语义（指数 2s→10s 封顶、最多 10 次、Retry-After 采纳上限 15min、超时亚策略封顶 3 次）；替换 executor 内 `MAX_RETRIES = 2` 等硬编码
- [x] 1.3 配置面：route defaults 增加可选 `retry` 字段（`RouteDefaults(Input).retry` → `resolveRequestOptions` 合并 route/model/request 三级 → transport 传入 executor），provider facade `.configure({ retry })` 经 `RouteDefaultsInput` 自动生效，请求级 `LLM.request({ retry })` 覆盖
- [x] 1.4 `x-should-retry` 响应头覆盖：executor 重试判定处优先尊重 provider 显式指示（`x-should-retry: true/false`），覆盖本地 reason 分类
- [x] 1.5 观测：每次重试决策 `Effect.logWarning`（annotate attempt / delayMs / reason tag / requestId）；`LLMError` 增加可选 `attempts` 字段，耗尽后 message 携带「failed after N attempts」
- [x] 1.6 单测（`packages/llm/test/executor.test.ts`，脚本化响应确定性测试）：Transport/超时 3 次封顶、UnknownProvider(418) 重试、`x-should-retry` 双向覆盖、Retry-After 采纳与 15min 封顶（TestClock）、耗尽错误携带尝试次数、route 级与请求级 policy 生效/覆盖；修复脚本化响应复用的 web body 单次读取问题（clone）
- [x] 1.7 **守门**：`packages/llm` `bun typecheck` 绿 + 306 pass / 0 fail；根目录 oxlint 0 errors；`packages/core` / `packages/opennovel` typecheck 绿

## Implementation Commits

- `94071ea805` feat(llm): 调用级重试策略层（Transport 可重试、命名 policy、观测）

## Workflow follow-up

（归档后如有回归修复在此补充）
