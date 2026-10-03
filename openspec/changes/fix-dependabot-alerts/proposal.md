# 修复 GitHub Dependabot 6 个依赖漏洞告警

## Why

GitHub Dependabot 在默认分支报出 6 个开放漏洞告警（5 高危、1 低危），实际只涉及 2 个直接依赖：

- **electron（高危 × 5，均位于 `packages/desktop`）**：devDependency，锁定 42.5.1，经 electron-builder 打包后随桌面安装包分发给最终用户，属运行时暴露面。
  - GHSA-hq2x-r82h-9wj4（告警 #59，修复底版 42.5.2）
  - GHSA-9qh4-3jw8-366w（告警 #56，修复底版 42.9.2）
  - GHSA-j84w-jfhq-vhvj（告警 #57，修复底版 42.9.2）
  - GHSA-gr2m-v5gq-v685（告警 #58，修复底版 42.9.2）
  - GHSA-qmv3-fv6v-rmhq（告警 #55，修复底版 42.10.0）
- **@ai-sdk/provider-utils（低危，GHSA-866g-f22w-33x8，告警 #54）**：`packages/core` 的直接依赖，声明 4.0.23，修复底版 4.0.33。被 `packages/core/src/github-copilot/` 的运行时代码直接引用。根 `package.json` 的 `overrides` 已把实际安装解析到 4.0.46，但 Dependabot 按 manifest 声明版本告警，声明不升则告警长期挂红。

不修复则桌面应用持续暴露 5 个高危漏洞面，且告警长期挂红掩盖新问题。

## What Changes

- `packages/desktop/package.json`：`electron` 42.5.1 → **42.x 策略内最新版**（目标 42.11.10；若实施时被 `minimumReleaseAge` 供应链策略拦截，取 ≥ 42.10.0 的策略允许最新版，见 design D1）
- `packages/core/package.json`：`@ai-sdk/provider-utils` 4.0.23 → **4.0.46**（≥ 修复底版 4.0.33；与根 overrides 现有解析版本对齐，消除声明/解析不一致）
- 重新生成 `bun.lock`
- 验证：受影响包（desktop、core）typecheck / 测试 / 构建通过；推送后 Dependabot 6 条告警全部关闭

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无）

> 本变更为纯依赖安全维护：升级后系统对外行为与既有规格无任何变化，不存在规格层面的需求变更。已在 `.openspec.yaml` 声明 `skip_specs: true`，不发明规格凑数。

## Impact

- **依赖清单**：2 个直接依赖、2 个 `package.json`（`packages/desktop`、`packages/core`）、`bun.lock`；无代码改动
- **受影响包**：desktop（electron 仅 devDependency，但打包进安装包）、core（provider-utils 为 runtime 依赖，供 github-copilot 使用）
- **electron 42.5 → 42.11 同 major 线跨度数月**：electron 42.x 每周发版，同 major 内无破坏性变更承诺，需以 desktop 构建验证兜底（详见 design.md）
- **provider-utils 风险低**：同 major 4.0.x 内升级，且实际安装版本（overrides 解析 4.0.46）已是目标版本，运行时行为零变化
- **告警闭环**：推送后 Dependabot #54、#55、#56、#57、#58、#59 应自动关闭