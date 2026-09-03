# fix-release-push-resilience — tasks

## 1. bump commit 推送重试（对应 spec：瞬时错误自动重试）

- [x] 1.1 实现 `script/bump-version.ts` push 环节的重试循环：3 次尝试、指数退避（2s/4s），用 `.nothrow()` + `exitCode` 判定成败（不写 try/catch），重试时输出含原始错误的警告日志；验证：仓库根 `bun typecheck` 与 oxlint 通过
- [x] 1.2 实现重试耗尽终止路径：以非零退出码终止脚本，日志完整保留最后一次 push 的原始错误（remote 拒收原因、Request ID）；验证：审查终止路径确认 stderr 不被吞
- [x] 1.3 回归验证既有行为：以 `OPENNOVEL_DRY_RUN=true` 本地运行脚本，确认版本 bump、package.json 替换与 JSON 输出不变；验证：脚本退出码为 0 且输出含正确 version/tag

## 2. tag 推送 fail fast（对应 spec：tag 推送失败必须即时失败）

- [x] 2.1 移除 `script/version.ts` 中两处（prod 与 dev/beta 分支）tag 远端推送的 `.nothrow()`，保留本地 `git tag -f` 的 `.nothrow()`；验证：仓库根 `bun typecheck` 与 oxlint 通过
- [x] 2.2 验证失败链路：确认 tag push 失败时脚本以非零码退出、原始错误留在 prepare 日志，且 `release.yml` 中 build-windows 的 `needs: prepare` 保证 build 不被触发；验证：对照 workflow 依赖关系与脚本退出路径完成审查

## 3. 端到端验证

- [x] 3.1 手动触发 Release workflow（patch + dev channel），确认 prepare → build-windows → publish 全链成功，远端 tag 与 draft release 正确创建、build 能基于 tag checkout；验证：`gh run view` 各 job 全绿且 `gh release list` 出现新条目

## 4. 观察发现修复（3.1 验证发布中发现）

- [x] 4.1 修复 preview channel release 标记：`script/version.ts` preview 分支的 `gh release create` 追加 `--prerelease`，使 dev/beta 测试包发布后不占用 Latest；验证：仓库根 oxlint 与针对脚本的类型检查通过
- [x] 4.2 即时补救已发布的 Latest 标记：v0.0.2 标回 Latest、v0.0.2-dev.20260903 标记为 Pre-release；验证：`gh release list` 显示 v0.0.2 为 Latest、dev 包为 Pre-release
