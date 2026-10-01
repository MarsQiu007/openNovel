# 任务：修复 GitHub Dependabot 6 个依赖漏洞告警

依据：proposal.md（为什么/改什么）、design.md（版本选择 D1–D4、验证矩阵、风险与回退）。

## 1. 依赖升级

- [ ] 1.1 `packages/core/package.json`：`@ai-sdk/provider-utils` `4.0.23` → `4.0.46`（design D2；验证：`Select-String -Path packages/core/package.json -Pattern '"@ai-sdk/provider-utils"'` 显示 4.0.46）
- [ ] 1.2 `packages/desktop/package.json`：`electron` `42.5.1` → 实施时策略允许的最新 42.x（design D1：目标 42.11.10；被 `minimumReleaseAge` 拦截时逐版回退，底线 42.10.0；验证：grep 显示实际落地版本 ≥ 42.10.0）
- [ ] 1.3 运行 `bun install` 刷新 `bun.lock`（若 npmmirror 对目标 electron 版本 404，按 design 风险节切换官方 registry 安装后恢复；验证：`Select-String -Path bun.lock -Pattern '"@ai-sdk/provider-utils@'` 仅含 4.0.46 一个版本条目；锁中无 electron 42.5.1 残留——以实际落地版本为准核对）

## 2. 验证矩阵（design D4）

- [ ] 2.1 `packages/core`：`bun typecheck` + 既有测试通过（provider-utils API 面覆盖；预期零行为变化，实际安装版本已是 4.0.46）
- [ ] 2.2 `packages/desktop`：`bun run typecheck`（tsgo -b）+ `bun run build`（electron-vite build）通过；进一步跑 `bun run package:win`（electron-builder）验证安装包管线 —— 若失败需甄别是环境/签名因素还是 electron 版本回归，记录结论，不静默跳过
- [ ] 2.3 全仓 lint / typecheck 兜底（与 pre-commit 钩子一致）

## 3. 提交与告警闭环

- [ ] 3.1 提交推送，commit message 列出修复的 GHSA 清单，footer 带 `OpenSpec-Change: fix-dependabot-alerts`（验证：`git push` 成功）
- [ ] 3.2 推送后确认 Dependabot 告警 #54、#55、#56、#57、#58、#59 全部关闭；如个别仍开放，核对 Dependabot 修复底版与实际安装版本（验证：`gh api repos/MarsQiu007/openNovel/dependabot/alerts?state=open` 无相关条目）

## 4. 应急预案（仅在前置任务失败时执行）

- [ ] 4.1 若 electron 最新 42.x 构建/打包不可修复地破坏：回退到 42.10.0（最低修复版）重跑第 2 节矩阵（验证：矩阵全绿且 5 条 electron 告警仍可关闭）
- [ ] 4.2 若 42.10.0 亦不可用：记录证据，与用户确认是否暂升 43.x major（超出本变更范围，需单独确认）