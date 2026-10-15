# Tasks

## 1. 修复迁移（packages/app · e2e/performance/timeline）

- [ ] 1.1 `session-timeline-stress.fixture.ts` 增加并导出 `novelID`（`novel_smoke_timeline`）；`timeline-test-helpers.ts` 新增 `injectSessionLink` 小工具（注入指定 id/href/text 的 anchor 供会话打开入口复用）；`cd packages/app && bunx playwright test --list --config e2e/performance/playwright.config.ts` 收集通过（编译与导入无错）
- [ ] 1.2 first-navigation 场景 3 改书内直连（setup 补 `mockNovelWorkspaceAPIs`、goto `novelWorkspaceURL`、卡片定位改书内 href、`destinationPath` 同步），删除场景 1/2 及 `stressDraftHref` 等失效引用；运行 `timeline/first-navigation-benchmark.spec.ts` 通过并输出 BENCHMARK
- [ ] 1.3 parent-hydration 书内化（setup goto 与打开入口 `injectSessionLink` 均改书内 href，补 `installTimelineSettings` + `mockNovelWorkspaceAPIs`）；运行 `timeline/session-parent-hydration-benchmark.spec.ts` 通过
- [ ] 1.4 session-timeline fixture 迁移（goto `novelWorkspaceURL` + novel mock + 右栏宽度 init script + `newLayoutDesigns` 默认改 `true`）；运行 `timeline/session-timeline-benchmark.spec.ts` 全场景通过

## 2. 改写与下线（同目录）

- [ ] 2.1 flash 场景 1 书内化（`injectSessionLink` 两次切换 + `installCachedRepaintProbe` targetHref 改书内 href），删除场景 2（标签预取）；运行 `timeline/session-tab-flash.spec.ts` 通过
- [ ] 2.2 home-tab 场景 2 书内化（`injectSessionLink` 打开 +「content 先于 review body」采样保留），删除场景 1/3；运行 `timeline/home-tab-navigation-benchmark.spec.ts` 通过
- [ ] 2.3 删除 `timeline/session-tab-switch-benchmark.spec.ts`；`git grep` 确认无引用残留且 Playwright 收集通过
- [ ] 2.4 删除 `timeline/navigation-milestones.ts` 与 `unit/navigation-milestones.test.ts`；`git grep` 确认无引用残留

## 3. 同步与文档

- [ ] 3.1 `timeline-test-helpers.ts` 删除 `installStressSessionTabs` / `stressSessionHref` / `stressDraftHref` / `stressServer`，删除 `unit/timeline-test-helpers.test.ts`；`cd packages/app && bun test ./e2e/performance/unit` 全绿
- [ ] 3.2 `e2e/performance/README.md` 重写套件构成（书内导航 / 冷会话水合 / 缓存重绘 / 流式 / review pane 与 scaling）与 Chrome trace 示例（换到现存 spec）；核对文中命令与文件名均存在

## 4. 集成验证

- [ ] 4.1 受影响 spec 完整复跑（生产构建）：first-navigation、parent-hydration、session-tab-flash、home-tab-navigation、session-timeline-benchmark 全场景 + review-pane-scaling 代表档（`-g` 过滤 1 文件 / 100 文件档），全绿且输出 BENCHMARK
- [ ] 4.2 `cd packages/app && bun test ./e2e/performance/unit` 全绿；根目录 `bun run lint` 0 错误
- [ ] 4.3 `openspec validate performance-benchmark-refresh --strict` 通过且 tasks 勾选完整

## Workflow follow-up

- 提交实现改动（按逻辑拆分提交，带 `OpenSpec-Change: performance-benchmark-refresh` trailer）；提案工件提交为 `docs(openspec): 建立 performance-benchmark-refresh 提案`
- 用 `git log --grep "OpenSpec-Change: performance-benchmark-refresh"` 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 推送 → CI generate / typecheck / test 全绿（性能套件不在 CI 触发范围，以本机复跑为验收证据）→ 归档（skip_specs 无需同步主 specs）→ ff 合并 main → 推送 → 清理本地与远端分支并 prune
- 关闭 issue #14：评论附根因、修复内容、验证证据（本机复跑 + main CI 绿跑链接）与 reopen 指引