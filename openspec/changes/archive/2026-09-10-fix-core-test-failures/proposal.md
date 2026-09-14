## Why

`packages/core` 的测试套件在 Windows 本地和 GitHub Actions 上均有 3 个持续失败，导致 `test` workflow 无法通过、主分支质量门禁失真。根因各不相同：一个缺少会话迁移时的上下文 epoch 清理，两个属于测试环境/平台适配问题。

## What Changes

- 在 `SessionEvent.Moved` 的 projector 中调用 `SessionContextEpoch.reset`，会话迁移后清除旧的上下文 epoch，使下一次 resume 从新 Location 重建 baseline（修复 `interrupts a source Location runner after a Session moves`）。
- 将 `cross-spawn spawner` 的 `.all` stdout 测试从平台相关的 `echo` 命令改为 `node -e` 脚本输出，消除 Windows `echo` 带引号输出的假失败。
- 不修改任何产品运行时代码、API schema 或依赖版本（除上述 projector 一行级修复）。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- 无。本变更只修复测试基础设施与一处 projector 遗漏调用；`.openspec.yaml` 已设置 `skip_specs: true`。

## Impact

- 影响 `packages/core` 的 `session/projector.ts`（新增一行 `SessionContextEpoch.reset` 调用）和 3 个测试文件。
- 不影响 `packages/novel-store`、`packages/plugin`、`packages/opennovel`、`packages/app`、`packages/desktop` 的运行时代码。
- 不修改数据库 schema、HTTP API 契约或用户数据格式；`SessionContextEpoch.reset` 仅删除内存中 session 对应的 epoch 行，已有本地数据不受影响。
- 不新增、不升级依赖。
