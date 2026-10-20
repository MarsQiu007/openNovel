# Proposal: upstream-sync-playbook

## Why

`upstream-sync-baseline`（先行 change）固化了"上游在哪、fork 漂移多深"的事实，但**没有约定"怎么搬"**。事件驱动移植若无流程约束，会出现三类事故：把上游补丁直接整文件覆盖（冲掉 fork 自有设计）、一个提交里混入多个上游来源的改动（无法回溯）、移植后只凭感觉验证（typecheck 都不跑）。本变更把移植流程制度化，使每次移植都可通过 `Ported-from:` 追溯到上游 SHA。

## What Changes

- 扩充 `docs/agents/upstream-sync.md`（由 baseline change 创建），新增"移植流程"一节，包含：
  1. **触发条件**：fork 遇到具体 bug/需求时，先查上游 `dev` 近期提交是否有对应修复（给出基于本地镜像 `D:\AI\Codes\opencode` 的检索命令模式）
  2. **决策树**：bug → 查上游 → 有修复 → 评估结构差异 → 三出口（直接移植 / 适配后移植 / 放弃并记录原因）
  3. **移植规则**：每个移植项必须是独立 OpenSpec change；一个 change 对应一个上游来源（一个上游提交或一组同一主题提交）；实现提交 footer 带 `OpenSpec-Change: <change-id>`，并在提交信息 body 写 `Ported-from: <upstream-sha>`
  4. **验证门槛**：移植完成后必须在受影响包目录通过 `bun typecheck` 与 oxlint，涉及运行时行为时补对应包测试
  5. **拒绝条件**：上游改动触碰 fork 自有设计（location、system-context、V2 session inbox/execution 等）时默认拒绝，需先开提案讨论适配方案
  6. **季度审阅**：每季度对照基线扫一次上游 AI/provider 层修复，产出"值得移植候选列表"（只列不搬），作为 `upstream-port-*` 系列提案的输入
- 更新 `AGENTS.md` 索引行（由 baseline change 加入的那行）补充 playbook 说明，保持一行

## Capabilities

### New Capabilities

（无——流程文档，不引入系统行为）

### Modified Capabilities

（无——不改变任何现有 spec 的需求）

> 纯文档变更，设置 `skip_specs: true`。

## Impact

- **受影响的运行时包：无**。仅扩充 1 个既有文档 + 修改 `AGENTS.md` 中 1 行索引。
- **受影响面**：`docs/agents/upstream-sync.md`（扩充）、`AGENTS.md`（1 行）。
- **数据兼容性**：不涉及。
- **依赖关系**：依赖 `upstream-sync-baseline` 先归档（文档文件由其创建）；为 `upstream-port-first-batch` 与 `ai-package-alignment` 提供流程依据。

## 非目标

- 本变更**不执行**任何移植——Playwright 修复、models.dev 快照等具体移植属于 `upstream-port-first-batch`
- 本变更**不建立**自动化工具（脚本化上游 diff、CI 定时扫描都不做）——先跑通手工流程再考虑机械化
- 本变更**不修改** baseline 文档的事实内容（SHA、漂移数据归 baseline change 维护）
