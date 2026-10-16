# Design

## Context

见 proposal.md - Why。技术现状：

- `workspace-frame.tsx` 阅读 tab 容器链：`flex flex-col flex-1 min-h-0 px-8 py-6`（高度被 flex 定死）→ 内部 `flex flex-col h-full` 包装 → `ChapterReader` + `ApprovalBar`（`shrink-0`）两个兄弟节点。
- `ChapterReader` 有四个渲染分支，根节点类名不一致：空态 / 加载中 / 错误态均为 `flex-1 min-h-0`，**仅数据加载完成分支为 `h-full`**。
- `h-full` = 父容器内容高度的 100%，与下方固定高度的审批栏相加后超出容器，审批栏落在容器底边之外被裁切，只剩顶部一小条可见。
- 加载完成分支只在章节详情已就绪（缓存命中或请求返回）时渲染，与"有时候"出现的观察一致。

## Goals / Non-Goals

- Goal：阅读区在垂直 flex 容器中弹性伸缩，审批栏作为 `shrink-0` 底部条完整渲染；三个 fallback 分支与加载完成分支的 sizing 写法统一。
- Non-Goal：见 proposal.md 非目标；设计层面不再额外引入任何新的容器节点、不改滚动容器归属（阅读区滚动仍由内部 `flex-1 min-h-0 overflow-y-auto` 承担）。

## Decisions

**D1：把加载完成分支根节点从 `h-full` 改为 `flex-1 min-h-0`，而不是动 `ApprovalBar` 或外层包装。**

- 理由：父容器（`workspace-frame.tsx` 阅读 tab 包装）是 flex column，正确语义就是"阅读区 flex 伸缩、审批栏固定"。`ChapterReader` 自己的三个 fallback 分支已经用了 `flex-1 min-h-0`，本次只是让第四个分支与它们一致，属于修正而非新引入模式。
- 备选方案 1：把外层包装（`workspace-frame.tsx:1136`）的 `h-full` 改掉——不行，该包装高度语义正确，问题不在它。
- 备选方案 2：给审批栏加 `absolute` 定位或改 `ApprovalBar` 内部——会把布局契约扩散到更多组件，且审批栏在 `settled`/`none` 状态下同样以兄弟节点存在，收益不抵复杂度。

**D2：不统一改动 `ChapterEditor`（写作视图）的 `h-full`。**

- 写作 tab 中 `ChapterEditor` 是容器的唯一子节点，`h-full` 恰好等于容器高度，无溢出；强行统一只会增加无行为变化的 diff。

## Risks / Trade-offs

- [回归风险极低但非零：`flex-1 min-h-0` 依赖父级 flex 上下文，若未来有人在阅读区与审批栏之间插入非 flex 中间层会再次破坏] → 本次同时统一四个分支的 sizing 写法，降低未来分支间不一致的概率；spec 中"审批栏完整可见"需求在归档后由主 spec 守护。
- [纯 className 改动无单测覆盖，肉眼回归依赖 e2e] → 既有旅程用例已 mock 章节详情接口，数据就绪后必进入加载完成分支，无需模拟缓存时序；将 Approve/Reject 断言升级为 `toBeInViewport({ ratio: 1 })` 并补窗口压缩复验，使裁切类回归可被自动化拦截（详见 tasks 2.2）。

## Migration Plan

无需迁移：纯前端布局类名调整，无数据、无 API、无依赖变化，发布即生效，回滚即还原类名。

## Open Questions

无。
