# Design: agent-background-job-recovery

> 2026-10-23 穷尽式审查重写：三路侦察（Job 地基 / 流水线断点 / desktop UI）全部以 file:line 证据核实后，原种子设计的范围裁定大幅调整。本文自包含，不依赖被替换的旧版。

## 1. 现状核查（侦察结论，全带证据）

### 1.1 Job 恢复地基（agent-task-subagent 交付，仍完好）

- subagent 后台作业恢复已闭环：KV `job.background/<notificationID>` 持久化（`packages/core/src/background-job.ts:13-46`）、`SessionRestart.recover` 启动扫描（`packages/core/src/session/execution/restart.ts:120-133`，唯一调用点 `packages/opennovel/src/server/routes/instance/httpapi/server.ts:273-287`）、attempts 预算 >10 终态化（`restart.ts:79-91`）、notificationID 幂等重放（`packages/core/src/session/subagent-completion.ts:21-46` + `packages/core/src/session.ts:334-353` admission 同 id 吞重放）。
- v1-removal 只削 V1 wrapper（`ea4d4df699`，-153/+5），恢复路径未动；测试在位（`packages/core/test/session-restart.test.ts` 5 例 + `background-job-recovery.test.ts`）。
- **fork 既定语义：恢复通知一律 `resume: false`，父会话续跑由用户/模型决定**（`restart.ts:61-71`）；恢复 at-least-once，「不防崩溃后的重复外部副作用」（`restart.ts:34-36`）。

### 1.2 写作流水线不经过 Job 通道（核心问题）

- director 以前台方式 dispatch @pipeline：`agents/director.ts` 与 `agents/pipeline.ts` 全文无 `background` 字样，subagent 工具默认前台 `jobs.block`（`packages/core/src/tool/subagent.ts:274-296`）。
- 前台作业不写 KV：`persistBackground` 要求 recovery + notificationID 同时存在（`background-job.ts:211-222`），notificationID 只在转后台时分配（`background-job.ts:395-407`）。
- **结论：写到第 12 章崩溃 → KV 零记录 → 重启后恢复扫描为空 → 批量循环无声死亡**，直到用户再次发话。现有 Job 恢复覆盖不到写作流水线。

### 1.3 批量进度无持久化

- 「当前章/剩余数」只存在于 director 对话上下文（`agents/director.ts:168-177` 连续多章批量写作，单次最多 10 章）。
- `advance_chapter` 纯 advisory：只做 `chapter_number + 1` 返回文本，不落库（`tools/chapter.ts:275-290`，已抽查核实）。
- pipeline 严格单章（`agents/pipeline.ts:206-208`），步骤 1 直接信任传入章号、无进度自检（`agents/pipeline.ts:90-93`）；`list_chapters` 工具存在（`chapter.ts:327-359`）但无 prompt 指示用它自检。
- 半章残骸两种形态无任何机制识别：write 后 sync 前崩（有正文 status=draft、无状态提交）；writer 生成中崩（空 content、status=outline）。

### 1.4 幂等债（断点续跑前置）

- `novel_state_log` append-only，重跑一章重复追加（`state-commit.ts:1132-1145`）。
- `story_spine` 无条件追加，重跑产生重复主轴条目（`state-commit.ts:2127-2131`）。
- `.novel/state-log.md` 纯 append（`state-commit.ts:214-240`）。
- 原设计种子声称的「chapter-status 严格状态机」已成死代码，仅测试引用（`chapter-status.ts:14-28,56-99`；live 路径靠 prompt 约定 + `updateChapter` 裸 update `packages/novel-store/src/index.ts:1596-1608`）。本提案不复活该状态机，live 值域（outline/draft/revised/pending_review/final/rejected）即为判定输入。

### 1.5 UI 与事件链基础

- 写作流水线状态条已存在（`packages/app/src/pages/novel/workspace-frame.tsx:902-913`，数据源 `session.active` 对账）；UpgradeBanner 是现成的横幅模式（`upgrade-banner.tsx`，五态纯函数状态机 + `useUpgrade*` 查询钩子）。
- toast 机制完备支持 actions（`packages/app/src/utils/toast.tsx:16-28`）；SSE 单流自带重连，`server.connected` 触发 bootstrap 全量重拉（`packages/server/src/handlers/event.ts:39` → `server-sdk.tsx` → `bootstrap.ts`）。
- desktop（Electron）崩溃时仅原生对话框，sidecar 崩溃仅写日志；启动期无「上次未正常退出」感知；resume/recover 类 i18n 键零存在。

## 2. 范围裁定

| 原种子范围 | 裁定 | 依据 |
|---|---|---|
| 写作流水线章节级断点 | **保留**（本提案核心，重构为 D1–D6） | §1.2–1.4 |
| shell recovery kind 启用 | **切除**，移交未来「bash durable status」独立 change | shell kind 全仓零构造点；bash 走 PTY/AppProcess 不进 Job 体系（`packages/core/src/tool/bash.ts:71-73` TODO 自证）；`background-job.ts:12` 与 `restart.ts:125` 两处现行代码声明「shell 随 bash durable status 另立」。现无 shell 作业可恢复，纳入即空转 |
| desktop 崩溃后重连 UI 提示 | **切除 desktop 包改动**，可见性需求由 D6 在 app 层满足 | SSE 断连→自动重连→`server.connected`→bootstrap 重拉 `session.active()` 的既有链已覆盖重启后状态对账；desktop 加崩溃标志检测相对横幅方案是纯增量复杂度 |
| 作业持久化/启动扫描（原提案 Why 的泛化表述） | **不重复立项** | 已由 agent-task-subagent 交付（§1.1） |

## 3. 设计决策

### D1 恢复语义 = 可见 + 一键续跑，不做全自动续跑

崩溃后：已完成章节正文本就在库（`write_chapter` 即落库），批量意图经 D2 持久化；用户回到书籍工作台看到中断横幅（D6），一键续跑从下一章继续。

否决全自动续跑的理由：① 违反 fork 既定的 `resume: false` 语义（§1.1）；② at-least-once 恢复下写作副作用（章节正文、状态提交）的重复代价远高于通知重放，需要人工确认入口；③ 写作是创意任务，用户重启后未必想立即继续烧钱生成。

### D2 批量任务实体落 novel-store（`writing_batch` 表）

批量意图是写作域数据，归属写作域自有存储（`.novel/novel.db`），app 已经 `server.novel.*` 面消费 novel 状态；不进 core KV（避免跨域 join）。

```ts
// snake_case 列名（Drizzle 约定）；一书同时至多一个批量任务
writing_batch = sqliteTable("writing_batch", {
  novel_id: text().primaryKey(),
  session_id: text().notNull(),          // 发起批量的 director 会话（续跑入口）
  start_chapter: integer().notNull(),
  total: integer().notNull(),
  last_completed_chapter: integer(),     // 单调 max 更新，重跑幂等
  status: text().notNull().default("running"), // running | completed | cancelled
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})
```

- 进度派生：`completed = last_completed_chapter - start_chapter + 1`（可空时 0）。单调 max 更新使同章重跑不重复计数。
- **`interrupted` 不存储**：查询期派生——`status = running` 且 `session_id` 不在活跃会话集合。避免启动扫描与崩溃标志，server 端点 join 活跃会话面即得。

### D3 进度推进落库：`begin_writing_batch` 工具 + `advance_chapter` 改造

- 新增 `begin_writing_batch({novel_id, start_chapter, total})`：upsert running 记录；`session_id` 取自 `createNovelWriterTools({ session: ctx.session })` 的工具上下文（`novel-writer-v2.ts:37`）；注册进 `tools/index.ts` 工厂，director 权限映射加 `begin_writing_batch: "allow"`（对齐 `agents/pipeline.ts:40` 模式）。
- `advance_chapter` 保持签名不变，内部追加：`last_completed_chapter = max(last_completed_chapter, chapter_number)`、`updated_at` 刷新；`last_completed_chapter = start_chapter + total - 1` 时 `status = completed`。
- director prompt 批量节改写（`director.ts:168-177`）：① 批量首步必调 `begin_writing_batch`；② 每章 dispatch 前以 `list_chapters` 核对实际进度（给既有「不重复已完成章」约定补上工具支撑）；③ 收到「继续批量写作」类请求时，查批量记录 + `list_chapters` 定断点后续跑，不凭对话记忆。

### D4 pipeline 残骸处理约定（prompt 层三态判定）

pipeline prompt 新增「断点续跑自检」段：dispatch 章先查 `list_chapters` 状态，按下表入步——

| 章状态 | 判定 | 入口 |
|---|---|---|
| content 为空（status=outline） | 未写或写作中崩 | 正常 8 步 |
| content 非空且 status=draft | write 后 sync 前崩 | 跳过写作段，从 audit 段续跑 |
| status=pending_review / final / revised | 已写待审或已完成 | 视为完成，报告后由 director 推进下一章 |

`content` 非空判定用既有 `read_chapter_content`；不再引入新查询工具。状态语义以 live 值域为准，不复活 chapter-status 死代码（§1.4）。

### D5 幂等修复（章节可重跑前置）

1. `novel_state_log`：章级删除并入 `resetChapterScopedState`，事务内顺序调整为 reset → 日志写入（`state-commit.ts:1130-1148`）。
2. `story_spine`：同章条目锚点内替换（`第N章：` 到下一章标记或文末为一块），不再纯追加。
3. `.novel/state-log.md`：同章段落锚点（`> 章节：<id>`）替换，不再纯 append。
4. **（实现期发现，测试暴露）**character create 路径重跑撞 characters 主键：reset 只清章级状态、characters 是书级实体，同章重跑时角色行已存在仍走插入分支。修复为「存在则跳过插入」，章级角色状态行仍按 reset 后重建。

### D6 可见性：`server.novel` 查询面 + 工作台中断横幅

- server：`packages/server/src/handlers/novel.ts` 新增 `writing-batch` 查询端点（返回批量记录 + 派生 interrupted）；放弃动作复用同端点的 cancel 写面（`status = cancelled`）。SDK 面变更后按仓库约定跑 `packages/client` 的 `bun run generate`，不手改 `src/generated*`。
- app：`workspace-frame.tsx` 顶部挂 `BatchRecoveryBanner`（UpgradeBanner 同款位置与纯函数状态机模式）：interrupted 时显示「批量写作中断：已完成 M/N 章 [续跑] [放弃]」。续跑 = 经既有 V2 prompt 面向 `writing_batch.session_id` 会话发送「继续批量写作」；放弃 = cancel 写面。查询经 `novel-queries.ts` 新增钩子，失效跟随既有 novel 查询族。
- i18n：zh/en 只新增键，不动既有键。
- desktop 包零改动（§2 裁定）。

## 4. 备选方案与否决

| 方案 | 否决理由 |
|---|---|
| A. pipeline dispatch 改 `background=true` 接入 KV 恢复 | recoverSubagent 只续跑子会话（严格单章），`resume: false` 下 director 批量循环仍断；且把前台可观测的生成过程转入后台，改变既有交互语义。不解决循环接续，徒增通道迁移 |
| B. 启动扫描全自动唤醒 director 续跑 | 违反 `resume: false` 既定语义；at-least-once 下写作副作用重复代价高（D1） |
| C. 批量状态存 core KV | 批量意图是写作域数据，app 查询须跨域 join；novel-store 是既有归属（D2） |
| D. 复活 chapter-status 严格状态机作为断点判定 | 已是死代码，live 值域足够支撑 D4 三态判定；复活 = 双重状态语义 |

## 5. 测试策略

- novel-store：`writing_batch` CRUD、单调推进（重复 advance 同章不重复计数）、completed 派生、单批量约束（upsert）。
- plugin：`begin_writing_batch` 落库与会话绑定解析；`advance_chapter` 落库幂等；state-commit 三处修复后同章两次 commit 无重复行（state_log / story_spine / state-log.md）。
- app e2e（V2 mock）：横幅出现（interrupted 派生：批量 running + 会话不活跃）、续跑点击向绑定会话发 prompt、放弃后横幅消失。
- 守门：相关包 `bun typecheck`、根 oxlint 0 errors、plugin + novel-store 测试、app e2e 相关 spec 绿。
