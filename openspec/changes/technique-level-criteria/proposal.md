# Proposal

## Why

技法库的 `level`（作用层级）维度已整体失效：本书库 57 条 + 全局库 6 条技法的 level 全部为 `paragraph`（实地查询 63/63）。根因是入库链路五处漏斗叠加——学习流程提示词只列字段名不给判据、`save_technique` 工具描述仅"技法粒度"四字、蒸馏提示词示例写死 `"level": "paragraph"`、高亮阶段的层级判定在蒸馏时被丢弃、normalize 兜底恒为 `paragraph`。这让 technique-injection 规格中"agent MAY 按层级发起多轮召回"的设计意图落空，面板层级筛选器形同虚设。

## What Changes

- 制定统一的层级判据（5 个枚举值各一句操作定义 + 与场景标签的分工说明），以单一事实源形式维护
- 学习流程提示词（director.ts）与 `save_technique` 工具 schema 描述接入判据（仿现有 scope 的判据+判例写法）
- 提取管线蒸馏提示词去除 `"level": "paragraph"` 锚定示例，附同一判据；高亮阶段判定的层级作为参考信号传入蒸馏 prompt
- 新增存量重分类维护命令：双源（本书库 + 全局库）扫描既有技法，按同一判据批量重判 level 并原地更新，幂等可重跑
- 非目标：
  - 不改 level 词表枚举值（dialogue/description/transition 与场景标签的词面重叠问题留待观察本变更效果后另行治理）
  - 不动面板 UI（词表不变，现有渲染与筛选直接生效）
  - 不在写作流程内自动触发重分类（零干预原则，命令手动执行）
  - 不重判 sceneTypes / scope / 其他任何字段，只动 level
  - 不引入升级框架或版本门禁（level 列已存在，重分类是数据 UPDATE 而非结构迁移）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `technique-library`: 新增"层级判据统一入库"与"存量层级重分类维护命令"两条需求——入库侧必须按统一判据产出 level 且提示词不得锚定单一值；维护侧提供双源幂等的重分类命令。

## Impact

- **packages/opennovel**：`src/cli/cmd/novel.ts` 注册 `relevel-techniques` 命令（仿 extract-techniques 的 Provider 取模型模式）
- **packages/plugin**：`technique.ts`（判据单一事实源）、`agents/director.ts`（学习流程指引）、`novel-writer.ts`（save_technique/search 工具描述）、`technique-extract.ts`（蒸馏/高亮提示词与信号传递）、`technique-store.ts`（level 更新接口）、`cli.ts`（重分类命令）
- **数据兼容**：仅 UPDATE 既有 `techniques` 表的 `level` 列（列已存在、默认值不变）；触碰 `updated_at` 使整库同步按内容时间正常传播，无版本协调问题；重分类幂等，中途失败保留原值
- **AI 成本**：存量重分类为一次性批任务（当前 63 条，每批多条预计 ≤10 次 LLM 调用）
- 其他包（schema/protocol/server/app/desktop）无改动：level 词表不变，契约与界面渲染不用改