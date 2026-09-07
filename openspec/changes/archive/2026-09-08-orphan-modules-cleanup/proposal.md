# 孤儿模块清理（orphan-modules-cleanup）

> 状态：已细化 — 优先级 P1（2026-09-08 复查后确认决策）

## Why

`packages/plugin/src/novel-writer/` 下有 8 个能力模块只保存了实现，没有被运行时或测试引用：`golden-finger.ts`、`multi-round-review.ts`、`quality-cycle.ts`、`governance.ts`、`length-enforcement.ts`、`tension-graph.ts`、`resume-chapters.ts`、`runtime-artifacts.ts`。另有 `chapter-tools.ts` 三个旧工具（`chapterPlan` / `chapterWrite` / `chapterRevise`）只被 e2e 测试使用；其 3000 字硬上限和现行 `write_chapter` / `revise_chapter` 的“下限硬校验、上限由目标和内容质量控制”规则冲突，继续保留会误导开发。

这些模块同时造成两类问题：一是被误认为已有能力，二是旧测试持续验证已废弃行为。`packages/plugin/AGENTS.md` 也在宣传其中多个文件，需要一并修正。

## What Changes

- 删除上述 8 个零引用模块。
- 删除 `chapter-tools.ts`，并让 e2e 测试改走现行 `write_chapter` 工具，不再验证旧 3000 字上限。
- 更新 `packages/plugin/AGENTS.md`，移除对已删模块的宣传，只保留真实接线文件。
- 更新相关规划文档中的“张力图模块待接线”提示，避免继续引用已删除实现。

## Decisions

- 全部删除，不在本提案内接线。现有写作规则、37 维连续性检查、状态提交、张力记录、上下文组装和版本/审批链路已覆盖这些模块的大部分意图。
- 后续若确实需要独立能力（如章节恢复 UI、多轮审查编排、运行时产物面板），应从 Git 历史恢复设计思路并新建能力提案。

## Capabilities

（纯代码清理与文档修正，不改变系统行为。`.openspec.yaml` 已设置 `skip_specs: true`。）

## Impact

- `packages/plugin/src/novel-writer`：删除 9 个无运行时引用文件。
- `packages/plugin/test/novel-writer/e2e.test.ts`：改用现行 `write_chapter` 工具。
- `packages/plugin/AGENTS.md` 与相关规划文档：同步真实模块清单。

**非目标**：不实现章节恢复、多轮审查、金手指结构化数据、张力图 UI 或运行时产物 UI；不调整现行写作字数策略。
