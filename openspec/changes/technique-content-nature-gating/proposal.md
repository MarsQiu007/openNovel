# Proposal

## Why

用户在 XianXia（自认为非成人的书）中把技法标记为"成人内容"后，该技法仍然在这本书的写作召回中出现。调查发现这是**设计语义与预期错位**：当前 `scope=adult` 的语义是"锁在产出它的书库内、其他书不可见"，宿主书自己永远可见——系统没有书级/章节级的内容性质概念，无法在"宿主书内部的通用章节"层面隐藏成人技法。

## What Changes

- **书级内容性质（contentNature）**：`.novel/config.json` 新增 `contentNatureOverride` 字段（`adult`/`general`/缺省=自动）。自动模式采用**被动信号**确定性判定：书库内已存在 `scope=adult` 技法则判为 adult，否则判为 general——纯 DB 查询，零 LLM 调用、零后台任务，且随书库技法变化即时反映。用户可手动覆盖，覆盖值立即生效并优先于被动信号。
- **章节级内容性质判断**：`assemble_context_snapshot` 工具新增可选参数 `content_nature`，由调用方 agent（pipeline/writer/outliner，均为 LLM agent）依据书籍上下文（简介、章纲、本章意图）在既有回合内判断本章走向；未传或非法值按非成人处理（从紧）。仅当本书库存在 adult 技法时该参数才影响候选，纯通用书零开销。
- **adult 技法双闸门过滤**：`scope=adult` 的技法候选 MUST 同时通过书级闸门（书级内容性质为 adult）与章节级闸门（本章判定为成人）才进入候选列表；曝光位选取在闸门过滤后的池内执行；被闸门挡下的候选不进入候选即不写 shadow log。
- **文案澄清（A）**：技法面板"成人内容"标签的说明文案改为真实过滤语义（"仅成人书的成人章节召回"），并在工作台展示书级内容性质及人工覆盖入口。

## Capabilities

### New Capabilities

- `technique-content-nature`: 书级内容性质的被动信号判定、人工覆盖，以及 adult 技法候选的双闸门召回过滤规则。

### Modified Capabilities

- `technique-shared-library`: "召回双源合并"要求的 adult 召回语义改为双闸门条件（原语义"宿主书永远可见"收紧为"书级+章节级均判成人时才可见"）。
- `technique-shadow-loop`: "按场景检索技法候选"与"未验证新品保留曝光位"要求增加内容性质闸门约束（曝光位在闸门后的池内选取）。
- `technique-ui`: "成人内容"标签语义澄清 + 书级内容性质展示与人工覆盖入口。

## Impact

- `packages/novel-store`：`contentNatureOverride` config 读写（复用技法注入开关的 `.novel/config.json` 先例）；新增"书库是否含 adult 技法"查询 helper（书级 effective nature 计算用）。
- `packages/plugin`：召回链路（`queryTechniques` 及曝光位，位于 plugin 的 `technique-store.ts`）增加闸门过滤参数；`assemble_context_snapshot` 新增可选 `content_nature` 参数；pipeline/writer/outliner 的 system prompt 增加章节内容性质判断指引。
- `packages/app`：技法面板文案澄清；书级内容性质徽标与覆盖控件（技法面板头部，与注入开关同区）。
- `packages/server`/`packages/client`：`technique.config` 响应扩展（effective nature）、`technique.set-config` 请求扩展（可选 contentNatureOverride）；协议变更需 `bun run generate`。
- 兼容性：现有书默认自动模式，行为变化仅为 adult 技法在通用书/通用章节不再出现（这正是本变更目的）；全局通用库召回语义不变；工具新参数为可选，旧调用方不传即从紧缺省，不影响既有流程。
