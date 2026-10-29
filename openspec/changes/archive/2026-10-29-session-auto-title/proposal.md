# Proposal

## Why

手动新建会话的标题不应等到整轮对话、工具调用和子代理全部结束后才自动命名。长任务期间一直显示 `New session - <时间戳>` 占位，且正文工作中断会失去本轮命名机会。标题是会话轻量元数据，应在首条用户输入可见后、正文模型工作开始前生成并持久化。

最初已核实 V2 会话流程未接入标题生成：`title` agent 已在 `packages/core/src/plugin/agent.ts` 注册（PROMPT_TITLE），但全仓无调用点；runner 的 Post-run maintenance「Update title」曾是未实现 TODO。流水线及子代理会话有描述性标题是因为创建时显式传题，与自动命名无关。

## What Changes

- V2 runner 在首条用户输入提升为可见消息后、首个正文模型请求前，对标题仍为默认占位（`New session - ...` / `Child session - ...`）的会话执行自动命名：用 title agent 的系统提示对首条用户消息（及已存在的首个助手正文）做一次有界 LLM 生成，清洗输出后写回标题。
- 标题在正文工作前独立落库，后续长任务、工具失败或进程中断不影响已生成的标题；命名失败或空输出不阻塞正文工作，仍为占位的会话可在后续输入提升时重试。
- 写回复用既有 `SessionEvent.Updated` → projector 落库 + 前端事件，无协议变更；书内会话切换器监听该更新事件并即时失效 `bound-sessions` 查询，避免数据库已命名但列表仍显示旧占位标题。
- 非默认标题（用户改题、创建时显式传题）不被覆盖；成功命名后不再重复触发；生成失败静默保留原标题，绝不影响对话主流程。
- 老的占位会话在下次输入提升时自然补偿命名，无需迁移。

## Capabilities

### New Capabilities

- `session-auto-title`: 会话首条输入后的提前自动命名——默认占位标题的会话在正文模型工作开始前生成内容相关的简洁标题并写回，已有标题不被覆盖，命名失败不影响会话主流程。

### Modified Capabilities

（无——现有 specs 未覆盖该能力。）

## Impact

- **packages/core**：`src/session/runner/llm.ts`（用户输入提升后、正文请求前挂载）、`src/session/`（自动命名模块：占位判定、生成调用、输出清洗）、`src/session/runner/model.ts`（复用会话模型解析）、`src/session.ts`（复用 V2Session.update）、`src/plugin/agent.ts`（title agent 系统提示的读取/导出）。相应单测。
- **packages/app**：`src/context/novel-live.ts` 监听绑定会话的 `session.next.updated`，即时刷新书内 `bound-sessions` 查询；补事件路由回归测试。
- **不涉及**：协议 / schema / client 生成代码 / session-ui；数据库无 schema 变更、无迁移。
- **模型与成本**：每次自动命名是一次额外的有界 LLM 调用（仅占位标题会话的输入提升后触发，成功后仅一次），使用会话当前模型；`small_model` 配置接入不在本 change。
