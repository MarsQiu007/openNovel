# Design: agent-model-retry

> 2026-10-23 穷尽式核实后重构：修正「单次调用失败即中断」的过时前提，补齐现状盘点、上游语义对位与 fork 适配点。

## 现状盘点（核实证据）

- `packages/llm/src/route/executor.ts:353-364`：executor 层已有重试循环 `retryStatusFailures`，条件是 `LLMError.retryable`，预算硬编码 `MAX_RETRIES = 2`（:36）、指数退避 0.5s 起步 ±20% 抖动、单次延迟封顶 10s（:345-351），采纳 `Retry-After` 但同样封顶 10s（:346）。
- `packages/llm/src/schema/errors.ts`：可重试分类由每个 reason 的 `retryable` getter 给出——`RateLimit` / `ProviderInternal` 为 true（:82-85、:117-120），`Transport` 为 false（:129-131），认证 / 配额 / 内容策略 / 非法请求 / 未知均为 false。即 429/5xx 会重试 2 次，网络错误与超时直接失败。
- executor 层**零观测**：全文件无日志/事件调用；重试耗尽后抛出的错误不携带尝试次数。
- 重试只包 `http.execute(request)`（executor.ts:370-376），即覆盖「拿到响应」之前的失败；200 OK 之后的流中断以 `providerError` 事件上浮，不重试——与上游一致（上游 `ModelRetry.retry` 只包 buffered 调用）。
- 全部 LLM 调用（含子代理会话、写作流水线 8 步）经 SessionRunner → `llm.stream(request)` 同一条链路进入 `LLMClient` → `RequestExecutor`，链路层修复即全覆盖，无需逐 agent 接入。
- V2 runner 自带 TODO：「Bound provider retries」「Persist snapshots, patches, and retry notices」（`packages/core/src/session/runner/llm.ts:55,66`）——runner 层整轮重试是已知的独立 slice，不属于本提案。

## 上游语义对位（本地镜像 D:\AI\Codes\opencode @ dev）

| 语义 | 上游出处 | fork 适配点 |
| --- | --- | --- |
| 共享退避策略：指数 2s→单次封顶 10s、最多 10 次、jittered | `packages/core/src/model-retry.ts`（建立提交 86c7f7c840） | 落 `packages/llm` executor 层，替换现有硬编码参数 |
| `Retry-After` 采纳，上限 15min（防恶意/故障 header 无限拖延） | 同上 `RETRY_AFTER_MAX` | 替换现有 10s 封顶 |
| 超时亚策略：`Transport` + Timeout 单独计数，封顶 3 次（一次超时已等待数分钟，不能用满通用预算） | 同上 `MAX_TIMEOUT_RETRIES` | `TransportReason.kind === "Timeout"` 已存在（executor.ts:324-326），直接复用 |
| `isRetryable`：RateLimit / ProviderInternal / Transport / UnknownProvider 可重试；`x-should-retry` 响应头优先覆盖 | `packages/ai/src/provider-error.ts:83` | fork 的判定落在各 reason 的 `retryable` getter（errors.ts），改动点：`Transport` → true、`UnknownProvider` → true；header 覆盖在 executor 判定处实现 |
| runner 层整轮重试、插件钩子、`RetryScheduled` 事件 | `packages/core/src/session/runner/retry.ts` | **不移植**：fork V2 runner 是自有设计，整轮重试随 runner slice 单独立项 |

注意上游 executor（`packages/ai/src/route/executor.ts`）**没有**重试循环，重试全在 runner 层；fork 相反（executor 有、runner 无）。本提案在 fork 现有 executor 层语义上增强，**不引入第二层重试**，避免双层退避叠加。

## 配置面决策

- 重试策略定义为 `packages/llm` 的命名 policy 值（如 `RetryPolicy`：`maxAttempts` / `baseDelay` / `maxDelay` / `retryAfterMax` / `maxTimeoutAttempts`），默认值对齐上游语义。
- 按 provider 配置的通道：route defaults 增加可选 `retry` 字段，provider facade `.configure(...)` 传入；请求级可覆盖。未配置时使用默认 policy——现有行为对调用方透明升级。
- 不按 agent / 调用类型分预算：需要 runner 层把 agent 身份传导进 llm 链路，属 runner slice 范围。

## 观测决策

- 每次重试决策输出结构化日志（`Effect.logWarning`，annotate：attempt、delayMs、reason tag、requestId 若有）。
- 重试耗尽后抛出的 `LLMError` 在 message 中携带尝试次数（如 `after N attempts`），上层（session runner、写作流水线、后台作业恢复）无需改动即可在终态错误中呈现重试历史。

## 与 agent-task-subagent / background-job-recovery 的衔接

- **两级预算不冲突，语义分层明确**：
  - 调用级（本提案）：单次 LLM 调用内的退避重试，在 `packages/llm` 调用策略层
  - 作业级（已落）：子代理崩溃恢复的 KV `attempts` 预算（默认 >10 次终态化并 error 通知，`packages/core/src/session/execution/restart.ts:16,81`）——调用级重试耗尽导致该轮失败，才消耗下一轮作业恢复
  - 即 proposal「重试耗尽才升级为作业失败」的顺序已被既有语义自然满足，无需新增协调层
- **子代理调用自动覆盖**：子代理会话与父会话走同一 llm 调用链路，策略在链路层生效即同时覆盖父子，流水线成百上千次调用无需逐 agent 配置接入。

## 范围边界（否决项记录）

- 曾考虑「直接照搬上游落点（runner 层 model-retry）」——否决：会在 fork 形成 executor × runner 双层重试（退避叠加、预算相乘），且触碰 V2 runner 自有设计。
- 曾考虑「按调用类型（起草 vs 审计）分预算」——否决（本提案内）：依赖 runner 层身份传导，超出热身项体量；design 留档给 runner slice。
