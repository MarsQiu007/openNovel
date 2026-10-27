# Tasks

## 1. 升级 dompurify

- [ ] 1.1 `packages/ui/package.json`：`dompurify` 从 `3.4.16` 改为 `3.4.17`
- [ ] 1.2 `packages/session-ui/package.json`：`dompurify` 从 `3.4.16` 改为 `3.4.17`
- [ ] 1.3 运行 `bun install` 更新 lockfile

## 2. 验证

- [ ] 2.1 在 `packages/ui` 跑 `bun typecheck` 通过
- [ ] 2.2 在 `packages/session-ui` 跑 `bun typecheck` 通过
- [ ] 2.3 在 `packages/app` 跑 `bun typecheck` 通过（依赖 ui/session-ui）

## Workflow follow-up

- 用 `git log --grep "OpenSpec-Change: fix-dompurify-vulnerabilities" --format="%h %s"` 收集实现提交写入本文件 `## Implementation Commits`。
- 运行 `npx openspec validate fix-dompurify-vulnerabilities`。
- 用 `npx openspec archive fix-dompurify-vulnerabilities --yes` 归档。
- 合并前刷新本地 `main`，`git merge --ff-only <feature-branch>`；不推送。
- 通知用户验收。
