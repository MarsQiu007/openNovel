# Change: view-model-cleanup

## Why

V1 退休后 view-model.ts（冻结的 V1 形状视图模型契约）成为 app/session-ui 的唯一读取词汇。穷尽式消费审计发现其中残留 **20 个死类型 + 3 个死字段**：V2 wire 无对应形状、v2-adapter 不构造、消费端零类型级/字段级消费。它们与 summary-chain-cleanup 清除的三字段同性质——冻结契约里的冗余词汇，违反「无冗余内容」铁律。趁契约冻结前清账，避免后续开发者误读词汇表。（审计初判 21 类型，执行期经编译器带路确认 ResourceSource 实为 prompt-input MCP 附件的构造产物，予以保留，最终删除 20——见 design.md 误判修正表。）

## What Changes

删除 `packages/sdk/js/src/v2/view-model.ts` 死类型/死字段（六族）：

1. **error union 成员 ×6**：`ProviderAuthError`、`MessageOutputLengthError`、`StructuredOutputError`、`ContextOverflowError`、`ContentFilterError`、`ApiError`——`AssistantMessage.error` union 缩为 `MessageAbortedError | UnknownError`（保留者：UnknownError 是 adaptAssistant 对 wire error 的唯一映射出口；MessageAbortedError 被 rows.ts narrow 消费）。
2. **Part union 成员 ×6**：`StepStartPart`、`StepFinishPart`、`SnapshotPart`、`PatchPart`、`RetryPart`、`SubtaskPart`——`Part` union 缩为 `TextPart | ReasoningPart | FilePart | ToolPart | AgentPart | CompactionPart`。v2-adapter 只构造 text/reasoning/tool/file/agent/compaction 六种；三处 `SKIP_PARTS` 对 `"patch"/"step-start"/"step-finish"` 的运行时过滤保留（防御残留，非本提案范围）。
3. **FilePartSource 成员 ×1**：`SymbolSource`——`FilePartSource` 缩为 `FileSource | ResourceSource`（adaptAttachment 只构造 `type: "file"`；SymbolSource 零构造零 narrow。ResourceSource 经编译器带路确认存活——prompt-input 的 MCP 资源附件构造它）。
4. **OutputFormat 族 ×3 + 字段**：`OutputFormatText`、`OutputFormatJsonSchema`、`OutputFormat`、`UserMessage.format`——adaptUser 不构造 format，全仓零消费（`JsonSchema` 有独立消费，保留）。
5. **Permission 族 ×3 + 字段**：`PermissionAction`、`PermissionRule`、`PermissionRuleset`、`Session.permission`——adaptInfo 不构造该字段，字段零消费；store 顶层 `permission` 键（PermissionRequest[]）是独立活链，不受影响。
6. **Question 链**：`QuestionTool` 类型 + `QuestionRequest.tool` 字段——adaptQuestion 构造了 tool 但消费端零读取。

附带：`packages/app/src/context/layout.tsx:766` persisted reviewMode 校验残留 `"turn"` 字面量（summary-chain-cleanup D1 遗漏，自校正 effect 兜住功能，属词汇残留）。

## Impact

- **零运行时影响**：所有删除项均无生产者（adapter 不构造）且无消费者（类型级 + 字段级 + narrow 三级 grep 核实）。
- **编译器带路**：union 成员删除触发 exhaustive narrow 的 never 收窄报错，消费面遗漏会在 typecheck 立刻显形——验证机制内置。
- **受影响包**：`packages/sdk/js`（view-model.ts）、`packages/app`（layout.tsx 一处）；session-ui/enterprise 预期零改动（其消费的类型全部保留）。
- **无数据迁移**：死词汇不涉及持久化数据。

## 非目标

- 不动 schema/protocol/server/client 里的同名 wire 错误类型（独立活链，与 view-model 出口无关）。
- 不动三处 `SKIP_PARTS` 运行时过滤（运行时防御，删属行为改变，列后续候选）。
- 不动 i18n locale 文件；不动 `packages/sdk/js/src/gen/`（legacy）与 `src/v2/gen/` 生成物。
- 不删 `QuestionOption`/`QuestionInfo`（session-question-dock 字段级消费实锤）、`FilePartSourceText`/`FileSource`（build-request-parts 等字段级消费实锤）、`JsonSchema`（独立消费）。
- 不做 view-model 词汇的 V2 化重命名（契约冻结，字段只删不加不改名）。
