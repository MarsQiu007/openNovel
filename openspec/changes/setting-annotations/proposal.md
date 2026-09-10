## Why

设定中心的世界观条目还没有批注能力：用户无法选中设定文字记录意见，也无法让 AI 按批注受控修改设定内容。章节正文已有完整的批注、高亮和 AI 执行流程，设定侧需要补齐同等工作流。本提案复用既有批注架构，并针对设定文本增加更强的纯文本与内容保护约束。

## What Changes

- 新增世界观条目批注表和执行轮次表，记录段落索引、字符偏移、引用文本、评论、替换建议、状态和执行关联。
- 新增批注 CRUD 与执行轮次的 Schema、Protocol API、server handler 和 novel-store 读写函数。
- 新增 4 个 plugin 工具：`annotate_setting`、`list_setting_annotations`、`resolve_setting_annotation`、`report_setting_annotation_execution`。
- 设定详情支持选中文字创建批注、按锚点高亮、悬浮查看评论、查看批注列表和执行历史。
- 用户触发批注执行后，UI 创建执行轮次、生成设定修改 prompt，并发送给绑定写作会话。
- AI 执行 prompt SHALL 约束其先读取设定全文，只修改目标 world_entry 的 content，保持纯文本和空行分段，禁止写入 Markdown、虚构设定或绕过 `report_setting_annotation_execution` 回填。

### 非目标

- 第一版只支持 world_entry 批注，不扩展到 character、relationship、plot_thread 或 foreshadowing。
- 不提供设定内容的多版本树或复杂 diff 编辑器。
- 不让 UI 或 AI 绕过执行轮次直接批量修改设定。
- 不删除或替换章节批注系统。

## Capabilities

### New Capabilities

- `setting-annotation-system`: 世界观批注的选区创建、高亮展示、执行轮次、受控 AI 修改和状态回填。

### Modified Capabilities

- `setting-agent-tools`: 新增设定批注相关工具，并约束 AI 只能基于真实锚点和设定全文执行修改。

## Impact

- `packages/novel-store`: 新增批注表、执行轮次表和读写函数；增量迁移。
- `packages/schema` / `packages/protocol`: 新增批注与执行轮次契约。
- `packages/server`: 新增批注 API handler。
- `packages/client`: 公开 Protocol 变更后重新生成 SDK。
- `packages/plugin`: 注册设定批注工具并更新 director 提示词约束。
- `packages/app`: 设定详情增加选区、高亮、批注面板、执行按钮和结果刷新。
