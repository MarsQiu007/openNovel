# 设计：修复 Windows 本地 vite 构建失败

## Context

调查已确认的证据链（详见 proposal.md — Why）：

- catalog pin：根 `package.json` `"@solidjs/start": "https://pkg.pr.new/@solidjs/start@dfb2020"`，自仓库 Initial commit（2026-08-05）即存在，无文档记录 pin 的动机；该快照基础版本为 `2.0.0-devinxi.0`。
- 缺陷代码（快照 `dist/config/index.js:166`）：
  ```js
  getRuntimeCode: () => `import { createServerReference } from "${normalize(fileURLToPath(new URL("../server/server-runtime", import.meta.url)))}"`
  ```
  `normalize` 来自 `node:path`，Windows 上保留反斜杠；产物为未转义的绝对路径字符串字面量，被 rollup 解析时转义序列消化（`\n` → 换行等），形成错误中的 `E:AICodesopenNovel<LF>ode_modules...`。`server-fns-runtime` 一处（:172）同理。
- 失败面：4 个应用的 route 文件含 `use server` 函数 → pick 虚拟模块（`?pick=default&pick=$css`）嵌入该 runtime import → Windows 构建必失败。新旧 nitro 版本下错误同类，与本缺陷无关（A/B 已排除升级回归）。
- 上游 released 2.0.4（2026-08-24）：runtime 改为包说明符 `@solidjs/start/fns/client|server`（`config/index.js:49-53`），绝对路径注入不复存在；devinxi 重写自 2.0.0（2026-08-04）起进入正式线，2.0.4 为同代续版。

## Goals / Non-Goals

**Goals:**

- Windows 本机 4 个应用 `vite build` + `vite dev` 可用，且 CI（Linux）构建保持通过
- 脱离 pkg.pr.new 不可重现快照，回到 released 版本线

**Non-Goals:**

- 不升级 `solid-js`、`@solidjs/router`、`vite` 等其余 catalog 依赖（仅动 `@solidjs/start`，除非 typecheck/build 证明版本矩阵冲突）
- 不重构 4 个应用的 vite 配置
- 不追究 Initial commit pin 的历史动机（无法考证，以"released 已含同代特性"为工作假设，验证兜底）

## Decisions

### D1：主方案 = catalog 切换到 released `@solidjs/start@2.0.4`

- 与快照同架构代际（devinxi 重写已随 2.0.0 发布），API 断裂面预计小；上游已移除缺陷代码；
- 满足 `minimumReleaseAge`（发布于 08-24，> 3 天）；
- 附带收益：脱离不可重现快照，属供应链修复。备选（更高/更低 released 版本）仅在 2.0.4 引入断裂且短期无法适配时考虑（2.0.3/2.0.1 为备选退档）。

### D2：应急方案 = 对 devinxi 快照打本地补丁（仅当 D1 适配代价不可接受）

- 用 `bun patch`（bun 内建 patch 流程）把快照的 `getRuntimeCode` 路径包上 `.replace(/\\/g, "/")`（或改用 `pathToFileURL`）；
- 缺点明显：继续锁不可重现快照 + 永久维护补丁，故仅为 D1 失败时的退路；
- 触发条件：D1 升级后 4 个 app 出现无法在小范围内修复的 API 断裂（超出 vite 配置层、需大面积改 app 源码）。
- **[2026-09-02 已激活]** D1 实测：typecheck 断裂（APIEvent 迁移、global.d.ts 形态）已最小适配通过，但构建层断裂不可小范围修复——released 2.0.x 全线面向 vite 8（2.0.4 产物使用 `rolldownOptions`、peer `vite ^8||^9`），本仓 vite 7.1.4 下 4 app 构建报 `Could not resolve entry module "index.html"`；vite 8 迁移涉及 3 个 vite 插件升级与 8 处 vite 消费面，超出本变更范围。用户选择激活 D2：catalog 回退 pkg.pr.new 快照，最终补丁 2 文件 7 处——`config/index.js` 的 3 处 `getRuntimeCode` + 2 处 `START_APP_ENTRY`/`START_CLIENT_ENTRY` define、`fs-routes/index.js` 的 2 处 `buildId`，均在注入点追加 `.replace(/\\/g, "/")`（验证矩阵构建中逐轮暴露的同一"反斜杠进 JS 字面量"缺陷的三个发病面）。工具波折：`bun patch --commit` 对 URL 依赖 segfault（oven-sh/bun#19524），改以 `git diff --no-index` 对 pristine 副本手工生成补丁；vite 8 迁移作为潜在后续独立变更（暂未立项）。

### D3：验证矩阵在 Windows 本机执行（这正是缺陷暴露面）

- 全仓 `bun turbo typecheck`；
- 4 个应用逐一 `vite build`；enterprise 额外跑 `OPENNOVEL_DEPLOYMENT_TARGET=cloudflare` 分支；
- `console/app` `vite dev` 启动冒烟（此前基线为 120s 无响应，修复后应响应 200）；
- CI 侧不单独加验证（发版 CI 已覆盖 Linux 构建）。

### D4：与 `fix-dependency-vulnerabilities` 的联动顺序

- 本变更先落地（含提交），使依赖升级变更的 2.2/2.3 可在本机真实验证；
- 本变更的提交只含 catalog + bun.lock（+ 若有的 app 适配），与工作区中已存在的 mysql2/nitro 升级改动（属另一变更）按文件分开提交，不混入。

## Risks / Trade-offs

- [2.0.4 与 devinxi.0 快照存在 API/配置差异，4 个 app 编译失败] → 先跑 typecheck + build 定位断裂点；vite 配置层差异（如 `solidStart()` 选项改名）做最小适配；不可修复则按 D2 退路
- [`@tanstack/server-functions-plugin` 等快照期传递依赖与新版本不匹配] → bun install 时 bun 会按新包的依赖声明重新解析；若出现 peer 冲突，单独评估受影响包
- [Linux CI 在 2.0.4 上出现 Windows 之外的新问题] → 概率低（released 版本消费面远大于 dev 线快照）；若出现，在 CI 日志定位后同样按最小适配处理
- [dev 线上的某特性在 released 线缺失导致行为差异] → 工作假设为 pin 无特性动机（Non-Goals 已声明）；验证矩阵中的 dev 冒烟 + 既有测试可暴露大部分行为差异

## Migration Plan

1. 改 catalog pin → `bun install` → typecheck → 4 app build（+ enterprise cloudflare 分支）→ dev 冒烟
2. 通过后按 D4 单独提交本变更改动
3. 恢复执行 `fix-dependency-vulnerabilities` 的 2.2/2.3 验证并完成该变更

回滚策略：catalog 单行 revert + `bun install`，无数据耦合。

## Open Questions

（无——主/应急方案、验证矩阵、与在途变更的联动顺序均已定。）
