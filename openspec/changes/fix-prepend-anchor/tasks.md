# Tasks

## 1. 删除手动 prepend 锚定机制

- [x] 1.1 删除 `message-timeline.tsx` 中 `prependAnchor` / `prependAnchorFrame` / `prependLoading` 变量与 `clearPrependAnchor` / `capturePrependAnchor` / `updatePrependAnchor` / `restorePrependAnchor` / `applyPrependAnchor` 五个函数
- [x] 1.2 删除 `setHistoryAnchor` prop 及其类型定义、createEffect 注册与 onCleanup 清理
- [x] 1.3 删除手势处理器（handleListWheel / handleListTouchStart / handleListPointerDown / handleListKeyDown）中的 `clearPrependAnchor` 调用与 handleListScroll 中的 `updatePrependAnchor` 调用
- [x] 1.4 删除 `maybeAnchorBottom` 与 `onCleanup` 中的锚定清理残留

## 2. 拆除 session.tsx 的 history anchor 接线

- [x] 2.1 删除 `captureHistoryAnchor` / `restoreHistoryAnchor` 变量与 `setHistoryAnchor` prop 传递
- [x] 2.2 `loadOlder` 改为无参调用 `timeline.history.loadOlder()`

## 3. 简化 model.ts 的 loadOlderTimeline

- [x] 3.1 删除 `before` / `after` 可选参数及失败路径的 after 调用，`loadOlder` 不再透传 options

## 4. 更新 model.test.ts

- [x] 4.1 「loads exactly one opaque cursor page」改为只断言 loadMore 调用次数
- [x] 4.2 删除「does not restore an anchor after the session changes」（after 钩子已不存在，该行为随之移除）
- [x] 4.3 「releases the anchor when loading history fails」改写为「propagates history load failures」，只断言错误传播

## 5. 验证

- [x] 5.1 `cd packages/app && bun typecheck` 通过
- [x] 5.2 `cd packages/app && bun test src/pages/session/timeline/` 25/25 通过
- [x] 5.3 `cd packages/app && npx playwright test e2e/regression/session-timeline --project=chromium` 52/52 通过（含修复目标 history-root 两个用例）
- [x] 5.4 基线对照确认 `timeline-stability/scroll-interaction.spec.ts` 两个失败用例为既有环境问题（无改动时同样失败）

## Implementation Commits

- `b195333af` fix(app): 删除与虚拟器拔河的手动 prepend 锚定补偿
