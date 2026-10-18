# Tasks

## 1. 恢复手动 prepend 锚定并修复补偿循环

- [x] 1.1 恢复 `message-timeline.tsx` 的 `prependAnchor` / `prependAnchorFrame` / `prependLoading` 与 `clearPrependAnchor` / `capturePrependAnchor` / `updatePrependAnchor` / `restorePrependAnchor` / `applyPrependAnchor`，锚基准改为内容坐标（`measurementsCache.start` + 捕获时 `scrollTop`）
- [x] 1.2 `updatePrependAnchor` 重捕由 `lastProgramScrollTop` 程序滚动标记守卫：程序写入引发的 scroll 事件不重捕锚
- [x] 1.3 补偿循环经 `prependPinnedIndexes` 信号钉住锚 item 及其前方所有行（强制实测，防测量坍缩假收敛），退出时清空
- [x] 1.4 `prependCompensating` 标志接入 `shouldAdjustScrollPositionOnItemSizeChange`，循环期间冻结测量引起的滚动调整
- [x] 1.5 `followOnAppend` 改动态 getter：仅 `shouldAnchorBottom()` 为真时返回 `true`，否则 `undefined`
- [x] 1.6 `scrollToBottomDom` 直写 DOM `scrollTop`（不经虚拟器、不留 scrollState），并记录程序滚动标记

## 2. 守卫就绪驱动的回底竞争

- [x] 2.1 `session.tsx` 的 `forceScrollToBottom` 增加 `userScrolled` 守卫：用户已离开底部模式时直接让位
- [x] 2.2 `use-session-hash-scroll.ts` 无 hash 回底按会话键只执行一次（`bottomForcedKey`）

## 3. 修复 create-auto-scroll 的用户滚动判定

- [x] 3.1 `stop()` 移除 `canScroll` 前置：测量坍缩窗口内的交互不再被误判为「不可滚动」，真·不可滚由 `handleScroll` 的 `canScroll` 分支自清
- [x] 3.2 `nearBottom` 清理增加 300ms 脱离窗口（`lastUserStopAt` 时间戳）：向上滚出底部的起步帧不再被立即清回 `userScrolled`

## 4. 恢复 model.ts 的 before/after 钩子

- [x] 4.1 `loadOlderTimeline` 恢复 `before` / `after` 可选参数（含失败路径 `after?.(true)` 与 sessionID 校验）
- [x] 4.2 `model.test.ts` 恢复三个原测试用例（锚恢复提交 / 会话切换后不恢复 / 加载失败释放锚）

## 5. 测试定稿

- [x] 5.1 `session-timeline-history-root.spec.ts` probe 增加 settled 判定（签名连续 3 帧不变），hidden 闩锁仅在 settled 后置位
- [x] 5.2 删除调试期 console 监听与全部源码插桩日志

## 6. 验证

- [x] 6.1 `cd packages/app && bun typecheck` 通过
- [x] 6.2 `cd packages/ui && bun typecheck` 通过
- [x] 6.3 `cd packages/app && bun test src/pages/session/timeline/model.test.ts` 6/6 通过
- [x] 6.4 `cd packages/app && npx playwright test e2e/regression/session-timeline --project=chromium` 52/52 通过
- [x] 6.5 `cd packages/app && npx playwright test e2e/regression/session-timeline-history-root.spec.ts --project=chromium --repeat-each 4` 8/8 通过
- [x] 6.6 `cd packages/app && npx playwright test e2e/smoke/session-timeline.spec.ts --project=chromium` 3/3 通过（含 44px 像素断言）

## Implementation Commits

（提交后回填）
