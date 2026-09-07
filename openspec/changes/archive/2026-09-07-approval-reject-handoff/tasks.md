## 1. 会话指令

- [x] 1.1 新增或复用可测试的“驳回后重写”prompt 构造逻辑，覆盖有意见、无意见和必要章节字段，并在 `packages/app` 通过 `bun typecheck`
- [x] 1.2 通过单元测试验证最近绑定会话优先；无绑定会话时走懒创建、绑定并发送

## 2. 驳回 UI 衔接

- [x] 2.1 在驳回确认面板增加默认关闭的“同时让 AI 按驳回意见重写”选项，且不改变仅驳回的现有行为
- [x] 2.2 确认驳回后先刷新章节/审批数据，再按选项发送 AI 指令；发送成功后跳转目标会话
- [x] 2.3 发送失败时保持章节 `rejected`，显示“驳回已保存但指令发送失败”类提示，并用单元测试或可验证逻辑覆盖

## 3. 指令消费对齐

- [x] 3.1 校对 director/pipeline 既有“驳回后重写”分支与 prompt 字段/关键词一致，必要时补充说明并通过 `packages/plugin` 测试
- [x] 3.2 验证会话忙碌时的指令不会额外阻塞审批确认，并符合 SessionV2 排队/继续语义

## 4. 质量收尾

- [x] 4.1 在 `packages/app` 和受影响的 `packages/plugin` 包目录通过 `bun typecheck` 与相关测试
- [x] 4.2 在仓库根目录通过 `bun run typecheck` 与 `bun run lint`
- [x] 4.3 通过 `openspec validate approval-reject-handoff --type change`

## Implementation Commits

- `a7497fb30` docs(openspec): 细化审批驳回 AI 接手
- `0b0170c9d` feat(app): 驳回后可选交接 AI 重写
