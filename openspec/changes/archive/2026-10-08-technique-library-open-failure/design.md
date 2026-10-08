# Design

## Context

书内技法库面板打开必现"操作失败"。调查实证（真实数据复现）：

- 全局库 16/16 条、`audits` 书库 57/61 条 `last_used_at = NULL`；store 的 `toTechnique` 产出 `lastUsedAt: undefined`（显式 key）。
- effect 4.0.0-beta.83 的 `optional(Schema.Int)`：key 缺失可过、显式 undefined 报 `Expected number, got undefined`（最小用例实证：absent OK / undefined FAIL / null FAIL）。
- 6 条全局技法证据只有 `{sourceLocation, excerpt, annotation}`，缺必填 `sourceTitle`（`save_technique` 直写 DB 绕过协议校验所致）。
- 结果：`technique.list` 响应无法编码 → 面板 query 失败。`toTechnique` 服务于 list/detail/create/update 四个出口（novel-store `index.ts`），一处修复全覆盖。

## Goals / Non-Goals

Goals:
- 面板打开即可用：所有"从未使用"的技法可正常列出与查看详情。
- 存量脏数据被自动修复，新增脏数据被入库校验挡住。
- 单行坏数据不再拖垮整个列表（防御纵深）。

Non-Goals:
- 不改 `Technique`/`TechniqueEvidence` 协议契约（`lastUsedAt` 维持 optional 语义；四字段维持必填）。
- 不处理 `scene_types`/`evidence` JSON 整体损坏（文件级损坏应让错误显式暴露，静默吞掉反而难排查）。
- 不改面板 UI 结构（接口恢复后现有渲染路径自然可用）。

## Decisions

### D1: `lastUsedAt` 修复收口在 store 的 `toTechnique`

`last_used_at != null` 时才展开 `lastUsedAt` key（条件展开），NULL 行输出对象不含该 key，`optional` 语义下解码通过。不采用 schema 放宽（`nullable`/`union undefined`）：契约本就表达"可缺省"，是数据层违反了契约的表达方式。

### D2: 存量回填做成幂等迁移，双库统一执行

migrate.ts 新增 `migrateTechniqueEvidence`：逐行解析 evidence JSON，元素为对象时补缺失（含 `null`/非字符串值）的字符串字段（`sourceTitle` 优先取该元素 `sourceLocation`，其余补空串），仅当有字段实际写入时才 UPDATE 该行；注册进 `runMigrations`（书库与全局库建连时都会跑到）。幂等：重复建连全为 no-op；不回写已有非空值。

对比方案：读出时惰性修复会让读路径带写副作用（且双源合并处难以归属）；独立维护命令会留下"忘了跑"的窗口。迁移方案零操作成本、随建连自愈。

### D3: 入库校验统一在 novel-store 暴露规范化函数，plugin 接入

novel-store 已依赖 `@opennovel-ai/schema`，新增导出 `normalizeTechniqueEvidence(evidence)`：先按 D2 规则补全，再用 `TechniqueEvidence` schema 逐条校验，返回 `{ ok: true, evidence } | { ok: false, reason }`。plugin 的 `saveTechnique` 在过滤/规范化之后、写库之前调用：ok 则写入补全后的证据，不 ok 则拒绝并在返回中说明原因。

对比方案：plugin 直接依赖 schema 包做校验——可行但把契约知识扩散到工具层；经 store 收口与回填迁移共用同一份规则（补全策略单一事实源）。

### D4: 列表容错放在 server handler（协议边界）

`listTechniquesForDirectory` 返回前（单库与 `all` 双源合并两个分支）逐条 `Schema.decodeUnknownEither(Technique)`；失败行跳过并 `Effect.logWarning`（含技法 id 与失败原因首行）。detail 路径维持严格：D2 修复存量 + D3 挡住新增后，单条坏数据不应再出现；若仍出现，显式报错比伪装 404 更利于排查。

对比方案：容错下沉到 store 层——store 已依赖 schema，可行；但"什么是合法响应行"是协议形状的知识，且 store 返回类型会被容错逻辑污染（过滤 vs 报错），故放 handler。

### D5: 测试矩阵

- novel-store：`toTechnique` 对 `last_used_at NULL` 行输出不含显式 undefined（list 与 detail 两路径）；`migrateTechniqueEvidence` 修复坏行、重复运行为 no-op；`normalizeTechniqueEvidence` 补全与拒绝两路。
- plugin：`saveTechnique` 对缺 `sourceTitle` 的证据补全入库；对不可修复证据拒绝且不写库。
- server：`listTechniquesForDirectory` 单库与 `all` 两分支混合好坏行时均返回好行并跳过坏行（不抛错）。

## Risks / Trade-offs

- [回填迁移改写存量行] → 只补缺失字段、不改已有非空值；迁移有测试覆盖幂等性。
- [列表容错可能掩盖未来新类型的脏数据] → WARN 日志含技法 id 与原因，面板表现正常但日志可查；配合 D3 的新增把关，脏数据源头被掐断。
- [显式 undefined 陷阱可能在其他 toXxx 映射复发] → 本次已排查 novel-store 全 src：仅 `toTechnique` 的 `lastUsedAt` 一处 `?? undefined`，无其他命中；后续新增映射需自审同类陷阱。

## Migration Plan

随服务下次建连自动完成（迁移幂等）；无需用户操作。修复后用户重新打开技法库面板即恢复正常。