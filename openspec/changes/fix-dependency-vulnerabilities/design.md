# 设计：修复默认分支 9 个依赖漏洞告警

## Context

依赖与使用现状（详见 proposal.md — Why）：

- **mysql2@3.14.4**：`packages/console/core` 的 devDependency，配合 drizzle-kit 执行 MySQL 迁移（`drizzle.config.ts`），不进入运行时产物。
- **nitro@3.0.1-alpha.1**：`console/app`、`console/support`、`enterprise`、`stats/app` 四个 SolidStart 应用的**直接依赖**，以 `nitro/vite` 插件形态使用（vite 7.1.4 + `@solidjs/start` + Cloudflare 部署）：
  - `console/app`：`preset: "cloudflare-module"` + `cloudflare.nodeCompat`
  - `enterprise`：按 `OPENNOVEL_DEPLOYMENT_TARGET` 条件切换 cloudflare-module preset，传入 `baseURL`
  - `console/support` / `stats/app`：同模式
  - 四个配置均未使用 `routeRules`（两个 CVE 的直接暴露面），实际暴露有限，但版本升级是消除告警的正道
- nitro 3.x 全线在预发布通道：npm `latest` = `3.0.260610-beta`，无稳定版修复可选；peer 依赖要求 `vite ^7`（当前满足）。
- 包管理器 bun 1.3.14 + workspaces catalog，锁文件 `bun.lock`，registry 为 npmmirror。

## Goals / Non-Goals

**Goals:**

- 9 条 Dependabot 告警全部关闭：mysql2 ≥ 3.22.0、nitro ≥ 3.0.260429-beta
- 升级后全仓 typecheck 与受影响应用构建（含 cloudflare-module preset）通过
- 保持仓库既有的精确版本 pin 风格，锁文件同步刷新

**Non-Goals:**

- 不升级 nitro 之外的其他依赖，不做全量 `bun update`（避免引入无关 diff）
- 不重构 vite/nitro 配置（`compatibilityDate`、preset 等保持原样，除非构建报错）
- 不在此变更内跟进 nitro 后续 beta 迭代（记录于风险节，由后续变更跟进）

## Decisions

### D1：mysql2 3.14.4 → 3.24.2（满足 minimumReleaseAge 策略的最新稳定版），而非仅到修复底版 3.22.0

同为 3.x major 内小版本升级，API 兼容风险极低；升到可安装的最新版与只到 3.22.0 的验证成本相同，而停在底版只会让告警数月后再次挂红。备选（仅升 3.22.0）被放弃。

> 实施修正（2026-09-02）：原目标 3.24.3 于当日发布，被仓库 `bunfig.toml` 的 `minimumReleaseAge = 259200`（3 天）供应链保护策略拦截。取策略允许的最新版 **3.24.2**（2026-08-24 发布，≥ 修复底版 3.22.0）；不修改该安全策略。

### D2：nitro 3.0.1-alpha.1 → 3.0.260610-beta（npm `latest`），而非最低修复版 3.0.260429-beta

- 两个 CVE 在 ≥ 3.0.260429-beta 均已修复，latest 额外多 3 个月的修复积累，且是上游当前维护前沿；
- alpha → beta 无论如何都是大跨度升级，多跨 3 个月不显著增加风险，反而减少近期再次升级的次数；
- nitro 3.x 无稳定版，"等稳定版"不成立。备选（3.0.260429-beta）保留为回退目标：若 latest 引入构建/运行破坏且短期无法解决，降级到最低修复版同样能关闭告警。

### D3：升级方式 = 手动编辑 5 个 package.json + `bun install` 刷新 bun.lock

- 与仓库精确 pin 风格一致（所有版本均为精确号，非 `^`）；
- 不用 `bun update nitro`：会浮动传递依赖，diff 不可控；
- 不用 `overrides`：nitro 是 4 处直接依赖，直接改声明即可，无需强制手段。

### D4：验证矩阵 = 全仓 typecheck + 受影响应用 vite build + dev 冒烟

- `bun turbo typecheck`（与 pre-commit 钩子一致，34 包全覆盖，含 mysql2 所在 console/core）；
- 对 4 个 nitro 包跑 `vite build`（至少 `console/app` 与 `enterprise`，二者覆盖 cloudflare-module preset 的两个分支路径），验证插件 API 与产物管线未破坏；
- `console/app` 的 `vite dev` 启动冒烟，确认 dev server 行为；
- mysql2 仅 dev 迁移用途，typecheck + 一次 `drizzle-kit` 干跑（或迁移脚本现有入口）即足。

### D5：enterprise 增加 nitro `wasm: false` 配置（升级引入的 SSR wasm 回归修复，2026-09-02 实施中确认）

nitro beta 线（260429 与 260610 均实测）默认开启 `wasm` 选项，向 vite SSR 解析注入 `wasm`/`unwasm` 导出条件，使 shiki 的 `import("shiki/wasm")` 经 `unwasm` 条件解析到裸 `dist/onig.wasm`，vite SSR 打包触发 `[vite:wasm-fallback]` 构建失败（alpha.1 无此行为，A/B 隔离已证）。

- **选 `wasm: false` 而非 vite-plugin-wasm**：`shiki/wasm` 的 default 出口是 base64 内联版（`@shikijs/engine-oniguruma/wasm-inlined`，wasm 二进制直接嵌在 mjs 内、零外部引用），SSR 与 cloudflare workerd 均可直接 `WebAssembly.instantiate`——一行配置即修复，且不引入新依赖、不在产物中产生需要运行时解析的 wasm 资产文件（cloudflare 目标无 node_modules、无 fs，插件方案的资产读取路径风险更高）；
- 仅 enterprise 需要（其 SSR 图经 session-ui 引入 shiki；console/app、console/support、stats/app 构建已实测不受影响）；
- 属于升级暴露的必要配置适配，与 compatibilityDate 同类，不视为范围蔓延。

## Risks / Trade-offs

- [nitro alpha→beta 跨度数月，vite 插件 API / cloudflare-module 产物行为可能变化] → 构建矩阵兜底（D4）；回滚 = revert 5 个 package.json + bun.lock，无数据/迁移成本
- [compatibilityDate 2024-09-19 早于新 nitro，构建可能告警或要求更新] → 首选保持不动；仅当构建硬报错时按提示更新该日期并在 PR 说明中记录（属于配置兼容性必要修改，不视为范围蔓延）
- [@solidjs/start 与新 nitro beta 的集成兼容性未知（start 以 catalog 版本 pin）] → vite build / dev 冒烟覆盖；若不兼容，评估将 `@solidjs/start` catalog 版本同步小幅升级（在任务中作为应急项列出，需单独确认）
- [npmmirror 镜像对新版本同步延迟，`bun install` 可能 404] → 查镜像是否有该版本；必要时临时用官方 registry 安装后恢复
- [beta 通道无 semver 稳定性承诺，未来升级可能再跳版本] → 接受（现状 alpha 同样如此）；在变更归档说明中记录"nitro 3.x 跟随 latest beta"为已知策略

## Migration Plan

1. 编辑 5 个 package.json（mysql2 ×1、nitro ×4）
2. `bun install` 刷新 bun.lock
3. 运行验证矩阵（D4）
4. 提交推送，pre-commit typecheck 通过；等待 Dependabot 重新扫描，确认 9 条告警关闭

回滚策略：单 commit revert 即可回到升级前状态，无持久化数据、schema 或部署产物耦合。

## Open Questions

（无——版本选择、验证方式均已定；nitro beta 的实际兼容性由构建验证回答，失败路径已在风险节给出。）
