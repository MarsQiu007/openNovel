# Tasks

## 1. app：首帧收敛 — 数据分级与单一首帧门（workspace-data / workspace-frame）

- [x] 1.1 `packages/app/src/pages/novel/workspace-data.ts`：张力出列——删除 `useTension` 调用、`tension` 载荷字段与对应 loading/error 门控项；全仓核对 `data.tension` 零消费方（张力面板自查询同 queryKey）；`cd packages/app` 下 `bun typecheck` 通过
- [x] 1.2 `packages/app/src/pages/novel/workspace-frame.tsx`：引入组合判定 `firstFrameReady` 替代 `Show when={!data.loading}` 门条件——合并首帧数据（detail / volumes / chapters）、持久化就绪（readingProgress / perBookState / layout）、回跳决策落定、展开态同步与现场落值完成；加载门语言保持现状（Spinner + novel.workspace.loading），并为加载态补 `data-slot` 观测标记；`bun typecheck` 通过
- [x] 1.3 回跳定址入门口内：未选中会话时按可决性收敛——列表加载中保持门关闭；列表为空且重拉（refetch / 空守卫）未落定时保持门关闭（不复用旧空结果）；非空列表、空结果落定或自愈重试耗尽时决策；回跳以 `navigate(..., { replace: true })` 一次定址（不在历史残留被替换的中间条目）；发起前校验仍处于同一 novelID（快速连切书丢弃过期决策）；失败态按「无回跳」开门、不无限自旋；`bun typecheck` 通过
- [x] 1.4 展开态在门内以 replace 同步地址（不再出现「打开后弹开面板」）；展开态持久化同步调整为首帧落定后才开始（书切换过渡态不写回；重启/重进恢复语义保持）；`bun typecheck` 通过
- [x] 1.5 章节选中与左栏模式在门内落值：阅读进度就绪后校验 ID（失效回落首章并回写进度），首个内容帧即为最终现场；`bun typecheck` 通过
- [x] 1.6 回跳失败态呈现：归属会话集合查询失败（自愈重试耗尽）时，对话面板主体呈现失败占位与重试入口（与切换器失败态一致），不呈现懒创建空态；重试成功后照常自动回跳；`bun typecheck` 通过

## 2. app：恢复时序（乐观恢复 + 静默补校验）

- [x] 2.1 `workspace-frame.tsx`：大纲 / 世界观 / 关系选中改为门内乐观恢复（直接应用持久化值），随各自查询数据就绪做静默补校验（仅失效时回落，接受罕见路径一次修正）；移除「三查询全就绪才统一恢复」的翻转窗口；选择联动继续同步写存档（恢复重跑幂等）；`bun typecheck` 通过

## 3. app：挂载副作用迁移与实时失效修复

- [x] 3.1 云同步 autopilot 触发位置迁移：`packages/app/src/app.tsx` 在 `SelectedServerProviders` 内新增挂载组件调用 `createCloudSyncAutoPilot()`（与 `NewLayout` 同层，实现语义保持——启动执行一次 + 页面前台 60s 轮询 + beforeunload beacon）；`workspace-frame.tsx` 移除调用；核对进入书籍工作台不再产生 `/api/sync/run`；`bun typecheck` 通过
- [x] 3.2 实时失效作用域修复：`packages/app/src/context/novel-live.ts` 的 `useNovelLiveInvalidation` 改为 accessor 签名（订阅与定时器保持单份，失效判定与 bindings 过滤在调用时读取当前位置）；`workspace-frame.tsx` 调用点同步；以真实 QueryClient 新增单测覆盖「切书后失效命中当前书、不命中旧书」（复用真实实现、无 mock）；`bun test` 通过

## 4. app：读取类查询缓存保留

- [x] 4.1 `packages/app/src/context/novel-queries.ts`：新增共享常量（30 分钟）并为读取类 novelKeys 查询族逐 hook 应用 `gcTime`（detail / volumes / chapters / tension / outline / world-entries / characters / chapter / annotations / style-guide 等挂载即重取的读取族）；`bound-sessions` / `sync-status` 等实时类保持现状（staleTime 0 与重拉语义不动）；`rg` 核对覆盖清单与边界；`bun typecheck` 通过

## 5. e2e 与集成验证

- [x] 5.1 新增 `packages/app/e2e/novel/book-open-transition.spec.ts`：书架打开存在归属会话的书籍——注入中间态观测（MutationObserver 记录加载态 / 懒创建空态 / 阅读视图出现序列），断言从加载态直达最终会话视图，全程不出现被替换的中间态；必要时为懒创建空态补 `data-slot` 观测标记
- [x] 5.2 同 spec：打开过程不请求张力端点（次要数据不阻塞首帧）；打开右侧「节奏」面板后张力照常加载（面板自查询）；以请求记录断言
- [x] 5.3 同 spec：预置持久化（阅读进度 / 左栏模式 / 右栏面板 / 展开态）→ 首个内容帧即恢复现场，无默认态闪烁
- [x] 5.4 同 spec：标签切换与关闭标签落入相邻书两入口同样直达（多书标签场景）
- [x] 5.5 同 spec：绑定会话查询失败场景——不呈现懒创建空态（失败占位 + 重试），恢复后照常自动回跳
- [x] 5.6 在 packages/app 运行 `bun run test:unit`、`bun run test:browser` 通过；Playwright 相关子集全绿：`e2e/novel/book-open-transition.spec.ts`、`e2e/novel.spec.ts`、`e2e/novel/session-book-routing.spec.ts`、`e2e/novel/novel-live.spec.ts`、`e2e/novel/workspace-pane-width.spec.ts`
- [x] 5.7 根 `bun run lint` 0 错误；`openspec validate book-open-transition --strict` 通过；收敛证据（三入口中间态观测序列、改动前后对照）记录到完成汇报

## Workflow follow-up

- 提案工件提交 `docs(openspec): 建立 book-open-transition 提案`；实现提交（app 单包）带 `OpenSpec-Change: book-open-transition` trailer
- 收集实现提交写入 `## Implementation Commits`，单独提交记录更新
- 推送 → CI generate / typecheck / test 全绿 → 归档（含 delta specs：先 sync 主 specs 再 archive）→ ff 合并 main → 推送 → 清理本地与远端分支并 prune

## Implementation Commits

- `e03087c67` fix(app): 工作台首帧收敛——单一首帧门与回跳定址（首帧数据分级 + firstFrameReady 组合门；回跳定址收敛 + replace 定址 + 同书校验）
- `2931dd36c` fix(app): 读取类小说查询缓存保留 30 分钟（detail / volumes / chapters 等读取族 gcTime 30min，bound-sessions 等实时族不动）
- `b4f84b2de` fix(app): 书籍打开首帧收敛——展开态地址门控、跨书回跳隔离与定址门（修复 useBoundNovelSessions 跨书缓存投毒；openingRouting 定址门修切换/关闭标签白屏闪烁）
- `a37514f6e` test(app): 新增书籍打开首帧收敛 e2e 与观测标记（7 用例覆盖打开/切换/关闭三入口直达与失败态）
