# Tasks

## 1. 顺序门禁核心实现

- [ ] 1.1 在 `packages/plugin/src/novel-writer/tools/chapter-guards.ts` 新增 `checkChapterSequentialGate`：按 design D1 查询 `order < 目标章 order` 且 `status NOT IN ('final','published')` 的最小 order 行（含 title、status），命中返回拒绝对象（`metadata.reason = "sequential_blocked"`，消息含第一个未通过章的序号、标题、状态与处理指引），未命中返回 null。验证：`bun typecheck` 通过。
- [ ] 1.2 为 `checkChapterSequentialGate` 补单测（`packages/plugin/test/novel-writer/`，用临时 SQLite 建章数据，不打 mock）：覆盖前置 `pending_review` / `rejected` / `outline` / `drafting` 各态拦截、前置全 `final`/`published` 放行（含重写 `rejected` 目标章自身）、多章未通过时报最小 order 章、目标章自身状态不参与判定。验证：从 `packages/plugin` 目录 `bun test` 相关文件通过。

## 2. 工具接线与提示层

- [ ] 2.1 在 `packages/plugin/src/novel-writer/tools/chapter.ts` 的 `write_chapter` 与 `revise_chapter` 门禁链接入顺序校验：章存在性检查之后、内容类校验之前调用 `checkChapterSequentialGate`，模式判定复用既有 `mode.writing_mode === "review"` 读取（不看 override_mode）。验证：`bun typecheck` 通过，且 1.2 单测覆盖工具接线断言。
- [ ] 2.2 补提示层渲染（沿用 chapter-length-limit 三层先例）：writer 系统提示词补「逐章串行」约束段；写作快照渲染（context-render）补 review 模式约束说明；pipeline dispatch 指示注明前置未通过时后续章写入会被工具拒绝。验证：`bun typecheck` 通过。
- [ ] 2.3 补静态校验测试（沿用 `agent-dispatch-routing.test.ts` 先例）：断言 writer 提示词含逐章串行约束段关键词，且 `write_chapter` / `revise_chapter` 均调用 `checkChapterSequentialGate`。验证：从 `packages/plugin` 目录 `bun test` 相关文件通过。

## 3. 整体验证

- [ ] 3.1 从 `packages/plugin` 目录运行 `bun typecheck` 与相关单测全部通过；从仓库根对改动文件运行 `bunx oxlint` 无新增告警；复核 `chapter-sequential-gate` 新 spec 四个 requirement 的全部 scenario 与 `multi-chapter-batch` MODIFIED requirement 的「违约写入尝试被工具拦截」scenario 均有对应实现行为或测试断言。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate chapter-sequential-gate --strict` 通过后按仓库归档流程执行。
