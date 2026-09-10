## Why

agent 工具可以完成整理，但用户缺少一个直观入口查看设定问题、审阅整理计划和确认执行。本提案为设定中心补充整理报告和计划执行入口。

## What Changes

- 在设定中心新增“整理”入口。
- 展示 analyze 报告：问题分类、受影响条目、建议操作和风险等级。
- 展示 plan_json 的 dry_run 预览。
- 提供用户确认后的 apply 操作，并展示结果和历史提示。
- 本提案依赖 `settings-reorganization-core` 先完成；是否需要新增 HTTP 接口在实施前细化。

### 非目标

- 第一版不提供全自动整理。
- 不做复杂 diff 编辑器。
- 不在 UI 中直接绕过 dry_run / 确认流程。

## Capabilities

### New Capabilities

- `setting-organization-ui`: 设定中心的整理报告、计划预览和确认执行行为。

### Modified Capabilities

（无）

## Impact

- `packages/app`: 设定中心 UI、状态管理和交互。
- `packages/protocol` / `packages/schema` / `packages/opennovel`: 如需要服务端接口则同步扩展；具体范围实施前确认。
- `packages/client`: 若公开 Protocol 变更，需要重新生成 SDK。
