# 设计：统一小说工作台布局与导航

## Context

绑定写作会话当前有两个宿主：工作台内嵌路由 `/:dir/novel/:novelID/session/:id`（`workspace-frame.tsx` 全宽分支）与 openCode 独立会话视图 `/:dir/session/:id`（tab 系统 + `SessionNovelPanel` 补丁侧栏）。5 个入口中仅工作台「写作」按钮进入嵌入模式，其余 4 个（sessions 页最近列表、小说分组侧栏、会话内小说面板、命令面板）均走 `tabs.addSessionTab` 落入独立视图。

工作台内部（`workspace-frame.tsx`）有三套切换机制：左栏 `leftMode`（章节/大纲/设定，`SegmentedControlV2`）、主区 `?tab=` searchParams（阅读/写作/关系/地图，仅 `leftMode === "chapters"` 时渲染）、右栏 `panelTab`（人物/伏笔/张力/结构/批注/画布）。`activeTab` 为 characters/relations/map/canvas 时走全宽分支，左右栏不渲染；「人物」同时存在于全宽分支与右栏 tab 两处。

关键既有资产：`selectedChapterId` 等 frame 级 state 已传入部分面板（Inspector 联动的基础已存在）；`novel.listSessionBindings()` 返回全部绑定关系（session → novel 反查可行）；`Persist` 本地持久化机制成熟（`workspace-frame.tsx` 阅读进度、面板状态均已使用）；`SessionPage` 已有在窄容器旁运行的先例（独立视图的 `SessionNovelPanel` 侧栏布局）。

## Goals / Non-Goals

**Goals:**

- 绑定会话单一宿主：所有入口打开绑定会话都落在工作台路由，且不注册 titlebar tab。
- 工作台三区结构（左栏导航 / 主区焦点 / 右栏随行）替代现有三套切换机制与全宽分支。
- 右栏"图标列 + 面板区"：对话与五个仪表盘面板同层互斥切换，对话为默认面板。
- 面板 peek → expand 双态：peek 在右栏面板区，expand 占据主区；expand 时左右栏收起、对话收为窄条呼吸灯；Esc 返回 peek 态。
- 面板内容跟随 `selectedChapterId`（Inspector 联动）。
- 布局状态（右栏活动面板、面板展开态、左栏收起态）持久化；分栏宽度为固定值，不做持久化。

**Non-Goals:**

- 不改动独立会话视图的 openCode 原生能力（多 tab、文件树、终端）——自由会话体验保持现状。
- 不改写作流水线、审批闸门的后端逻辑；不涉及 Protocol / Server HttpApi 变更（无需 SDK 再生成）。
- 不做移动端/窄屏专项适配（仅保证桌面常见宽度可用）。
- 不做写作专注态（禅模式）——列为后续增强。titlebar 书籍级 tab 与分栏宽度拖拽调节均经走查确认为需求方向，归档后另开提案实现：书籍级 tab（标签按书籍组织而非会话，打开书籍即注册书籍标签）；分栏宽度拖拽（resizer + 宽度持久化，需先定义手动宽度与自动收边阈值的语义）。

## Decisions

### D1：绑定会话宿主路由保留路径段形式，入口统一封装为 `openSession(sessionID)`

保留既有路由 `/:dir/novel/:novelID/session/:id` 作为绑定会话唯一宿主（改用 searchParams 传 session 会破坏现有深链与刷新行为，收益为零）。新增一个统一打开动作（如 `openNovelSession(sessionID)`）：内部通过 `listSessionBindings()` 反查该会话是否绑定小说——绑定则 `navigate` 到工作台路由，未绑定则回落到现有 `tabs.addSessionTab` 流程。

5 个入口全部改调该动作：`novel-sessions.ts` 的 `openSessionById`/`createNovelSession`、`sessions.tsx` 两处、`command-palette.ts` 的 session 分支、`session-novel-panel.tsx`。备选方案是各入口各自判断路由（无新封装），但 5 处重复同一反查逻辑，违背"同一路由决策只写一次"，封装是合理的（多调用点，非单次使用 helper）。

绑定反查用现有批量接口一次拉取（`writing-flow.tsx` 的 `findBoundNovelSession` 已验证此模式），不新增后端接口。

### D2：三区布局替代三套切换机制，主区视图枚举扩展

`workspace-frame.tsx` 重构为固定三区。状态收敛为三个信号：

- 左栏 `leftMode: "chapters" | "outlines" | "world"`——常驻渲染，不再条件消失；
- 主区 `focusView: "reading" | "writing" | "relations" | "map" | "canvas" | "panel:<面板id>"`——沿用 `?tab=` searchParams 承载，`panel:characters` 等即面板的 expand 态（现有 `tab=relations` 与"关系图 expand"天然同义，不引入第二套参数）；
- 右栏 `railPanel: "chat" | "characters" | "foreshadow" | "tension" | "structure" | "annotations"`——持久化（`Persist.global("novel.workspace.rail")`）。

「人物」双入口消除：全宽分支删除，人物作为右栏面板之一（peek 默认、expand 需要时进入 `tab=panel:characters`）。画布从右栏 tab 迁为主区视图（`tab=canvas` 保留现状语义），因为它本质是焦点型工作区。

右栏整体支持手动收起与窄宽度自动收起（走查补充）：`railManual` 三态（null = 跟随宽度规则，布尔 = 手动覆盖）进 layout store（D6 持久化），工具栏按钮双向切换（与左栏按钮对称），自动规则见 D5。expand 态的右栏隐藏与收起叠加生效；退出展开态时清除手动收起——"展开态返回恢复右栏"的承诺优先于收起态。

### D3：面板组件单实现 + 容器自适应，不做两套渲染

peek（右栏 ~380px）与 expand（主区 ~全宽）用同一组件渲染到不同容器，组件内部用 CSS 容器查询/响应式类适配密度（列表行高、列数），不为两种形态维护两套组件。SolidJS 下即同一 `<Show>` 分支渲染同一组件、不同父容器。备选方案（Portal 复用同一 DOM 实例）切换动画复杂且状态保持无必要——peek/expand 本身就是两种检视深度，重新渲染可接受。

expand 态右栏自动回落：进入 `tab=panel:*` 时右栏收为窄条呼吸灯（生成中）或完全收起（空闲），Esc/返回按钮回到上一个 peek 面板（上一个 `railPanel` 值持久化在内存信号即可，不跨会话）。

### D4：Inspector 联动沿用 frame 级 selectedChapterId 传递

阅读视图选中章节变化 → 面板 props 响应更新。人物/伏笔/批注面板补齐按章节过滤或高亮（伏笔、批注与章节直接相关；人物面板高亮该章出场角色）。不引入新的全局 store——`workspace-frame.tsx` 现有 props 传递模式已覆盖，扩展即可。

### D5：宽度规则——固定断点自动收边，手动操作优先

- 工作台可用宽 < 1100px（右栏 380 + 主区 720）：自动收右栏——随行区先让位，导航区后让位（手动优先语义与左栏相同）；
- 工作台可用宽 < 1008px（左栏 288 + 主区 720）：自动收左栏（用户可手动展开，手动选择在本次宽度会话内优先于自动规则）；
- expand 态：左右栏一律收起（沉浸型语义，不做例外）；
- 窄条呼吸灯：`novelActivity()` 为真时显示，复用现有流水线状态信号。

用 `ResizeObserver` 监听三区布局的外层容器宽度——不监听主区本身：侧栏显隐会改变主区宽度，观察主区会形成自激励反馈环（收起态每帧翻转，表现为 UI 高频闪烁）。两档阈值在同一观察回调内判定。规则集中一处实现；不用纯 CSS 媒体查询，因为收边动作需要联动 persist 状态而非仅样式切换。

### D6：布局状态持久化复用 `Persist.global`，key 带版本号

新增 persist key（如 `novel.workspace.layout.v1`）统一承载 `railPanel`、面板展开态、左栏收起态、右栏收起态。阅读进度的既有 key 不动。带版本号便于未来结构变更时废弃旧数据，避免迁移逻辑。分栏宽度不进 persist——宽度为固定值（左栏 288 / 右栏 380），无可调状态可存。

## Risks / Trade-offs

- [workspace-frame.tsx 单文件重构范围大，易引入回归] → 分两期落地：一期只做 D1（入口收敛）+ D2 的右栏图标列与对话常驻，二期做面板双态与联动；每期独立可验证、可单独回滚。
- [SessionPage 在 380px 级右栏中的布局适配] → 独立视图 `SessionNovelPanel` 侧栏（约同宽度）已长期运行，风险可控；实现期对 prompt 输入区、审批条做窄容器走查。
- [入口收敛后，从命令面板/侧栏打开绑定会话的跳转比原来多一跳（先进书再进会话）] → 接受此代价换取上下文完整；工作台路由直接落在写作视图 + 对话面板，实际路径长度不增加。
- [旧路由 `/:dir/novel/:novelID/session/:id` 与新交互并存期间的入口不一致] → D1 一次性收敛全部 5 个入口，不保留旧打开路径（原子变更，不留双轨过渡）。
- [独立会话 tab 与工作台并存，用户可能混淆两类会话] → 一期接受；绑定会话不再注册 tab 后，tab 栏内只剩自由会话，列表污染自然消失。

## Migration Plan

1. 一期（D1 + D2 右栏 + 对话常驻）：独立分支实施，`bun typecheck` + oxlint 通过后合入 dev。
2. 二期（D3–D5 面板双态/联动/自动收边）：基于一期分支继续。
3. 回滚策略：纯前端变更，git revert 即可；persist key 带版本号，旧版本代码遇到新 key 数据按空值处理（`persisted` 现有行为已保证），无需清理。

## Open Questions

- （无）分栏宽度拖拽调节初版拍板不做（spec 相应收窄为固定宽度）；终版走查推翻该决定，确认为需求方向，随书籍级 tab 一并在归档后另开提案。
