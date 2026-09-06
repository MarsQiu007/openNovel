## Context

工作台布局由全局持久化状态 `novel.workspace.layout.v1` 驱动，包含左右栏手动收起、拖拽宽度、窄宽自动收边、右栏 peek/expand 和活动面板状态。旧实现把收起态渲染为常驻 36px 图标坞，视觉上始终占用空间。相关宽度和阈值集中在 `packages/app/src/pages/novel/workspace-pane-width.ts`。

## Goals / Non-Goals

**Goals:**

- 展开态平时不渲染可见收纳控件，悬停或聚焦对应面板时在边缘淡入虚化收纳条。
- 收起态完全隐藏面板，仅保留极淡边缘线索和窄热区；hover/focus 后出现展开控件。
- 保持左右状态独立、内容持续挂载、右栏 peek/expand 语义不变。
- 保持手动收起、自动收边、拖拽宽度和持久化降级逻辑。
- 满足键盘可达性：focus 显示控件，`aria-expanded`、`aria-label` 和 tooltip 保持清晰。

**Non-Goals:**

- 不修改后端协议、服务端 API 或 SDK。
- 不升级持久化版本，不迁移本地数据。
- 不修改 `packages/app/src/i18n/*.ts`；复用现有工作台文案键。
- 不重构 peek/expand、小说会话绑定或数据模型。
- 不新增跨书籍布局记忆分支。

## Decisions

### 1. 展开态使用面板内边缘控件

左右 `aside` 继续承载完整内容并保留 `relative` 定位。左栏在右侧边缘、右栏在左侧边缘渲染一个竖向胶囊控件。控件默认 `opacity-0`，在 `group-hover` 或 `focus-within` 时淡入；视觉使用半透明渐变、轻边框、圆角、阴影和 `backdrop-blur`，形成柔和的“虚化收纳条”。

```text
展开态:
[ 左栏内容 | hover 收纳条 ] [ 主区 ] [ hover 收纳条 | 右栏内容 ]
```

拖拽宽度期间隐藏该控件，避免与 resize 手柄竞争；点击左侧控件收起左栏，点击右侧控件收起右栏。

### 2. 收起态使用独立边缘热区

收起态的 `aside` 恢复为 `hidden`，不再保留 36px 宽度。body 容器改为 `relative`，在左右边缘渲染宽度约 16px 的独立 overlay 热区。热区常显 1px 或 2px 极淡渐变线索，hover/focus 后显示完整渐变和展开按钮。

```text
收起态:
[ 边缘热区 |          主区          | 边缘热区 ]
```

点击左热区恢复左栏；右热区恢复当前右栏面板。热区不参与 flex 布局，不会挤压主区。

### 3. 保持状态模型不变

不新增持久化字段。`leftManual`、`railManual` 继续表示手动收起覆盖，`null` 跟随自动收边；宽度和右栏活动面板继续沿用现有数据。旧持久化数据无需迁移，收起态只改变渲染形态。

### 4. 移除图标坞宽度预留

删除 `WORKSPACE_DOCK_WIDTH` / `WORKSPACE_DOCK_TOTAL_WIDTH`。阈值回到纯粹的内容预留语义：左栏阈值为左栏宽度 + 主区最小宽度，右栏阈值为左栏宽度 + 右栏宽度 + 主区最小宽度。自动收边后不再为图标坞牺牲横向空间。

### 5. 可发现性与交互安全

- 控件必须能通过键盘 Tab 聚焦；focus 时即使没有鼠标 hover 也可见。
- 使用现有 `toggleNav` / `toggleRail` 文案，并通过 `aria-expanded`、`aria-label` 和 tooltip 表达状态。
- 拖拽期间隐藏收纳控件，避免误触。
- 收起态边缘线索保持低对比，但不能完全消失，以保证可发现性。

## Risks / Trade-offs

- [悬停入口初始可发现性略低于常驻图标坞] → 保留常显边缘线索，并把热区放在可预测的左右边缘。
- [鼠标 hover 和拖拽可能重叠] → 拖拽时隐藏控件，继续把 resize 手柄保留在原边缘。
- [完全隐藏内容可能让人误以为模块消失] → 状态持久化并在恢复后完整还原导航和面板。
- [低对比边缘线索在不同主题下的可见性不同] → 使用主题 token 并保留 hover/focus 高对比控件。

## Migration Plan

无数据迁移或 API 变更。实现可先更新阈值，再切换布局形态；旧版本持久化数据在新版本中按原布尔语义继续读取。

## Open Questions

无。