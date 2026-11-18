# Proposal

## Why

tool-insight 生产日志（2026-11-17 ~ 11-18，4 个会话）显示工具失败信号存在结构性断裂：工具实际失败（如更新不存在的章节）以成功形态返回，模型、会话运行器、tool-insight 核验三方对「成功/失败」的判定互相脱节——单指纹「update_chapter / surface_success」累计 50+ 次发生，失败信号过软导致模型 62 秒后原样重试同一批章节 ID；read 工具错误被折叠为无类别文本并在失败结算边界退化为字面量 "Object"，归因失效；detector 又把正常批量并行调用误判为表面成功/重复调用。失败信号闭环（工具 → 模型 → 观测）必须一次性打通，否则盲目重试与错误归因会持续发生。

## What Changes

- **插件工具失败语义统一为抛错通道**：novel-writer 写作工具的业务失败（目标不存在、参数无效、状态冲突、门禁拦截、内容拒绝、catch 吞错）改为以工具失败形态（抛出带稳定错误类别的错误对象）返回，模型可见为失败结果；约 151 处软返回（not_found/param_error/state_conflict/rejected/gate_blocked/error_swallow 六类）收敛，另有约 21 处空结果保持成功形态。两步确认预览、部分成功不属于失败，保持成功形态。
- **失败信息结构化**：每类失败携带稳定错误类别标识（进入 tool-insight 归因指纹）与可操作补救指引（对齐 generate_chapter_outline 跳号拒绝的正例形态）；失败文本自含全部行动信息（失败路径不落结构化 metadata，模型与 UI 在失败态只能读文本），不依赖 provider 的 is_error 标记（OpenAI/Gemini 无此标记）。
- **失败事件语义保留**：会话失败结算链（registry 结算 → publish-llm-event 发布）保留错误类别与错误码，`tool.failed` 事件不再退化为无类型 `{type:"unknown"}`（现状是 tool-insight 回退 `constructor.name` 恒得 "Object" 的根源）；packages/llm 结果值 error 变体与 packages/schema 事件 schema 增加可选载体字段（向后兼容），需重新生成 SDK。
- **read 工具错误映射**：宿主 read 工具把文件不存在、路径类型错误、权限失败、偏移越界、编码损坏等真实原因映射为结构化错误文本（含原因说明），不再统一折叠为 "Unable to read <path>"。
- **update_chapter 修复**：支持章节序号寻址（对齐 read_chapter_content 的双寻址）；查询按 resolveNovelId 解析小说过滤归属；工具描述声明 chapter_id 必须来自工具真实返回；「章节不存在」失败给出定位真实 ID 的补救指引。
- **tool-insight 检测联动**：detector/collector 区分「批量先发后收」与「success 后再次发起同参调用」，前者不再记为重复/表面成功问题（成功与失败两侧形状判定都排除批量形态）；错误类别从失败结算链正确归类（消灭 "Object" 与无谓的 unknown）；失败证据增加脱敏标识符摘要（如章节 ID）与参数键名；update_chapter 核验适配器核对 title/status 实际变更；指纹词表演进经 alias 溯源标注桥接既有问题文档。
- **代理面同步**：pipeline/writer 提示词对软返回 metadata 的重试判定依据改写为失败文本语义（转换后失败路径无 metadata 可读）；director 工具表补 update_chapter 条目；未初始化项目 director 获得最小初始化引导（用 list_novels/init_novel 确认状态），不再用 read 盲读 package.json/.novel/* 探测项目性质。
- **附带缺陷修复**：write_chapter 坐标泄漏检测死代码（嵌错 if 块永不可达）复活；technique.ts 顶层散字段（编码时被静默丢弃）迁回 metadata、其失败形态软返回一并转换；novel-store update 路径 3 处 `get()!` 非空断言（对不存在 ID 炸 TypeError）改为明确的「未找到」失败。

## Capabilities

### New Capabilities

- `tool-failure-semantics`: 写作工具与宿主基础工具的失败形态契约——业务失败必须以失败形态返回并携带稳定错误类别与补救指引，空结果/确认流/部分成功的形态边界，失败事件语义在会话事件层的保留，以及未初始化项目的引导行为。

### Modified Capabilities

- `tool-insight-log`: 轨迹检测增加批量并行与真实重试的区分规则（批量先发后收不得记为重复/表面成功问题）；证据归类消费规范化错误类别（不再出现 "Object"）；客观证据增加脱敏的稳定标识符摘要（如章节 ID）。

## Impact

- **packages/plugin**（主要）：novel-writer/tools/ 全部约 151 处软返回转换（含 chapter-guards 门禁 helper）、tool-insight/ 的 detector/collector/evidence/issue-store/verify 联动、agents/ 的 director/writer/reviser/pipeline prompt 与工具表更新、novel-writer-v2.ts 未初始化上下文源。
- **packages/core**：tool/read.ts 错误映射；失败结算链语义保留——plugin/host.ts wrapTool、tool/registry.ts settleWith、session/runner/publish-llm-event.ts（settledOutput 与 Tool.Failed 发布）。
- **packages/llm**：ToolResultValue error 变体增加可选 metadata 载体（provider 下沉序列化保持不变）。
- **packages/schema**：会话消息 UnknownError 增加可选错误类别/错误码字段（向后兼容）→ 需从仓库根运行 `bun ./script/generate.ts` 重新生成 SDK（openapi.json 第二步同步再生）。
- **packages/novel-store**：update 路径 3 处 `get()!` 非空断言改为明确「未找到」失败（全文件共 46 处 get()!，其余为插入后读回形态，不在范围）。
- **packages/opennovel / app / desktop**：无接口变更；工具失败在 UI 已按错误状态渲染，无新增文案面。
- **测试**：约 30 个工具行为测试文件需从断言软返回形状改为断言失败形态；tool-insight 套件增加批量区分/归类/脱敏标识符用例；agent 提示词判定依据测试同步改写。
- **兼容性**：不迁移既有日志文件与指纹；旧问题文档经 alias 溯源标注延续；数据模型无变化；ToolResult 插件合同不变（失败走既有 throw 通道，宿主 wrapTool 已有 reject→ToolFailure 映射）。

## Non-goals（非目标）

- 章纲生成串书（跨书数据隔离）与「仅清空章纲」轻量工具缺口：来自 user_report 独立问题，另立 change。
- 不新增「一次调用更新多章」的批量更新 API——检测器区分批量模式后，既有逐章调用不再误报。
- 不改各内容门禁（审批/顺序/字数/提纲标签/坐标泄漏）的拦截条件语义，只统一其失败返回形态。
- 不补齐 OpenAI/Gemini 协议层的 is_error wire 标记（provider 协议局限），失败文本自含语义即可。
- 不迁移、不改写既有 tool-insight 日志文件与问题指纹。
- 不动 ToolRuntime.dispatch 与 publish-llm-event 的 tool-error 事件分支（不在本地工具失败的生产路径上）。
