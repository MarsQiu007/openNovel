# 修复 Windows 本地 vite 构建失败（@solidjs/start 路径转义缺陷）

## Why

本机 Windows 上 4 个 SolidStart 应用（console/app、console/support、enterprise、stats/app）的 `vite build` 与 `vite dev` 全部失败，rollup 报 `Rollup failed to resolve import "E:AICodesopenNovelode_modules..."`。CI（Linux）不受影响，因此发版正常，但本地构建/开发被完全阻断，且这是 `fix-dependency-vulnerabilities` 变更验证矩阵（2.2/2.3）无法完成的直接原因。

根因（已调查确认，证据见 design.md）：catalog 把 `@solidjs/start` pin 在 pkg.pr.new 的 PR 快照构建 `dfb2020`（基础版本 `2.0.0-devinxi.0`），其 `dist/config/index.js:166` 将 `fileURLToPath()` 产生的 Windows 反斜杠绝对路径**未转义**内插进生成的虚拟模块代码；rollup 解析该字符串字面量时把 `\A`、`\n`、`\s` 当转义序列消化，绝对路径被破坏。上游 released `2.0.4`（2026-08-24，同 devinxi 架构代际）已把该处重构为包说明符（`@solidjs/start/fns/client`），缺陷不复存在。

## What Changes

- 根 `package.json` catalog：`@solidjs/start` 从 `https://pkg.pr.new/@solidjs/start@dfb2020`（不可重现的 PR 快照）改为 released **`2.0.4`**（满足 `minimumReleaseAge` 3 天策略，发布于 08-24）
- 重新生成 `bun.lock`
- 验证：全仓 typecheck；4 个应用的 `vite build`（含 enterprise 两个 preset 分支）在 Windows 本机通过；`console/app` `vite dev` 启动并响应 200
- 若 2.0.4 与现有 app 代码存在 API 断裂：优先最小代码适配；适配代价过大时回退为对 devinxi 构建打本地补丁（转义路径），详见 design.md D1/D2

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无）

> 本变更为依赖修复类维护：目标版本与被替换的 PR 快照同架构代际，应用对外行为不变，无规格层面需求变更。已在 `.openspec.yaml` 声明 `skip_specs: true`。

## Impact

- **依赖清单**：catalog 1 处 pin + `bun.lock`（bun 隔离布局下该包在 store 中现存两个 tarball 目录，升级后统一）
- **解除阻塞**：`fix-dependency-vulnerabilities` 变更的任务 2.2/2.3（本机构建/冒烟验证）依赖本变更先落地
- **供应链**：移除对 pkg.pr.new 不可重现快照的依赖，属风险削减
- **兼容性风险**：`2.0.0-devinxi.0` → `2.0.4` 跨约 5 个月的 dev 线迭代，`solidStart()` 配置 API 可能有差异；4 个 app 的 vite 配置较薄（preset/middleware/baseURL），断裂面预计很小，若断裂需少量适配（预案见 design.md）
