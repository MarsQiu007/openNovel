# Tasks

## 1. 宽度派生模块动态化

- [x] 1.1 修改 `packages/app/src/pages/novel/workspace-pane-width.ts`：`WORKSPACE_MAIN_MIN_WIDTH` 改为 30，删除 `LEFT_PANE_MAX_WIDTH` / `RAIL_PANE_MAX_WIDTH`，新增共用纯函数 `paneMaxWidth(bodyWidth, otherVisibleWidth)`，验证：模块导出面与 design 决策一致
- [x] 1.2 重写 `workspace-pane-width.test.ts` 边界断言：覆盖动态上限公式、另一侧收起按 0、保底 30px 的阈值推导，验证：在 `packages/app` 目录 `bun test src/pages/novel/workspace-pane-width.test.ts` 通过

## 2. 工作台接线与钳制渲染

- [x] 2.1 改造 `workspace-frame.tsx`：在现有 ResizeObserver 回调写入 `bodyWidth` signal，`leftPaneWidth` / `railPaneWidth` 渲染输出按 `Math.max(栏最小宽度, Math.min(设定值, paneMaxWidth(bodyWidth(), 另一侧设定宽度)))` 钳制（另一侧收起按 0，上限低于最小宽度时最小宽度优先），验证：`packages/app` 目录 `bun typecheck` 通过
- [x] 2.2 接入动态上限：左右栏 ResizeHandle 的 `max` 改为动态派生值（另一侧收起时按 0 计），验证：拖拽手柄在宽窗口可越过旧 400/560 上限直至主区剩 30px
- [x] 2.3 手动走查关键场景并记录结果：宽窗口拖栏到动态上限、缩小窗口后设定宽度被钳制且变宽自动恢复、双击重置默认宽度、拖到最小宽度收起、极窄窗口自动收边与手动展开覆盖，验证：`packages/app` 下 `bun run dev` 实测各场景行为与 spec delta 一致
- [x] 2.4 实现拖拽推挤：拖拽期被拖侧以拖拽值为准（上限 = 容器 − 30 − 另一侧最小宽），另一侧让位压缩至自身最小宽，松手时双侧固化持久化，验证：`packages/app` 目录 `bun typecheck` 通过
- [x] 2.5 扩展 Playwright 走查：新增双向推挤场景（拖左栏推挤右栏至 320px 并固化、拖右栏推挤左栏至 220px），验证：`bunx playwright test e2e/novel/workspace-pane-width.spec.ts` 全绿
  - 推挤走查结果：真实拖拽用例覆盖双向推挤与固化。1600px 视口先拖左栏至 1250px（中心保底 30px，右栏 380px 推挤固化到 320px），再把右栏拖至 1350px（左栏推挤固化到 220px）；窗口加宽后压缩结果不回弹。
  - 原走查结果：以 Playwright 真实拖拽自动化（`e2e/novel/workspace-pane-width.spec.ts`，3/3 通过）：1600px 视口左栏拖至动态上限 1190px（越过旧 400 常量）、主区剩约 30px；缩至 1000px 钳制为 590px、还原 1600px 恢复 1190px；双击重置 288px；拖至最小宽度收起、展开按 220px；缩至 500px 右栏自动收边、手动展开按最小宽 320px（钳制下限优先）。走查发现：动态钳制使 600px 窗口（540px 下限总和 + 30 保底内）无需触发自动收边，与 spec 语义一致

## 3. 集成验证

- [x] 3.1 运行集成检查：`packages/app` 目录 `bun typecheck` 零错误，并在仓库根运行 `bun run lint`（oxlint）确认相关文件零告警，验证：两条命令退出码为 0
- [x] 3.2 运行 `packages/app` 目录的模块单测并全绿，验证：`bun test src/pages/novel/workspace-pane-width.test.ts` 退出码为 0

## Workflow follow-up

- 归档前收集 `OpenSpec-Change: pane-dynamic-width` 实现提交写入 tasks.md，运行 `openspec validate pane-dynamic-width`，同步主 specs 后归档。
