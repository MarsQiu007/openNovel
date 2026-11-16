# Spec Delta

## Purpose

定义 openNovel 品牌视觉标识的呈现行为：产品图标、启动图形、词标与分享图在 Web、桌面、PWA 各触点一致呈现「方框藏书」新品牌（而非上游 openCode 方框），并保证全部派生资产可由仓库内脚本从 master 一键再生成。

## ADDED Requirements

### Requirement: 品牌 master 标识图形
系统 SHALL 提供 openNovel 品牌 master 图标：白色方环（外方 128..384、内孔 192..320 的 512 画布几何）内孔中呈现一本白色立书，书体含深色书脊豁口、双书口线与尖尾书签；图形为单色扁平风格，并提供深色底与透明底反色两个版本，16px 缩放下方环与书形仍保持可辨识。

#### Scenario: 深色底 master 呈现
- **WHEN** 用户在深色背景场景查看品牌图标（如桌面应用图标、浏览器标签页）
- **THEN** 呈现近黑底、白色方环、孔内白色立书带深色书脊与书口线细节的 master 图形

#### Scenario: 浅色底反色版呈现
- **WHEN** 用户在浅色背景场景查看品牌图标（如打印材料、浅色主题界面）
- **THEN** 呈现透明底、深色方环与深色书体、书脊豁口等负形为白色的反色版图形

### Requirement: Web favicon 家族
Web 应用 SHALL 在全部 favicon 入口呈现新品牌图标：标签页 SVG 图标、shortcut icon（ICO）、96px PNG、apple-touch-icon（180px）以及 PWA manifest 的 192/512 maskable 图标，且 v3 命名系与非 v3 命名系两组产物同步更新。

#### Scenario: 浏览器标签页加载
- **WHEN** 用户在浏览器打开 openNovel Web 应用
- **THEN** 标签页展示的 SVG favicon 与收藏夹 ICO 均为「方框藏书」图形，不再是 opencode 方框

#### Scenario: PWA 安装
- **WHEN** 用户将 Web 应用安装到主屏或 Dock
- **THEN** 启动图标（manifest 声明的 192 与 512 maskable 图标）呈现新品牌图形，且 maskable 安全区内图形完整不被裁切

### Requirement: 界面内联品牌标识
应用界面 SHALL 在三处内联位置呈现新品牌标识：启动/加载时的 Splash 图形为页顶向书脊下倾的摊开书形；新建会话视图的小标为方框藏书图形；首页与错误页背景淡印块状像素风「OPENNOVEL」九字母词标（不再有 "OPENCODE" 字母残留），词标颜色随主题 token 切换。

#### Scenario: 应用加载
- **WHEN** 用户启动应用且界面尚未就绪
- **THEN** 加载屏呈现摊开书形 Splash 动画图形

#### Scenario: 新建会话视图
- **WHEN** 用户进入新建会话页面
- **THEN** 页面头部呈现方框藏书小标

#### Scenario: 首页与错误页背景
- **WHEN** 用户访问首页或应用进入错误页
- **THEN** 背景以低不透明度呈现块状「OPENNOVEL」词标，且深浅主题下文案颜色均保持可见对比

### Requirement: 桌面应用图标与渠道变体
桌面应用 SHALL 在各系统触点呈现新品牌图标：窗口图标、macOS Dock 图标、安装器图标、Windows 安装与卸载入口图标、系统托盘图标（16-32px 级小尺寸仍清晰）；dev 渠道以蓝图蓝底加浅色网格区分，beta 与 prod 渠道为深色底仅图形换新。

#### Scenario: dev 渠道启动
- **WHEN** 用户启动 dev 渠道构建
- **THEN** 任务栏/Dock 呈现蓝图蓝底、白色方框藏书图形；窗口与托盘图标同为该渠道变体

#### Scenario: prod 打包安装
- **WHEN** 用户安装 prod 渠道安装包
- **THEN** 安装器、开始菜单/应用程序文件夹与卸载入口图标均为深色底新品牌图形

#### Scenario: 托盘小图标辨识度
- **WHEN** 应用最小化到系统托盘（Windows/Linux 32px、macOS 模板小图标）
- **THEN** 托盘图标呈现方框藏书图形且方环与书形可辨

### Requirement: 社交分享图
Web 应用的 og:image 与 twitter:image SHALL 呈现 openNovel 品牌分享图，不含 openCode 品牌元素（方框图形、OPENCODE 词标、上游配色）。

#### Scenario: 链接分享预览
- **WHEN** 用户在支持 Open Graph 的平台粘贴 openNovel 链接
- **THEN** 预览卡片展示 openNovel 品牌分享图

### Requirement: 品牌资产脚本化再生成
全部派生资产（favicon 两系各尺寸、identity 各尺寸 PNG、桌面三渠道全部尺寸、分享图底图）SHALL 由仓库内单一入口脚本从 master SVG 一键再生成；除运行该脚本外不需要外部服务、手工图像工具或已移除的第三方图标生成器。

#### Scenario: 修改 master 后再生成
- **WHEN** 维护者修改 master SVG 后运行再生成脚本
- **THEN** 全部派生图标与 PNG 产物更新为新图形，且产物清单与脚本声明一致（无遗漏、无多余）

#### Scenario: 新环境首次再生成
- **WHEN** 维护者在干净检出环境运行再生成脚本
- **THEN** 仅依赖仓库已声明的依赖即可完成，不提示安装额外工具
