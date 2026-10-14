# Design: 知识边界写作约束

## Context

写作管线已有两层相关机制，本提案在其上修补而非新建：

- **反馈意图协议**（`packages/plugin/src/novel-writer/agents/feedback-intent.ts`）：director 与 pipeline 持有派发前必读段（DISPATCHER），writer/reviser 持有执行段（EXECUTOR），auditor 持有审计段（AUDITOR）。意图类型枚举固定为 `remove_assertion / replace_assertion / constrain_future / narrative_fact / unclear` 五种；`narrative_fact` 可标记"允许正文否定：true"，是当前泄漏的根源之一。
- **场景硬约束清单**（`scene-constraints.ts` 的 `compileSceneChecklist`）：确定性解析章纲「## 关键场景」段的 `- **字段名**：值` 行（FIELD_RE 只认 地点/时间/出场角色/场景概要/字数预估 五字段）。编译结果有三处消费点，全部经同一函数产出：快照组装（`recall.ts:656` 编译存入快照包、`context.ts:756` 输出清单段）、`read_outline` 兜底路径（`novel-writer.ts:1065` 追加在章纲正文后）。writer 规则 32【章纲场景覆盖】将其列为硬约束。
- outliner agent 以 JSON 创作意图为输出格式，经 `generate_chapter_outline` 持久化为章纲 markdown；章纲默认模板在 `outline.ts`（场景字段均为（待填写）占位符，解析器对占位符/缺失字段容差跳过）。
- 全管线无"谁知道什么"的持久化或提示词层跟踪；writer 规则 3（第三人称限知视角）与规则 19（信息悬念分类）是仅有的邻近概念。

## Goals / Non-Goals

- Goals：知识边界类反馈有专用意图通道且正文不直述元否定；信息差场景在章纲/快照层带知情范围约束，生成期压住知情错位；审计能识别两类新知识边界违规。
- Non-Goals：不建角色知识状态表（全书级跟踪留待后续）；不改 observer 事实提取 schema；不动 37 维审计主流程与审批 UI；不约束用户明确要求的元小说写法。

## Decisions

### D1：协议新增 `knowledge_boundary` 意图类型，而非复用 `replace_assertion`
知识边界反馈的语义是"确立视角内可见的事实集合"，与"把 X 改成 Y"的断言替换不同：它的期望状态（家人担心晚归）要靠知情范围内的**新增言行**呈现，而不是替换某个词。复用 `replace_assertion` 会让 EXECUTOR 把注意力放在旧句改写上，继续产出"不会去问他不知道的事"式复述。新类型字段沿用既有意图块结构（目标引用/期望状态/保留内容/允许正文否定），不新增协议语法，只需扩展类型枚举与三条规则文本。
- 备选：只用既有类型 + 在期望状态里措辞规避——被否：无法阻止 dispatcher 把认知动词句判为 `narrative_fact`，漏洞仍在。

### D2：`narrative_fact` 收紧按"认知动词"判定，而非按语义理解判定
DISPATCHER 规则改为：含"知道/知晓/意识/不知情/了解/察觉"类认知动词、宾语为剧情事实的语句 MUST NOT 判为 `narrative_fact`，默认走 `knowledge_boundary`，缺知情角色/范围信息时走 `unclear`。用动词表做确定性启发，宁可误收进 knowledge_boundary（执行规则本身允许写"他不知道"以外的自然呈现）也不放进 narrative_fact（会授否定许可）。EXECUTOR 为 knowledge_boundary 增加呈现方式白名单：删除矛盾旧断言、知情范围内言行、POV 角色内心独白的有限例外。
- 备选：让 dispatcher 自由判断语义——被否：正是自由判断把"家人不知道主角坠崖"判成了剧情事实，需要窄口径硬规则。

### D3：信息边界走章纲可选字段 + 确定性编译进既有清单，而非快照层 LLM 推断
场景「信息边界」字段由 outliner 在生成章纲时标注（它对全章信息差有全局视野），`compileSceneChecklist` 的 FIELD_RE 增加该字段映射为「知情范围」，快照与兜底路径零改动自动继承（两者都调用同一编译函数）。writer 规则 32【章纲场景覆盖】扩展一段知情范围约束，pipeline dispatch 指示（pipeline.ts 步骤 3）同步点明同等级。字段缺失/占位时按既有容差跳过，旧章纲行为不变。
- 备选 A：快照组装时用 LLM 从章纲正文推断知情范围——被否：多一次 LLM 调用、结果不确定，且与"确定性编译"既有架构原则相悖。
- 备选 B：writer 自行从章纲正文推断——被否：正是 writer 推断失败导致生成期错位，约束必须显式化。

### D4：outliner 只在"存在信息差"时要求标注，允许省略或填「无」
强制每个场景标注会制造噪音（大多数场景无信息差），且 LLM 容易为凑字段编造边界。规则为：快照剧情含"某在场/被提及角色不知情的既成事实"时 SHALL 标注，否则 MAY 省略或填「无」。outliner JSON 输出格式 `scenes[]` 增加可选 `knowledgeBoundary` 字段，提示词给出与本文用户案例同构的正反例各一。

## Risks / Trade-offs

- [认知动词表误伤] → 角色对话中的认知动词（"他知道我知道"）被误编译：判定语境限于"用户反馈语句"而非正文；`unclear` 兜底要求 dispatcher 在缺知情角色信息时澄清而非猜测。
- [outliner 漏标信息差] → 漏标等价于现状（无回归），writer 规则只在清单含「知情范围」行时生效；用户纠正时走 D1 意图通道兜底。
- [writer 过度防御] → 规则措辞限定"清单含知情范围行时"才禁止直述，避免无信息差章节被误伤正常否定句（如"他没有带伞"）。
- [auditor 新检查项误报] → feedback_focus 仅在存在反馈意图时运行，检查对照意图逐条引用正文原句，不影响无反馈的 37 维主审计。

## Migration Plan

纯 prompt 与确定性解析变更，无数据迁移：旧章纲无「信息边界」字段时编译输出与现状一致；新字段从下一章纲开始自然出现。回滚即还原相关源文件，无状态残留。
