# Proposal: agent-background-job-recovery

> 2026-10-23 穷尽式审查重写：原提案（2026-10-20）的「作业没有恢复语义」前提已由 agent-task-subagent 交付（subagent 后台作业 KV 持久化 + 崩溃恢复闭环），本提案收窄为写作流水线专属的批量断点问题。范围裁定与证据见 design.md §1–2。

## Why

整卷生成、全书一致性校验这类长任务跑几十分钟到数小时。subagent 后台作业的崩溃恢复已就位，但**写作流水线根本不经过该通道**：director 以前台方式 dispatch @pipeline，前台作业不写 KV，崩溃后恢复扫描为空；「当前章/剩余数」只存在于 director 的对话上下文，`advance_chapter` 不落库——进程崩溃（桌面应用更新、断电、panic）后批量循环无声死亡，用户回到书籍时没有任何痕迹表明写作中断，更无从续跑。已完成章节的正文虽在库，但批量意图与进度指针全丢，只能凭记忆重新发话。

## What Changes

- **批量任务持久化**：novel-store 新增 `writing_batch` 表（一书一批量：会话、起始章、总数、单调推进的完成章指针），`begin_writing_batch` 工具 + `advance_chapter` 落库改造
- **断点续跑语义**：director 批量节改写（首步登记、逐章 `list_chapters` 核对、续跑请求按持久化记录定断点）；pipeline 新增残骸三态自检（未写 / 写后未 sync 从 audit 续 / 已写待审跳过）
- **幂等修复**（章节可重跑前置）：`novel_state_log` 章级重置、`story_spine` 按章去重、`.novel/state-log.md` 锚点替换
- **中断可见性**：`server.novel` 新增 writing-batch 查询/取消面（interrupted 查询期派生：running 且会话不活跃），书籍工作台顶部中断横幅「批量写作中断：已完成 M/N 章 [续跑] [放弃]」，续跑向发起会话发 V2 prompt

## Capabilities

### New Capabilities

- `agent-job-recovery`：写作流水线批量任务的持久化与断点续跑

### Modified Capabilities

（无）

> `skip_specs: true`。

## Impact

- **受影响包**：`novel-store`（writing_batch 表）、`plugin`（begin/advance 工具、director/pipeline prompt、state-commit 幂等）、`server`（novel 查询面）、`client`（SDK 重生）、`app`（横幅 + i18n 新增键）
- **数据兼容性**：新增表；state-commit 幂等修复只影响重跑路径，首跑行为不变
- **依赖关系**：Job 恢复地基已由 agent-task-subagent 交付（已归档）；shell 作业恢复随未来「bash durable status」独立 change（本提案不涉）
- **优先级理由**：长任务可靠性底线；V2 切换后更多长任务出现，批量写作中断无声死亡是用户可感知的数据信任问题

## 非目标

- 不做 shell 作业恢复（bash 走 PTY/AppProcess 不进 Job 体系，随 bash durable status 另立 change）
- 不做全自动续跑（fork 既定 `resume: false` 语义：续跑由用户经横幅一键触发）
- 不做 desktop 包改动（可见性在 app 层满足）
- 不复活 chapter-status 严格状态机（live 状态值域足够支撑断点判定）
- 不做作业迁移（换机器续跑）、优先级调度、分布式队列、token 级断点（恢复粒度是章节级）
