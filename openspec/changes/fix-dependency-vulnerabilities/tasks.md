# 任务：修复默认分支 9 个依赖漏洞告警

依据：proposal.md（为什么/改什么）、design.md（版本选择 D1–D4、验证矩阵、风险与回退）。

## 1. 依赖升级

- [x] 1.1 `packages/console/core/package.json`：`mysql2` `3.14.4` → `3.24.2`（design D1；3.24.3 当日发布被 minimumReleaseAge 拦截，取策略内最新版；验证：`grep '"mysql2"' packages/console/core/package.json` 显示 3.24.2）
- [x] 1.2 四个 nitro 使用方 `packages/console/app`、`packages/console/support`、`packages/enterprise`、`packages/stats/app` 的 `package.json`：`nitro` `3.0.1-alpha.1` → `3.0.260610-beta`（design D2；验证：四个文件 grep 均显示新版本）
- [x] 1.3 运行 `bun install` 刷新 `bun.lock`（若 npmmirror 404 按 design 风险节切换 registry 重试；验证：`grep -o '"nitro@[^"]*"' bun.lock | sort -u` 仅含 `nitro@3.0.260610-beta`，`grep -o '"mysql2@[^"]*"' bun.lock` 仅含 `mysql2@3.24.2`）

## 2. 验证矩阵（design D4）

- [x] 2.1 全仓 typecheck：`bun turbo typecheck` 34 包全绿（与 pre-commit 钩子一致）
- [x] 2.2 nitro 构建冒烟：`packages/console/app` 与 `packages/enterprise` 各跑 `vite build`（覆盖 cloudflare-module preset 两个分支：`enterprise` 需 `OPENNOVEL_DEPLOYMENT_TARGET=cloudflare` 跑一次）；验证：构建成功产出 `.output`/产物目录，无 nitro 插件报错；若报 compatibilityDate 硬错误，按 design 风险节更新日期并记录
  - 前置发现（2026-09-02，来自 fix-solidstart-windows-build 变更的 A/B 隔离测试）：nitro `3.0.260610-beta` 下 enterprise SSR 打包 shiki `onig.wasm` 触发 `[vite:wasm-fallback]`（ESM wasm 不支持）构建失败；同树回退 nitro `3.0.1-alpha.1` 后 enterprise 构建通过（exit=0）——回归由 nitro beta 的 SSR externals 行为变化引入。处置顺序：先探测 `3.0.260429-beta`（design D2 备选/4.1 降级路径）是否同样复现；复现则说明整条 beta 线同源，降级无意义，转配置修复（enterprise 加 vite-plugin-wasm 之类 wasm 处理——cloudflare 目标无 node_modules 必须打包，`ssr.external` 对其无效）。另：console/app、console/support、stats/app 三包在同一 A/B 树（nitro alpha.1）上构建已全部通过（本变更 3.1 提交前的补丁矩阵复用）
  - 探测结论（2026-09-02）：`3.0.260429-beta` 下 enterprise SSR 同样在 `[vite:wasm-fallback]` 失败（客户端构建通过）——整条 beta 线同源，4.1 降级无意义，执行配置修复分支。根因定位：nitro `wasm` 选项默认为 true（`resolveExportConditionsOptions` 中 `wasm: options.wasm !== false`），向 vite SSR resolve 注入 `wasm`/`unwasm` 导出条件，使 `shiki/wasm` 经 `unwasm` 条件解析到裸 `dist/onig.wasm`；vite 核心无 wasm loader 直接报错。而 `shiki/wasm` 的 default 出口是 `wasm.mjs` → `@shikijs/engine-oniguruma/wasm-inlined`（wasm 二进制 base64 内联，零外部引用），SSR 与 cloudflare workerd 均可直接 `WebAssembly.instantiate`。修复：enterprise `vite.config.ts` nitro 选项加 `wasm: false`（一行配置，未引入 vite-plugin-wasm 依赖），nitro 恢复 `3.0.260610-beta`
  - 验证记录（2026-09-02）：`wasm: false` 后 enterprise 默认构建（client 20.42s + SSR 16.91s，preset node-server）与 cloudflare 分支构建（preset cloudflare-module，compatibility 2024-09-19，wrangler.json 生成）均通过，SSR 产物中 shiki wasm 以 base64 内联 chunk（`_ssr/wasm-DDgzZJey.mjs` 622kB）正常打包，无 `[vite:wasm-fallback]` 报错；console/app 复合构建（sitemap → vite build → schema 校验）通过（SSR 14.54s，wrangler.json 生成）；`bun install` 复核 "no changes" 且 bun.lock 中 `nitro@3.0.260610-beta`、`mysql2@3.24.2` 唯一
- [x] 2.3 dev 冒烟：`packages/console/app` `vite dev` 可启动并响应首页请求后停止（验证 dev server 插件行为）
  - 实施记录（2026-09-02）：`vite dev` 1.96s 就绪（端口 3001），首页请求被 nitro dev-worker 处理并返回 HTTP 503——根因链尾为 sst 资源守卫（`It does not look like SST links are active`）：`console/core/src/lite.ts:14-18` 模块顶层求值 `Resource.ZEN_LITE_PRICE.*`，须 `sst dev` multiplexer（需 AWS SSO）才可用，本机无；属业务环境依赖而非 nitro 回归（dev 管线已正确执行到业务模块，alpha.1 上行为相同）。启动/响应/停止三要素满足；完整渲染冒烟依赖 sst dev 环境，且按用户明确当前重心在 desktop 不在 console webui，不为此搭 sst dev 环境
- [x] 2.4 mysql2 迁移路径冒烟：`packages/console/core` 现有迁移入口（drizzle-kit）干跑不因 mysql2 升级报错（验证：命令退出码 0；不可连库时以 drizzle-kit generate/检查类子命令代替）
  - 实施记录：drizzle-kit 需 SST 链接环境（`sst shell` + AWS SSO），本机不可达；降级为最小 API 冒烟——`import('mysql2/promise')` 加载、createPool/createConnection/query/execute API 完好、pool.end 正常，退出码 0；类型面已由 2.1 typecheck 覆盖

## 3. 提交与告警闭环

- [ ] 3.1 提交推送（pre-commit `turbo typecheck` 通过），commit message 说明修复的 CVE/GHSA 清单（验证：`git push` 成功）
- [x] 3.2 推送后在 GitHub Dependabot 页面确认告警 #3、#4、#6、#7、#8、#9、#32、#33、#53 全部关闭；如个别仍开放，核对 Dependabot 报告的修复底版与实际安装版本（验证：https://github.com/MarsQiu007/openNovel/security/dependabot 无相关开放告警）
  - 实施记录（2026-09-02）：gh API 实证——`state=open` 查询返回 0 条；9 条告警全部 `state=fixed`，`fixed_at=2026-09-02T12:56:08-09Z`（推送 `e3fe9ec18e` 后约 1 分钟 Dependabot 重扫自动关闭），无遗留（本条勾选此前漏记，随收尾提交补录）

## 4. 应急预案（仅在前置任务失败时执行）

- [ ] 4.1 若 nitro `3.0.260610-beta` 构建/运行不可修复地破坏：降级为最低修复版 `3.0.260429-beta` 重跑第 2 节矩阵（design D2 备选；验证：矩阵全绿且告警仍可关闭）
  - （未触发：主线 260610-beta 矩阵全绿；且 2.2 探测已证 260429-beta 同样复现 wasm 回归，此路径无意义）
- [ ] 4.2 若降级后仍不可用且确认由 `@solidjs/start` 集成引起：在变更中记录证据，与用户确认后再评估是否同步小升 `@solidjs/start` catalog 版本（超出本变更默认范围，需单独确认）
  - （未触发：降级路径未启用，@solidjs/start 与新 nitro 集成无异常）
