# Proposal

## Why

手动新建会话在首次对话后标题不自动命名，一直停留在 `New session - <时间戳>` 占位（活库实证：ses_e7f63d2f2ffeVLpa 首条对话完成后标题仍为 `New session - 2026-10-28T03:44:41.231Z`）。根因：V2 会话流程从未接入标题生成——`title` agent 已在 `packages/core/src/plugin/agent.ts:196` 注册（PROMPT_TITLE），但全仓无任何调用点；`packages/core/src/session/runner/llm.ts:83` 的 Post-run maintenance「Update title」是未实现的 TODO。UI 注释（`session-switcher.tsx:75-76`）承诺的「服务端 ensureTitle 自动命名」在 V2 里不存在。流水线会话有中文标题是因为工具创建时显式传题，与自动命名无关。

## What Changes

- V2 runner 在会话 drain 完成后，对标题仍为默认占位（`New session - ...` / `Child session - ...`）的会话执行一次自动命名：用 title agent 的系统提示对首条用户消息（及首个助手正文）做一次有界 LLM 生成，清洗输出后写回标题。
- 写回复用既有链路 `V2Session.update({ title })` → `SessionEvent.Updated` → projector 落库 + 前端事件，无协议变更。
- 非默认标题（用户改题、创建时显式传题）不被覆盖；成功命名后不再重复触发；生成失败静默保留原标题，绝不影响对话主流程。
- 老的占位会话在下次对话时自然补偿命名，无需迁移。

## Capabilities

### New Capabilities

- `session-auto-title`: 会话首次对话后的自动命名——默认占位标题的会话在对话完成后生成内容相关的简洁标题并写回，已有标题不被覆盖，命名失败不影响会话主流程。

### Modified Capabilities

（无——现有 specs 未覆盖该能力。）

## Impact

- **packages/core**：`src/session/runner/llm.ts`（run drain 尾部挂载）、`src/session/`（自动命名模块：占位判定、生成调用、输出清洗）、`src/session/runner/model.ts`（复用会话模型解析）、`src/session.ts`（复用 V2Session.update）、`src/plugin/agent.ts`（title agent 系统提示的读取/导出）。相应单测。
- **不涉及**：协议 / schema / client 生成代码 / app / session-ui（前端经既有 `session.updated` 事件链自动刷新标题，无需改动）；数据库无 schema 变更、无迁移。
- **模型与成本**：每次自动命名是一次额外的有界 LLM 调用（仅占位标题会话的首次对话后触发一次），使用会话当前模型；`small_model` 配置接入不在本 change。
