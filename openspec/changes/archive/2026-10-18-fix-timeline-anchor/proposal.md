# Proposal

## Why

`fix-prepend-anchor` 提案归档的「删除手动 prepend 锚定、交由虚拟器 core 单一负责」结论被 CI 证伪：smoke 套件「keeps the visible message fixed while prepending history」用例出现恒定 44px 像素级偏差（279→235、64→20）。根因是结构性残差——虚拟列表只测量已渲染行，未渲染行保持 `estimateSize` 占位，总高始终含估算误差；core 的测量补偿只覆盖已渲染行，无法消除该残差，像素级稳定只能由手动补偿保证。因此手动锚定必须恢复，且其原有缺陷必须真正修复。

本提案在恢复手动锚定的基础上，逐一定位并修复 e2e 双用例（completion / interruption）稳定失败的全部根因。插桩实证（`--repeat-each 4` 稳定复现）根因共五项：

1. **就绪重复回底竞争**：`useSessionHashScroll` 的无 hash 分支在每次就绪状态变化时重复 `forceScrollToBottom`；历史分页落地会再次触发就绪 effect，此时用户已滚到顶部，重复回底与 prepend 锚定校正把视口拉离锚定位置。修复：按会话键只回底一次。
2. **回底无用户状态守卫**：`forceScrollToBottom` 不检查 `userScrolled`，滚到顶部加载历史时被就绪驱动强行拉回底部。修复：`userScrolled` 为真直接让位。
3. **`followOnAppend` 静态开启**：内容不足一屏时 `isAtEnd` 判定恒真，任何 count 变化都触发虚拟器自动 `scrollToEnd`，留 `scrollState` 并启动 `reconcileScroll` 每帧重放（最长达 5 秒），把视口钉在底部。修复：非底部模式返回 `undefined`，仅底部模式跟随。
4. **回底经虚拟器留 scrollState**：`scrollToEnd` 走虚拟器会在 core 留下目标 offset 的 `scrollState`，`reconcileScroll` 在其后每帧重放目标值，与补偿循环互相改写。修复：`scrollToBottomDom` 直接写 DOM `scrollTop`，不经虚拟器，不留 scrollState。
5. **用户滚动状态判定缺陷**（`create-auto-scroll`）：
   - `stop()` 的 `canScroll` 前置在虚拟列表测量收敛期（`scrollHeight` 短暂坍缩至视口高）误判「不可滚动」而拒绝置位 `userScrolled`，随后底部跟随把视口拖走。修复：移除前置，真·不可滚由 `handleScroll` 的 `canScroll` 分支自清。
   - `nearBottom` 分支无脱离窗口：用户向上滚出底部的起步帧仍落在底部阈值内，`userScrolled` 被立即清回，底部跟随重新拖住视口。修复：`lastUserStopAt` 时间戳 + 300ms 脱离窗口。

以及补偿循环自身的三处缺陷：

6. **补偿公式错误**：原 delta 以捕获时视口几何为基准，捕获发生在测量收敛前（会话标题尚未撑开），基准漂移；且落地瞬间虚拟器自带锚定先改写 `scrollTop`，scroll 事件在 `prependLoading` 期间触发 `updatePrependAnchor` 重捕，视口已被程序位移推走（user 行滚出视口），锚被错选为更靠后的行。修复：锚基准改为内容坐标（`measurementsCache.start`，实测值）+ 捕获时 `scrollTop`，delta = `captureScrollTop + (contentTop - start) - scrollTop`，与视口几何解耦；程序写入（`scrollToFn` / 补偿循环 / `scrollToBottomDom`）记录落地值到 `lastProgramScrollTop`，对应 scroll 事件消费标记、不重捕锚。
7. **测量坍缩假收敛**：锚 item 前方的新行未实测（保持 `estimateSize`）时，补偿循环基于错误几何收敛（视口钉在 maxScroll）；前方行实测收缩后锚定永久偏移。修复：补偿期间经 `prependPinnedIndexes` 信号把锚 item 及其前方所有行钉入 `rangeExtractor` 渲染集强制实测，测量收敛后稳定判定才可信。
8. **双写者拔河**：补偿循环与 TanStack 测量调整（`applyScrollAdjustment`）互为写者。修复：`prependCompensating` 标志接入 `shouldAdjustScrollPositionOnItemSizeChange`，循环运行期间冻结测量引起的滚动调整。

## What Changes

- `packages/app/src/pages/session/timeline/message-timeline.tsx`：恢复手动 prepend 锚定全套（`prependAnchor` / `prependAnchorFrame` / `prependLoading` 与五个函数），补偿循环改为内容坐标公式 + `prependPinnedIndexes` 钉住渲染 + `lastProgramScrollTop` 程序滚动标记；`followOnAppend` 改动态 getter；`scrollToBottomDom` 直写 DOM 并记录程序滚动；恢复 `shouldAdjustScrollPositionOnItemSizeChange` 的非底部模式谓词（前次删除提交夹带的既有行为）。
- `packages/app/src/pages/session.tsx`：`forceScrollToBottom` 增加 `userScrolled` 守卫。
- `packages/app/src/pages/session/use-session-hash-scroll.ts`：无 hash 回底按会话键只执行一次。
- `packages/ui/src/hooks/create-auto-scroll.tsx`：`stop()` 移除 `canScroll` 前置；`nearBottom` 清理增加 300ms 脱离窗口（`lastUserStopAt` 时间戳）。
- `packages/app/src/pages/session/timeline/model.ts` + `model.test.ts`：恢复 `loadOlderTimeline` 的 `before` / `after` 钩子与三个原测试用例（前次删除提交一并删除）。
- `packages/app/e2e/regression/session-timeline-history-root.spec.ts`：probe 增加 settled 判定（签名连续 3 帧不变），hidden 闩锁仅在 settled 后置位——补偿收敛的中间态不再误判；删除调试期 console 监听。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——本次恢复并修复手动 prepend 锚定，使「历史分页插入期间视口可见内容保持可见」的既有行为保证在 CI 与本地稳定成立。该行为由 `session-timeline-history-root.spec.ts` 两个 e2e 用例守护，无 spec 级需求表述的新增或修改，故声明 `skip_specs: true`。）

## Impact

- **packages/app**：恢复约 100 行手动锚定并重构其补偿公式与信号化钉住机制；`session.tsx` / `use-session-hash-scroll.ts` 各加一处守卫。
- **packages/ui**：`create-auto-scroll` 两处交互判定修复（测量坍缩窗口与脱离窗口）。
- **无数据模型 / 协议变更**：不涉及存储结构、HttpApi 或 SDK 产物，无需再生成。
- **兼容性**：修复后行为即 e2e 用例的断言目标（用户已见内容不被加载历史顶出视口）；对用户无感知变化，修复前部分时序下锚定内容被顶出视口。
- **风险**：中——触及滚动核心路径；已通过 52/52 session-timeline 回归 + 3/3 smoke + 8/8 history-root `--repeat-each 4` 验证。本提案同时**修正 `fix-prepend-anchor` 的错误归档结论**（「删除手动锚定」方案因 smoke 44px 像素级回归被证伪，手动锚定是像素级稳定的必要手段）。

## 非目标

1. 不调整虚拟器既有配置语义（`anchorTo: "end"` / `initialOffset` / `estimateSize` 保持现状）。
2. 不处理 `timeline-stability/scroll-interaction.spec.ts` 中两个既有环境敏感失败用例（基线无改动时同样失败，与本次无关）。
3. 不为滚动锚定行为新增加固 spec 条目（行为由 e2e 用例守护，契约化属于独立提案范畴）。
4. 不改变 smoke 用例「keeps the visible message fixed while prepending history」的既有像素断言（44px 偏差由手动锚定恢复后消除，断言维持原样）。
