# Tasks

## 1. 指标层

- [x] 1.1 `evaluate/metrics.ts`：`record(domain, key, delta)` 计数 API + `.novel/evaluate/metrics.jsonl` append-only 落盘（对齐 mode.jsonl 的 best-effort 纪律，失败只 warn）；桶读取聚合器。验证方式：单测覆盖写入/聚合/IO 失败降级
- [x] 1.2 会话事件惰性计数：经插件 V2 `Event.subscribe` 订阅 Step.Ended（stepSettlement.tokens）/工具事件/Compaction.Ended/取消，按 agent+模型入桶。验证方式：构造事件序列的单测
  - 实现注记：插件 V2 当时没有 Event 域，按 `v2/effect/PLAN.md §8` 补齐宿主适配（core `plugin/host.ts`：`ctx.event.subscribe(type)` → schema Definitions 解析 → `EventV2.Service.subscribe`，SDK 形状 `{id,type,properties}`）；`context.ts` 新增 `readonly event: Event`（session.next.* 全集）。tool.success/tool.failed 的 SDK payload 不带工具名，经 tool.called 的 callID 映射归因
- [x] 1.3 C2-C7 判定点埋点（D2 清单逐模块）：recall 三路命中、budget 各级裁剪、drift-guards/scene-constraints/approval-gate、paragraph-diff、technique-inject、hook-rotation、arc-progress、structure、continuity-check。验证方式：每测点单测锁计数，且既有模块测试全绿证明判定逻辑零改动
  - 实现注记：唯一写盘点落 `packages/novel-store/src/evaluate-metric.ts`（`.novel` 是 novel-store 数据域；审批转换点 requestApproval/handleApproval 在 novel-store，插件侧 `evaluate/metrics.ts` 改为门面再导出 + `recordMetricsBatch` 单次 fsync 批量写）。插件埋点全部走可选 directory 参数，缺省静默跳过；`syncArcProgress` 只有调用方传目录字符串时埋（db 句柄形态项目根不可信），`tools/state.ts` 调用点已改传 `ctx.directory`。键族：c2 `scene.compile.*`/`driftguard.*`/`approval.*`/`paragraph.diff.*`/`annotation.*`；c3 `recall.route.<entity|fts|foreshadow>`/`recall.zero`；c4 `budget.<p0..p6>.occupied|trimmed`（levelTokens 前后差，不动各 applyPXBudget）/`context.snapshot.chars`/`context.render.full|incremental`；c5 `version.rollback`；c6 `technique.confirmed|injected|p7.trimmed|learn.<action>`；c7 `continuity.checked`/`continuity.dim.<维度>.<pass|warn|fail>`/`hook.checked`/`hook.warning.<type>`/`arc.beats_drafted|started|completed`/`structure.checked`/`structure.issue.<category>`。域归属按 D2：hook/arc/structure 归 c7-narrative
  - 测试：`evaluate-instrument-snapshot.test.ts`（场景编译两分支+零召回+FTS 路命中+budget 占用+渲染分支）、`evaluate-instrument-checks.test.ts`（37 维一一对应、钩子警告两分支、弧三键、P7 裁剪、learn 漏斗两分支）、`evaluate-instrument-tools.test.ts`（driftguard 两分支、approval.requested 不重复计、diff 三键、rollback、annotation 分键、read_outline 两分支）；novel-store `approval.test.ts` 扩审批漏斗（requested/approved/rejected/edited）

## 2. 报告生成器

- [x] 2.1 三分部规则模板报告（A 创作复盘 / B 配置优化建议规则映射表 / C 七域产品信号表+失败分类法），范围参数（默认上次报告以来/本卷/最近 N 会话/全部），产物落 `.novel/evaluate/`。验证方式：fixture 指标桶 → 报告快照测试；空数据报告不编造建议
  - 实现注记：`evaluate/report.ts` `generateReport(projectDir, scope, now?)`，ReportScope 四范围：since-last（默认，窗口经 `last-report.json` 状态、报告写盘后推进）/volume（当前小说最新章所属卷的章序号集合+无章节全局条目）/sessions（按 sessionId 最后出现时间取最近 N）/all。B 部六条规则映射表：B1 P2 裁剪×P4 占用→拼接转移、B2 scene.compile 空段占比>30%→章纲模板、B3 回滚≥2、B4 拒绝率>30%、B5 mode.jsonl 写作模式切换≥3、B6 hook 警告>0；未命中输出单行"本轮无配置建议"。空数据三分部均"暂无数据"，不编造建议或计数。产物 `.novel/evaluate/<yyyy-mm-dd>-<scope>.md`。时序 flake 注记：Windows 时钟粒度粗（~15.6ms），测试内新条目一律以 lastRunTs+1 直写 JSONL，避免与状态时间戳同毫秒被 `e.ts > lastRunTs` 排除
  - 测试：`evaluate-report.test.ts` 5 例（固定时钟全量快照命中 B1-B6+分类法、空数据不编造、since-last 状态窗、本卷过滤、最近 N 会话过滤）
- [x] 2.2 手动 slash 命令 `/evaluate` 经插件 V2 command 域注册（D4.1：CommandHooks transform + 带 agent 的模板命令，模板指令驱动 agent 调 evaluate 插件工具；非 cli.ts）。验证方式：会话内 `/evaluate` 触发生成报告并回贴摘要
  - 实现注记：`evaluate/command.ts` `registerEvaluateCommand` 经 `ctx.command.transform` upsert 模板命令（template 含 `$ARGUMENTS`，范围参数原文交 agent 解析；agent=director，其 `"*": "allow"` 权限已覆盖 evaluate 工具）；注册挂在 novel-writer-v2 的 `.novel/` 条件分支内（非小说目录零污染，同上下文源）。执行落点 `tools/evaluate.ts` `evaluate` 工具（barrel 入账，88→89）：scope 全分支解析（默认 since-last，sessions 缺省 count=5），调 `generateReport` 后回贴全文+落盘路径，metadata 带 path/scope/entry_count/generated_at。端到端"会话内触发生成并回贴"归 5.2 真实项目走查
  - 测试：`evaluate-command.test.ts` 4 例（注册 upsert/$ARGUMENTS/四范围/agent=director + 工具 all 执行与落盘读回、默认 since-last 不编造、sessions count 入 slug）

## 3. 自动触发

- [x] 3.1 四类信号检测（卷完结 / Compaction.Ended（schema 只有 Started/Delta/Ended，Ended 携带 text+recent 是压缩完成时刻）/ 反复修改滚动窗 ≥5 / +10 会话 Created 兜底）+ 24h 冷却与同类合并；后台生成不弹窗。验证方式：信号→触发单测，冷却期内不重复触发，手动绕过冷却
  - 实现注记：策略全部集中 `evaluate/trigger.ts` `maybeAutoReport(projectDir, signal, now?)`，事件源只上报信号。四类信号接线点：卷完结在 `arc-progress.ts`（`arc.completed` 批内 arcsCompleted 非空即报，D4 指定的卷翻转近似）；compaction 在 `events.ts` Compaction.Ended 处理器；反复修改窗在 `events.ts` tool.success 处理器（REVISION_TOOLS = revise_chapter/restore_chapter_version/diff_chapter_version/update_chapter，经 callID 归因拿到工具名）；+10 会话兜底在 `events.ts` created 处理器。24h 冷却水位落 `last-report.json` 的 `lastAutoRunTs`（`markAutoReport` 标定，`writeState` 合并保留——手动 /evaluate 只推进 `lastRunTs` 窗口、不重置自动节奏，即手动始终可用但不扰动冷却）。反复修改窗取 6h 滚动窗（D4 未定时长，取半日量级：短于"一天写完一卷"的尺度），跨键合计 version.rollback+approval.rejected+paragraph.diff.checked ≥5，按指标桶计数（recordMetrics 直写后再读桶，同事件流的计数口径一致）；+10 会话自上次自动报告以来按 session.created 桶计数。信号合并语义=冷却期内全部信号抑制，无需去重队列。后台生成=直调 `generateReport(since-last)`，不经 agent/prompt，不弹窗
  - 测试：`evaluate-trigger.test.ts` 6 例（冷却首触发/24h 抑制/24h+1 再触发、手动报告绕过且不重置自动节奏、反复修改窗跨键 ≥5 触发+窗外不计+4 条抑制、会话里程碑自上次自动以来 +10 触发并重新累计、volume-complete 仅冷却门）；`evaluate-events.test.ts` 增补接线用例（10 个 created 事件后台落 `-since-last.md` 报告，ENOENT 轮询容忍异步建目录）

## 4. 诊断包导出

- [x] 4.1 evaluate 插件工具 `export` 子命令 L0/L1/L2 分级（默认 L1，经 `/evaluate export` 或工具直调，D5）：正文与 genre 值的脱敏断言、L2 导出提示。验证方式：含敏感 fixture 的导出快照测试断言无正文无题材值；无任何网络调用（静态检查）
  - 实现注记：`evaluate/export.ts` `exportDiagnostics(projectDir, level, now?)`：L0 纯七域计数（aggregateMetrics 全量）/L1 +错误分类样本（FAILURE_TAXONOMY 分类，复用 report.ts 导出的映射表，全窗 50 条截断+truncated 标记）/L2 +复现事件序列（按 ts 排序，500 条截断）。脱敏管道 `redactEntry`：条目只留白名单字段（ts/domain/key/delta/sessionId/agent/model/chapter），名单外字段（手工编辑 JSONL 可能夹带的 text/genre/scene/note 等）整条丢弃，字符串超 80 字符截断——正文与题材值在任何级别都不落盘。产物 `.novel/evaluate/diagnostics-<日期>-<级别>.json`。工具层 `tools/evaluate.ts` 加 `action`/`level` 形参（export 缺省 L1），L2 的"可能含题材信息"提示经工具输出层明示（spec 场景要求，bundle 本体仍无题材值）。`/evaluate` 模板命令补 export 子命令说明（参数以 export 开头时 action="export"，L2 必须向用户提示分享前自查）；不新增主机 CLI 命令面（D5）
  - 测试：`evaluate-export.test.ts` 7 例（L0 无样本无序列、L1 样本分类+白名单外字段丢弃+正文题材值不落盘、L2 时序序列+同管道脱敏+红线仍无正文、50+样本截断标记、工具缺省 L1 输出、L2 题材提示、evaluate 链路+工具源码零网络 API 静态检查）

## 5. 收尾

- [x] 5.1 `packages/plugin` 与受影响包 typecheck + 全量测试 + oxlint 基线对比
  - 实现注记：packages/plugin typecheck 0、全量 1087 过/99 文件；packages/novel-store typecheck 0、257 过/36 文件；packages/core typecheck 0。oxlint 仓库级同模式对比（main 5658 条基线 vs 分支，按 filename|code|message multiset）：本分支净新增 0。归因过程中修复 5 条本分支真实告警（events.ts created 未用参数、metrics.ts JSON.parse 断言改 isMetricsEntry 类型守卫、host.ts 与 evaluate-events 测试替身的泛型映射必要断言按仓库惯例补 oxlint-disable 注释——注意诊断锚定在表达式起点行，disable-next-line 须置于该行而非 as 所在行）。残余 2 条净差为 packages/llm 未触碰文件（route/client.ts、test/schema.test.ts）的联合类型显示序噪音：两侧 no-unsafe-type-assertion 各 29 条计数相等，仅消息文本成员序随程序形状漂移，非本分支引入
- [x] 5.2 真实项目走查：跑一次写作会话后手动 `/evaluate`，报告三分部有真实数据；自动触发在压缩后发生
  - 实现注记：用户在真实写作项目走查通过——手动 `/evaluate` 生成三分部报告且内容有真实数据，压缩后自动触发报告正常落盘

## Implementation Commits

- e87fd6025 feat(plugin): evaluate 指标桶 append-only 计数（自评价 1.1）
- edc18a366 feat(core): 插件宿主实现 V2 Event Adapter（PLAN.md §8）
- 86be37783 feat(plugin): 会话事件惰性计数入指标桶（自评价 1.2）
- 351485fc2 feat(novel-store): 评价指标写盘点与审批漏斗埋点（自评价 1.3）
- b1718fdd9 feat(plugin): C2-C7 判定点埋点（自评价 1.3）
- 78455557e test(plugin): 清理自评价测试未用导入并消除聚合测试时钟 flake
- 0bbd3f4dc feat(plugin): 三分部规则模板报告生成器（自评价 2.1）
- cd45d7a36 feat(plugin): /evaluate 模板命令与 evaluate 工具（自评价 2.2）
- 571e19281 feat(plugin): 四类信号自动触发与 24h 冷却（自评价 3.1）
- d20442ebc feat(plugin): 诊断包分级导出 L0/L1/L2（自评价 4.1）
- 62d683229 fix(plugin): 消除自评价链路 oxlint 告警（自评价 5.1）

## v1.1 波次（另立 change）

- C8 设定演化 / C9 意图调度（先定义误路由判定）/ C10 灵魂体裁埋点与报告章节；指标桶自动归档压缩；可选 LLM 摘要增强层

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: workflow-self-evaluation" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate workflow-self-evaluation --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支
