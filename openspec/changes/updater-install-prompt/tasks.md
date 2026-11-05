# Tasks

## 1. 前置验证：6.8.9 上 flag 行为实测

- [ ] 1.1 实测 `autoInstallOnAppQuit = false` 在 electron-updater 6.8.9 下是否被尊重：构造本地更新源（发布一个高版本到本地静态服务），安装低版本后走「下载完成 → 正常退出」链路，观察退出时是否静默触发安装。验证方式：退出后进程列表与安装目录时间戳无变化即为通过；若 flag 失效，将依赖升级任务（第 5 组）提前并在此记录结论
- [x] 1.2 实测 updater 为 `ready` 时正常退出是否触发 `before-quit`，以及 `event.preventDefault()` 能否取消退出（为退出拦截提供依据）。验证方式：打日志确认事件时序与取消行为符合预期

## 2. 退出确认拦截（Phase 1 核心）

- [x] 2.1 装配层关闭 `autoInstallOnAppQuit`，并在 updater 模块暴露「本次退出是否由 updater 发起」的判定（复用现有 quit 标志模式），供退出拦截区分用户退出与安装退出。验证方式：`updater-controller` 相关单测覆盖两种退出来源的判定
- [x] 2.2 在退出流程中实现确认拦截：updater 为 `ready` 且用户正常退出时取消本次退出，弹出原生确认框（含版本号、「立即重启」「稍后」）；「立即重启」走既有 `controller.install()`，「稍后」放行退出。验证方式：新增单测覆盖 ready/非 ready/updater 发起退出/更新禁用四种分支；Windows 手动冒烟确认弹窗出现时序
- [ ] 2.3 确认关机与注销路径（`session-end`）不弹框、不阻塞系统退出，未决记录保留。验证方式：单测覆盖 session-end 分支；Windows 手动冒烟关机路径
- [x] 2.4 穷举关联面：检查 `showUpdaterDialog`（菜单「检查更新」入口）、设置页按钮、`DialogUpdaterConfirm`（titlebar 圆点）在退出语义变更后的行为一致性，更新受影响的测试。验证方式：`packages/desktop` 与 `packages/app` 相关测试全部通过

## 3. 启动时未决更新提示（Phase 1）

- [x] 3.1 main 进程在启动早期读取持久化记录，把「存在未决更新」作为一次性信号随 updater 状态推送给 renderer（不改变 `UpdaterState` 词汇与持久化格式）。验证方式：单测覆盖「有未决记录 / 无记录 / 版本一致」三种启动分支
- [x] 3.2 app 侧实现全局 Toast：仅当「本次启动恢复了未决更新且状态回到 ready」时提示「vX 已就绪，点击重启更新」，点击走既有 `platform.updater.install()`。验证方式：`updater-action` 层单测覆盖触发条件（含定时检查回到 ready 时不打扰的反向用例）；中英文案补入 `en/zh/zht` 三个 i18n 字典
- [ ] 3.3 验证未决记录恢复链路：版本不匹配 → 重新检查 → 同版本缓存命中 → ready → Toast。验证方式：本地更新源走通「下载 → 退出选稍后 → 再启动」完整链路，观察 Toast 出现

## 4. Phase 1 收尾检查

- [x] 4.1 在 `packages/desktop` 与 `packages/app` 分别通过 `bun typecheck`，从仓库根以同模式运行 oxlint 对比基线无新增告警。验证方式：命令退出码为 0
- [x] 4.2 自查同类/冗余/无用代码：退出拦截新增的标志位与信号通道无第二处重复实现，未引入只服务死代码的导出。验证方式：grep 关联引用确认唯一实现且全部被消费

## 5. 依赖升级调研与启动期安装（Phase 2）

- [x] 5.1 调研并记录：带 `autoInstallEvent` 的最低稳定 electron-updater 版本号、上游 v26/v27/v28 排期、`installPendingUpdateIfAvailable()` 在 per-user NSIS 下的生命周期（阻塞点、与主窗口创建的先后）。验证方式：调研结论写入 design.md 的 Open Questions 回复或本 change 的附录记录
- [ ] 5.2 升级 electron-updater 至调研确定的稳定版本，装配 `autoInstallEvent = "onNextLaunch"`，移除 Phase 1 的 defer 兜底中对终态不再成立的假设。验证方式：`packages/desktop` 测试通过；升级后「立即重启」+ onNextLaunch 组合行为实测（对应 design 决策 D4）
- [ ] 5.3 实现启动期安装反馈：安装执行前创建轻量 splash 窗口显示「正在完成更新 vX…」，不进主窗口恢复流程，随旧进程退出。验证方式：本地更新源走通「稍后退出 → 下次启动自动安装 → 新版本拉起」链路并观察到 splash
- [ ] 5.4 验证待安装更新的清理与重试分支：缓存安装包校验失败 / 远端撤销版本 / 安装被关机中断后重启，三种分支均回到可控状态（清理记录恢复常规检查，或自动重试）。验证方式：本地更新源构造三种场景逐项走通
- [ ] 5.5 beta channel 发布验证完整更新链路（下载 → 退出确认 → 启动安装 → 版本切换），回归 macOS「立即重启」与「稍后→下次启动」两条路径。验证方式：beta 用户（或内部账号）完成至少一轮真实更新并确认版本号切换

## Verification 记录

- **1.1（未勾选，物理链路待验）**：静态核查已过——6.8.9 `BaseUpdater.addQuitHandler()` 在 flag 为 false 时提前返回，quit handler 根本不注册，#3330 的失效形态不适用。物理安装链验证随 3.3 / 5.5 一并安排。
- **1.2（已勾选）**：真实 Windows 机器 Electron 探针验证——末窗关闭触发 `before-quit` → `preventDefault()` 取消退出（应用存活、事件循环正常）→ 延迟 `app.quit()` 重入 `before-quit` → 正常走完 `will-quit` 退出。注意探针曾误用不存在的 `app.isQuitting()` API 造成假死假象，已排除。
- **2.3（未勾选，关机冒烟待做）**：无独立代码分支可单测——退出确认拦截只挂在 `before-quit`，Windows 关机/注销走 `session-end` 时 `before-quit` 不触发（仓库 windows.ts 注释已载明此 Electron 行为），弹框无入口；同时 `autoInstallOnAppQuit = false` 保证 updater 侧 quit handler 不存在，关机路径绝不静默安装。结构性安全成立，待打包版手动冒烟补实测。
- **3.3（未勾选）**：本地更新源全链路走查（下载 → 退出选稍后 → 再启动见 Toast）需打包产物，随 beta 验证进行。
- **自动化验证快照（2026-11-05）**：`packages/desktop` bun test 108 pass；`packages/app`（bun 1.3.14）i18n parity + updater-action 9 pass；两包 `bun typecheck` 干净；oxlint 变更文件集同模式对比基线 11=11 无新增；新增符号 grep 审计唯一实现且全部被消费。
- **5.2–5.5（未勾选，阻塞）**：上游尚无带 `autoInstallEvent` 的稳定版本（仅 7.0.0-alpha.x），触发条件为 7.x 首个 stable 发布，结论已写入 design.md Open Questions。本 change 暂不归档。

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: updater-install-prompt" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate updater-install-prompt --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支
