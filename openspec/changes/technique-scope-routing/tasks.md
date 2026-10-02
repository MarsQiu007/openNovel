# 任务：技法内容性质路由与全局通用技法库

依据：proposal.md（为什么/改什么/非目标）、design.md（决策 D1–D6、风险、迁移与回滚）。
**前置依赖**：`technique-scene-recall` 已实施（normalize 收敛 + 检索空交集回退），本变更在其改动之上叠加。

## 1. 存储层（novel-store）

- [ ] 1.1 `packages/novel-store/src/index.ts`：techniques 表 drizzle 定义与 `CREATE_TABLES_SQL` 增加 `scope text NOT NULL DEFAULT 'general'` 列（验证：新库建表 SQL 含 scope）
- [ ] 1.2 `migrate.ts` 新增幂等迁移（仿 `migrateCharacterStatus`：pragma 检测列存在性后 `ALTER TABLE techniques ADD COLUMN scope ...`，try/catch 不阻塞打开）；确认 plugin 书库经 `export * from novel-store` 自动获得迁移（design Context 已证）（验证：旧库打开后 `PRAGMA table_info(techniques)` 含 scope 列；重复运行幂等）
- [ ] 1.3 全局库：`globalDbPath()`（`join(xdgData, "opennovel", "techniques.db")`，新增 `xdg-basedir` 依赖到 novel-store；env 覆盖 `OPENNOVEL_TECHNIQUE_DB` 供测试）+ `getGlobalDb()`（复用 driver 的 `runMigrations` 与 `_dbCache` 模式；建 techniques/technique_feedback 表，含 scope 列，无 novel 级外键——design D3）（验证：路径单测断言目录与文件名；临时路径建库后表结构完整；**不**在 opennovel.db 上建表）
- [ ] 1.4 novel-store 技法 CRUD/反馈 API 增加库维度参数（book/global），默认值保持现状行为（验证：既有单测不改动全部通过）

## 2. plugin 双源改造

- [ ] 2.1 `technique.ts`：`TechniqueEntry` 增加 `scope`（`"general" | "adult"`），`RetrievedTechnique` 增加 `library` 来源标记（验证：typecheck）
- [ ] 2.2 `technique-store.ts`：`queryTechniques` 双源检索合并（本书库 + 全局库，统一场景匹配/置信度排序/裁剪；`unverified` 曝光位跨池取最近 2 条——design D4）；`recordFeedback`/`updateConfidenceFromFeedback` 按 library 操作对应库；`mergeTechniqueEvidence` 仅同库合并；`incrementTechniqueUsage` 按库递增（design D5）（验证：`technique-store.test.ts` 新增双源用例——全局库非空时通用书可召回、跨库同名不合并、反馈写入对应库、状态机按库演进）
- [ ] 2.3 `technique-learn.ts`：`saveTechnique` 增加 **必填** `scope` 参数并按 scope 路由目标库；`searchTechniques`/`confirmTechniques` 双源（结果行标注来源）（验证：`technique-learn.test.ts` 新增路由用例——scope=general 落全局库、scope=adult 落本书库、缺 scope 被拒绝）
- [ ] 2.4 `novel-writer.ts`：`save_technique` 工具 schema 加**必填** `scope` 枚举（`["general","adult"]`，design D2 裁定——agent 必须显式判断，不設缺省值）；`record_technique_feedback` 加 `library` 必填参数；工具描述更新判断规则与词表说明（验证：schema diff——scope/library 均 required；describe 含宁紧勿松规则）
- [ ] 2.5 `agents/director.ts` 技法学习流程提示词增加性质判断规则（通用写法 examples / 成人内容 / 拿不准一律 adult——design D2）；`agents/auditor.ts` 反馈说明补充跨库引用（验证：提示词文本审查 + prompt-alignment 测试）
- [ ] 2.6 `context.ts` 快照检索无需改动（queryTechniques 内部双源），确认 shadow log/候选段格式携带 library 标记（验证：e2e 快照输出含来源标记）

## 3. CLI 与存量标注

- [ ] 3.1 `cli.ts`：`seed-techniques` 默认写入全局库，新增 `--local` 保留写本书旧行为；实现说明记录默认变更（验证：命令帮助文本 + 导入后全局库可查）
- [ ] 3.2 存量标注：《金牌》（C:\Novels\audits）63 条一次性 agent 批量判定 scope（成人内容标 adult，留本书库；通用写法如"开篇冲突倒叙法"标 general 并迁移全局库，反馈行随迁、id 不变）（验证：标注后直查 SQL——63 条 scope 无 general 默认值残留误标，全局库新增条目数与判定一致；判定清单记录于本文件）

## 4. 协议 / SDK / server / app

- [ ] 4.1 `packages/schema` `Technique`/`CreateTechniqueInput`/`UpdateTechniqueInput` 增加 `scope` 契约字段（design D6）（验证：schema 单测/类型导出）
- [ ] 4.2 `packages/protocol` `LocationQuery` 增加 `library` 可选枚举（`book|global|all`，缺省 book，**location 兄弟字段**——design D6）（验证：`bun run generate` 后 client 生成物含新字段，生成 diff 仅为 technique 组与 LocationQuery）
- [ ] 4.3 `packages/server` technique 处理器按 library 路由双源（list/get/create/delete）；**更新 scope 触发跨库迁移**（目标库插入 + 源库删除 + 反馈行随迁，保持 id 不变——design D6）（验证：`packages/server` technique 测试通过，含迁移用例）
- [ ] 4.4 `packages/app` 面板：列表合并双源 + 来源徽标 + 按来源筛选；编辑支持 scope（改库迁移）；创建表单归属选择（默认本书+general——design D6）（验证：面板交互走查或组件测试）

## 5. 验证矩阵与提交

- [ ] 5.1 `packages/plugin` 技法测试全量通过（含 novel-store/plugin/server 三层新增用例）
- [ ] 5.2 各受影响包 typecheck 通过；`oxlint` 从仓库根运行通过
- [ ] 5.3 端到端冒烟：全局库置 1 条 general 技法 + 本书库置 1 条 adult 技法，跑一章写作快照——候选含全局条目、shadow log 记录来源；auditor 反馈后对应库状态机演进（验证：日志/SQL 实证记录于本文件）
- [ ] 5.4 提交推送，commit message 说明路由模型与零干预设计，footer 带 `OpenSpec-Change: technique-scope-routing`（验证：`git push` 成功）

## 6. 应急预案（仅在前置任务失败时执行）

- [ ] 6.1 若 SDK 再生成 diff 面远超预期：核对 generate 输入范围；必要时先合入 protocol 单点变更单独生成（验证：生成 diff 仅含 technique 组与 LocationQuery）
- [ ] 6.2 若存量 agent 判定质量差（大量误判）：改为保守全标 adult（留本书库，零泄漏），通用技法由用户日后面板手动提升；记录判定样本证据（验证：误判率统计随实施记录）
- [ ] 6.3 若双源合并导致既有 e2e 大面积失效：核对失效用例是否锁定单源假设——全局库为空时行为必须与单源完全一致，非此类失效则修复实现（验证：失效 diff 逐条可解释）