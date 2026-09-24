## Why

批注能力目前是两个孤岛：`chapter_annotations`（正文）和 `world_entry_annotations`（设定条目）——两张表结构完全相同，只是外键不同。但创作工作台里"可修改的地方"远不止这两处：章纲、卷纲、总纲、角色、关系、剧情线、伏笔、风格指南、soul、技法说明都有编辑入口，也都会产生"这里不对、需要改"的批注诉求。按现有复制表的模式扩展，每加一个面就要加一张表、一套端点、一套执行流，不可持续。

与此同时，`manual-edit-context-fidelity` 已经建立了手动编辑目录——登记所有正式写入路径的实体、字段、数据类别和 AI 感知策略。批注天然就是挂在编辑目录上的能力：批注 = 对某个目录项（实体 + 字段 + 可选文本区间）的一条待处理意见。

## What Changes

- 建立统一批注模型：单张多态批注表，目标为"编辑目录项 + 实体 ID + 字段"，文本类目标携带区间锚点（`(paragraphIndex, startOffset)` → `(endParagraphIndex, endOffset)`，沿用 multi-paragraph-annotation 的区间模型），结构化目标仅字段级引用。
- 迁移既有 `chapter_annotations` 与 `world_entry_annotations` 数据到统一表，对外 API 统一为按目标类型判别的一套端点。
- 统一批注面板组件：按目标上下文渲染，阅读器/编辑器各处复用同一套选区创建、装饰与重叠检测。
- 批注执行按目标类型路由：正文类走既有章节修订流程，设定类走设定影响面，所有落库经过统一手动编辑事务层，执行结果可追溯。
- 第一批扩展目标：章纲、卷纲、总纲（纯文本面，直接复用区间锚点与 quote）。

### 非目标

- 不在本提案纳入空间型目标（世界地图要素、关系图边）——锚点模型不同，后续单独评估。
- 不改变批注审批/执行状态机与 AI 执行质量本身。
- 不做锚点指纹级稳定性追踪（沿用既有钳制 + quote 兜底语义）。

## Capabilities

### New Capabilities

- `unified-annotation-model`: 多态批注目标模型、统一批注端点、统一面板组件、按目标类型路由的执行通道，以及既有批注数据迁移。

### Modified Capabilities

- `reader-annotation-interaction`: 正文批注的创建与装饰迁移到统一模型，用户行为不变。
- `setting-annotation-system`: 设定批注迁移到统一模型，用户行为不变。
- `annotation-execute-flow`: 执行通道按目标类型路由，正文与设定之外的文本目标（章纲、卷纲、总纲）纳入可执行范围。

## Impact

- `packages/novel-store`：新增统一批注表与迁移（既有两表数据迁入后退役）；批注 CRUD 按目标判别。
- `packages/schema` / `packages/protocol`：统一批注契约（目标类型 + 目标 ID + 字段 + 可选区间锚点）；从 `packages/client` 重新生成 SDK。
- `packages/server`：统一批注端点替换两套既有端点（保留旧端点兼容期或直接切换，由 design 定）。
- `packages/app`：统一批注面板与选区/装饰/重叠检测复用层；章纲、卷纲、总纲阅读器接入批注创建与展示。
- `packages/plugin`：`annotate_chapter` / `annotate_setting` 收敛为统一批注工具（按目标类型参数化）；执行流程按目标类型路由到修订或设定影响面。
- `manual-edit-sync` 协作：批注执行落库经过统一手动编辑事务层，派生数据同步状态沿用既有队列。
- 依赖：`multi-paragraph-annotation` 的区间锚点模型应先落地，本提案在其上构建，数据迁移只做一次。

## Phasing（实施拆分建议）

- **Phase A**：统一表 + 数据迁移 + 统一端点 + 正文/设定两类目标切换（用户无感）。
- **Phase B**：章纲、卷纲、总纲接入批注（纯文本面，复用区间锚点）。
- **Phase C（可另立提案）**：角色、关系、剧情线、伏笔、风格指南、soul、技法的字段级批注。
