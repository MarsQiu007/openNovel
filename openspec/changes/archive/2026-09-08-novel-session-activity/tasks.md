## 1. 判定逻辑

- [x] 1.1 新增“绑定会话 × 运行状态”纯函数，并覆盖空列表、当前书运行、其他书运行用例；通过应用单元测试
- [x] 1.2 改造 `useNovelActivity` 接收当前书绑定会话 ID 列表，并通过应用单元测试与类型检查

## 2. 界面接入

- [x] 2.1 工作台活动指示传入当前书绑定会话，并通过应用类型检查
- [x] 2.2 批注执行面板复用同一会话占用判定，并通过应用类型检查

## 3. 质量收尾

- [x] 3.1 在 packages/app 通过相关测试、bun typecheck
- [x] 3.2 在仓库根目录通过 bun run typecheck 和 bun run lint
- [x] 3.3 通过 openspec validate novel-session-activity --type change

## Implementation Commits

- `fd5ebc8aa` docs(openspec): 细化书籍会话活动规格
- `65455dc00` docs(openspec): 细化书籍会话活动设计
- `40f634f8e` docs(openspec): 细化书籍会话活动任务
- `241b02109` fix(app): 修正书籍会话活动判定
