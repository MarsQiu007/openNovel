## 1. 数据层

- [x] 1.1 在 `packages/novel-store/src/index.ts` 的 `NovelTable` 中添加 `story_spine: text()` 列（nullable，default null）；验证：typecheck 通过
- [x] 1.2 在 migration 逻辑中添加 ALTER TABLE ADD COLUMN story_spine TEXT；验证：旧数据库迁移后不报错

## 2. 主轴更新

- [x] 2.1 在 `packages/plugin/src/novel-writer/state-commit.ts` 的 `commitState` 函数中，delta 提交成功后检查是否有 `chapter_summary` 类型条目；验证：typecheck 通过
- [x] 2.2 从 delta 的 chapter_summary + foreshadow(planted) + plot_thread(open) 拼接主轴条目，追加到 NovelTable.story_spine；验证：新字段值包含"第N章："前缀
- [x] 2.3 当 delta 中无 chapter_summary 时不追加主轴；验证：story_spine 保持不变

## 3. 快照渲染与预算

- [x] 3.1 在 `packages/plugin/src/novel-writer/context.ts` 的 ContextPacket 类型和 assembleSnapshot 返回值中添加 `storySpine: string | null`；验证：typecheck 通过
- [x] 3.2 在 assembleSnapshot 中读取 NovelTable.story_spine 并赋值到快照；验证：有值时返回
- [x] 3.3 在 `formatSnapshotToolOutput` 中渲染"故事主轴"段落（storySpine 非空时）；验证：输出包含该段落
- [x] 3.4 在 `packages/plugin/src/novel-writer/budget.ts` 中新增主轴预算裁剪（500 token，从最早截断）；验证：超长主轴被截断

## 4. 测试与验证

- [x] 4.1 编写测试：提交含 chapter_summary 的 delta 后 story_spine 包含新条目；验证：测试通过
- [x] 4.2 编写测试：story_spine 渲染在快照输出最前部；验证：测试通过
- [x] 4.3 编写测试：空 story_spine 不渲染主轴段落；验证：测试通过
- [x] 4.4 编写测试：超长主轴被预算截断（保留最近条目）；验证：测试通过
- [x] 4.5 在 packages/plugin 和 packages/novel-store 目录运行 typecheck 和测试；验证：全部通过

## Implementation Commits

- 8f58009f7 feat(novel-store,plugin): 添加故事主轴系统
