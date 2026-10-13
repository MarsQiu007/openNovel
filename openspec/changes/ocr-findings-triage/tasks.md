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
- [ ] 2.6 修复 packages/plugin 批次，验证：`packages/plugin` 下 `bun typecheck` 通过、相关测试通过、oxlint touched 路径 0 错误
- [ ] 2.7 修复 packages/opennovel 批次，验证：`packages/opennovel` 下 `bun typecheck` 通过、相关测试通过（httpapi 长套件超时 ≥90s）、oxlint touched 路径 0 错误

## 3. 收尾

- [ ] 3.1 汇总各批修复数、wontfix 数、defer 数，写入 tasks.md 末尾汇总表并核对与 triage.md 一致，验证：三方数字对账无差异
- [ ] 3.2 全量验证：所有 touched 包重跑 `bun typecheck` 与包级测试全绿，验证：无失败项残留

## Workflow follow-up

- 按 AGENTS.md 流程收集实现提交（`git log --grep "OpenSpec-Change: ocr-findings-triage"`）写入 Implementation Commits。
- 用户确认后 `$openspec-complete-change` 归档、合并 main、删除功能分支。



