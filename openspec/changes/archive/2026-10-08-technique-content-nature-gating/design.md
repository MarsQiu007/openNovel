# Design

## Context

见 proposal.md - Why。技术现状：

- 书级配置已有 `.novel/config.json` 读写先例（技法注入开关，novel-store 提供读写函数，server 经 `technique.config`/`set-config` 端点暴露）。
- 召回入口在写作上下文组装处：plugin 的 `assembleWriterSnapshot` → `assembleSnapshot` P7 块以 `inferSceneType`（纯函数，标题+简介启发式）得出场景类型后调用 `queryTechniques({ sceneType, contextText, limit: 5 }, directory)`。`queryTechniques` 位于 **plugin** 的 `technique-store.ts`（双源合并与曝光位都在其中完成），整个技法块包在静默降级 try/catch 内。
- `queryTechniques` 双路径（置信度列表 + unverified 曝光位）按池查询后合并，闸门若要覆盖曝光位，最干净的注入点是 store 查询的参数化过滤，而非调用方事后裁剪。
- **工具层无 LLM 能力（硬约束）**：plugin 全包不引入 LLM SDK；既有 LLM 使用全部是调用方注入的 `llm: (prompt) => Promise<string>`（如技法提取由 opennovel 宿主 CLI 用 `generateText` 注入后传入 plugin）；`ToolContext` 仅含 sessionID/messageID/agent/directory/worktree/abort/metadata/ask，无 LLM 客户端；`novel-writer.ts` 明示架构原则"工具本身不调用 LLM"。因此任何"在召回路径内发起一次 LLM 判定"的方案都不可行。
- **存量 schema 迁移已覆盖（排除项，经实测）**：`migrateTechniqueScope`（novel-store `migrate.ts`）已挂入 `runMigrations`，双驱动（driver.bun/driver.node）的 `createDb` 对书库与全局库统一执行建连迁移；实测 `C:\Novels\Novels` 旧库（15 列无 scope）副本经 `getDb` 打开后自动补齐 `scope` 列且数据保留。旧库未补列仅因该书自迁移上线后未被打开过（迁移为建连时懒执行），本变更不含迁移工作。
- plugin 已依赖 novel-store（session-store 一行 re-export），可直接调用 config 读写与库查询函数，无需新增依赖方向。

## Goals / Non-Goals

Goals:

- 双闸门（书级+章节级）在召回 store 层单点生效，置信度路径与曝光位路径都被覆盖。
- 纯通用书（书库无 adult 技法）召回行为与现状逐字节一致，零额外调用。
- 书级性质全自动且确定性（被动信号），无任何人工标记入口（用户明确要求：不在 UI 手动标志成人向书籍，零干预）。
- 工具层零 LLM 调用、不扩展 ToolContext；章节判断融入调用方 agent 的既有回合。

Non-Goals:

- 章节级判断结果不持久化，不新增 shadow log 列。
- 全局通用库召回语义不动；写入侧 scope→library 路由不动。
- server 侧不做 LLM 判定（server 只读配置+查库计算 effective nature）。
- 不做跨库数据迁移（adult 技法留在原书库，闸门只影响可见性）。
- 不做书库/全局库 schema 迁移（既有 `migrateTechniqueScope` 已覆盖书库与全局库两路）。

## Decisions

### D1 书级性质无配置键，唯一来源=被动信号

书级内容性质不引入任何配置键或人工覆盖：唯一判定依据是被动信号（书库 techniques 表存在 `scope=adult` 行→adult，否则→general）。书表不加列、config 不加键，零人工干预。

- 依据：书级性质仅用于闸门放行，无 adult 技法的书判 general 对闸门毫无影响（没有 adult 候选可挡）；出现 adult 技法（学习、手工创建、改标）被动信号立即翻转，语义始终正确，无需人工兜底。
- 弃案：`.novel/config.json` 覆盖键 + 面板切换控件——用户明确不希望以 UI 手动标志成人向书籍，逃生通道整体删除（实现后按用户反馈移除）。

### D2 书级性质 = 被动信号，plugin 单点计算，协议不回传

书级性质为纯确定性查询：书库 techniques 表存在 `scope=adult` 行→adult，否则→general，仅 plugin 召回侧经 novel-store helper 计算；server 的 `technique.config` 端点维持 enabled-only 契约，不回传性质（无 UI 消费方）。

- 依据：无 adult 技法的书判 general 对闸门毫无影响（没有 adult 候选可挡）；一旦该书出现 adult 技法（学习、手工创建、改标），被动信号立即翻转，语义始终正确。
- 备选：LLM 元数据判定并缓存——工具层无 LLM 能力（见 Context），且对闸门而言无增量价值，弃；备选：server 计算 effective nature 并经协议回传——随人工覆盖删除而失去消费方，弃。

### D3 章节级判断 = 调用方 agent 经工具参数给出，未传从紧

`assemble_context_snapshot` 新增可选参数 `content_nature`（`adult`|`general`）。调用方（pipeline/writer/outliner，均已在工具权限白名单中）依据书籍上下文（简介、章纲、前文章节、本章意图）在既有回合内判断本章走向并传参。组装处解析该参数：缺失/非法→general（从紧）；仅书级 adult 且书库存在 adult 技法时该参数才参与闸门。

- 备选：组装处内嵌一次轻量 LLM 调用——工具层无 LLM 客户端，架构明示"工具本身不调用 LLM"，弃。
- 备选：导演/章纲规划产出性质字段——要改规划 schema 且规划时点对召回不总是可见，侵入大，弃。
- 备选：纯启发式（关键字匹配）——成人章节标题常无关（"夜谈""修炼"），误放行/误杀都高，弃。
- 收益：零额外 LLM 调用（判断融入调用方既有回合）；旧调用方/旧提示词不传参时按从紧退化（安全方向）。

### D4 闸门在 queryTechniques 内参数化过滤

`queryTechniques` 新增可选闸门入参（书级=adult 且章节=adult 时才放行书库中 `scope=adult` 条目），过滤同时作用于置信度路径与曝光位路径的本书池结果；全局池不受此参数影响。

- 备选：调用方拿到结果后裁剪——曝光位已被占用、总数失衡，还要回写 shadow log 纠错，弃。

### D5 文案澄清用表单内联说明

编辑表单 `scope=成人内容` 选项旁内联一句真实语义说明（含书级自动判定方式：书库含成人技法即判为成人书）；不设书级性质展示/覆盖控件。

- 备选：tooltip/问号图标——移动端与可发现性差，弃。

## Risks / Trade-offs

- [调用 agent 漏传/误传 content_nature] → 缺省从紧（adult 候选不出现）；prompt 指引 + 书级被动信号兜底；必要时改标/删除 adult 技法即切断来源。
- [agent 把非成人章节误判为成人] → 仅影响候选可见性，技法系统本身仍是 shadow/注入两级 advisory，auditor 反馈闭环兜底。

## Migration Plan

1. 部署后无即时数据动作：无新配置键、无 schema 变更。
2. XianXia 这类"书库有 adult 技法"的书：下一次召回即被判为 adult 书（被动信号），adult 技法仅在调用方判断为成人的章节出现——行为变化正是本变更目标。
3. 回滚：revert 实现提交；无遗留数据（未引入新键、新列）。
4. 协议无净变更：technique.config/set-config 回归 enabled-only 契约（与本变更前一致）；工具新参数可选，旧调用方不传即从紧。
