# Proposal: technique-pipeline-integration

## Why

写作技法功能(Technique V1)当前处于 shadow mode,且链路存在多处断点:今天已修复两处(快照序列化遗漏 `techniques` 字段、提取结果不入库),但整条"学习 → 入库 → 召回 → 反馈 → 注入"链路尚未系统化验证过,且技法最终生效的最后一环——按场景注入 writer prompt——按计划文档(`docs/superpowers/plans/2026-08-21-technique-library.md`)设计为"shadow 数据验证后开启",目前没有任何开启机制。需要一次完整的链路审计把残余断点修干净,并以 feature flag 的方式补上注入开关,使技法能力可以在流水线中被 agent 工具自动、安全地使用。

## What Changes

- **链路完整性审计与修复**:对 extract → 入库 → 召回 → 快照可见 → auditor 反馈 → 置信度状态机 → (可选)注入 全链路做一次系统化审计,发现的断点(如:提取 CLI 不带 `--import` 时 JSON 与库脱节、auditor 反馈依赖 LLM 自觉传递 `retrieved_techniques`、场景类型正则推断的准确性等)逐项修复并纳入 tasks
- **注入开关(feature flag)**:在小说项目配置中新增技法注入开关(默认关闭,保持 shadow mode)。开启后,`assemble_context_snapshot` 产出的技法候选经 `applyP7Budget`(1000 token 预算)+ `formatTechniquesForPrompt` 格式化后注入 writer prompt,并同步记录 shadow log 与 usage 统计
- **流水线自动化接线**:pipeline agent 的 prompt 指令与工具输出对齐——shadow 报告步骤、`retrieved_techniques` 传递给 auditor 的映射、auditor 调用 `record_technique_feedback` 的闭环,从"仅靠 LLM 遵守 prompt 指示"增强为"数据层保证可见 + prompt 明确指令"双重保障
- **验证配套**:提供端到端测试覆盖"导入技法 → 组装快照可见 → 注入开启后出现在 writer prompt → auditor 反馈驱动置信度演进"的完整场景

## Capabilities

### New Capabilities

- `technique-library`:技法库管理——LLM 提取与人工种子两条入库路径(extracted 保持 unverified/0.5,seed 为 verified/0.8)、SQLite 本地存储、CLI 命令(`extract-techniques --import`、`seed-techniques`)、unverified → verified 生命周期
- `technique-shadow-loop`:shadow 检索闭环——按场景类型检索 top-N、写入 shadow log、快照工具输出携带技法候选(id/name/instruction)、auditor 反馈(`record_technique_feedback`)驱动贝叶斯置信度状态机
- `technique-injection`:开关门控的 prompt 注入——项目级开关默认关闭;开启后按 P7 token 预算裁剪并以"写作技法指导"段落注入 writer prompt,同时保持 shadow log 与 usage 统计;关闭时回退纯 shadow

### Modified Capabilities

(无——项目尚无主 specs,以上均为新增)

## Impact

- `packages/plugin/src/novel-writer.ts`:assemble_context_snapshot 工具(序列化、注入分支)、writer prompt 组装链路、record_technique_feedback 工具
- `packages/plugin/src/novel-writer/technique-*.ts`:inject(预算/格式化)、store(查询、状态机)、cli(导入)、normalize(生命周期)
- `packages/plugin/src/novel-writer/agents/pipeline.ts`、`auditor.ts`:prompt 指令与注入开关联动
- `packages/plugin/src/novel-writer/project-config`(或等价配置读取处):新增注入开关的读取与校验
- `packages/opennovel/src/cli/cmd/novel.ts`:extract-techniques 命令选项
- `packages/novel-store`:techniques 表 usage 统计字段(已有,需确认启用)
- 测试:`packages/plugin/test/novel-writer/technique-*.test.ts`、端到端场景测试
