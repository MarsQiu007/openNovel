# Tasks

## 1. 数据层与共享类型（packages/novel-store / plugin）

- [x] 1.1 novel-store 新增 `staged_changes` 表：DDL 追加进 `CREATE_TABLES_SQL`（`CREATE TABLE IF NOT EXISTS`），字段按 design D2（status 默认 pending、安全默认）；配套行类型与按 novel_id+status 查询 helper；验证：novel-store 单测——新库建表、旧库打开幂等建表、默认值正确
- [x] 1.2 审阅留痕列幂等加列 via `migrate.ts`：`world_entry_conflicts` 补 resolution_kind / resolution_note / resolved_at，`pending_settings` 补 review_note（均带安全默认，覆盖 D5 条目级备注对候选来源的存储缺口）；验证：旧库打开补列、既有读取不回归
- [x] 1.3 分级自动化白名单共享常量（packages/plugin 单一事实源）：format / category 操作判定与豁免边界（design D3）；验证：单测覆盖白名单内外判定

## 2. 共享服务层（packages/plugin）

- [x] 2.1 候选操作抽取共享服务：把 novel-writer.ts 中 `accept/reject/merge_pending_setting` 的核心逻辑抽为共享模块（novel-writer 工具与 UI 端点共用，单一事实源），工具行为不变；验证：既有 plugin 单测全绿
- [x] 2.2 冲突读取与处理服务：listConflicts（未解决 + 分页）与 resolveConflict（按正文更新 → 生成暂存草案；保留现状 → resolved + 处理留痕）；验证：单测两类处理路径与留痕字段
- [x] 2.3 暂存变更服务：createFromPlan（stage 落点，复用 validateOrganizePlan 校验通过才落，superseded 语义）/ 聚合查询 / resolve（接受 → 重校验 → executeOrganizePlan 执行并留痕；拒绝）；验证：单测覆盖状态流转与重校验失败不执行
- [x] 2.4 批处理编排：lint_settings + check_settings_consistency + 去重扫描 + analyzeEntities → 白名单自动执行（重校验 + 执行 + 留痕）+ 其余 stage 入箱 → 返回新增待审计数；验证：编排单测——白名单直执行、语义类入箱、混合计划拆分

## 3. 契约、端点与 SDK（schema / server / opennovel / protocol / client）

- [x] 3.1 packages/schema 新增收件箱契约类型：统一条目契约、计数、候选/冲突/暂存操作输入输出（src/novel.ts）
- [x] 3.2 packages/server 新增 SettingReviewInbox 服务契约（Effect Tag）与 handlers/novel.ts 薄层接线
- [x] 3.3 packages/opennovel 服务实现 + Layer 装配（server/routes/instance/httpapi/server.ts），复用 plugin 共享服务
- [x] 3.4 packages/protocol 新增端点族 `novel.review-inbox.*`（列表 / 计数 / candidate / conflict / staged 操作，路径 `/api/novel/:novelID/review-inbox…`）；从 packages/client 运行 `bun run generate` 并提交生成物；验证：packages/opennovel `bun run test:httpapi` 三模式通过

## 4. Agent 工具与提示词（packages/plugin）

- [x] 4.1 `organize_settings` 新增 `action="stage"`（走共享暂存服务）；验证：工具单测——stage 不改正式数据、校验失败不产出
- [x] 4.2 新增 `list_conflicts` / `resolve_conflict` 工具（走共享冲突服务，处理语义与收件箱一致）
- [x] 4.3 director 提示词新增「整理设定 / 处理待审」批处理路由（编排 → 汇报「新增 N 条待审」），保留会话内 analyze→dry_run→确认→apply→复查 路径约束（design D6）；验证：提示词断言单测
- [x] 4.4 「AI 一键整理」指令模板改走批处理编排路由（buildAiFixPrompt 相应更新）

## 5. UI（packages/app）

- [ ] 5.1 「整理」节点渲染收件箱视图：SettingOrganizationPanel 替换为收件箱列表 + AI 一键整理入口；设定树「整理」节点行待审徽标（计数 query + 操作后失效联动）；验证：组件单测
- [ ] 5.2 列表与证据：来源分组、条目详情（来源章节、before/after 对照、冲突说明）、分页与 source 过滤、空态
- [ ] 5.3 审阅操作接线：候选接受/拒绝/合并；冲突生成草案/忽略；暂存变更接受（重校验错误逐条展示）/拒绝/编辑后接受；条目审阅备注 + 「交给 AI 处理」；批量操作
- [ ] 5.4 i18n 三语（zh/en/zht）补齐并保持 parity；验证：parity 单测通过
- [ ] 5.5 e2e 主路径：打开整理节点见收件箱、徽标计数随处理递减、候选接受联动、暂存变更接受后留痕可见

## 6. 收尾

- [ ] 6.1 全量验证：packages/{novel-store,plugin,server,opennovel,app} 各自 typecheck + 单测（从包目录运行）；app e2e；`openspec validate setting-review-hub`
- [ ] 6.2 实现提交逐个带 `OpenSpec-Change: setting-review-hub` trailer；用 `git log --grep "OpenSpec-Change: setting-review-hub" --format="%h %s"` 收集实现提交回填 `## Implementation Commits`
