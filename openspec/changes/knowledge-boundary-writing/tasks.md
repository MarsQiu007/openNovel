# Tasks

## 1. 反馈意图协议扩展（feedback-intent.ts）

- [x] 1.1 DISPATCHER 编译字段段：意图类型枚举 `remove_assertion / replace_assertion / constrain_future / narrative_fact / unclear` 增加 `knowledge_boundary`，并给出该类型的字段约定（目标引用/知情角色/知情范围/期望状态/允许正文否定默认 false）；验证：packages/plugin 下相关测试通过
- [x] 1.2 DISPATCHER 转换规则段：新增"含知道/知晓/意识/不知情/了解/察觉类认知动词且宾语为剧情事实"的判定规则——不得判为 `narrative_fact`，默认 `knowledge_boundary`，缺知情角色或知情范围信息时 `unclear` 澄清；既有"他没有带伞"正例保留；验证：prompt 文本断言测试通过
- [x] 1.3 EXECUTOR 段：新增 `knowledge_boundary` 执行规则——只允许删除矛盾旧断言、用知情范围内可观察言行（对话/动作/反应）呈现期望状态；禁止直述"X 不知道 Y/没意识到 Y"类元否定；唯一例外为叙述视角角色内心独白的限知呈现；给出"家人不知道主角坠崖，只知道他很晚回来，很担心"的正反改写示例；验证：prompt 文本断言测试通过
- [x] 1.4 AUDITOR 段（feedback_focus 分支）：新增两项检查——知识边界元否定直述（"X 不知道 Y"类句子）与知情范围外言行（对不知情事件表现知情特征）；每项 FAIL/WARN 引用正文原句与对应意图编号；验证：prompt 文本断言测试通过

## 2. 章纲信息边界标注（outliner.ts + outline.ts）

- [x] 2.1 outliner 输出格式 JSON：`scenes[]` 增加可选 `knowledgeBoundary` 字段；职责段新增"信息差场景识别"规则——某在场/被提及角色对既成事实不知情时 SHALL 标注各出场角色知情范围（谁知道什么、谁不知道什么、依据哪段前文），无信息差场景省略或填「无」；附与"主角坠崖回家"同构的正反例；验证：prompt 文本断言测试通过
- [x] 2.2 outliner 持久化指示：明确要求把 `knowledgeBoundary` 渲染为章纲 markdown 场景段内的 `- **信息边界**：…` 字段行（不新增二级/三级标题，保持编译器解析形态）；验证：prompt 文本断言测试通过
- [x] 2.3 outline.ts 章节大纲默认模板：四个场景模板的字段行后追加 `- **信息边界**：（待填写）` 可选行；验证：模板输出含该字段行、（待填写）占位被解析器跳过

## 3. 场景清单编译（scene-constraints.ts）

- [x] 3.1 FIELD_RE 字段表扩展"信息边界"，FIELD_LABELS 映射为"知情范围"；字段值为空/（待填写）时跳过该字段的既有容差不变；验证：scene-constraints.test.ts 新增用例通过（含字段→知情范围行输出、无字段不输出、占位符跳过）
- [x] 3.2 快照与 read_outline 兜底路径不改动，确认两者经同一 `compileSceneChecklist` 自动继承新字段（阅读 context.ts 与 novel-writer.ts 调用点核对，无需改码）；验证：context-snapshot 相关既有测试通过

## 4. writer 与 pipeline 提示词

- [x] 4.1 writer.ts 规则 32【章纲场景覆盖】扩展知情范围约束段：清单条目含「知情范围」时，该场景出场角色只表现知情范围内言行，不得对不知情事件表现知情特征（知情者措辞、刻意回避、配合表演），不得直述"X 不知道 Y"元否定（POV 角色内心独白例外），期望状态靠知情范围内言行自然呈现；验证：prompt 文本断言测试通过
- [x] 4.2 writer.ts 自检清单（"6. 自检"段）追加知情范围核对项；验证：prompt 文本断言测试通过
- [x] 4.3 pipeline.ts 步骤 3 dispatch 指示点明「知情范围」行与场景覆盖、角色白名单同等级；步骤 5 reviser dispatch 指示确认 EXECUTOR 段已含知识边界规则（reviser prompt 已内嵌 EXECUTOR，核对无需重复粘贴）；验证：prompt 文本断言测试通过

## 5. 测试与回归

- [x] 5.1 scene-constraints.test.ts 增补信息边界编译用例（3.1 所列三态）；验证：通过
- [x] 5.2 writing-feedback-intent.test.ts 更新与增补：把既有"调度方提示词包含五类转换规则和关键示例"用例更新为六类（增 knowledge_boundary）；增补断言：DISPATCHER 含认知动词排除规则、EXECUTOR 含呈现白名单与 POV 例外、AUDITOR 含两项新检查；验证：通过
- [x] 5.3 用户案例端到端提示词走查：以"家人不知道主角坠崖，只知道他很晚回来，很担心"为输入，人工核对 director→pipeline→reviser 链路各环节提示词均含对应约束（不跑真实 LLM）；验证：走查记录写入任务备注
- [x] 5.4 packages/plugin 目录 `bun test` 全绿；仓库根 `bun run typecheck` 与 `bun run lint` 0 errors 且新增代码零告警；验证：全部通过

## 走查记录（5.3）

用户案例"家人不知道主角坠崖，只知道他很晚回来，很担心"端到端走查（不跑真实 LLM，仅核对各链路提示词）：

- director 链路：directorAgentConfig.systemPrompt 内嵌 DISPATCHER 协议段，测试断言其含 knowledge_boundary 类型枚举、认知动词排除规则与字段约定（"知识边界意图协议 > 调度方将认知动词句排除出剧情事实并编入知识边界"用例覆盖）。
- pipeline 链路：pipelineAgentConfig.systemPrompt 内嵌同一 DISPATCHER 段（同上测试覆盖 pipelinePrompt），且步骤 3 dispatch 指示含「知情范围」同等级约束（"pipeline dispatch 指示点明知情范围同等级约束"用例覆盖）。
- reviser 链路：reviserAgent.prompt 内嵌 EXECUTOR 段，测试断言其含知识边界执行两种方式、直述禁止与 POV 例外（"执行者只允许删除矛盾断言与知情范围内言行呈现"用例覆盖 writer 与 reviser 双 prompt）。
- auditor 链路：auditorAgent.prompt 内嵌 AUDITOR 段，测试断言其含直述元否定与知情范围外言行两项检查。
- 生成期链路：outliner prompt 含信息差场景识别职责与 knowledgeBoundary 输出字段；scene-constraints 编译器将「信息边界」映射为「知情范围」进入快照与 read_outline 兜底（同一份编译函数，三处消费点自动继承）；writer 规则 32 与自检清单含知情范围约束。
