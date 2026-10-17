# desktop-titlebar-menus Specification

## Purpose
定义桌面端 titlebar 应用菜单入口的呈现约定：Windows / Linux 不再渲染 openCode 遗留的应用下拉菜单入口，相关能力由系统级通道承载；macOS 保留系统原生应用菜单，保证各平台桌面体验符合各自惯例。

## Requirements

### Requirement: Windows/Linux 不渲染应用菜单入口

Windows 与 Linux 桌面端的 titlebar SHALL NOT 渲染应用下拉菜单入口（File / Edit / View / Go / Window / Help 等任何形式的汉堡菜单按钮及其下拉面板）。titlebar 左侧导航区域 SHALL 仅保留 novel 原生的首页入口、书架入口与书籍标签栏。浏览器（非桌面壳）在 Windows / Linux 上访问时 SHALL 同样不渲染该菜单入口。

#### Scenario: 桌面端 titlebar 无菜单按钮

- **WHEN** 用户在 Windows 或 Linux 桌面端启动应用并查看 titlebar
- **THEN** titlebar 中不存在任何应用菜单按钮，也不出现 File / Edit / View 等下拉菜单内容

#### Scenario: 浏览器访问不渲染菜单入口

- **WHEN** 用户在 Windows 或 Linux 的浏览器中直接访问应用
- **THEN** titlebar 中同样不存在应用菜单按钮

### Requirement: 编辑与剪贴板能力不依赖菜单

应用菜单入口移除 SHALL NOT 影响文本编辑与剪贴板操作的可用性：在可编辑元素（输入框、文本域、内容编辑区域）内，撤销、重做、剪切、复制、粘贴、全选的键盘快捷键 SHALL 保持可用；指向可编辑内容的右键上下文菜单 SHALL 提供剪切、复制、粘贴等编辑项。

#### Scenario: 快捷键编辑生效

- **WHEN** 焦点位于任意输入框且存在可撤销的输入
- **THEN** 按下撤销快捷键后输入被撤销，按下粘贴快捷键后剪贴板内容写入输入框

#### Scenario: 右键编辑菜单可用

- **WHEN** 用户右键点击包含选中文字的输入框
- **THEN** 上下文菜单中出现复制、剪切、粘贴等编辑项且可正常执行

### Requirement: 视图与窗口控制不依赖菜单

应用菜单入口移除 SHALL NOT 影响视图与窗口控制能力的可用性：页面缩放（滚轮/触控板手势）、全屏切换、窗口最小化、最大化/还原、关闭 SHALL 通过系统级通道（默认快捷键、手势、titlebar 窗口控制按钮）保持可用，MUST NOT 依赖应用内菜单组件。macOS 桌面端 SHALL 保留系统原生应用菜单，提供窗口角色操作（关闭、最小化、隐藏、退出）与系统集成的编辑角色菜单。

#### Scenario: 缩放与全屏保持可用

- **WHEN** 用户在 Windows 或 Linux 桌面端滚动 Ctrl+滚轮或按下 F11 全屏快捷键
- **THEN** 页面缩放与全屏状态按预期切换，无需打开任何应用菜单

#### Scenario: macOS 原生菜单保留

- **WHEN** 用户在 macOS 桌面端查看系统菜单栏
- **THEN** 应用提供原生应用菜单（含编辑角色项与窗口角色项），且退出、关闭窗口、最小化等角色快捷键可用
