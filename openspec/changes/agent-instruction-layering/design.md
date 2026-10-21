# Design: agent-instruction-layering

> 草案种子的衔接核实（2026-10-21，agent-task-subagent 步骤 10）：本设计记录分层规范在写作子代理链路中的注入落点。

## 与 agent-task-subagent 落地后的衔接

- **注入落点在快照组装与 dispatch prompt，不在 agent 注册面**：起草/审校/修订子代理（writer/auditor/reviser，category 分别为 creation/review/review）的上下文由 pipeline 经 dispatch prompt 组装——outliner 快照的 P4 层级（风格指南与题材规则）就是现有规范注入位（`novel-writer/context.ts` assembleSnapshot），分层发现合并后的结果替换/充实该层即可
- **「越近优先」与快照预算的关系**：P4 已有行格式约定（styleGuideRuleLines），分层合并的超限截断沿用快照既有体量控制思路（近层优先等价于近层后注入/远层截断，实现时按组装顺序定）
- **agent 注册面零改动**：本提案不新增 agent、不动 permission map、不动 category——11 个写作 agent 的注册面（裸对象 + V1 hook/V2 入口单源）保持原样
- **与 memory-system 的通道边界**维持 proposal 原判：规范文件（作者维护）与记忆注入包（agent 沉淀，五件套）是两条独立通道；审校子代理同时吃技巧卡（记忆侧）与分层规范（本提案侧），注入时各自追加段落、不混排
