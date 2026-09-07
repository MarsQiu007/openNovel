## 1. 权限协议与判定

- [x] 1.1 在插件 `ToolDefinition` 中添加可选 `permission` key，并验证类型检查通过
- [x] 1.2 添加 `requiresPluginToolAsk` 纯函数，验证精确 allow 不请求、精确 ask/deny 请求、仅通配 allow 请求
- [x] 1.3 为权限判定 helper 添加单元测试并通过 `packages/opennovel` 测试

## 2. Registry 集中闸门

- [x] 2.1 在 `fromPlugin` 执行前计算 permission key 并调用 `toolCtx.ask`，验证插件实现未被拒绝调用
- [x] 2.2 为 permission request 提供 tool ID、title 与 source metadata，验证审批请求字段完整
- [x] 2.3 添加 registry 集成测试覆盖审批通过、拒绝和精确 allow 自动放行
- [x] 2.4 确认现有 legacy args / JSON schema / attachments 插件工具测试仍通过

## 3. Bundled 工具权限映射

- [x] 3.1 将高影响写作工具的 agent 权限从 allow 改为 ask，并检查每个写作 agent 配置无遗漏
- [x] 3.2 保持流水线必需工具的精确 allow，验证配置检查或单元测试覆盖关键工具
- [x] 3.3 通过 `packages/plugin` typecheck 和测试

## 4. 质量收尾

- [x] 4.1 在 `packages/opennovel` 和 `packages/plugin` 运行相关测试
- [x] 4.2 运行全仓 typecheck 和根目录 oxlint
- [x] 4.3 运行 `openspec validate plugin-tool-permission-gate`
