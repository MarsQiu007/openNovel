# Design: agent-instruction-layering

> 2026-10-23 穷尽式核实后重构：修正「fork 只有全局单文件 AGENTS.md」的过时前提，把落点从 core 收敛到 plugin 快照组装。

## 现状盘点（核实证据）

- `packages/core/src/instruction-context.ts:46-58`：已有项目级分层发现——`fs.up({ targets: ["AGENTS.md"], start, stop })` 从 `location.directory` 向项目根逐级收集，外加全局 `~/.config/AGENTS.md` 兜底；经 system-context 注册（baseline/update/removed 渲染齐备）。**项目级「近者优先」已存在，本提案不触碰。**
- 书稿布局（`packages/plugin/src/novel-writer/cli.ts:73-91`、`state-commit.ts:204-238`）：`<project>/.novel/` 下有 `novel.db`、`state-log.md`、`config.json`；**章节是 DB 行，无目录**——「从章节目录逐层收集」的字面前提不成立，分层需重新锚定为约定文件。
- 注入位（`packages/plugin/src/novel-writer/context.ts`）：`assembleSnapshot(novelId, chapterNumber, directory)`（:470）组装 `ContextPacket`，P4 段 = `styleGuideRuleLines(styleGuide, truncated)`（:57、:853），渲染层与快照工具输出（`tools/context-render.ts:152`）共用同一函数；组装时当前章号已知、卷号由 `ChapterTable` 解析——发现所需输入（卷号/章号/项目目录）在组装点全部可得。
- writer/auditor/reviser 的上下文由 pipeline 经 dispatch prompt 组装，快照是同一份——挂进快照即覆盖三个阶段，**agent 注册面零改动**（不新增 agent、不动 permission map、不动 category）。

## 方案

### 文件约定

`<project>/.novel/instructions/` 目录，按层级命名（全小写、固定模式）：

| 文件 | 层级 | 生效范围 |
| --- | --- | --- |
| `book.md` | 全书 | 所有章 |
| `volume-<n>.md` | 卷 | 第 n 卷的所有章 |
| `chapter-<n>.md` | 章 | 第 n 章 |

### 发现与合并

- 组装快照时按当前章解析出的卷号/章号收集 `book.md` → `volume-<n>.md` → `chapter-<n>.md` 中存在的层；缺失层静默跳过，目录不存在等同全缺失。
- 渲染顺序远→近（近者后注入、自然优先），每层带 `Instructions from: <path>` 来源行（对齐 core instruction-context 的渲染惯例）。
- 读取失败（权限/编码）不阻塞快照：该层跳过，渲染层附一行降级提示。

### 注入与预算

- `ContextPacket` 增加 `instructions` 字段（`{ path, content }[]`），渲染为 P4 相邻的「写作规范」段；`context.ts` 与 `tools/context-render.ts` 共用同一渲染 helper（对齐 `styleGuideRuleLines` 的共用模式）。
- 预算沿用 P4 截断模式：总量超限时从远层开始截断、近层完整保留，截断时置标志由渲染层附「完整规范见 <path>」提示。

### 通道边界

- 与记忆系统（agent-memory-system）：规范文件（作者维护）与记忆注入包（agent 沉淀）是两条独立通道；审校子代理同时吃两者时各自追加段落、不混排。
- 与 core instruction-context：项目级 `AGENTS.md` 走 core 的 system-context 通道；书稿内规范走快照 P4 通道；两者渲染位置不同、职责不同，不合并。

## 范围边界（否决项记录）

- 曾考虑「增强 core instruction-context 支持书稿子目录发现」——否决：章节无目录，且 core 通道面向 Location 级 ambient 注入，与按章组装的快照生命周期不匹配；plugin 侧落地更贴合。
- 曾考虑「规范存 DB（novel-store 表）」——否决：proposal 非目标已明确作者直接维护 Markdown；DB 化会引入迁移与 UI 诉求，超出本提案体量。
- 卷号解析依赖 `ChapterTable` 现状（assembleSnapshot 已解析当前卷）；无卷的扁平书稿只生效 `book.md` + `chapter-<n>.md` 两层。
