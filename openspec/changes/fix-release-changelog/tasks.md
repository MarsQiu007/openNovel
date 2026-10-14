# Tasks

## 1. 过滤逻辑与单测（packages/script）

- [ ] 1.1 新增 `packages/script/src/changelog.ts` 导出 `releaseNoteType(message)`（conventional 前缀白名单：feat/fix，支持 scope 与 `!`，大小写不敏感），并在 `packages/script/package.json` 增加 `./changelog` 子路径导出；`packages/script` 目录 `bun typecheck` 通过
- [ ] 1.2 新增 `packages/script/src/changelog.test.ts`（样例取自 v0.0.9..v0.0.10 真实提交，覆盖 scope、`!`、大小写与 docs/chore/ci/test/refactor/revert/merge/非规范提交排除）；`packages/script` 目录 `bun test` 通过

## 2. 机械层接线（raw-changelog 正文与贡献者区块）

- [ ] 2.1 `script/raw-changelog.ts` 正文过滤改用 `releaseNoteType` 白名单（放在 `reverted()` 配对之后执行），归类改为按类型前缀（fix→Bugfixes）替代 `/fix/i` 子串判断；运行 `bun script/raw-changelog.ts -f v0.0.9 -t v0.0.10` 验证输出仅含 feat/fix 条目
- [ ] 2.2 `contributors()` 采用同一白名单；同命令验证贡献者区块不出现维护者与非 feat/fix 提交标题
- [ ] 2.3 `.github/TEAM_MEMBERS` 恢复登记维护者 `MarsQiu007`；同命令验证输出不含「Community Contributors Input」区块
- [ ] 2.4 `.opencode/command/changelog.md` 模型改为 `deepseek/deepseek-v4-pro` 并同步「输入已过滤为发布相关包与 feat/fix 条目」描述；`git diff` 确认仅这两处改动

## 3. AI 链路降级显式化

- [ ] 3.1 `script/changelog.ts` 降级分支追加 GitHub Actions warning 注解与 `GITHUB_STEP_SUMMARY` 说明；本地冒烟（`GITHUB_ACTIONS=true` 且 summary 指向临时文件时运行 `bun script/changelog.ts -f v0.0.9 -t v0.0.10`）确认警告输出、summary 写入、降级产物仅含 feat/fix、`UPCOMING_CHANGELOG.md` 无脚本日志污染

## 4. 集成验证

- [ ] 4.1 根目录 `bun run lint` 0 errors；`packages/script` 目录 `bun test`、`bun typecheck` 通过；人工复核 `bun script/raw-changelog.ts -f v0.0.9 -t v0.0.10` 输出（仅 feat/fix、无贡献者区块、条目格式未变）
- [ ] 4.2 `openspec validate fix-release-changelog --strict` 通过

## 5. v0.0.10 release notes 更新

- [ ] 5.1 生成 v0.0.10 新 notes 并备份原 body 后执行 `gh release edit v0.0.10 --notes-file`；`gh release view v0.0.10 --json body` 确认 notes 仅含 feat/fix 条目且资产未受影响

## Workflow follow-up

- 提交全部实现改动（每个提交带 `OpenSpec-Change: fix-release-changelog` trailer）
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- GitHub Actions（generate / typecheck / test）全绿后再合并，合并后确认主干运行全绿
- 同步主 specs → 归档 → 合并 `main` → 清理本地与远端分支
