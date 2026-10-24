# Timeline Layout Continuity

Run from `packages/app`:

```sh
bun run test:stability
```

The suite runs a production build in one Chromium worker. Selected scenarios use deterministic 4x CPU stress after application readiness. This is a stress profile, not emulation of a specific device.

## What It Proves

The continuity probe samples DOM-derived layout and visibility state across browser render opportunities. Tests declare explicit contracts such as:

- Preserve a visible semantic anchor while the user is away from the bottom.
- Preserve end anchoring while active content grows or new content appears.
- Keep adjacent visible rows ordered without material overlap.
- Keep user-selected disclosure state through updates and virtualization.
- Avoid a sampled blank interval while one visible surface replaces another.
- Preserve logical row and control identity where local state or focus depends on it.
- Keep keyboard, wheel, and nested-scroll ownership consistent during remeasurement.

The suite exercises real browser reducer, projection, component, virtualizer, layout, focus, and interaction code. The backend and event producer are controlled fixtures.

## What It Does Not Prove

The pass/fail oracle does not inspect every compositor-presented pixel. A sample taken after `requestAnimationFrame` is a DOM/layout observation, not proof that every sampled state was displayed or that every displayed frame was sampled.

The suite does not provide complete coverage for:

- Compositor-only or raster-only glitches.
- Color, contrast, canvas, WebGL, masks, irregular clips, or arbitrary occlusion.
- Physical display refresh rates, native OS scaling, or a named low-end device.
- TCP packetization, proxy buffering, or the complete real server/provider pipeline.

Playwright video, trace, screenshots, and observation JSON are diagnostic evidence. They are not pixel baselines and do not participate in normal pass/fail decisions.

For optional before/violation/after screenshots, set `OPENNOVEL_STABILITY_CAPTURE=1`. Capture is opt-in because compositor readback can perturb timing.

## Test Layers

- **Projection:** admitted rows, grouping, labels, and final visible states.
- **Local state:** disclosure state, identity, duplicate delivery, and virtualization restoration.
- **Interaction:** wheel, keyboard, nested scrolling, actionability, and focus behavior.
- **Layout continuity:** anchoring, adjacency, responsive reflow, and visible surface handoffs.
- **Reducer hardening:** validly shaped but intentionally reordered, duplicated, removed, or replaced events.
- **Oracle contract:** pure analyzer and browser sampler calibration tests.

Production-lifecycle fixtures should model states emitted by the current producer. Impossible or reordered sequences belong in reducer-hardening tests and must not be described as normal provider behavior.

## Diagnostics

Failures retain:

- `video.webm`
- `trace.zip`
- failure screenshot
- sampled DOM/layout trace JSON
- event markers and summarized violations

The analyzer records both unclipped layout bounds and ancestor-clipped visible intersections. Scrollbar and raw `scrollTop` changes alone do not fail continuity checks; user-visible semantic anchor movement does.

## V2 迁移注记（timeline-stability-v2）

套件已整体从 V1 wire（`message.updated`/`part.updated`/`session.status`）迁移到 V2 wire（`session.next.*`）。V1→V2 驱动映射的逐场景事实清单（含源码依据）见 `openspec/changes/timeline-stability-v2/design.md`「V1 → V2 语义映射事实清单」（归档后位于 `openspec/changes/archive/` 下同名目录）。要点：

- 流式内容按「帧序列」驱动：`text.started/delta/ended`、`reasoning.started/delta/ended`、`tool.called/progress/success/failed`，帧序必须满足翻译器的有状态前提（种子 running 工具须先补一帧 `tool.called` 登记 call record）。
- busy/idle 无事件推送：翻转走 mock `v2Active` + 事件触发的 `refreshActive()` 对账。
- 中间 part 插删与 message 删除无事件词汇，走「可变 `v2Messages` + `session.next.revert.committed` 强制重拉」reconcile 通路。
- `session.status` 事件禁用：V2 server 不发，套件只发生产词汇。

**DiffSummary 删减依据**：V1 的「DiffSummary show all」场景（interaction 层 1 个 test）在 V2 不可诚实表达——wire `SessionMessageUser` 无 `summary` 字段，`adaptUser` 不产出 summary，`rows.ts` 的 `userMessage.summary?.diffs` 恒为空，该 UI 行在 V2 已无数据供给。伪造数据喂它违反「测真实实现」，故删除该 test；DiffSummary 行死代码的产品侧清理另立提案。

**宿主迁移注记**：独立会话页退役后，会话嵌在书籍工作台右栏。窗口过窄会触发工作台自动收边（`railCollapsed` → 对话面板 `display:none`，属产品预期），原「窄视口」场景改为钉小右栏宽度（fixture `railWidth` 选项），resize 用例的收窄终点保持在收边阈值之上。另外两处与本套件交互相关的产品行为：novel-live 对结算事件有 5s 防抖 invalidate（工作区整页重挂，交互前需确认重挂完成）；autoScroll 底部跟随只认 wheel/touch 手势置位（程序 `scrollTop` 写入会被拉回底部，滚离场景须先派发 wheel 手势）。
