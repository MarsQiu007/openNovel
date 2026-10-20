# Tasks: upstream-sync-playbook

## 文档扩充

- [ ] 1. 在 `docs/agents/upstream-sync.md` 新增"移植流程"节，按 design 写入决策树（bug → 查上游 → 评估结构差异 → 直接移植 / 适配后移植 / 拒绝）
- [ ] 2. 写入"触发条件"小节：基于本地镜像 `D:\AI\Codes\opencode` 的上游检索命令模式（按关键词 grep 与按路径 log 两种）
- [ ] 3. 写入"移植规则"小节：一个 change 对应一个上游来源、`Ported-from: <40 位 SHA>` 写提交 body、适配改动计入同一 change
- [ ] 4. 写入"验证门槛"小节：受影响包目录 `bun typecheck` + oxlint 必过，运行时行为补包测试，CI 全绿为完成标准
- [ ] 5. 写入"拒绝条件"小节：触碰 fork 自有设计（引用 baseline 文档事实节）默认拒绝，先开讨论提案
- [ ] 6. 写入"季度审阅"小节：候选表格格式定义、"只列不搬"原则、"无自动化提醒"已知限制

## 收尾

- [ ] 7. 更新 `AGENTS.md` 中指向 `docs/agents/upstream-sync.md` 的索引行，补充 playbook 说明（保持一行）
- [ ] 8. 对照 baseline change 的文档确认职责无重叠（事实 vs 流程）；从仓库根运行 `openspec validate upstream-sync-playbook --strict` 通过
- [ ] 9. 提交：`docs(openspec): 建立 upstream-sync-playbook 提案`，footer `OpenSpec-Change: upstream-sync-playbook`
