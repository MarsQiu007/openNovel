# Tasks

## 1. 纯逻辑内核与字典

- [ ] 1.1 新增 `packages/desktop/src/main/tray-controller.ts`：隐藏窗口集合、`shouldHideOnClose()`（开关开启且未置 quitting 标志）、`hide()`/`restoreAll()`（恢复顺序=隐藏顺序）、菜单项模型（经注入取词函数）；零 Electron 依赖
- [ ] 1.2 新增 `packages/desktop/src/main/tray-controller.test.ts`：覆盖关闭判定真值表（开关×quitting）、重复 hide 幂等、restoreAll 清空集合与顺序、菜单项模型取词；`packages/desktop` 下 `bun test src/main/tray-controller.test.ts` 全绿
- [ ] 1.3 `packages/desktop/src/main/native-locale.ts` 字典新增 `tray.show`/`tray.quit` 两键（zh 源 + en/zht，按 design 文案键位表）；`native-locale.test.ts` 既有字典完整性测试自动覆盖，补 tray 键渲染断言
- [ ] 1.4 `packages/desktop/src/main/store-keys.ts` 增常量 `CLOSE_TO_TRAY_ENABLED_KEY = "closeToTrayEnabled"`；在 `tray-controller.ts` 增 `resolveCloseToTrayDefault(platform)` 纯函数（win32 → true，其余 → false）及单测

## 2. 主进程接线

- [ ] 2.1 `packages/desktop/src/main/window-registry.ts` 增 `isQuitting()` 读口；`windows.ts` 增 `isAppQuitting()` 出口；`window-registry` 既有测试补充该读口断言
- [ ] 2.2 `windows.ts` `registerWindow` 接入 close 拦截：开关开启且未置 quitting 标志时 `preventDefault()` + `win.hide()` 并登记 controller，否则放行；grep 穷举 main 进程 `win.close()` 调用点确认无内部程序化关闭被误吞，结果记入提交说明
- [ ] 2.3 `windows.ts` 实现 `restoreHiddenWindows()`：`restoreAll()` 取隐藏句柄逐个 `show()`+`focus()`；`getCloseToTrayEnabled()`/`setCloseToTrayEnabled()` 读写 store 并向全部窗口广播 `close-to-tray-enabled-changed`
- [ ] 2.4 新增 `packages/desktop/src/main/tray.ts`：Electron 壳（win32/linux），图标取 `resources/icons/icon.ico` / `32x32.png`，tooltip "OpenNovel"，右键菜单恰好「显示主窗口」「退出 OpenNovel」（构建经 `t()` 取词），左键点击调 `restoreHiddenWindows()`，「退出」走 `setAppQuitting()` + `app.quit()`；用 electron-store `onDidChange("language")` 订阅语言切换并重建菜单（store 封装未暴露则补透传），验证切换语言后新弹出菜单为对应语言
- [ ] 2.5 `index.ts` 接线：`whenReady` 后按平台创建/跳过托盘；新增 `app.on("activate")`——仅 macOS 且无窗口时 `restoreMainWindows()`；确认未新增 `window-all-closed` handler

## 3. IPC / preload / 设置界面

- [ ] 3.1 `ipc.ts` 注册 `get-close-to-tray-enabled` / `set-close-to-tray-enabled` handler（镜像 pinch zoom 模式）；`preload/index.ts` 与 `preload/types.ts` 增三件套（get/set/onChanged）
- [ ] 3.2 `settings-v2/general.tsx` 与 `settings-general.tsx` 各加关闭到托盘开关行，渲染条件为 `desktop()` 且 `os !== "macos"`（平台上下文取 os），复用同一 IPC 与 i18n 键
- [ ] 3.3 `packages/app/src/i18n/{en,zh,zht}.ts` 按键值增量新增 `settings.general.row.closeToTray.title` / `.description` 三语键（按 design 文案键位表，不动既有键）

## 4. 验证

- [ ] 4.1 `packages/desktop` 下 `bun typecheck` 通过，仓库根 oxlint 基线对比无新增告警
- [ ] 4.2 `packages/desktop` 下 `bun test` 全绿（含新增 controller/registry/locale/store 测试）
- [ ] 4.3 `packages/app` 下 `bun typecheck` 与相关单测通过（locale 键与设置行改动）
- [ ] 4.4 人工冒烟（用户执行）：Windows 开启状态下标题栏 X / Alt+F4 挂起到托盘、托盘左键恢复、托盘「退出 OpenNovel」真退出、设置开关切换即时生效、语言切英文后托盘菜单为英文；macOS 无托盘且 Dock 激活重建窗口
- [ ] 4.5 检查未引入同类/冗余/无用代码（新增长期无人引用的导出、死 import、未消费的通道），命中即在本 change 内清理

## Workflow follow-up

- 提交实现 commits（各带 `OpenSpec-Change: desktop-tray` trailer），收集进 Implementation Commits。
- 冒烟通过后运行 `openspec validate desktop-tray --strict`，随后 `npx openspec archive --yes desktop-tray` 归档并同步主 specs。
- 合并 main、推送并确认远端 generate / typecheck / test 全绿后删除功能分支。
