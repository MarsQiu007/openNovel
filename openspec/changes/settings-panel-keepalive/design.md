# Design: settings-panel-keepalive

## Context

`settings-main.tsx` 的中央区是并列 `<Show when={kindIs(...)}>` 条件渲染：16 个渲染单元（7 个单页节点面板 + world/characters/character 各 tab 视图 + 两个 gallery）在选中节点变化时整体卸载/挂载。选中状态是 `workspace-frame` 的信号（`settingsNode`），不经路由；面板 props 全是 Accessor/函数，数据流无需改动。`workspace-frame` 的 expand 态已有同款 keep-alive 先例（`display: none` 切换、退出展开状态不丢）。

spec `novel-workspace-layout` 的既有条款约束三区布局与首帧收敛，本 delta 为纯新增，无既有 requirement 修改。

## Goals / Non-Goals

- Goals：面板首次激活后保持挂载；切走 `display: none`；再激活零重建零重载；首帧门与空态行为不变
- Non-Goals：不改数据流与持久化；不改面板内部；不动首帧收敛机制；不优化隐藏面板的响应式开销（记录取舍）

## Decisions

### D1: 表驱动 keep-alive 渲染，而非逐处手写 Show

把 16 个渲染单元收敛为一张候选表：`{ key, active: () => boolean, render: () => JSX.Element }`，用 `<For>` 渲染 `<KeepAlive>` 容器。key 空间共 16 个：`book-info` / `foreshadow` / `style` / `soul` / `techniques` / `organization` / `memory` / `world:list` / `world:map` / `world-entry:detail` / `world-entry:gallery` / `characters:list` / `characters:graph` / `character:detail` / `character:graph` / `character:gallery`。备选：逐处替换 16 个 `<Show>`——冗长且后续加面板易漏，表驱动让「新面板必须登记」成为显式步骤。

### D2: visited 集合单调累积 + activeKey 派生

`createSignal<ReadonlySet<string>>` 存已激活 key；`createEffect` 监听 `activeKey()`（由 `props.node()` + `tab()` 派生的当前应可见叶子 key），首次出现时加入集合（Set 只加不减）。渲染时每个候选单元 `<Show when={visited().has(key)}>` 保持挂载，`display: none` 由 active 控制。keyed 语义维持：gallery 的条目 id 变化仍走内层 `keyed` Show 重挂（不同条目不同实例，与现状一致）。

### D3: 显隐用 `style={{ display: active ? "" : "none" }}`

容器是 `flex flex-col flex-1 min-h-0` 布局，行内 display 双态（空字符串移除行内值回退到类）比 Tailwind `hidden` 类更不易与面板根类冲突；`overflow-y-auto` 父容器下只有一个 display 非 none 的面板，布局等价于单面板。

### D4: 隐藏面板的响应式图常驻——接受开销换取零重建

隐藏面板的 memo/effect 继续跟踪数据变化（读 tanstack query 缓存，无网络请求），每次选中变化时全部已挂载面板的轻量 memo 重算。16 面板开销实测可接受（表单/列表 memo 都是缓存读）；若未来出现重面板，可再按面板加惰性挂起。备选：隐藏时断开响应式（untrack/冻结）——复杂度大增且破坏「再激活即最新」语义，放弃。

### D5: e2e 三套件验证，观测槽断言不变

`setting-gallery`（画廊路径点节点）、`book-open-transition`（首帧 content 帧次数与快照）、`isolated-character-graph`（树内点名节点再切标签）均按可见性断言，hidden 面板不可见不影响定位；跑全量确认无回归。

## Risks / Trade-offs

- [16 面板常驻的内存与响应式开销] → 面板 DOM 中等、memo 全是缓存读；真出现瓶颈按面板单独惰性化（D4 留口）
- [表单类面板 hidden 时仍跑 effect] → effect 写草稿信号无副作用；显示时数据已是最新，符合「再激活即最新」
- [候选表漏登记新面板] → 新面板渲染不出来会在开发期立刻暴露（visible 断言/e2e），表驱动让登记成为显式步骤
- [e2e 快照差异] → 三套件全量跑验证；观测槽按 DOM 标记，不受 display 影响

## Migration Plan

单 PR 渲染机制重构，无数据迁移、无协议变更、无生成物再生成；回滚即还原 `settings-main.tsx` 单文件。验证路径：`packages/app` 下 `bun typecheck` + 三套件 e2e + 用户实测切换体感。

## Open Questions

（无）
