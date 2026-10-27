# Tasks

## 1. 升级 electron

- [ ] 1.1 `packages/desktop/package.json`：`electron` 从 `42.11.8` 改为 `42.11.16`
- [ ] 1.2 运行 `bun install` 更新 lockfile

## 2. 验证

- [ ] 2.1 在 `packages/desktop` 跑 `bun typecheck` 通过
- [ ] 2.2 确认 electron-updater 无 peerDependencies 限制（已确认：空对象 `{}`）

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: fix-electron-vulnerabilities" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate fix-electron-vulnerabilities`。
- 用 `npx openspec archive fix-electron-vulnerabilities --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
