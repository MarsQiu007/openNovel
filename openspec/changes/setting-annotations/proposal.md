## Why

设定中心的世界观条目不支持批注：用户无法选中设定文字添加意见、无法让 AI 按批注自动修改设定内容。章节正文已有完整的批注系统（锚定、展示、AI 执行），设定侧完全缺失。本提案复用章节批注的架构模式，为设定条目补齐批注能力。

依赖 setting-readability 提案完成：前端分段渲染（批注需要段落结构）和 read_setting（AI 执行时需要读取设定全文）。

## What Changes

- **新增数据表**：world_entry_annotations（批注记录，复制 chapter_annotations 结构，chapter_id 改为 world_entry_id）+ world_entry_annotation_rounds（执行轮次，同模式）
- **新增 Schema + Protocol API**：WorldEntryAnnotation / CreateSettingAnnotationInput / SettingAnnotationExecutionRound 等 schema；批注 CRUD + 执行轮次的 HttpApi 端点
- **新增 plugin tools**（4 个）：
  - annotate_setting — AI 主动给设定条目添加批注（仿照 annotate_chapter）
  - list_setting_annotations — 列出指定条目的批注
  - resolve_setting_annotation — 手动/AI 标记批注为 resolved/wontfix
  - report_setting_annotation_execution — AI 执行完批注后回填轮次状态
- **前端 world-reader 增加批注交互**：选中文字 → 弹出批注对话框 → 存储锚点（段落索引 + 偏移量 + 引用文本）；批注高亮展示；批量执行按钮触发 AI 修改设定内容
- **前端批注执行流程**：复用 annotation-execution.ts 的 round + prompt 模式，生成设定修改 prompt 发送给 AI session

## Capabilities

### New Capabilities

- setting-annotation-system: 设定批注的完整生命周期（用户创建批注 → 展示高亮 → AI 执行修改 → 回填状态），包含数据模型、API、plugin tools 和前端交互

### Modified Capabilities

- setting-agent-tools: 新增 annotate_setting / list_setting_annotations / resolve_setting_annotation / report_setting_annotation_execution 四个工具（setting-readability 提案引入该 capability，本提案扩展其工具列表）

## Impact

- **packages/novel-store** — 新增 WorldEntryAnnotationTable + SettingAnnotationRoundTable 两个表（含迁移 SQL）；新增 CRUD + 执行轮次的 store 函数
- **packages/schema** — 新增批注相关 schema 定义
- **packages/protocol** — 新增批注相关 HttpApi 端点定义
- **packages/client** — 运行 bun run generate 重新生成客户端代码
- **packages/plugin** — 新增 4 个批注相关 tool；novel-writer.ts 注册
- **packages/app** — world-reader.tsx 增加批注选区 + 高亮 + 执行按钮；复用 annotation-utils / annotation-panel 的逻辑
- **packages/opennovel** — server handlers 新增批注 API 处理
- **兼容性** — 新表为增量迁移，不影响现有数据；world_entries 表不变