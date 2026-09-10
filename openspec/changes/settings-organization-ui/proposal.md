## Why

agent 工具已经能分析设定、校验整理计划并在确认后执行，但结果只出现在会话输出中，用户缺少一个结构化入口查看问题、审阅计划、确认执行和复查结果。本提案为设定中心补充可视化的整理工作流，同时保持“分析 → dry run → 明确确认 → apply → 复查”的安全流程。

## What Changes

- 在设定中心新增“整理”入口，展示跨实体 analyze 报告：问题类型、受影响条目、证据摘要、建议和数量。
- 提供结构化的计划审阅视图：解析 `plan_json`，按操作显示 update / merge / delete 的影响预览、原因和字段；第一版使用简单文本计划输入，不做复杂 diff 编辑器。
- 新增设置整理 HTTP API，供 UI 直接执行 analyze、dry run 和 apply。
- UI 的 apply 必须先完成 dry run，必须在确认弹层中再次明确确认，并且请求必须携带 dry run 返回的计划摘要；服务端会重新校验计划。
- apply 完成后展示成功、失败、未执行、历史和级联结果，并刷新设定相关查询与剩余问题报告。
- 保留现有 `organize_settings` agent 工具和运行时确认；UI 路径不绕过 dry run、计划摘要或用户确认。

### 非目标

- 第一版不提供全自动整理，也不在 UI 中自动生成整理计划。
- 不做复杂 diff 编辑器、批量规则编辑器或计划版本树。
- 不删除或替换 `organize_settings` 的 agent 工作流。
- 不扩展整理计划本身支持的实体类型、字段或操作；该能力由 `settings-reorganization-core` 和 `settings-reorganization-entities` 定义。

## Capabilities

### New Capabilities

- `setting-organization-ui`: 设定中心的整理报告、计划预览、确认执行和结果反馈行为。

### Modified Capabilities

（无）

## Impact

- `packages/app`: 设定中心 UI、查询 mutation、确认弹层、结果展示与数据刷新。
- `packages/schema` / `packages/protocol`: 新增整理 API 请求、响应和错误契约。
- `packages/server`: 新增 HTTP handler，并通过整理服务端口调用整理能力。
- `packages/plugin`: 仅公开既有设置整理模块导出，不改变整理域逻辑。
- `packages/opennovel`: 提供基于现有 plugin 整理逻辑的服务适配器，保持 `server` 不直接依赖 `plugin`。
- `packages/client`: 公开 Protocol 变更后重新生成 SDK。
