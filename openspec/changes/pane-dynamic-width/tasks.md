# Tasks

## 1. 宽度派生模块动态化

- [ ] 1.1 在 `packages/app/src/pages/novel/workspace-pane-width.ts` 将 `WORKSPACE_MAIN_MIN_WIDTH` 改为 30，删除 `LEFT_PANE_MAX_WIDTH` / `RAIL_PANE_MAX_WIDTH`，新增共用纯函数 `paneMaxWidth(bodyWidth, otherVisibleWidth)`，验证：模块导出面与 design 决策一致
- [ ] 1.2 重写 `workspace-pane-width.test.ts` 边界断言：覆盖动态上限公式、另一侧收起按 0、保底 30px 的阈值推导，验证：在 `packages/app` 目录 `bun test src/pages/novel/workspace-pane-width.test.ts` 通过

## 2. 工作台接线与钳制渲染

- [ ] 2.1 在 `workspace-frame.tsx` 的现有 ResizeObserver 回调写入 `bodyWidth` signal，`leftPaneWidth` / `railPaneWidth` 渲染输出按 `Math.max(栏最小宽度, Math.min(设定值, paneMaxWidth(bodyWidth(), 另一侧设定宽度)))` 钳制（另一侧收起按 0，上限低于最小宽度时最小宽度优先），验证：`packages/app` 目录 `bun typecheck` 通过
- [ ] 2.2 将左右栏 ResizeHandle 的 `max` 改为动态上限（另一侧收起时按 0 计），验证：拖拽手柄在宽窗口可越过旧 400/560 上限直至主区剩 30px
- [ ] 2.3 手动走查关键场景并记录结果：宽窗口拖栏到动态上限、缩小窗口后设定宽度被钳制且变宽自动恢复、双击重置默认宽度、拖到最小宽度收起、极窄窗口自动收边与手动展开覆盖，验证：`packages/app` 下 `bun run dev` 实测各场景行为与 spec delta 一致

## 3. 集成验证

- [ ] 3.1 在 `packages/app` 目录运行 `bun typecheck` 与 oxlint 检查并通过，验证：零错误零警告
- [ ] 3.2 在 `packages/app` 目录运行本模块相关 bun 测试并通过，验证：`bun test src/pages/novel/workspace-pane-width.test.ts` 全绿

## Workflow follow-up

- 归档前收集 `OpenSpec-Change: pane-dynamic-width` 实现提交写入 tasks.md，运行 `openspec validate pane-dynamic-width`，同步主 specs 后归档。
