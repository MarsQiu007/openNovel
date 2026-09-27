# 任务清单

## 实现

- [ ] 1. `packages/plugin/src/novel-writer/context.ts`：`ContextPacket` 新增 `chapterLengthLimit: boolean`；与 targetWordCount 同处解析；「目标字数」行按模式渲染
- [ ] 2. `packages/plugin/src/novel-writer.ts`：write_chapter / revise_chapter 字数校验按模式分流（启用时 floor(85%)/ceil(115%) 双向拒绝，reason 区分 too_short/too_long），成功回执按模式输出
- [ ] 3. `packages/plugin/src/novel-writer/agents/writer.ts`：规则 16 + 字数要求区双模式描述
- [ ] 4. `packages/plugin/src/novel-writer/agents/pipeline.ts`：dispatch 指示 ② 追加启用时上限拒绝说明
- [ ] 5. `packages/app/src/pages/novel/workspace-frame.tsx`：编辑弹窗新增「篇幅限制（±15%）」复选框，startEdit 回填、saveEdit 写入 rules
- [ ] 6. plugin 单元测试：开关解析（缺省/"true"/"false"）、write_chapter 双模式字数门槛（含 too_long 拒绝）

## 验证

- [ ] 7. `bun typecheck`（packages/plugin、packages/app）通过
- [ ] 8. `openspec validate chapter-length-limit` 通过

## 实现提交记录

（实现阶段完成后用 `git log --grep "OpenSpec-Change: chapter-length-limit"` 收集填入）