# Tasks

## 1. 提取解析容错

- [x] 1.1 在 `packages/plugin/src/novel-writer/technique-extract.ts` 中新增共享的容错 JSON 提取函数(剥离 ```` ```json ```` 围栏、提取首个平衡 JSON 对象),供 `highlightTechniques`/`distillTechniques` 替换裸 `JSON.parse`;解析失败段数计入返回值。验证:`packages/plugin` 下新增单测覆盖带围栏/带前后废话/纯坏 JSON 三种 LLM 输出,原有 `technique-extract` 测试全部通过
- [x] 1.2 运行 `bun typecheck`(packages/plugin)与 `bunx oxlint packages/plugin/src/novel-writer/technique-extract.ts`(仓库根)均通过

## 2. 技法合并、查询与曝光位存储逻辑

- [ ] 2.1 在 `packages/plugin/src/novel-writer/technique-store.ts` 新增 `findTechniquesByName(name, directory)`(规范化名称匹配:trim + 空白折叠 + 大小写归一)与 `mergeTechniqueEvidence(id, evidence, directory)`(按 excerpt 去重追加证据,不改 status/confidence/usage_count)。验证:新增 `technique-store.test.ts` 用例——同名命中、证据去重、合并后 verified 状态与置信度不变
- [ ] 2.2 修改 `queryTechniques`:候选拆两路合并——置信度降序前列 + 按 `created_at` 降序的最近 `unverified` 技法(默认 2 条,排除 shadow/archived),合并去重后截断到 limit。验证:新增用例覆盖"高置信占满时新品仍入候选""无新品时结果与旧逻辑一致""候选总数不超 limit"
- [ ] 2.3 运行 `bun typecheck`(packages/plugin)与 technique-store 相关测试通过

## 3. 对话学习与召回工具

- [ ] 3.1 在 `packages/plugin/src/novel-writer.ts` 新增 `save_technique` 工具:schema 强校验(name/principle/instruction/scene_types/level/evidence[]/common_misuse + 可选 merge_target_id),复用 `filterTechniques` 过滤规则与 `normalizeTechnique`,同名自动合并或按 merge_target_id 显式合并,返回 `{ action: "created"|"merged"|"rejected", technique_id?, reason? }`;按 `record_technique_feedback` 先例在权限配置处注册为 allow。验证:新增单测覆盖 created/自动 merged/显式 merged/黑名单拒绝/无证据拒绝五条路径
- [ ] 3.2 在 `packages/plugin/src/novel-writer.ts` 新增 `search_techniques` 工具:按名称关键词、场景类型、层级、状态过滤,返回 id/name/principle/instruction 摘要。验证:新增单测覆盖空库、关键词命中、场景过滤、状态过滤
- [ ] 3.3 在 `packages/plugin/src/novel-writer.ts` 新增 `confirm_techniques` 工具:入参 ids,逐个调 `incrementTechniqueUsage`,按 1000 token 预算(`applyP7Budget` 复用)裁剪后返回格式化的"写作技法指导"段落文本。验证:新增单测覆盖计数递增、超预算裁剪、空数组返回空段落
- [ ] 3.4 运行 `bun typecheck`(packages/plugin)、`bunx oxlint`(仓库根,触及路径)与 `packages/plugin` 全部 novel-writer 测试通过

## 4. 快照去自动注入与 Agent 指引

- [ ] 4.1 修改 `packages/plugin/src/novel-writer/context.ts` 的 `formatSnapshotToolOutput`:删除 `techniqueInjectionEnabled` 选项与"写作技法指导"注入分支,候选一律以 shadow 段落格式输出;`SnapshotToolOutput` 移除 `injectedTechniqueIds` 字段。修改 `packages/plugin/src/novel-writer.ts` 的 `assemble_context_snapshot` 工具 execute:删除 `readTechniqueInjection` 调用与计数循环。验证:`context-snapshot.test.ts`、`technique-e2e.test.ts`、`technique-injection.test.ts` 同步更新后全部通过
- [ ] 4.2 在 `packages/plugin/src/novel-writer/agents/director.ts` 指令表与 `agents/pipeline.ts` 新增"技法学习"段落:触发示例("来学习这本书籍的写作技巧")、范围确认(整本默认分批逐章,可指定单章)、每章报告格式(新学/合并/拒绝计数与拒绝原因)、合并判断步骤(先 search_techniques 再 save)、完成汇总格式。验证:`technique-prompt-alignment.test.ts` 风格的新断言通过——提示词包含触发示例与报告格式要求
- [ ] 4.3 在 `agents/pipeline.ts` 新增"技法召回评估"步骤(注入开关开启时):对快照候选逐条对照章节大纲/标题评估相关性;不满意则调 `search_techniques` 多轮召回;确认默认 ≤3 条后调 `confirm_techniques` 计数并取回段落文本,原样放入 writer dispatch prompt;确认列表替代原候选段落传给 auditor。删除提示词中"快照含写作技法指导段落则原样传递"的旧指令(快照不再产生该段落)。验证:新增提示词对齐测试覆盖评估/多轮/确认列表三个要点
- [ ] 4.4 运行 `bun typecheck`(packages/plugin)与相关测试通过

## 5. 端到端验证

- [ ] 5.1 用真实书库(如 `C:\Novels` 下任一书)在写作会话中发送"来学习这本书籍的写作技巧",观察逐章进度报告;完成后查 `<书目录>\.novel\novel.db` 的 `techniques` 表有条目(unverified/0.5),App 技法库面板可见,且重复学习同名技法时证据合并、不产生重复行
- [ ] 5.2 同一书库再发"来学习第 1 章的写作技巧",验证只处理指定章节;发送普通写作指令验证不触发学习流程
- [ ] 5.3 开启该书的 `technique_injection` 后跑一章写作:观察 pipeline 输出召回评估过程(首轮候选→评估→确认列表→confirm_techniques),writer prompt 仅含确认技法,被否决候选不进 prompt 也无 auditor 反馈;确认后查 `usage_count` 对确认技法递增;shadow log 候选含未验证新品(库中有高置信技法时);auditor 仅对确认列表提交反馈
