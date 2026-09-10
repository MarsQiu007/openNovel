## Context

设定中心（world-reader.tsx）当前用 `marked.parse()` 将 content 渲染为 HTML 后通过 innerHTML 注入，无段落结构。AI 写入端（save_novel_settings tool description、observer/architect 系统提示）没有分段格式约束。`list_settings` 对 world_entry 只返回 id/category/title，没有 content 字段，AI 无法读取设定全文。章节阅读器已有成熟的分段渲染模式（`content.split(/\n\n+/)` → `<p data-paragraph-index>`）可参考。

## Goals / Non-Goals

**Goals:**
- AI 写入的设定内容自带分段格式（`\n\n`）
- 前端设定阅读器按段落渲染，为 setting-annotations 提案提供段落锚点
- AI 可读取单条设定全文（read_setting）
- AI 可按关键词搜索设定内容（search_settings）

**Non-Goals:**
- 不做 DB 迁移（现有 world_entries.content 数据不清洗）
- 不做 Markdown 编辑器 / 预览功能
- 不做设定批注（setting-annotations 提案负责）
- 不改变 list_settings 的返回结构（保持向后兼容）

## Decisions

### D1: world-reader 从 marked 改为纯文本分段渲染

**选择**：`content.split(/\n\n+/)` → `<For>` 循环渲染 `<p data-paragraph-index={idx}>`，与 chapter-reader 一致。

**备选方案**：
- 继续用 marked 但后处理 HTML 加段落标记 — 需要额外 DOM 解析，复杂且脆弱
- 保留 marked 渲染 + 额外提供纯文本模式 — UI 复杂度增加，两种模式容易不一致

**理由**：AI 当前写入的内容本就是纯文本（不含 Markdown 语法），marked 渲染没有实际收益。分段渲染与 chapter-reader 模式一致，后续批注功能可直接复用 annotation-utils。

### D2: 分段约束通过 tool description + 系统提示实现，不做代码层 normalize

**选择**：在 save_novel_settings 的 description 和 update_setting 的 description 中明确要求 content 用 `\n\n` 分段；observer pipeline.ts 和 architect/director.ts 的系统提示同步加分段格式指令。

**备选方案**：
- 在 save_novel_settings execute 中检测 content 无 `\n\n` 且长度超阈值时自动插入分段 — 自动插段在句号处可能插错位置（如引号内句号、缩写），风险高
- 存 DB 前统一 normalize — 同上

**理由**：AI 遵循 tool description 的准确率已经很高，格式约束是最安全的方式。为避免 AI 仍输出 Markdown 并破坏段落锚点，写入工具会在执行前拒绝常见 Markdown 语法；显式换行会被规范化为 `\n\n` 段落边界，字数阈值只作为完全无换行的兜底校验。整理工具后续也应沿用同一纯文本约束。

### D3: read_setting 按类型查库返回全字段

**选择**：新增 read_setting tool，按 entity_type 分支查询对应表，返回所有字段（不截断）。类型不支持时返回错误信息列出支持的类型。

**备选方案**：
- 扩展 list_settings 加 include_content 参数 — 改变已有工具签名，可能影响现有 agent 使用习惯
- 用 FTS5 全文检索 — over-engineering，单条读取不需要索引

**理由**：独立工具语义清晰，AI 使用简单（不需要理解 include_content 之类的参数）。全字段返回让 AI 在修改前能完整审阅现有内容。

### D4: search_settings 用 SQL LIKE 搜索，不用 FTS5

**选择**：按 entity_type 分支查库，用 `LIKE '%query%'` 匹配 title/content/description/name 字段，返回 ID + 标题 + 关键词前后各 50 字的上下文片段。

**备选方案**：
- FTS5 全文检索 — 需要建虚拟表和触发器，对 SQLite 设定表（预计百条级别）收益不大，中文分词支持也有局限
- 内存遍历 — 量大时性能差

**理由**：设定数据量小（通常 < 200 条），LIKE 足够。避免引入 FTS5 迁移的额外复杂度。中文搜索对 LIKE 的性能在百条级别无感知延迟。

## Risks / Trade-offs

- [AI 忽略分段约束仍然写入单段] → 前端渲染时兜底显示为单段落（spec 已定义此行为），可读性略降但功能不受影响
- [read_setting 返回大 content 可能消耗较多 token] → 设定条目内容通常在 1-5K 字符，可接受；不设截断避免 AI 拿到不完整信息做误判
- [search_settings LIKE 搜索在数据量大时变慢] → 设定表数据量小，可接受；如未来条目数超千级可升级为 FTS5

## Migration Plan

无 DB 迁移。部署即生效：
1. tool description 变更在 plugin 代码中，随版本发布生效
2. 前端渲染变更在 app 代码中，随版本发布生效
3. 新增 read_setting / search_settings 在 plugin 代码中，随版本发布生效
4. 回滚 = revert 对应 commit，无数据兼容问题

## Open Questions

（无）