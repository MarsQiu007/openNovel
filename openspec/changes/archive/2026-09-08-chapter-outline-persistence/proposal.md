# 章纲持久化入库（chapter-outline-persistence）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

章节大纲正文当前主要存放在 `.novel/outlines/chapter-{n}.md` 文件；`chapters` 表没有 outline 字段。文件一旦缺失、改名或同步冲突，流水线步骤 1 会拿不到章纲，writer 在无大纲状态下裸写，后续兜底也无法恢复源头数据。章纲是写作链路的源头输入，应与书、卷、章同生命周期持久化。

## What Changes

- 在 `chapters` 表新增 `outline` 字段，将章纲作为章节记录的一等数据保存。
- `generate_chapter_outline` 写入数据库，并同步保留 Markdown 文件用于过渡兼容。
- `read_chapter_outline`、`read_outline`、写作快照和 WebUI 章纲读取切换为数据库优先；数据库为空时读取存量 Markdown 并导入数据库。
- WebUI 编辑章纲时更新数据库，并同步写 Markdown 文件，避免新旧读取路径分叉。
- 不迁移总纲和卷纲存储方式；它们仍走现有文件方案。

## Capabilities

### New Capabilities

- `chapter-outline-persistence`: 章纲的数据库存储、存量兼容、读取优先级和编辑同步要求。

### Modified Capabilities

（无——现有 specs 未定义章纲存储能力。）

## Impact

- `packages/novel-store`：`chapters` 表新增 `outline` 列，并补充旧库迁移；提供存量文件导入能力。
- `packages/plugin`：章节大纲生成/读取工具、写作快照读取改为数据库优先。
- `packages/server`：大纲 bundle 和章纲编辑改为数据库优先，并保留文件兼容。
- `packages/app`：无需结构性改动；继续消费大纲 bundle。
- **本地数据兼容性**：已有 `.novel/outlines/chapter-{n}.md` 在读取时导入数据库；导入失败不阻塞写作，可继续读文件。

**非目标**：不做章纲编辑器 UI；不改总纲/卷纲存储；不做章纲版本历史；不删除旧 Markdown 文件。