# Tasks: agent-background-job-recovery

> 三波串行（Wave 2 依赖 Wave 1 的表与幂等；Wave 3 依赖 Wave 1 的查询数据源）。每波完成立即勾选并过守门。设计依据见 design.md（D1–D6 与现状核查证据）。

## Wave 1 — novel-store 批量实体与幂等修复

- [x] 1.1 新增 `writing_batch` 表（design D2 字段：novel_id PK / session_id / start_chapter / total / last_completed_chapter / status / created_at / updated_at，snake_case）与 CRUD 面（upsert running、单调 advance、completed 派生、cancel；含区间外章节不推进守卫）
- [x] 1.2 state-commit 幂等修复四处：`novel_state_log` 章级重置进 `resetChapterScopedState`（事务顺序调为 reset→日志写入）、`story_spine` 同章锚点替换、`.novel/state-log.md` 同章段落替换、character create 重跑撞书级主键改存在即跳过（测试暴露的第四处，design D5.4）
- [x] 1.3 单测：novel-store `writing-batch.test.ts` 9 例（CRUD/单调推进/派生/区间守卫/终态不可逆）+ plugin `state-commit-idempotency.test.ts`（同章两次 commit 三处无重复）；reliability 既有两例同步对齐新语义（日志章级一份 6→3、回滚失败注入换 FK 路径）
- [x] 1.4 **守门**：`packages/novel-store` typecheck + 231/231 绿；`packages/plugin` typecheck + 910/910 绿

## Wave 2 — 插件工具与 prompt 续跑语义

- [x] 2.1 新增 `begin_writing_batch` 工具（upsert running 记录；session_id 取自 ToolContext.sessionID），经 `chapterTools` 静态对象随工厂注册（tools/index.ts 展开无需改动）并在 director agent 权限映射加 `begin_writing_batch: "allow"` / `get_writing_batch: "allow"`（`agents/director.ts`，对齐 `pipeline.ts:40` 的既有模式）
- [x] 2.2 `advance_chapter` 落库改造：签名不变，`last_completed_chapter` 单调 max 推进 + 末章转 completed（幂等），输出追加批量进度后缀
- [x] 2.3 director prompt 批量节改写（`director.ts` 连续多章批量写作节）：批量首步必调 begin、逐章 dispatch 前 `list_chapters` 核对、续跑请求按记录定断点
- [x] 2.4 pipeline prompt 新增「步骤 0：断点续跑自检」段（design D4 三态表：空 content 全步 / draft 有正文从 audit 续 / revised+ 跳过）
- [x] 2.5 plugin 测试：`writing-batch-tools.test.ts` 6 例（begin 落库与会话绑定/替换/校验、advance 幂等推进/末章 completed/无批量静默跳过）；`multi-chapter-batch.test.ts` 断言同步新契约
- [x] 2.6 **守门**：`packages/plugin` typecheck 绿 + 916/916 测试绿

## Wave 3 — server/app 中断可见性

- [x] 3.1 writing-batch 查询端点 + cancel 写面：schema 增 `WritingBatch` DTO，protocol 增 `GET /:novelID/writing-batch`（NullOr，interrupted 派生：running 且 session_id 不在 SessionV2.active）与 `POST /:novelID/writing-batch/cancel`（无 running 批量时报错），server handler 接线
- [x] 3.2 `packages/client` 跑 `bun run generate` 重生 SDK（generated/generated-effect 三文件，未手改）
- [x] 3.3 app `BatchRecoveryBanner`（`resolveBatchBannerState` 纯函数 + workspace-frame 顶部挂载，novelID 取路由参数——既有 mock detail 返回数组形，`data.novel!.id` 不可靠）：续跑向 session_id 发 V2 prompt「继续批量写作」并跳转该会话；放弃走 cancel；附纯函数单测
- [x] 3.4 i18n zh/en/zht 新增 6 个 `novel.batchRecovery.*` 键（只增不改，parity 测试绿）
- [x] 3.5 app e2e `batch-recovery-banner.spec.ts` 4 例（横幅出现/活跃不显示/续跑 prompt 断言+跳转/放弃消失；locale 钉 zh）；mock 基建 `novel-workspace.ts` 增 writingBatch/cancel/prompt 捕获；`./novel/**/*.spec.ts` 已在 e2e tsconfig glob 内无需改
- [x] 3.6 **守门**：app/client/server/protocol/schema typecheck 全绿 + 根 oxlint 0 errors + server 150/150 + 新 e2e 4/4 绿

## 收尾

- [x] 4.1 更新 tasks.md 勾选与 Implementation Commits（`git log --grep "OpenSpec-Change: agent-background-job-recovery"`）
- [ ] 4.2 `openspec validate agent-background-job-recovery --strict` 绿
- [ ] 4.3 归档（`npx openspec archive agent-background-job-recovery --yes`，确认无残留）并 ff 合入 main（不推送，推送时机由用户定）

## Implementation Commits

- `0df258447f` feat(novel-store): writing_batch 批量任务实体与 state-commit 幂等修复（Wave 1）
- `34105b1f96` feat(plugin): 写作批量 begin/get 工具与断点续跑 prompt 语义（Wave 2）
- `b5469527c4` feat(server): writing-batch 查询/放弃端点与工作台中断横幅（Wave 3）
