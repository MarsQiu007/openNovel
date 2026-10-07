# Proposal

## Why

用户在 XianXia（自认为非成人的书）中把技法标记为"成人内容"后，该技法仍然在这本书的写作召回中出现。调查发现这是**设计语义与预期错位**：当前 `scope=adult` 的语义是"锁在产出它的书库内、其他书不可见"，宿主书自己永远可见——系统没有书级/章节级的内容性质概念。同时调查发现存量隐患：旧书库的 techniques 表缺少 `scope` 列（schema 迁移缺口），任何面板查询与召回检索都会触发 `no such column: scope` 硬错误，与"技法库故障不影响写作主流程"的规格相违背。

## What Changes

- **书级内容性质（contentNature）**：`.novel/config.json` 新增 `contentNature` 字段（`auto`/`adult`/`general`，默认 `auto`）。`auto` 下由 agent 懒加载判断一次（书名、简介、章纲、已有章节），结果缓存复用；书库内已存在 adult 技法时直接判为 adult（被动信号，跳过 LLM）。用户可手动覆盖，覆盖值优先于 agent 判断。
- **章节级内容性质判断**：召回组装上下文时，agent 判断当前章节的内容走向（成人/通用）。仅当本书库存在 adult 技法时启用该判断（纯通用书零额外开销）。
- **adult 技法双闸门过滤**：`scope=adult` 的技法候选 MUST 同时通过书级闸门（contentNature=adult）与章节级闸门（本章判定为成人）才进入候选列表；曝光位选取在闸门过滤后的池内执行；被闸门挡下的候选不进入候选即不写 shadow log。
- **文案澄清（A）**：技法面板"成人内容"标签的说明文案改为真实过滤语义（"仅成人书的成人章节召回"），并在工作台展示书级内容性质及人工覆盖入口。
- **存量 schema 迁移**：书库 techniques 表（及 shadow log 表）缺列时，访问前自动幂等补齐（`ALTER TABLE ADD COLUMN`），保留全部存量数据；不再因缺列报错。

## Capabilities

### New Capabilities

- `technique-content-nature`: 书级与章节级内容性质的判定、缓存、人工覆盖，以及 adult 技法候选的双闸门召回过滤规则。

### Modified Capabilities

- `technique-shared-library`: "召回双源合并"要求的 adult 召回语义改为双闸门条件（原语义"宿主书永远可见"收紧为"书级+章节级均判成人时才可见"）。
- `technique-shadow-loop`: "按场景检索技法候选"与"未验证新品保留曝光位"要求增加内容性质闸门约束（曝光位在闸门后的池内选取）。
- `technique-library`: 新增旧版本技法表自动迁移要求（缺列幂等补齐），落实"技法库故障不影响写作主流程"的兼容性承诺。
- `technique-ui`: "成人内容"标签语义澄清 + 书级内容性质展示与人工覆盖入口。

## Impact

- `packages/novel-store`：书库/全局库 techniques 表与 shadow log 表的缺列自动迁移（`getDb` 建连路径）；`contentNature` config 读写（复用技法注入开关的 `.novel/config.json` 先例）。
- `packages/plugin`：召回链路（`queryTechniques` 及曝光位）增加闸门过滤参数；上下文组装处接入章节级内容性质判断；书级判断的 agent 流程（懒加载 + 被动信号短路）。
- `packages/app`：技法面板文案澄清；书级内容性质徽标与覆盖控件（工作台设置区）。
- `packages/opennovel`/`packages/server`：如书级性质走 HTTP 契约则需增量端点（或复用 config 文件直读，设计阶段定）；协议变更需 `bun run generate`。
- 兼容性：无数据迁移风险——迁移幂等且只加列不改数据；现有书默认 `auto`，行为变化仅为 adult 技法在通用书/通用章节不再出现（这正是本变更目的）；全局通用库召回语义不变。
