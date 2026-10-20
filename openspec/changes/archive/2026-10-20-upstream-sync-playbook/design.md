# Design: upstream-sync-playbook

## 方案概述

在 baseline change 建立的 `docs/agents/upstream-sync.md` 上扩充"移植流程"一节。设计要点：流程必须**轻量可执行**（每次移植的仪式成本不超过移植本身），且**决策树三出口**中"放弃"必须是一等公民——大多数上游提交的正确决策就是不动。

## 流程设计

### 决策树（文档中的核心图）

```
fork 出现 bug / 需求
  → 检索上游 dev 是否已有修复（git -C D:\AI\Codes\opencode log --all --grep=<关键词> / 按路径）
    → 无修复 → 走 fork 自己的修复流程（与本 playbook 无关）
    → 有修复 → 评估结构差异
        → 改动落在 fork 未触碰的文件 → 直接移植（一个 change + Ported-from）
        → 改动落在 fork 已演化的文件 → 适配后移植（change 的 design.md 必须写适配点）
        → 改动触碰 fork 自有设计（location / system-context / V2 session）→ 拒绝，开讨论提案
```

- 三出口判定依据是本探索已量化的事实：core/src 共同文件 0 个内容相同，"改动落在 fork 未触碰的文件"是少数情况，决策树把它放在乐观位但让评估步骤必然先行。

### 追溯约定：`Ported-from:` 放 body 不放 footer

- husky commit-msg 钩子强制 footer 只能有一个 `OpenSpec-Change`，因此上游来源 SHA 写在**提交信息 body**（`Ported-from: <40 位 SHA>`），不占用 footer。
- 选 40 位完整 SHA 而非短 SHA：上游 dev 高频推进，短 SHA 碰撞与歧义概率随时间上升；完整 SHA 可直接 `git -C <mirror> show` 复现。

### 一个 change = 一个上游来源

- 混合来源会导致回滚与审阅粒度错乱；若一个上游修复拆成多个提交，视作"同一主题的一组提交"，在 change 的 proposal 中列全 SHA 清单。
- 反向约束：fork 侧为移植做的适配改动也计入该 change（`OpenSpec-Change: <id>`），不另开，保证 change 自含完整因果。

### 季度审阅的输出形态

- 审阅结果写进 `docs/agents/upstream-sync.md` 的"移植候选"小节（表格：上游 SHA / 主题 / 结构差异判定 / 建议），每次审阅**替换**而非追加旧表，避免候选列表无限膨胀。
- 明确"只列不搬"：候选变更为实现仍需走独立 change 与提案流程，防止季度审阅变成批量移植通道。

## 与既有工作流的兼容性

- 复用 OpenSpec 全流程（proposal → design → tasks → validate → archive），不引入新工件类型；移植 change 的 specs 同样按行为有无决定 `skip_specs`。
- CI 约定沿用 `docs/agents/ci-triage.md`：纯文档推送无 run 属预期，移植 change 涉及代码时以 CI 全绿为完成标准。
- 每完成一组任务立即勾选 tasks.md、任务动词开头等操作细则已在 `openspec/config.yaml` 的 operations.apply.guidance 中，playbook 不重复。

## 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 流程太重，小修复绕过 playbook | 决策树允许"直接移植"走最短路径（1 个 change + 1 行 Ported-from），仪式成本下限压到最低 |
| 拒绝条件清单会随 fork 演进过期 | 清单引用 baseline 文档的"fork 自有设计"事实节而非在 playbook 中重复枚举；两文档职责分离 |
| 季度审阅被遗忘 | 任务落在 change 的 tasks.md 属一次性；长期触发依赖人工，文档中标注"无自动化提醒"作为已知限制 |

## 验证方式

- 决策树覆盖三出口且每个出口有明确后续动作
- 与 baseline change 的文档职责无重叠（事实归 baseline、流程归 playbook）
- 从仓库根运行 `openspec validate upstream-sync-playbook --strict` 通过
