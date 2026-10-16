# Proposal: upgrade-reliability

## Why

升级流程缺乏一个「升级」本身的实体：系统只跟踪同步队列条目，升级视图按 `source=upgrade` 过滤计数、重试只认 `failed` 条目、失败原因原文甩给用户——任何状态不一致都会在条目层引爆。2026-10-16 现场事故即四个切面同时发作：《执棋人》第 1 章重建真实失败（provider 配额耗尽，重试 3 次后终止，恢复时间 20:51 已随错误返回）发生在取代链末端的 `manual` 源条目上，升级视图完全不可见；被 dedup 取代的 `upgrade` 条目停在 `skipped` 却计入进度总数，横幅永远显示「升级中：已同步 1/2」；失败计数为 0 导致重试按钮不出现；配额恢复后系统不会自动恢复。用户要求一次可靠修复，而不是在队列上继续打点状补丁。

## What Changes

- **引入升级运行（upgrade run）实体**：用户确认升级即创建 run，记录目标章节集合（来自 Phase 1 后的待重建判定），每章跟踪显式状态机（pending → running → synced / failed）。run 到达终态（全部章节吸收）后升级才算完成；进度、暂停、重试、展示全部以 run 为唯一事实源，同步队列退回 Phase 2 的消费实现细节，其 `skipped` / `failed` / `synced` 状态经消费回写映射进 run，不再直接驱动任何 UI 计数。
- **进度聚合跨来源**：进度按 run 的目标章节聚合，取代链（dedup supersede）两端自动跟随到该章最新条目，`skipped` 不再出现在任何分母中；`manual` 源条目只要覆盖 run 内章节即并入该章进度。进度负载携带当前正在重建的章节（含开始时间）、worker 活性信号（最近轮询时间）与按已同步速率推算的预计剩余时间。
- **瞬时失败分类与自动恢复**：失败按可恢复性分类。provider 配额/限流/网络类瞬时错误 SHALL 指数退避自动重试；错误文本携带恢复时间（如本次事故的「额度将于 20:51 可用」）时 SHALL 到点自动续跑，不消耗用户显式重试。内容解析失败、模型不可用类终态错误 SHALL 保留人工重试入口。失败原因 SHALL 给出人话分类与行动建议（如「模型额度已用尽，预计 20:51 恢复，届时自动继续」），不再展示原始错误文本。
- **重试语义面向章节**：升级视图的重试操作以 run 内章节为单位——找到该章最新非吸收态条目重置，或为其入队新条目；不再要求条目 `source=upgrade` 且 `failed`。既有「进程启动不自动重试」约束对终态错误保持不变，瞬时错误的自动恢复不受此限（它不是用户启动的隐式重试，是未完成的执行）。
- **横幅状态机改为 run 驱动**：`prompt`（有待执行任务）→ `running`（含当前章节、ETA、活性）→ `waiting`（瞬时失败退避中，显示恢复时间）→ `done-with-failures`（分类原因 + 建议）/ `hidden`。Phase 1 执行期间（`start` 请求未返回）横幅 SHALL 显示「确定性回填执行中」，消除点击后的静默窗口。
- **存量数据对账**：打开书籍时若存在历史遗留的孤儿队列条目（如无 run 归属的 `skipped` / `pending` upgrade 源条目），系统 SHALL 按注册表与指纹判定重算对账：已满足的任务不再显示待升级；未满足的章节纳入新建 run 的目标集合。对账幂等，不产生 AI 调用，不伪造已同步（诚实性约束不变）。

## Capabilities

### New Capabilities

（无 — 升级运行的完整生命周期由既有 `derived-data-upgrade` 能力承载。）

### Modified Capabilities

- `derived-data-upgrade`: 升级进度/暂停/重试/横幅的条目驱动语义全部改为 run 驱动语义（进度聚合跨来源且 `skipped` 不入分母；瞬时失败退避与到点自动恢复；重试面向章节而非条目；横幅携带当前章节、ETA、活性与恢复时间叙事）；新增升级运行实体与存量对账的要求。

## Impact

- **Affected code**: `packages/novel-store`（upgrade run 表与每章状态机、失败分类器、消费回写映射、对账）；`packages/server`（upgrade start/progress/pause/resume/retry 端点语义改为 run 驱动）；`packages/opennovel`（worker 消费时回写 run 章节状态与 started_at、worker 心跳暴露）；`packages/app`（横幅 run 状态机与叙事文案）；`packages/protocol` + `packages/client`（progress 负载形状变化，`bun run generate` 重新生成）。
- **Dependencies**: 无新增运行时依赖；复用 unified-transactions 建立的 `withTransaction` 事务纪律写 run 状态。
- **数据迁移**: 新增 run 表为 additive schema；存量孤儿队列条目走打开时幂等对账，不做离线批迁移。
- **非目标**: 不改 Phase 1 四步的事务与步骤构成（刚由 unified-transactions 收敛）；不改 observer 重建的产出内容；不引入多章并发重建（worker 逐章串行保持）；不动手动编辑同步的非升级路径语义（其条目仅在覆盖 run 目标章节时并入进度）。
- **兼容性**: 进度/状态接口负载形状变化，app 与服务端同仓发布；旧服务端 + 新 UI 的既有降级约定（缺字段隐藏横幅）保持有效。
