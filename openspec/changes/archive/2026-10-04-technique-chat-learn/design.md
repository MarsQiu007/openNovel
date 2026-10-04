# Design

## Context

写作 agent(novel-writer 插件)当前只有 `record_technique_feedback` 一个技法工具,只能给已有技法打分,没有任何写入技法库的路径;技法入库仅存在于 CLI(`extract-techniques`/`seed-techniques`)与 App 面板手动新建。插件工具上下文(`PluginInput`)只暴露 client/clientV2/directory/serverUrl,**没有 LLM 调用通道**。召回侧:检索一次性发生在快照组装的 P7 步(`context.ts`),场景类型靠章节标题关键词正则推断,top-5 按置信度排序;注入开启时由 `formatSnapshotToolOutput` 在快照输出里直接拼"写作技法指导"段落(`applyP7Budget` 裁剪),`assemble_context_snapshot` 工具 execute 内对 `injectedTechniqueIds` 调 `incrementTechniqueUsage`——整个过程无 agent 相关性评估;`technique-vector.ts` 的余弦相似度为无人调用的死代码。实测全部书库 `techniques` 表为 0 条。动机见 proposal.md - Why。

## Goals / Non-Goals

Goals:
- 用户一句话即可触发学习,agent 自主完成读章、提炼、落库、合并、报告。
- 落库规则(初始状态、过滤、合并语义)与现有 technique-library spec 完全一致。
- 注入路径由 agent 评估把关:多轮召回、相关性确认后才影响正文生成。
- 新品(unverified)有保证的曝光位,shadow 反馈闭环能覆盖到它们。
- 修复提取管线 JSON 解析的静默失败(围栏剥离),CLI 与后续复用共用。

Non-Goals(设计层面):
- 不给插件引入 provider/LLM 运行时依赖。
- 不做向量 embedding 查重或语义召回;召回评估是"规则检索 + agent 判断"。
- 不改动 auditor 的 37 维审计维度与反馈贝叶斯状态机参数。
- 不改动 shadow 模式(注入关)的既有行为:候选可见、auditor 对全部候选反馈照常,只是候选构成多了曝光位新品。
- 不改动 App 面板、CLI 命令。

## Decisions

### D1: agent 驱动 + 工具落库,而非工具内嵌 LLM 管线

对话学习中"读章节→高亮→蒸馏"的智能由 agent 自身完成(复用 `technique-extract.ts` 中已有提示词知识作为 agent 指引),新增的工具只做确定性的事情:校验、过滤、规范化、合并、落库。

- 理由:插件工具拿不到 LLM(`PluginInput` 无 provider);现有架构的智能全在 agent 提示词 + 持久化工具(如 observer 提炼设定→`commit_observer_delta` 落库),本条路径完全同构。
- 备选(拒绝):工具内部跑 segment/highlight/distill 管线。需要在 plugin 引入 provider 依赖、重复 CLI 已有实现,且 agent 无法中途判断合并,长书批处理也更僵硬。

### D2: 新增三个工具

- `save_technique`:入参 `name/principle/instruction/scene_types/level/evidence[]/common_misuse`,可选 `merge_target_id`。内部顺序:schema 校验 → 复用 `filterTechniques` 规则(VAGUE_PATTERNS 黑名单、instruction 长度 > 10、必须有证据)→ `normalizeTechnique` → 同名检索(规范化名称匹配)自动合并证据,或按 `merge_target_id` 显式合并 → `upsertTechnique`。返回 `{ action: "created"|"merged"|"rejected", technique_id?, reason? }`。
- `search_techniques`:按名称关键词、场景类型、层级、状态过滤,返回 id/name/principle/instruction 摘要。学习流程用它做合并判断;召回评估用它做多轮检索——一个工具两个场景共用,避免再出一个只有查询语义的姊妹工具。
- `confirm_techniques`:入参 `ids: string[]`(agent 确认的最终注入列表)。内部对每个 id 调 `incrementTechniqueUsage`,并用 `formatTechniqueGuidanceLines` 返回拼好的"写作技法指导"段落文本,供 agent 原样放进 writer dispatch prompt。它把"使用计数"和"段落格式"这两件确定性的事从 agent 的自由文本里收回来——没有这个工具,注入了哪些技法、计数是否递增都不可验证。

### D3: 合并语义——证据合并,状态不动

合并只做一件事:把新证据按 excerpt 去重后追加到目标条目。`status/confidence/usage_count` 一律不改——`verified` 条目合并后仍是 `verified`、原置信度;新条目才以 `unverified`/0.5 入库。这与 spec `同名合并保留已有状态与置信度` 一致,也避免对话学习污染反馈闭环的贝叶斯状态机。

- 备选(拒绝):合并时取两边置信度均值——会把人工种子的 0.8 拉低,且与"反馈驱动置信度"的状态机设计冲突。

### D4: 同名匹配用规范化名称

`findTechniquesByName` 内部对名称做 trim + 空白折叠 + 大小写归一后再比较;入库侧 `normalizeTechnique` 的字段语义不变(它本身不做名称归一,归一只发生在匹配时)。规范化名称相同即视为同一技法自动合并;不同但近似的,由 agent 用 `search_techniques` 对比后显式传 `merge_target_id`。

### D5: 解析容错放在共享提取模块

`technique-extract.ts` 的 `highlightTechniques`/`distillTechniques` 改为:剥离 ```` ```json ```` 围栏 → 提取首个平衡 JSON 对象 → 解析失败时返回空并在结果中计数解析失败段数。CLI 输出从"提取 0 条"变为可诊断。对话学习路径不受影响(agent 结构化调用工具),但共享模块修复避免下次接入时重蹈覆辙。

### D6: agent 流程指引放 director/pipeline 提示词;新工具按 allow 注册

在 director.ts 指令表与 pipeline.ts 增加"技法学习"段落:触发示例("来学习这本书籍的写作技巧")、范围确认(整本默认分批逐章;指定章节则单章)、每章必报告计数与拒绝原因、合并判断步骤(先 search_techniques 再决定 save 参数)、完成汇总格式。

三个新工具按 `record_technique_feedback` 先例注册为 `allow`:`save_technique` 只新增行或追加证据,不删改既有内容,合并不动状态与置信度,属可逆行级写入;学习本身由用户一句话显式触发,再叠审批弹窗会破坏该交互意图。若未来被纳入高影响工具清单,需为学习流程豁免确认。

### D7: 召回评估——注入路径由 agent 把关,多轮召回后再注入

注入开关开启时,快照不再自动注入,改为 pipeline agent 的"评估→可选多轮检索→确认→注入"四步:

1. **评估**:agent 将快照候选(含 D8 曝光位新品,shadow 段落格式)逐条与当前章节大纲、标题、场景对照;场景类型正则推断只决定首轮检索,最终相关性以 agent 判断为准。
2. **多轮召回**(可选):首轮不满意时,agent 调 `search_techniques` 换场景类型/关键词/层级再查,以确认列表为收敛点(实践中 1-3 轮)。
3. **确认**:`confirm_techniques(ids)` 确定性记录使用计数,返回拼好的"写作技法指导"段落;agent 把该段落原样放进 writer dispatch prompt。未确认候选 MUST NOT 注入。
4. **反馈**:auditor 的技法反馈对象 = 确认列表(见 shadow-loop spec 的 MODIFIED requirement);注入开启时快照候选段落仅作评估输入,不再标注"可作为正文指令"。

配套改动:`formatSnapshotToolOutput` 删除 `techniqueInjectionEnabled` 选项与"写作技法指导"注入分支,候选一律以 shadow 段落格式输出;`SnapshotToolOutput.injectedTechniqueIds` 字段移除;`assemble_context_snapshot` 工具 execute 删除 `readTechniqueInjection` 与计数循环;`applyP7Budget` 的 1000 token 预算改由 `confirm_techniques` 在返回段落前裁剪(确认列表默认 ≤3 条,预算内按匹配分截取)。

- 理由:相关性是判断题不是计算题——正则场景推断粗糙(标题不含关键词即 general),置信度排序与"本章该不该用"无关,让 agent 评估一次成本极低而误注入代价高(污染正文风格)。
- 备选(拒绝):沿用自动注入 + 提高正则命中率——治标不治本,标题关键词覆盖不了语义相关性。
- 备选(拒绝):接入向量语义检索——无 embedding 基础设施,且当前库规模(几十条以内)下规则检索 + agent 判断足够,语义检索留作库规模化后的演进方向。

### D8: 新品曝光位实现在 store 层,拆路合并

`queryTechniques` 改为两路合并:一路按置信度降序取前列,另一路按 `created_at` 降序取最近 `unverified` 技法(默认 2 条,排除 `shadow`/`archived` 状态),合并去重后截断到总数上限(top 5)。放在 `technique-store.ts` 而非 context.ts,便于单测;shadow log 记录的是合并后的最终候选,auditor 无需感知机制差异。

- 备选(拒绝):前端/agent 提示词里要求"优先考虑新品"——不可靠,agent 可能忽略;曝光位必须是检索层的确定性保证。

## Risks / Trade-offs

- [agent 提炼质量不稳定、字段漂移] → `save_technique` schema 强校验 + 黑名单过滤兜底,拒绝时返回具体原因让 agent 当场修正重试。
- [整本学习 token 消耗大] → 提示词要求分批逐章处理,每章独立 save;超长书建议用户按卷学习。
- [agent 编造 evidence 原文] → 工具层无法校验原文真实性,提示词要求逐字引用章节片段;已知限制,后续可加原文存在性校验。
- [同名归一误判把不同技法合并] → 自动合并仅按规范化名称,动状态需 agent 显式;误合可在 App 面板人工编辑(拆分留作后续能力)。
- [召回评估增加每章流水线时延] → 评估是一轮纯推理 + 可选 1-3 次轻量查询,相对起草/审计的 LLM 开销可忽略;若候选为空整步跳过。
- [agent 评估过度保守导致注入率骤降] → shadow 数据(含曝光位)持续积累,评估提示词给出"宁可注入相关技法也不漏"的倾向性指引,后续按 shadow log 统计校准。
- [快照不再自动注入,旧测试/提示词引用"写作技法指导"段落失效] → 任务清单已列入 context-snapshot.test.ts、technique-e2e.test.ts 与 pipeline 提示词的同步修改;`formatTechniquesForPrompt` 保留供 confirm_techniques 复用。
- [学习过程阻塞写作流水线] → 学习是用户显式触发的独立对话流程,不挂接 8 步流水线,不影响正常写作。

## Migration Plan

无 schema 变更,复用现有 `techniques`/`technique_feedback`/`technique_shadow_log` 表;新工具对既有数据只读追加,曝光位只改变候选构成不改变数据结构。注入开关语义从"快照自动注入"变为"agent 评估后经 confirm_techniques 注入",回滚 = 还原 plugin 代码,恢复自动注入;新入库数据不影响其他功能。

## Open Questions

无——范围、落库规则、合并语义、召回评估流程均已在 spec 层确定。
