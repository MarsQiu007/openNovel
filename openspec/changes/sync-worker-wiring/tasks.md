# Tasks

## 1. worker 多目录生命周期改造

- [x] 1.1 改造 manual-edit-sync-worker：以已知目录集合 + 单定时器替换启动时绑定单一 directory，新增 registerSyncDirectory(directory) 幂等登记（首次登记启动定时器）；验证：包内新增单元测试覆盖「登记两个目录后轮询各自消费各自队列」
- [x] 1.2 增加 inFlight 防重入：一轮 processSyncQueue 未结束跳过下一轮调度；验证：单测模拟慢消费断言不叠加执行
- [x] 1.3 ManualEditSyncHandler.handleChapterContent 扩展 directory 首参，processSyncQueue 消费时传入；验证：既有 upgrade-worker / manual-edit-sync-worker 测试更新后全部通过
- [x] 1.4 在 packages/opennovel 跑 bun typecheck 与 bun run lint 通过

## 2. plugin 章节派生数据重建实现

- [x] 2.1 新增 rebuildChapterDerivedData(db, novelId, chapterId, fingerprint, llm)：读章节正文与书籍上下文（体裁、风格指南），构建 observer prompt（输出 JSON 形状：summary / key_events / char_changes / spine 条目集合）
- [x] 2.2 实现结构化输出解析与校验：字段缺失或形状不符 throw 可读错误；验证：单测覆盖合法输出、缺字段、非 JSON 三种输入
- [x] 2.3 实现落库：chapter_summaries 按指纹 upsert（摘要三要素）；story_spine_entries 先产出新集合再整体替换该章归属条目（新条目带指纹与 synced 状态）；替换前失败不得删空既有条目；验证：单测覆盖替换语义与失败保留
- [x] 2.4 落库后调用 scanEntityReferences 与 ensureSegmentSummaries 幂等刷新该章引用与段摘要，并同步刷新 chapter_summary_fts（导出复用 state-commit 的 FTS 同步函数）；验证：单测断言刷新被调用、FTS 行与摘要一致且按指纹幂等
- [x] 2.5 在 packages/plugin 跑 bun typecheck 与 bun run lint 通过

## 3. serve 组合接线

- [x] 3.1 serve 启动路径注册全局 handler：经 Provider.Service 运行时解析默认模型注入 llm 闭包（generateText），调 registerSyncHandler；模型解析失败时 handler throw 可读错误；验证：单测覆盖「无模型配置时任务 failed 且原因含模型提示」
- [x] 3.2 workspace-routing 的 Local 分支以 Effect.sync 调 registerSyncDirectory(directory)；验证：单测或 httpapi 演练覆盖「本地请求过后该目录队列被消费」
- [x] 3.3 在 packages/opennovel 跑 bun typecheck 与 bun run lint 通过

## 4. 端到端验证

- [x] 4.1 opennovel 包测试全量通过（bun test，排除 main 既有超时基线）
- [x] 4.2 手动 smoke：临时工作区入队一章 upgrade 任务，起 serve 后经带 directory 的请求触发登记，断言该章任务被消费且 chapter_summaries 以新指纹落库
- [x] 4.3 全仓 bun run typecheck 通过、openapi.json 无漂移（本提案未改公开契约，generate 产物应无变化）

## 5. 桌面 sidecar 生产接线回归修复

- [x] 5.1 将 handler 注册收敛到 `Server.listen` 的 `syncWorker` 生产选项，CLI `serve` 与桌面 sidecar 共用该入口；验证：单测或 smoke 覆盖「启用选项后处理器已注册，未启用选项时不注册」
- [x] 5.2 重建 opennovel node dist 并确认桌面 sidecar bundle 包含 handler 注册路径；验证：构建产物 grep 到 `registerNovelSyncHandler` / handler 注册组合
- [x] 5.3 使用 `Server.listen({ syncWorker: true })` 做隔离 smoke：无模型配置时 upgrade 任务失败原因从「处理器未注册」变为「无可用语言模型」，证明桌面 sidecar 同路径不会再落入无 handler 分支
- [x] 5.4 在 packages/opennovel 与 packages/desktop 跑 bun typecheck，并复跑 sync worker 相关测试

## Implementation Commits

- ded310f56 feat(plugin): 实现章节派生数据重建
- 5dcb14904 feat(opennovel): 接线手动编辑同步 worker
- 9d4445203 fix(opennovel): 收敛同步 worker 生产注册
- 8b15248ea fix(desktop): 启用 sidecar 同步 worker
