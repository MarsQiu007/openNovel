# 孤儿模块清理设计

## Context

复查结果显示，9 个候选文件均无生产 import、动态 import 或测试引用；唯一例外是 `chapter-tools.ts` 被 e2e 测试直接调用。现行主路径已经由 `novel-writer.ts` 注册的 `write_chapter` / `revise_chapter`、`continuity-check.ts`、`state-commit.ts`、`context.ts`、`TensionLogTable` 和审批链路承载相应能力。

## Goals / Non-Goals

**Goals:**

- 删除零引用且能力已被现行路径覆盖的模块。
- 让 e2e 只验证现行写作工具和字数规则。
- 让插件文档反映真实源码结构。

**Non-Goals:**

- 不新增运行时能力或 UI。
- 不把已删模块重新设计成正式能力。
- 不调整 `write_chapter` / `revise_chapter` 的目标字数策略。

## Decisions

### D1: 删除 8 个孤儿能力模块

删除 `golden-finger`、`multi-round-review`、`quality-cycle`、`governance`、`length-enforcement`、`tension-graph`、`resume-chapters`、`runtime-artifacts`。理由：

- 无运行时引用，删除不会改变当前行为。
- 金手指、张力、字数和上下文意图已经由提示词、数据库表、现有检查和上下文组装覆盖。
- `multi-round-review` 和 `quality-cycle` 与现行单轮审计、状态提交重叠，且缺少审批/UI接线。
- 章节恢复和运行时产物是潜在功能，但先接产品流程再保留实现更合适；Git 历史可随时找回。

### D2: 删除旧 chapter-tools，e2e 改走 write_chapter

删除 `chapter-tools.ts` 后，e2e 的“写章”步骤改为初始化一条核心设定并调用现行 `write_chapter` 工具。这样测试继续覆盖数据库持久化和版本链路，同时验证当前工具的阻断、字数和状态行为，而不是旧工具的 2000-3000 硬窗口。

### D3: 以“运行时引用”作为清理边界

只删除无运行时/测试引用且不承载现行契约的文件。`AGENTS.md` 和规划文档中出现的名称仅视为文档脱节，不作为保留理由。

## Risks / Trade-offs

- [未来误删了可用设计] → 保留 Git 历史；真正需要时新建提案恢复设计。
- [e2e 从旧工具切换后暴露现行工具问题] → 这正是目标；若失败先修现行工具或测试准备数据，不恢复旧工具。
- [文档遗漏引用] → 删除后全仓 grep 复查模块名和文件名。

## Migration Plan

1. 删除 9 个文件。
2. 修改 e2e 使用 `write_chapter` 并补齐最小核心设定。
3. 更新插件 AGENTS 和相关规划文档。
4. 运行插件 typecheck/test、全仓 typecheck/lint 和 OpenSpec 校验。
5. 回滚方式是还原对应提交。
