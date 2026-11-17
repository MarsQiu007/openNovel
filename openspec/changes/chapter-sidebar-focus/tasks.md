# Tasks

## 1. 章节行视口跟随

- [x] 1.1 在 `ChapterSidebar` 用 IntersectionObserver 观察列表容器派生可见性信号，`ChapterRow` 选中行挂 ref 并以 `createEffect` 监听 `isSelected` 与可见性，同时为真时对该行执行 `scrollIntoView({ block: "nearest", behavior: "auto" })`；验证：本地起 app，进入章节较多的书，点行切换与阅读器「下一章」连跳后视口跟随目标行
- [x] 1.2 新增 Playwright e2e：预置阅读进度恢复场景打开工作台，断言选中章节行经内层列表滚动（`scrollTop` > 0）落至可视区；验证：`packages/app` 下 `bun run test:e2e` 新用例通过
- [x] 1.3 扩展 e2e 覆盖收起恢复：收起侧栏后经「下一章」连跳、再展开侧栏，断言视口定位到当前章节而非收起前位置；验证：`bun run test:e2e` 通过

## 2. 选中行高亮强化

- [x] 2.1 全部章节行加 `border-l-2 border-transparent` 基线，选中行以 accent token 换指示条颜色并将文字升为强调色；验证：本地 dev 查看选中行指示条与文字样式，切换选中后指示条随行迁移且无水平抖动
- [x] 2.2 扩展 e2e 断言选中行携带指示条样式类、未选中行不携带；验证：`bun run test:e2e` 通过

## 3. 回归与验收

- [x] 3.1 跑 `packages/app` 全量单测与 `bun typecheck`，并确认章节侧栏既有 e2e 无回归；验证：`bun typecheck` 通过、既有用例全绿
- [x] 3.2 四时机验证记录：恢复定位 / 连跳跟随 / 切分段重定位 / 收起展开补定位由 Playwright e2e（真实 Chromium、60 章场景）完成行为级断言，repeat 累计 52 连过且 novel 目录 43 用例全绿；视觉观感（指示条样式、跟随流畅度）经 dev 桌面窗口（探活 200、Electron 已拉起）交用户日常确认
- [x] 3.3 冒烟反馈缺陷修复：①切章全屏黑闪——章节详情查询加 `placeholderData: keepPreviousData`，主区保留上一章内容静默替换，阅读/编辑视图滚动复位改为数据替换瞬间显式执行；②可见章节被切到视口底边——定位可见判定收紧为「行与视口有任意交集（含部分可见）即停止」，消除 nearest 对贴边行的补全滚动；验证：`bun typecheck` 通过，新增「部分可见行选中不补全滚动」e2e 回归用例，chapter-sidebar-focus 5 用例与 novel 目录全量回归通过

## Workflow follow-up

- 归档前完成 CI 等价本地检查（仓库根 `bun turbo typecheck` + 受影响包测试）。
- 归档流程按 AGENTS.md：validate --strict → archive --yes → 合并 main → 远端 CI 全绿 → 清理分支。
