# 任务：修复 Windows 本地 vite 构建失败

依据：proposal.md（根因与动机）、design.md（D1 主方案 / D2 应急 / D3 验证矩阵 / D4 联动顺序）。

## 1. 依赖切换

- [x] 1.1 根 `package.json` catalog：`"@solidjs/start": "https://pkg.pr.new/@solidjs/start@dfb2020"` → `"2.0.4"`（design D1；验证：grep catalog 行显示 `2.0.4`）
- [x] 1.2 `bun install` 刷新 `bun.lock`（验证：`grep -o '"@solidjs+start@[^"]*"' bun.lock | sort -u` 仅含 2.0.4 解析，无 pkg.pr.new tarball 残留）

## 2. 验证矩阵（design D3，全部在本机 Windows 执行）

- [x] 2.1 全仓 typecheck：`bun turbo typecheck` 全绿；若 console 系列 app 报 API 断裂，按 design 风险节做最小适配后重跑（验证：退出码 0）
  - 实施记录：2.0.4 下 console-app 出现两类断裂，均已最小适配——(a) `APIEvent` 从根入口移至 `@solidjs/start/server`（3 个 route 文件改 import 来源）；(b) `src/global.d.ts` 原以 `export declare module` 间接成为 module，其 `declare module "solid-js/web"` 实为模块增强；删除覆盖块后文件退化为 script，环境模块声明遮蔽了 solid-js/web 真实类型的 `export *`（getRequestEvent 等全部消失），补 `export {}` 保持 module 形态并删除已无必要的 APIEvent 窄化覆盖。另附排查产物：root 导入 APIEvent 报错、APIEvent 缺 locals/params、getRequestEvent 缺失三层现象层层剥离，最终以最小复现排除 tsconfig、以恢复覆盖块对照锁定 global.d.ts 形态为触发器
- [x] 2.2 4 个应用构建：`console/app`、`console/support`、`enterprise`（默认 + `OPENNOVEL_DEPLOYMENT_TARGET=cloudflare` 两次）、`stats/app` 各跑 `vite build`（验证：4 包构建退出码 0，无 rollup 解析错误；与修复前的同类失败形成对照）
  - 实施记录：5 个构建全部退出码 0。最终补丁含 2 文件 7 处修复——`dist/config/index.js`：3 处 `getRuntimeCode`（server-runtime/server-fns-runtime×2）+ 2 处 define（`START_APP_ENTRY`/`START_CLIENT_ENTRY`）；`dist/config/fs-routes/index.js`：2 处 `buildId`（`solid-start:routes` 虚拟模块的 import 语句与动态 import 发射）。逐轮暴露→修补的对照：轮 1 `E:AICodes...verver-runtime`（getRuntimeCode），轮 2 `[vite:define] Invalid define value "E:\AI\...app.tsx"`，轮 3 `solid-start:routes` 发射 `...srcouteslookup.tsx?pick=route`（`\r` 被消化）——三处均为同一"Windows 反斜杠进 JS 字面量"缺陷的不同表现。注：构建矩阵在暂存出 vuln 变更依赖文件（nitro beta + mysql2）的隔离树上执行（A/B）；`console/support` 无 build script，直接调 `vite build`
- [x] 2.3 dev 冒烟：`console/app` `vite dev` 启动后 `http://localhost:3001/` 响应 200（修复前基线为 120s 无响应；验证：HTTP 200）
  - 实施记录：dev 管线修复已证实——vite 1.7s ready 并即时响应（修复前 120s 无响应，mangled import 卡死模块图），但首页返回 500：`Resource.ZEN_LITE_PRICE` 抛 "SST links are active" 守卫错误（billing.ts 模块初始化）。这是本机无 `sst dev` 多路复用器（需 AWS SSO）的环境前置问题，与本变更无关且修复前同样存在（只是当时根本走不到应用代码）。**用户决策（2026-09-02）：接受当前证据作为本任务验证**——本变更的职责（dev 管线可用）已达成；完整 HTTP 200 留待有 `sst dev` 环境时自然覆盖

## 3. 提交与联动（design D4）

- [x] 3.1 仅提交本变更文件：catalog、`bun.lock`、（若产生）app 适配代码；commit message 说明根因（devinxi 快照路径转义缺陷）与切换目标 2.0.4（验证：`git push` 成功，且提交不含 mysql2/nitro 升级文件）
  - 实施记录：提交 `22778a6866`（已推送），仅含 root `package.json`（patchedDependencies 登记）、`bun.lock`（补丁条目）、`patches/@solidjs%2Fstart@pkg.pr.new-dfb2020.patch`；D1 期的 app 适配（3 个 route 文件 + global.d.ts）已整体回退 HEAD，零 app 源码改动；pre-commit turbo typecheck 钩子通过；提交不含 mysql2/nitro 文件（当时已暂存隔离，提交后已恢复）
- [x] 3.2 联动：回到 `fix-dependency-vulnerabilities` 变更，重跑其任务 2.2/2.3 并关闭（验证：该变更 tasks.md 的 2.2/2.3 勾选）
  - 实施记录（2026-09-02）：联动完成——nitro 升至 3.0.260610-beta 后该变更 2.2 构建矩阵（enterprise node/cloudflare 双分支 + console/app）与 2.3 dev 冒烟均已关闭并提交 `e3fe9ec18e`（已推送）；Dependabot 9 条告警同批关闭（#3/#4/#6/#7/#8/#9/#32/#33/#53，fixed_at=2026-09-02T12:56Z）。本变更任务全部完成

## 4. 应急预案（仅当 D1 失败时执行，design D2）

- [x] 4.1 若 2.0.4 出现超出 vite 配置层的 API 断裂：`bun patch` 对 devinxi 快照的 `getRuntimeCode` 路径做 `replace(/\\/g, "/")` 转义，catalog 保持 pkg.pr.new pin；重跑第 2 节矩阵（验证：矩阵全绿；在本变更记录补丁文件与理由）
  - 实施记录：D1（切 2.0.4）在 typecheck 通过后于构建阶段失败——2.0.x 产物面向 vite 8（`rolldownOptions`、peer `vite ^8||^9`），本仓 vite 7.1.4 下报 `Could not resolve entry module "index.html"`；vite 8 迁移超出本变更范围。用户选择激活 D2：catalog 回退 pkg.pr.new 快照，补丁共 2 文件 7 处（详见 2.2 记录），均追加 `.replace(/\\/g, "/")` 归一化。过程波折：`bun patch --commit` 在 URL 解析依赖上触发 bun 已知 segfault（oven-sh/bun#19524，#17982 重复项）→ 手写补丁因 hunk 行数不符被 bun 校验拒绝 → 改用 `git diff --no-index` 对 pristine 副本生成补丁（真实 index hash + 正确 hunk 头）通过校验。D1 的 typecheck 适配（APIEvent 迁移、global.d.ts 改写）已整体回退到 HEAD——快照下 global.d.ts 的 `export declare module "@solidjs/start/server"` override 正是 zen 系列路由 APIEvent 类型的来源，根入口原生导出的完整 APIEvent（含 params）服务其余路由

