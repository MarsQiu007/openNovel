# Design

## Context

见 proposal.md。已核实的现状接口（2026-10-28 main 工作树）：

- **默认标题**：`packages/core/src/session.ts:293` 创建时 `title = input.title ?? "New session - <ISO时间戳>"`；子会话对应 `Child session - ...` 形式。前端 `packages/app/src/utils/session-title.ts:1` 有识别该占位的正则（`^(New session|Child session) - <ISO>$`）。
- **title agent**：`packages/core/src/plugin/agent.ts:43` 定义 `PROMPT_TITLE`（模块私有常量），:196 注册为 hidden internal agent（deny 全部工具权限，纯文本生成）。全仓无调用点。
- **写回链路**：`V2Session.update({ title })`（session.ts:200/:557）→ `SessionEvent.Updated` → projector 落库（projector.ts:203-214）+ 事件广播，前端经既有同步刷新标题。零协议变更。
- **挂载点**：`SessionRunner.run` 的 drain 主循环（runner/llm.ts:383-406）——`while (shouldRun)` 退出即该次 drain 完成；:83 的 Post-run maintenance TODO 明确把「Update title」规划在有界后台工作。
- **后台 LLM 工作先例**：`SessionCompaction.make({ events, llm, config })`（llm.ts:109）——runner 内以 `llm.stream` 发起独立生成，可仿照。
- **模型解析**：`SessionRunnerModel.resolve(session)`（runner/model.ts:76）是唯一现成的模型解析入口（按会话模型）；`small_model` 配置（config/v1/config.ts:106）已定义但全仓未使用，无现成按 `"provider/model"` 字符串解析的入口。
- **并发**：同会话 drain 由 SessionRunCoordinator 串行（process-global），run 尾部挂载天然避免同会话并发重复命名。

## Goals / Non-Goals

**Goals:**

- 占位标题会话在 drain 完成后自动命名一次，写回经既有事件链对前端可见。
- 生成、清洗、写回、容错全部为 core 内聚实现，可单测。
- 失败静默；不覆盖非占位标题；主流程行为不变（除新增的一次有界调用）。

**Non-Goals:**

- 不接入 `small_model` 配置（无现成解析入口，另立增强；上游缺省回退同样是会话模型）。
- 不改 `PROMPT_TITLE` 文案、不做标题语言强制（生成语言由模型跟随输入）。
- 不做「每次对话后重新命名」「手动触发重新命名」；不重构 app 会话数据流。
- 不做异步 fork 的后台任务框架（见 D5，采用 run 尾部顺序有界执行）。

## Decisions

### D1：挂载在 `SessionRunner.run` drain 尾部

`while (shouldRun)` 退出后执行一次自动命名检查：会话标题为占位时才继续。选中该点的理由：drain 完成 = 本轮对话（含 steering/queue 续跑）全部结束，首条用户消息与首个助手正文均已落库，生成输入完整；与 llm.ts:83 的规划对齐；coordinator 串行保证同会话不并发重入。备选「首个 provider turn 完成后挂载」被否——turn 中途挂载会打断续跑判断，且首个 turn 结束时可能还没有助手正文。

### D2：占位判定用前缀 + 时间戳形状，与前端正则同一模式

core 侧判定函数匹配 `^(New session|Child session) - <ISO 时间戳>$`（与 `app/src/utils/session-title.ts:1` 同一模式；core 自带实现，不跨包依赖 app）。该判定同时天然满足「只命名一次」：成功命名后标题不再占位，后续 drain 不再触发；用户改题/工具传题后同样不再占位，不会被覆盖。

### D3：一次有界 `llm.stream` 生成，模型用会话模型

生成请求：system 直接复用 `plugin/agent.ts` 导出的 `PROMPT_TITLE` 常量（title agent 注册与本生成入口共享同一事实源，无需经 AgentV2 再解析 hidden agent），用户输入 = 首条用户消息文本（截断 4000 字符）+ 首个助手正文（截断 2000 字符）；`maxTokens = 128`；模型 = `models.resolve(session)`。备选「接入 small_model 配置」被否（见 Non-Goals）。

标题请求显式传 `providerOptions.openai.reasoningEffort = "none"`，不让推理消耗标题输出预算。OpenAI Chat 的 `max_tokens` 同时覆盖 reasoning 与可见正文；真实 GLM 重放中，原请求以 `finish = length` 结束，128 个输出 token 中 127 个用于 reasoning，正文为空；保持 128 token 不变、仅关闭推理后以 `finish = stop` 返回正常标题。因此不能用盲目增大 token 上限替代该约束。

### D4：输出清洗后写回，空结果放弃

取生成文本首个非空行，去包围引号与首尾空白，超长截断为 80 字符加省略号；清洗后为空则放弃命名。写回直接发布既有 `SessionEvent.Updated`，由 projector 落库并广播；与 `V2Session.update({ title })` 使用同一事件链，但不反向依赖 SessionV2，也不直接写库或新增事件。

书内切换器使用独立的 `bound-sessions` 查询，而非 global-sync 的 session store；仅在通用事件 reducer 合并标题不足以刷新该列表。`useNovelLiveInvalidation` 对绑定会话的 `session.next.updated` 立即失效当前小说查询，保证标题写回后顶部触发器与下拉列表同步刷新；其他会话的更新不扩大失效范围。

### D5：run 尾部顺序有界执行，全错误静默

命名是 drain 尾部的一次顺序调用：仅在占位会话的首次 drain 后发生，maxTokens 小，时延可接受；避免引入 fork 后台任务的生命周期问题（run 结束后 fork 任务被中断/泄漏的边界）。整个命名过程包裹为「任何错误 → 记日志 → 返回」，不改变 run 的返回与错误语义。备选「fire-and-forget fork」被否——runner 的 drain 无持久身份，fork 出的命名任务缺少明确的生命周期归属。

### D6：命名能力封装为 `SessionTitle.Service`

runner 只依赖 `ensure(sessionID)`，生成、数据源读取、清洗和事件写回封装在 `session/title.ts`。该服务作为 Location node 接入 runner 依赖图：runner 既有测试可替换为记录调用的 fake，避免自动命名额外消费 fake LLM 响应；独立集成测试则组装真实 `SessionTitle.node`，覆盖真实请求、落库写回与容错。

## Risks / Trade-offs

- [首次 drain 尾部增加一次 LLM 调用的时延与费用] → 仅触发一次、maxTokens 小、无工具循环；后续 drain 零开销（标题非占位即跳过）。
- [title agent 的 hidden 配置与直接生成入口可能漂移] → 两者复用同一 `PROMPT_TITLE` 导出；自动命名不发工具请求，不依赖 agent select。
- [生成标题语言与质量依赖会话模型] → 与上游缺省行为一致；语言/质量优化另立 change，不在本范围。
- [老占位会话补偿命名可能让「故意保留占位」的用户标题被改] → 占位标题本质是机器生成的无信息字符串，上游同样会自动命名；可接受。

## Migration Plan

纯 core 行为新增，随版本发布生效；无协议变更、无数据迁移。老占位会话下次对话时自然补偿命名。回滚即还原代码（已命名标题保留，属正常用户数据）。
