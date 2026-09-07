# 章纲持久化入库（chapter-outline-persistence）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

章节大纲正文只存 `.novel/outlines/chapter-{n}.md` 文件，`ChapterTable` 无 outline 列（`improve-context-fidelity/design.md:18-19` 已定位）。文件一旦缺失，流水线步骤 1 拿不到章纲，writer 在无大纲状态裸写，流水线无兜底——大纲是写作的源头输入，却存在最脆弱的存储介质上。

`improve-context-fidelity`（独立提案）包含短期兜底方案（D3：快照无章纲段时先 `read_outline` 再失败），本提案是**根治方案**：章纲作为一等数据入库，与书/卷/章同生命周期。

## What Changes

- 章纲持久化到 SQLite（方案研究：ChapterTable 增加 outline 列 vs 独立表；需兼容大纲的结构化字段如创作意图/场景编排/角色焦点）。
- `generate_chapter_outline`、`read_chapter_outline`、`read_outline` 等工具切换到 DB 读写；`.md` 文件的存量数据迁移或双读降级。
- 与 `improve-context-fidelity` 的 D3 兜底边界在此提案研究时理清（兜底解决"文件缺失"，入库后兜底仍有价值——工具失败兜底）。

## Capabilities

### New Capabilities

- `chapter-outline-persistence`: 章纲的存储与读取要求——持久化位置、迁移兼容、工具读写行为。

### Modified Capabilities

（无——现有 specs 无章纲存储相关能力。）

## Impact

- `packages/novel-store`：表结构迁移（**本地数据兼容性**：存量 `.novel/outlines/*.md` 文件需一次性迁移导入，或读取时文件/DB 双源降级；迁移失败不得阻塞写作主流程）。
- `packages/plugin`：大纲生成/读取工具、pipeline 步骤 1。
- `packages/app`：大纲读取面板（如引用文件路径需同步）。

**非目标**：本变更不做章纲编辑器 UI；不改动卷纲/总纲（master/volume outline）的存储方式；不实现大纲版本历史。
