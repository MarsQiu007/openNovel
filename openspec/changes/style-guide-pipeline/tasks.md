# Tasks

## 1. director prompt 风格路由段

- [x] 1.1 在 `packages/plugin/src/novel-writer/agents/director.ts` prompt 的「新设定分流」段后新增「写作风格路由」段：路由归属（风格由 director 直改落库，不调度 @architect，显式覆盖调度表「卷纲等」的含糊措辞）、触发词（生成/优化/更新写作风格、文风、叙事规范）、前置读取（先调 `check_novel_settings(novel_id, scope="all")` 拉题材/梗概/既有设定再推导）、落库交付判据（tone/pov/tense/rules 经 `save_novel_settings(style_guide)` 落库，未落库视为未完成，落库后按设定影响面硬规则汇报影响任务）、规范文件路径约定（叙述性写作规范写 `.novel/instructions/book.md`；约定体系之外的说明性文件告知用户不会被协写作消费）。验证：`bun typecheck` 通过且 prompt 文本包含五要素关键词。
- [x] 1.2 修正同文件「项目级配置」段的权限描述：把 read/edit/write「这些工具对你 deny」的失实括号改为「不要用它们读写项目配置文件」，与风格路由段的 write 使用不再矛盾。验证：`bun typecheck` 通过，grep 确认原失实表述已移除。

## 2. 静态校验测试

- [x] 2.1 在 `packages/plugin/test/novel-writer/agent-dispatch-routing.test.ts` 追加风格路由 test：断言 director prompt 含触发词、`check_novel_settings` 前置、`save_novel_settings(style_guide)` 落库判据、`.novel/instructions/book.md` 路径约定；断言 `directorAgent.permission.save_novel_settings === "allow"`、`ideatorAgent.permission.save_novel_settings === "deny"`。验证：`bun test agent-dispatch-routing` 从 packages/plugin 目录运行通过；临时改坏 prompt 或权限表时对应断言失败（手动验证一次后还原）。

## 3. 整体验证

- [x] 3.1 从 `packages/plugin` 目录运行 `bun typecheck`、oxlint 与 `bun test test/novel-writer/agent-dispatch-routing.test.ts`，全部通过且无新增告警。

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate style-guide-pipeline --strict` 通过后按仓库归档流程执行。
- 落地运行观察：模型是否仍把风格写到随机路径，决定是否立项「规范文件写入工具化 + write 收敛」独立 change（design Open Questions）。
