# 任务：双源召回合并语义修复

依据：proposal.md、design.md（D1–D4、风险 R1–R3）。

## 1. 合并语义修复与单测

- [x] 1.1 实现 design D1 合并流程（曝光位先行、置信度列表剔除 fresh 命中、head+fresh 拼装），保持单池查询与场景匹配管道不变（验证：读 diff 确认改动仅限合并段）
- [x] 1.2 实现 D2 排序（confidence desc、createdAt desc、id 兜底）（验证：typecheck）
- [x] 1.3 新增饱和池用例：本书池 ≥ limit + 全局 unverified 新品 → 候选含 ≥1 条全局（走曝光位）；全局 verified 高置信 → 进置信度前列；全局池为空 → 结果与单源逐条一致（验证：technique-store.test.ts 全绿）

## 2. 验证矩阵

- [x] 2.1 packages/plugin 技法测试全量通过（technique-*.test.ts 全系列）（验证：0 fail）
- [x] 2.2 受影响包 typecheck + 仓库根 oxlint（验证：0 errors）
- [x] 2.3 《金牌》真实库冒烟复跑（复制临时目录）：dialogue limit=5 候选含全局条目、limit=15 全局 ≥2 条；7 个场景类型候选不再完全同列（验证：输出记录于本文件）

  实测记录（2026-10-06，《金牌》真实库复制到临时目录只读冒烟）：修复前 limit=5 时 7 个场景全局候选均为 0；修复后 limit=5 每场景 3 全局 + 2 本书（曝光位生效），limit=15 时分布为本书 11 + 全局 4。注：7 个场景类型的候选列表仍完全相同——系真实库 57 条技法全部为自由文本标签且置信度均为 0.5，各场景命中池天然一致，属数据均匀所致，非合并缺陷。
- [x] 2.4 technique-agent-e2e 三用例回归（OPENNOVEL_TECHNIQUE_E2E=1）（验证：3 pass / 0 fail）

## 3. 提交

- [ ] 3.1 提交推送，commit message 说明曝光位先行与跨池打破平局设计，footer 带 OpenSpec-Change: technique-dual-source-fix（验证：git push 成功）

## 4. 应急预案（仅在前置任务失败时执行）

- [ ] 4.1 若既有用例大面积失效且非"锁定旧插入顺序偏置"：回退 D1，改评估每池配额方案并记录证据（验证：失效 diff 逐条可解释）
- [ ] 4.2 若真实库冒烟仍无全局候选：直查两池 SQL 与合并中间态，定位是 fresh 选取还是排序环节，记录证据后回 1.1 修复（验证：冒烟输出含来源分布统计）
