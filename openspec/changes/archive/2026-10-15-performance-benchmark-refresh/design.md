# Design

## Context

动机与失效证据见 `proposal.md · Why`。本设计聚焦「每个场景怎么迁移、哪些下线、如何保证复跑可验证」。可直接引用的先例：

- `regression/subagent-child-navigation.spec.ts`（`7c72859ff`）：书内工作台内子代理卡片一步直达 `/:dir/novel/:novelID/session/:id`、无独立路由中间态——first-navigation 场景 3 的迁移模板。
- `performance/timeline-stability/fixture.ts`（`6d6b5b209`）：`mockNovelWorkspaceAPIs` + `novelWorkspaceURL` + 右栏宽度 init script（`opennovel.global.dat:novel.workspace.layout.v1` 设 `railPanel: chat, railWidth: 1100`）——session-timeline fixture 的迁移模板。

影响方案的关键事实：

- 标签终态（`tab-route.ts`）：标签栏只承载书籍标签；`migrateTabs` 启动时清洗 session/draft 标签；`/new-session` 路由已不存在。
- 新布局默认开启（`newLayoutDesignsDefault = true`），书内路由只在新布局注册；`session-timeline-benchmark.fixture` 现默认写 `newLayoutDesigns: false`，书内迁移后必须为 `true`。
- `mock-server.ts` 对 `/api/novel/session-bindings` 兜底为空数组——书内直连不查绑定；经独立路由重定向宿主才会因无绑定降级书架（旧 spec 全部因此断）。
- 既有 probes 与 mock 基础（`measureFirstNavigation`、`measureSessionSwitch`、`classifySessionSwitch`、`installCachedRepaintProbe`、`mockStressTimeline`）与标签形态无关，可原样复用。

## Goals / Non-Goals

**Goals:**

- 7 个 spec 中保留 14 个可复跑场景（迁移 12 + 改写 2），删除 7 个语义退役场景，不残留死代码。
- 保留诊断价值最高的断言语义：无空白帧（`blankSamples === 0`）、冷会话水合时序、缓存重绘 run-length、流式吞吐与 review pane scaling。
- 复跑证据：`bun run test:bench` 子集在本机生产构建下通过并输出 `BENCHMARK` 行。

**Non-Goals:**

- 不新增指标、不引入机器相关阈值（延续套件 AGENTS.md：只断言场景与采集完成）。
- 不把注入链接手法升级为真实 UI 交互改造（会话切换器 MenuV2 交互脆弱，不适合作基准入口；注入链接是本套件既定诊断手法）。
- 不做 probe 通用化重命名，也不重命名 `home-tab-navigation-benchmark.spec.ts`（内容收敛为书内会话打开）——重命名只会扩大 diff。
- 不重建书架→书籍导航基准。

## Decisions

### D1. first-navigation 场景 3：书内直连（备选：保留 `/server` 路由 + 绑定 mock）

- 采用：setup 用 `mockStressTimeline` + `installTimelineSettings` + `mockNovelWorkspaceAPIs`（`directory` / 新增 `novelID` / `boundSessionIDs` 含三个 fixture 会话），`page.goto(novelWorkspaceURL(directory, novelID, sourceID))`；点击子会话卡片 `a[href="/${base64Encode(directory)}/novel/${novelID}/session/${childID}"]`，`destinationPath` 同步为该路径。
- 理由：卡片在 session-direct-nav 终态就是一步直达书内地址（subagent-child-navigation 已验证）；走 `/server` 老路由需额外 mock 绑定并引入重定向中间态，采样会测到「宿主 replace」而非真实首帧导航。
- 场景 1/2（unvisited session tab / new session page）直接删除：形式已退役且无对应产品行为（`/new-session` 路由不存在；会话不再是标签）。
- stress fixture 增加 `novelID` 常量（`novel_smoke_timeline`）。

### D2. parent-hydration：入口书内化，probe 不动（备选：改由会话切换器打开）

- 采用：setup goto 与注入 anchor href 都改 `novelWorkspaceURL(directory, novelID, targetID)`，以 `installTimelineSettings` 替代 `installStressSessionTabs` 并补 `mockNovelWorkspaceAPIs`；`measureSessionSwitch` 按 href 匹配点击、按消息 ID 判定 destination/source，与路由形式无关，保持不动。
- 保留「target 不在会话列表 + `/session/:id` 接口 mock」的孤儿最新轮次设定。
- 理由：该 benchmark 测的是「冷点击 → 最新轮次水合」，入口是诊断装置而非用户旅程；改真实入口会引入无关变量。

### D3. session-timeline fixture：照抄 timeline-stability 迁移模板（备选：直连旧路由 + 绑定 mock）

- 采用：新增 `novelID` 常量（`novel_timeline_stream`）；`page.goto(novelWorkspaceURL(directory, novelID, sessionID))`；`mockNovelWorkspaceAPIs`（`boundSessionIDs` 含 fixture 会话）；右栏宽度 init script 收敛为 fixture 选项（`railWidth` 默认 1100、`viewport` 默认 1366×768）；`newLayoutDesigns` 默认改 `true`（原默认 `false` 是旧独立页遗留，书内路由要求新布局）。
- 复跑发现：1366 视口下 rail 会被三区保底（主区 160px + 左栏 288px）钳制到 ~918px，检视布局被压成「侧栏 240 + 预览 ~160」，v2 预览工具栏在 ~160px 宽下折叠重叠（"下一文件"按钮被分段控件盖住）。review pane 场景改用 1920×1080 + `railWidth: 1400`（预览列 ~560px）；流式场景不受影响，维持默认档位。
- 原不传 `newLayoutDesigns` 的流式场景 1 随之收敛为新布局（旧独立页布局已日落，书内宿主只存在于新布局）。
- 连带恢复流式 5 场景与 review pane 5 场景（spec 侧断言与探针不动；scroller 定位沿用 `has: [data-timeline-row]` 过滤）。
- 理由：`6d6b5b209` 已把同构迁移完整验证过（含右栏视区与 mock 组合），照抄一致性最高、风险最低。

### D4. flash 场景 1：缓存重绘书内化（备选：下线）

- 采用：goto 书内 target（访问并缓存）→ 注入 anchor（书内 source）点击切走 → `installCachedRepaintProbe(targetHref = 书内 target)` → 注入 anchor（书内 target）点击切回 → 采集（run-length 压缩与 `samples.length > 0` 断言保留）。
- 采用时移除 `installStressSessionTabs` 引用、补 `mockNovelWorkspaceAPIs`；场景 2（prefetch every open session tab）删除：标签预取语义退役。
- 理由：缓存回访重绘是书内切换的真实体验风险点（隐藏会话面板重挂载/重排）；repaint probe 与标签无关。
- 注入链接小工具（`injectSessionLink`）被 D2/D4 两处使用（D5 定案后不再需要注入入口），收敛到 `timeline-test-helpers`（不预提取更多抽象）；`text` 缺省时给默认可见文本——零尺寸锚点不可点击，flash 场景需真实点击。

### D5. home-tab 场景 2：书内冷加载会话打开；场景 1/3 与 navigation-milestones 下线（备选：场景 2 直接下线）

- 实施定案：场景 2 由「注入 anchor 同页切换」调整为「冷加载书内 target + 预置检视栏打开」（`opennovel.global.dat:layout` 设 `review.panelOpened: true`）。两个实测原因：书内同页切换时 review 面板外壳由 latch（session.tsx `reviewPanelV2Rendered`）保持挂载，「content 先于 review body」只在冷加载首挂载（`deferRender`）窗口可观察；且书内工作台检视栏默认收起（`DEFAULT_REVIEW_PANEL_OPENED = false`），不预置则没有 review 正文可被分阶段渲染。
- 采样改为 MutationObserver + rAF 双通道，按状态跃迁记录 `(content, review)`：存在 `(true, false)` 过渡即 `contentBeforeReview = true`；断言 review 正文 `session-review-v2` 最终可见（`newLayoutDesigns: true` 下检视实现为 v2）。实测过渡：418.8ms（仅内容）→ 455ms（内容 + review）。
- 场景 1/3 删除：书架已不渲染会话行（书架卡片打开的是书籍）、标签关闭语义退役。
- `navigation-milestones.ts` 与 `unit/navigation-milestones.test.ts` 随场景 1/3 下线一并删除（失去使用者；与 first-navigation probe 的测量重叠，避免死代码）。
- 理由：保留「内容先于 review」这一可观测产品契约；里程碑采样器在没有使用者的前提下不保留。

### D6. session-tab-switch 整文件下线（备选：改写为会话切换器基准）

- 采用：删除 `session-tab-switch-benchmark.spec.ts`（2 场景）。等价性能覆盖由 D2（冷切换水合）+ D4（缓存重绘）承担。
- `session-tab-switch-probe.ts` / `session-tab-switch-metrics.ts` 与其单测保留（D2/D4 共用），命名遗留接受（Non-Goal）。
- 理由：标签冷/热切换没有对应产品行为；为「切换器下拉选择」重造基准属于新场景设计，成本高且非 issue 目标。

### D7. 同步物与一致性

- `timeline-test-helpers`：删除 `installStressSessionTabs` / `stressSessionHref` / `stressDraftHref` / 内部 `stressServer`；保留 `installTimelineSettings` / `mockStressTimeline` / `createReviewDiffs`。
- `unit/timeline-test-helpers.test.ts`：删除（原仅测 `stressSessionHref`，无剩余被测面）。
- `README.md`：套件构成改写为现行内容（书内导航、水合、缓存重绘、流式、review pane/scaling）；Chrome trace 示例命令换到保留 spec。

### D8. 收集边界修复（实施中发现）

- 现状：`timeline-stability/fixture.test.ts`（`bun:test` 风格）会被 performance config 收集（`testDir: "."` 且 `testIgnore` 仅 `"unit/**"`），使 `test:bench` 的全目录收集在 node（`bun:` 协议错误）与 bun（`describe` 越界错误）下都直接失败——性能套件自初始提交起就无法整体复跑，属本变更「可复跑」目标的必要条件。
- 采用：performance config 的 `testIgnore` 改为 `["unit/**", "**/*.test.ts", "timeline-stability/**"]`；`timeline-stability/playwright.config.ts` 显式 `testIgnore: []` 重置继承（该模式会误排其目录下的 spec）。
- 理由：`bun test` 风格文件由 `bun test` 运行；timeline-stability 有自己的 config 与 `test:stability` 入口，不属本套件范围。收集验证：performance 14 tests（node 与 bun 双通道）、stability 44 tests 全量列出。
- 同时修复 `unit/mock-server.test.ts` 假 page 缺少 `addInitScript` 契约（`mock-server.ts` 固定配色方案后该单测直接 TypeError），`bun test ./e2e/performance/unit` 40 用例全绿——`test:bench` 入口的第一步可复跑。

## Risks / Trade-offs

- [书内右栏视区与旧独立页不同] → `railWidth: 1100` 设定接近旧视区（默认档位；应力类场景的时序采样不依赖绝对像素）；实测 1366 视口下 rail 被三区保底钳制到 ~918px，review pane 场景改用 1920×1080 + `railWidth: 1400`，确保检视预览可用（工具栏不折叠）。保留断言语义均为相对时序/run-length。
- [工作台内可能有多个 scroll-view] → scroller 定位沿用 `has: [data-timeline-row]` 过滤；若仍歧义，实施时按唯一性收敛（不改变断言语义）。
- [review body 在书内面板的渲染顺序与旧会话页存在差异] → 已实测：冷加载下「内容先于 review body」契约成立（检视栏预置打开 + 冷加载）；同页会话切换因面板 latch 不再重挂载、不属于该契约场景。断言按冷加载事实固化，未降级下线。
- [删除 navigation-milestones 后如需书架→书籍导航基准] → 另立提案重建，不属于本变更补救范围。
- [重档位耗时] → review-pane-scaling 以 `-g` 过滤跑代表档位（1 文件 + 100 文件档）；10000 文件档为可选，fixture 修复后按需可跑全档。

## Migration Plan

- 纯测试/文档改动；回滚 = revert 本变更提交。
- 提交拆分：修复迁移（D1-D3）→ 改写与下线（D4-D6）→ 收集边界与过期单测修复（D8 + README 同步）→ 归档前记录（tasks/design）；随后 `openspec validate --strict` → 推送分支 / PR 三 workflow 全绿 → 归档（skip_specs 无需同步主 specs）→ 合并 main → 确认 main 管线全绿 → 关闭 issue #14。

## Open Questions

（无。书架→书籍导航基准、性能 CI 集成均列为非目标，留待需要时另立提案。）