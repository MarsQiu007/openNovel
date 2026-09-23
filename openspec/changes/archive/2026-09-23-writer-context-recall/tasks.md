## 1. Writer 权限与提示词

- [x] 1.1 在 `packages/plugin/src/novel-writer.ts` writer agent 权限列表中添加 `assemble_context_snapshot: "allow"`；验证：writer 权限对象包含该键
- [x] 1.2 在 `packages/plugin/src/novel-writer/agents/writer.ts` 工作流程第 1 步前插入"调用 assemble_context_snapshot 获取本章完整上下文"步骤，后续步骤编号顺延；验证：提示词输出包含该步骤
- [x] 1.3 在工作流程末尾添加"需要前文细节时主动调用 recall_history 深挖"指引；验证：提示词包含该指引

## 2. 会话级注入升级

- [x] 2.1 将 `packages/plugin/src/novel-writer.ts` 中 `injectSystemContext` 的 `assembleSnapshot` 调用替换为 `assembleWriterSnapshot`（从 `./novel-writer/recall.js` import）；验证：typecheck 通过
- [x] 2.2 确认 `injectSystemContext` 的快照渲染逻辑兼容 `assembleWriterSnapshot` 的返回结构（`recalledHistory` 渲染、受保护关系渲染）；验证：有召回命中时输出包含"召回历史"段

## 3. 测试与验证

- [x] 3.1 编写测试覆盖：writer 权限包含 `assemble_context_snapshot`；验证：测试通过
- [x] 3.2 编写测试覆盖：writer 提示词包含 `assemble_context_snapshot` 调用步骤和 `recall_history` 深挖指引；验证：测试通过
- [x] 3.3 编写测试覆盖：`injectSystemContext` 使用 `assembleWriterSnapshot` 后有召回结果时输出包含召回历史渲染；验证：测试通过
- [x] 3.4 在 packages/plugin 目录运行 `bun typecheck` 和全量测试；验证：typecheck 退出码 0，测试全部通过

## Implementation Commits

- 9c2bb45dc feat(plugin): 连接 writer 到三路召回上下文
