# Tasks

## 1. 修复阅读区根节点 sizing

- [x] 1.1 将 `packages/app/src/pages/novel/chapter-reader.tsx` 中 `ChapterReader` 加载完成分支的根节点类名从 `flex flex-col h-full` 改为 `flex flex-col flex-1 min-h-0`（空态/加载态/错误态分支已是该写法，保持不动），并验证 `bun typecheck`（在 `packages/app` 下）通过
- [x] 1.2 在 `packages/app` 下运行 `bun test --preload ./happydom.ts ./src`，确认阅读器相关单测无回归

## 2. 验证审批栏完整可见

- [x] 2.1 运行 `packages/app` 既有审批流 e2e（`bun run test:e2e`，覆盖 `e2e/novel.spec.ts` 中审批用例），确认通过/驳回操作路径不回归
- [x] 2.2 自动化复核 spec 场景并防回归：在 `e2e/novel.spec.ts` 既有审批旅程用例中（`page.route` 已 mock 章节详情，数据就绪后阅读区必然进入加载完成分支），把 Approve / Reject 按钮的可见性断言升级为 `toBeInViewport({ ratio: 1 })`（Playwright 1.59.1 支持，断言元素完整位于视口内——修复前审批栏底边溢出视口、ratio < 1，断言必失败）；随后 `page.setViewportSize` 压缩窗口高度再次断言仍完整可见。验证 `bun run test:e2e` 通过

## Implementation Commits

- `2e0534b1d` fix(app): 阅读视图审批栏完整可见——阅读区根节点改用弹性伸缩
- `1c7f18157` test(app): 审批旅程用例断言按钮完整位于视口

## Workflow follow-up

- 归档前用 `OpenSpec-Change` trailer 收集实现提交，写入本文件 `## Implementation Commits`。
- 运行 `openspec validate approval-bar-clip`，同步主 specs 后归档并提交归档移动。
