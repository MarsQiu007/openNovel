## Context

当前批注系统的状态机定义在 `packages/plugin/src/novel-writer/annotation.ts`，数据库 schema 和操作在 `packages/novel-store/src/index.ts`，协议端点定义在 `packages/protocol/src/groups/novel.ts`，服务端 handler 在 `packages/server/src/handlers/novel.ts`，schema 类型在 `packages/schema/src/novel.ts`，前端面板在 `packages/app/src/pages/novel/annotation-panel.tsx`。

`applySuggestion()` 和 `canApplyAnnotation()` 纯函数已存在且有测试覆盖，但从未被运行时代码调用——"采纳"按钮只调 `updateChapterAnnotation` 更新状态字段。

现有会话路由基础设施：`findBoundNovelSession()` 查找该小说第一个未归档绑定会话，`createAndBindSession()` 创建会话 + 绑定书籍 + 发送 prompt。两者均在 `packages/app/src/pages/novel/workspace-data.ts` 中，可直接复用。

现有 schema 初始化使用 `CREATE_TABLES_SQL` 大字符串 + `CREATE TABLE IF NOT EXISTS`（`novel-store/src/index.ts`）。对已有数据库加列需走 `migrate.ts` 的 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` 模式。

现有会话系统（V2）支持 `SessionV2.prompt()` 发送持久化输入。前端通过 `packages/app/src/context/novel-queries.ts` 的 mutation hooks 调用 server handler。

## Goals / Non-Goals

**Goals:**
- 将"采纳"从即时改稿变为意图标记，统一由"执行"触发 AI 批量改稿
- 建立执行轮次的持久化记录，支持历史面板按轮次回顾
- 支持从历史面板重新激活批注并再次执行
- 复用现有会话路由（`findBoundNovelSession` / `createAndBindSession`）

**Non-Goals:**
- 不改变批注的创建流程（`annotate_chapter` / `polish_paragraph` 工具保持不变）
- 不实现 diff 视图（历史面板展示变更摘要即可，可视化 diff 留给后续）
- 不修改写作流水线（pipeline）的核心改稿逻辑，只增加一个新的指令入口
- 不做多章节批量执行（一次执行仅针对当前章节的批注）
- 不在 director 中新增专用工具——执行指令通过自然语言 prompt 发送，director 已有"按批注重写"的调度能力

## Decisions

### D1: 执行触发由前端直接发 prompt，轮次 CRUD 走 HttpApi

点击"执行"后，前端将批注列表格式化为自然语言 prompt，通过 `findBoundNovelSession` + `createAndBindSession`（或复用已有会话）发送。**执行触发本身不加 HttpApi 端点**。但执行轮次的持久化记录和历史面板查询需要新增以下 HttpApi 端点：

- `POST novel.create-execution-round` — 创建轮次记录
- `GET novel.execution-rounds` — 按章节查询轮次列表
- `PUT novel.update-annotation` — 已有端点，`UpdateAnnotationInput` 增加 `executionRoundId` 可选字段用于关联批注到轮次

**理由**：执行触发是 UI 概念（选择哪个会话、发什么 prompt），服务端不应介入。轮次数据是持久化实体，需要后端存储和查询，走 HttpApi。

**替代方案**：新增 `novel.execute-annotations` 端点由 server 路由会话并发送 prompt。拒绝原因：服务端不应知道 UI 的会话路由逻辑。

### D2: 执行轮次使用新表而非批注表加字段

新增 `annotation_execution_rounds` 表记录每轮执行（id / novel_id / chapter_id / prompt_snapshot / result_summary / created_at），批注表新增 `execution_round_id` 可空外键。

**理由**：轮次和批注是一对多关系。独立表支持后续扩展（如记录 AI 改稿前后的正文版本 hash）。

**替代方案**：在批注表加 `round` 整数字段。拒绝原因：轮次的元数据没有归属地，且轮次本身可能被独立展示。

### D3: 状态机改动范围最小化

只在 `VALID_TRANSITIONS` 中增加 `applied: ["open"]`，其余转换规则不变。前端不做额外的转换校验（信任服务端和纯逻辑层的校验）。

**理由**：`resolved → open` 和 `wontfix → open` 已存在，`applied → open` 的加入是对称的。

### D4: AI 指令格式为结构化列表 + 自然语言说明

执行 prompt 由前端生成，格式为：

```
请按以下批注修改第 X 章正文：

## 需要应用替换的段落（采纳）
- 段落 3：将「原文引用」替换为「建议替换文本」

## 需要根据意见改写的段落（解决）
- 段落 5：「批注意见」

## 需要跳过的段落（不修）
- 段落 7
```

**理由**：director prompt 已有"按批注重写"场景，结构化列表让 director 能精确分发到 reviser。比 JSON 可读，比纯自然语言不易歧义。

### D5: 历史面板作为批注面板的第二个 tab

在现有批注面板内增加 tab 切换："当前"和"历史"。

**理由**：避免新增独立面板需要改动 workspace 布局。批注面板已有筛选逻辑，加 tab 是自然延伸。

### D6: 数据库加列走 migrate.ts 模式

`execution_round_id` 列的添加通过 `migrate.ts` 中的 `PRAGMA table_info(chapter_annotations)` 检查列是否存在，不存在则 `ALTER TABLE ... ADD COLUMN`。新表 `annotation_execution_rounds` 加入 `CREATE_TABLES_SQL`（使用 `CREATE TABLE IF NOT EXISTS`，对旧库自动跳过）。

**理由**：`CREATE TABLE IF NOT EXISTS` 不会给已有表加列，必须走显式迁移。

## Risks / Trade-offs

- [批注锚点 stale] 用户标记到实际执行之间正文可能已修改，锚点失效 → 执行时 AI 需要处理"引用文本找不到"的情况，在 prompt 中标注 stale 批注
- [大段替换建议] 润色建议可能整段重写，AI 直接替换后可能破坏上下文连贯 → prompt 中指示 AI 在替换后检查前后文衔接
- [执行轮次增长] 频繁执行产生大量轮次记录 → 历史面板按章节过滤（每章独立视图），不做全局历史
- [会话跳转竞态] 用户点击"执行"时最近会话可能正在运行中 → prompt 会排队（SessionV2 已支持 steer 语义），无需特殊处理
- [applied 回退语义模糊] 重新激活已采纳的批注后，AI 可能不知道是"重新润色"还是"对上次结果不满意" → MVP 不做补充意见，后续根据使用反馈决定

## Migration Plan

1. `novel-store` `CREATE_TABLES_SQL` 新增 `annotation_execution_rounds` 表（新库自动创建，旧库 `CREATE TABLE IF NOT EXISTS` 跳过）
2. `migrate.ts` 新增迁移逻辑：`PRAGMA table_info(chapter_annotations)` 检查 `execution_round_id` 列，不存在则 `ALTER TABLE ... ADD COLUMN execution_round_id text`
3. 现有批注数据无需迁移——`execution_round_id` 为 NULL 表示"未关联轮次"（手动处理或迁移前数据）
4. 前端逐步上线：先加执行按钮和历史面板 tab，再接会话跳转
5. 回滚：新表和列不影响已有功能，前端隐藏执行按钮即可回退