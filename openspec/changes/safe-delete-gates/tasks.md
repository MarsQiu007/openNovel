## 1. Director 权限表调整

- [x] 1.1 将 director 权限表中的 `restore_chapter_version` 从 `ask` 改为 `allow`，同步更新 agent-permissions.test.ts（从 ask 断言列表移除，改为断言 allow）；验证：在 packages/plugin 运行 `bun test test/novel-writer/agent-permissions.test.ts` 通过

## 2. 受影响弧光筛选函数提取

- [x] 2.1 从 arc-backfill.ts 的 backfillStoryArcs 中提取"按 mode 与 replace_match 从既有弧光中筛出将被删除的集合"的纯函数并导出，backfillStoryArcs 内部改用该函数，保持行为不变；验证：packages/plugin 既有测试（e2e、structure 等覆盖 backfill 路径）全部通过

## 3. 弧光重建模式门

- [x] 3.1 在 backfill_story_arcs 的 execute 中实现模式门：mode 为 replace_all 或 replace_matching 时，先用 2.1 的函数计数受影响弧光，再 `await ctx.ask` 发起 `permission: "arc_rebuild"` 请求（patterns 与 always 均为 `[mode]`，metadata 含 toolId、mode、arcs_to_delete、replace_match），计数与 ask 置于现有 try/catch 之前；create_only 不触发任何 ask；验证：工具体在 replace 模式下未获批准前不调用 backfillStoryArcs 的删除路径
- [x] 3.2 新增 arc-rebuild-gate.test.ts：create_only 静默执行且不调用 ask；replace_all 与 replace_matching 删除前触发 ask 且请求形状正确（权限键、patterns、metadata 中的弧光数）；ask 拒绝时工具调用失败且既有弧光未被删除；验证：在 packages/plugin 运行 `bun test test/novel-writer/arc-rebuild-gate.test.ts` 通过

## 4. 收尾验证

- [x] 4.1 在 packages/plugin 目录运行 `bun typecheck` 与 `oxlint` 全部通过，并运行该包全量测试确认无回归；确认无需 SDK 再生成（无契约变更）

## Implementation Commits

（待实现提交后回填）

