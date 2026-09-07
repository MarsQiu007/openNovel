## 1. 编排规则

- [x] 1.1 扩展 director 提示：识别明确批量数量、强制逐章等待 @pipeline、以上一章推进结果更新章号、设置 10 章上限和超量确认；通过 plugin 单元测试检查关键规则
- [x] 1.2 扩展 @pipeline 提示：明确单章完成报告必须包含标题/序号、审计结果、状态提交结果和推进状态；通过 plugin 单元测试检查关键规则

## 2. 工作台入口

- [x] 2.1 在聊天空态添加“连写 5 章”建议 chip，点击发送固定中文请求；通过应用单元测试验证提示构造与交互入口

## 3. 质量收尾

- [x] 3.1 在 packages/plugin 和 packages/app 通过相关测试与 bun typecheck
- [x] 3.2 在仓库根目录通过 bun run typecheck 和 bun run lint
- [x] 3.3 通过 openspec validate multi-chapter-batch --type change

## Implementation Commits

- `b02c6e8dc` docs(openspec): 细化多章连写规格
- `f51cafac7` docs(openspec): 细化多章连写设计
- `162899fac` docs(openspec): 细化多章连写任务
- `ed5944a3a` feat(plugin): 支持多章批量写作
