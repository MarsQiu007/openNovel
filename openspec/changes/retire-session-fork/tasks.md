# Tasks

## 1. app：退役 fork 命令与对话框

- [x] 1.1 删除 `packages/app/src/pages/session/use-session-commands.tsx` 中 `fork()` 函数与 `sessionCmds()` 的 `session.fork` 条目（含 `slash: "fork"`）；核对 `openDialog`、`prompt`、`extractPromptFromParts` 等引用仍被其它命令使用、无悬空 import；`cd packages/app` 下 `bun typecheck` 通过
- [x] 1.2 删除 `packages/app/src/components/dialog-fork.tsx`；审计 `rg -ni "fork" packages/app/src` 仅剩 i18n 字典键（`command.session.fork(.description)`、`dialog.fork.empty`，预期保留项）、`rg -n "dialog-fork|DialogFork" packages/app` 零残留；`cd packages/app` 下 `bun typecheck` 通过
- [x] 1.3 残留边界与改动面核对：`rg -ni "fork" packages/app/src packages/session-ui/src packages/ui/src` 结果与 design D3 保留清单一致（app i18n 键、session-ui 类型字段、ui 键与图标）；本变更改动面仅为 `use-session-commands.tsx`（修改）与 `dialog-fork.tsx`（删除）

## 2. 集成验证（会话导航回归防线）

- [x] 2.1 `cd packages/app` 下 `bun run test:unit` 与 `bun run test:browser` 通过
- [x] 2.2 在 packages/app 以 Playwright 运行会话导航相关子集并全绿：`e2e/regression/subagent-child-navigation.spec.ts`、`e2e/novel/session-book-routing.spec.ts`、`e2e/novel/session-switcher-subagent.spec.ts`
- [x] 2.3 根目录 `bun run lint` 0 错误；`openspec validate retire-session-fork --strict` 通过
- [x] 2.4 手工验收（对照清单）：命令面板与斜杠菜单不再出现「从消息分叉」；`/undo`、`/redo`、`/compact` 命令正常；消息级回滚按钮与回滚消息坞恢复可用；时间线子代理卡片仍直接进入书内会话；书内会话切换器切换/新建正常

## Workflow follow-up

- 提案工件提交 `docs(openspec): 建立 retire-session-fork 提案`；实现提交（app 单包）带 `OpenSpec-Change: retire-session-fork` trailer
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 推送 → CI generate / typecheck / test 全绿 → 归档（skip_specs 无需同步主 specs）→ ff 合并 main → 推送 → 清理本地与远端分支并 prune
- 归档收尾总结引用本变更关闭的遗留事项（dialog-fork 旧式地址）

## Implementation Commits

- `410f106c0` feat(app): 退役从消息分叉入口与对话框