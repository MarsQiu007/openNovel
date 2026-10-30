# Tasks

## 1. 顺序门禁核心实现

- [ ] 1.1 在 `packages/plugin/src/novel-writer/tools/chapter-guards.ts` 新增顺序门禁（沿用篇幅门禁的 async 查询 + 纯同步判定拆分形态）：`getFirstUnpassedChapter(db, novelId, order)` 查询 `order < 目标章 order` 且 `status NOT IN ('final','published')` 的最小 order 行（含 title、status）；`checkChapterSequentialGate(toolName, firstUnpassed)` 纯同步组装拒绝对象（`metadata.reason = "sequential_blocked"`，消息含第一个未通过章的序号、标题、状态与处理指引）。验证：`bun typecheck` 通过。
- [ ] 1.2 新建 `packages/plugin/test/novel-writer/chapter-sequential-gate.test.ts`（仿 `chapter-length-limit.test.ts` 的临时目录 SQLite + `createWritingTools` 全工具装配模式，走真实工具调用不打 mock）：测试项目在 `<projectDir>/.novel/config.json` 写入 `{"writing_mode":"review"}` 与 `{"writing_mode":"auto"}` 两态（`readNovelConfig` 读该路径，缺省 auto），覆盖前置 `draft` / `pending_review` / `rejected` / `outline` / `drafting` 各态拦截、前置全 `final`/`published` 放行（含重写 `rejected` 目标章自身）、多章未通过时报最小 order 章、auto 模式前置未通过不拦、拒绝消息含序号标题状态。验证：从 `packages/plugin` 目录 `bun test test/novel-writer/chapter-sequential-gate.test.ts` 通过。

## 2. 工具接线与提示层

- [ ] 2.1 在 `packages/plugin/src/novel-writer/tools/chapter.ts` 的 `write_chapter` 与 `revise_chapter` 门禁链接入顺序校验：章存在性/参数校验之后、待处理任务门禁之前调用 `getFirstUnpassedChapter` + `checkChapterSequentialGate`，模式用 `readNovelConfig` 读取（同 `update_chapter` 先例，不看 override_mode）。验证：`bun typecheck` 通过，且 1.2 工具级测试覆盖 review 拦截与 auto 放行两条接线。
- [ ] 2.2 补提示层渲染（沿用 chapter-length-limit 三层先例）：writer 系统提示词补「逐章串行」约束段；写作快照渲染（context-render）补 review 模式约束说明；pipeline dispatch 指示注明前置未通过时后续章写入会被工具拒绝，且 `sequential_blocked` 拒绝不进入 3 次重试循环、原样上报处理前置章节。验证：`bun typecheck` 通过。
- [ ] 2.3 补静态校验测试（沿用 `agent-dispatch-routing.test.ts` 先例）：断言 writer 提示词含逐章串行约束段关键词，且 `write_chapter` / `revise_chapter` 均调用顺序门禁查询函数。验证：从 `packages/plugin` 目录 `bun test test/novel-writer/agent-dispatch-routing.test.ts` 通过。

## 3. 整体验证

- [ ] 3.1 从 `packages/plugin` 目录运行 `bun typecheck` 与相关单测全部通过；从仓库根对改动文件运行 `bunx oxlint` 无新增告警；复核 `chapter-sequential-gate` 新 spec 四个 requirement 的全部 scenario 与 `multi-chapter-batch` MODIFIED requirement 的「违约写入尝试被工具拦截」scenario 均有对应实现行为或测试断言。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate chapter-sequential-gate --strict` 通过后按仓库归档流程执行。
