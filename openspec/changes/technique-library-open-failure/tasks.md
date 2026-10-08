# Tasks

依据：proposal.md、design.md（D1–D5）。

## 1. store 层 lastUsedAt 修复（D1）

- [ ] 1.1 `packages/novel-store/src/index.ts` 的 `toTechnique`：`lastUsedAt` 改为条件展开（`last_used_at != null` 才携带 key），并顺手排查同文件其他 `?? undefined` 映射是否命中同类陷阱（仅修技法相关，其他记录于提交说明）
- [ ] 1.2 novel-store 回归测试：`last_used_at = NULL` 的技法行走 list 与 detail 两路径，输出对象不含显式 `lastUsedAt` key，且经 `Technique` schema 解码通过（验证：测试通过）

## 2. 存量证据回填迁移（D2）

- [ ] 2.1 migrate.ts 新增 `migrateTechniqueEvidence(exec, query)`：逐行解析 evidence JSON，元素为对象时补缺失字符串字段（`sourceTitle` 取该元素 `sourceLocation` 缺省空串、其余补空串），有实际写入才 UPDATE；注册进 `runMigrations`
- [ ] 2.2 迁移测试：坏行经迁移后满足 `TechniqueEvidence` 契约；重复执行零写入（no-op）；已有非空字段不被改写（验证：测试通过）

## 3. 入库校验（D3）

- [ ] 3.1 novel-store 导出 `normalizeTechniqueEvidence`：按 2.1 同规则补全后逐条 `TechniqueEvidence` schema 校验，返回 `{ ok, evidence } | { ok: false, reason }`
- [ ] 3.2 plugin `saveTechnique`：写库前调用 3.1，ok 写入补全后证据；不 ok 拒绝并在返回中说明原因
- [ ] 3.3 plugin 测试：缺 `sourceTitle`（有 `sourceLocation`）的候选补全后入库；元素非对象等不可修复候选被拒绝且技法库无变更（验证：测试通过）

## 4. 列表行级容错（D4）

- [ ] 4.1 `packages/server/src/handlers/technique.ts` 的 `listTechniquesForDirectory`：合并排序后逐条 `Schema.decodeUnknownEffect(Technique)`，失败行跳过并 `Effect.logWarning`（含技法 id 与失败原因首行），返回其余行
- [ ] 4.2 server 测试：库中同时存在合法行与坏行时，list 返回全部合法行且不抛错（验证：测试通过）

## 5. 门禁

- [ ] 5.1 相关包（novel-store / plugin / server / app）`bun typecheck` 通过；仓库根 `bun run lint` 0 errors 且新增代码零告警
- [ ] 5.2 novel-store、plugin、app 测试全绿（app 既有用例不修改）
- [ ] 5.3 提交推送，footer 带 `OpenSpec-Change: technique-library-open-failure`