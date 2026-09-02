# 修复默认分支 9 个依赖漏洞告警

## Why

GitHub Dependabot 在默认分支报出 9 个开放漏洞告警（1 高危、8 中危），实际只涉及 2 个直接依赖：

- **mysql2（高危，GHSA-3f6p-5ww8-9rcr）**：认证插件可被降级为 `mysql_clear_password`，泄漏明文凭据。`packages/console/core` 锁定 3.14.4，修复底版 3.22.0（告警 #53，dev 依赖）。
- **nitro（中危 × 8）**：CVE-2026-44372 通配符路由规则下协议相对 URL 开放重定向；CVE-2026-44373 `routeRules` 中百分号编码路径穿越导致代理作用域绕过。`console/app`、`console/support`、`enterprise`、`stats/app` 四个包各 2 条告警，锁定 3.0.1-alpha.1，修复底版 3.0.260429-beta（告警 #3/#4/#6/#7/#8/#9/#32/#33，runtime 依赖）。

不修复则生产/开发服务持续暴露在这两个漏洞面下，且告警长期挂红掩盖新问题。

## What Changes

- `packages/console/core/package.json`：`mysql2` 3.14.4 → **3.24.2**（策略内最新稳定版，≥ 修复底版 3.22.0，同 major 内升级；原目标 3.24.3 当日发布被 `minimumReleaseAge` 供应链策略拦截，见 design D1 实施修正）
- `packages/console/app`、`packages/console/support`、`packages/enterprise`、`packages/stats/app` 的 `package.json`：`nitro` 3.0.1-alpha.1 → **3.0.260610-beta**（npm `latest` 标签，≥ 修复底版 3.0.260429-beta，含两个 CVE 修复）
- `packages/enterprise/vite.config.ts`：nitro 选项增加 **`wasm: false`**（升级暴露的 SSR 构建回归适配——beta 线注入 wasm/unwasm 导出条件使 shiki/wasm 解析到裸 onig.wasm，vite SSR 打包失败；根因与选型见 design D5）
- 重新生成 `bun.lock`
- 验证：全仓 typecheck 通过；受影响包的既有测试/构建通过；推送后 Dependabot 9 条告警全部关闭

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无）

> 本变更为纯依赖安全维护：升级后系统对外行为与既有规格（technique-library / technique-shadow-loop / technique-injection）无任何变化，不存在规格层面的需求变更。已在 `.openspec.yaml` 声明 `skip_specs: true`，不发明规格凑数。

## Impact

- **依赖清单**：2 个直接依赖、5 个 `package.json`、enterprise `vite.config.ts`（wasm: false 适配）、`bun.lock`
- **nitro 跨通道升级风险**：从 `3.0.1-alpha.1`（alpha）跳到 `3.0.260610-beta`（beta 通道），跨度数月，nitro 3.x 全线尚在预发布通道（无稳定修复版可选）；可能引入 dev server / 构建行为变化，需以构建与启动验证兜底（详见 design.md）
- **mysql2 风险低**：dev 依赖、同 major 小版本升级
- **告警闭环**：推送后 Dependabot #3、#4、#6、#7、#8、#9、#32、#33、#53 应自动关闭
