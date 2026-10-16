# Tasks

## 1. 抽取审查面板并注册进右栏

- [x] 1.1 将 `packages/app/src/pages/novel/approval-bar.tsx` 的 `ReviewPanel` 抽取为独立组件文件（如 `review-panel.tsx`），数据查询与信息结构原样迁移；验证 `bun typecheck`（在 `packages/app` 下）通过
- [x] 1.2 在 `workspace-frame.tsx` 注册「审查」面板：`RAIL_PANELS` 追加 `{ key: "review", icon: ..., label: "审查" }`（图标从现有图标集选取），peek 挂载区与 expand 挂载区（`key === "review"` 分支）各接入一份组件实例；验证工作台渲染无异常

## 2. 审批栏入口改造

- [x] 2.1 审批栏移除内嵌 `showReview` 分支与展开/收起按钮，原位置改「审查详情」按钮（硬编码中文，避让既有 i18n「查看审查」跳转会话按钮）：点击执行 `setRailPanel("review")` + 清 `railManual` + `setSearchParams({ tab: "panel:review" })`（与 `openRailPanel("review")` 语义等价）；通过/驳回按钮与驳回意见框保持不动；验证 `bun typecheck` 通过
- [x] 2.2 在 `openRailPanel` 中追加审查默认 expand 特判（与 `structure` 同模式）；验证图标列点击审查图标与审批栏「审查详情」两条路径均进入 expand 态，Esc/返回恢复 peek

## 3. 验证

- [x] 3.1 在 `packages/app` 下运行 `bun test --preload ./happydom.ts ./src`，确认无回归
- [x] 3.2 扩展 `e2e/novel.spec.ts` 审批旅程：在 mock 路由中为 `GET /api/novel/:novelID/chapters/:chapterID/chapter-reviews` 补数组响应（默认兜底 `{}` 会让打开面板的查询读到非数组，现有旅程未打开过审查面板故未暴露）；审批栏断言不再出现「展开审查」，点击「审查详情」后断言审查面板（expand 态）可见且包含轮次/评级内容，返回后审批栏按钮（toBeInViewport({ ratio: 1 }) 断言）不回归；验证 `bun run test:e2e e2e/novel.spec.ts` 通过

## Workflow follow-up

- 归档前用 `OpenSpec-Change` trailer 收集实现提交，写入本文件 `## Implementation Commits`。
- 运行 `openspec validate review-rail-panel`，同步主 specs 后归档并提交归档移动。
