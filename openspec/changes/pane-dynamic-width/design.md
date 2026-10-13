# Design

## Context

- `packages/app/src/pages/novel/workspace-pane-width.ts` 是宽度派生的唯一模块：主区保底 720 与左右栏 MIN/MAX/DEFAULT 全部是静态常量；注释明确「静态边界，不随窗口动态化」——本变更要推翻的正是这一决策。
- `workspace-frame.tsx` 中生效宽度 = 拖拽内存态 ?? 设定宽度 ?? 默认值（`leftPaneWidth` / `railPaneWidth`）；`ResizeObserver` 观察 Body 三区容器（避免观察主区形成自激励反馈环，见现有注释），目前只用于计算自动收边阈值。
- `ResizeHandle` 在 mousedown 时通过 Solid props getter 读取 `min` / `max`，拖拽闭包内沿用当次读值；主区容器为 `flex-1 min-w-0`，无 CSS min-width，720px 保底纯由 JS 派生。
- 持久化结构 `novel.workspace.layout.v1` 只存用户意图（`leftWidth` / `railWidth`，null = 默认），本变更不改结构。

## Goals / Non-Goals

**Goals:**

- 侧栏可调上限动态化：`paneMaxWidth = 三区容器宽度 − 主区保底(30px) − 另一侧可见栏宽度`，左右栏共用同一公式。
- 渲染层钳制：设定宽度超过动态上限时按上限显示，持久化意图保留，窗口变宽自动恢复。
- 自动收边阈值公式保持「左栏宽度 + 保底」「左栏宽度 + 右栏宽度 + 保底」，保底取 30px；双击重置、拖到最小宽度收起、手动覆盖语义全部不变。

**Non-Goals:**

- 不加窗口宽度比例上限（忠实 VS Code：唯一约束是主区保底）。
- 不改 expand 态（面板占满主区）行为、不改默认宽度与最小宽度、不改持久化结构与版本号。
- 不在拖拽过程中响应窗口 resize 重算上限（松手后下次拖拽生效）。
- 不为 30px 极限态保证主区内容可读性，只保证不溢出布局、不崩溃。

## Decisions

1. **一个共用纯函数替代两个 MAX 常量**：`paneMaxWidth(bodyWidth, otherVisibleWidth)` 返回 `bodyWidth − WORKSPACE_MAIN_MIN_WIDTH − otherVisibleWidth`，`WORKSPACE_MAIN_MIN_WIDTH` 改为 30。左右栏公式相同，拆成两个函数是伪抽象；拒绝方案：按栏各写一个（重复公式）。
2. **容器宽度复用现有 ResizeObserver**：observer 回调已拿到 `contentRect.width`，增加一个 `bodyWidth` signal 写入即可；不建第二个 observer（重复观察同一节点既浪费也要重新评估自激励风险）。
3. **非拖拽期对称钳制 + 拖拽期单侧权威（推挤模型，对齐 VS Code）**：无拖拽时渲染输出 `Math.max(栏最小宽度, Math.min(设定值, paneMaxWidth(bodyWidth(), 另一侧设定宽度)))`——必须用另一侧**设定宽度**，两侧互相以对方渲染值为输入会循环派生；极窄窗口下上限低于最小宽度时最小宽度优先（可能轻微溢出，由自动收边兜底）。拖拽期切换为单侧权威：被拖侧渲染值 = 拖拽值（ResizeHandle clamp 的上限 = 容器 − 30 − 另一侧最小宽），另一侧让位 `Math.max(自身最小宽, Math.min(自身设定宽, 容器 − 30 − 拖拽值))`——权威侧只有拖拽 signal 一个输入，无环。松手 commit 双侧：拖拽值固化进被拖侧设定宽度，另一侧压缩结果若小于原设定宽度则固化为新设定宽度（推挤持久化，窗口变宽不回弹）。另一侧收起时宽度按 0 计。
4. **ResizeHandle 组件零改动**：props getter 保证 mousedown 时读取的是当前动态 max；拖拽中窗口变化的陈旧上限可接受（VS Code 同样如此），避免为边缘场景引入响应式拖拽复杂度。
5. **阈值推导签名不变**：`collapseThresholds(leftWidth, railWidth)` 的公式与调用方式不变，入参仍是两栏生效宽度（钳制后的渲染宽度，与现状传参一致），内部保底常量变为 30；自动收边由此自然退化为极窄窗口的兜底，正常桌面窗口不再触发——这是预期行为，收边保护职责部分转移给渲染钳制。

## Risks / Trade-offs

- [主区被挤到 30px 时内容不可读] → 布局用现有 `min-w-0` + overflow 处理保证不崩溃；可读性不在 spec 承诺内，用户主动拖出的极限态自己可逆。
- [手动展开覆盖自动收边时，极窄窗口下主区可低于 30px（含 0）] → 与现有手动覆盖语义一致（手动优先于自动规则），钳制保证侧栏不超出可用空间，不新增额外保护。
- [极窄窗口（约低于 570px 且侧栏收起）下动态上限可低于最小宽度，拖拽提交值可能低于固定下限]（推挤模型下上限为另一侧最小宽，该边界基本不可达，保留渲染兜底） → 渲染层已按最小宽度兜底显示，持久化值仅存语义瑕疵且用户不可见；遵循不为边缘场景加复杂度的取舍，不做额外提交钳制。
- [拖拽中上限陈旧] → 仅在拖拽中途 resize 窗口时出现，松手即恢复；不为边缘场景加复杂度。
- [纯函数测试需要窗口宽度入参] → `paneMaxWidth` 显式接收 `bodyWidth` 参数，测试不触碰 `globalThis`，符合仓库测试约定。

## Migration Plan

单包纯前端改动，无数据迁移、无 API 变更；实现提交合并后如需回滚直接 revert，持久化数据对新旧代码双向兼容（旧数据宽度只可能被新钳制逻辑收窄显示，值不丢）。

## Open Questions

（无——30px 保底与不设比例上限已由用户确认。）
