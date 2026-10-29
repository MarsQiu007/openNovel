# Design

## Context

见 proposal.md。已核实的现状：

- **切换器**（`packages/app/src/pages/novel/session-switcher.tsx`）：`childrenExpanded` 信号按节点记录「手动展开」白名单，`showChildren = 手动展开 || 祖先链含当前会话`——默认收起是语义反转的结果，不是数据缺失。数据源 `useBoundNovelSessions`（`novel-queries.ts` 的 `boundNovelSessions`）已按 parentID 广度挂接全部未归档后代（任意层级），树形数据齐备。
- **运行状态**（`packages/app/src/context/server-session.ts`）：全局同步 store 维护 per-session `session_status`（`busy`/`idle`/`retry`），事件驱动更新 + `v2.session.active` 集合轮询对账（V2 无 status 推送兜底），已有 `isBusy` 形状的读取口（`session_status[id]?.type !== "idle"`）。书籍级活动指示（spec `novel-session-activity`）即建立在同一来源上。
- **既有测试锚点**：`session-switcher.test.ts`（组合逻辑单测）与 `e2e/novel/session-switcher-subagent.spec.ts`（「默认折叠 → 展开 → 点击」链路）固化了「默认折叠」行为，语义反转必须同步改写。

## Goals / Non-Goals

**Goals:**

- 恢复子代理可发现性：打开切换器即见全部未归档子代理，运行中一眼可辨。
- 提供运行期直达入口：不展开下拉也能看到谁在跑、一键进入。
- 零后端改动：全部消费现有 store 与查询。

**Non-Goals:**

- 不内嵌子代理输出流到主时间线；不做首页侧栏改造；不动 i18n locale 文件（文案内联中文，沿用 panel-ai-artifacts 先例）。

## Decisions

### D1：展开语义反转为「收起黑名单」

`childrenExpanded`（展开白名单）改为 `childrenCollapsed`（收起黑名单）：默认展开 = 无记录；手动收起写黑名单；手动展开清除记录。`showChildren = 未被手动收起 || 祖先链含当前会话`。祖先链强制展开保留现状语义（`containsActive`），保证活动位置永不被折叠遮挡——这也是「手动收起」与「活动可见」冲突时的既定取舍。

备选：仅对运行中子代理默认展开（我最初的 A 方案）。被否——用户明确追问「默认不展开不好吗」，且运行结束即折叠会造成列表跳动；全量默认展开 + 手动收起更符合心智。

### D2：运行指示与横条共用 `session_status`，不新建轮询

- 切换器条目指示：`session_status[childID]?.type` 为 `busy`/`retry` 时显示指示（复用全局同步既有实时性，事件驱动 + 15s 级 active 对账，与书级活动指示同源同延迟）。
- 横条数据：当前会话直接子代理 ∩ busy/retry。直接子代理集合在书内上下文取自 `useBoundNovelSessions` 树的第一层；组件按「当前会话 ID → 直接子代理」通用取参，不绑死书内查询，首页会话视图复用同一组件时可由调用方传入等价集合。
- 不新增端点、不加独立轮询：横条生命周期完全跟随 store，天然满足「实时增删」。

### D3：横条挂载在时间线头部，仅父会话视图渲染

挂载点选时间线视图头部区（`message-timeline.tsx` 顶部、父会话分支已有条件渲染位）：主会话视图计算直接子代理运行集合并渲染横条；子会话视图（`parentID` 存在）不渲染横条——孙代监控经进入对应子会话实现，避免嵌套横条堆叠。条目点击导航复用切换器的 `switchTo` 路由逻辑（书内带 novelID，首页走会话路由）。

备选：挂 workspace-frame。被否——横条语义属于「会话视图」而非「书工作台」，挂在时间线头部使首页会话与书内会话共用一套，且不参与工作台首帧收敛门逻辑（回跳/定址），风险面更小。

### D4：横条只列直接子代理

深层后代不进横条（spec 已定）：递归展开会让横条在 pipeline 类三层链（主会话 → @pipeline → @observer）里膨胀且层级语义混乱；深层运行可经点击进入子会话后在其横条继续下钻。

## Risks / Trade-offs

- [默认展开让长下拉更高（多子代理主会话）] → 下拉内容滚动已有容器约束（max-w-72）；手动收起黑名单给用户控制权；当前书内主会话子代理量为个位数，不构成实际压力。
- [`session_status` 的 active 轮询对账有秒级窗口，横条增删可能略滞后于事件] → 与书级活动指示同源同延迟，用户已接受该实时性水位；事件驱动路径覆盖绝大多数增删瞬间。
- [语义反转触碰既有 e2e 断言] → 属预期改动而非回归：任务清单显式包含改写 `session-switcher-subagent.spec.ts` 的「默认折叠」步骤为「默认展开」，并补运行指示断言。
- [横条在会话视图头部与权限问答/审批条等既有浮层并存] → 横条为常规文档流条目（非浮层），仅占位一行；与既有头部元素顺序在实现时以不遮挡输入区为准。

## Migration Plan

纯前端行为变更，随版本发布即生效，无数据迁移与回滚特殊处理（revert 即回到默认折叠）。

## Open Questions

无。
