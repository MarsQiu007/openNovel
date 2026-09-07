## Why

批注面板的"采纳"按钮目前只把状态标记为 `applied`，不会将润色替换文本写入章节正文——`applySuggestion` 纯逻辑已存在但从未接入运行时路径。更根本的问题是，批注工作流缺少一个"用户标记完所有意图后批量执行"的出口，用户无法将已处理的批注一次性交给 AI 改稿，也没有历史面板回顾"哪一轮执行改了什么"。

## What Changes

- **"采纳"语义调整**：按钮仅标记意图（`status → applied`），不在面板中直接修改章节正文；正文修改统一延迟到"执行"阶段由 AI 批量完成
- **新增"执行"按钮**：当章节存在 ≥1 条批注且全部为非 `open` 状态时激活；点击后复用 `findBoundNovelSession` 跳转到该小说最近的绑定会话（无则通过 `createAndBindSession` 自动创建新会话），发送结构化批注指令让 AI 批量改稿
- **AI 指令映射**：`applied` → 写入 `suggestedReplacement`；`resolved` → 按批注意见改写对应段落；`wontfix` → 跳过
- **新增历史面板**：按执行轮次分组展示每轮的批注快照和 AI 改稿结果，独立于当前批注列表
- **历史面板"重新激活"**：从历史轮次中将批注捞回当前面板（状态 → `open`），用户再次审阅后统一走"执行"入口
- **状态机调整**：`applied` 允许转回 `open`（当前为终态）
- **Protocol / Schema 扩展**：新增执行轮次相关 schema 定义和 HttpApi 端点（轮次 CRUD）；`UpdateAnnotationInput` 增加 `executionRoundId` 可选字段

## Capabilities

### New Capabilities

- `annotation-execute-flow`: 批注的批量执行流程——执行按钮激活条件、AI 会话路由与指令格式、执行轮次记录、历史面板与重新激活

### Modified Capabilities

## Impact

- **packages/schema**：`ChapterAnnotation` 增加 `executionRoundId` 可选字段；新增 `ExecutionRound` schema 和 `CreateExecutionRoundInput` / `ExecutionRoundQuery` 输入定义
- **packages/protocol**：`novel.ts` 分组新增 `novel.create-execution-round` / `novel.execution-rounds` / `novel.execution-round` 端点；`UpdateAnnotationInput` 增加 `executionRoundId` 字段
- **packages/novel-store**：新增 `AnnotationExecutionRoundTable`；`ChapterAnnotationTable` 新增 `execution_round_id` 可空列；新增轮次 CRUD 函数
- **packages/plugin**：`annotation.ts` 中 `VALID_TRANSITIONS` 允许 `applied → open`；新增批注指令格式化函数；`applySuggestion` / `canApplyAnnotation` 从测试专用变为运行时可用
- **packages/server**：`handlers/novel.ts` 新增轮次 CRUD handler；`update-annotation` handler 支持传入 `executionRoundId`
- **packages/app**：批注面板新增"执行"按钮、历史面板 tab、重新激活交互；复用 `findBoundNovelSession` / `createAndBindSession` 实现会话路由
- **packages/client**：修改 Protocol 后运行 `bun run generate` 重新生成 SDK
- **数据兼容性**：现有批注数据无需迁移；执行轮次表为增量新建；批注表加列通过 `migrate.ts` 的 `PRAGMA table_info` 检查模式处理