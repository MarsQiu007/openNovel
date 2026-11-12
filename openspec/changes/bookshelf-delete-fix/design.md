# Design

## Context

书架删除按钮的图标名 `delete` 自仓库初始导入即引用 v2 图标注册表中不存在的名字；v2 `Icon` 对未知名的兜底是静默渲染 `plus`（[icon.tsx:198](../../../packages/ui/src/v2/components/icon.tsx)）。穷举审计（app / session-ui / ui 三包 `IconV2 name="..."` 与注册表键求差集）确认全仓库仅两个未知名受害点：`home.tsx` 的 `delete` 与 `message-timeline.tsx` 的 `info`（模型回退指示标）。删除按钮附加缺陷：平时 `opacity-0` 且 `pointer-events: auto`，构成隐形热区；`handleDeleteNovel` 中 `mutateAsync` 失败会跳过遮罩关闭并产生 unhandled rejection，且无进行中防重。动机与范围见 proposal.md。

## Goals / Non-Goals

**Goals:**

- 删除按钮显示真实的删除语义图标，键盘与触屏可达
- 不可见按钮不再捕获指针，消除幽灵点击
- 删除失败/进行中状态有明确反馈，不卡死
- 图标未知名兜底不再产出误导性图形

**Non-Goals:**

- 不动删除的服务端语义与数据级联（proposal 已列非目标，另行立案）
- 不改 v1 图标库（`Icon` from `@opennovel-ai/ui/icon` 保持原样）
- 不引入图标名静态校验工具链（本次靠审计 + 兜底告警，工具化另议）

## Decisions

### D1：未知名兜底改为「空白 + 开发期告警」

- **选择**：未知图标名渲染空白 `<use>` 指向不存在的 symbol（视觉上无图形），并在非生产环境 `console.warn` 提示未注册名
- **备选**：保持 plus 兜底（否决：误导性正是本次事故根源）；开发期直接 throw（否决：图标缺失是低危视觉问题，不值得打断页面；warn 足够响亮）
- 审计确认补齐两个字形后，该兜底当前零触发，属面向未来的防线

### D2：`delete` / `info` 字形资产

- `delete`：复用 v1 图标库 `trash` 几何路径，缩放对齐 v2 的 16×16 视窗与 `stroke="currentColor"` 线风（v2 既有图标均为细线描边风格）
- `info`：对齐 v2 既有 `help`（圆内问号）的圆形徽章构图，绘制圆内竖点「i」
- 两个字形均内联进 v2 `icons` 注册表，走既有 sprite 机制（`ensureSprite` 自动注入 `<symbol>`），无需改组件结构

### D3：隐形热区收敛（纯 CSS）

- 按钮类从 `opacity-0 group-hover:opacity-100` 改为 `opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100`
- 键盘可达性：`pointer-events: none` 不阻碍 Tab 聚焦（非 `display:none`/`visibility:hidden`），`focus-visible` 时显形，Enter/Space 激活不受影响
- 触屏：无 hover 场景下按钮保持隐藏、不吃点击（这正是预期——触屏删除走长按/其他入口的设计另案，本变更只保证不误触）

### D4：删除流程失败收口与防重

- `handleDeleteNovel` 全程 try/catch/finally：任一环节抛错 → `setDeletingNovelId(null)` 关遮罩 + `showToast` 报错（复用既有 `errorMessage` 工具）；finally 重置 busy
- busy 信号（`deleteBusy`）覆盖整个 handler（绑定查询 + 删除 + 会话级联归档），确认按钮 `disabled={deleteBusy()}`，防双击重复提交
- 风格说明：仓库风格指南「避免 try/catch」针对业务逻辑层；本处是用户动作边界 + 显式反馈，属合理例外（与 `pickFile` 等既有 handler 的 catch 先例一致）
- pending 文案：新增 `novel.bookshelf.deleting`（删除中… / Deleting… / 刪除中…），三语补齐（产品文案铁律）

### D5：测试与验证

- `packages/ui`：v2 `Icon` 组件单测——`delete`/`info` 解析到对应 symbol id；未知名渲染空白且 `console.warn` 被调用；用 happydom 断言 `<use href>`
- `packages/app`：home.tsx 为页面组件，交互行为靠手动走查（浏览器悬停/点击/键盘 Tab）+ 既有 e2e 约定，不新增强制 e2e
- 回归：受影响包 `bun test` + 仓库根 `bun turbo typecheck` + oxlint 同模式基线比对

## Risks / Trade-offs

- [兜底改空白后，若有审计遗漏的未知图标名，其位置将出现空图标] → 穷举审计已覆盖 app/session-ui/ui 三包；`console.warn` 在开发期即暴露；空图标的危害远小于错误语义图形
- [console.warn 在测试输出中制造噪音] → 仅在未知名时触发一次，单测内可断言吞掉；且这正是其设计目的（让缺失响亮）
- [复用 v1 trash 几何在 16×16 视窗下线条过细/过粗] → 实现时按 v2 `book`/`folder` 的线宽视觉比对微调，走查确认
- [busy 期间用户反复点确认无响应误以为卡死] → 按钮 disabled 态有既有视觉规范；遮罩本身阻止其他操作，反馈足够

## Migration Plan

纯前端改动，无数据迁移；随常规发布上线。回滚即 revert 本变更提交，无持久化状态残留。
