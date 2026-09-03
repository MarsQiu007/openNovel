# fix-release-push-resilience — design

## Context

release 流程两个 push 点的现状：

- `script/bump-version.ts:32`：`git push origin HEAD:$GITHUB_REF_NAME --no-verify` 直接执行，失败时 Bun shell 抛 `ShellError` → exit 1，无重试。2026-09-02 GitHub 服务端 500 拒收 push，整个 release 中止。
- `script/version.ts:24-25`（prod）与 `:35-36`（dev/beta）：`git tag -f` + `git push origin <tag>` 后接 `.nothrow()`，推送失败被静默吞掉 → prepare 假性成功 → build 阶段 checkout tag 才爆出误导性错误。2026-09-01 即此案例。

两脚本均为 Bun shell（`$` tagged template）过程式脚本，非 Effect 代码。

## Goals / Non-Goals

**Goals:**

- bump commit push 具备瞬时错误重试能力，重试耗尽后完整保留原始错误。
- tag push 失败即时让脚本以非零退出码终止（fail fast），错误现场留在 prepare 日志。
- 改动最小化：不重构脚本结构，不新增依赖。

**Non-Goals:**

- 不引入 Effect 重写这两个脚本（它们是 CI 内一次性 bun shell 脚本，重写收益为负）。
- 不改 workflow 编排（release.yml 的 job 结构、needs 依赖）。
- 不做错误分类（解析 stderr 区分瞬时/持久错误）。

## Decisions

### D1：重试放在脚本内小循环，而非 workflow 层 rerun 或 bash 包装

**选择**：在 `bump-version.ts` 内对 push 用一个 attempts 循环（3 次尝试，指数退避 2s/4s），通过 `.nothrow()` + `exitCode` 判断成败。

**备选**：
- workflow 级 rerun-on-failure：粒度太粗——重跑整个 prepare（含 bun install、version bump、changelog 生成）只为重试一条 push；且失败信号被 workflow 机制掩盖。
- bash 层 `until git push; do sleep; done`：逻辑散在 workflow YAML 里，无类型检查、无法本地测试，与"脚本化 release 工具"的既有方向相悖。

### D2：不解析 stderr 做错误分类，全部失败一视同仁重试

**选择**：任何 push 失败都走同一重试路径，重试耗尽才终止。

**理由**：区分"瞬时 5xx / 网络抖动"与"branch protection 真实拒绝"需要脆弱的 stderr 特征匹配，GitHub 错误文案无稳定性承诺。持久错误重试 3 次的代价仅是几秒退避，而换来实现极简、无维护负担。重试耗尽后的终止路径完整透出最后一次的 stderr（含 remote 拒收原因与 Request ID），不损失排查信息。

**备选**：解析 `remote rejected` / `Internal Server Error` 特征决定是否重试——被否决，理由如上。

### D3：tag 推送去掉 `.nothrow()`，依赖 Bun shell 默认 throw 实现 fail fast

**选择**：`version.ts` 两处 `git push origin <tag>` 移除 `.nothrow()`，推送失败时 `$` 直接抛 `ShellError`，进程以非零码退出 → prepare job 失败 → build 不触发。

**理由**：`$` 的默认行为就是"失败即抛"，`.nothrow()` 反而是显式添加的吞错开关。本地 `git tag -f` 保留 nothrow（本地打 tag 本身幂等且几乎不会失败，且远端推送才是真正需要校验的动作）。

**备选**：推送后用 `git ls-remote` 二次校验 tag 存在——被否决，过度设计；push 成功返回码已是远端确认。

### D4：风格遵循现状——`.nothrow()` + `exitCode` 判定，不写 try/catch

与 AGENTS.md "避免 try/catch"一致：Bun shell 的惯用失败处理就是 nothrow 返回码检查（需要继续执行时）或默认 throw（需要立即终止时）。重试循环用 `exitCode === 0` 判断，最后一次失败直接以非零码退出并透出日志。

### D5：preview channel 的 release 在创建时就带 `--prerelease`，靠源头标记而非事后补救

**选择**：`version.ts` preview 分支的 `gh release create -d` 追加 `--prerelease`，draft 从创建起就带 prerelease 标记，publish（`gh release edit --draft=false`）后保持。

**理由**：标记在源头一次落定，publish 流程无需感知 channel 类型；prerelease 天然不参与 GitHub 的 Latest 判定，与 release 语义一致。2026-09-03 的 dev 验证发布实际抢走了 v0.0.2 的 Latest、需要人工补救，根因即 preview 分支缺少此标记。

**备选**：publish 阶段按 channel 条件追加 `--latest=false`——channel 判断扩散到 workflow 层，脚本与 workflow 两处维护同一规则，否决。

## Risks / Trade-offs

- [重试可能推迟持久错误的暴露（如 branch protection 真实拦截）] → 代价上限约 6 秒退避，且终止时完整保留原始错误；不做 stderr 分类（见 D2）。
- [prepare 阶段最坏耗时增加] → 退避总量 < 10s，相对 11 分钟级 release 总时长可忽略。
- [重试期间远端状态变化（他人推送同分支）导致非 fast-forward] → 属真实冲突，重试耗尽后自然失败并透出原因，行为正确；不在本变更范围内引入 rebase 等复杂逻辑。

## Migration Plan

随常规提交合入默认分支后，下次手动触发 Release workflow 即生效。无数据迁移。回滚 = revert 对应提交。

## Open Questions

无。
