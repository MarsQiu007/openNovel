# Tasks

## 1. 数据层（novel-store）

- [x] 1.1 在 `packages/novel-store` 新增 `chapter_cleanup_proposals` 表（novel_id/chapter_id 索引、kind、anchor 三字段、quote、replacement、reason、confidence、status、fail_reason、applied_from_version_id、applied_to_version_id、source_run_id、created_at/updated_at）并接入幂等迁移
- [x] 1.2 实现提案写入助手（批量落库 pending，校验 kind/replacement/锚点字段合法性）与查询（按书+状态/章节过滤、计数）
- [x] 1.3 实现事务化应用助手：单事务「应用前快照 → quote 校验 → 倒序机械替换 → 正文/字数更新 → 追加应用后版本行 → 提案标记」，quote 不匹配的提案标 failed 不阻断其余
- [x] 1.4 实现撤销助手：事务内恢复 `applied_from_version_id` 快照内容、追加 revert 版本行、提案标 reverted
- [x] 1.5 新增测试：落库校验拒绝、应用成功路径（快照/正文/版本/状态断言）、锚点漂移失败路径、倒序多提案无偏移漂移、批量原子回滚、撤销恢复快照

## 2. 契约与服务端（schema / protocol / server / client）

- [x] 2.1 在 `packages/schema` 定义修订提案 schema（kind 枚举、锚点、状态、置信度范围）
- [x] 2.2 在 `packages/protocol` novel 组新增六个端点（列表/计数/接受/批量接受/拒绝/撤销）
- [x] 2.3 在 `packages/server` 实现 handler：列表与计数直查；接受/批量接受/撤销走 novel-store 助手；批量接受服务端过滤低风险并返回 accepted/failed/skipped 明细
- [x] 2.4 在 `packages/client` 运行 `bun run generate` 再生成 SDK，同步 codemode OpenAPI fixture
- [x] 2.5 在 `packages/opennovel/test/server/httpapi-exercise` 注册全部新端点场景（coverage 门不得 missing）
- [x] 2.6 新增/更新 server 测试：端点契约、批量低风险过滤（低置信度与删除类被 skipped）、failed 明细

## 3. 产出端（plugin）

- [x] 3.1 新增 `propose_cleanup` 写作工具：批量落库纠错修订提案，校验拒绝路径返回明确错误
- [x] 3.2 更新 director 导入整理指令：纠错阶段产出改为逐条 `propose_cleanup` 落库，进度笔记记录落库条数；汇总汇报单元改为读提案计数输出已应用/待审/拒绝数量
- [x] 3.3 新增/更新测试：工具落库与校验拒绝、director 指令含新产出要求

## 4. 界面（app）

- [x] 4.1 新增清理修订审阅面板：待审列表（章、类型、原文/建议对照、理由、置信度、低风险标识）、逐条接受/拒绝、低风险多选批量接受、已应用项撤销（撤销覆盖人工编辑的简体中文警示文案）
- [x] 4.2 挂载设定树 organization 节点并接入待审计数徽标；操作后 invalidate 相关查询
- [x] 4.3 全部用户可见文案进既有 locale 体系（zh/en/zht），不新增硬编码英文文案
- [x] 4.4 新增面板纯函数逻辑单测（过滤/分组/低风险判定展示）

## 5. 验证与收尾

- [ ] 5.1 检查未引入同类、冗余、无用代码；受影响包 `bun typecheck` 与 oxlint 通过、`bun test` 聚焦通过；`packages/opennovel` 运行 `bun run test:httpapi`（coverage 模式）
- [x] 5.2 冒烟验证（隔离环境自证）：证据链由三层自动化覆盖——(a) novel-store `test/cleanup-proposals.test.ts`（建书造错字正文→落库→应用后正文机械变更且快照/应用后版本行齐备、锚点漂移标 failed、批量异常整体回滚、撤销恢复应用前正文）；(b) httpapi-exercise 六场景（真实 server：列表/计数与种子一致、单条接受 accepted=1、批量仅应用两条低风险且删除类 skipped 含低风险理由、拒绝、撤销 ok）；(c) plugin `test/novel-writer/cleanup-tools.test.ts`（工具落库 pending 且正文不变、校验拒绝、list_cleanup 计数输出）
- [ ] 5.3 全量回归（turbo typecheck 全量 + 受影响包全量测试）后按 Workflow follow-up 收尾：记录 Implementation Commits → `openspec validate --strict` → 同步主 specs → 归档

## Workflow follow-up

- 契约变更已在任务 2.4 覆盖（generate + codemode fixture）
- 全部任务完成后按仓库 OpenSpec Completion 流程收尾并关闭 Issue #34
