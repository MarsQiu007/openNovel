---
kind: error_handling
name: 错误处理体系：Effect TaggedError + 结构化错误类型 + 用户可读格式化
category: error_handling
scope:
    - '**'
source_files:
    - packages/core/src/account.ts
    - packages/codemode/src/tool-error.ts
    - packages/client/src/generated-effect/client-error.ts
    - packages/app/src/utils/server-errors.ts
    - packages/app/src/pages/session/timeline/timeline-row.ts
    - packages/codemode/src/interpreter/model.ts
---

本仓库采用以 Effect Schema 为核心的错误处理体系，结合结构化错误类型、客户端/服务端错误桥接以及面向用户的可读化格式化，形成跨包一致的异常处理策略。

### 1. 系统/框架
- **Effect `Schema.TaggedErrorClass`**：所有领域错误均通过 `Schema.TaggedErrorClass<T>()("Tag", { fields })` 定义，自带 `_tag` 区分与字段校验，可被 Effect 的 `Either`/`TaskEither` 等组合子安全传播。
- **Effect `Data.TaggedClass`**：用于 UI 状态与事件（如 timeline-row）中的“错误行”表示，属于数据代数数据类型而非抛出型异常。
- **自定义 `InterpreterRuntimeError`**：CodeMode 解释器使用继承自 `Error` 的运行时错误，携带 AST 节点位置信息，便于诊断。

### 2. 核心文件与位置
- `packages/core/src/account.ts`：Account 域的错误聚合（`AccountRepoError` / `AccountServiceError` / `AccountTransportError`），并提供 `fromHttpClientError` 适配 Effect HTTP 客户端错误。
- `packages/codemode/src/tool-error.ts`：工具层拒绝错误 `ToolError`，统一作为 `ToolFailure` 诊断上报。
- `packages/client/src/generated-effect/client-error.ts`：客户端通用 `ClientError`，封装 `cause: Defect`。
- `packages/app/src/utils/server-errors.ts`：客户端与服务端错误桥接，提供 `formatServerError`、`isSessionNotFoundError`、`parseReadableConfigInvalidError` 等函数，将 SDK 返回的结构化错误（如 `ConfigInvalidError`、`ProviderModelNotFoundError`、`SessionNotFoundError`）转换为带 i18n 的用户可读消息。
- `packages/app/src/pages/session/timeline/timeline-row.ts`：UI 侧用 `TimelineRow.Error` 表示会话时间线中的错误条目。
- `packages/codemode/src/interpreter/model.ts`：解释器运行时错误 `InterpreterRuntimeError`，附带 `node`、`kind`、`suggestions` 等诊断字段。

### 3. 架构与约定
- **分层错误模型**：
  - 基础设施层（HTTP、FS、Git、Image 等）在 `packages/core` 中各自定义 `*Error` 类，均基于 `Schema.TaggedErrorClass`。
  - 客户端层通过 `ClientError` 包装底层缺陷，并向上抛出。
  - 应用层（app）不直接依赖具体实现错误，而是通过 `server-errors.ts` 对来自 SDK 的结构化错误进行模式匹配与格式化。
- **错误传播路径**：`throw new Error(cause: { body, status })` → `unwrapNamedError` 提取 `body` → `formatServerError` 按 `name`/`_tag` 分派到对应解析器 → 输出带 i18n 的可读字符串。
- **UI 错误表达**：timeline 使用 `Data.TaggedClass("Error")` 作为纯数据结构，由渲染层决定如何展示，避免在 UI 层抛出异常。
- **诊断增强**：`InterpreterRuntimeError` 保留 AST 节点位置，`sourceLocation`/`formatLocation` 辅助生成“line X, col Y”提示；`supportedSyntaxMessage` 作为统一语法支持说明。

### 4. 约定与约束
- 所有业务错误必须使用 `Schema.TaggedErrorClass` 定义，禁止裸 `throw new Error(...)` 跨边界传播（测试与解释器内部例外）。
- 客户端错误统一通过 `ClientError` 包裹，确保 `cause` 字段可被 Effect 追踪。
- 服务端返回的错误体需包含 `name`（如 `ConfigInvalidError`）或 `_tag`（如 `SessionNotFoundError`），以便 `formatServerError` 正确分派。
- 用户可见错误消息必须经过 `formatServerError` 或对应 `parseReadable*` 函数，保证 i18n key 与 fallback 一致。
- CodeMode 解释器错误必须继承 `InterpreterRuntimeError` 并设置 `kind` 为 `DiagnosticKind` 之一，便于上层统一收集诊断。
- 测试覆盖关键错误路径：`server-errors.test.ts` 验证了配置错误、模型未找到、会话未找到及 i18n 翻译行为。