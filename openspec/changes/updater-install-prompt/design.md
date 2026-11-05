# Design: updater-install-prompt

## Context

见 proposal.md - Why。补充实现现状（动手前需再核对）：

- 桌面端通过 `packages/desktop/src/main/updater.ts` 装配 electron-updater（当前锁定 6.8.9），`autoInstallOnAppQuit = true` 是「退出即静默安装」的直接来源；`quitAndInstall()` 经 `createUpdaterController` 包装，失败时回滚 `setAppQuitting(false)`。
- updater `ready` 状态持久化为 `{ version }` 记录；`start()` 仅在记录版本与当前版本一致时清除——「版本不匹配」天然就是「未决更新」信号，本设计复用该结构，不新增存储形态。
- 退出流程：`before-quit` 中 `setAppQuitting()` + `stopSidecars()`；`requestSingleInstanceLock()` 在安装期间无法阻止新进程启动失败（文件被安装器锁定）。
- 就绪态的现有 UI 面：titlebar 圆点（点击弹 `DialogUpdaterConfirm`）、设置页按钮。均未覆盖「退出时」与「启动时」两个时机。
- 上游背景：[#7807](https://github.com/electron-userland/electron-builder/issues/7807)（关机强杀 detached NSIS 安装器导致不可恢复）的官方解法是 `autoInstallEvent: "onNextLaunch"`（v27 文档线已提供，计划 v28 设为默认）；6.8.9 无此 API。

## Goals / Non-Goals

**Goals**：安装动作只发生在「用户明确确认」或「下次启动的可控流程」中；这两个时机都有可见反馈；待安装状态可校验、可重试、可清理。

**Non-Goals**（设计层面）：不做渲染层退出弹窗（退出时 renderer 可能已在卸载，不可靠）；不在退出流程中做网络请求（确认框只基于本地 `ready` 状态）；不阻塞系统关机（Windows `session-end` 路径绝不弹框）；不改 updater 状态机的对外词汇（`UpdaterState` 各状态的含义与持久化格式不变）。

## Decisions

### D1：关闭退出静默安装，退出拦截用 main 进程原生确认框

- 装配时置 `autoInstallOnAppQuit = false`。updater 为 `ready` 且用户正常退出时，在 `before-quit` 中 `preventDefault()` 取消本次退出，弹出原生 `dialog.showMessageBox`（含版本号，「立即重启」「稍后」）。「立即重启」走现有 `controller.install()`（`stop()` → `quitAndInstall()`）；「稍后」放行退出。
- 必须区分「updater 自己触发的退出」与「用户退出」：仅后者弹框。复用现有 quit 标志模式（对照 `setAppQuitting`/`installing` 状态），updater 发起的退出路径置标志后跳过确认框。
- 关机/注销路径（`session-end`）不弹框、不阻塞系统：直接放行退出，`autoInstallOnAppQuit = false` 保证此时绝不静默安装，未决记录留给下次启动处理。
- **选原生对话框而非 `DialogUpdaterConfirm`**：退出流程中 `quitAndInstall` 会先关闭所有窗口再发 `before-quit`，renderer 弹窗时机不可靠；且 `showUpdaterDialog` 已有原生对话框先例。代价是文案英文硬编码（与现状一致，i18n 另立项）。

### D2：「稍后」= 保留持久化记录，不做静默期调度

- 用户选「稍后」时不清理 `{ version }` 记录；下次启动 `start()` 检测到版本不匹配 → 重新检查 → electron-updater 对同版本缓存命中 → 快速回到 `ready` → 推全局 Toast「vX 已就绪，点击重启更新」（复用 app 侧 toast 体系，设置页按钮语义不变）。
- main 进程在启动早期把「存在未决记录」作为一次性信号随 updater 状态推给 renderer，renderer 仅在「本次启动恢复了未决更新且回到 ready」时推 Toast——避免每次定时检查回到 ready 都打扰用户。
- **替代方案**：defer 时清记录 → 丢失「上次被打断」的可视性，拒绝；「N 小时后再次提醒」调度 → 提案非目标。

### D3：跟随上游切换 `autoInstallEvent: "onNextLaunch"`，不自管 lock 文件

- Phase 2 升级 electron-updater 至含该 API 的最低稳定版本，装配 `autoInstallEvent = "onNextLaunch"`。此后「稍后」退出的语义变为：退出仅写 pending 标记；下次启动时 updater 重新校验缓存安装包（hash 对账远端元数据）后**在启动流程中**执行安装，`autoRunAppAfterInstall` 拉起新版本——待安装更新被关机中断后，下次启动可自动重试，从机制上消除 #7807 的不可恢复类。
- 当前发行形态为 per-user oneClick NSIS（`perMachine: false`，无 UAC），属于文档承诺「启动期自动安装」覆盖的形态。
- 启动期反馈：安装执行前创建轻量 splash 窗口（独立小 `BrowserWindow`，不进主窗口恢复流程），显示「正在完成更新 vX…」；安装完成、新进程接管后 splash 随旧进程退出。
- **替代方案**：留在 6.8.9 用自管 lock 文件模拟 onNextLaunch → 拒绝：需自行实现标记管理、安装包校验、重试语义，上游已标准化且计划设为默认，重复造轮子且维护面更大。

### D4：「立即重启」在 onNextLaunch 下仍是即时安装

- 确认框「立即重启」始终走显式 `quitAndInstall()`，与 `autoInstallEvent` 无关（升级后需实测该组合行为，见 Risks）。
- spec「启动时待安装更新的处理」描述的是 Phase 2 完成后的终态语义；Phase 1（6.8.9 期间）由 D2 的 Toast 路径兜底，实现时注意两个阶段提示文案的差异，不残留 Phase 1 的过期假设。

## Risks / Trade-offs

- `autoInstallOnAppQuit = false` 在个别版本不被尊重（[#3330](https://github.com/electron-userland/electron-builder/issues/3330)）→ Phase 1 第一个任务即在 6.8.9 上实测该 flag；若失效，依赖升级从 Phase 2 提前为 Phase 1 前置。
- 升级 electron-updater 至 v7 线若为 alpha/预发布 → 固定到带 `autoInstallEvent` 的最低**稳定**版本；先在 beta channel 发布验证更新链路，再随 stable 通道放量。
- `installPendingUpdateIfAvailable()` 的实际阻塞行为（是否需要在主窗口创建前调用、splash 挂载点）在升级后需以源码与实测确认 → 列为 Phase 2 调研任务，不改变本设计的方向。
- macOS Squirrel.Mac 与 Windows NSIS 的退出安装机制不同（mac 由系统托管，无 detached 安装器被强杀问题）→ 退出确认框全平台统一生效；启动期自动安装的收益与验证重点在 Windows，mac 回归验证「立即重启」与「稍后→下次启动」两条路径即可。
- 行为回退风险：退出不再自动安装后，长期不重启的用户可能停留在旧版本 → 缓解：「稍后」后下次启动的 Toast 引导 + titlebar 圆点持续可见。

## Migration Plan

1. Phase 1：行为变更 + 提示接入，随常规发版；持久化结构不变，旧版本写入的 `{ version }` 记录在新版本下自然生效（不匹配即视为未决）。
2. Phase 2：依赖升级随发版；beta channel 先行验证完整更新链路（下载→退出确认→启动安装→版本切换），稳定后随 stable 通道放量。
3. 回滚：恢复 `autoInstallOnAppQuit = true` 并移除退出拦截即可回到旧语义；Phase 2 回滚即降级依赖版本，无数据迁移。

## Open Questions

- ~~带 `autoInstallEvent` 的最低稳定版本号与发布时间（上游 v26/v27/v28 排期），由 Phase 2 调研任务回答。~~
  **已回答（2026-11-05，5.1 调研）**：截至当日上游**不存在**任何带 `autoInstallEvent` 的稳定版本——latest 为 6.8.11，v26 线 tag 6.8.12，均不含该 API；仅 7.0.0-alpha.x（核到 alpha.13）提供 `autoInstallEvent: "onQuit" | "onNextLaunch" | "manual"` 与 `installPendingUpdateIfAvailable(): Promise<boolean>`、`cancelQuitOnInstallFailure`。排期信号：`autoInstallOnAppQuit` 在 v7 线标记 deprecated（v27 兼容垫片），计划 v28 删除并默认 `onNextLaunch`。因此 5.2 阻塞，触发条件为「7.x 首个 stable 发布」。
- `installPendingUpdateIfAvailable()` 在 per-user NSIS 下的精确生命周期（阻塞点、与 splash 的配合），升级后调研确认。
  **部分回答（源码与 .d.ts 文档级，2026-11-05）**：启动期自动安装仅覆盖无提权目标（per-user NSIS、AppImage），macOS（Squirrel.Mac）恒返回 `false`；调用会拿缓存安装包与远端最新元数据做 hash 对账，校验失败自动清理无效 pending 状态并返回 `false`。精确阻塞点与 splash 挂载仍需升级后实测（保留为 Phase 2 任务，不改变设计方向）。
