# Design

## Context

现有 `packages/server/src/handlers/novel-import` 在 analyze/apply 两次请求中重复解码与解析，注释明确“analyze 不落盘任何原文或中间件”；确定性清洗按句末标点合并行，固定兜底直接每 3000 字切段。正式章节一旦创建，后续 `book-import-pipeline` 只能从该结构开始整理。现有 WorkRun 已提供持久化单元、挂起恢复、进程对账与续跑守卫，但没有替换待处理单元的入口。

新设计从最新 main 开始，不依赖尚未合入的 `fixed-split-restructure`。原文与章节属于 novel-store，WorkRun 与 Session 属于 Core；两边通过书籍绑定会话和导入任务 ID 关联，不能假设跨库单事务。启动与恢复必须遵循 V2：先持久化，再 admission durable prompt，provider work 只由 Session runner 执行。

## Goals / Non-Goals

**Goals:**

- 用单一持久化状态机覆盖原文、校准、计划、章节提交、抽取和收尾。
- 用结构化段落操作和覆盖校验约束 LLM 输出，避免自由正文绕过来源账本。
- 复用 WorkRun 的恢复与可见性，只增加通用待处理尾部重规划。
- 新 UI 直接读取持久化任务与 WorkRun，离开页面或重启后不丢进度。
- 删除旧导入完整链路及其契约、调用方和测试，不保留双实现。

**Non-Goals:**

- 不设计跨库分布式事务，不让 HTTP 请求同步执行整书 Agent 循环。
- 不支持多个 Agent 并行消费同一原文，也不支持跨章节批量自由改写。
- 不为存量书生成虚假的来源账本，不迁移旧固定分章预览令牌。

## Decisions

### D1 导入任务与 Session 的所有权

novel-store 是原文、处理游标、章节来源和导入报告的唯一事实源；Core WorkRun 是队列单元与续跑状态的唯一事实源；SessionNovel 绑定提供两者的关联。UI 不复制第三份进度状态。

启动流程：

1. 解码并校验文件，在 novel-store 单事务内创建 Novel、导入任务、原文与段落索引，任务初始为 `awaiting_queue`。
2. 创建并绑定本书专用导入会话，将 sessionID 写回任务；这一步失败时保留可重试任务并显示失败原因，不重复建书。
3. 通过 `SessionV2.prompt(...)` 投递含任务 ID 的 durable 启动指令并唤醒执行。HTTP 在 admission 后返回，不直接调用 provider。
4. director 读取任务并创建初始 WorkRun；若任务已是 awaiting_queue 但会话已有对应 WorkRun，则认领现有队列而非重建。

初始 WorkRun 只含「校准第 1 章」。校准期每个实际章节一个单元：当前章提交后，未达到阈值就只追加下一校准单元再完成当前单元，达到阈值才以首次计划 replan 剩余章节尾部；plan_version 在校准完成前始终为 0。原文耗尽时以同样方式追加「书籍简介生成」「汇总汇报」。逐章结算让既有无进展熔断看到真实单元推进，UI 则将它们归为一个校准阶段且不显示预计总数。首次建设计划、校准期逐项推进与正常追加收尾均不计入报告中的“异常尾部重规划次数”，避免计划不足时提前领取收尾。

备选：服务端启动时直接创建 WorkRun——被否，跨 novel-store/Core 的同步写入会扩大半启动状态；由 Agent 首步建队可通过读取两侧状态幂等恢复。

### D2 不可变原文与稳定段落地址

新增四组 snake_case 表：

- `novel_import_job`：任务 ID、novel_id、session_id、文件名、编码、原始字节哈希、完整解码原文、总字符数、状态、阶段、next_paragraph_index、consumed_chars、carry_json、计划章数、计划版本、配置 JSON、统计 JSON、错误与时间戳。
- `novel_import_paragraph`：job_id、paragraph_index、start_offset、end_offset，联合主键为 job_id + paragraph_index；只存偏移，不重复存段落正文。
- `novel_import_chapter`：job_id、chapter_id、chapter_order、来源起止段落、输入指纹、提交指纹、内容/设定/技法阶段状态、创建与更新时间。
- `novel_import_operation`：job_id、chapter_id、操作序号、类型、来源段落 JSON、输出段落序号、操作参数、理由、操作前后文本与时间戳。

原文保存解码后的完整字符串，不执行标点、空白、广告或断行清洗；原始字节哈希用于识别同一文件。段落扫描仅建立地址，不修改原文。偏移采用与 Bun/JavaScript 字符串切片一致的 UTF-16 code unit，Agent 只使用段落 ID，避免模型生成字符偏移。每个非空原始行初始即为一个可索引段落，导入器不先按空行或标点合并；空行作为段落间格式信息保留在原文中，不参与语义段落编号。

物理原文只随书籍删除级联清理。游标表示首个尚未最终处置的段落；carry_json 显式保存已读但留给下一章的段落，不能用“删除前缀”表达进度。

备选：每段另存全文——被否，原文 + 偏移即可重建所有输入，避免大书额外翻倍存储。

### D3 流式阅读状态机

新增 plugin 侧 `source_import` 工具，动作覆盖 `status/read/commit/plan/finalize`。工具始终从当前会话绑定书籍定位任务，模型不能传任意路径读取文件。

`read` 输入目标字符预算，返回：上一章结尾摘要与少量原文、carry 段落、按完整段落截取的下一批原文、显式章题/卷题提示、剩余字数、当前校准状态和硬预算上限。硬预算从当前模型上下文元数据推导，元数据缺失时使用保守默认值。

每章循环只允许顺序推进：

```text
status/read → 候选边界与修复 → 需要更多上下文则再次 read
           → commit 校验通过 → 设定/技法阶段 → 下一章
           → 达硬预算仍无边界 → block 当前 WorkRun 单元
```

每次扩展读取必须包含此前未提交段落，不能靠对话记忆保留前文。章题匹配器继续存在，但只输出 hint，不再拥有建章权限。

### D4 结构化操作而非自由正文

候选章节由标题、卷归属、来源范围和有序操作组成。操作类型：

- `keep`：保留一个来源段落；
- `merge`：按给定来源顺序合并多个段落，并指定空白/换行连接符；
- `split`：以来源中的精确锚点拆分一个段落；
- `move`：在当前阅读窗口内调整来源段落顺序；
- `replace`：以来源内精确原文替换错字、标点或残留格式，记录类别与理由；
- `exclude`：排除广告、机械重复或确认无用内容，必须记录类别与理由。

每个输出段落必须引用至少一个来源段落；除 replace 给出的局部替换外，不接受模型另传正文。用户关闭正文修复时，仅允许 keep 与章节边界/标题决策，merge、split、move、replace、exclude 一律不提交。系统按操作确定性地构造章节内容并计算字数。split 显式允许多个输出引用同一来源，其他情况重复引用即拒绝。

提交前对本次 read 窗口做完整对账：所有来源段落必须恰好归入“本章输出 / carry / exclude”之一；此前已消费段落不可再次出现，carry 必须进入下一次 read。锚点不唯一、replace 原文不匹配、覆盖缺段、跨窗口移动、空章或无来源输出均返回可操作错误，不写库也不推进游标。

备选：让模型直接返回修复后全文再做 diff——被否，diff 只能事后解释，不能阻止漏段、重复和无依据创作，也无法稳定幂等。

### D5 单章事务、幂等与恢复

`commit` 在 novel-store 单事务内：

1. 重读任务与账本，验证候选基于最新 next_paragraph_index、carry 和 plan_version。
2. 重跑 D4 校验并构造正文。
3. 以 job_id + chapter_order + 来源起止段落计算幂等键：已存在且提交指纹相同则返回既有章节；指纹不同则冲突拒绝。
4. 创建卷/章、来源映射、操作账本和导入章节阶段记录，推进游标与 consumed_chars，更新任务统计。
5. 提交后才允许完成对应 WorkRun 单元。章节内容已成功但响应丢失时，Agent 重读状态后恢复，不依赖重复调用恰好发生。

初次建章直接写最终内容，不伪造修订版本。用户对已完成章节发起重新处理时，先通过既有 ChapterVersionTable 保存当前正文，再以 `import-reprocess` 来源写新版本；原始快照和操作账本不被改写。

章节提交成功后，设定与技法复用该轮 Agent 结果分别写既有通道。`novel_import_chapter` 的三个阶段标记使崩溃恢复能够跳过 content 已完成部分，只补做 settings/techniques。设定正式库仍走 organize_settings 审阅，技法仍走 unverified/合并语义。

### D6 百分之二十五校准与稳定计划

校准进度按 consumed_chars / total_chars 计算，exclude 也计入已处置字数，carry 不计入。只在安全章节提交后判断是否达到阈值，因此实际校准点可能略超过 25%。

阈值规则固定为：达到或超过 25% 且已完成至少 3 章；不足 3 章则继续到第 3 章或原文结束。短书原文耗尽时不生成虚假章节任务，只保留收尾。

未达到阈值时，每次 commit 只追加下一实际校准单元，不计算预计剩余章数。首次计划以已完成章节的来源字数中位数为基线，结合剩余字数、明确章题和卷信息生成预计章数。章题只调整计划，不预先创建正文。首次 `plan` 只返回剩余章节任务标题列表，由 director 调 WorkRun replan，再把 plan_version=1 与计划统计写回任务。原文耗尽时，commit 必须先返回 source_exhausted，由 director 在完成当前章单元前追加简介与汇总，确保 WorkRun 不会出现无单元可领取而提前停机。

正常 commit 不重算计划。只有以下事件允许 plan_version 增加：

- source_exhausted：取消未开始章节占位，保留或追加简介和汇总；
- work_remaining：追加未开始章节任务；
- structure_invalidated：携带新卷/大段乱序等具体证据局部重排；
- options_changed：暂停中修改后续配置，仅替换未开始尾部。

每次尾部调整记录原因、前后任务数和 plan_version，供 UI 与报告展示。单章偏长、偏短或改题不触发。

备选：每章滚动重估——被否，会造成用户明确不希望的队列总数持续波动。

### D7 WorkRun 待处理尾部重规划

Core 增加 `replanPending(runID, items)`，工具增加 `workrun(action="replan", items=[...])`。replan 查询 current 后显式接受 active/paused，不复用现有 active-only 分发分支，其他 WorkRun 动作保持原语义。实现必须：

- 仅允许 active/paused 且 items 非空；
- 在 Core 数据库单事务内删除当前 pending 项并以递增 seq 追加新 pending 尾部，不复用任何保留单元的 seq；
- 不更新 done/in_progress/skipped/blocked 行的任何字段；
- 同事务更新 run 时间与进度笔记，提交后发布一次完整 WorkRun 更新；
- active 保持 active，paused 保持 paused；后者不调用 SessionExecution.wake，也不合成恢复消息。

进程对账仍只把进行中回退待处理；若恢复时需要 replan，必须由用户显式恢复后由 Agent 执行，启动对账不自动改计划。

备选：为导入单独建立另一套队列——被否，会复制暂停、恢复、守卫、UI 和事件语义，并产生两个进度事实源。

### D8 公开契约替换与服务端边界

删除 `novel.import.analyze/apply` 及对应 Preview、previewToken、fallbackFixedLength、旧 CleanSummary 契约，新增：

- `novel.import.start`：文件、编码、书名、目标章长、修复强度；返回 novelID、jobID、sessionID 与初始状态。
- `novel.import.get`：返回任务、真实进度、当前阅读范围、章节摘要、统计、报告与错误；WorkRun 仍通过既有 session.workrun.get 获取。
- `novel.import.control`：pause/resume/retry/configure；configure 仅 paused 可修改未开始部分配置，服务端校验后通过 durable prompt 让 Agent 重规划。

pause/resume 组合调用 SessionWorkRun 既有动作并同步任务状态；跨库第二步失败时任务记录控制错误，UI 以重读两侧状态为准并提供重试，不假报成功。retry 只发 durable 恢复指令，由 Agent 根据账本选择续做点。

Protocol/Server HttpApi 修改后，在 `packages/client` 执行 `bun run generate`，并运行 legacy JS SDK 的既有生成脚本；禁止手改 generated、generated-effect 或 SDK 生成文件。新增/变更 HttpApi 行为必须加入 httpapi-exercise 场景。

### D9 UI 单任务三态页面

导入路由由“文件/预览/报告”向导改为同一任务的三种状态：

1. **配置态**：文件选择、编码、书名、目标章长、修复强度；没有固定长度开关、机械卷章树和预览令牌。
2. **处理态**：顶部展示阶段与真实原文比例；主区展示当前阅读范围、候选边界/受阻原因和已产出章节；侧区展示 WorkRun、修复统计与控制操作。校准前队列只显示阶段任务，校准后显示“计划”章数。
3. **完成态**：统一报告以章节、修复记录、设定/技法、原文对照组织信息；提供打开书籍与重试失败项，不再出现「AI 整理」。

页面查询以 jobID 为稳定键，订阅既有书籍/Session/WorkRun 更新后失效重取，不在组件内维护另一份章节或计数。暂停中可打开“应用到未开始部分”的配置面板；已完成章节配置不回改。

旧 buildImportPipelinePrompt、sendTidy、analyze/apply queries、固定兜底状态与对应测试一并删除。新固定界面文案遵循现有 locale 与中文优先约束，旧文案仅在确认无引用后清理。

### D10 旧流程移除与兼容边界

本 change 不合入 fixed-split-restructure，也不新增 restructure_chapters。main 上已有的导入解析器仅保留编码、输入边界与“标题 hint”部分；旧 cleanText、splitFixedLength、analyze/apply orchestration 及对应测试删除。director 的旧“导入整理（工作队列）”提示替换为新任务流程，普通逐章审查与其他 WorkRun 消费者保持不变。

数据库迁移只新增导入表与索引，既有 novels/chapters 不改写。旧书没有原文时隐藏原文对照，不自动重建。旧活动 WorkRun 保留通用挂起/恢复数据，不在迁移时猜测其是否为导入任务或自动转换；只有新启动的导入使用 source_import 工具。

回滚代码时无需回滚既有书内容；新版本已创建的导入表保留但旧代码忽略。若需撤销某次尚未完成的新导入，用户删除对应未完成书籍即可级联删除其原文与账本。

## Risks / Trade-offs

- [Agent 对对话或乱序判断错误] → 只允许当前窗口的结构化操作，保存逐项理由与原文对照；低置信结果保留原文并记未解决项，不强行修复。
- [长章或无标点小说是上下文预算内仍无边界] → 明确 block 并允许调整章长/人工介入，不静默固定字数硬切。
- [计划仍有估算误差] → 25% 后保持稳定，仅在四类证据下调整未开始尾部，报告记录全部计划版本。
- [原文与正式章节双份存储增加体积] → 段落只存偏移，操作只存局部前后文本；原始字节不另存第二份，保留哈希用于校验。
- [novel-store 与 Core 跨库状态短暂不一致] → 各自为事实源，所有启动/控制动作可重读幂等恢复，UI 不以单次跨库调用的部分成功作为完成依据。
- [整书自动处理成本较高且持续时间长] → 复用 WorkRun 续跑与无进展阀门、专用会话和暂停控制；不做并行全书处理。
- [replace 锚点因模型复制差异校验失败] → 返回具体段落与原文，要求基于 read 结果重提；失败不推进游标。
- [首次校准在超大章节书籍上可能来得较晚] → 至少三章规则优先保证样本可靠性；短书以原文结束为上限，不为凑样本虚构章节。

## Migration Plan

1. 先新增 novel-store 表与迁移，验证旧书库只增表、不改行。
2. 扩展 WorkRun replan 并保持既有消费者测试通过。
3. 落地 source_import 状态机与新 director 路由，再切换新 API/UI。
4. 删除 analyze/apply、固定清洗/兜底和旧导入整理入口，重新生成 Client 与 SDK。
5. 用同一夹具覆盖正常章题、无章题、连续对话断段、局部乱序、噪声、25% 校准、两类尾部修正、暂停/重启和重复提交。
6. 完成人工冒烟后再跑全量回归；归档前同步 novel-book-import、book-import-pipeline、agent-work-continuation 主 specs，并关闭/更新 Issue #32、#33、#34，注明 fixed-split-restructure 被本 change 取代。

## Open Questions

无。
