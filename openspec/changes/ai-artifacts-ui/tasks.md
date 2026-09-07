## 1. 协议与客户端

- [ ] 1.1 在小说协议中定义 AI 产出的类型化只读响应，并新增 `novel.ai-artifacts` 查询端点；用 `openspec validate ai-artifacts-ui --type change` 保持提案有效
- [ ] 1.2 在 `packages/client` 运行 `bun run generate`，确认生成结果只包含 SDK 再生成改动并通过该包 `bun typecheck`

## 2. 服务端查询

- [ ] 2.1 实现小说 AI 产出聚合查询，返回章节摘要、钩子记录/统计/警告、卷汇总和段汇总；对不存在的小说返回现有未找到错误
- [ ] 2.2 在服务端注册新端点并添加覆盖空数据、章节摘要和钩子统计的查询测试；在 `packages/opennovel` 通过 `bun typecheck` 与相关测试

## 3. 工作台面板

- [ ] 3.1 新增 AI 产出查询 hook，支持按小说加载、失败重试和查询 key 管理；通过 `packages/app` 的 `bun typecheck`
- [ ] 3.2 新增 AI 产出只读面板，分区展示章节摘要、钩子轮换、卷/段汇总，并实现加载中、失败和空状态；通过组件测试或最小渲染测试验证
- [ ] 3.3 将 AI 产出面板接入右侧检视入口，并验证不同小说和选中章节切换时数据上下文保持正确；在 `packages/app` 通过 `bun typecheck` 与相关测试

## 4. 质量收尾

- [ ] 4.1 在 `packages/opennovel` 和 `packages/app` 分别通过 `bun typecheck`、相关测试与 oxlint
- [ ] 4.2 在仓库根目录通过 `bun run typecheck` 和 `bun run lint`
- [ ] 4.3 通过 `openspec validate ai-artifacts-ui --type change`