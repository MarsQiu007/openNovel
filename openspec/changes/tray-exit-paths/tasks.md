# Tasks

## 1. 托盘可用性状态与关闭判定

- [ ] 1.1 在 `tray-controller.ts` 增加 controller 私有的 `trayCreated` 状态与 `markTrayCreated()` 置位方法（幂等，构造签名不变），`shouldHideOnClose()` 并入托盘可用性条件。验证方式：`tray-controller.test.ts` 新增用例覆盖「markTrayCreated 前后 × 挂起开关 × quitting」组合（重点：未创建时开关开启仍不挂起；创建后恢复既有行为），既有用例不改断言全部保持绿，从 `packages/desktop` 运行 bun test
- [ ] 1.2 在 `windows.ts` 导出 `trayController` 实例（`trayMenuItems()` 已有同向导出先例），`tray.ts` 在 `new Tray(image)` 成功后调用 `trayController.markTrayCreated()`（`image.isEmpty()` 提前返回分支不置位）。验证方式：`packages/desktop` bun test 全绿；grep 确认无新增反向 import（`windows.ts` 未 import `tray.ts` 新符号，无模块循环）

## 2. 打包资源分发

- [ ] 2.1 在 `electron-builder.config.ts` 的 `getBase` 配置 `extraResources` 将 `resources/icons` 分发为 `resourcesPath/icons`。验证方式：本地 `bun run package:win` 产出 dist，`dist/win-unpacked/resources/icons` 包含 `icon.ico` 与 `dock.png`
- [ ] 2.2 打包产物托盘冒烟：本地安装 dist 产物，启动后托盘图标可见、tooltip 为 OpenNovel，右键菜单恰含「显示主窗口」「设置」「退出 OpenNovel」，三项功能与真退出均正常。验证方式：本机冒烟记录写入本文件 Verification 段

## 3. 兜底行为与关联面

- [ ] 3.1 兜底形态实测：对 dist 产物临时移除 `resources/icons` 后启动，点击关闭按钮应走真退出（进程退出、无隐藏窗口残留），且更新就绪时退出确认拦截照常弹出。验证方式：本机实测记录写入 Verification 段；托盘不可用不挂起的行为分支由 1.1 单测保障
- [ ] 3.2 关联面核查：`tray-controller` 既有单测全绿；`updater-install-prompt` 退出确认拦截相关单测全绿（确认 D3 零新增分支的判断成立）。验证方式：从 `packages/desktop` 运行相关 bun test
- [ ] 3.3 穷举关闭判定消费方：grep `shouldHideOnClose`、`closeToTrayEnabled`、`getCloseToTrayEnabled`、`set-close-to-tray-enabled`、`trayController` 的全部调用点（已预核：controller 消费全在 windows.ts，开关 IPC 在 ipc.ts，设置页 UI 在 packages/app settings-general），确认语义变更（挂起前提收紧）未破坏设置页开关读写与 renderer 侧展示。验证方式：关联面清单写入 Verification 段，`packages/app` 相关测试通过

## 4. 收尾检查

- [ ] 4.1 `packages/desktop` 通过 `bun typecheck`，从仓库根以同模式运行 oxlint 对比基线无新增告警。验证方式：命令退出码为 0
- [ ] 4.2 自查同类/冗余/无用代码：`markTrayCreated` 与 `trayAvailable` 唯一实现且全部被消费，未引入只服务死代码的导出。验证方式：grep 关联引用确认唯一实现且全部被消费

## Verification 记录

（实现过程中填写）

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: tray-exit-paths" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate tray-exit-paths --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支
- 下一次 release 打包后，将「托盘图标可见 + 托盘菜单退出」纳入发布冒烟清单
- 本 change 落地后，`updater-install-prompt` tasks 1.1 被阻断的「用户正常退出」形态验证具备条件，可按其 Verification 记录补验
