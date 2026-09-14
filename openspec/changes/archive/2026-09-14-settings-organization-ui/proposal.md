## Why

agent 工具已经能分析设定、校验整理计划并在确认后执行，但结果只出现在会话输出中，用户缺少一个结构化入口查看问题并一键委托受控整理流程。本提案为设定中心补充可视化分析报告和 AI 一键整理入口；实际修改仍由 agent 在绑定会话中使用 organize_settings 的安全流程完成。

## What Changes

- 在设定中心新增“整理”入口，展示跨实体 analyze 报告：问题类型、受影响条目、证据摘要、建议和数量。
- 提供 AI 一键整理入口：将真实 `novel_id` 和 analyze 报告发送到绑定会话，并要求 agent 使用 `organize_settings` 完成 analyze → dry_run → 用户确认 → apply → analyze 复查；UI 不导入 plan_json，也不直接执行。
- 新增设置整理 HTTP API；当前 UI 消费 analyze 报告，dry-run 和 apply 作为受控服务端契约保留，不暴露为 UI 直接执行按钮。
- UI 不提供直接执行路径：不调用 dry-run / apply，不展示确认弹层，也不代替 agent 的运行时确认。
- 一键整理发送成功后进入绑定会话，由会话展示受控流程和结果；失败时 UI 保持分析报告可见。
- 保留现有 `organize_settings` agent 工具和运行时确认；UI 路径不绕过 dry run、计划摘要或用户确认。

### 非目标

- 第一版不提供无确认全自动整理，也不在 UI 中自动生成或导入整理计划。
- 不做复杂 diff 编辑器、批量规则编辑器或计划版本树。
- 不删除或替换 `organize_settings` 的 agent 工作流。
- 不扩展整理计划本身支持的实体类型、字段或操作；该能力由 `settings-reorganization-core` 和 `settings-reorganization-entities` 定义。

## Capabilities

### New Capabilities

- `setting-organization-ui`: 设定中心的整理报告和 AI 一键整理委托行为。

### Modified Capabilities

（无）

## Impact

- `packages/app`: 设定中心 UI、查询 mutation、确认弹层、结果展示与数据刷新。
- `packages/schema` / `packages/protocol`: 新增整理 API 请求、响应和错误契约。
- `packages/server`: 新增 HTTP handler，并通过整理服务端口调用整理能力。
- `packages/plugin`: 仅公开既有设置整理模块导出，不改变整理域逻辑。
- `packages/opennovel`: 提供基于现有 plugin 整理逻辑的服务适配器，保持 `server` 不直接依赖 `plugin`。
- `packages/client`: 公开 Protocol 变更后重新生成 SDK。
