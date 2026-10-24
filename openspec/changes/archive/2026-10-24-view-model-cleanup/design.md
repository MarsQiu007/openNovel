# Design: view-model-cleanup

## Context

### 审计方法与修正

对 view-model.ts 60 个导出做三级消费审计：①类型名 import/标注消费 ②对象字面量构造（adapter 内 `{ name: "UnknownError" as const }` 形态不 import 类型名）③字段级读写与 `.type`/`.name` narrow。fork 首轮审计报告 25 死类型，人工复核修正三处误判：

| 误判 | 修正依据 |
|---|---|
| UnknownError 判死 | `v2-adapter.ts:230` adaptAssistant 把 wire error 统一映射 `{ name: "UnknownError", data: { message } }`——union 成员被构造，删了赋值处即编译错 |
| FileSource 判死 | `v2-adapter.ts:156` adaptAttachment 构造 `source: { type: "file" as const, path, text }` |
| ResourceSource 判死（执行期编译器带路捕获） | `prompt-input.tsx:566,606,868` 与 `prompt-input-v2.tsx:328` 构造 MCP resource 附件的 `type: "resource"` source（写入方向）；SymbolSource 仍确死（`type: "symbol"` 全仓零命中） |
| QuestionOption 判死 | `session-question-dock.tsx:93,156` 读 `options[].label/description`——字段级消费实锤，保留 |

同理确认「标注-only 但字段活」的保留项：`FilePartSourceText`（`build-request-parts.ts:237` 读 `source.text.start/end/value`、`session-context-breakdown.ts:18` 读 `source?.text.value.length`）、`QuestionOption`（同上）。

### 死链证据清单（逐族核实）

| 族 | 死项 | 生产者核查 | 消费者核查 |
|---|---|---|---|
| error ×6 | ProviderAuthError / MessageOutputLengthError / StructuredOutputError / ContextOverflowError / ContentFilterError / ApiError | adaptAssistant 只构造 UnknownError 一种 | 字符串 narrow 零命中（`"ContentFilterError"` 等全仓零 grep）；`error?.name` 消费仅 `=== "MessageAbortedError"`（rows.ts:49）与 `!== "MessageAbortedError"`（session-turn.tsx） |
| Part ×6 | StepStartPart / StepFinishPart / SnapshotPart / PatchPart / RetryPart / SubtaskPart | adaptAssistant parts 只构造 text/reasoning/tool；adaptUser 只构造 text/file/agent；adaptCompaction → adaptUser + compactionPart | `"snapshot"`/`"subtask"`/`"retry"` 在 app/ui 全仓零命中；SKIP_PARTS 仅含 patch/step-start/step-finish 且是 `Set<string>.has()` 运行时不 narrow（server-session.test.ts:1133 构造 step-start 即该防御的测试覆盖，类型删除后测试改 unknown 中间量模拟 wire 残留） |
| FilePartSource ×1 | SymbolSource | adaptAttachment 只构造 `type: "file"` | `type: "symbol"` 全仓零命中；连带删 Range 死 import |
| OutputFormat ×3+字段 | OutputFormatText / OutputFormatJsonSchema / OutputFormat / UserMessage.format | adaptUser 不构造 format | `.format` 消费全为 i18n/usd 误命中 |
| Permission ×3+字段 | PermissionAction / PermissionRule / PermissionRuleset / Session.permission | adaptInfo 不构造 permission 字段 | `session.permission` 字段级读取零命中；bootstrap 读的是 store 顶层 `permission` 键（PermissionRequest[] 独立活链） |
| Question | QuestionTool / QuestionRequest.tool | adaptQuestion 构造 tool（adapter 128） | `request.tool.messageID/callID` 零读取 |
| 残留 | layout.tsx:766 `"turn"` | persisted 校验字面量 | summary-chain D1 遗漏，自校正兜住 |

### 存活对照（勿误删）

- **error 保留**：UnknownError（adapter 构造）、MessageAbortedError（rows.ts:49 narrow；无此成员则 literal 比较编译错 "unintentional comparison"）。
- **Part 保留六成员**：TextPart/ReasoningPart/FilePart/ToolPart（adapter 构造）、AgentPart（adaptUser agents 构造）、CompactionPart（compactionPart() 构造）。
- **FilePartSource 保留**：FileSource（构造）、FilePartSourceText（字段活）、FilePartSource union 标注（`packages/app/src/context/prompt-state.ts:26` 与 `packages/session-ui/src/v2/components/prompt-input/types.ts:20` 两处 props.source 输入标注）。
- **Question 保留**：QuestionOption/QuestionInfo（dock 消费）、QuestionAnswer（session-question-dock）。
- **JsonSchema**：OutputFormatJsonSchema 之外有独立消费。
- SKIP_PARTS 三处（event-reducer.ts:20 / server-session.ts:28 / sync.tsx:7）——运行时防御保留，删属行为改变。

## Goals / Non-Goals

Goals：view-model 死词汇清零（21 类型 + 3 字段 + 1 字面量）；编译器带路验证零意外命中；守门全绿。

Non-Goals：见 proposal.md「非目标」。

## Decisions

### D1：类型与连带字段同链删除

OutputFormat/Permission/Question 三族各含一个「被构造标注引用但本身零消费」的字段（UserMessage.format / Session.permission / QuestionRequest.tool）。字段与类型同链删：adapter 构造点同步移除（adaptQuestion 不再 spread tool）。先例：summary-chain-cleanup 三字段同链删。

### D2：union 缩窄以编译器为闸门

error/Part/FilePartSource 三个 union 删成员后，若有遗漏消费点，exhaustive narrow 会报 never 收窄错——typecheck 即验证，无需手写测试。守门用 `bunx tsgo -b --force`（tsgo -b 增量缓存漏报跨包变化，summary-chain 已踩过）。

### D3：SKIP_PARTS 保留并注记

`"patch"/"step-start"/"step-finish"` 运行时过滤虽对应已删类型成员，但它是 server 数据的防御性丢弃（part 数据的入口不止 adapter 一条，事件流也可能带），删除属行为改变。保留三处 SKIP_PARTS，在代码注释与本 design 注记「类型已删，此过滤对应 wire 侧残留 part type」。

### D4：layout "turn" 字面量随本提案清除

summary-chain 的 D1 遗漏（该校验不在其侦察清单的 session.tsx/layout.tsx:91 两处里）。一行修复纳入本提案，不回写归档提案（按「归档后收尾修复」约定只补回归修复；范围遗漏由当前提案吸收）。

## Risks / Trade-offs

- [wire 未来重新引入某错误形状] → 恢复成本低：类型定义可从 git 历史回溯；且 V2 wire 的错误聚合在 message.error.message 单字段，重新分化的可能性低。
- [Part union 缩窄破坏某处 exhaustive switch] → 编译器带路（D2），守门 typecheck 兜底。
- [Session.permission 字段删除影响 store reconcile 类型] → bootstrap 写入的是 store 顶层键非 Session 字段；typecheck 验证。

## Migration Plan

无需数据迁移。死词汇不涉及持久化数据；persisted reviewMode="turn" 已由 summary-chain 的自校正兜住，本提案只清字面量。

## Open Questions

（无）
