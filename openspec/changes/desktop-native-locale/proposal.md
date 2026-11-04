# Proposal: desktop-native-locale

## Why

产品文案铁律已沉淀（openspec/config.yaml）：用户可见文案默认简体中文，经全局语言配置可切英文/繁体（zh/en/zht）。桌面端 renderer 的三语 locale 与全局语言设置（持久化在 `opennovel.global.dat` 的 `language` 键）早已存在，但 Electron 主进程的全部原生 UI 文案仍是硬编码英文——更新对话框、窗口卡死恢复对话框、文件选择器默认标题、附件错误消息。主进程读不到全局语言设置，违反文案铁律；同时桌面 renderer 的 `detectLocale()` 在系统语言探测不到时兜底为英文，与"默认中文"相悖。

## What Changes

- 主进程新增原生文案 locale 模块：从 `opennovel.global.dat` 的 `language` 键解析当前语言（支持裸字符串与 `{locale}` 两种既有形状），非法或缺失时兜底简体中文；提供三语字典（zh 为源文案，含 en/zht）与同步取词接口。
- 以下主进程原生文案全部接入字典，不再硬编码英文：
  - 自动更新三处对话框（检查失败、已是最新、更新已下载询问重启）及其按钮；
  - 窗口恢复/卡死对话框的消息、标题与按钮（恢复对话框的按钮判定从"按英文标签字符串比对"改为按响应序号判定，否则换语言后失效）；
  - 文件/目录选择器与保存对话框的默认标题、文件类型过滤器显示名；
  - 附件选择的两条用户可见错误消息（超出 20MB 上限、未授权读取）。
- 桌面 renderer `detectLocale()` 兜底由英文改为简体中文（保留系统语言探测逻辑，英文系统仍开英文界面）。
- 语言切换即时生效：设置变更后下一次主进程原生 UI 显示即使用新语言，无需重启。

## Capabilities

### New Capabilities

- `desktop-native-locale`: Electron 主进程原生 UI 文案按全局语言设置渲染（简体中文默认，可切英文/繁体中文），覆盖原生对话框、文件选择器与主进程抛出的用户可见错误消息。

### Modified Capabilities

（无——既有 desktop-* 能力均不涉及原生文案语言行为。）

## Impact

- **packages/desktop**：新增主进程 locale 模块与单测；修改 `src/main/updater.ts`、`src/main/windows.ts`、`src/main/ipc.ts`、`src/main/attachment-picker.ts`、`src/renderer/i18n/index.ts`。
- **行为变更（有意）**：系统语言无法探测（如极简 Linux 环境）时，桌面界面从英文变为简体中文；主进程原生对话框从英文变为跟随全局语言（默认中文）。既有全局语言设置数据格式不变，无本地数据迁移。
- 非目标：托盘功能（后续 `desktop-tray` change）；菜单栏标签本地化（`desktop-menu.ts` 英文标签暂保留）；renderer 既有 locale 字典内容重写；诊断性详情文本（`Window:` / `URL:` / `Error:` 等日志式字段）保持 ASCII 英文；`show-notification` 通道（文案由 renderer 提供，已随 renderer locale）。
- 不涉及公开 Protocol / Server HttpApi，无需 SDK 再生成。
