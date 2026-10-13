# Tasks

## 1. 宽度派生模块动态化

- [x] 1.1 修改 `packages/app/src/pages/novel/workspace-pane-width.ts`：`WORKSPACE_MAIN_MIN_WIDTH` 改为 160，删除 `LEFT_PANE_MAX_WIDTH` / `RAIL_PANE_MAX_WIDTH`，新增共用纯函数 `paneMaxWidth(bodyWidth, otherVisibleWidth)`，验证：模块导出面与 design 决策一致
- [x] 1.2 重写 `workspace-pane-width.test.ts` 边界断言：覆盖动态上限公式、另一侧收起按 0、保底 160px 的阈值推导，验证：在 `packages/app` 目录 `bun test src/pages/novel/workspace-pane-width.test.ts` 通过

## 2. 工作台接线与钳制渲染

- [x] 2.1 改造 `workspace-frame.tsx`：在现有 ResizeObserver 回调写入 `bodyWidth` signal，`leftPaneWidth` / `railPaneWidth` 渲染输出按 `Math.max(栏最小宽度, Math.min(设定值, paneMaxWidth(bodyWidth(), 另一侧设定宽度)))` 钳制（另一侧收起按 0，上限低于最小宽度时最小宽度优先），验证：`packages/app` 目录 `bun typecheck` 通过
- [x] 2.2 接入动态上限：左右栏 ResizeHandle 的 `max` 改为动态派生值（另一侧收起时按 0 计），验证：拖拽手柄在宽窗口可越过旧 400/560 上限直至主区剩 160px
- [x] 2.3 手动走查关键场景并记录结果：宽窗口拖栏到动态上限、缩小窗口后设定宽度被钳制且变宽自动恢复、双击重置默认宽度、拖到最小宽度收起、极窄窗口自动收边与手动展开覆盖，验证：`packages/app` 下 `bun run dev` 实测各场景行为与 spec delta 一致
- [x] 2.4 实现拖拽推挤：拖拽期被拖侧以拖拽值为准，另一侧先让位压缩至自身最小宽；松手未越过收起阈值时压缩结果双侧固化持久化，验证：`packages/app` 目录 `bun typecheck` 通过
- [x] 2.5 扩展 Playwright 走查：覆盖双向推挤与压缩结果固化（如 1600px 视口左栏 1108px / 右栏 332px，主区 160px），验证：`bunx playwright test e2e/novel/workspace-pane-width.spec.ts` 全绿
- [x] 2.6 实现推挤越界收起：另一侧越过最小宽后拖拽期自动收起，松手固化收起与最小设定宽；拖拽手柄上限改为容器 − 160，验证：`packages/app` 目录 `bun typecheck` 通过
- [x] 2.7 扩展 Playwright 走查：覆盖双向推挤、越界自动收起、松手固化和手动展开最小宽，验证：`bunx playwright test e2e/novel/workspace-pane-width.spec.ts` 4/4 全绿
- [x] 2.8 根据走查反馈放宽主区保底：`WORKSPACE_MAIN_MIN_WIDTH` 从 30px 调整为 160px，同步公式断言、动态上限、推挤阈值与 Playwright 数值，验证：app typecheck、宽度单测、Playwright 分栏用例全绿
  - 越界走查结果：1600px 视口左栏拖过 1120px 阈值后右栏自动收起，继续拖到 1440px（中心保底 160px）；窗口加宽到 2000px 后右栏保持收起，手动展开按 320px。右栏对称拖过 1620px 阈值后左栏自动收起，继续拖到 1840px；手动展开左栏按 220px，右栏钳制到 1620px。

## 3. 集成验证

- [x] 3.1 运行集成检查：`packages/app` 目录 `bun typecheck` 零错误，并在仓库根运行 `bun run lint`（oxlint）确认相关文件零告警，验证：两条命令退出码为 0
- [x] 3.2 运行 `packages/app` 目录的模块单测并全绿，验证：`bun test src/pages/novel/workspace-pane-width.test.ts` 退出码为 0

## Workflow follow-up

- 归档前收集 `OpenSpec-Change: pane-dynamic-width` 实现提交写入 tasks.md，运行 `openspec validate pane-dynamic-width`，同步主 specs 后归档。

## Implementation Commits

- `a1d24bbe7` docs(openspec): 新增 pane-dynamic-width 提案工件
- `0171626c5` docs(openspec): 修复 pane-dynamic-width 提案审查问题
- `4ec1febab` feat(app): 分栏宽度改为动态派生边界
- `07b7b74fe` feat(app): 拖拽分栏时推挤另一侧
- `18c5e333d` fix(app): 分栏推挤越界后自动收起
- `5ea556275` fix(app): 放宽中心面板最小宽度
