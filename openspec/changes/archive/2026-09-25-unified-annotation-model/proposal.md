## Why

批注能力目前是两个孤岛：`chapter_annotations` + `annotation_execution_rounds`（正文）和 `world_entry_annotations` + `world_entry_annotation_rounds`（设定条目）——四张表两两同构，只是外键不同；配套的还有两套共 14 个 API 端点、两个面板组件、两套共 8 个 AI 批注工具。但创作工作台里"可修改的地方"远不止这两处：章纲、卷纲、总纲、角色、关系、剧情线、伏笔、风格指南、soul、技法说明都有编辑入口，也都会产生"这里不对、需要改"的批注诉求。按现有复制表的模式扩展，每加一个面就要加两张表、一套端点、一套工具、一套执行流，不可持续。

与此同时，`manual-edit-context-fidelity` 已经建立了手动编辑目录——登记所有正式写入路径的实体、字段、数据类别和 AI 感知策略。批注天然就是挂在编辑目录上的能力：批注 = 对某个目录项（实体 + 字段 + 可选文本区间）的一条待处理意见。`multi-paragraph-annotation` 已落地统一的区间锚点模型，本提案在其上把批注存储、契约、面板与工具统一为一个模型。

## What Changes

本提案只含 Phase A（统一底座，用户无感），不接入任何新批注面。

- 建立统一批注模型：单张多态批注表，目标为"编辑目录项 + 实体 ID + 字段"，文本目标携带区间锚点（`(paragraphIndex, startOffset)` → `(endParagraphIndex, endOffset)`，沿用 multi-paragraph-annotation 的区间模型）；执行轮次同样统一为单张多态轮次表，按目标归档。
- 建立批注目标注册表：服务端权威登记可批注的（实体, 字段）组合，词汇与手动编辑目录一致；目标存在性由服务端校验。Phase A 只注册 `chapter.content` 与 `world_entry.content`。
- 迁移既有数据：`chapter_annotations`、`world_entry_annotations` 及两张各自执行轮次表一次性迁入统一表；迁移幂等；旧表停止读写、保留一个版本周期后于后续版本 DROP。
- 统一 API：一套按目标判别的批注与执行轮次端点，替换既有 14 个端点；桌面端前后端同版本发布，旧端点直接下线，不留兼容期。
- 统一前端：单一批注面板组件按目标上下文实例化；数据访问层切到统一端点；正文与设定的批注交互、装饰、重叠拦截、执行流程行为完全不变。
- 统一 AI 工具：8 个批注工具收敛为 4 个目标参数化工具（创建 / 列表 / 标记状态 / 执行回填），director 提示词同步更新。
- 编辑目录条目收敛：批注相关目录条目（annotation / setting_annotation / execution_round / setting_annotation_round）合并为新统一端点的条目。

### 非目标

- 不接入任何新批注面：章纲、卷纲、总纲（Phase B）与角色、关系、风格指南等结构化目标（Phase C）均另立提案。
- 不删除旧表：本版本只停止读写，DROP 留给后续版本。
- 不改变批注审批/执行状态机、执行 prompt 的意图映射语义与 AI 执行质量本身。
- 不做锚点指纹级稳定性追踪（沿用既有钳制 + quote 兜底语义）。
- 不在本提案补齐总纲（`master_outline`）等其他写路径的编辑目录登记（Phase B 前置，随 Phase B 提案处理）。

## Capabilities

### New Capabilities

- `unified-annotation-model`: 多态批注目标模型与目标注册表、统一批注与执行轮次端点、既有批注与轮次数据迁移、按目标类型路由的执行通道。

### Modified Capabilities

- `reader-annotation-interaction`: 正文批注创建改走统一批注端点，用户交互行为不变。
- `setting-annotation-system`: 设定批注的所属关系改以统一目标引用持久化，执行回填改用统一批注工具，用户行为与执行约束不变。
- `setting-agent-tools`: 设定批注工具集合收敛到统一批注工具（按目标参数化），工具行为约束不变。

## Impact

- `packages/novel-store`：新增统一批注表与统一执行轮次表（drizzle 定义 + 建表 SQL + 索引）；四张旧表数据一次性迁移后停用保留；批注 CRUD 与轮次读写按目标判别。
- `packages/schema` / `packages/protocol`：统一批注契约（目标类型 + 目标 ID + 字段 + 可选区间锚点）与统一执行轮次契约；14 个旧端点下线；从 `packages/client` 运行 `bun run generate` 重新生成 SDK。
- `packages/server`：批注目标注册表（与手动编辑目录共享实体/字段词汇）；统一批注与轮次 handler（锚点校验复用既有段落区间校验）；编辑目录批注条目收敛。
- `packages/app`：数据访问层（novel-queries）切到统一端点；两个批注面板合并为单一面板组件；两个执行模块合并为按目标类型路由的统一执行模块。
- `packages/plugin`：`annotate_chapter` / `annotate_setting` / `list_annotations` / `list_setting_annotations` / `resolve_annotation` / `resolve_setting_annotation` / `report_annotation_execution` / `report_setting_annotation_execution` 收敛为 4 个目标参数化工具；director 提示词同步。
- `manual-edit-sync` 协作：批注本身是工作流数据不进同步队列；批注执行落库经过统一手动编辑事务层，派生数据同步沿用既有队列，不产生第二套同步语义。
- 依赖：`multi-paragraph-annotation` 的区间锚点模型（已归档落地），数据迁移只做一次。

## Phasing（后续拆分路线）

- **Phase A（本提案）**：统一表 + 数据迁移 + 统一端点 + 统一面板与工具，正文/设定两类目标切换，用户无感。
- **Phase B（另立提案）**：章纲、卷纲、总纲接入批注（纯文本面，复用区间锚点）。前置：评估三个大纲阅读器是否具备分段渲染与选区锚定条件；把总纲写路径补登进手动编辑目录。
- **Phase C（另立提案）**：角色、关系、剧情线、伏笔、风格指南、soul、技法的字段级批注（结构化目标，锚点全空，入口形态需 UX 决策）。
