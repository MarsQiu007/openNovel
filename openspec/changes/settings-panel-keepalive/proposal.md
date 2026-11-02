# Proposal: settings-panel-keepalive

## Why

设定中心点击树节点时，中央区按节点 kind 条件渲染（`settings-main.tsx` 的并列 `<Show>`）：跨类别切换时旧面板卸载、新面板全新挂载，已看过的面板再点回去也重新挂载。e2e 探针实测（settings-tree-visual-hierarchy 诊断遗留）：布局/树/导航 DOM 节点全部保持身份，但条目切换时中央区出现空白帧，且每次跨类别切换都有完整的卸载-重建过程。中央区占屏大半，整块替换的体感就是「全屏刷新」——用户期望「只刷新更新的位置」。

## What Changes

- 中央区内容区（`settings-main.tsx`）的 16 个条件渲染单元改为 **keep-alive**：每个面板首次激活后保持挂载，切走以 `display: none` 保留，再次激活直接显示——无重新挂载、无重新请求缓存命中的数据
- 选中响应仍只更新需要变化的部分：同组件响应式路径（条目 A→条目 B 的 `WorldEntryDetail`）不变，跨类别切换从「卸载重建」变为「显隐切换」
- 「未选中」空态不 keep-alive（零选中时无面板常驻）；首次打开某面板的加载/错误/空态呈现保持不变

### 非目标

- 不改选中→渲染的数据流（settingsNode signal、perBookState 持久化、恢复 effect 均不动）
- 不改任何面板组件的内部行为（表单、查询、标签页逻辑、右键菜单）
- 不改左栏设定树（settings-tree-visual-hierarchy 已归档）
- 不引入新的状态管理（复用 Solid 信号 + `Show` 结构，仅改变显隐机制）
- 不动首帧收敛门（book-open-transition 的 loading/content 槽机制不受影响）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `novel-workspace-layout`: 新增「中央区面板 keep-alive」requirement，声明面板首次激活后保持挂载、切走保留、再激活无重建的渲染契约；既有 requirement 不修改

## Impact

- **packages/app**：`src/pages/novel/settings-main.tsx` 为主要改动点（16 个条件渲染单元迁移到 keep-alive 表驱动结构）；面板组件本身零改动
- **e2e**：`setting-gallery` / `book-open-transition` / `isolated-character-graph` 三套件验证（断言按可见性定位，hidden 面板不影响）
- **性能取舍**：已激活面板的响应式图常驻（隐藏面板的 memo/effect 随数据变化重算，读 query 缓存、开销轻量），换取切换零重建；设计文档记录该取舍
- **数据兼容性**：纯渲染机制变更，无数据模型与持久化影响；i18n 无新增 key
