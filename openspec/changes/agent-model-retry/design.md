# Design: agent-model-retry

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：本设计记录重试策略层与子代理作业恢复的两级预算边界。

## 与 agent-task-subagent 落地后的衔接

- **两级预算不冲突，语义分层明确**：
  - 调用级（本提案）：单次 LLM 调用内的退避重试（429/5xx/网络错误），在 `packages/llm` 调用策略层
  - 作业级（agent-task-subagent 已落）：子代理崩溃恢复的 KV `attempts` 预算（>10 次终态化并 error 通知，`core/src/session/execution/restart.ts`）——每次 attempts 计数对应一轮 resume；调用级重试耗尽导致该轮失败，才消耗下一轮作业恢复
  - 即 proposal「重试耗尽才升级为作业失败」的顺序已被作业恢复语义自然满足，无需新增协调层
- **子代理调用自动覆盖**：子代理会话的 provider turn 与父会话走同一 llm 调用链路（同一 stream 路径），重试策略在链路层生效即同时覆盖父子——流水线 8 步的成百上千次调用（director→pipeline→writer/auditor/…）无需逐 agent 配置接入
- **按调用类型分策略的落点**：起草（writer）与审计（auditor）的重试预算差异，经 agent 维度传导——调用方传 agent 身份（session 的 agent 字段已有），策略层按 agent 区分预算，plugin 侧不新增配置面
- **观测**：重试次数与原因复用现有 observability；子代理侧 job 的 error 通知已链式保全 settle 失败细节（settle 失败 errorText），重试耗尽后的终态错误沿该通道呈现
