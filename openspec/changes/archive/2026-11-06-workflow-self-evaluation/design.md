# Design: workflow-self-evaluation

## Context

探索结论（2026-11-05）：插件 47 模块 + 13 agent + 8 genre 全量统查后，确认所有目标信号在既有判定点均可测，无需新增判定逻辑。原料：会话事件（`publish-llm-event.ts` 已增量持久化每 step token 用量）、`.novel/audit/mode.jsonl`、三路召回（recall.ts）、P0-P7 预算（budget.ts）、37 维连续性（continuity-check.ts）、钩子轮换（hook-rotation.ts）、弧光进度（arc-progress.ts）等。

## Goals / Non-Goals

Goals：七域指标滚动积累；三分部确定性报告；自动+手动触发；分级诊断包导出；作者与开发者双反馈回路。Non-Goals：遥测外发、配置一键应用、LLM 报告、C8-C10（v1.1）、作品文学评价。

## Decisions

### D1：两层节奏分离——指标桶连续积累，报告按需查询
- 指标层：`.novel/evaluate/metrics.jsonl` append-only 计数条目（域/键/增量/会话ID/时间戳），写入对齐 mode.jsonl 的 best-effort 纪律（O_APPEND+fsync，失败只 warn）。不引入 DB 表。
- 报告层：读桶聚合 + 按需回溯会话事件做归因，产物 `.novel/evaluate/<日期>-<范围>.md`。
- 拒绝"每事件触发分析"：成本与噪声都不可接受。

### D2：埋点全部寄生既有判定点，零判定改动
七域测点（域 → 模块 → 信号）：
- C1 运行时：会话事件流（工具失败/误触发/延迟/取消），经插件 V2 `Event.subscribe` 订阅（见 D4）。
- C2 提示词控制：scene-constraints 场景清单编译率与注入率（compileSceneChecklist 返回 null 的大纲占比，宿主 tools/outline.ts:217 与 recall.ts:30）、drift-guards 拦截、approval-gate 拒绝、paragraph-diff 改写幅度、annotation 问题密度。
- C3 召回：recall.ts 三路合并处记各路命中；正文引用转化经 entity_refs 反查；零召回章节、伏笔召回时效。
- C4 拼接：budget.applyBudget 各级占用与裁剪（宿主链 recall.ts:659，写作步骤每次打包都过）；context-source 快照大小与增量/全量渲染分支。
- C5 流程：agent 耗时/token（事件流）、rollback 与模式切换热点（version 工具 + mode.jsonl）。
- C6 技法：technique-inject.applyP7Budget 注入数与 P7 截断（宿主链 technique-learn.ts:129）；technique-learn/extract 回流计数。
- C7 叙事质量：hook-rotation 同型警告（警告在 getHookStats 返回 `warning` 字段产出，埋点在 tools/hooks.ts 调用 trackHook 后取 stats 处，trackHook 本体只落库不判定）、arc-progress 节奏偏移、structure 风险分布、continuity-check 37 维失败分布。
埋点以独立 `evaluate/metrics.ts` 暴露 `record(domain, key, delta)`，各判定点单行调用。

### D3：报告为纯规则模板
- 分部固定：A 创作复盘（卡壳地图=修改/rollback/耗时热点交叉；断更 thread；批注密度）、B 配置优化（裁剪热点 → P0-P6 分配建议文本；模式切换频率建议）、C 产品信号（七域计数表 + 失败分类法 + Top 复现要点）。
- 建议文本来自规则映射表（如"P2 裁剪率 >30% 且 P4 占用 <50% → 建议 P4 让 1K 给 P2"），规则表是 v1 的主要知识资产，随真实使用迭代。
- 范围参数：上次报告以来（默认）/ 本卷 / 最近 N 会话 / 全部。

### D4：自动触发与冷却
- 信号通道：插件 V2 `Event.subscribe`（v2/effect/event.ts，按事件类型返回 Stream；SDK v2 types.gen.ts 已含 `session.next.compaction.started/ended`）。**实现注记**：动工时发现插件 V2 只有接口设计（`v2/effect/PLAN.md §8`）而宿主尚未实现事件适配——已按 PLAN.md 在 core `plugin/host.ts` 补齐（schema Definitions 解析类型字符串 → `EventV2.Service.subscribe`，SDK 形状 `{id,type,properties}` 由宿主搬运字段），`PluginContext` 新增 `readonly event`（任务 1.2 一并交付）。压缩信号取 **`Compaction.Ended`**（不是 Finished——schema/session-event.ts:463 只有 Started/Delta/Ended；Ended 携带 text/recent，是压缩真正完成的时刻，Started 时摘要还没生成）。token 计数订阅 Step.Ended（stepSettlement 携带 tokens，publish-llm-event.ts:400）。
- 信号：卷状态翻转（arc-progress/章节提交处）、`Compaction.Ended`、反复修改滚动窗（rollback+审批拒绝+大改 ≥5/窗）、每 +10 会话兜底（以会话 Created 事件计数）。
- 冷却：同项目 24h 一次自动报告，冷却期内信号只入桶；同类信号合并。手动 `/evaluate` 绕过冷却。
- 自动生成后台执行，不弹窗，仅在报告中可查。

### D4.1：手动触发的命令形态——插件 V2 command 域，非 CLI
- 手动入口是**会话内 slash 命令 `/evaluate`**，经插件 V2 command 域注册（v2/effect/command.ts 的 CommandHooks transform；CommandV2Info = {name, template, description, agent?...}）。先例在此，不在 novel-writer/cli.ts（那是 initNovelProject/createBook/relevelTechniques 等主机 CLI 业务函数，不含任何 slash 命令注册）。
- `/evaluate` 注册为带 agent 的模板命令：模板指令让 agent 调用 evaluate 插件工具生成报告并把摘要贴回会话（报告正文始终落盘，会话里只放摘要与路径）。范围参数（默认上次报告以来/本卷/最近 N 会话/全部）经命令参数传入模板。
- 与 V1 hooks 事件通道的取舍：V1 `Hooks.event`（plugin/src/index.ts:249）也能收事件，但新功能一律走 V2 插件面（本仓库 V2-only 纪律），不新增 V1 依赖。

### D5：诊断包分级与隐私红线
- 导出也是 evaluate 插件工具的子命令（`evaluate export --level L0|L1|L2`，默认 L1）：经 `/evaluate export` slash 模板或 agent 工具直调；不新增主机 CLI 命令面（保持插件自承载，主机零改动）。L0 纯计数；L1 +错误分类样本（每条截断、去正文）；L2 +复现事件序列，导出结果明示可能含题材信息。
- 红线：任何级别不含小说正文；genre 值不进 L0/L1；零自动外发（无网络代码路径）。
- 拒绝匿名遥测（C2 管道）：隐私面与本仓库云同步事故史不允许；可行动性靠报告质量而非信号量。

### D6：v1.1 波次预留
C8 设定演化（reflector 拒绝率/state-commit 冲突/评审队列堆积）、C9 意图调度（director 误路由率需先定义判定）、C10 灵魂体裁（soul 切换/genre 分布）。指标桶 schema 对新增域透明（域是自由字符串），v1.1 只加埋点与报告章节。

## Risks / Trade-offs

- 指标桶无限增长：JSONL 按项目滚动，报告生成时可归档旧段；v1 设软上限（超 5MB 提示手动归档），自动压缩留 v1.1。
- 规则建议质量初期有限：B 层纯文本、不代应用，误建议代价低；规则表迭代是预期工作方式。
- 埋点散布多模块：以单测锁各测点计数正确性；埋点失败降级路径统一在 metrics.ts。

## Migration Plan

纯增量，无数据迁移。回滚=删除 evaluate 模块与各埋点调用行。
