# Proposal: updater-install-prompt

## Why

桌面端更新包后台下载完成后，用户关闭进程即触发静默安装（`autoInstallOnAppQuit`）：安装期间没有任何可见反馈，用户立刻再双击图标无法启动、却收不到任何解释，误以为程序损坏。更严重的是，若用户在安装器运行期间直接关机/注销，Windows 会强杀 detached 的 NSIS 安装器进程，可能把应用留在不可恢复状态（旧文件已删、新文件未就位，[electron-builder#7807](https://github.com/electron-userland/electron-builder/issues/7807)），而下次启动时没有任何提示或补救引导。

## What Changes

- 关闭退出即静默安装：updater 为 `ready` 时用户退出 app，main 进程在退出流程中弹出原生确认框（立即重启安装 / 稍后）。安装只发生在用户明确确认之后，"稍后"则保留已下载的更新包并在下次启动时重新进入就绪流程。
- 启动时未决更新提示：启动检查发现本地持久化的目标版本与当前版本不一致（用户上次选择"稍后"，或上次安装被打断）时，更新就绪后向用户推送全局提示，引导一键重启更新，不再静默无闻。
- 范围裁剪（2026-11-19）：原计划的 Phase 2（跟随上游切换 `autoInstallEvent: "onNextLaunch"`、依赖升级与启动期安装反馈）经用户确认整体移除——Phase 1 的「退出确认拦截 + 启动未决提示」已满足当前需求，不再等待上游 7.x stable 发布。调研结论（5.1，上游 API 形态与排期）保留在 design.md Open Questions，未来如需启动期自动安装另立提案。

## Capabilities

### New Capabilities

（无——本变更全部落在既有 `auto-update` 能力的语义调整上）

### Modified Capabilities

- `auto-update`: 「退出时自动安装已下载的更新」语义变更为「退出时询问确认后安装，'稍后'保留更新至下次启动」；新增「启动时未决更新可见性」需求（含被打断更新的再引导）。

## Impact

- **packages/desktop**：main 进程 updater 装配（`autoInstallOnAppQuit` 关闭）、退出流程拦截（before-quit 确认框）、启动期未决更新信号推送；保持 electron-updater 6.8.9 依赖不变。
- **packages/app**：更新就绪后的全局提示（Toast/Banner），复用现有 `DialogUpdaterConfirm` 与 titlebar 圆点交互，不改变其既有行为。
- **依赖**：无变更（Phase 2 升级已裁剪；Phase 1 实测 6.8.9 flag 行为符合预期）。
- **无协议/SDK 变更**（不涉及 packages/protocol、packages/schema，无需再生成 SDK）。
- **本地数据兼容**：复用现有 updater `ready` 持久化记录（`{ version }`），无迁移、无新增存储形态；既有持久化记录在新语义下自然生效（版本不匹配即视为未决更新）。
- **非目标**：
  - 不改变自动下载、定时检查（每 10 分钟）、启动时检查开关的既有行为；
  - 不改动 titlebar 圆点与设置页更新按钮的既有交互；
  - 不做原生对话框的 i18n 本地化（main 进程对话框沿用现有英文硬编码惯例，本地化单独立项）；
  - 不做"稍后 N 小时后再次提醒"的静默期调度；
  - 不做启动期自动安装（`onNextLaunch`）：安装始终经用户确认后立即执行，本次提案不跟随上游 API 演进；
  - 不覆盖 per-machine（UAC 提权）安装形态的自动安装路径——若未来打包形态变化需另行设计。
