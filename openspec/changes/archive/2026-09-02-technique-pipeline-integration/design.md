# Design: technique-pipeline-integration

## Context

技法功能代码基建已存在(类型、SQLite 三表、提取管线、预算/格式化工具、反馈工具、置信度状态机),今天已修复两处断点(`assemble_context_snapshot` 输出序列化遗漏 `techniques`、提取结果不入库)。遗留的架构约束:

- writer 的 prompt 由 pipeline agent(子 agent 编排层)拼装,插件侧没有直接改写 writer prompt 的入口;快照字段传递给 writer 靠 pipeline 的 prompt 约定("必须原样传递上一章结尾原文/目标字数"已是既有先例)
- 项目配置有两处:`opennovel.json`(敏感白名单,含 model/provider)与 `.novel/config.json`(项目级白名单 `NOVEL_CONFIG_FIELDS`,带 FieldSpec 校验)
- 计划文档 `docs/superpowers/plans/2026-08-21-technique-library.md` 明确注入需 shadow 验证在前,本 change 以开关方式补上"开启机制",开启时机由用户掌握

## Goals / Non-Goals

**Goals:**

- 全链路审计(extract → 入库 → 召回 → 快照可见 → 反馈 → 状态机)并修复残余断点
- 项目级注入开关,默认 shadow;开启后技法经预算裁剪进入 writer prompt
- 注入与 shadow log、usage 统计并存,保留验证数据
- 端到端可测

**Non-Goals:**

- embedding 语义检索(V2)
- 技法管理 Web UI
- 自动根据 shadow 数据结论开启注入(仍需人工决定)
- 跨项目技法共享/同步

## Decisions

### D1: 开关放 `.novel/config.json`,字段名 `technique_injection`

- 走现有 `NOVEL_CONFIG_FIELDS` 白名单 + FieldSpec 校验(boolean),新增类型化读取助手,非法值回退 false
- 备选:`opennovel.json`(敏感配置层,混入业务开关不合适)、环境变量(项目粒度不对)。拒绝理由如括号内。
- 默认 false,仅在 `true === value` 时开启,避免字符串 "false" 误开

### D2: 注入通过快照透传,而非直接改写 writer prompt

插件无法直接写 writer prompt(见 Context),因此开关开启时 `assemble_context_snapshot` 的输出将 shadow 候选段替换为"写作技法指导"段落(复用 `formatTechniquesForPrompt`,经 `applyP7Budget` 裁剪),段落语义标注从"严禁注入 writer prompt"切换为"必须原样传递给 writer"(与"上一章结尾原文"同一传递机制)。

- 备选:给 writer 子 agent 新增独立取技法工具——writer 工具集受限,且多一次工具往返;拒绝。
- 风险是 LLM 可能不透传,见 Risks。

### D3: 注入候选做置信度门槛(≥ 0.6),shadow 段落保持不过滤

开启注入后,低置信度技法直接影响正文的风险大于收益;门槛过滤后的候选取 top-5,再按 1000 token 预算裁剪。shadow 段落继续展示全部候选,保证反馈闭环仍能覆盖低置信度技法。

### D4: usage 统计在注入时落库

`techniques` 表已有 `usage_count`/`last_used_at` 字段但无更新入口;在技法库存储层新增使用计数递增操作,注入发生时对每个实际注入的技法调用。异步尽力而为,失败不阻断写作。

### D5: 审计以 tasks 清单驱动,逐项带验证

审计项(非猜测性结论)进 tasks,每项含"验证方式"。已知待审计点:

- `inferSceneType` 正则推断与 shadow log 实际场景分布的偏差(只审计记录,不在本 change 改算法)
- pipeline/auditor prompt 指令与工具输出格式(候选 id/名称/指令字段)的对齐
- `seed-techniques` 与 `extract-techniques --import` 的目录解析一致性(相对路径/cwd)
- 反馈闭环空转的回归防护:新增"候选非空 → 工具输出含候选"的测试,防序列化遗漏复发

## Risks / Trade-offs

- [LLM 不透传注入段落] → 段落措辞复用既有"必须原样传递"约定;shadow log 与 usage 统计提供对照(usage 增长但章节质量/字数异常时可快速回关)
- [低置信度技法误导正文] → D3 的 0.6 门槛;门槛值后续可配置,先硬编码
- [开关误开(字符串 "false" 被真值判断)] → D1 的严格 `=== true` 解析
- [注入增加 writer prompt 长度挤占上下文] → 1000 token 预算是硬上限,约为快照总量的可忽略比例
- [审计扩大范围] → 审计项只记录与修复,不重设计;超出项回填计划文档而非本 change

## Migration Plan

无数据迁移(三表结构不变,usage 字段已存在)。部署顺序:代码合入即可;用户按需在项目 `.novel/config.json` 加 `"technique_injection": true` 开启。回滚:将开关置回 false 即回到纯 shadow。

## Open Questions

(无——门槛值 0.6、开关字段名等均已定为可后续调整的实现常量,不影响 spec 行为)
