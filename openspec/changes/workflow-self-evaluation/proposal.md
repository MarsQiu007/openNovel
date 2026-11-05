# Proposal

## Why

openNovel 的创作能力管线（agent 编排、提示词契约、设定召回、上下文拼接、技法注入）目前没有任何反馈回路：开发者不知道哪个工具在真实使用中失败、哪条 prompt 约束被突破、哪路召回了空气、哪级上下文预算在挤占有效内容；作者也不知道自己的创作流程哪里在空转。所有原料（会话事件流、37 维审计、模式审计、P0-P7 预算、三路召回）都已存在且本地持久化，缺的只是汇总分析与建议产出。

## What Changes

- 新增**自评价能力**：指标滚动层（会话事件惰性计数 + 创作管线判定点埋点）持续积累项目级指标桶；报告生成器按需产出三分部报告——A 创作复盘（给作者）、B 配置优化（给作者，v1 纯文本建议）、C 产品信号（给开发者，失败分类法与复现要点）。
- v1 覆盖七个信号域：C1 运行时健康、C2 提示词控制、C3 设定召回、C4 上下文拼接、C5 创作流程、C6 技法系统、C7 叙事质量（钩子轮换/弧光节奏/结构风险/连续性维度失败分布）。
- 触发：手动 slash 命令 + 自动策略（卷完结 / 会话压缩完成 / 反复修改滚动窗 / 周期兜底，带 24h 冷却与同类信号去重）。
- 诊断包导出分级（L0 纯计数 / L1 +错误分类样本 / L2 +复现序列，默认 L1），用户自愿随反馈分享；genre 题材值永不进 L0/L1。
- v1 报告为确定性规则模板，不使用 LLM 生成。

## 非目标

- 不做匿名遥测上传或任何自动外发数据管道（开发者信号经用户自愿分享的诊断包回传）。
- 不做配置一键应用（B 层建议 v1 纯文本，不带 draft+确认的应用形态）。
- 不评价作品文学质量（区别于 technique-learn 的内容侧学习）。
- v1 不覆盖 C8 设定演化 / C9 意图与调度 / C10 灵魂与体裁（低频或需设计发酵，列入 v1.1 波次）。

## Capabilities

### New Capabilities
- `workflow-self-evaluation`: 创作流程自评价——指标滚动积累、三分部报告生成（创作复盘/配置优化/产品信号）、自动与手动触发策略、诊断包导出分级与隐私边界。

### Modified Capabilities
（无——本变更为新增能力，不改变既有 spec 级行为）

## Impact

- `packages/plugin`：novel-writer 插件新增 evaluate 模块（指标桶、触发器、报告生成器、诊断包导出、slash 命令注册）；既有判定点（recall/budget/drift-guards/scene-constraints/approval-gate/technique-inject/hook-rotation/arc-progress/structure/continuity-check 等）旁加计数埋点，不改判定逻辑。
- `packages/core`：只读消费会话事件与压缩事件，不改 core。
- 数据：项目本地新增 `.novel/evaluate/`（指标桶 + 报告 + 诊断包），append-only JSONL，沿用 mode.jsonl 的 best-effort 落盘纪律；无 novel.db schema 变更。
- 隐私：诊断包分级导出，默认不含正文与题材值。
- 兼容性：纯增量，不影响任何既有功能路径；埋点失败只 warn 不阻断写作。
