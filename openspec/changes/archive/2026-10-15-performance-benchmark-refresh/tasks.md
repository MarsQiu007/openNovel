# Tasks

## 1. 修复迁移（packages/app · e2e/performance/timeline）

- [x] 1.1 `session-timeline-stress.fixture.ts` 增加并导出 `novelID`（`novel_smoke_timeline`）；`timeline-test-helpers.ts` 新增 `injectSessionLink` 小工具（注入指定 id/href/text 的 anchor 供会话打开入口复用）；`cd packages/app && bunx playwright test --list --config e2e/performance/playwright.config.ts` 收集通过（编译与导入无错）
- [x] 1.2 first-navigation 场景 3 改书内直连（setup 补 `mockNovelWorkspaceAPIs`、goto `novelWorkspaceURL`、卡片定位改书内 href、`destinationPath` 同步），删除场景 1/2 及 `stressDraftHref` 等失效引用；运行 `timeline/first-navigation-benchmark.spec.ts` 通过并输出 BENCHMARK
- [x] 1.3 parent-hydration 书内化（setup goto 与打开入口 `injectSessionLink` 均改书内 href，以 `installTimelineSettings` 替代 `installStressSessionTabs` 并补 `mockNovelWorkspaceAPIs`）；运行 `timeline/session-parent-hydration-benchmark.spec.ts` 通过
- [x] 1.4 session-timeline fixture 迁移（新增 `novelID` 常量、goto `novelWorkspaceURL` + novel mock + 右栏宽度/视口选项 + `newLayoutDesigns` 默认改 `true`；review pane 场景用 1920×1080 + `railWidth: 1400` 避免预览工具栏折叠）；运行 `timeline/session-timeline-benchmark.spec.ts` 全场景与 `timeline/review-pane-scaling-benchmark.spec.ts` 1/100 文件档通过
- [x] 1.5 收集边界修复：performance config `testIgnore` 排除 `**/*.test.ts` 与 `timeline-stability/**`，stability config 重置 `testIgnore: []`；`--list` 收集验证 performance 14 tests（node 与 bun 双通道）、stability 44 tests 全量列出

## 2. 改写与下线（同目录）

- [x] 2.1 flash 场景 1 书内化（移除 `installStressSessionTabs`、补 `mockNovelWorkspaceAPIs` 与 `injectSessionLink` 两次切换、`installCachedRepaintProbe` targetHref 改书内 href），删除场景 2（标签预取）；运行 `timeline/session-tab-flash.spec.ts` 通过
- [x] 2.2 home-tab 场景 2 书内化：冷加载书内 target + 预置检视栏打开（`opennovel.global.dat:layout`），MutationObserver + rAF 双通道采样「content 先于 review body」过渡并断言 v2 检视正文可见；删除场景 1/3；运行 `timeline/home-tab-navigation-benchmark.spec.ts` 通过
- [x] 2.3 删除 `timeline/session-tab-switch-benchmark.spec.ts`；`git grep` 确认无引用残留且 Playwright 收集通过
- [x] 2.4 删除 `timeline/navigation-milestones.ts` 与 `unit/navigation-milestones.test.ts`；`git grep` 确认无引用残留

## 3. 同步与文档

- [x] 3.1 `timeline-test-helpers.ts` 删除 `installStressSessionTabs` / `stressSessionHref` / `stressDraftHref` / `stressServer`，删除 `unit/timeline-test-helpers.test.ts`；顺带修复 `unit/mock-server.test.ts` 假 page 缺 `addInitScript` 的既存失败；`cd packages/app && bun test ./e2e/performance/unit` 40 用例全绿
- [x] 3.2 `e2e/performance/README.md` 重写套件构成（书内导航 / 冷会话水合 / 缓存重绘 / 流式 / review pane 与 scaling）与 Chrome trace 示例（换到现存 spec）；核对文中命令与文件名均存在

## 4. 集成验证

- [x] 4.1 受影响 spec 完整复跑（生产构建）：first-navigation、parent-hydration、session-tab-flash、home-tab-navigation、session-timeline-benchmark 全场景 + review-pane-scaling 代表档（`-g` 过滤 1 文件 / 100 文件档），全绿且输出 BENCHMARK
- [x] 4.2 `cd packages/app && bun test ./e2e/performance/unit` 全绿；根目录 `bun run lint` 0 错误
- [x] 4.3 `openspec validate performance-benchmark-refresh --strict` 通过且 tasks 勾选完整

## Workflow follow-up

- 提交实现改动（按逻辑拆分提交，带 `OpenSpec-Change: performance-benchmark-refresh` trailer）；提案工件提交为 `docs(openspec): 建立 performance-benchmark-refresh 提案`
- 用 `git log --grep "OpenSpec-Change: performance-benchmark-refresh"` 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 推送 → CI generate / typecheck / test 全绿（性能套件不在 CI 触发范围，以本机复跑为验收证据）→ 归档（skip_specs 无需同步主 specs）→ ff 合并 main → 推送 → 清理本地与远端分支并 prune
- 关闭 issue #14：评论附根因、修复内容、验证证据（本机复跑 + main CI 绿跑链接）与 reopen 指引

## Implementation Commits

- `6c930c910` docs(openspec): 建立 performance-benchmark-refresh 提案
- `82197d557` docs(openspec): 更新 performance-benchmark-refresh 提案（审查修正）
- `298ce485c` docs(openspec): 更新 performance-benchmark-refresh 提案（补收集边界修复）
- `0a88cac69` test(app): 迁移 performance 基准到书内会话路由
- `3cc4674bd` test(app): 改写并下线标签时代的 performance 场景
- `27328216b` test(app): 修复 performance 套件收集边界与过期单测
- `b26990b38` docs(app): 更新 performance 套件构成说明
