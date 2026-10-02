# 设计：技法内容性质路由与全局通用技法库

## Context

现状事实（2026-10-02 实查）：

- 技法随书存储：每本书 `.novel/novel.db`；plugin 的 `session-store.ts` 是 `export * from "@opennovel-ai/novel-store"`，书库 schema 演进（含本变更的 scope 迁移）随 novel-store driver 的 `runMigrations` 自动生效。
- `techniques` 表字段无内容性质维度；novels 表 `genre` 自由文本不可靠（《金牌》genre="都市"）。
- schema 演进模式成熟：`migrate.ts` `runMigrations(exec, query)` 幂等迁移链（`migrateCharacterStatus` 即"加列、始终执行、幂等"范例）。
- **全局存储路径有渠道分流**：core `database/database.ts` 的 `path()` 在 latest/beta/prod 渠道用 `opennovel.db`，其余渠道用 `opennovel-<channel>.db`，且该文件由 core 的 EffectDrizzle 层管理（WAL/迁移/长连接）。
- **plugin 不依赖 core**（package.json 仅 sdk + novel-store），分层约束（Schema→Core/Protocol→Server）下 plugin 无法引用 `Global.Path`。
- `LocationQuery` 现状：`{ location?: { directory?, workspace? } }`（`protocol/src/groups/location.ts`）。
- 前置变更：`technique-scene-recall` 先实施，本变更在其 normalize/检索改动之上叠加。

## Goals / Non-Goals

**Goals:**

- 零干预：用户无开关、无分类操作；判断仅发生在学习时 agent，一次写入
- 通用技法跨书共享；成人技法不出产它的书（双向安全由构造保证）
- 双源召回/反馈/管理全链路打通（pipeline + CLI + 面板）
- 存量 63 条实施时完成 scope 标注

**Non-Goals:** 见 proposal.md Non-Goals。

## Decisions

### D1：路由即分离——scope 决定存储位置，取消书级开关

- `general` → 全局库，`adult` → 本书库：写作召回 = 本书库 ∪ 全局库；
- 安全论证：通用书的书库里**天然不会出现**成人技法（学习 agent 没从通用内容里提炼出来）；全局库**只住** general（路由规则写入侧保证）——两个泄漏方向都被构造封死，无需运行时按 scope 过滤，更无需书级设置；
- 安全阀：面板编辑 scope 触发跨库迁移，一次性纠错。
- 附带收益：全局技法反馈跨书积累，verified 晋升更快；`unverified` 曝光位跨池取最近 2 条，全局新品同样获得曝光。

### D2：判断权在学习 agent，规则"宁紧勿松"；工具层必填刚性化

- 判断时机唯一：学习流程中 agent 逐候选判断，证据原文在其上下文里，依据充分；
- prompt 规则：明显通用写法（对话节奏、悬念铺设、视角控制等）标 `general`；含成人内容或判断存疑标 `adult`；
- 不对称代价：under-tag（adult→general）泄漏进全局库可被通用书召回——危险方向；over-tag（general→adult）只是少复用——安全方向。故"拿不准一律 adult"；
- **工具层裁定：`save_technique` 的 `scope` 为必填枚举**（无缺省值）——"唯一判断点"原则的刚性化：agent 必须显式判断，杜绝"缺省 general"这类隐式 under-tag 通道；与 design.md Open Questions"无"保持一致（tasks 不再遗留未决项）；
- 纠错通道：面板 scope 编辑（D6/tasks 4.3）。

### D3：全局库 = 专用 techniques.db，novel-store 自解析、单一属主

审查中发现两个硬约束，决定放弃"复用 opennovel.db"的原方案：

- core 的存储路径按安装渠道分流（`opennovel-<channel>.db`）——共用则 dev 渠道学的技法在 release 不可见，反之亦然；novel-store 若复制该路径逻辑（渠道检测 + Flag 覆盖），必与 core 漂移；
- opennovel.db 由 core EffectDrizzle 层管理（独立迁移、长连接、WAL 设置），novel-store 再开连接共管同文件引入锁与缓存一致性问题。

**裁定**：全局技法库存于**专用文件** `join(xdgData, "opennovel", "techniques.db")`——

- novel-store 自解析（仅依赖 `xdg-basedir` + 常量 "opennovel"，新增该依赖到 novel-store；不 import core，守分层）；
- 单一属主：只有 novel-store 打开它，无共管问题；跨渠道天然共享（数据文件不分渠道，正是想要的语义）；
- 建表：techniques / technique_feedback（含 scope 列，无 novel 级外键——全局技法不绑定具体书），复用 driver 的 `runMigrations` 机制，连接缓存复用 `_dbCache` 按路径缓存模式；
- 测试覆盖：env 覆盖入口（仿 `OPENNOVEL_DB` 惯例，如 `OPENNOVEL_TECHNIQUE_DB`）+ 路径单测；
- plugin 经 `export * from "@opennovel-ai/novel-store"` 直接获得全局库入口，无需任何路径注入。

### D4：双源召回语义

- `queryTechniques`：本书库 + 全局库各查一轮（同一场景匹配与排序规则，叠加 scene-recall 的空交集回退），合并去重后统一裁剪到 limit；`unverified` 曝光位改为跨两池按入库时间取最近 2 条；
- `RetrievedTechnique` 增加 `library: "book" | "global"` 标记，供 shadow 段落/auditor/反馈链路引用；
- `incrementTechniqueUsage` 按技法所在库递增。

### D5：反馈与确认跨库

- `record_technique_feedback` 工具入参加 `library`（显式参数，不做 id 双库探测——探测多一次查询且 id 冲突时歧义），反馈行写入对应库；
- `updateConfidenceFromFeedback` 按 library 打开对应库执行；
- `search_techniques`/`confirm_techniques` 双源查询，结果行标注来源；
- `mergeTechniqueEvidence` 只合并同库同名技法（跨库同名不自动合并——避免把 adult 证据并进全局 general 技法）。

### D6：协议与 SDK——LocationQuery 增加 library 兄弟字段

- `LocationQuery` 增加 `library: Schema.optional(Schema.Literal("book", "global", "all"))`，**作为 location 的兄弟字段**（library 与 location 正交，不入 location 结构内），缺省 `book`（现状兼容）；`all` 供面板合并视图；
- 变更后按 AGENTS.md 从 `packages/client` 跑 `bun run generate` 再生成 SDK；
- `packages/schema` 契约同步：`Technique`/`CreateTechniqueInput`/`UpdateTechniqueInput` 增加 `scope`（UI 与协议共用）；
- 面板：列表合并展示 + 来源徽标；编辑 scope 触发跨库迁移（server 更新处理器内完成：目标库插入 + 源库删除 + 反馈行随迁，保持 id 不变）；创建支持归属选择（默认本书 + general）。

## Risks / Trade-offs

- [agent under-tag 把成人技法标 general 写入全局库 → 泄漏进通用书] → 宁紧勿松 prompt 规则 + **工具层 scope 必填**（D2）+ 面板 scope 编辑纠错（D6）+ 反馈链路可审计（shadow log 记录候选来源）；接受残余风险，零干预原则下不引入人工审批
- [双库写一致性：反馈/删除/迁移时定位错库] → 显式 library 参数（D5）+ recordFeedback 幂等；e2e 测试覆盖跨库反馈状态机与 scope 编辑迁移
- [全局库并发写（桌面单进程内多会话同时学习）] → SQLite WAL + 既有 `_dbCache` 按路径缓存单一连接；学习流程本身串行
- [协议/SDK 变更面大] → library 缺省 book 完全兼容现状；生成物 diff 由 `bun run generate` 锁定；schema 加可选字段向后兼容
- [既有 e2e 期望变化] → 双源默认不影响单书用例（全局库为空时行为不变）；测试矩阵补全局库非空场景
- [幂等迁移失败] → 仿既有风格 try/catch 不阻塞 DB 打开，告警留现场
- [专用 techniques.db 不在 core 备份/同步范围] → 记录于归档说明；如需随账户同步属后续变更

## Migration Plan

1. novel-store：scope 列迁移 + `globalDbPath()`/`getGlobalDb()`（专用 techniques.db）+ 双源 CRUD
2. plugin：类型/检索/反馈/工具跨库改造（scope 必填）+ director 学习提示词判断规则 + CLI 种子默认全局
3. `packages/schema` scope 契约 → protocol `library` 字段 → `bun run generate` → server 双源处理器（含 scope 编辑跨库迁移）
4. app 面板徽标 + scope/归属编辑
5. 存量标注：《金牌》63 条 agent 批量判定 scope=adult
6. 验证矩阵全绿后提交推送

回滚策略：revert 单变更；scope 列带默认值不影响旧代码读取（旧代码不查该列）；全局库为独立新文件无耦合，删除即回滚。

## Open Questions

（无——路由模型、判断规则与工具必填裁定、全局库落点、协议形态、存量处置均已定；残余风险已在风险节给出缓解。）