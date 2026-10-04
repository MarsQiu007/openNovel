# Proposal

## Why

技法库服务于两种性质完全不同的写作——通用小说与成人小说——但系统目前**没有任何维度区分内容性质**，且通用技法**无法跨书复用**：

- **无性质维度**：`techniques` 表无 scope 字段；对话学习流程的 agent 提示词只要求"适用场景(scene_types)"，不要求判断内容性质。实测《金牌》（C:\Novels\audits）63 条已入库技法全部为成人技法，与通用技法混在同一书库无标记。
- **通用技法被囚禁**：技法物理上随书存储（每本书的 `.novel/novel.db`），从《金牌》学到的通用技法（如"开篇冲突倒叙法"）锁在该书库内，写新书时无法复用；每开一本新书都要从零学起。
- **复用与隔离必须同时成立**：通用技法应跨书共享；成人技法必须只在产出它的书里可用，绝不能进入通用书的召回——两个方向都要由系统保证，不能靠用户把关。

**设计原则：零干预**。用户不应需要设置开关、判断分类、迁移数据；唯一的判断者是学习时的 agent（证据原文就在其上下文里，判断依据充分），且只判断一次、写入即定。

## What Changes

- **技法增加内容性质维度**：`techniques` 表新增 `scope` 列（`general` | `adult`，默认 `general`），幂等迁移注册到 novel-store `runMigrations`（仿 `migrateCharacterStatus` 模式）。
- **新建全局通用技法库**：专用数据库文件 `Global.Path.data/techniques.db`（novel-store 自解析路径、单一属主），存放跨书共享的通用技法；不与 core 管理的 opennovel.db 共用文件——core 的存储路径按安装渠道分流（`opennovel-<channel>.db`），共用会导致不同渠道学到的技法互相不可见，且避免与 core 的多连接共管同一文件。
- **学习路由（唯一判断点）**：对话学习流程 agent 逐候选判断 scope——对话节奏、悬念铺设这类通用写法标 `general`，成人内容技法标 `adult`，**拿不准一律 `adult`（宁紧勿松：错标 adult 只是少复用，错标 general 有泄漏风险）**；`save_technique` 工具新增 **必填** `scope` 参数（agent 必须显式判断，无缺省值）；`general` 写入全局库，`adult` 写入本书库。
- **召回双源合并**：`queryTechniques` 召回 = 本书库全部 + 全局库，统一按场景匹配（含 technique-scene-recall 的空交集回退）与置信度排序，`unverified` 曝光位跨两池取最近 2 条；`search_techniques`/`confirm_techniques`/`record_technique_feedback` 同步跨库（反馈记录带来源库标记，置信度状态机操作对应库，全局技法反馈跨书积累）。
- **种子导入默认入全局库**：`seed-techniques` 默认写入全局通用库（一次导入全库受益），`--local` 选项保留写入本书的旧行为。
- **存量数据标注**：实施时对《金牌》63 条做一次 agent 批量判定标注 `scope=adult`（留本书库，内容一望可知）；其他书库 0 条无需处理。
- **面板展示**：技法列表合并双源并显示来源徽标（通用库/本书）；技法编辑支持 scope（修改触发跨库迁移）；创建表单支持归属选择。
- **协议扩展**：`LocationQuery` 增加可选 `library` 枚举字段（`book` | `global` | `all`，缺省 `book` 兼容现状；作为 location 的兄弟字段而非子字段），client SDK 重新生成。

## Capabilities

### New Capabilities

- `technique-shared-library`：全局通用技法库——跨书共享存储、学习路由规则、双源召回合并、跨库反馈归集。

### Modified Capabilities

- `technique-library`：技法新增 `scope` 内容性质维度；学习时 agent 逐候选判断（宁紧勿松）；种子默认入全局库。
- `technique-ui`：列表展示来源徽标；编辑支持 scope 与归属。

## Non-Goals（非目标）

- **不引入书级内容开关或书性质自动判断**——书库天然隔离 + 全局库只住 general，两方向安全由构造保证，无需任何设置项（零干预原则的核心）。
- 不做成人向专门场景词表；成人技法沿用既有 7 值场景词表 + general 回退。
- 不做技法跨书移动/复制的 UI（后续如需再做）。
- 不改变置信度状态机规则（≥0.75 且反馈 ≥5 转 verified）；不改变 auditor 反馈流程。
- 不引入 embedding 语义检索；不改变 CLI `extract-techniques` 行为。
- **CLI `import-extracted`（提取 JSON 导入）路径不接学习路由**——该路径无人/agent 判断环节，导入技法一律落本书库、`scope` 默认 `general`；成人内容书经此导入的技法留在本书库不泄漏，性质有误可面板修改（与种子路径区分：种子有人工精选语义，默认全局）。
- 不改动 `technique-chat-learn` 变更工件（其 delta 尚未同步主 specs；本变更的 director 提示词修改与其互补，实施时合并处理）。

## Impact

- `packages/plugin`：主影响面——`technique.ts`（TechniqueEntry 加 scope、RetrievedTechnique 加 library 标记）、`technique-store.ts`（双源 CRUD/检索/反馈跨库）、`technique-learn.ts`（save/search/confirm 跨库）、`cli.ts`（种子默认全局 + `--local`）、`agents/director.ts`（学习提示词判断规则）、`agents/auditor.ts`（反馈目标跨库说明）、`context.ts`（快照检索双源，确认候选段格式）。
- `packages/novel-store`：techniques/technique_feedback 加 `scope` 列 + 幂等迁移；全局库建表（独立 techniques.db，自解析路径 + 测试 env 覆盖）；双源 CRUD/反馈 API。
- `packages/schema`：`Technique`/`CreateTechniqueInput`/`UpdateTechniqueInput` 契约增加 `scope` 字段（UI 与协议共用）。
- `packages/protocol` + `packages/client`：`LocationQuery` 增加 `library` 字段 → 需 `bun run generate` 再生成 SDK。
- `packages/server`：technique 处理器双源化（列表/详情/创建/更新/删除按 library 路由；更新 scope 触发跨库迁移）。
- `packages/app`：面板合并列表 + 来源徽标 + scope/归属编辑。
- 数据兼容：`scope` 列默认 `general`，旧行零迁移可读；全局库新文件不影响任何既有数据。
- 依赖顺序：本变更实施应在 `technique-scene-recall`（场景词表修复）之后，复用其 normalize/检索改动。