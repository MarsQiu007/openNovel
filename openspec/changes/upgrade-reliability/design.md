# Design: upgrade-reliability

## Context

升级流程当前没有「升级」本身的实体：系统只跟踪同步队列条目（`manual_edit_sync_queue`），升级视图按 `source=upgrade` 过滤计数、重试只认 `failed` 条目、失败原因原文甩给用户。任何状态不一致都会在条目层引爆。2026-10-16 现场事故即四个切面同时发作（详见 proposal.md Why）：

1. 进度分母含 `skipped`（被 dedup 取代的条目），横幅永远显示「升级中：已同步 1/2」；
2. 取代链末端的 `manual` 源条目失败（provider 配额耗尽），升级视图完全不可见；
3. 章节级重试被 source 过滤卡死；
4. 瞬时失败（配额）在 3 次尝试后终止，不指数退避、不到点自动恢复。

关键约束：

- `enqueueManualEditSyncTx` 的去重语义（同指纹 pending→dedupe、同指纹 failed→reset、异指纹 pending/failed→skipped 取代）已服务手动编辑路径，不能破坏；
- Phase 1 四步事务（unified-transactions 刚收敛）不改；
- `chapters.content_fingerprint` 语义陷阱：该列由 Phase 1 写入基线指纹，编辑保存（`markDerivedStale`）**不更新**它，当前也没有任何代码消费它做比较——它只是 Phase 1 的「基线快照」，不是「当前内容」的指纹；
- worker 活性信号需要进程级心跳，桌面端 Electron 主进程托管后端，进程退出即无活性；
- 进度接口已被 app 轮询（`useUpgradeProgress` 5s 间隔），负载形状变化需同步更新 app。

## Goals / Non-Goals

**Goals:**

- 引入 `upgrade_run` 表作为升级的唯一事实源：进度、暂停、重试、横幅全部从 run 聚合；
- 章节状态机 pending → running → synced / waiting-retry / terminal，瞬时失败指数退避 + 到点自动恢复；
- 进度聚合跨来源（取代链跟随），`skipped` 永不入分母；
- 失败分类器输出人话说明 + 行动建议；
- 打开书籍时幂等对账，消解历史幽灵条目；
- 存量数据零迁移（additive schema + 打开时对账）。

**Non-Goals:**

- 不改 Phase 1 四步的事务与步骤构成；
- 不改 observer 重建的产出内容；
- 不引入多章并发重建（worker 逐章串行保持）；
- 不动手动编辑同步的非升级路径语义；
- 不做离线批迁移脚本（对账在打开时惰性完成）。

## Decisions

### D1: `upgrade_run` 表结构

新增两张表（additive schema，不动现有表）：

```sql
CREATE TABLE upgrade_run (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | terminal
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  activated_at INTEGER,                    -- 最近一次从 paused 恢复的时间（用于 ETA 速率基准）
  paused_at INTEGER
);

CREATE TABLE upgrade_run_chapter (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES upgrade_run(id),
  chapter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | synced | waiting_retry | terminal
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,                      -- 当前/最近一次重建开始时间
  completed_at INTEGER,
  resume_at INTEGER,                       -- waiting_retry 的到点自动恢复时间
  failure_class TEXT,                      -- transient_quota | transient_rate | transient_network | terminal_parse | terminal_model | terminal_unknown
  failure_message TEXT,                    -- 人话说明
  failure_action TEXT,                     -- 行动建议
  failure_detail TEXT,                     -- 原始错误文本（可展开细节）
  queue_entry_id TEXT                      -- 当前绑定的同步队列条目（消费回写用）
);
```

**为什么独立表而非在 `manual_edit_sync_queue` 上加列？**

- 队列条目是消费细节（会被 dedup 取代为 `skipped`），run 是用户可见的升级实体；混在一起会让「取代」语义污染升级状态；
- 取代链跟随需要在 run_chapter 上存 `queue_entry_id` 指针，指向当前活跃条目；
- 暂停/续跑是 run 级状态，与队列条目无关。

**替代方案**：在队列上加 `upgrade_run_id` 列 + 状态视图。否决：取代时旧条目 `skipped`，视图需递归跟随取代链，复杂且易错。

### D2: 章节状态机与消费回写

```
pending ──worker 消费──> running ──成功──> synced
                            │
                            ├─ 瞬时失败(有 resume_at) ──> waiting_retry ──到点──> pending
                            ├─ 瞬时失败(无 resume_at, attempts < MAX) ──> pending（指数退避）
                            └─ 终态失败 / 尝试耗尽 ──> terminal
```

- worker 消费某章时，在**同一事务**内把 `upgrade_run_chapter.status` 改为 `running`、`started_at = now`、`queue_entry_id = 当前条目 ID`；
- 重建成功：同一事务内 `status = synced`、`completed_at = now`；
- 重建失败：先跑分类器（D3），再按分类写状态；
- 队列条目本身的 `status`（`manual_edit_sync_queue.status`）照旧由消费逻辑更新，但**不再驱动 UI**；UI 只看 `upgrade_run_chapter`。

**关键不变量**：`upgrade_run_chapter.status` 是聚合视图的唯一来源；`manual_edit_sync_queue` 只是 worker 的消费队列。

### D3: 失败分类器

新增 `classifySyncError(error: unknown): FailureClassification`：

```ts
type FailureClassification = {
  kind: "transient" | "terminal"
  class:
    | "transient_quota"      // provider 配额 / 用量上限
    | "transient_rate"       // 限流 / RPM
    | "transient_network"    // 网络超时 / 连接错误
    | "terminal_parse"       // 内容无法解析
    | "terminal_model"       // 模型不可用 / 未配置
    | "terminal_unknown"
  resumeAt: number | null    // 从错误文本解析出的恢复时间戳
  message: string            // 人话说明（简体中文）
  action: string             // 行动建议
}
```

**恢复时间解析**：从错误文本匹配 `\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(:\d{2})?` 或 `将于\s*(\d{1,2}):(\d{2})` 等模式，解析为本地时间戳。本次事故的错误文本「您的额度将于 2026-10-16 20:51:41 可用」即属此类。

**指数退避**：`backoffMs = min(2^attempts * 60_000, 30 * 60_000)`（1min 起步、上限 30min）；有 `resumeAt` 时优先用 `resumeAt`。

**MAX_ATTEMPTS**：瞬时失败默认 5 次尝试后转 terminal（避免无限退避）。

**D3a: 闸门语义归属**

现状：`upgradePauseEndpoint` / `upgradeResumeEndpoint` 写 `upgrade_state.gate`（`packages/server/src/handlers/novel.ts:3007,3017`），worker 消费时读 `getUpgradeGate`（`manual-edit-sync-worker.ts:87`）。本提案引入 `upgrade_run.status`（active/paused/terminal）后，**废弃 `upgrade_state` 表**，闸门语义并入 run：

- `upgradePauseEndpoint`：把活跃 run 的 `status` 改为 `paused`（无活跃 run 时 no-op）；
- `upgradeResumeEndpoint`：把 `paused` run 的 `status` 改回 `active`，写 `activated_at = now`；
- worker 消费时：查活跃 run，若 `status = 'paused'` 且条目 `source = 'upgrade'`，跳过。

这样消除 `upgrade_state` 与 `upgrade_run` 双闸门不一致的风险（本次事故原因之一即状态分散）。

### D4: 进度聚合查询（跨来源 + 取代链跟随）

`upgradeProgressEndpoint` 改为：

1. 查该小说 `status = 'active'` 的 run（至多一个）；
2. 若 run 存在，按 `upgrade_run_chapter` 聚合：
   - `total = run_chapters.length`
   - `synced = count(status = 'synced')`
   - `failed = count(status = 'terminal')`
   - `pending = count(status = 'pending')`
   - `waiting_retry = count(status = 'waiting_retry')`，每项带 `resume_at`
   - `running = count(status = 'running')`，每项带 `started_at`
3. 若 run 不存在，回退到旧逻辑（兼容尚未对账的存量书）；
4. 负载新增：`current_chapter_id`、`current_chapter_started_at`、`worker_last_poll_at`、`eta_ms`、`waiting_retry_list`。

**取代链跟随**：不需要递归查询——`upgrade_run_chapter.queue_entry_id` 始终指向当前活跃条目；dedup 取代旧条目时，worker 消费新条目会在事务里更新 `queue_entry_id`。取代发生在消费前，UI 只看 run_chapter，天然免疫。

**worker 活性信号**：worker 每次轮询（`processSyncQueue` 入口）在进程内存里记 `lastPollAt`；`/upgrade/progress` 接口在**同一进程**内读取（桌面端单进程，无跨进程问题）。若未来拆分服务，再引入心跳表。

### D5: 重试语义（章节级）

现状：升级重试与手动编辑重试共用 `syncRetryEndpoint`（`packages/server/src/handlers/novel.ts:2911`），接收 `ManualEditSyncRetryInput.entryIds`（`packages/schema/src/novel.ts:1056`）。

改造：`syncRetryEndpoint` 的输入改为 `chapterIds: string[]`（新 schema 字段），语义变为：

1. 在 run 内找这些章节的状态；
2. 若 `terminal`：重置为 `pending`、`attempts = 0`、清失败字段；
3. 若 `waiting_retry`：清 `resume_at`、重置为 `pending`（立即重试）；
4. 若 `synced`：跳过（幂等）；
5. 同时把对应的 `manual_edit_sync_queue` 条目（`queue_entry_id`）重置为 `pending`（若该条目不是 `skipped`）；
6. 若该章没有活跃队列条目（例如被取代后无新条目），用 `enqueueManualEditSyncTx` 入队新条目。

### D6: 存量数据对账

打开书籍时（`upgradeStatusEndpoint` 或 app 侧的 `useUpgradeStatus` 首次查询），若检测到孤儿队列条目（`source = 'upgrade'` 且无活跃 run 归属），触发对账：

1. 按注册表 + 指纹判定重算每章真实状态；
2. 对每章：
   - 若 `chapters.content_fingerprint IS NOT NULL` 且 `chapter_summaries.source_fingerprint = computeFingerprint(chapter.content)`（或该章无摘要记录）：该章已实际完成重建，收编为 synced；
   - 若有 pending / failed 队列条目且无活跃 run：把这些章节纳入新建 run 的目标集合（status = pending）；
   - 若有 skipped 条目且该章内容指纹与摘要指纹一致：收编为 synced；
   - 否则：纳入可升级集合（等待用户显式触发）；
3. 对账在**单个事务**内完成；
4. 对账**零 AI 调用**、**不伪造 synced**（必须有指纹一致证据）。

**触发时机**：`upgradeStatusEndpoint` 检测到孤儿队列条目（不限 source——upgrade 或 manual 源都可能是孤儿）且无活跃 run 时，同步执行对账（数据量小，毫秒级）。

**对账范围**：不限 `source = 'upgrade'`。任何无活跃 run 归属的 pending / skipped / failed 条目都参与对账——manual 源条目同样可能是孤儿（例如取代链末端失败后被跳过）。

### D7: `chapters.content_fingerprint` 语义澄清

该列由 Phase 1 写入基线指纹，编辑保存（`markDerivedStale`）**不更新**它。当前没有任何代码消费它做比较。决策：**保持现状**（Phase 1 基线快照语义），不在本提案中改变；对账用 `computeFingerprint(chapter.content)` 实时计算当前内容指纹，与 `chapter_summaries.source_fingerprint` 比较。

**为什么不在编辑时更新 `content_fingerprint`？** 它会被未来可能的「基线 vs 当前」diff 功能消费；当前改动风险大于收益。

### D8: 横幅状态机（run 驱动）

app 侧 `resolveBannerState` 改为：

```
hidden | prompt | running | waiting | done-with-failures
```

- `prompt`：注册表有未执行任务且无活跃 run；
- `running`：活跃 run 存在且有 `running` 章节；
- `waiting`：活跃 run 存在，无 `running` 章节，但有 `waiting_retry` 章节 → 显示「模型额度已用尽，预计 {time} 自动恢复」；
- `done-with-failures`：run terminal 且有 terminal 章节；
- `hidden`：run terminal 且无 terminal 章节，或无未执行任务。

Phase 1 执行期间：app 在 start 请求返回前显示「确定性回填执行中」（本地状态）。

### D9: worker 心跳

`processSyncQueue` 入口记 `lastPollAt = Date.now()`（模块级变量）；`/upgrade/progress` 返回 `worker_last_poll_at`。app 若发现 `now - worker_last_poll_at > 2 * POLL_INTERVAL`（10s），显示「同步未在运行」。

## Risks / Trade-offs

- **对账误收编**：若 `chapter_summaries.source_fingerprint` 恰好等于当前内容指纹但摘要内容实际过期（例如用户改回原文）→ 缓解：收编条件要求摘要指纹与内容指纹一致，这本身就是「摘要基于当前内容」的定义；若用户改回原文，指纹一致即视为已同步（语义正确）。
- **指数退避雪崩**：多章同时配额失败，同时退避 → 缓解：每章独立 `attempts` 计数，退避时间有随机 jitter（±20%）。
- **进程重启丢失退避状态**：`waiting_retry` 的 `resume_at` 在 DB 里，进程重启后仍可恢复 → 缓解：`resume_at` 持久化，worker 轮询时检查 `resume_at <= now` 的 waiting_retry 章节，自动重置为 pending。
- **run 表无限增长**：每本书的 run 在 terminal 后不再更新 → 缓解：app 只查 active run；terminal run 保留作历史记录（未来可加清理任务）。
- **`upgrade_state` 双闸门残留**：若旧代码路径仍读写 `upgrade_state` 而 worker 已改为查 `upgrade_run.status`，会出现双闸门不一致 → 缓解：本提案一次性把所有读写切到 `upgrade_run`，`upgrade_state` 表保留但代码不再引用；一个版本周期后删除该表。
- **无 handler 的诚实性保护被破坏**：改造 worker 消费逻辑时，可能意外移除「observer 重建 handler 未注册时升级任务禁止确定性 fallback」的保护 → 缓解：在 tasks 中显式新增回归测试覆盖此保护。
- **worker 活性信号在渲染进程不可见**：`lastPollAt` 记在 Node 进程（Electron 主进程）模块里；若未来 app 直接读 SQLite（不经过 HTTP），该信号不可见 → 缓解：当前架构下 HTTP 是唯一读取路径，Risks 已记录此简化。

## Migration Plan

1. 新增 `upgrade_run` + `upgrade_run_chapter` 表（additive schema，drizzle migration）；
2. `upgrade_state` 表保留但不再读写（一个版本周期后删除）；
3. 部署后打开书籍时自动触发对账（无需用户操作）；
4. 旧版本 app 对新负载：缺 `current_chapter_id` 等字段时按 `undefined` 处理，不显示新信息但不崩溃（现有降级约定）；
5. 回滚：删两张新表即可，旧逻辑（source=upgrade 过滤）在代码里保留一个版本周期。

## Open Questions

（无——设计决策均已在本文件中闭环。）
