# Tasks

- [x] 1.0 修复升级横幅空安全崩溃
  - [x] 1.1 `upgrade-banner.tsx` 提取 `resolveTaskCount(status)` 纯函数（`status?.tasks?.length ?? 0`），`taskCount()` 改用它
  - [x] 1.2 `upgrade-banner.test.ts` 新增异常负载用例：undefined 负载、缺 tasks 字段负载按 0 处理；正常负载任务数正确
  - [x] 1.3 `bun run typecheck`（packages/app）通过
  - [x] 1.4 本地运行 e2e 验证工作台类失败用例恢复：novel-live、novel-journey、annotation-execute、map-manual、map-editor

## Implementation Commits

- 39fcfb29e fix(app): 升级横幅对异常状态负载降级隐藏
