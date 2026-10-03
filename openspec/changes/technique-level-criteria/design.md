# Design

## Context

见 proposal.md - Why。补充技术现状：`level` 枚举定义于 `packages/plugin/src/novel-writer/technique.ts`（TechniqueLevel），入库有两条路径——对话学习（director 指引 → `save_technique` 工具 → `saveTechnique` → `normalizeTechnique`）与离线提取（`highlightTechniques` → `distillTechniques` → `filterTechniques` → `normalizeTechnique`，入口 `cli.ts runTechniqueExtraction`）。三处提示词/指引各自为政，normalize 兜底 `paragraph`；高亮判定的 level 未传入蒸馏（technique-extract.ts 拼 prompt 时只带 来源/场景/标记原因）。

## Goals / Non-Goals

- 目标：新入库技法按统一判据产出多样且稳定的 level；存量技法可一次性纠偏；恢复层级召回与筛选的信息价值
- 设计级非目标：不解决 level 词表与 sceneTypes 词面重叠的taxonomy 治理（提案级非目标的具体化）；不实现应用内 UI 入口（CLI 命令即可，零干预）

## Decisions

- **D1 判据单一事实源放 `technique.ts`**：与 `CANONICAL_SCENE_TYPES` 同一模式，导出 `LEVEL_CRITERIA` 判据文本常量（5 值判定定义 + 与场景标签分工说明），director 指引、save_technique 描述、蒸馏提示词三处引用同一常量拼接。备选：各处手写判据——已被现状证伪（各自缩水是失效根因之一）。
- **D2 高亮 level 作参考信号传入蒸馏，而非删除高亮侧要求**：蒸馏输出仍是最终权威（一条技法可能融合多个段落标记）；删除会损失高亮侧 already-paid 的判定信号。备选：蒸馏完全自判——浪费已有信号且两段判定脱节。
- **D3 存量重分类做 CLI 维护命令（novel-writer cli 增加 relevel 类命令），不接升级框架**：level 列已存在，重分类是数据 UPDATE 不是结构迁移；升级框架（版本门禁/重建队列/横幅）为书籍库结构重建设计，接入是杀鸡用牛刀。零干预原则下不在写作流自动跑，用户手动执行一次即可；多机场景由既有整库同步传播。
- **D4 重分类幂等 + 非法值保留原值**：LLM 批判输出逐条校验枚举归属，非法/缺失保留原值并计数报告；重跑不产生新数据（UPDATE 同一列）。批大小按 token 预算切（每批 ≤10 条，instruction+evidence 截断），63 条存量预计 ≤10 次调用。
- **D5 normalize 缺省兜底保持 `paragraph` 不变**：schema/工具层已强制枚举，兜底仅兜 JS 直连等极端路径；不做 sceneTypes 启发式（引入第二套猜测标准，与判据单一事实源冲突）。

## Risks / Trade-offs

- LLM 判据执行仍有惰性偏向 paragraph → 判据写成"最小作用单元"决策树形式 + 蒸馏示例去锚定；任务验收以真实库重分类后的分布多样性为准（全量 paragraph 即验收失败）
- 重分类触碰 `updated_at` 会提升库内容时间，多机同步时与未同步编辑产生仲裁 → 可接受（等价于一次正常编辑，谁新谁赢）；重分类前可由用户自行同步一次降低交叉
- 重分类改变层级后，agent 按层级召回的行为面变化 → 层级召回本就该工作（规格已声明），属恢复设计而非新增风险

## Migration Plan

无结构迁移。实施顺序：先落判据与提示词（P0，新数据立即生效）→ 跑 CLI 重分类（P1，存量纠偏）→ 用户在面板抽查分布。回滚：重分类只改 level 列且幂等，可再次执行或按同步前的库文件备份还原（既有 `.bak` 惯例）。

## Open Questions

无。