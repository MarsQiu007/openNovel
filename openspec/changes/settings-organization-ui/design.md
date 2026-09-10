# Design

## Context

`settings-reorganization-core` 和 `settings-reorganization-entities` 已在 plugin 中沉淀了跨实体分析、计划解析、计划校验和受控执行能力。`organize_settings` 目前是 agent 工具：`analyze` 返回结构化 metadata，`dry_run` 返回影响预览，`apply` 通过运行时 `ctx.ask` 获取确认。

设定中心位于 `packages/app`，现有 UI 通过 `@opennovel-ai/client` 调用 protocol 中的 novel API。`packages/server` 目前依赖 novel-store、schema、protocol 和 core，不依赖 plugin；`packages/opennovel` 负责组合后端服务并依赖 plugin。因此不能为了 UI 直接让 server handler import plugin 域逻辑。

## Goals / Non-Goals

### Goals

- 复用同一套整理域逻辑，避免 agent 和 UI 的安全规则漂移。
- 让 UI 能拿到结构化报告和预览，而不是解析 AI 的自然语言输出。
- 把 UI 的确认、dry run 前置和服务端重新校验组合成独立于 agent 确认机制的安全闸门。
- 保持依赖方向：schema / protocol 定义契约，server 定义端口并消费契约，opennovel 提供 plugin 适配器，app 只使用生成客户端。

### Non-Goals

- 不在 UI 中自动生成整理计划；第一版由用户粘贴或导入 agent 生成的 `plan_json`。
- 不把复杂 diff 编辑器纳入本提案。
- 不迁移数据库表结构。
- 不重写或移动既有 plugin 整理逻辑。

## Decisions

### D1. 新增三个显式 HTTP 端点

在 NovelGroup 下新增：

- `POST /api/novel/settings-organization/analyze`
- `POST /api/novel/settings-organization/dry-run`
- `POST /api/novel/settings-organization/apply`

请求和响应 schema 放在 schema / protocol 层，并在 `packages/client` 重新生成 SDK。选择三个端点而不是一个 `action` 联合端点，是为了让类型、错误处理和 UI mutation 更直接；`analyze` 不需要计划字段，`apply` 需要确认字段，三者前置条件不同。

`analyze` 输入包含 `novelID` 和可选 `scope`。`dry-run` 与 `apply` 输入包含 `novelID` 和 `planJson`。`apply` 额外要求 `planDigest` 和 `confirmed`。响应使用 camelCase 契约字段；opennovel 适配器负责把 plugin 内部 snake_case 结果映射为公开契约。

### D2. Server 通过整理服务端口访问 plugin 能力

在 server 侧定义一个窄端口，例如 `SettingOrganizationService`，只暴露：

- `analyze(directory, novelID, scope)`
- `dryRun(directory, novelID, planJson)`
- `apply(directory, novelID, planJson, confirmation)`

handler 通过 `Location.Service` 获取目录，再调用端口。opennovel 组装路由时提供适配器，适配器内部调用既有 plugin 函数：

- `loadOrganizeContext` + `analyzeEntities`
- `parseOrganizePlan` + `validateOrganizePlan`
- `executeOrganizePlan`

这样避免 server → plugin 的新依赖，也不需要把整段状态提交逻辑搬进 novel-store。相比复制逻辑到 server，适配器保证 UI 和 agent 使用同一套字段白名单、引用保护、合并保护、历史和级联行为。

### D3. UI 的 apply 使用“dry run 摘要 + 显式确认”

`dry_run` 成功后，适配器基于规范化后的解析计划生成 `planDigest` 返回给 UI。`apply` 请求必须带同一个 `planDigest` 和 `confirmed: true`。适配器在 apply 时重新解析、重新计算摘要、重新加载上下文并重新校验计划；任一步失败则不执行。

这与 agent 路径不同：agent 工具继续使用 `ctx.ask` 运行时确认；UI HTTP 路径没有会话 permission 上下文，因此用 dry run 摘要和显式确认字段作为额外闸门。两个路径都保留服务端重新校验，最终安全边界不依赖前端。

### D4. UI 以报告、计划预览和结果面板组织

设定中心详情区新增“整理”入口或局部视图，切换到 `SettingOrganizationPanel`。面板内部分为四段：

1. 分析报告：问题数量、类型、受影响条目、证据和建议。
2. 计划导入：粘贴或导入 `plan_json`，显示计划版本和操作数量。
3. dry run 结果：成功时显示操作预览；失败时显示逐条错误。
4. 执行结果：成功、部分失败、未执行、级联和历史信息。

执行成功或部分失败后刷新 novel 相关设定查询，并再次调用 analyze。只有分析报告，没有合法 dry run 时，不显示确认入口。

### D5. 设定文本保持纯文本渲染

报告和计划中的长文本使用普通文本节点和空白策略渲染，按空行分段；不使用 Markdown renderer。这和设定写入端“纯文本 + 空行分段”约束一致，也避免批注锚定和原始文本再次失去对应关系。

## Risks / Trade-offs

- [用户只能粘贴计划，第一版便利性有限] → 明确引导用户在会话中让 AI 生成 `plan_json` 后导入；不引入无约束的自动计划生成。
- [HTTP apply 没有会话 permission 流程] → 要求 dry run 摘要、显式确认标记、服务端重新校验，并在确认弹层展示不可自动恢复风险。
- [plugin 内部类型与公开 schema 形状不同] → 在 opennovel 适配器集中映射，避免 app 和 server 知道 plugin 内部结构。
- [重复分析或重复刷新带来开销] → 只有用户打开入口、执行写入或主动重试时调用 analyze；执行后刷新现有相关 query，而不是全量刷新所有 novel 数据。

## Migration Plan

1. 新增 schema 和 protocol 契约，重新生成 client。
2. 在 server 定义整理端口和 handler；opennovel 提供适配器。
3. 添加 UI 面板、mutation、确认弹层和结果展示。
4. 使用现有测试和新增定向测试验证 analyze / dry-run / apply 契约与 UI 状态。
5. 若出现问题，可回滚 UI 入口和 HTTP handler；plugin 工具不受影响。

## Open Questions

（无）
