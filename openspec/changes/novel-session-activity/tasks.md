## 1. 判定逻辑

- [ ] 1.1 新增“绑定会话 × 运行状态”纯函数，并覆盖空列表、当前书运行、其他书运行用例；通过应用单元测试
- [ ] 1.2 改造 `useNovelActivity` 接收当前书绑定会话 ID 列表，并通过应用单元测试与类型检查

## 2. 界面接入

- [ ] 2.1 工作台活动指示传入当前书绑定会话，并通过应用类型检查
- [ ] 2.2 批注执行面板复用同一会话占用判定，并通过应用类型检查

## 3. 质量收尾

- [ ] 3.1 在 packages/app 通过相关测试、bun typecheck
- [ ] 3.2 在仓库根目录通过 bun run typecheck 和 bun run lint
- [ ] 3.3 通过 openspec validate novel-session-activity --type change
