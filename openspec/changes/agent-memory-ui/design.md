# Design: agent-memory-ui

> 落点依据来自 2026-10-24 只读侦察（全部 file:line 核实）：收件箱形态=设定树节点+平铺卡片+行内编辑（setting-review-inbox.tsx）；端点模板=review-inbox 组（protocol/src/groups/novel.ts:1332-1442）；memory_fact 全链路零 HTTP 面。

## Context

见 proposal.md - Why。数据层全部就绪：memory_fact 表 + 状态机（pending→reviewed→approved→stale→retired）+ retired_into 合并留痕 + buildMaintenanceReport 报告（packages/novel-store/src/memory-lifecycle.ts）。本变更只补作者侧的 HTTP 面与界面。

## Goals / Non-Goals

Goals：memory_fact 的 HTTP CRUD/流转端点组；设定树「记忆」面板（过滤/编辑/手记/维护报告/移交 AI）；手记旁路写入（created_by=author）。

Non-Goals：不改 annotation 系统；不改注入/生命周期/检索机制；不做语义级同义合并 UI；**右栏 RAIL_PANELS 随行挂点不做**（技法库双挂点因写作时高频查阅，记忆面板是低频管理面，首版只挂设定树）。

## Decisions

### D1 端点组照 review-inbox 模板，每动作一端点

`GET /api/novel/:novelID/memory-facts`（query：status/fact_type/chapter_id/q/limit/offset）、`GET .../memory-facts/counts`、`GET .../memory-maintenance`、`POST .../memory-facts`（手记）、`POST .../memory-facts/:factID/edit|approve|retire|unmerge`。不复用单端点 action 分发——review-inbox 六端点先例即仓库惯例，保持自相似。error 统一 `[NovelNotFoundError, ServiceUnavailableError]`。

### D2 业务实现直接落 server，不开 opennovel 服务层

review-inbox 把实现放 opennovel 是因为它复用 plugin 共享服务（server 不依赖 plugin）。memory-facts 只需 novel-store（直查 MemoryFactTable + withTransaction + memory-lifecycle 原语），server 已依赖 novel-store（handlers/novel.ts 先例）。开 opennovel 间接层是纯冗余。**备选否决**：opennovel 服务接口形态——无 plugin 依赖需求时不套用。

### D3 关键词过滤走 memory_fact_fts（trigram FTS5）

q 存在时 INNER JOIN fts 虚表取 fact_id 集，与其余结构化过滤 AND。不引 LIKE 模糊匹配（FTS 已在位，双检索面是冗余）。

### D4 FTS 应用级同步覆盖手记写入路径

既有惯例（Wave 1 实施记录）：写入方同步。手记创建 INSERT、编辑 text 时 DELETE+INSERT 该行 FTS；approve/retire/unmerge 不动 FTS（虚表无 status 列，检索面保持全量可查）。

### D5 unmerge 恢复到 pending

retired_into 只记合并未记原状态——恢复即回 pending 重走生命周期（重新经审计校准/作者批准），retired_into 置 NULL。不尝试还原原状态（信息已不在，编造状态比重新走流程更糟）。**边界**：普通作废（无合并留痕）的 retired 卡不提供恢复通道——retire 是作者显式动作，UI 二次确认把关；误作废经「交给 AI 处理」重新登记。

### D6 作者批准允许 pending → approved 直达

状态机链路 pending→reviewed→approved 是 observer 卡的自动路径；作者裁决是最高确认级别（confidence 来源分级：作者 > 审计 > observer），UI 批准不经 reviewed 中间态。

### D7 手记 fact_type 缺省 "note"，quote_span 恒空

fact_type 复用 StateDelta 词汇主要为 timeline，手记是新类别。quote_span 是 observer 自动定位产物，人工填写无意义；手记出处 = quote（可选）+ chapter_id（可选，章节下拉，server 校验章节归属本书，不属则 404）。

### D8 edit 端点可修正 text 与 entity_hint

entity_hint 是合并升级通道 1（事实碎片 → 正式实体条目）的关联键，作者修正错挂实体是记忆整理的高频动作；其余字段（fact_type/quote/quote_span/chapter_id）创建后不改（改出处等于换卡，作废重登更清晰）。

### D9 记忆卡操作不走 writing_mode 审批门禁

review 模式门禁拦截的是正文写作（update_chapter final）；记忆卡管理与 review-inbox 操作同级，属数据管理面，不受门禁约束。

### D10 app 注册三文件 + 数据层惯例

settings-node.ts 加 kind "memory"（serialize/parse 同步）、settings-tree.tsx「AI 设定」节加 NodeRow + badge（待办 = pending+reviewed+stale 计数）、settings-main.tsx 加渲染分支。面板组件 + 纯函数分离（*-data.ts）；hooks 进 novel-queries.ts 并注册 queryKey；操作后 invalidateQueries 联动徽标。

## Risks / Trade-offs

- [手记/编辑路径漏同步 FTS → memory_search 查不到新卡] → 单测覆盖：创建/编辑手记后 FTS 命中。
- [面板操作与审批事件并发改同一卡] → 全部写路径走 withTransaction（novel-store 事务纪律），状态流转以当前行状态为前置校验（如仅 pending/reviewed 可 approve），冲突返回错误而非覆盖。
- [q 过滤在 fts 缺失旧行时漏结果] → 建库回填 DDL 已在位；测试断言存量行可检索。

## Migration Plan

纯新增：无数据迁移、无既有行为变更。回滚 = revert 提交（端点与面板均为新增面）。

## Open Questions

（无）
