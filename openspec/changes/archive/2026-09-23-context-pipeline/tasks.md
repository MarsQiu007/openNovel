## 1. 工具参数扩展

- [x] 1.1 在 `packages/plugin/src/novel-writer/recall.ts` 的 `assembleWriterSnapshot` 函数签名中新增 `focus?: string` 可选参数；验证：typecheck 通过
- [x] 1.2 当 `focus` 传入时，将召回查询文本从章纲替换为 focus 值；验证：typecheck 通过
- [x] 1.3 在 `packages/plugin/src/novel-writer.ts` 的 `assemble_context_snapshot` 工具 args 中新增 `focus` 可选参数并传递给 `assembleWriterSnapshot`；验证：typecheck 通过

## 2. Writer 提示词三阶段策略

- [x] 2.1 在 `packages/plugin/src/novel-writer/agents/writer.ts` 工作流程步骤 0 中拆分为三阶段：0a 获取基线快照 → 0b 检查信息缺口 → 0c 聚焦深挖（传入 focus 或调用 recall_history）；验证：提示词包含三阶段描述
- [x] 2.2 明确"信息充分时跳过 0b/0c"的条件；验证：提示词包含该说明

## 3. 测试与验证

- [x] 3.1 编写测试：writer 提示词包含三阶段策略关键词（基线/缺口/深挖）；验证：测试通过
- [x] 3.2 编写测试：`assemble_context_snapshot` 工具接受 focus 参数；验证：typecheck 通过
- [x] 3.3 在 packages/plugin 目录运行 typecheck 和全量测试；验证：全部通过

## Implementation Commits

- b72924db1 feat(plugin): 实现多阶段上下文获取管线
