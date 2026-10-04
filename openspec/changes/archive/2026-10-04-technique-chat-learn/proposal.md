# Proposal

## Why

用户希望通过一句对话(如"来学习这本书籍的写作技巧")让 AI 从当前书籍中提取写作技法并进入技法库,但实际没有任何技法入库:写作 agent 没有新增技法的工具,唯一的入库路径是 CLI 命令和 App 面板手动新建,对话中学习的内容只停留在当次上下文里,会话结束即丢失。实测全部书库的 `techniques` 表均为 0 条,与"从未有入库发生"的判断吻合。

此外,技法召回侧同样被动:检索一次性发生在快照组装时,场景类型靠标题关键词正则推断,top-5 按置信度排序后直接注入,没有任何 agent 相关性评估;新入库的 unverified 技法在与高置信技法竞争时可能永远挤不进前 5,shadow 反馈闭环轮不到新品。

## What Changes

- 写作 agent 新增对话式技法学习流程:识别"学习本书/本章写作技巧"类指令,支持整本与逐章两种范围,读章节正文、提炼技法并落库。
- 新增 `save_technique` 工具:agent 将提炼出的技法写入技法库,初始状态 `unverified`/置信度 0.5,复用现有模糊指令黑名单过滤,拒绝无证据或过短指令的候选。
- 新增 `search_techniques` 工具:按名称关键词/场景类型/层级/状态查询现有技法,供学习合并判断与召回评估共用。
- 新增 `confirm_techniques` 工具:pipeline agent 确认最终注入列表时调用,确定性递增使用计数并返回格式化的『写作技法指导』段落文本,替代原快照工具内的自动注入与计数。
- 新增同类合并:同名技法自动合并证据;近似技法由 agent 对比后显式指定合并目标,合并只追加证据,不降级已有的 `verified` 状态与置信度。
- 新增召回评估流程(注入开关开启时):pipeline agent 对候选逐条评估与章节大纲的相关性,可进行多轮检索(调整场景类型/关键词/层级),确认最终列表(默认 ≤3 条)后经 confirm_techniques 计入使用再注入 writer prompt;快照组装不再自动注入。
- 新增未验证新品曝光位:检索候选在置信度排序前列之外,额外纳入最近入库的 `unverified` 技法,保证新品进入 shadow 反馈闭环。
- 修复提取管线 LLM 输出解析脆弱点:剥离 markdown 围栏后再解析,消除对话学习与 CLI 提取共用的静默归零失败。

## Capabilities

### New Capabilities

- `technique-chat-learning`: 对话式技法学习流程——一句话触发意图识别、整本/逐章范围选择、学习进度与结果报告、同类合并的 agent 行为规范。

### Modified Capabilities

- `technique-library`: 新增对话式学习入库路径的落库规则(unverified/0.5 初始状态、模糊指令过滤、同名合并证据且不降级已有状态)。
- `technique-injection`: 开启注入后,由 pipeline agent 评估候选、支持多轮召回、确认后才注入 writer prompt(替代直接 top-5 自动注入)。
- `technique-shadow-loop`: 检索候选时为 `unverified` 新品保留曝光位,保证新品获得 shadow 反馈机会。

## Non-Goals（非目标）

- 不改动 App 技法库面板 UI,学习入口仅为对话。
- 不改动 CLI `extract-techniques`/`seed-techniques` 的命令行接口与行为。
- 不引入 embedding 向量语义检索或向量查重,合并与召回评估基于规则匹配与 agent 判断。
- 不支持从书库以外的外部文件/URL 学习(外部文本仍走 CLI 提取路径)。
- 不改动 auditor 37 维审计维度与既有反馈贝叶斯状态机规则。

## Impact

- `packages/plugin`: 主影响面——新增 `save_technique`/`search_techniques` 工具、合并与查重逻辑、召回评估与新品曝光位、agent 提示词、提取解析容错。
- 无数据库 schema 变更:复用现有 `techniques`/`technique_feedback`/`technique_shadow_log` 表,与全部既有本地数据兼容。
- 不触碰 protocol/schema/client/app/desktop,无需重新生成 SDK。
