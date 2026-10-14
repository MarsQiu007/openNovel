# Design

## 背景与根因

写作流水线 P7 召回（`assembleSnapshot` → `queryTechniques`）以 `inferSceneType(章节标题, 梗概)` 的输出作为场景查询条件。该启发式对无关键词命中的书籍回退 `general`；而对话学习入库的技法按学习指引（"不确定或跨场景用 general"之外的常见情况）全部打了具体场景标签，库内无一含 `general`。`matchesQuery` 要求标签集合包含查询场景，于是 `general` 查询与全部条目零交集，候选恒为 0：不写 shadow 日志、auditor 跳过技法评估、反馈闭环空转、无任何条目积累到 `verified`。

叠加的第二个问题：`queryTechniques` 在 SQL 层先 `ORDER BY confidence DESC LIMIT n` 再内存过滤场景。全部条目同置信度（0.5）时前 N 条是任意序，即使场景匹配也可能被截断，匹配项名额被不匹配项吃掉。

第三个问题：`searchTechniques` 空结果统一返回"技法库无匹配条目"，agent 以 `status=verified` 检索无果后将其误读为"技法库为空"并误报用户。

## 方案

### 1. general 场景查询按跨场景召回

`packages/plugin/src/novel-writer/technique-store.ts` 的 `queryTechniques` 内联闭包 `matchesQuery`：场景匹配条件增加 `query.sceneType === "general"` 短路——`general` 语义即"不确定/跨场景"，此时不做场景过滤，全部条目按跨场景候选参与后续排序。具体场景查询逻辑不变；空交集（历史自由文本标签）的通用身份判定不变。

置信度路径与未验证新品曝光位路径共用该闭包，一处改动覆盖两条路径。

### 2. 召回先场景过滤后取数

`queryTechniques` 两段查询去掉 SQL 层 `.limit(limit)`，改为：全量取出（按原排序键排序）→ `matchesQuery` 过滤 → 跨池合并后按原有排序规则（置信度 → 入库时间 → id 全序）取 `limit`；不足 `limit` 返回实际匹配数。未验证曝光位路径同理（全量按 `created_at` 倒序 → 过滤 → 取 `UNVERIFIED_SPOTS`）。

性能考量：技法库为本地 SQLite 单表，实际条数十至百级，全量取出无压力；保留一个宽松上限（如 500 条）作为未来数据膨胀的安全阀，超出按排序键截断后再过滤。

### 3. search_techniques 空结果区分空库与无匹配

`packages/plugin/src/novel-writer/technique-learn.ts` 的 `searchTechniques` 返回结构增加库内总条数与未验证条数（`total`、`unverified`，均为过滤前计数）；`packages/plugin/src/novel-writer.ts` 工具包装层按分支输出：

- 双库总条数为 0 → 明确反馈"技法库为空（本书库与全局库均无条目）"；
- 有条目但过滤后 0 匹配 → 反馈"过滤条件下无匹配条目，库内共 N 条（未验证 M 条），可移除或放宽过滤条件"，不得表述为库为空。

工具描述补一句状态语义提示：`status` 缺省为全部；`verified` 需反馈积累，新库常全部为 `unverified`。

## 备选方案与取舍

- **给存量技法批量补 `general` 标签**：数据迁移思路，与"标签收敛至规范词表"的既有方向相悖，且不能解决未来新入库技法的同类错配；选择修匹配语义，标签数据不动。
- **修 `inferSceneType` 让其不再输出 `general`**：治标。`general` 是合法的场景查询值（学习指引明确教 agent 用它），检索侧必须能正确处理；启发式本身仍会有推断不出的章节。
- **召回改为向量/全文检索**：超出本变更范围，shadow 反馈闭环本来就设计在置信度排序上运行。

## 测试策略

- `packages/plugin` 测试：general 查询召回非空（库内全部具体标签）；具体场景查询行为不变；先过滤后取数（构造多于 `limit` 条同置信条目、部分场景不匹配，断言返回条数与全匹配）；曝光位路径同样先过滤后占位；`searchTechniques` 空库/非空库两分支输出文本。
- 复跑现有 `technique-*` 全部测试确认无回归。
- 验证：`packages/plugin` 下 `bun typecheck`、仓库根 `bunx oxlint`、`openspec validate technique-general-recall --strict`。

## 兼容性

纯行为修复：无协议/schema 变更、无数据迁移。修复后原本召回恒 0 的书籍将开始产生候选与 shadow 日志，反馈闭环随之启动，属预期行为；已入库技法的标签、状态、置信度均不受影响。
