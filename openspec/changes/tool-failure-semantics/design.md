# Design

## Context

生产日志热点（update_chapter / surface_success ×50+、read / tool_failure / "Object" 合计 17 次发生、跨 4 个项目日志目录）的机制根因已由调研定位：

- 插件 ToolResult 合同（`packages/plugin/src/v2/effect/tool.ts:44-51`）无失败变体，execute 唯一失败通道是 throw；novel-writer 97 个工具约 172 处以软返回承载失败，其中约 137 处无任何 metadata 标记。
- 宿主链路已打通 throw 通道：`packages/core/src/plugin/host.ts:159-182` wrapTool 把 Promise reject 映射为 `Tool.Failure`；`packages/core/src/session/runner/to-llm-message.ts:55-67` 以 `resultType:"error"` 发给 provider（Anthropic `is_error:true`，`packages/llm/src/protocols/anthropic-messages.ts:481`）。
- 软返回与 metadata 标记在模型侧不可见：`host.ts:179` toModelOutput 只发 output 文本；`packages/llm/src/schema/messages.ts:112-117` provider 下沉丢弃 structured——metadata 本身随 structured 在观测面可达（collector resultStructured 收到完整对象），但 tool-insight 现无代码读取 `.metadata` 字段。
- 错误类别在失败结算链两处丢失。本地工具失败的真实路径（逐环核实）：host 造 Tool.Failure → `packages/core/src/tool/registry.ts:69-75` settleWith catchTag 把 failure 收敛为 error 型结果（只留 message，name/code/metadata 在此丢弃）→ `runner/llm.ts:329-345` 结算并发布 `LLMEvent.toolResult`（error 型）→ `publish-llm-event.ts:44-51` settledOutput 硬编码 `error={type:"unknown",message}` → `:352-361` 发布 `session.next.tool.failed`；`packages/schema/src/session-message.ts:19-22` UnknownError 仅两字段。`packages/llm/src/tool-runtime.ts` 的 ToolRuntime.dispatch 与 publish-llm-event 的 tool-error 分支不在本地工具失败路径上（dispatch 无生产调用方；tool-error 分支只服务 provider 侧事件），不列入修改点。tool-insight `evidence.ts:166-184` 回退 `constructor.name` 恒得 "Object"。
- 失败路径不落结构化 metadata：`session.next.tool.failed` 事件无 structured/content 字段（`packages/schema/src/session-event.ts:402-414`）；`message-updater.ts:373-381` 落库 ToolStateError 时 structured 恒为空对象——失败态下模型与 UI 都只能读 error.message 文本。
- 检测器无法区分批量并行与顺序重试：turn.calls 只存到达序且跨流到达序不可靠（`packages/plugin/src/tool-insight/collector.ts:10-15、433`）；shapeSignature 丢弃 callID（`detector.ts:72-74`）；revisionStreak 只数完成不查调用发出时序（`collector.ts:449-457`）；detector redundant_repeat 分支未排除 called 状态（`detector.ts:139-161`）；失败时刻形状归纳 classifyShape（`collector.ts:289-319`）按 paramKeys 同尾判重复——门禁转 throw 后批量拦截（全批失败、参数键相同）会镜像出同族误报。
- 章节 ID 无预分配机制（`packages/novel-store/src/chapter-sequence.ts:163`、`packages/novel-store/src/index.ts:1645` 均为插入时生成）；director 工具表无 update_chapter 条目、权限 `"*": "allow"` 隐式放行（`agents/director.ts:19、114-156`）；update_chapter 只收 UUID、查询不过滤 novel_id（`tools/chapter.ts:464-477`）。
- 软返回形状有提示词消费方：pipeline 提示词的重试/不重试分叉直接读 metadata（`agents/pipeline.ts:145-148` 读 metadata.rejected / metadata.reason），writer 提示词按内容拒绝结果形状判定（`agents/writer.ts:186`）——转换后失败路径无 metadata，判定依据必须改写。
- 未初始化项目里 director 带全套编排 prompt 但上下文源零注册（`novel-writer-v2.ts:73` 仅 `.novel/` 存在时注册）、prompt 无未初始化分支且 4 处提及 package.json（`agents/director.ts:84-532`）、read 权限全 allow——盲读是模型在状态真空下的自发探测。

## Goals / Non-Goals

**Goals:**

- 业务失败统一走 throw 通道，三方（模型、运行器、tool-insight）判定一致。
- 错误类别从抛出点一路保留到 tool-insight 归档指纹。
- 检测器批量并行/顺序重试区分，消除 1fd7bb 类误报。
- 修复 update_chapter 的寻址、归属、来源约束缺口与四处附带缺陷（死代码、顶层散字段、get()! 族、read 折叠）。

**Non-Goals:**

- 见 proposal 非目标节；另：不改 permission-judge 拒绝的形态（registry.ts:73-75 已走 error 通道）、不动 ToolRuntime.dispatch 与 tool-error 事件分支（非生产路径）。

## Decisions

### D1 失败通道：throw，而非合同扩展或宿主转译

三个候选：

1. **throw（选定）**——宿主 error 通道现状已全通，插件侧零合同变更；与既有正例一致（`createChapterReview`、chapter-rebuild/rollback、outline 跳号分支外的原样上抛）。
2. ToolResult 增加失败变体 + 宿主 wrapTool 转译——需改 V2 合同 Schema.Union、host、registry 编码边界，引入「metadata.ok=false 之类约定口径」，且失败信息仍要决定如何渲染给模型；收益仅是失败作为数据的类型安全，成本是跨包合同变更。
3. 只改观测面（扩展 verify 适配器/读取 metadata）——失败标记在 provider 下沉（`messages.ts` toResultValue）处被丢弃，模型依旧看不到失败信号，盲目重试照旧；观测面归因改善救不了模型行为，不解决 headline 问题。

### D2 错误类别承载：plugin 内错误工厂，稳定 name 进指纹

在 plugin 工具层提供一个小型失败构造 helper（如 `toolFailure(category, message, extra?)`），抛出的 Error 带 `name = category`（ASCII 稳定词）与中文 message。类别词表收敛为：`not_found` / `param_error` / `state_conflict` / `gate_blocked` / `content_rejected` / `internal`。理由：tool-insight 的 errorCategory 生命线是错误对象 `name`（`evidence.ts:168-171`），结算链透传后即成指纹类别（`collector.ts:535、249-253`）；每个类别一个 Error 子类过重，metadata 承载类别已证模型不可见。

失败文本自含语义与全部行动信息（含 samples、计数等展示信息）：OpenAI Chat/Responses/Gemini 协议层无 is_error wire 标记（`openai-chat.ts:271`、`openai-responses.ts:340`、`gemini.ts:261`），不能依赖 provider 标记；且失败路径不落结构化 metadata（见 Context），模型与 UI 在失败态都只能读 message 文本——展示信息放 metadata 会在失败态同时丢失给两边。补救指引形态对齐正例 `tools/outline.ts:141-152` 跳号拒绝。

### D3 软返回分类判定表（转换边界）

统计口径：软返回指以成功形态 `{title, output[, metadata]}` 返回却承载失败语义的返回点；合计约 172 = 转换类 151（下表六类）+ 空结果约 21，计数为调研期逐点人工归类的约数，实施以逐文件清单为准。按调研清单逐类判定：

| 现状类别 | 处置 | 目标形态 |
| --- | --- | --- |
| not_found ≈59 | 全部转 throw | `not_found`，含目标定位指引 |
| param_error ≈53 | 全部转 throw | `param_error`，含参数名与正确用法 |
| state_conflict ≈12 | 转 throw（排除设计性 no-op） | `state_conflict` |
| gate_blocked ≈11 | 全部转 throw | `gate_blocked`，含原因与解除路径；对齐 multi-chapter-batch spec「硬拦截……而不仅是流程约定」的既有要求 |
| rejected ≈10 | 全部转 throw | `content_rejected`，含 samples 与修改指引 |
| error_swallow ≈6 | 收口转 throw | `internal`；delete_setting 的主角保护/出场保护两个 store 抛错升格为 `gate_blocked`（带 reason） |
| empty_noop ≈21 | 保持成功形态 | 空结果提示（非失败） |
| 设计性 no-op（deduplicated/merged/reused/repaired:false/no_tasks/同名绑定 reused） | 保持成功形态 | metadata 保留既有标记 |
| 两步确认预览（delete_chapter confirm=false） | 保持成功形态 | 不变 |
| 部分成功（save_novel_settings、organize_settings、cascade_execute） | 保持成功形态 | metadata 必须含 errors 明细与失败计数（现状部分已有） |

转换附带修复：

- **死代码复活**：write_chapter 坐标泄漏检测块（chapter.ts:115-122）嵌进提纲标签 if（:108-123）内永不可达，移出为平级判定（对齐 revise_chapter :255-262 的正确形态）。
- **顶层散字段迁回 metadata**：technique.ts:97-121、157-167、183-189 的 `action/reason/technique_id/count/injected` 放在 ToolResult 顶层会被编码静默丢弃（实测 `encodeSync` 只剩 title/output），全部迁入 metadata；technique.ts 自身的失败形态软返回（save_technique 拒绝入库 :97-105、verify_technique 转正失败 :204、promote_technique layer 校验 :224、promoteTechniqueToSpec 失败 :228）一并转换。
- **novel-store `get()!` 族**：`packages/novel-store/src/index.ts:3019`（updateStoryArc）、`:3099`（updateArcBeat）、`:2143`（updateForeshadowing）对 0 行更新经非空断言炸 TypeError（arcs.ts:140/200、foreshadow.ts:79 上抛裸 TypeError）。改为查无目标返回 null，调用方转 `not_found` 失败。全文件共 46 处 `get()!`，其余为插入后按刚生成 ID 读回（必然命中），实施时清点调用方可达性并记录豁免清单。

### D4 失败事件语义保留：真实结算链的载体透传

本地工具失败的生产路径（见 Context）逐环修改：

1. **抛出点**：错误对象带 `name`（类别）与可选 `code`（细分类别，如 `chapter_not_found`）。
2. **host wrapTool**（`host.ts:177`）：创建 `Tool.Failure` 时把 rejected Error 的 name/code 填入其 metadata（`ToolFailure` 已有可选 metadata 字段，`packages/llm/src/schema/errors.ts:213-217`，从未被填充）。
3. **registry settleWith**（`registry.ts:69-75`）：error 型结果保留 failure.metadata，不再只留 message——载体为扩展 packages/llm `ToolResultValue` 的 error 变体（`messages.ts:58-85`，现为 `{type:"error", value}`），增加可选 metadata 字段；provider 下沉序列化（toResultValue）保持只含 value，metadata 不进 wire。
4. **publish-llm-event**：settledOutput（`:44-51`）与 Tool.Failed 发布（`:352-361`）从结算结果的 metadata 提取 name/code 填入 `session.next.tool.failed` 的 error；中断路径（`runner/llm.ts:155-165`）无类别来源，保持 `{type:"unknown"}` 形态（观测面标未分类）。
5. **schema**：`SessionMessage.UnknownError`（`session-message.ts:19-22`）增加可选 `name`/`code` 字段——纯增量，旧消费方不受影响。
6. **SDK 再生成**：从仓库根运行 `bun ./script/generate.ts`（第二步再生 openapi.json，缺一 CI generate 必红）；llm 包不在协议面，openapi.json 若无对应差异属预期，以 git diff 实测为准。

### D5 read 工具错误映射

`packages/core/src/tool/read.ts:95-105` mapError 白名单外的错误统一折叠为 `Unable to read <path>`。改为按真实原因映射：`FSUtil.Error`（`fs-util.ts:24`）按 reason 分「文件不存在/权限不足」；`PathKindError`（目录）、`OffsetOutOfRangeError`（越界，`read-filesystem.ts:17-61`）与 `MalformedUtf8Error`（编码损坏，`read-filesystem.ts:37-43`）保留类名；message 附原因说明（如「文件不存在：<path>」）。抛出形态带上类别 name（not_found/param_error/internal），配合 D4 链路让 errorCategory 不再是 "Object"。

### D6 检测器批量区分：配对发出时序，成功与失败两侧都排除

数据全在 collector 内存，不动落盘格式与指纹词表（批量形态是「不建档」，不新增类别）：

1. `onToolCalled`（`collector.ts:418-424`）给 CallInfo 记单调 issueSeq；turn 窗口维护「同工具未完成 callID 集合」。
2. `onToolSuccess`（`collector.ts:446` 前）：本 callID 发出早于任一同工具在途完成 → 标记 overlapped（批量兄弟调用）；仅非 overlapped 完成计入 revisionStreak（`collector.ts:449-457`）——批量先发后收不再触发 redundant_repeat。
3. **失败时刻同样排除**：`classifyShape`（`collector.ts:289-319`）在失败时刻按 paramKeys 同尾判 redundant_repeat、≥2 失败判 recovery_failed——门禁转 throw 后 review 模式批量调用被同一前置拦截（全批失败、参数键相同）会镜像误报建档；失败侧用 issueSeq 配对识别「同轮多调用先于首个失败结算发出」的批量形态并排除。
4. `TrajectoryCall`（`detector.ts:35-43`）加可选 overlapped 标记；redundant_repeat 分支（`detector.ts:139-161`）排除 called 状态（对齐 `collector.ts:293`）与 overlapped 完成。跨流到达序不可靠由 issueSeq 单调配对兜底（发出序先于完成序是可靠信号）。
5. surface_success 机制原样保留：工具抛错后这些调用改走 tool_failed 路径，核验失败自然静默；机制留给未改造工具与回归观测。顺带修 update_chapter 核验适配器语义缺口——核验应核对 title/status 实际变更（`verify.ts:70-75` 现只查 content 非空，而工具只改 title/status；对照 `case-adapter.ts:190-191` 的精确判定）。

### D7 错误类别词表演进的指纹桥接：溯源标注，非自动归并

errorCategory 进入指纹四元组（`issue-doc.ts:25-28`）。词表切换后，旧机制产物（errorCategory "Object"/"unknown" 的 tool_failure 文档）与新类别文档指纹不同，不会自动归并。既有 aliasOf 机制（`issue-store.ts:97-98`、`issue-doc.ts:125`）语义是「指纹演变前的历史指纹」：ingest 时登记旧指纹哈希，仅作新文档的溯源标注（渲染为历史指纹，`issue-doc.ts:206`），不发生归并或重定向。

桥接方式：同一 `(tool, tool_failure)` 组合的新类别文档首次 ingest 时，若旧机制指纹 `issueFingerprint(tool, "tool_failure", "Object")`（及 "unknown"）对应的文档实际存在（读索引确认），把旧指纹作为 aliasOf 登记，使新文档标注历史来源；旧文档保留独立不重写。人工观察期内同类失败若拆档，确认后合并。既有日志文件不迁移。

### D8 update_chapter 增强

- **双寻址**：参数支持 chapter_id / chapter_number 二选一，复用 `read_chapter_content` 的 locator 形态（`chapter.ts:395-400`）——消除批量语境「手里只有序号、工具只要 UUID」的错配（writing_batch 表全程序号，`novel-store/src/index.ts:1000`）。
- **归属过滤**：查询按解析出的当前小说过滤——复用同域工具的 `resolveNovelId` 路径（参数匹配 → 单书兜底，`tools/shared.ts:72-78`），不引入会话绑定依赖：复测适配器（`case-adapter.ts:161-199`）在隔离临时项目以合成夹具运行复测会话（`retest.ts:265-278`），无会话→小说绑定，会话绑定过滤会使其合法夹具全部 `not_found`、复测链路报废（复测 agent 被限定不得调用白名单外能力，`retest.ts:59-61`，无法改调 list_chapters 定位）。解析小说范围外的跨书 ID 一律 `not_found`；任务含复测适配器回归验证。
- **描述与指引**：工具描述与参数描述声明 chapter_id 必须来自 `list_chapters` / `read_chapter_outline` / 章纲生成返回，禁止构造；`not_found` 失败文本给出「先列举/读章纲定位真实 ID，或派发 @outliner 生成章纲创建」的指引。
- **代理面**：director 工具表补 update_chapter 条目（说明用途、ID 来源、批量场景应交 @pipeline 步骤 8）；writer/reviser 提示词补「章节标识来自上游分发或快照，不得自造」（`agents/writer.ts:185`、`agents/reviser.ts:33` 现只给参数名）。

### D9 未初始化项目引导

- `novel-writer-v2.ts:73`：非小说目录注册一个最小上下文源，注入「本项目未初始化小说」状态与初始化路径（list_novels / init_novel）。
- director prompt 增加「未初始化项目」路由小节：确认项目状态用初始化工具，不以 read 探测 package.json / `.novel/*` 推断项目性质。
- 不做产品级守卫拦截 read 命中 `.novel/` 前缀（过度工程，prompt+引导已消除盲读动机）。

### D10 失败证据脱敏标识符

现状失败证据只记录 tool/errorType/errorCode/errorDigest 与 paramKeys（仅键名，`collector.ts:245-256`、`evidence.ts:166-184`），无法定位失败调用的目标对象（如哪个章节）。为失败证据增加脱敏标识符摘要：从调用参数提取 ID 形态键（`*_id` 白名单，沿用既有参数白名单机制扩展）的值，做脱敏截断（短哈希或短标识），与 paramKeys 并存；证据不含正文片段或完整参数值。成功核验通道的 verifyIdentifiers 机制（`collector.ts:425-429`）不改动，仅失败证据对齐同一脱敏边界。

## Risks / Trade-offs

- [门禁转 throw 改变工具卡片呈现（完成态 → 错误态）] → 接受：错误态更符合「未完成」语义；实施前核查 `metadata.blocked`/`rejected`/`refused`/`valid`/`ok` 的全部消费方（UI、路由、提示词、测试）：失败路径不落结构化 metadata（ToolStateError.structured 恒空），被确认依赖的展示信息必须写进失败文本（任务 3.5、7.2）；成功路径的 metadata 展示不受影响。
- [约 151 处转换 + 约 30 个测试文件更新，回归面大] → 按工具文件分批转换，每批聚焦测试 + `bun typecheck`；迭代期不跑全量（测试节奏规约）。
- [归属过滤若误选会话绑定路径会报废复测链路] → D8 选 `resolveNovelId`（参数匹配 → 单书兜底）；任务 3.6 验证复测适配器夹具回归。
- [errorCategory 词表变化改变指纹，旧文档可能漏归并] → D7 alias 溯源标注；观察期内同类失败若拆档，人工确认后合并。
- [schema 变更遗漏 SDK 再生 → CI generate 红] → 任务内置仓库根 `bun ./script/generate.ts` 步骤（既往「协议变更双再生」教训）。
- [reader 层 TaggedErrorClass 未覆盖的原因（如权限）落入兜底分支] → 兜底 message 保留原始 PlatformError 摘要，类别标 `internal`，不虚构具体原因。
- [批量区分依赖 called/success/failed 事件都送达（会话中断时 failUnsettledTools 兜底）] → 中断路径已发布失败结算（`publish-llm-event.ts:213-232`），在途集合随之清空，不残留假性 overlap。

## Migration Plan

按依赖序落地，每步可独立回滚：

1. schema UnknownError 可选字段 + llm ToolResultValue 载体 + 仓库根 `bun ./script/generate.ts`。
2. core host wrapTool / registry settleWith / publish-llm-event 透传链。
3. core read.ts 错误映射。
4. plugin 错误工厂 + chapter 族（含 chapter-guards 门禁 helper）→ 其余域（含 technique）+ 附带缺陷修复。
5. novel-store get()! 族。
6. tool-insight evidence 归类 / alias 桥接 / collector 批量配对（成功与失败两侧）/ detector / 失败证据标识符 / verify 适配器 + 文档同步。
7. agents 提示词与工具表（含 pipeline/writer 判定依据改写）+ 未初始化上下文源。

无数据迁移；既有 tool-insight 日志文件与问题文档不动。

## Open Questions

无。设计决策足以确定 specs 与任务拆分。
