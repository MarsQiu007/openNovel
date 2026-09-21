## 1. 查询层与状态判定

- [ ] 1.1 为 `useBoundNovelSessions` 配置查询级重试（retry: 2 与指数退避 retryDelay），其余查询保持默认；验证：从 packages/app 运行 `bun test`，确认相关单测通过
- [ ] 1.2 扩展 `sessionSwitcherTrigger` 纯函数：输入增加列表状态（pending/error/ready，缺省 ready），输出增加 `showRetry`，仅确认空列表才返回禁用；验证：扩展 session-switcher.test.ts 覆盖三态与"仅确认空才禁用"用例，从 packages/app 运行 `bun test` 通过

## 2. 切换器渲染

- [ ] 2.1 `session-switcher.tsx` 按新 trigger 输出渲染三态：pending 显示加载占位、error 显示失败占位与"重试"按钮（调用 `refetch()`）、ready 保持现状；"+"号新建入口三态均可用；验证：从 packages/app 运行 `bun test` 通过
- [ ] 2.2 失败/加载文案沿用书内面板内联中文先例，不新增 i18n key；验证：`git diff --stat` 确认 packages/app/src/i18n 无改动

## 3. 自动回跳与回归

- [ ] 3.1 验证自动回跳 effect 在查询失败→重试成功后正确回跳、失败期间不落入懒创建空态（effect 不引入 error 分支）；验证：从 packages/app 运行 `bun test`，必要时补充回跳相关单测
- [ ] 3.2 确认既有失效路径不受影响（发送消息后的 bound-sessions 失效、useBindSession onSuccess 失效）；验证：packages/app `bun typecheck` 与根目录 oxlint 通过

## 4. 收尾

- [ ] 4.1 运行 `openspec validate session-switcher-recovery` 并提交实现（提交信息带 OpenSpec-Change trailer）
