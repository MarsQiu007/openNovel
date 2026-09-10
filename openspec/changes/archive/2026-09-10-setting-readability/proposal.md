## Why

设定中心的世界观条目内容缺乏可读性：AI 生成的 content 往往是一整段没有分段的纯文本，前端用 marked 渲染 Markdown 但没有结构化分段。同时 agent 缺少读取设定全文和按关键词搜索设定内容的工具，list_settings 对 world_entry 只返回 id/category/title，AI 修改前看不到现有内容全文。

## What Changes

- **AI 写入端加分段约束**：save_novel_settings tool description 要求 content 字段用 \n\n 分段；observer 和 architect 的系统提示同步加分段格式要求；所有设定长文本写入工具和提示词必须约束为纯文本，禁止 Markdown 语法
- **前端渲染改分段模式**：world-reader 从 marked HTML 渲染改为纯文本 \n\n 分段渲染（与 chapter-reader 一致），每段渲染为 p[data-paragraph-index]，为后续批注功能提供段落结构
- **新增 read_setting 工具**：AI 可按 entity_type + entity_id 读取单条设定的完整内容（覆盖 character/world_entry/plot_thread/foreshadowing/volume/relationship 全类型）
- **新增 search_settings 工具**：AI 可按关键词搜索设定条目的标题和内容（不传 entity_type 时搜索全部类型），返回匹配的条目 ID + 标题 + 上下文片段

## Capabilities

### New Capabilities

- setting-formatting: 设定内容排版约束（AI 写入端分段格式要求 + 前端分段渲染行为）
- setting-agent-tools: 设定 agent 工具补全（read_setting 全文读取 + search_settings 关键词搜索）

### Modified Capabilities

（无 — 现有 spec 的需求不变，tool description 和渲染方式是 plugin/app 内部实现层的变更，通过新 capability 描述新增行为）

## Impact

- **packages/plugin** — novel-writer.ts 中 save_novel_settings tool description；agents/pipeline.ts（observer 提示）；agents/director.ts（architect/director 提示）；新增 read_setting 和 search_settings 两个 tool
- **packages/app** — pages/novel/world-reader.tsx 渲染逻辑从 marked.parse + innerHTML 改为纯文本分段渲染
- **packages/novel-store** — 无 schema 变更（不涉及表结构）
- **兼容性** — 现有 world_entries.content 中的数据不做迁移，前端渲染时兼容已有数据（有 \n\n 的按分段展示，没有的显示为单段落）