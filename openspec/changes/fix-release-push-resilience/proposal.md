# fix-release-push-resilience

## Why

Release 流程对 git push 的瞬时失败零容错，已经造成两次真实发布事故：

- 2026-09-02（run 33642882134）：GitHub 服务端瞬时 500（`Internal Server Error`）拒收 version bump commit 的 push，`script/bump-version.ts` 无重试机制，整个 release 中止。
- 2026-09-01（run 33467518434）：`script/version.ts` 用 `.nothrow()` 静默吞掉 tag 推送失败，prepare 阶段假性成功，错误延迟到 build 阶段才以 `A branch or tag with the name 'v0.0.1' could not be found` 的误导形式爆出，排查成本高。

## What Changes

- `script/bump-version.ts`：push bump commit 到默认分支时增加带退避的重试，瞬时网络/服务端错误不再直接中止 release。
- `script/version.ts`：移除 tag 推送的 `.nothrow()`，改为显式校验——tag 推送失败必须让 prepare 阶段立即失败（fail fast），错误现场保留在 prepare 日志中。
- `.github/workflows/release.yml` 无结构性改动，仅受益于上述两个脚本的行为变化。

## Capabilities

### New Capabilities

- `release-push-resilience`: release 准备阶段对 git push 操作的容错行为——bump commit 推送需容忍瞬时服务端错误并重试；tag 推送失败必须即时失败并暴露根因，不得静默跳过。

### Modified Capabilities

（无——现有 specs 均为写作流水线行为，本变更不触及。）

## Impact

- **受影响代码**：`script/bump-version.ts`、`script/version.ts`（仓库根 script 目录）；间接验证对象为 `.github/workflows/release.yml` 的 prepare job。
- **受影响包**：无业务包受影响（novel-store / plugin / opennovel / app / desktop / schema / protocol / core 均零改动）；仅影响 release 工具链脚本。
- **数据兼容性**：不涉及数据模型、角色生命周期或审计维度，无本地数据兼容性问题。
- **运维影响**：重试会延长 prepare 阶段最坏情况耗时（可接受，量级为秒级退避 × 少数几次）；tag 失败从"build 阶段爆错"提前到"prepare 阶段爆错"，缩短排查路径。

## 非目标

- 不修改 release 的触发方式、bump 类型与 channel 策略。
- 不扩展 macOS / Linux 构建流程（保留 workflow 中现有 TODO）。
- 不引入 workflow 级自动重跑（如 rerun-on-failure）机制。
- 不改动 branch protection、push protection 等 GitHub 仓库配置。
- 不处理 2026-09-01 02:21 那次失败的 TAG 输出为空问题（该次失败源于当时的旧版 workflow/脚本，现行版本已具备 outputs 传递；如复发再单独立项）。
