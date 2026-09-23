## 1. writer / reviser 提示词硬规则

- [x] 1.1 在 `packages/plugin/src/novel-writer/agents/writer.ts` 现有规则列表末尾追加"书籍坐标隔离"编号条目，明确禁止 `第N章`、`第N卷`、`本章`、`上一章`、`下一章` 作为旁白/角色记忆/故事时间/对话写入正文，给出故事层替代表达示例；验证：阅读提示词输出确认规则存在且与现有编号连续
- [x] 1.2 在 `packages/plugin/src/novel-writer/agents/reviser.ts` 提示词中同步添加书籍坐标隔离规则；验证：阅读提示词确认规则与 writer 一致
- [x] 1.3 在规则中标注元小说和书中书合法场景的豁免条件；验证：规则文本包含豁免说明

## 2. 快照上下文渲染隔离

- [x] 2.1 重构 `packages/plugin/src/novel-writer/context.ts` 中"最近章节摘要""早期章节段摘要""召回历史""卷纲"的渲染，将"第N章"从摘要叙事句前缀中拆出，改为独立控制层标注（如 `[内部参照: 章9]`）与剧情内容分离；验证：渲染输出中章节编号不与摘要内容拼接在同一句
- [x] 2.2 同样处理"结构线/弧光"渲染中的章节区间锚点，确保区间信息不与剧情混写；验证：弧光渲染输出中区间标注独立于剧情描述
- [x] 2.3 在快照提示中明确告知 writer 章节锚点仅供内部参照，不得写入正文；验证：快照输出包含该说明
- [x] 2.4 对已有数据中 `timestamp` 含"第X章"格式的事件，在渲染供 writer 使用时过滤或以故事层时间替代；验证：含历史"第X章"数据时不将该值输出为故事时间

## 3. auditor 书籍坐标泄漏检查

- [x] 3.1 在 `packages/plugin/src/novel-writer/agents/auditor.ts` 提示词中新增"书籍坐标泄漏"检查维度，要求识别正文或对话中把控制层坐标当作叙事记忆/故事时间的情况；验证：审计提示词包含该维度描述
- [x] 3.2 在该维度中给出正反例（泄漏句式 vs 合法书中书/元小说场景），确保 auditor 不机械拦截所有"章"字用法；验证：提示词包含正反例说明
- [x] 3.3 可选：在 `novel-writer.ts` 的 `detectOutlineLabels` 或同等拦截层增加明确句式的正则补充信号，用于 LLM 检查的辅助证据；验证：正则拦截"记得在第N章"类句式且不误拦截合法场景

## 4. observer 时间线修正

- [x] 4.1 修改 `packages/plugin/src/novel-writer/agents/observer.ts` 中时间线提取示例，将 `timestamp` 示例从"第X章"改为故事层时间表达（如"三日后清晨"）；验证：提示词输出中不再有"第X章"作为 timestamp 示例
- [x] 4.2 在 observer 提示词中明确章节锚点通过 `relative_order` 或章节 ID 承载，不写入 `timestamp`；验证：提示词包含该字段约束说明

## 5. 回归防护与验证

- [x] 5.1 编写或更新测试覆盖典型泄漏句式："记得在第九章的时候""在第五章的时候发生了什么"；验证：测试在 packages/plugin 下通过
- [x] 5.2 编写或更新测试覆盖正例：使用"三日前""当夜"等故事层时间的输出不被拦截；验证：测试在 packages/plugin 下通过
- [x] 5.3 覆盖初次生成、驳回重写、修订三条路径的坐标隔离行为；验证：各路径测试通过
- [x] 5.4 覆盖历史数据兼容：数据库已有 `timestamp` 为"第X章"格式时渲染输出不包含该值；验证：测试在 packages/plugin 下通过
- [x] 5.5 在 packages/plugin 目录运行 `bun typecheck` 和 oxlint 确认通过；验证：命令退出码 0



## Implementation Commits

- a10bbdf99 feat(plugin): 隔离书籍控制层坐标与故事层正文
