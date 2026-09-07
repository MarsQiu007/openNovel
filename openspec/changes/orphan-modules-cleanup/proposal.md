# 孤儿模块清理（orphan-modules-cleanup）

> 状态：草稿 — 优先级 P1（2026-09-07 探索会话产出，待深入研究后细化 specs/design/tasks）

## Why

`packages/plugin/src/novel-writer/` 下存在 **8 个零运行时引用的能力模块**（全仓 grep 无 import、无动态 import、无测试引用）：`golden-finger.ts`（金手指设计器）、`multi-round-review.ts`（多轮评审循环）、`quality-cycle.ts`、`governance.ts`、`length-enforcement.ts`、`tension-graph.ts`（张力图）、`resume-chapters.ts`（中断章节恢复）、`runtime-artifacts.ts`。另有 `chapter-tools.ts` 三个工具（chapterPlan/chapterWrite/chapterRevise）生产代码零引用、仅 e2e 测试使用，且其硬性字数上限 3000 与现行规则（下限硬、上限不限，`novel-writer.ts:483-485`）**相互矛盾**——测试在验证已废弃的行为。

`packages/plugin/AGENTS.md:36-38` 仍在宣传其中若干模块，文档与代码脱节。这些"写了没接线"的代码误导后续开发（探索中被误判为已实现能力）。

## What Changes

- 逐模块决策"接线 or 删除"：评估每个模块的产品价值（如 multi-round-review 与张力图与既有愿景相关，resume-chapters 解决真实中断问题），有价值的制定接线方案，无价值的删除。
- `chapter-tools.ts`：删除或修正 e2e 测试使其对齐现行 `write_chapter` 规则。
- `AGENTS.md`（plugin）与相关文档同步，消除宣传脱节。

## Capabilities

（纯代码清理与文档修正，不改变系统行为。）

## Impact

- `packages/plugin`：删除或接线孤儿模块。
- `packages/plugin/test`：e2e 测试修正。
- `docs` / `packages/plugin/AGENTS.md`：同步。

**非目标**：本变更不做任何新功能开发；接线方案若成立，其实施归各自能力提案（如张力图 UI 归 `ai-artifacts-ui` 评估），本变更只做"决策 + 清理 + 文档对齐"。

（此变更无 spec 级行为变化，`.openspec.yaml` 设 `skip_specs: true`。）
