# Tasks: view-model-cleanup

> 实施梯度：类型层先行（union 缩窄触发 never 收窄，编译器标出全部遗漏消费点），按「error/Part/FilePartSource 族 → OutputFormat/Permission/Question 族 → adapter 构造点 → layout 残留 → 守门」收敛。每组任务自带验证。

## 1. 类型层先行（编译器带路）

- [x] 1.1 删 view-model.ts 的 error union 六成员（ProviderAuthError/MessageOutputLengthError/StructuredOutputError/ContextOverflowError/ContentFilterError/ApiError），AssistantMessage.error 缩为 `MessageAbortedError | UnknownError`；删 Part union 六成员（StepStartPart/StepFinishPart/SnapshotPart/PatchPart/RetryPart/SubtaskPart）；删 FilePartSource 的 SymbolSource（FilePartSource 缩为 FileSource | ResourceSource——ResourceSource 经编译器带路发现 prompt-input MCP 附件构造为活，SymbolSource 确死，连带删 Range 死 import 与 client.ts 的 ProviderAuthError 压过 re-export）。验证：`bunx tsgo -b --force` 四包绿；server-session.test.ts 的 step-start 构造改 `unknown` 中间量（SKIP_PARTS 防御域的 wire 残留模拟，不产生断言告警）。

## 2. 字段与类型同链删（D1）

- [x] 2.1 删 UserMessage.format 字段 + OutputFormatText/OutputFormatJsonSchema/OutputFormat 三类型（JsonSchema 保留）；删 Session.permission 字段 + PermissionAction/PermissionRule/PermissionRuleset 三类型；删 QuestionRequest.tool 字段 + QuestionTool 类型。验证：typecheck 绿。
- [x] 2.2 删 adapter 构造点：adaptQuestion 不再 spread tool（v2-adapter.ts:128）；确认 adaptUser/adaptInfo 无 format/permission 构造（审计已证，仅需复查 typecheck 无残留引用）。验证：typecheck 绿。

## 3. SKIP_PARTS 注记（D3）

- [x] 3.1 在 event-reducer.ts:20 / server-session.ts:28 / sync.tsx:7 三处 SKIP_PARTS 加注释：patch/step-start/step-finish 类型成员已删，此过滤对应 wire 侧残留 part type 的运行时防御。不改过滤行为。验证：app typecheck 绿。

## 4. 残留字面量

- [x] 4.1 layout.tsx:766 reviewMode 校验删 `|| mode === "turn"`。验证：typecheck 绿；grep `"turn"` 仅剩小说 beat kind 活链（turn_scan_status=1 零命中）。

## 5. 守门与收官

- [x] 5.1 全量守门：app/session-ui/enterprise/sdk-js `bunx tsgo -b --force` 绿；repo root `bun x oxlint` 0 errors 且 warnings ≤ 基线；app 单测失败数 ≤ 基线 27；session-ui 组件测试 73/73。验证：各命令输出记录进实施注记。（守门输出：四包 tsgo --force 全绿；oxlint 5713 warnings / 0 errors——main 同口径复测同为 5713，5712→5713 漂移来自未跟踪文件内容变化，非本分支引入，零新增告警；app 单测 663 pass / 27 fail = 基线（归因：新增 1 红为 v2-adapter.test.ts adaptQuestion 用例期望 tool 透传，属本提案删除的预期联动，已同步修测试）；session-ui 组件测试 73 pass / 0 fail。e2e 守门结果待补）
- [ ] 5.2 收官：勾选本文件全部任务；`git log --grep "OpenSpec-Change: view-model-cleanup" --format="%h %s"` 收集实现提交写入 `## Implementation Commits`；`openspec validate view-model-cleanup` 通过。

## Implementation Commits

（收官时回填）

## Workflow follow-up

- `openspec validate view-model-cleanup`（skip_specs，零 delta 提示属预期）
- `npx openspec archive view-model-cleanup --yes` 归档，确认是纯 rename 无残留
- 合并前工作树干净，`git merge --ff-only view-model-cleanup` 合入 main，删除本地分支（不推送）
