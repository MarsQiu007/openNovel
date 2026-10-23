# Tasks: agent-background-job-recovery

> 三波串行（Wave 2 依赖 Wave 1 的表与幂等；Wave 3 依赖 Wave 1 的查询数据源）。每波完成立即勾选并过守门。设计依据见 design.md（D1–D6 与现状核查证据）。

## Wave 1 — novel-store 批量实体与幂等修复

- [x] 1.1 新增 `writing_batch` 表（design D2 字段：novel_id PK / session_id / start_chapter / total / last_completed_chapter / status / created_at / updated_at，snake_case）与 CRUD 面（upsert running、单调 advance、completed 派生、cancel；含区间外章节不推进守卫）
- [x] 1.2 state-commit 幂等修复四处：`novel_state_log` 章级重置进 `resetChapterScopedState`（事务顺序调为 reset→日志写入）、`story_spine` 同章锚点替换、`.novel/state-log.md` 同章段落替换、character create 重跑撞书级主键改存在即跳过（测试暴露的第四处，design D5.4）
- [x] 1.3 单测：novel-store `writing-batch.test.ts` 9 例（CRUD/单调推进/派生/区间守卫/终态不可逆）+ plugin `state-commit-idempotency.test.ts`（同章两次 commit 三处无重复）；reliability 既有两例同步对齐新语义（日志章级一份 6→3、回滚失败注入换 FK 路径）
- [x] 1.4 **守门**：`packages/novel-store` typecheck + 231/231 绿；`packages/plugin` typecheck + 910/910 绿

## Wave 2 — 插件工具与 prompt 续跑语义

- [ ] 2.1 新增 `begin_writing_batch` 工具（upsert running 记录；session_id 取自 `createNovelWriterTools({session})` 上下文），注册进 `tools/index.ts` 工厂并在 director agent 权限映射加 `begin_writing_batch: "allow"`（`agents/director.ts`，对齐 `pipeline.ts:40` 的既有模式）
- [ ] 2.2 `advance_chapter` 落库改造：签名不变，`last_completed_chapter` 单调 max 推进 + 末章转 completed（幂等）
- [ ] 2.3 director prompt 批量节改写（`director.ts:168-177`）：批量首步必调 begin、逐章 dispatch 前 `list_chapters` 核对、续跑请求按记录定断点
- [ ] 2.4 pipeline prompt 新增断点续跑自检段（design D4 三态表：空 content 全步 / draft 有正文从 audit 续 / pending_review+ 跳过）
- [ ] 2.5 plugin 测试：begin 落库与会话绑定解析、advance 幂等（同章重复调用不重复推进）
- [ ] 2.6 **守门**：`packages/plugin` typecheck + 测试绿

## Wave 3 — server/app 中断可见性

- [ ] 3.1 `packages/server/src/handlers/novel.ts` 新增 writing-batch 查询端点（记录 + interrupted 派生：running 且 session_id 不活跃）与 cancel 写面
- [ ] 3.2 `packages/client` 跑 `bun run generate` 重生 SDK（不手改 `src/generated*`）
- [ ] 3.3 app `BatchRecoveryBanner`（UpgradeBanner 同款纯函数状态机 + workspace-frame 顶部挂载）：interrupted 显示「批量写作中断：已完成 M/N 章 [续跑] [放弃]」；续跑向 session_id 会话发 V2 prompt「继续批量写作」；放弃走 cancel 面
- [ ] 3.4 i18n zh/en 新增横幅文案键（只增不改）
- [ ] 3.5 app e2e（V2 mock）：横幅出现（running + 会话不活跃）、续跑点击断言 prompt 发送、放弃后横幅消失；spec 加入 e2e tsconfig include
- [ ] 3.6 **守门**：`packages/app` 等受影响包 typecheck + 根 oxlint 0 errors + 新 e2e spec 绿

## 收尾

- [ ] 4.1 更新 tasks.md 勾选与 Implementation Commits（`git log --grep "OpenSpec-Change: agent-background-job-recovery"`）
- [ ] 4.2 `openspec validate agent-background-job-recovery --strict` 绿
- [ ] 4.3 归档（`npx openspec archive agent-background-job-recovery --yes`，确认无残留）并 ff 合入 main（不推送，推送时机由用户定）

## Implementation Commits

（执行中按波次补记）
