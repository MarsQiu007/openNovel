# Design

## Context

章节侧栏 `chapter-sidebar.tsx` 为 `For` 渲染的行组件列表（`ChapterRow`），选中态由 `props.selectedChapterId === chapter.id` 派生为 `isSelected` prop；当前仅有浅色按压底色，全文件无滚动定位逻辑。列表嵌套在双层滚动容器中（`workspace-frame.tsx` 外层 `overflow-y-auto` + 侧栏列表内层 `overflow-y-auto`，滚动条均隐藏）。选中章节经 `novel.reading-progress` 持久化在重开工作台时恢复，但恢复后列表视口停留在顶部。左栏分段切换（章节/大纲/设定）用 `<Show>` 条件渲染，切回即整树重挂、滚动归零。

## Goals / Non-Goals

- Goals：三个时机（恢复挂载、选中变化、数据延迟就绪）的视口定位；选中行高亮强化。
- Non-Goals：见 proposal「非目标」。设计层面补充：不改变 `<Show>` 重挂结构（定位方案天然覆盖重挂场景，无需为保滚动位置改造挂载模型）；不为无选中态做默认滚动。

## Decisions

### D1 定位放在行组件内部 effect，配合列表可见性信号

`ChapterRow` 已是独立组件且持有 `isSelected` prop。在选中行挂 ref，`createEffect` 监听 `isSelected` 与列表可见性：两者同时为真时对该行 `scrollIntoView({ block: "nearest", behavior: "auto" })`。

可见性信号在 `ChapterSidebar` 顶层用 IntersectionObserver 观察列表容器派生（收起侧栏为祖先 `display:none`，目标报告 not intersecting；展开恢复 intersecting）。理由：左栏收起保留 DOM，行内仅监听 `isSelected` 会在收起期间切章时于无布局状态下触发 no-op，展开后视口仍停在收起前位置——可见性参与定位条件后，展开瞬间信号翻转即可补定位。

- 挂载时 `isSelected` 已为 true 且列表可见的行，effect 首跑即定位——覆盖刷新恢复与切分段重挂
- 选中切换时目标行 prop 变更触发 effect——覆盖点行与「下一章」连跳
- 章节查询数据晚到时，`For` 新挂载该行组件、effect 首跑——覆盖数据延迟就绪
- 收起期间切章、展开后信号翻转触发 effect 重跑——覆盖收起恢复场景
- `block: "nearest"` 下已可见行浏览器不产生滚动——原生满足「已可见不额外滚动」场景

实现加固（e2e 实测驱动）：恢复路径布局多帧才稳定（Suspense 摘插期间行不在文档树，`scrollIntoView` 静默 no-op 且无人重触发），单次调用与单帧 rAF 均实测 flake。定位以「行落入列表可视区」为成功条件逐帧重试（上限约半秒），摘插窗口内重试空转、插回后一击命中，并保持 nearest「已可见不滚动」语义（已完全可见时不调用）。

备选（不选）：顶层 effect 监听 `selectedChapterId`，按 data 属性查询行元素并计算 `offsetTop` 手动设 `scrollTop`。需要处理卷分组标题的偏移与两层容器归属，复杂度更高且收益为零。备选二（不选）：不引入可见性信号、仅在行内监听 `isSelected`——无法覆盖收起恢复场景，是本次审查发现的方案缺陷。

### D2 高亮用透明基线 border 实现指示条，避免布局抖动

选中行增加行首 2px accent 指示条与强调文字。若仅选中行加 `border-l-2`，会让该行内容整体位移 2px、切换选中时产生水平跳动。方案：全部行统一 `border-l-2 border-transparent` 基线，选中行仅换 border 颜色为 accent token、文字从 `text-muted` 升 `text-base`。样式全部经既有 v2 设计 token 表达，不引入新色值。

### D3 不感知查询加载状态

数据就绪时机由 Solid 响应链自然收敛（数据到达 → `For` 挂载行 → effect 首跑），不订阅 tanstack query 的 `isSuccess`。避免在组件里引入与数据层耦合的条件分支。

## Risks / Trade-offs

- [双层滚动容器下 `scrollIntoView` 可能连带滚动外层 workspace-frame 容器] → 实测命中：外层容器是普通块级 overflow 容器而非 flex 容器，侧栏根的 `flex-1` 在其下无效，整栏随内容撑开，滚动历史上就落在外层（搜索框会滚出视野）。修复：侧栏根加 `h-full` 钉住高度，内层列表成为唯一滚动容器——这是既有布局断链的修复，e2e 断言内层 `scrollTop` 命中与行 bounding box 可见兜底验证。
- [IntersectionObserver 在 happy-dom 中可能未实现] → 验证以 Playwright e2e 为主（真实浏览器，断言行元素 bounding box 与容器 scrollTop），不为该组件写依赖 IO 的 happy-dom 单测；e2e 用 `page.addInitScript` 预置阅读进度的写法已有先例（`book-open-transition.spec.ts`）。
- [可见性信号让所有行 effect 依赖同一信号，展开瞬间多行重跑] → effect 体内先判 `isSelected`，非选中行直接返回，重跑成本可忽略。

## Migration Plan

纯前端呈现改动，随 `packages/app` 构建发布即生效，无数据迁移；回滚即还原该组件改动。

## Open Questions

（无）
