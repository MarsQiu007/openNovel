# Proposal

## Why

`session-timeline-history-root.spec.ts` 的两个用例（completion / interruption，断言「历史分页插入期间视口可见内容不被顶出视口」）在 CI 与本地稳定失败，导致 main 的 e2e 持续红。

插桩实证根因：`message-timeline.tsx` 的手动 prepend 锚定补偿机制（`applyPrependAnchor`）与 TanStack Solid Virtual 虚拟器 core 的内部 offset/anchor 校正互相拔河——组件每帧按 DOM 实测 delta 补偿 `scrollTop`，虚拟器随即按自己的内部状态写回滚动位置，delta 恒定非零（45 或 5），`stable >= 30` 的收敛条件永远不可达，rAF 循环永不退出，锚定内容最终被顶出视口 ~95px，用例探针判定 hidden。

关键实验证据：将手动锚定整体禁用（`updatePrependAnchor` 首行 return）后，两个用例通过，滚动事件序列正常（`scrollTop` 0 → 311 → 0，无死循环）。虚拟器 core 的 `anchorTo: "end"` 自带锚点校正已完整覆盖 prepend 场景，手动补偿不仅多余，还是拔河死锁的制造者。该组件历史提交显示锚定逻辑自初始提交后从未被改过——属潜伏时序竞争，近期 CI 运行环境的帧时序变化将其暴露。

## What Changes

- 删除 `packages/app/src/pages/session/timeline/message-timeline.tsx` 的手动 prepend 锚定机制：`prependAnchor` / `prependAnchorFrame` / `prependLoading` 三个变量，`clearPrependAnchor` / `capturePrependAnchor` / `updatePrependAnchor` / `restorePrependAnchor` / `applyPrependAnchor` 五个函数，`setHistoryAnchor` prop 及其类型，手势处理器（wheel / touch / pointer / keydown）中的锚点清理调用，scroll 处理器中的锚点更新调用。
- 简化 `packages/app/src/pages/session.tsx`：删除 `captureHistoryAnchor` / `restoreHistoryAnchor` 变量与 `setHistoryAnchor` 接线，`loadOlder` 不再传递 before/after 回调。
- 简化 `packages/app/src/pages/session/timeline/model.ts`：`loadOlderTimeline` 删除 `before` / `after` 可选参数（含失败路径的 after 调用）。
- 更新 `packages/app/src/pages/session/timeline/model.test.ts`：改写依赖 before/after 钩子的三个用例（钩子已不存在），保留 loadMore 调用次数与错误传播断言。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——本次是删除与虚拟器 core 竞争的冗余手动补偿，恢复时间线 prepend 场景「视口可见内容保持可见」的既有行为保证。该行为由 `session-timeline-history-root.spec.ts` 两个 e2e 用例守护，无 spec 级需求表述的新增或修改，故声明 `skip_specs: true`。）

## Impact

- **packages/app**：净删约 100 行；历史分页期间的视口锚定改由虚拟器 core 单一负责，消除双写者竞争。
- **无数据模型 / 协议变更**：不涉及存储结构、HttpApi 或 SDK 产物，无需再生成。
- **兼容性**：修复后行为即既有期望行为（e2e 用例的断言目标），对用户无感知变化；修复前部分环境下锚定内容会被顶出视口。
- **风险**：低——虚拟器 core 的锚点校正是 TanStack Virtual 的内置能力（`anchorTo: "end"` 配置自初始提交已存在），已通过 52/52 session-timeline 回归用例验证。

## 非目标

1. 不调整虚拟器配置（`anchorTo` / `followOnAppend` / `scrollEndThreshold` / `scrollToFn` 等保持现状）。
2. 不处理 `timeline-stability/scroll-interaction.spec.ts` 中两个既有环境敏感失败用例（`tracks keyboard scrolling from a focused timeline descendant` 与 `handles a single row taller than the viewport`——基线无改动时同样失败，与本次修复无关）。
3. 不为滚动锚定行为新增加固 spec 条目（行为由 e2e 用例守护，契约化属于独立提案范畴）。
