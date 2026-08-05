---
kind: frontend_style
name: 前端样式系统：Tailwind CSS + Solid UI 组件库与主题体系
category: frontend_style
scope:
    - '**'
source_files:
    - packages/ui/package.json
    - packages/ui/src/styles/index.css
    - packages/ui/src/theme/index.ts
    - packages/app/package.json
    - packages/web/package.json
    - packages/tui/package.json
    - package.json
---

该 monorepo 的前端样式系统围绕 Tailwind CSS v4 和基于 Solid.js 的自研 @opencode-ai/ui 组件库构建，采用分层 CSS Architecture 和可插拔主题机制。

**系统与工具栈**
- 样式框架：Tailwind CSS v4（通过 @tailwindcss/vite 集成），配合 tw-animate-css 提供动画能力
- 组件库：@opencode-ai/ui（packages/ui）作为核心 UI 包，暴露 ./styles、./theme、./components/* 等导出
- 运行时：Vite 作为构建工具，Solid.js 作为视图层框架
- 桌面应用：Electron + Vite（packages/app、packages/desktop）
- 文档站点：Astro + Starlight（packages/web）
- TUI 终端：OpenTui + Solid（packages/tui）

**CSS 架构设计**
packages/ui/src/styles/index.css 定义了清晰的 @layer 分层：
- theme 层：colors.css、theme.css（颜色与主题变量）
- base 层：base.css、katex.min.css（基础样式）
- components 层：每个组件独立的 .css 文件（accordion、button、dialog、toast 等）
- utilities 层：utilities.css、animations.css（工具类与动画）

**主题系统**
- 支持多套内置主题：oc2Theme、catppuccin、dracula、oneDark、github、material 等 30+ 种配色方案
- 主题类型定义在 src/theme/types.ts，包含 DesktopTheme、ThemePaletteColors、OklchColor 等
- 提供主题解析器：resolveTheme、resolveThemeVariant、themeToCss
- V2 主题系统：generateV2Primitives、themeV2ToCss 支持新一代主题格式
- 运行时主题加载：applyTheme、loadThemeFromUrl、getActiveTheme、removeTheme
- TUI 端使用 JSON 格式的 opencode.ai/theme.json schema 定义主题（packages/tui/src/theme/assets/*.json）

**组件样式约定**
- 每个 UI 组件对应独立 CSS 文件，遵循命名规范（如 button.css、dialog.css）
- 使用 CSS Layers 组织样式优先级，避免冲突
- 图标系统：sprite.svg 生成 app-icons、file-icons、provider-icons
- 字体与音频资源通过 package.json files 字段发布

**依赖与约束**
- peerDependencies 要求 solid-js ^1.9.0 和 @solidjs/meta ^0.29.0
- 通过 catalog 统一管理依赖版本（Bun workspaces）
- sideEffects 标记所有 *.css 文件确保样式正确打包
- Storybook 用于组件开发与预览（packages/storybook）