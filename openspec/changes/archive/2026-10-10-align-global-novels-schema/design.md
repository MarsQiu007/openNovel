# 设计：对齐全局库 novels 表结构

## Context

- 单一物理库文件被两套建表管线触碰：core 的迁移系统（schema.gen.ts 初始建表 + migration/*.ts 逐条迁移）与 novel-store 的 createDb（CREATE_TABLES_SQL + runMigrations）。
- novels 表现存四份列定义，互不一致：core schema.gen.ts（生成产物）与 core 迁移 20260721152252 均为 7 列建表 SQL；core session/sql.ts 的 drizzle NovelTable 为 7 列（core 侧对全局库 novels 的实际查询方，session_novel 绑定与同步 meta 走它，也是生成管线的输入源）；novel-store 的 drizzle NovelTable 为全量 10 列；novel-store 的 CREATE_TABLES_SQL 为 8 列（含 master_outline，靠迁移补 story_spine/content_nature）。core 侧三处定义由 script/migration.ts 从 drizzle 定义统一生成，改 drizzle 定义即可三处同步。
- 事故链：core 建旧表 → novel-store 迁移链某步在中断场景下未能补列 → drizzle insert 报缺列。已通过把列补齐前置 + 中断兜底止血（运行时自愈），本提案做结构性对齐。
- 两包依赖方向受架构规则约束（运行时 Schema ← Core/Protocol ← Server，novel-store 属数据层被 core 依赖），novel-store 无法反向 import core 的表定义，因此多份列定义客观存在，需要显式校验防漂移。

## Goals / Non-Goals

- Goals：core 建表即完整；存量全局库补列幂等；漂移可被 CI 拦截。
- Non-Goals：不合并两套建表管线（架构规则禁止 novel-store 依赖 core）；不改书库（.novel/novel.db）任何行为；不动 novel-store 既有迁移兜底。

## Decisions

### D1：改 core 的 drizzle NovelTable 定义，走 script/migration.ts 生成管线一次性产出
schema.gen.ts 与 migration.gen.ts 由 packages/core/script/migration.ts 从 drizzle 表定义生成（schema.json 为快照基准），且受 CI 测试 database-migration.test.ts 的 --check 三重复验守护（迁移已生成 / 初始建表最新 / 注册表最新，仅 Linux 跑）。正确流程：改 session/sql.ts 的 NovelTable（补 master_outline/story_spine/content_nature 三列），跑生成器得到一条增量 ALTER 迁移 + 重新生成的初始建表 + 注册表，新装与存量两条路径同时闭合。
- 备选 A：手改 schema.gen.ts——被否：--check 会判定初始建表与 drizzle 定义漂移，CI 测试即红；且手写迁移绕过快照，schema.json 与实际定义脱节。
- 备选 B：不改定义、加一条初始迁移在空库时回放——被否：apply() 对空库标记全部迁移已完成，初始迁移不会执行，备选无效。
- 实施附带修复：生成脚本在 Windows 下 file.split("/") 不切分反斜杠路径导致生成即报错，已修为跨平台切分（该 bug 此前未暴露是因 --check 测试限定 Linux 运行）。

### D2：存量库补列走 core 常规迁移管线（新增 migration/*.ts 并注册进 migration.gen.ts）
既有库走 applyOnly 逐条执行未完成的迁移。新增一条 ALTER TABLE 补列迁移，幂等（IF NOT EXISTS 风格的列检查），对所有存量全局库执行一次。
- 备选：依赖 novel-store 运行时兜底长期补列——被否：全局库可能被不加载 novel-store 的语境打开，且运行时兜底已被证明会被中断击穿（本次事故），必须在 core 侧有自己的迁移。

### D3：漂移校验用列名集合 + 默认值断言，不做 AST 级对比
按 D4 的三部分范围解析文本：schema.gen.ts 的 CREATE 列清单、新迁移的 ALTER 列清单、core session/sql.ts 的 drizzle 列清单，逐一与 novel-store 定义比对。解析用正则/字符串切片即可，不引入 SQL parser 依赖。
- 备选：drizzle-kit 生成 core 的 schema——被否：core 当前迁移是手写 TS 模板字符串（schema.gen.ts 无生成标记、手维护），引入 drizzle-kit 生成流程是更大的工程，超出本提案范围。

### D4：列定义同步的唯一事实源是 novel-store 的 drizzle NovelTable 定义，校验断言完全相等
校验以 novel-store 的 drizzle NovelTable 定义（10 列）为基准，分三部分：
1. core schema.gen.ts 的 novels CREATE 列集合与默认值 == novel-store 定义（空库建表路径）；
2. 本提案新增迁移的补列集合 == novel-store 定义中旧 CREATE 没有的列（既有库补列路径）；
3. core session/sql.ts 的 drizzle 定义列集合 ⊆ novel-store 定义（core 查询方引用不越界，防 novel-store 删列后 core 仍引用）。
三部分都是相等/子集断言，不允许 core 侧出现数据层没有的自有列。未来给 novels 加列时先改 novel-store，再同步 core 的三处定义（建表 SQL、补列迁移、session/sql.ts）。

## Risks / Trade-offs

- [新增迁移在部分极旧全局库上 ALTER 与既有列类型冲突] → 迁移内逐列检查存在性，仅补缺失列；冲突列不改类型（SQLite ALTER 也不支持），如有类型冲突交给人工处理。
- [正则解析 SQL 文本脆弱，格式变化导致校验误报] → 校验聚焦列名集合，宽容空白与反引号差异；解析失败时测试显式报错而非静默通过。
- [未来又有人在 core 侧加列未同步] → 校验测试在 CI unit 阶段运行，漂移即红（覆盖建表 SQL 与 session/sql.ts 两处）。
- [core 补列后旧版本客户端打开新库] → 列多余对旧代码透明（core 旧 drizzle 定义只查 7 列、novel-store 旧定义只查既有列），无需版本门槛。

## Migration Plan

1. 发布版本含本提案改动：新装全局库建表即完整；存量全局库在首次建连时由 core 迁移补列（幂等，无感）。
2. 回滚：迁移本身幂等可重入；若需回退版本，列多余不影响旧代码（旧代码不读新列），无需回滚列。
