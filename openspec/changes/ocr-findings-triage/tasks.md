# Tasks

## 1. 分诊

- [x] 1.1 导出 scan 会话 dca30d33 的 critical/high 评论并按 7 个写作管线包过滤，在 change 目录生成 triage.md（表头 + 568 行：ID、文件、级别、类别、处置、理由），验证 triage.md 数据行数与过滤结果一致（135 critical + 433 high）
- [x] 1.2 按 design D2 白名单批量驳回已知误报类（self-export 惯例、生成代码、行号 0 且无法定位），验证每条 wontfix 均引用具体代码证据
- [x] 1.3 逐条阅读剩余发现的对应代码，标注 fix / defer 并写明理由（拿不准的一律 fix；涉及公开 Protocol/HttpApi 契约变更的一律 defer——契约不变是本 change 硬约束），验证 568 条全部有非空处置、无遗漏

## 2. 修复批次（按依赖自底向上，每批验证通过再进下一批）

- [x] 2.1 修复 packages/schema 批次（分诊为 fix 的项），验证：`packages/schema` 下 `bun typecheck` 通过、仓库根 `bunx oxlint` 检查 touched 路径 0 错误
- [x] 2.2 修复 packages/core 批次，验证：`packages/core` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [x] 2.3 修复 packages/llm 批次，验证：`packages/llm` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [x] 2.4 修复 packages/novel-store 批次，验证：`packages/novel-store` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [x] 2.5 修复 packages/server 批次，验证：`packages/server` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [x] 2.6 修复 packages/plugin 批次，验证：`packages/plugin` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [x] 2.7 修复 packages/opennovel 批次，验证：`packages/opennovel` 下 `bun typecheck` 通过、相关测试通过（httpapi 长套件超时 ≥90s）、oxlint touched 路径 0 错误

## 3. 收尾

- [x] 3.1 汇总各批修复数、wontfix 数、defer 数，写入 tasks.md 末尾汇总表并核对与 triage.md 一致，验证：三方数字对账无差异
- [ ] 3.2 全量验证：所有 touched 包重跑 `bun typecheck` 与包级测试全绿，验证：无失败项残留


## 批次汇总（任务 3.1）

分诊来源：triage.md 共 568 条（critical 135 + high 433），全部带处置与非空理由。

| 包 | 分诊条目 | fix | wontfix | defer | fix 落地 |
|---|---|---|---|---|---|
| schema | 12 | 0 | 12 | 0 | 0 |
| core | 228 | 41 | 180 | 7 | 41 |
| llm | 18 | 3 | 14 | 1 | 3 |
| novel-store | 17 | 8 | 9 | 0 | 8 |
| server | 7 | 2 | 5 | 0 | 2 |
| plugin | 29 | 12 | 16 | 1 | 12 |
| opennovel | 257 | 105 | 134 | 18 | 105 |
| 合计 | 568 | 171 | 370 | 27 | 171 |

对账：三方一致——triage.md 计数、本表 fix 列、以及各批次提交记录（opennovel 明细见 opennovel-progress.md 的 105 条 ID）。

## 执行偏差

- 分诊维度统计由 37 修正为 38（C249 复核后的类别口径调整），不影响处置计数。
- H436 按 models.dev 粗粒度校验保持现状，未收紧到逐字段校验。
- 实现阶段复核改判为 wontfix（附代码证据）：H630 H639 H654 H656 H695 H746 H755 H760 H762 H763 C236 C248。
- 实现阶段复核改判为 defer：H694（空响应收尾需后续契约评估）、H730（围栏窗口只超报不漏报，精确化属性能设计）、H744（legacy 与实验分支的持久化口径差异属产品决策）、H778（提前终止会改变总行数输出契约）。
- C248 曾按分诊落地（测试夹具保留查询串），运行 test/server 出现 12 条 400 失败，据证据回退并改判误报：Effect HttpClientRequest 的 search 与 pathname 分列，setUrl(pathname) 不会抹掉查询串。
- 新增回归测试：H660/H661 两条（前一批次），以及 ws-pool 通路既有 2 条用例钉住 H694 判定。
## Workflow follow-up

- 按 AGENTS.md 流程收集实现提交（`git log --grep "OpenSpec-Change: ocr-findings-triage"`）写入 Implementation Commits。
- 用户确认后 `$openspec-complete-change` 归档、合并 main、删除功能分支。



