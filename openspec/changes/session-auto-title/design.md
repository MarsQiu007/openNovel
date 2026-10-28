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
- 不做「每次对话后重新命名」「手动触发重新命名」；不改 app 前端。
- 不做异步 fork 的后台任务框架（见 D5，采用 run 尾部顺序有界执行）。

## Decisions

### D1：挂载在 `SessionRunner.run` drain 尾部

`while (shouldRun)` 退出后执行一次自动命名检查：会话标题为占位时才继续。选中该点的理由：drain 完成 = 本轮对话（含 steering/queue 续跑）全部结束，首条用户消息与首个助手正文均已落库，生成输入完整；与 llm.ts:83 的规划对齐；coordinator 串行保证同会话不并发重入。备选「首个 provider turn 完成后挂载」被否——turn 中途挂载会打断续跑判断，且首个 turn 结束时可能还没有助手正文。

### D2：占位判定用前缀 + 时间戳形状，与前端正则同一模式

core 侧判定函数匹配 `^(New session|Child session) - <ISO 时间戳>$`（与 `app/src/utils/session-title.ts:1` 同一模式；core 自带实现，不跨包依赖 app）。该判定同时天然满足「只命名一次」：成功命名后标题不再占位，后续 drain 不再触发；用户改题/工具传题后同样不再占位，不会被覆盖。

### D3：一次有界 `llm.stream` 生成，模型用会话模型

生成请求：system = title agent 的系统提示（优先经 AgentV2 服务读取 title agent；若其 select 不含 hidden agent，则在 `plugin/agent.ts` 导出 `PROMPT_TITLE` 常量复用，保持单一事实源），用户输入 = 首条用户消息文本（截断约 4000 字符）+ 首个助手正文（截断，提升命名准确性）；`maxTokens` 设小值（约 128）；模型 = `models.resolve(session)`。备选「接入 small_model 配置」被否（见 Non-Goals）。

### D4：输出清洗后写回，空结果放弃

取生成文本首行，去包围引号与首尾空白，超长截断（约 80 字符）；清洗后为空则放弃命名。写回仅调 `V2Session.update({ sessionID, title })`，不直接写库、不发自定义事件。

### D5：run 尾部顺序有界执行，全错误静默

命名是 drain 尾部的一次顺序调用：仅在占位会话的首次 drain 后发生，maxTokens 小，时延可接受；避免引入 fork 后台任务的生命周期问题（run 结束后 fork 任务被中断/泄漏的边界）。整个命名过程包裹为「任何错误 → 记日志 → 返回」，不改变 run 的返回与错误语义。备选「fire-and-forget fork」被否——runner 的 drain 无持久身份，fork 出的命名任务缺少明确的生命周期归属。

## Risks / Trade-offs

- [首次 drain 尾部增加一次 LLM 调用的时延与费用] → 仅触发一次、maxTokens 小、无工具循环；后续 drain 零开销（标题非占位即跳过）。
- [title agent 的 select 可能不含 hidden agent] → D3 已给主备路径（服务读取优先，导出常量兜底），实现时以代码现状为准。
- [生成标题语言与质量依赖会话模型] → 与上游缺省行为一致；语言/质量优化另立 change，不在本范围。
- [老占位会话补偿命名可能让「故意保留占位」的用户标题被改] → 占位标题本质是机器生成的无信息字符串，上游同样会自动命名；可接受。

## Migration Plan

纯 core 行为新增，随版本发布生效；无协议变更、无数据迁移。老占位会话下次对话时自然补偿命名。回滚即还原代码（已命名标题保留，属正常用户数据）。
