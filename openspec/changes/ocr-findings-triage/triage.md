# Triage: ocr-findings-triage

数据来源：ocr scan 会话 dca30d33-f6e3-476c-944a-368ed334ce6e（2026-10-12，model glm-5）。

处置枚举：fix（修复）/ wontfix（误报或冲突仓库约定，附证据）/ defer（真实但不在本 change）。

| ID | 文件:行 | 级别 | 类别 | 处置 | 理由 |
|---|---|---|---|---|---|
| H363 | packages/core/drizzle.config.ts:7 | high | maintainability | fix | drizzle.config.ts 的 dbCredentials.url 硬编码维护者 Linux home 路径，其他开发者本地跑 `bun db`（drizzle-kit）必失败；修复：改读环境变量或按当前用户数据目录拼接。仅开发工具配置，无运行时影响。 |
| H112 | packages/core/package.json:13 | high | bug | wontfix | 根 package.json:99 声明 @typescript/native-preview（catalog，bin 名即 tsgo），已提升到根 node_modules/.bin/tsgo.exe；包目录 `bun run typecheck` 可经 PATH 链解析，"未声明依赖"前提不成立。 |
| H365 | packages/core/src/account/sql.ts:10 | high | security | defer | access/refresh token 的静态加密属产品级安全决策（密钥来源需 keychain 或平台加密方案），且需 account 表数据迁移；本 change 硬约束不改数据模型。 |
| C121 | packages/core/src/aisdk.ts:99 | critical | bug | fix | JSON.parse(opts.body as string) 前补 typeof 字符串判断，非 JSON 请求体直接透传不做 chunk-abort 处理；当前断言下非 string body 会抛未捕获异常中断请求路径。 |
| H375 | packages/core/src/background-job.ts:256 | high | bug | wontfix | 无泄漏路径：extend 被拒（job 非 running）时新建 tail 未写入 jobs、无人 await、随条目 GC；已在链上的 fiber 在 cancel 的 Scope.close 后被打断，ensuring 的 Deferred.succeed(tail) 仍完成。真正可挂起的只有 promoted 未置位，另立 H374 修复。 |
| C124 | packages/core/src/background-job.ts:303 | critical | bug | fix | waitForPromotion 对非 running 任务返回 Effect.never：已完成/取消的任务永远不可能再被 promote，等待方死语义。修复：running 且未 promote 保留 await promoted；已结束返回 snapshot(job)；缺失任务保留 never（调用方均持有 start 返回的 id）。 |
| H374 | packages/core/src/background-job.ts:337 | high | bug | fix | settle 终态与 cancel 只完成 done、未置位 promoted，已 await job.promoted 的调用方挂死。修复：两处在状态结束后对 promoted 做 Deferred.succeed(snapshot).pipe(Effect.ignore)，与 C124 同文件同批修。 |
| H367 | packages/core/src/command.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H368 | packages/core/src/config.ts:177 | high | bug | wontfix | 同文件 loadFile（148-162 行）用 readFileStringSafe 读取，JSON 解析与 Schema 解码失败均返回 undefined 跳过，"临时不可读会崩溃"前提不成立；Effect.orDie 仅是错误通道收敛后的兜底，实际无可触发缺陷路径。 |
| H369 | packages/core/src/config.ts:196 | high | bug | wontfix | 同 H368：Effect.forEach(directPaths, loadFile) 的每处文件读取都在 loadFile 内部被 safe 读取+跳过消化，orDie 不会把配置错误升级为崩溃；评论与 loadFile 实际行为不符。 |
| H370 | packages/core/src/config.ts:200 | high | bug | wontfix | 同 H368：loadDirectory 仅由 forEach(loadFile) 与 Directory 构造组成，无未消化的文件系统错误（目录不存在的读取走 readFileStringSafe 返回 undefined），orDie 为兜底非崩溃点。 |
| H366 | packages/core/src/config/attachments.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C120 | packages/core/src/config/command.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C122 | packages/core/src/config/compaction.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C123 | packages/core/src/config/lsp.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H373 | packages/core/src/config/markdown.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H371 | packages/core/src/config/mcp.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H372 | packages/core/src/config/plugin.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H376 | packages/core/src/config/plugin/external.ts:87 | high | maintainability | fix | 保留 best-effort 跳过语义（67 行 glob 已有 orElseSucceed 先例）但 ignoreCause 使 import 失败、Schema 解码失败、注册失败完全静默；修复：ignoreCause 前对 cause 记一条日志告警。 |
| H384 | packages/core/src/config/plugin/provider.ts:26 | high | bug | wontfix | 条件语义为"只处理配置了 env 或已注册的集成"：15-21 行 configuredIntegrations 仅收集 env!==undefined 的 id，未配置但已注册者走 name/env 覆盖属 transform 预期；评论把 skip 条件的两个 && 误读为反了。 |
| H379 | packages/core/src/config/plugin/reference.ts:41 | high | bug | wontfix | string URL 场景下 entry.branch 恒为 undefined、被三元与可选展开跳过，repository 在 43 行 `typeof entry === "string" ? entry : entry.repository` 正确取串；JS 对 string 取属性不抛错，包 typecheck 现经 tsgo 通过，"invalid access"不成立。 |
| H377 | packages/core/src/config/plugin/skill.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C127 | packages/core/src/config/tool-output.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H383 | packages/core/src/control-plane/move-session.ts:93 | high | bug | fix | moveChanges=false（用户显式不搬变更）时 patch=Git.ChangeSet.make("") 恒 truthy：98 行仍向目的仓库 apply 空补丁，112 行仍 discover 源仓库并 discard（untracked:"remove"），源目录非 git 仓库时直接报 ResetSourceChangesError 使移动失败。修复：两处 if (patch) 改为判 sourceRepository !== undefined。 |
| H382 | packages/core/src/control-plane/move-session.ts:106 | high | bug | wontfix | publish 在 discard 前是 fail-safe 顺序：先 apply 到目的（101-103）、记录 Moved 事件（106）、最后才清源（112 起）。discard 失败时源变更仍在、可恢复；反过来先 discard 会在 publish 失败时销毁用户改动。空 patch 仍进分支的问题由 H383 修复。 |
| H378 | packages/core/src/control-plane/workspace.sql.ts:17 | high | bug | defer | time_used 实际语义是时间戳（projector.ts:228 与 workspace.ts:511/756 均写 Date.now()），命名澄清需改 opennovel Info.timeUsed 公开 Schema（packages/opennovel/src/control-plane/workspace.ts:40）与既有数据读法，属契约级变更按本 change 硬约束 defer。 |
| H380 | packages/core/src/credential.ts:37 | high | maintainability | wontfix | 37 行 JSDoc 明示 "Replaces any credential for an integration and returns the new record"，实现（99-117）在事务中先删后插，行为与文档一致；改名属 API 表面调整非缺陷修复。 |
| C126 | packages/core/src/credential.ts:56 | critical | bug | fix | 全仓仅 credential.ts:109 一处 insert 且恒写 integration_id，integration_id 为空的行必为脏/遗留数据；all() 经 stored() 过滤静默丢弃无诊断痕迹。修复：丢弃行时记一条告警日志。 |
| C125 | packages/core/src/credential.ts:124 | critical | bug | wontfix | drizzle-orm@1.0.0-rc.2 utils.cjs:201 mapUpdateSet 先 `filter(([, value]) => value !== void 0)`，.set() 忽略 undefined 字段、只更新传入项；123 行已拦全空调用，"部分更新会覆盖密钥"不成立。 |
| H381 | packages/core/src/credential/sql.ts:9 | high | security | defer | 同 H365：credential value 静态加密属产品级安全决策，涉及密钥管理与既有数据迁移，超出本 change 数据模型不变的范围。 |
| H387 | packages/core/src/database/database.ts:43 | high | security | wontfix | OPENNOVEL_DB 是进程属主自己的环境配置（:memory: 与绝对路径放行都是有意支持），能控制该 env 者已具备任意执行能力；把进程自身环境当不可信攻击面不成立。 |
| H385 | packages/core/src/database/migration/20260211171708_add_project_commands.ts:4 | high | maintainability | wontfix | DatabaseMigration.Migration 类型未定义 down（database/migration.ts 无 down 契约），全仓 40 个迁移均只实现 up，是 SQLite append-only 不回滚的既定策略；建议的 down(tx) 不满足现有类型。 |
| C128 | packages/core/src/database/migration/20260227213759_add_session_workspace_id.ts:4 | critical | maintainability | wontfix | 同 H385：down 不在本仓迁移框架契约内（40/40 迁移仅 up），已应用的历史迁移文件不可改；生产回滚策略属仓库级决策。 |
| H386 | packages/core/src/database/migration/20260227213759_add_session_workspace_id.ts:8 | high | bug | wontfix | session.sql.ts:30 workspace_id 本就可空（无 notNull），session.ts:275 仅在传入 workspaceID 时过滤，"无工作区归属"是合法语义；历史迁移已应用于本地库不可改写。 |
| H388 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:4 | high | maintainability | wontfix | down 不在本仓迁移契约：DatabaseMigration.Migration 类型无 down（migration.ts 全文无此字段），40/40 历史迁移仅 up；已应用迁移不可修改。 |
| C129 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:8 | critical | bug | wontfix | SQLite 仅在表有行时对 ADD COLUMN NOT NULL 无默认报错：全量重放时 workspace 表刚建且为空，迁移成功；既有库已完成该迁移不再重跑，历史文件不可改。 |
| H389 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:12 | high | bug | wontfix | config 列被同批结构化列（type/name/directory/extra）有意取代，发布前开发阶段不做数据搬运；历史迁移不可修改。 |
| C130 | packages/core/src/database/migration/20260309230000_move_org_to_state.ts:4 | critical | bug | wontfix | 同 H388：down 不属于本仓迁移框架契约，历史迁移不可改。 |
| H390 | packages/core/src/database/migration/20260309230000_move_org_to_state.ts:9 | high | bug | wontfix | active_org_id 列可空，孤立 account_state 行（理论上不存在）置 NULL 是可接受语义；历史迁移不可修改。 |
| C131 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:0 | critical | maintainability | wontfix | 同 H388：down 非契约字段，20260312043431 已应用不可改。 |
| C132 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:0 | critical | bug | wontfix | 与实际文件不符：20260312043431_session_message_cursor.ts:13 的 CREATE INDEX 括号完整闭合（`\`message_id\`,\`id\`);`），不存在语法错误。 |
| H391 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:0 | high | performance | wontfix | 迁移在单事务内执行（runner BEGIN/COMMIT 包裹，migrate.ts:46 同证），DROP+CREATE 索引原子生效，不存在"旧索引已删新索引未建"的可观测窗口。 |
| H392 | packages/core/src/database/migration/20260323234822_events.ts:14 | high | bug | defer | event(aggregate_id,seq) 唯一约束补齐需新增迁移并排查历史重复数据，属 proposal 排除的数据模型变更；应用层经 event_sequence 分配 seq + 一次性插入校验，现状未观察到重复行。归后续 schema change。 |
| H394 | packages/core/src/database/migration/20260427172553_slow_nightmare.ts:27 | high | bug | wontfix | 发布前开发阶段：20260413 建 session_entry、20260427 即切换 session_message 并删旧表，数据为可弃投影；历史迁移不可修改。 |
| C133 | packages/core/src/database/migration/20260428004200_add_session_path.ts:4 | critical | maintainability | wontfix | 同 H388：down 非契约，历史迁移不可改。 |
| H393 | packages/core/src/database/migration/20260507164347_add_workspace_time.ts:4 | high | maintainability | wontfix | 同 H388。 |
| H396 | packages/core/src/database/migration/20260510033149_session_usage.ts:4 | high | maintainability | wontfix | 同 H388。 |
| H397 | packages/core/src/database/migration/20260511000411_data_migration_state.ts:0 | high | maintainability | wontfix | 同 H388。 |
| C136 | packages/core/src/database/migration/20260601010001_normalize_storage_paths.ts:11 | critical | bug | wontfix | sandboxes 为 JSON 数组列（project/sql.ts:16 DatabasePath.absoluteArrayColumn），文本中路径反斜杠以 \\ 成对转义存在，仅替换成对反斜杠正是对 JSON 文本的正确处理；且历史迁移不可改。 |
| C134 | packages/core/src/database/migration/20260601202201_amazing_prowler.ts:4 | critical | maintainability | wontfix | 同 H388：down 非契约。 |
| H395 | packages/core/src/database/migration/20260601202201_amazing_prowler.ts:8 | high | bug | wontfix | permission 表已被事件/内存策略取代（20260603 后权限走 Policy），发布前清理废弃表为有意迁移；历史文件不可改。 |
| H399 | packages/core/src/database/migration/20260602182828_add_project_directories.ts:4 | high | maintainability | wontfix | 同 H388。 |
| H400 | packages/core/src/database/migration/20260603001617_session_message_projection_indexes.ts:4 | high | maintainability | wontfix | 同 H388；索引重组的逆操作在只进不退策略下本就不支持。 |
| C135 | packages/core/src/database/migration/20260603040000_session_message_projection_order.ts:4 | critical | maintainability | wontfix | 同 H388；且该迁移 DELETE 仅清理发布前不可信投影（8-9 行注释给出业务理由），一次性数据重置无回滚需求。 |
| H398 | packages/core/src/database/migration/20260603040000_session_message_projection_order.ts:10 | high | maintainability | wontfix | 8-9 行注释已说明 pre-launch 投影无法赋予真实聚合序、必须重建的决策依据；历史迁移不可修改。 |
| C137 | packages/core/src/database/migration/20260603160727_jittery_ezekiel_stane.ts:4 | critical | maintainability | wontfix | 同 H388。 |
| C138 | packages/core/src/database/migration/20260605003541_add_session_context_snapshot.ts:0 | critical | maintainability | wontfix | 同 H388。 |
| H401 | packages/core/src/database/migration/20260611035744_credential.ts:0 | high | security | defer | credential.value 静态加密属产品级安全决策（密钥来源/迁移），与 H365、H381 同归后续加密 change；本 change 不动数据模型。 |
| H402 | packages/core/src/database/migration/20260611192811_lush_chimera.ts:4 | high | maintainability | wontfix | down 不在本仓迁移契约内（DatabaseMigration.Migration 类型无 down 字段，40/40 历史迁移仅 up），已应用的历史迁移不可修改，SQLite 采用只进不退策略。 |
| C139 | packages/core/src/database/migration/20260611192811_lush_chimera.ts:9 | critical | bug | wontfix | lush_chimera 是 credential 表结构重写（drop+同名重建，integration_id 转可空并新增 connector_id/method_id/active），发布前开发阶段不迁移数据属有意决策；历史迁移不可修改。 |
| C140 | packages/core/src/database/migration/20260622142730_simplify_session_context_epoch.ts:4 | critical | maintainability | wontfix | 同 H402：本仓迁移框架无 down 契约，历史迁移不可改。 |
| H403 | packages/core/src/database/migration/20260622142730_simplify_session_context_epoch.ts:8 | high | maintainability | wontfix | 20260622142730 是 session_context_epoch 结构简化的历史迁移（发布前开发阶段重建，DROP COLUMN 为设计意图）；历史迁移文件不可修改，数据回收已无路径。 |
| C145 | packages/core/src/database/migration/20260622202450_simplify_session_input.ts:4 | critical | bug | wontfix | 两条迁移（20260622170816 与 20260622202450）语句完全相同且全部幂等（DELETE/UPDATE 对空表无副作用），重复执行无害；删除任一文件反而会让已应用库的迁移记录指向缺失 id。 |
| C142 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:0 | critical | bug | wontfix | SQLite 的 FK 在 DDL 时不校验父表存在（官方约束列表只限制 PRIMARY KEY/UNIQUE/CHECK），chapter_summaries 先建、chapters 同迁移内随后创建、插入发生在应用层两表齐备之后，重放不报错。 |
| C143 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:0 | critical | bug | wontfix | session 等基线表由安装期 schema push 创建（packages/core/src/database/schema.gen.ts 含 \`session\`），迁移只做增量；session_novel 的 FK 引用既有表，合法。 |
| H405 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:0 | high | bug | defer | chapter_versions (chapter_id,version) 唯一约束补齐需新增迁移并排查既有重复数据，属 proposal 明确排除的数据模型变更；应用侧 max+1 串行写入现状未出错，与 novel-store 同型问题（H820）一并归属后续 schema change。 |
| H406 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:0 | high | bug | defer | style_guide 按书一行由写入方约定保证（manual-edit-sync 仅在创建时插一行），UNIQUE(novel_id) 补齐属新增迁移的数据模型变更，proposal 非目标排除；归后续 schema change。 |
| H404 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:4 | high | maintainability | wontfix | 同 H402：down 不属于本仓迁移契约，历史迁移不可改。 |
| C141 | packages/core/src/database/migration/20261010032350_global_novels_columns.ts:4 | critical | maintainability | wontfix | 同 H402：down 不属于本仓迁移契约，20261010 迁移已应用于本地库不可改写。 |
| C144 | packages/core/src/database/path.ts:0 | critical | bug | fix | path.ts absoluteArrayColumn.fromDriver 直接 (JSON.parse(input) as string[])：损坏行抛裸 SyntaxError/TypeError 成 defect。修复：用 Schema.UnknownFromJsonString + 数组解码走 SqlError/明确错误通道。 |
| H408 | packages/core/src/database/sqlite.bun.ts:111 | high | security | wontfix | 全仓 grep 无任何业务代码调用 loadExtension（仅驱动接口自身与 effect-sqlite-node 垫片），"路径来自用户输入"的攻击面不存在；驱动内部 API 已由 Effect.try 包装错误。 |
| H407 | packages/core/src/database/sqlite.bun.ts:123 | high | bug | wontfix | transactionAcquirer 只在 Effect.uninterruptibleMask 回调内运行，运行时必然处于 fiber 上，Fiber.getCurrent() 恒非空；这是 Effect 文档化的 semaphore 事务获取器标准实现。 |
| H411 | packages/core/src/database/sqlite.node.ts:23 | high | security | wontfix | sqlite.node.ts:151-154 已将 config.allowExtension 传入 DatabaseSync 构造选项，未开启（默认 false）时 node:sqlite 原生拒绝 loadExtension；闸门在原生层生效，非遗漏校验。 |
| H409 | packages/core/src/database/sqlite.node.ts:58 | high | bug | fix | run() 中 native.prepare(query) 位于 try 之外：SQL 语法错误抛裸异常成为 fiber defect 而非类型化 SqlError。修复：prepare/setReadBigInts 移入同一 try 并以 operation:"prepare" 包装。 |
| H410 | packages/core/src/database/sqlite.node.ts:71 | high | bug | fix | 同 H409：runValues() 的 native.prepare 也在 try 块外，需一并移入并统一 SqlError 通道。 |
| H415 | packages/core/src/effect/layer-node.ts:259 | high | bug | fix | compile 的 walk 回调只拦 unbound：group 节点（111 行无 implementation）经 resolve 替换进入回调时 undefined.pipe 抛无名字 TypeError。修复：对 kind==="group" 显式 throw 命名错误。 |
| H412 | packages/core/src/effect/runtime.ts:6 | high | bug | wontfix | JS 单线程，`rt ??=` 同步求值无 await 间隙，不存在并发双创建 ManagedRuntime 的执行路径。 |
| H413 | packages/core/src/effect/runtime.ts:12 | high | bug | wontfix | makeRuntime 是进程级单例视图：ManagedRuntime 资源随进程生命周期持有，memoMap 统一管理层复用；暴露 dispose 属功能扩展非缺陷修复。 |
| C147 | packages/core/src/event.ts:316 | critical | bug | wontfix | projector 契约即同事务 DB 投影（event.ts:615 project 注册、session/projector.ts 等实现均为 DB 写），事件行与投影响应在一个事务内提交是 V2 设计要求的原子性（AGENTS.md: reload projected history before durable continuation）；移到提交后反而制造事件-投影不一致窗口。 |
| H417 | packages/core/src/event.ts:354 | high | bug | wontfix | wake 在事务提交后发布（354-360）是必要顺序：数据先可见、订阅者后被唤醒；若事务内发 wake，读到未提交行的竞态才是真的。评论把安全顺序当成了缺陷。 |
| H418 | packages/core/src/event.ts:441 | high | bug | wontfix | yield* Effect.die(err) 立即以 defect 中断生成器，不存在"yield 后继续执行"；else 分支是正常路径。评论误读 Effect.die 语义。 |
| C148 | packages/core/src/event.ts:585 | critical | bug | wontfix | durable() 先 subscribeDurable（588）再历史 readAfter（590），订阅先于读取+提交后才 wake，不存在丢事件窗口；多余 wake 只触发按 sequence 单调推进的幂等重读。 |
| H414 | packages/core/src/event/sql.ts:14 | high | maintainability | wontfix | cascade 是"整删聚合"清理通道的有意配置：20260622170816/20260622202450 reset 迁移正是靠 DELETE FROM event_sequence 级联清空 event；改 restrict 会破坏既有数据重置路径。 |
| C146 | packages/core/src/filesystem/search.ts:30 | critical | bug | wontfix | JS 单线程：state.files/directories 的 push 与读不并发，"arrays not thread-safe"是多线程语义错误移植；后台 fiber 渐进填充是有意的流式设计。 |
| H416 | packages/core/src/filesystem/search.ts:151 | high | bug | wontfix | throw 在 Effect.sync 内即转为 defect 通道，是原生索引器意外的惯用传播方式；调用方统一经错误层呈现，改 Effect.try 只是把 misuse 伪装成预期错误。 |
| H420 | packages/core/src/filesystem/watcher.ts:86 | high | bug | fix | `(_error, updates)` 下划线前缀是把原生 watcher 错误（inotify/EMFILE 等）直接丢弃；修复：error 非空时记告警日志（同文件已有 runFork 通道），不改变更新处理逻辑。 |
| H421 | packages/core/src/filesystem/watcher.ts:94 | high | bug | wontfix | catchCause 分支已处理"promise 晚于超时才 resolve"：pending.then(sub=>sub.unsubscribe())（99-101 行）在稍后兑现时仍会退订，评论前提不成立。 |
| H419 | packages/core/src/flag/flag.ts:32 | high | security | wontfix | 敏感值本就来自进程 env（同信任级），全仓无把 Flag 整体送日志/错误报告的调用点；"如果被打印会泄漏"对任何配置对象都成立，不构成缺陷。 |
| H427 | packages/core/src/git.ts:181 | high | bug | wontfix | locked 只包裹跨多命令的读-改-写组合（capture/restore 等），单命令操作由 git 自身 index.lock/ref 事务保证；KeyedMutex 不可重入，按建议扩大锁范围会让组合操作嵌套调用直接死锁。 |
| H428 | packages/core/src/git.ts:731 | high | bug | wontfix | 不带 --exit-code 的 `git diff` 有差异时也返回 0，退出码 1 只在 --exit-code 语义下出现；把非零当错误（735-737 mapError）正确，评论对 git 行为的前提错误。 |
| H422 | packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts:41 | high | bug | fix | switch 无 default 分支：未处理的 part.type 使 content.map 混入 undefined 元素直达 provider 请求体。修复：default 抛类型化错误或过滤并记告警。 |
| H423 | packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts:135 | high | bug | fix | 同 H422：output.type 未覆盖时 contentValue 保持 undefined 写入 tool 消息。修复：default 显式处理（抛错或降级文本）。 |
| H424 | packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:480 | high | bug | fix | reasoning_text 在 isActiveText 时入队 reasoning-start 却未先 close 文本段，与反向（496-505 先关 reasoning）不对称，产生双活跃段。修复：启动 reasoning 前若 text 活跃先入队 text-end。 |
| H425 | packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:537 | high | bug | fix | index 为 null 时 toolCalls[null] 成为字符串键 "null" 挂到数组上，后续按数字索引聚合漏掉该工具调用。修复：index==null 直接抛 InvalidResponseDataError。 |
| C149 | packages/core/src/github-copilot/chat/openai-compatible-prepare-tools.ts:67 | critical | bug | fix | provider 型工具被过滤后 toolChoice.type==="tool" 仍指向已删除的函数名，请求 400。修复：case "tool" 分支校验目标存在于 openaiCompatTools，缺失则降级 "auto" 并加 unsupported 告警。 |
| H429 | packages/core/src/github-copilot/responses/convert-to-openai-responses-input.ts:142 | high | bug | wontfix | convert* 系列为 ai-sdk 上游移植的输入转换模块：对畸形输入抛错是该层契约（调用方经 stream 错误通道统一呈现），换成局部 try-catch 反而偏离上游语义。 |
| H426 | packages/core/src/github-copilot/responses/openai-responses-api-types.ts:34 | high | bug | wontfix | 类型忠实镜像 OpenAI Responses API 现实（input_image 允许 image_url 或 file_id 两种形态），构造方各取其一；同判别值 union 合法且无运行时缺陷。 |
| H431 | packages/core/src/github-copilot/responses/tool/file-search.ts:125 | high | bug | wontfix | provider 端执行工具的 inputSchema 对应模型生成输入（契约为空对象）；vectorStoreIds 等泛型是宿主配置 args，不走该输入通道。评论混淆两组泛型参数。 |
| H430 | packages/core/src/github-copilot/responses/tool/image-generation.ts:95 | high | bug | wontfix | 同 H431：image_generation 为 provider 执行工具，inputSchema z.object({}) 是模型输入契约，args 校验属宿主配置通道。 |
| H433 | packages/core/src/global.ts:11 | high | bug | wontfix | xdg-basedir 各值在 HOME/XDG_* 可用时恒有值，桌面进程（Bun/Node）环境前提成立；与仓库大量 os.homedir 直用假设一致，非缺陷。 |
| H432 | packages/core/src/id/id.ts:39 | high | bug | wontfix | timestamp 仅消费 create() 产出的内部 ID（文档注释已限定），畸形入参不属于可达调用面；补校验是防御性扩展非缺陷修复。 |
| H434 | packages/core/src/image/photon.ts:0 | high | maintainability | wontfix | photon-node 要求模块加载前经 globalThis 注入 WASM 路径（vendor 约束，1 行注释说明由 Bun 编译内嵌）；赋值为同步常量写入，无竞态面。 |
| H435 | packages/core/src/integration.ts:322 | high | bug | fix | settle 先 CAS 置 complete、随后 credentials.create/publish 若失败，attempt 呈现成功但凭据未落库。修复：保留 CAS 幂等前置，在 create/publish 失败路径把该 attempt 回写为 failed 并记录 message。 |
| C150 | packages/core/src/integration/connection.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H436 | packages/core/src/models-dev.ts:255 | high | bug | fix | AGENTS.md 明确要求未信任 JSON 用 Schema 解码而非 manual parse+cast；models.dev 远端 payload 直接 `as Record<string, Provider>` 会让畸形数据在使用处远端爆错。修复：在 populate 边界 decodeUnknown（onExcessProperty ignore）并包装错误。 |
| C151 | packages/core/src/models-dev.ts:256 | critical | bug | wontfix | populate 顺序为磁盘缓存→内嵌快照 OPENNOVEL_MODELS_DEV→网络（211-226），仅当目录完全缺失且网络失败才 die：此时无模型目录的运行失败快于空目录带病启动，属有意 fail-fast。 |
| H437 | packages/core/src/npm-config.ts:32 | high | bug | wontfix | .npmrc 是可选配置：缺失/不可读时回退默认 registry（37 行 fallback 与注释同证）是设计意图；记错误日志属锦上添花非缺陷。 |
| H438 | packages/core/src/npm.ts:45 | high | security | fix | sanitize 仅在 win32 过滤非法字符，POSIX 原样返回：包名含 ../ 时 join(cache, sanitize(pkg)) 可越出缓存目录（配置可来自克隆仓库）。修复：sanitize 对全平台拒绝路径分隔符/..（校验 npm 包名字符集）。 |
| C152 | packages/core/src/oauth/page.ts:114 | critical | security | fix | new URL(绝对URL, origin) 会忽略 base：tokenPath 一旦为绝对 URL，OAuth fragment token 将被 POST 到外部域。修复：bootstrapScript 生成 TOKEN_URL 后校验与 location.origin 同源，不同源直接 fail 渲染错误态。 |
| H439 | packages/core/src/patch.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H440 | packages/core/src/patch.ts:160 | high | bug | wontfix | eof 是"优先匹配"而非硬约束：163-165 先试 EOF，未命中回退常规扫描与 166-168 四级比较器（exact→normalized）渐进容忍语义一致；改硬失败会丧失 patch 容错，属既有设计。 |
| C154 | packages/core/src/permission.ts:237 | critical | bug | wontfix | JS Map 规范：迭代中删除当前/已访问条目不影响游标，245 行只删正在处理的匹配项，236 行删除在循环前完成；不存在"跳过未处理条目"的路径。 |
| H443 | packages/core/src/permission.ts:250 | high | bug | wontfix | saved.add 失败经 orDie（saved.ts:68）在 Deferred.succeed（257 行）之前中断，回复不会按"已保存"成功返回；onConflictDoNothing 是幂等设计。 |
| C153 | packages/core/src/permission/saved.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H441 | packages/core/src/permission/saved.ts:47 | high | maintainability | wontfix | orDie 是本仓 DB 操作统一错误收敛（credential.ts、event.ts、permission.ts 同型），DB 缺陷不作为业务错误让调用方分支处理；改类型化错误是仓库级约定变更。 |
| H442 | packages/core/src/permission/saved.ts:67 | high | maintainability | wontfix | 同 H441：orDie 属仓库 DB 层统一惯例，insert 冲突已由 onConflictDoNothing 显式消化。 |
| H444 | packages/core/src/plugin.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C155 | packages/core/src/plugin.ts:128 | critical | bug | wontfix | active 仅是登记/去重表，子 scope 经父 Scope.close 级联关闭（forkIn 树语义），先 clear 不制造孤儿 scope；关闭中途失败时父级资源随进程作用域一并回收。 |
| H446 | packages/core/src/plugin/command.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H445 | packages/core/src/plugin/host.ts:201 | high | bug | fix | 插件在 transform 回调里传畸形 source 时 decodeUnknownSync 抛裸 SchemaError 并以 defect 冲击 reload 管线。修复：decodeUnknownResult/Either 后抛带 name/类型的显式 Error（保持快速失败但可定位、可被插件边界捕获）。 |
| H449 | packages/core/src/plugin/internal.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H447 | packages/core/src/plugin/promise.ts:29 | high | bug | wontfix | register/run 的 effect 均签名 Effect<…, never>：Promise 仅在 defect（程序错误）时 reject，崩溃可见正是该适配层给 JS 插件的契约；消费方 await/catch 属插件代码职责。 |
| H448 | packages/core/src/plugin/promise.ts:69 | high | bug | wontfix | 同 H447：connection.active/resolve 返回给插件的 Promise 由插件消费，never 错误通道下无预期 reject 面。 |
| H450 | packages/core/src/plugin/provider/amazon-bedrock.ts:90 | high | bug | wontfix | 写 AWS_BEARER_TOKEN_BEDROCK 是 AWS SDK 凭据链读取环境的兼容桥，90 行守卫确保不覆盖已有显式配置；单用户进程模型不存在跨请求泄漏面。 |
| H455 | packages/core/src/plugin/provider/cloudflare-workers-ai.ts:17 | high | bug | wontfix | request 为 ProviderV2 必填结构（packages/core/src/provider.ts:19-20 复用 protocol Request），aisdk 分支下 tsgo 通过即保证 request.body 存在；评论假设的可选形状不成立。 |
| H454 | packages/core/src/plugin/provider/dynamic.ts:14 | high | security | wontfix | 按配置安装并 import npm 包正是 provider 插件机制的定义（与 external.ts 同源），信任边界即用户配置；包名经 npm.add registry 校验，"代码注入"是把功能当漏洞。 |
| C156 | packages/core/src/plugin/provider/github-copilot.ts:0 | critical | bug | fix | 守卫只防 responses 与 chat 同时缺失、34 行只判 responses：`responses 存在但 chat 缺失` 的非 responses endpoint 分支会 TypeError。修复：else 分支对 chat 判空并回落 languageModel 或显式报错。 |
| H456 | packages/core/src/plugin/provider/gitlab.ts:41 | high | bug | wontfix | 同 H455：model.request.body 为必填类型形状（tsgo 通过即证明），38 行已对可空的 evt.options.featureFlags 做了 typeof 守卫，作者区分了可空/必填字段。 |
| H453 | packages/core/src/plugin/provider/google-vertex.ts:44 | high | bug | wontfix | fetch 适配器契约：取凭据失败与网络错误同经 rejected promise 由调用方按请求失败呈现，加 try/catch 转译错误形态不改变行为，反偏离 fetch 语义。 |
| H452 | packages/core/src/plugin/provider/google-vertex.ts:45 | high | performance | fix | 每次 HTTP 请求重建 GoogleAuth+getClient：重复读凭据文件、无谓延迟与限额风险。修复：把 client 以惰性 Promise 缓存在返回函数外（token 刷新由 google-auth-library 自带）。 |
| H451 | packages/core/src/plugin/provider/google-vertex.ts:48 | high | bug | fix | client.getAccessToken() 可解析出 token 为空（凭据半配置态），直拼出 `Bearer undefined` 造成远端 401 难定位。修复：token 缺失时抛明确本地错误。 |
| H457 | packages/core/src/plugin/provider/nvidia.ts:10 | high | bug | wontfix | 同 H455：api.type/package/url 为判别联合必填字段，10-12 行逐条 continue 的写法依赖类型收窄，评论的可选链无必要。 |
| H458 | packages/core/src/plugin/provider/nvidia.ts:13 | high | bug | wontfix | provider.request.headers 为必填 Record（同 H455 类型论证）；HTTP-Referer/X-Title 等硬编码串即该集成的产品需求本身，非缺陷。 |
| H459 | packages/core/src/plugin/provider/openai.ts:114 | high | bug | fix | while(true) 把 403/404 一律视为继续等待：设备码过期后服务端若持续返回 404 则无限轮询。修复：按 device.expires_in 设截止 deadline，超时后 fail（与 opennovel.ts poll 的服务端驱动终止对齐）。 |
| C157 | packages/core/src/plugin/provider/opennovel.ts:239 | critical | bug | wontfix | poll 只对 authorization_pending/slow_down 续轮询（256-258），其余 error（含 RFC 8628 的 expired_token）直接 fail，服务端按 expires_in 终止流程；补本地过期判断属增强非缺陷。 |
| H460 | packages/core/src/plugin/provider/sap-ai-core.ts:0 | high | bug | wontfix | evt.options 为 transform 事件必填字段（gitlab.ts:38 等处同型直用），serviceKey 读取已用 typeof 守卫值类型；可选链前提不成立。 |
| H461 | packages/core/src/plugin/provider/vercel.ts:9 | high | bug | wontfix | api 为 ProviderV2 必填判别字段（同 H455 类型论证，tsgo 通过即成立），evt.provider.list() 元素形状由 schema 保证；可选链建议针对的类型不存在。 |
| H462 | packages/core/src/policy.ts:35 | high | bug | wontfix | JS 单线程同步读：hasStatements() 与使用点间无 await 交错点；statements 仅经 load() 原子指针替换（配置重开时），"竞态"需要多线程模型才成立。 |
| C158 | packages/core/src/process.ts:202 | critical | bug | wontfix | Effect v3 中 TaggedError 实例本身是 Yieldable（yield* new E() 即 Effect.fail），202-205 是全仓统一惯例（move-session.ts、session.ts 同型写法）；评论前提不成立。 |
| C161 | packages/core/src/project/copy.ts:175 | critical | bug | wontfix | orDie 属本仓库 FS/DB 非预期错误统一收敛惯例（config.ts、credential.ts 同型），项目副本创建失败即致命路径，崩溃报告由上层统一呈现。 |
| H465 | packages/core/src/project/copy.ts:217 | high | performance | wontfix | isDir 为极轻 stat 操作且规模受 projectID 目录表约束（数十级），unbounded 无实际资源耗尽面；限 20 并发是优化口味非缺陷。 |
| C160 | packages/core/src/project/copy.ts:244 | critical | bug | wontfix | 同 H441：db.transaction orDie 是本仓库 DB 层统一错误收敛惯例；事务失败die 会经 drain 的 tapCause/日志呈现，不构成静默。 |
| H463 | packages/core/src/project/schema.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H464 | packages/core/src/provider.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H468 | packages/core/src/pty.ts:109 | high | maintainability | wontfix | 空 catch 是有意的订阅者隔离：一个回调抛错不得阻断其他订阅者或 PTY 生命周期（109-111 与 204-217 结构一致）；补日志属观测性增强。 |
| C164 | packages/core/src/pty.ts:204 | critical | bug | wontfix | Map 规范：迭代中删除当前条目安全、不影响游标；204-212 仅删抛错的 token（当前项），与 C154 同型误报。 |
| H469 | packages/core/src/pty.ts:223 | high | bug | wontfix | 单线程 fiber 下各同步段原子；退出后 removeSession 清理是生命周期正semantics，对已退出 PTY 的 attach 报 NotFound 属正确行为而非竞态缺陷。 |
| H470 | packages/core/src/pty.ts:286 | high | bug | wontfix | write 闭包已判 session.info.status==="running"（289-291），退出/移除后闭包对象不再触发任何进程副作用；activate/detach 操作历史视图无害。 |
| C159 | packages/core/src/pty/protocol.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C162 | packages/core/src/public-event-manifest.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H467 | packages/core/src/reference.ts:88 | high | bug | fix | cache.ensure 失败仅告警、materialized 条目留存为"幽灵引用"（path 指向从未存在的克隆目录）。修复：ensure 失败路径删除该 name 的 materialized 条目或降级标记，消费方不再拿到空目录引用。 |
| H466 | packages/core/src/reference.ts:109 | high | bug | wontfix | finalize 的 materialized.clear→循环 set 为同步段（forkIn 不阻塞、其间无 await），list 读不到半清空状态；单线程模型下无撕裂窗口。 |
| C163 | packages/core/src/repository.ts:168 | critical | security | wontfix | 与 H387 同理：该 env 是进程属主的克隆镜像配置通道（本仓在中国大陆网络正需要 ghfast.top 类镜像），能改 env 者已具任意执行能力，file:// 不构成提权增量。 |
| H480 | packages/core/src/ripgrep.ts:116 | high | bug | wontfix | 计数器语义正确：onItem 恰调 limit 次（observed 先自增，item limit+1 时 observed>=limit 跳过），take(limit+1) 独立用于 truncated 判定（130 行）；评论未跑通该对账即断言错位。 |
| C167 | packages/core/src/ripgrep/binary.ts:58 | critical | security | wontfix | 优先固定 System32 tar.exe（61-63），which 回退仅在无 bsdtar 环境；PATH 可被攻击者改写则任意执行早已成立（同 H387 信任模型），不构成独立漏洞。 |
| H474 | packages/core/src/schema.ts:0 | high | bug | fix | JSDoc 示例 `this.make(id)` 自引用会无限递归，示例教坏 Newtype 用法。修复：改为不依赖被覆写 make 的合法示例（直接 Schema 解码/构造）。 |
| C165 | packages/core/src/session.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C166 | packages/core/src/session.ts:374 | critical | bug | wontfix | Effect v3 中 TaggedError 实例即 Effect（yieldable），catchDefect 处理器返回 PromptConflictError 合法等价于 Effect.fail；同 C158 惯例，374-378 无错。 |
| H473 | packages/core/src/session/context-epoch.ts:40 | high | bug | wontfix | prepare/initialize 仅经 SessionRunCoordinator 的每 Session 串行 drain 调用（AGENTS.md V2：serialized runner、local drains process-local），同 session 无并发读写窗口；乐观锁留给 clustering 落地时一并处理。 |
| H471 | packages/core/src/session/context-epoch.ts:80 | high | bug | wontfix | 同 H473：drain 串行化排除并发 initialize；即便未来 clustering 引入并发，主键冲突也会经事务通道显式失败而非静默双写。 |
| H472 | packages/core/src/session/context-epoch.ts:122 | high | bug | wontfix | 同 H473：baselineSeq 生成-插入窗口处于单 Session 串行 drain 内，无其他写入方；跨进程并发属 clustering 未实现范围（AGENTS.md 明示）。 |
| H475 | packages/core/src/session/execution/local.ts:21 | high | bug | wontfix | locations 为 Effect LayerMap（location-service-map.ts:8-15），get(ref) 契约恒返回 Layer、懒构建/缓存，类型无 undefined 分支；未知 location 在层构建期经 LocationError 通道失败。 |
| H477 | packages/core/src/session/input.ts:51 | high | bug | wontfix | durable admission 幂等是 V2 显式语义（AGENTS.md：message ID 复用 reconcile exact retry、conflicting reuse fails）：并发双 find 时后到的 publish 以一次性冲突走 374-378 catchDefect 对账路径，属设计而非残留竞态。 |
| H476 | packages/core/src/session/input.ts:129 | high | bug | wontfix | 该投影体在 durable 事件 publish 事务内执行（见 C147：event.ts:320-321 projector 同事务运行），update+insert 已共处同一事务边界，再套 db.transaction 会嵌套冲突（migrate.ts:46 同类教训）。 |
| H478 | packages/core/src/session/message-updater.ts:334 | high | bug | fix | pending 态工具失败时 `typeof input === "string" ? {}` 直接丢弃已生成的参数 JSON。修复：尝试经 Schema 解码为对象、失败保留 {_raw: string}，不静默丢数据。 |
| C168 | packages/core/src/session/message.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H479 | packages/core/src/session/projector.ts:312 | high | bug | wontfix | events.project 回调在 durable 事件 publish 事务内执行（event.ts:320-321，同 C147/H476 结论），多步 DB 写已共处同一事务边界，无需再包 transaction。 |
| H481 | packages/core/src/session/run-coordinator.ts:37 | high | bug | wontfix | JS 协作式调度：fork 与 entry.owner 赋值同一同步段，其他 fiber 的 interrupt 无法在两段之间执行；新 fiber 首步（yieldNow/Deferred.await）必然挂起至赋值完成。 |
| C169 | packages/core/src/session/runner/publish-llm-event.ts:46 | critical | bug | wontfix | 纯同步 helper 内 throw 属 misuse 路径（上游应产出受支持的结果类型），以 defect 传播符合仓库"意外错误走 die 通道"惯例（同 H416/C158 论证）；改返回 Effect 是无谓上下文负担。 |
| H483 | packages/core/src/session/store.ts:36 | high | bug | wontfix | orDie 是本仓库 DB 读统一错误收敛惯例（H441 同论）；store.get 的调用方（drain/HTTP 层）均有统一崩溃上报，不存在需要分支处理的预期 DB 错误面。 |
| H484 | packages/core/src/session/store.ts:55 | high | bug | fix | store.ts:55 解码失败 orDie，而 history.ts:55-64 同型解码产出类型化 MessageDecodeError——同库两口径会让损坏消息行在单条读取路径变 defect 崩溃。修复：对齐为 Effect.mapError(MessageDecodeError)。 |
| H482 | packages/core/src/share/sql.ts:10 | high | security | wontfix | session_id 即主键（每会话一个分享），secret 由随机 Identifier 生成、URL 校验需原值比对；加 unique 约束不改变任何行为，明文存储与 H365/H381 属同一静态加密议题（已 defer）。 |
| H485 | packages/core/src/skill.ts:79 | high | security | wontfix | skill 目录来自本地工作区/仓库配置（信任边界同插件加载 H454），symlink:true 与 external.ts:64 同惯例；能在工作区制造恶意符号链接者已有全盘读权限。 |
| H495 | packages/core/src/state.ts:33 | high | bug | wontfix | 35-36 行已有批则复用外层（return yield* effect，不再 provideService），嵌套 batch 正确合并；建议代码与实际实现等价，评论未读 36 行短路分支。 |
| H486 | packages/core/src/sync/device.ts:0 | high | bug | fix | device.json 存在但损坏时 JSON.parse 裸抛 SyntaxError，设备身份初始化路径无恢复（.catch 只护 readFile）。修复：解析失败按缺省身份处理或重建文件（仓库惯例走 Schema 解码 Option）。 |
| C170 | packages/core/src/sync/local-folder.ts:15 | critical | security | fix | remotePath 段可含 ..（filter(Boolean) 不滤点段），path.join(root, "..", ...) 可越出同步根目录；而远端 name/snapshotID 来自可被劫持的同步服务器响应。修复：resolve 拒绝 .. 段并校验结果在 root 内。 |
| H492 | packages/core/src/sync/service.ts:578 | high | bug | fix | copyFile 中途失败（ENOSPC 等）会留下半写主库且无自动恢复，而 backupCurrent 备份就在手边。修复：copy 失败时以备份文件回写 db 后再抛原错误。 |
| H489 | packages/core/src/sync/sqlite.bun.ts:10 | high | security | wontfix | target 为内部生成的临时快照路径（同步代码常量拼接），单引号已转义（13 行）；对内部路径做遍历校验属防御性扩展，非用户输入面（同 H387 信任模型）。 |
| C171 | packages/core/src/sync/sqlite.bun.ts:20 | critical | security | wontfix | queryAll 的 sql 全部来自内部常量调用（注释 19 行限定用途），连接以 readonly 打开已杜绝写能力；"如果调用方传不可信输入"不构成现实攻击面。 |
| H487 | packages/core/src/sync/sqlite.node.ts:19 | high | security | wontfix | 同 C171：node 驱动版 queryAll 亦 readonly DatabaseSync、内部常量 SQL，无注入面。 |
| H488 | packages/core/src/sync/state.ts:36 | high | bug | fix | 同 H486：sync.json/registry 文件损坏时 JSON.parse 裸抛（37-39 行 .catch 只护 readFile），配置读取应容错。修复：解析失败返回 undefined（视为未配置）。 |
| H490 | packages/core/src/sync/webdav.ts:117 | high | bug | fix | webdav readJson 的 JSON.parse 失败抛裸 SyntaxError，违反适配器"仅 SyncError"错误契约（调用方按 code 分支处理）。修复：解析失败转 SyncError(io) 或按 not_found 语义返回 undefined（与相邻方法一致）。 |
| H491 | packages/core/src/system-context/builtins.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H493 | packages/core/src/system-context/index.ts:228 | high | bug | wontfix | reconcileObservation 是纯同步代数（返回 Unchanged/Updated/Replace 联合即其错误面），可能 throw 的均为程序错误路径，die 传播正确（同 C169）；引入 tagged 错误类型是扩展。 |
| H494 | packages/core/src/system-context/index.ts:314 | high | bug | wontfix | combine 为同步公开 API、以 throw 传达 DuplicateKey 是其既有契约（评论自认 acceptable）；改 Effect 返回会波及全部调用方，属 API 演进非缺陷修复。 |
| C172 | packages/core/src/tool-output-store.ts:182 | critical | bug | wontfix | `info?.mtime.pipe(...)` 可选链在 info 为 undefined 时短路整链，不会 TypeError；187 行 `modified !== undefined` 使 stat 失败条目被跳过，不存在误删。评论误读可选链语义。 |
| H498 | packages/core/src/tool/apply-patch.ts:91 | high | bug | wontfix | `return yield* new ToolFailure(...)` 即 Effect.fail（TaggedError yieldable，同 C158 全仓惯例），执行正确中断。 |
| H500 | packages/core/src/tool/bash.ts:59 | high | maintainability | fix | isTimeout 依赖跨文件字符串比较 error.cause.message === "Timed out"（process.ts:186 构造），文案漂移即静默失效。修复：AppProcess 导出带标记的超时错误类型/谓词，bash.ts 按标记判定。 |
| C173 | packages/core/src/tool/builtins.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H496 | packages/core/src/tool/glob.ts:75 | high | security | wontfix | 工具执行前已 permission.ask 按本次调用授权（70-74 行 source=tool），目录边界由权限系统管理而非 Location 圈禁（read/glob 跨目录访问是受控能力）；补 startsWith 检查与权限模型重复。 |
| H497 | packages/core/src/tool/question.ts:80 | high | bug | wontfix | question.ask 的失败（会话不存在等）在本仓库属致命异常，orDie 与工具层统一收敛惯例一致（H441）；用户拒答走 Reply 通道而非错误通道。 |
| H505 | packages/core/src/tool/read-filesystem.ts:216 | high | bug | wontfix | 非分页分支仅限 <=MAX_READ_BYTES 的小文件（215 行 size 超限即走 paged 逐块检查），且后续块经 fatal TextDecoder 解码失败同样转 BinaryFileError（218-222），二进制判定不止首块；首块启发式为设计。 |
| H499 | packages/core/src/tool/read.ts:69 | high | security | wontfix | inspect 仅 stat（存在/类型），不读内容；外部目录访问权限已在 target 解析处校验（64-68 externalDirectoryPermission），resource 审批门只管内容读取，调序不改变安全语义。 |
| H502 | packages/core/src/tool/registry.ts:75 | high | bug | wontfix | bound 的类型化错误在工具调用错误声明通道内传播，68-73 行正是 ToolFailure 的统一转化点；评论未指出可越过该通道的具体错误。 |
| H501 | packages/core/src/tool/registry.ts:89 | high | bug | wontfix | 89-93 整个 get→set 循环处于 uninterruptible 同步段、无 await 挂起点，单线程下并发注册不可交错；"lost registration"需要抢占模型。 |
| H503 | packages/core/src/tool/tool.ts:98 | high | bug | fix | 插件提供的 toStructuredOutput 同步 throw 会变成裸 defect，绕过 ToolFailure 通道。修复：以 Effect.try 包裹回调并 catch 为 ToolFailure（无效的结构化转换输出）。 |
| C174 | packages/core/src/tool/tools.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H504 | packages/core/src/tool/webfetch.ts:85 | high | security | wontfix | 本地单用户代理进程的网络能力与用户自身等价（拦内网段会破坏 localhost 联调这一常用场景）；SSRF 威胁模型适用于多租户服务端，本工具按调用走权限审批，部署隔离属进程/防火墙边界。 |
| H506 | packages/core/src/tool/websearch.ts:146 | high | security | wontfix | ?exaApiKey 查询参数是 Exa liveapi 文档规定的传法，端点即服务方本身（TLS 直达），不存在第三方日志泄漏面；改 header 需供应商支持。 |
| H510 | packages/core/src/util/effect-flock.ts:263 | high | bug | fix | 心跳 utimes 失败经 ignore 静默后持锁进程不再刷新心跳，其他进程按过期窃取锁形成双持。修复：失败分支记告警（保留重试），连续失败达到过期阈值时中断持有方或显式释放。 |
| H511 | packages/core/src/util/flock.ts:213 | high | bug | wontfix | 213 行 `await writeFile(...).catch(async () => {...throw})`：catch 回调返回 rejected promise 被链式传播、外层 await 收到，不存在未处理 rejection。 |
| H507 | packages/core/src/util/hash.ts:4 | high | security | wontfix | fast() 命名与用途即非安全摘要（缓存键/标识），安全场景同文件已提供 sha256；评论未指出任何把 Hash.fast 用作凭据/完整性验证的调用点。 |
| H508 | packages/core/src/util/lazy.ts:5 | high | bug | fix | lazy() 先置 loaded=true 再调 fn()：fn 抛错后缓存被永久毒化为 undefined（返回类型 T 却给 undefined）。修复：fn() 成功后再置 loaded（失败重试语义）。 |
| H509 | packages/core/src/util/retry.ts:27 | high | bug | fix | attempts<=0 时循环不执行、`throw lastError` 抛 undefined。修复：入口对 attempts 取 Math.max(1, …) 或直接 fail 明确参数错误。 |
| C175 | packages/core/src/util/token.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H513 | packages/core/src/util/wildcard.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H514 | packages/core/src/util/wildcard.ts:11 | high | bug | wontfix | 8 行把 * 替换为 .* 后空格保留："foo *" 转义为 "foo .*"，11 行 endsWith(" .*") 恰好命中"空格+尾通配"场景并转 ( .*)?；评论误读替换顺序，条件可达且语义正确。 |
| C176 | packages/core/src/util/wildcard.ts:13 | critical | bug | wontfix | packages/core 只在 Bun/Node 运行时（桌面主进程/服务器/CLI），无浏览器构建路径；浏览器端走 sdk HTTP。process 可用是包级运行时前提（同文件大量 os/path 导入同理）。 |
| H512 | packages/core/src/v1/config/command.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H516 | packages/core/src/v1/config/error.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C177 | packages/core/src/v1/config/layout.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H515 | packages/core/src/v1/config/lsp.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H519 | packages/core/src/v1/config/mcp.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H518 | packages/core/src/v1/config/migrate.ts:30 | high | bug | wontfix | isV1 是新旧配置格式判别启发式（config.ts 仅用于 decodeV1Info/decodeInfo 分支）：V2 Info 字段名不与键集冲突，误入 V1 分支也会因 decode 失败跳过、再走正常 decodeInfo，不损坏配置。 |
| C178 | packages/core/src/v1/config/permission.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H517 | packages/core/src/v1/config/permission.ts:8 | high | maintainability | wontfix | Shadowing 仅限该文件自身且文件内无 Object.* 静态调用（8-11 行为 Schema 组合），消费方一律经命名空间 Permission.Object 引用；改名属风格议题。 |
| H520 | packages/core/src/v1/config/provider-options.ts:98 | high | bug | wontfix | Gemini/Vertex REST 的 generationConfig 字段（thinkingConfig/responseModalities/mediaResolution/imageConfig）官方即 camelCase；snake() 只约束其他 provider 的字段，评论的"一致性"与 Google API 事实相反。 |
| C179 | packages/core/src/v1/config/provider-options.ts:119 | critical | security | fix | bedrock 的 direct(options) 未像 openai/vertex 剔除凭据：apiKey 留在 provider settings，且 request() 的 clone(options) 会把凭据塞进 additionalModelRequestFields 发往端点。修复：provider 分支 omit ["apiKey","baseURL"]，request clone 前剔除敏感键。 |
| H521 | packages/core/src/v1/config/provider.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H525 | packages/core/src/v1/config/server.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C183 | packages/core/src/v1/config/skills.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C184 | packages/core/src/v1/config/skills.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H522 | packages/core/src/v1/permission.ts:25 | high | bug | wontfix | ruleset 由权限系统从配置解码构造（Schema 通道数据、无环/函数成员），message getter 的 stringify 抛错路径不可达；getter 内补 try/catch 属防御噪音。 |
| H524 | packages/core/src/v1/session.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C181 | packages/core/src/v2-schema.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C180 | packages/core/src/workspace.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H523 | packages/core/test/fixture/effect-flock-worker.ts:21 | high | bug | wontfix | test fixture worker 的 argv 由本仓测试代码固定 JSON.stringify 传入，非外部输入；参数缺失时崩溃正是 fixture 期望的失败可见性。 |
| C182 | packages/core/test/fixture/flock-worker.ts:37 | critical | bug | wontfix | 38 行 writeFile 位于 try-finally（41 行起）之外：wx 冲突时函数直接 reject、根本不会进入 finally，不存在误删他进程 active 文件的路径；评论误读作用域。 |
| H576 | packages/llm/example/tutorial.ts:255 | high | bug | fix | tutorial.ts:230 末尾 Effect.runPromise(program) 无错误处理，示例被复制到生产代码会产生 unhandled rejection；改用 runPromiseExit 或补 .catch 展示惯用错误处理。 |
| H577 | packages/llm/script/recording-cost-report.ts:219 | high | bug | fix | recording-cost-report.ts:219 顶层 await fetch(MODELS_DEV_URL) 无错误处理且未检查 response.ok，网络失败时脚本以未处理拒绝崩溃；按 suggestion 思路包 try/catch 并输出友好错误。 |
| H579 | packages/llm/src/protocols/bedrock-event-stream.ts:41 | high | bug | wontfix | 误报：bedrock-event-stream.ts:34-37 中 totalLength=0 时 subarray(0,0) 为空帧，@smithy/eventstream-codec 对空帧必抛异常并被上方 Effect.try 转为类型化错误，offset 不推进的分支不可达，不存在死循环。 |
| H578 | packages/llm/src/protocols/bedrock-event-stream.ts:59 | high | bug | wontfix | 误报：bedrock-event-stream.ts:12 为 new TextDecoder()（未开 fatal），按 WHATWG 规范非法 UTF-8 字节序列只替换为 U+FFFD，decode 不抛 TypeError。 |
| H581 | packages/llm/src/protocols/shared.ts:165 | high | bug | wontfix | 误报：shared.ts:165 模式含 (?:[A-Za-z0-9+/]{4})* 重复组，无填充的 abcd 可匹配，且 [A-Za-z0-9+/]{3}= 分支可匹配 abc=；外层另有 length%4 校验（shared.ts:191），两条例证均不成立。 |
| H580 | packages/llm/src/protocols/utils/bedrock-media.ts:52 | high | bug | fix | bedrock-media.ts:51 name: part.filename ?? `document.${format}` 在同格式多文档缺文件名时产生重名，模型无法区分引用；缺文件名时用格式+序号生成唯一 name。 |
| H582 | packages/llm/src/providers/azure.ts:0 | high | bug | wontfix | 误报（line:0 未定位）：azure.ts:110-114 configuredRoute 的 endpoint.query 已展开 ...(input.apiVersion ? { "api-version": ... } : {}) 与 ...input.queryParams，apiVersion/queryParams 并未被忽略。 |
| C198 | packages/llm/src/providers/cloudflare.ts:48 | critical | bug | wontfix | 刻意设计：cloudflare.ts:48-54 三分支明确——仅传 apiKey 时网关透传 Authorization（无网关鉴权场景），双鉴权需显式传 gatewayApiKey；cloudflare.test.ts:98 的双鉴权用例也是两者都显式传入。 |
| H583 | packages/llm/src/route/auth.ts:138 | high | bug | wontfix | 误报：本仓 Effect 4.0.0-beta.83 中 ConfigError 是 class（effect/src/Config.ts:70 export class ConfigError），instanceof 判断有效；finding 按 Effect 3 联合类型语义误判。 |
| H584 | packages/llm/src/route/client.ts:232 | high | bug | wontfix | 刻意取舍：route/client.ts:235-239 的 eventError 第三参已携带原始 frame（ProviderShared.encodeJson(frame)），错误信息保留完整出错载荷；改用整个 schema 错误树会让流错误冗长。 |
| C199 | packages/llm/src/route/executor.ts:370 | critical | bug | wontfix | 误报：executor.ts:2-9 从 effect/unstable/http 导入 Headers；effect Headers.ts:724 CurrentRedactedNames 是带默认值的 Context.Reference（yield* 合法），executor.test.ts 的 provideService 只是覆盖默认值。 |
| H586 | packages/llm/src/route/transport/websocket.ts:52 | high | bug | wontfix | 误报：websocket.ts:51-56 readyState 检查与 Effect.callback 内的 addEventListener 在同一同步块执行，JS 单线程下 open/close 事件不会在检查与注册之间插入，无 TOCTOU。 |
| H587 | packages/llm/src/route/transport/websocket.ts:125 | high | bug | wontfix | 冲突既定设计：llm 包为服务端包（依赖 @effect/platform-node）；WebSocketExecutor.Service 是可替换接缝（client.ts:422 Effect.serviceOption），构造器强转 WebSocketConstructorWithHeaders 为 ws 类实现预留，浏览器场景由消费方自供实现。 |
| C200 | packages/llm/src/route/transport/websocket.ts:138 | critical | bug | wontfix | 误报：websocket.ts:253-255 frames 内以 Effect.acquireRelease(open, connection.close) 管理连接，中断/超时/作用域退出必定触发 cleanup（removeEventListener + Queue.shutdown + ws.close）。 |
| H585 | packages/llm/src/schema/errors.ts:122 | high | bug | defer | TransportReason.retryable=false（errors.ts:122-129）是逐类显式设计；改为可重试会改变 executor.ts:357-367 retryStatusFailures 的全局重试语义（网络错误是否重试是行为级设计变更），需维护者权衡后再动。 |
| H588 | packages/llm/src/tool.ts:174 | high | bug | wontfix | 已文档化的刻意设计：tool.ts make 的 dynamic 模式注释明确 Inputs are typed as unknown; the handler is responsible for any validation it needs，jsonSchema 仅经 _definition 广告给模型，不做运行时校验。 |
| H589 | packages/llm/test/continuation-scenarios.ts:83 | high | bug | wontfix | 不可达场景：continuation-scenarios.ts:4 toolContinuation=["tool-call","tool-result"] 常量成对使用，全部调用方（anthropic-messages.test.ts:305、openai-responses.test.ts:510）经此常量传 feature，单独 tool-result 不会出现，建议的校验是死代码。 |
| H590 | packages/llm/test/recorded-scenarios.ts:120 | high | bug | wontfix | 测试辅助的断言式缺陷：recorded-scenarios.ts:120 throw 是「工具循环超 10 步」必须响亮失败的用例保护，作为 defect 失败清晰可见；改 Effect.fail 需为所有调用方拓宽错误类型，无实际收益。 |
| H116 | packages/novel-store/package.json:10 | high | maintainability | wontfix | 误报前提：该包不发 npm（script/publish.ts 仅做 CLI/桌面发布，release.yml 只出桌面安装包），exports 指向 src TS 是全仓库惯例（schema/server/core/app/plugin 均如此），且 build:tsc 由包 AGENTS.md 'Build & Verify' 节明确记载为有意保留 |
| C060 | packages/novel-store/package.json:12 | critical | bug | wontfix | 误报前提：包不发布 npm，files:['dist'] 不影响 workspace:* 内消费；exports→./src/index.ts 与 schema/server 等包一致（packages/schema/package.json exports 同为 ./src），改动反而破坏 monorepo 直跑 TS 约定 |
| C061 | packages/novel-store/package.json:15 | critical | bug | wontfix | #driver conditional imports 是 novel-store AGENTS.md 明确记载的跨平台驱动选择机制（'The SQLite driver is selected through the #driver import'），仅 workspace 内消费，premise（npm 发布后缺失文件）不成立 |
| C202 | packages/novel-store/src/approval.ts:54 | critical | bug | fix | 用 db.transaction 同步回调包裹 select+update（参照 packages/novel-store/src/index.ts:2083 promoteWorldMapDraft 的 check-then-act 事务模式），消除审批并发交错窗口 |
| C201 | packages/novel-store/src/driver.bun.ts:12 | critical | bug | fix | init 失败路径用 try/finally 关闭 sqlite 连接（同包 mode.ts writeNovelConfig 的 IO 资源清理先例）；不做建议中的 BEGIN/COMMIT 包装——migrate.ts:46 内部已自行 BEGIN/COMMIT，外层再包事务会直接冲突 |
| H591 | packages/novel-store/src/driver.node.ts:13 | high | bug | fix | 同 C201：DatabaseSync 在 init 失败时泄漏，补 try/finally 关闭连接即可；错误向上传播本身符合本层设计，不需吞错加上下文 |
| H594 | packages/novel-store/src/entity-refs.ts:28 | high | bug | wontfix | delete-then-insert 的原子性问题已由 C203 覆盖（同一文件同一代码块）；追加 try-catch 包错误与 AGENTS.md 'Avoid try/catch where possible' 约定冲突，novel-store 数据层一贯让 drizzle 错误直接向上传播（如 approval.ts:51 throw 未找到章节） |
| C203 | packages/novel-store/src/entity-refs.ts:36 | critical | bug | fix | 真实数据丢失风险：delete 后任一 insert 失败则旧引用全部丢失；将 delete+inserts 包进 db.transaction 同步回调（index.ts:2083 既有模式），失败整体回滚 |
| H592 | packages/novel-store/src/manual-edit-sync.ts:56 | high | bug | fix | 将 enqueueManualEditSync 的 select→update→insert 包进 db.transaction 同步回调（bun-sqlite 驱动同步，回调内可全程无 await），消除并发入队时去重判定失效的窗口 |
| H593 | packages/novel-store/src/manual-edit-sync.ts:200 | high | bug | fix | 注释（manual-edit-sync.ts:200-206）声称'异常时先恢复旧值的补偿模式'但实现无任何补偿逻辑，且声称'Drizzle 的 Bun 驱动不支持事务包装'与 index.ts:2083 的 db.transaction 实际用法矛盾；应改用真实事务或把注释改写成与实际 best-effort 行为一致 |
| H598 | packages/novel-store/src/migrate.ts:58 | high | bug | fix | migrate.ts:59-63 回滚失败的 catch 为空，注释自称'保留现场便于排查'却无任何记录；在 catch 内补 console.error 记录 rollbackError（与 64/436 行既有 console.warn 风格一致），实现注释承诺的可排查性 |
| H597 | packages/novel-store/src/migrate.ts:425 | high | bug | wontfix | 刻意设计：425-443 行注释明确'单表搬移失败不阻塞 DB 打开，下次打开按幂等规则重试'，非阻塞幂等迁移是本文件贯穿哲学；且 SQLite 不允许在事务内切换 foreign_keys pragma（事务中该 pragma 为 no-op），建议的事务包装技术上不适用，孤儿行清理紧随其后（445-458 行） |
| C204 | packages/novel-store/src/migrate.ts:634 | critical | security | wontfix | 误报：migrate.ts:634-636 的单引号翻倍转义正是 SQLite 字符串字面量的标准且充分转义（SQLite 字符串无反斜杠转义陷阱，'' 即唯一转义），被转义值无法突破字面量；数据源自本地库自身写入（本迁移每次建连对 evidence 回填），参数化还需改动整个 ExecFn 字符串签名抽象 |
| H595 | packages/novel-store/src/mode.ts:116 | high | bug | wontfix | 文档化设计：mode.ts:12-15 错误策略与 108-110 行函数注释明确'任何 IO 错都降级为 warn + 返回 fallback 配置，不抛错'，返回生效配置即承诺语义；改成 result 对象将破坏 plugin/server/CLI 三处共享调用方 |
| H596 | packages/novel-store/src/mode.ts:145 | high | bug | wontfix | 同 H595：写入失败返回 next（生效配置）是 mode.ts:13-14 与 108-110 明确记载的设计，告警经 stderr 给用户；返回'未生效'反而需要契约级返回类型变更 |
| C205 | packages/novel-store/src/upgrade.ts:201 | critical | bug | wontfix | 刻意设计：upgrade.ts:195-199 注释声明'四步全部幂等'，任一步失败后可由 listPendingUpgradeTasks 的 appliesTo 检测重新触发恢复；且本包驱动为同步事务回调（index.ts:2083 同步用法），无法跨越 await 包住 runDeterministicUpgrade 的 async 流程，建议的事务包装不适用 |
| H599 | packages/novel-store/src/upgrade.ts:277 | high | bug | fix | novel_id 是 upgrade_state 主键（index.ts 表定义 text().notNull().primaryKey()），并发 read-then-insert 虽不会产生重复行但会把 PRIMARY KEY 约束错误抛给调用方；改 insert...onConflictDoUpdate({target: novel_id}) 原子 upsert |
| H117 | packages/opennovel/package.json:9 | high | bug | wontfix | 同 H112：tsgo 由根 package.json 的 @typescript/native-preview（catalog）提供并提升进根 node_modules/.bin，包目录 bun run 可解析；"未声明依赖"前提不成立。 |
| H604 | packages/opennovel/script/bench-test-suite.ts:23 | high | bug | wontfix | bench 开发脚本自身由 bun 执行（bun 必存在），spawn 抛错直接可见堆栈即开发工具预期行为；包裹 try-catch 属噪音。 |
| H601 | packages/opennovel/script/build-node.ts:13 | high | bug | wontfix | 构建脚本顶层 await 导入失败会以非零码崩溃并打印堆栈，正是 CI 需要的失败可见性；补消息外壳无增益。 |
| C207 | packages/opennovel/script/build-node.ts:15 | critical | bug | fix | Bun.build 失败不 throw 而是返回 {success:false}：build-node.ts:15 未检查即打日志"完成"，坏产物静默通过。修复：检查 result.success，失败打印 logs 并 process.exit(1)。 |
| H600 | packages/opennovel/script/build.ts:14 | high | bug | wontfix | 同 H601：build.ts 顶层 import 失败即崩溃可见，无需外壳错误处理。 |
| C206 | packages/opennovel/script/build.ts:162 | critical | bug | fix | 同 C207：build.ts:162 主构建调用未检查 Bun.build 返回的 success，失败会带病进入冒烟测试与打包。修复：检查 success 并输出 logs 后 exit(1)。 |
| H603 | packages/opennovel/script/generate.ts:8 | high | maintainability | wontfix | 构建脚本以顶层 process.chdir 钉目录是全仓统一写法（build.ts:12、build-node.ts:11 同型），此类脚本仅作为独立构建入口执行，不存在被测试/消费者复用导致 cwd 漂移的调用面。 |
| H602 | packages/opennovel/script/httpapi-exercise.ts:1 | high | bug | wontfix | 该文件是 2 行入口垫片（转发 import 测试目录 index），失败即崩溃可见；同 H601 惯例。 |
| H124 | packages/opennovel/script/postinstall.mjs:172 | high | bug | fix | 169-174：catch 内 installPackage 若抛错会直接冲出 main()，跳过后补选候选包，违背循环回退设计。修复：installPackage/verifyBinary 分支也套 try，失败继续下一候选，最后统一抛聚合错误。 |
| H605 | packages/opennovel/script/profile-test-files.ts:14 | high | bug | wontfix | 同 H604：profile 开发脚本由 bun 运行，spawn 失败堆栈可见即预期。 |
| H608 | packages/opennovel/script/publish.ts:0 | high | security | wontfix | publish.ts 全文无 GITHUB_TOKEN 或嵌入 token 的 URL（grep 仅见 ssh:// AUR 克隆与公开 releases 下载地址）；评论指认的事实不存在。 |
| H609 | packages/opennovel/script/publish.ts:128 | high | bug | fix | AUR 重试循环 `catch { continue }` 耗尽 30 次后无告警继续走完发布流程（138-141），发布失败静默。修复：循环耗尽未成功时 throw 最后一个错误。 |
| H611 | packages/opennovel/script/schema.ts:67 | high | bug | wontfix | schema.ts 是仓库内部 codegen 脚本、调用点固定传参；缺参时 Bun.write 的报错足以定位（开发脚本自身用法错误）。 |
| C208 | packages/opennovel/script/time.ts:4 | critical | security | wontfix | time.ts 是 7 行本地计时垫片，"import 任意模块"正是其用途（操作者自己传参），按信任模型等同直接运行 node <file>；不构成注入面。 |
| H606 | packages/opennovel/specs/v2/api.ts:1 | high | maintainability | wontfix | specs/v2/api.ts 为规格示例代码（@ts-nocheck 即"不参与类型检查的说明样例"标记，无 CI 入口），示例代码不因产品缺陷口径处理。 |
| H607 | packages/opennovel/specs/v2/api.ts:41 | high | bug | wontfix | 同 H606：specs/v2 示例脚本演示 SDK 用法，错误处理在示例中省略是文档惯例。 |
| H610 | packages/opennovel/src/account/repo.ts:46 | high | bug | wontfix | DB 行由本层自写自读，decodeUnknownSync 是全仓同层统一用法（credential.ts:54、event.ts 同型）；解码失败即数据损坏，defect 大声失败优于静默降级。 |
| C209 | packages/opennovel/src/account/repo.ts:59 | critical | bug | fix | state() 固定使用外层 db（59-66），从 persistAccount 事务内调用时更新逃逸事务边界，回滚路径会留下已提交的状态半态。修复：state 接受 tx 形参（同 current/persistAccount 的 db/tx 双通道写法）。 |
| H614 | packages/opennovel/src/account/url.ts:2 | high | bug | fix | normalizeServerUrl 对非法 URL 裸抛 TypeError，用户手输服务地址的登录路径会崩溃而非得到校验错误。修复：解析失败返回 undefined，调用处提示"URL 非法"。 |
| H612 | packages/opennovel/src/acp/config-option.ts:199 | high | bug | wontfix | 函数无显式返回注解（199 行），variants[0] 空数组的 undefined 会进入推断类型并在调用侧显式处理；"隐式声明 returns string"与实际代码不符。 |
| H613 | packages/opennovel/src/acp/event.ts:125 | high | maintainability | fix | ACP 事件泵 catch(()=>{}) 全量吞掉 handle 错误（125），故障无法诊断。修复：catch 分支记录错误（保留流继续循环的行为）。 |
| H616 | packages/opennovel/src/acp/permission.ts:99 | high | security | wontfix | metadata.filepath 由本仓服务端工具事件产生（内部生产者、非客户端可注入面），writeTextFile 走 ACP 客户端协议做编辑器暂存，边界由客户端会话管理。 |
| H615 | packages/opennovel/src/acp/permission.ts:110 | high | bug | fix | void writeTextFile 丢弃 promise：用户批准编辑后写入失败完全静默（110-114），呈现成功假象。修复：await 并在失败时记录错误日志（函数已是 async）。 |
| H619 | packages/opennovel/src/acp/profile.ts:1 | high | bug | wontfix | opennovel 包只在 Bun/Node 运行（同 C176 口径），profile 垫片不会在浏览器侧被 import；模块顶层 process.env 是包级运行时前提。 |
| H618 | packages/opennovel/src/acp/session.ts:153 | high | bug | wontfix | recordPartMetadata 的返回对象在 acp 目录内全部只读消费（grep 无 mutation 站点），"调用方改写"是假想场景；防御性复制属加固。 |
| H617 | packages/opennovel/src/acp/session.ts:219 | high | bug | wontfix | snapshot 语义防的是集合增删重排，knownParts 值对象在仓内消费者只读（同 H618），单线程事件循环无并发写；深拷贝属加固非缺陷。 |
| H623 | packages/opennovel/src/agent/agent.ts:419 | high | bug | wontfix | oauth 分支系统提示经 providerOptions.instructions 传递是 Codex 端点协议要求（非 oauth 才用 messages 内 system），两分支各有明确通道；评论把协议差异当成缺失。 |
| C210 | packages/opennovel/src/agent/subagent-permissions.ts:18 | critical | bug | fix | canTask/canTodo 只判 rule.permission 存在、不看 action：子代理仅有 {task,deny} 规则时判定为"允许"，且该 deny 规则未进入派生 ruleset，子代理权限反而放开。修复：some 条件加 rule.action !== "deny"，deny-only 视作不允许。 |
| H620 | packages/opennovel/src/auth/index.ts:73 | high | bug | fix | auth set/remove 为读-改-写双 await 无互斥，并发登录/登出交错会丢写。修复：以进程内 Effect Semaphore（或复用仓内 Flock）串行化 set/remove。 |
| H621 | packages/opennovel/src/cli/cmd/agent.ts:71 | high | maintainability | wontfix | CLI 适配层用 Effect.promise 包本地交互流程是本仓 cli/cmd 通用写法（attach/export 等同型），改全 Effect 是重构规模；无错误逃逸面（内部已 catch）。 |
| H624 | packages/opennovel/src/cli/cmd/attach.ts:7 | high | maintainability | wontfix | attach 是占位命令：handler 显式提示未实现，保留参数形状是接口预留（删除会让用户收到"unknown command"更差）；非缺陷。 |
| H622 | packages/opennovel/src/cli/cmd/db.ts:38 | high | bug | fix | spawn sqlite3 只挂 close 不挂 error：未安装 sqlite3 时 EventEmitter 的 error 无人接会抛未捕获异常。修复：child.on("error", reject)，错误经 CliError 呈现。 |
| C211 | packages/opennovel/src/cli/cmd/debug/agent.handler.ts:105 | critical | security | wontfix | new Function 仅解析操作者自己在命令行输入的 --params JS 字面量（调试便利、20 行 description 明示），argv 属本人输入，等价于直接执行代码；无外部不可信输入面。 |
| C212 | packages/opennovel/src/cli/cmd/debug/agent.ts:18 | critical | security | wontfix | 同 C211：选项文案与解析行为一致（接受 JS 字面量是有意文档化的 dev 便利），信任边界为操作者自身。 |
| H628 | packages/opennovel/src/cli/cmd/debug/config.ts:12 | high | security | fix | debug config 把解析后配置原样打 stdout，其中可含 provider apiKey/oauth clientSecret/mcp environment；写日志或贴 issue 即泄漏。修复：仿 export.ts 的 redact 先例对敏感键脱敏后输出。 |
| H625 | packages/opennovel/src/cli/cmd/debug/scrap.ts:8 | high | bug | wontfix | debug scrap 为开发者诊断命令，失败以堆栈呈现即预期可见性；补 try-catch 外壳无行为收益。 |
| C213 | packages/opennovel/src/cli/cmd/debug/v2.ts:18 | critical | bug | fix | debug v2 的 default 字段漏 yield*（20 行把 Effect 对象塞进 result），JSON.stringify 输出内部结构垃圾、调试信息错误。修复：yield* 后再入对象。 |
| H626 | packages/opennovel/src/cli/cmd/debug/v2.ts:31 | high | maintainability | wontfix | debug v2 无 provide 错误通道：CLI 顶层会把错误打印退出（可见失败），"更友好文案"属口味；服务查询失败对 debug 命令就该直接报错。 |
| H627 | packages/opennovel/src/cli/cmd/export.ts:93 | high | maintainability | wontfix | 4 层三元是导出序列化的数据形状映射（分支皆纯对象字面量），与仓库"复杂校验分支拆 helper"准则的适用场景不同；可读性口味调整非缺陷。 |
| C214 | packages/opennovel/src/cli/cmd/generate.ts:20 | critical | bug | fix | 生成代码示例字符串缺收尾双引号（21 行 `"@opennovel-ai/sdk`），产出的 x-codeSamples 是语法错误 JS。修复：补全引号。 |
| C215 | packages/opennovel/src/cli/cmd/github.handler.ts:387 | critical | bug | fix | isMock = token // event：仅传 token 未传 event 时对 undefined 做 JSON.parse 直接崩溃（389 行 `args.event!`）。修复：isMock && args.event ? JSON.parse(args.event) : github.context。 |
| H629 | packages/opennovel/src/cli/cmd/github.handler.ts:631 | high | security | fix | github action 把 e.message/子进程 stderr 原文贴进公开 PR 评论（636 行 msg=e.stderr），命令行参数与路径可能含凭据。修复：评论仅呈现通用失败文案+运行日志链接，细节保留在 console.error（633 行已有）。 |
| H633 | packages/opennovel/src/cli/cmd/import.ts:143 | high | bug | fix | 分享导入对远端 response.json() 裸 cast 为 ShareData[]，后续 transform 对畸形结构无兜底即远端爆错。修复：Schema 解码（onExcessProperty ignore），失败按 138-140 的友好提示路径走。 |
| H632 | packages/opennovel/src/cli/cmd/import.ts:199 | high | maintainability | fix | `data: msgData as never` 静默绕过列类型（199 行），导入的旧消息形状与 MessageTable.data 契约脱钩后无编译期防线。修复：写入前经 SessionMessage 数据 Schema 解码校验替换 as never。 |
| H630 | packages/opennovel/src/cli/cmd/models.ts:36 | high | bug | wontfix | 误报（已核实）：models.ts:51 已有 `if (!providers[providerID]) return yield* fail(...)` 前置守卫（git blame 指向初始提交 49b2add2），print 另一处调用遍历 Object.keys(providers) 恒命中，不存在 p.models 崩溃路径。 原判定理由：print(providerID) 在 providers 表中取不存在的 id 时 p.models 抛 TypeError（37-38 行），用户传错 provider 名即裸崩溃。修复：p 未命中输出"未知 provider"错误并返回。 |
| H631 | packages/opennovel/src/cli/cmd/novel.ts:89 | high | security | defer | novel 服务器无密码仅提示：默认绑定 localhost，但 bind 0.0.0.0 场景确实裸奔；改为拒绝启动/强制 --insecure 属 CLI 行为契约变化（现有自动化依赖无密码本地用法），归安全增强 change。 |
| H635 | packages/opennovel/src/cli/cmd/pr.ts:54 | high | bug | wontfix | 仅当 gh 退出码 0 且输出非空才 parse（54 行守卫），gh --json 契约保证合法 JSON；"gh 崩了但返回 0"不可达，CLI 抛错即可见失败。 |
| H634 | packages/opennovel/src/cli/cmd/serve.ts:15 | high | security | defer | 同 H631：serve 无密码硬失败化改变既有启动语义，涉及用户部署方式决策，归后续安全 change。 |
| H636 | packages/opennovel/src/cli/cmd/stats.ts:117 | high | bug | wontfix | CLI 命令生成器内同步 throw 进入 die 通道、顶层 runner 可见呈现（同 C169 家族）；逐处改 Effect.fail 是错误模型重构非缺陷。 |
| H638 | packages/opennovel/src/cli/cmd/uninstall.ts:299 | high | bug | wontfix | 清除仅命中引用 ~/.opennovel/bin 的 PATH 行，该行归属无歧义（我们的安装目录），无 marker 也删除正是卸载清理目的；不会动用户其他 PATH 行。 |
| H637 | packages/opennovel/src/cli/cmd/web.ts:40 | high | security | defer | 同 H631/H634：无密码+0.0.0.0 改为拒绝启动属 CLI 行为契约变化，归安全增强 change。 |
| H640 | packages/opennovel/src/cli/effect-cmd.ts:90 | high | bug | fix | finally 中 store.dispose 抛错会顶掉 handler 原始错误。修复：dispose 失败仅记日志、保留原异常（或用 Effect 资源管理让双错误并存）。 |
| H641 | packages/opennovel/src/cli/heap.ts:32 | high | bug | fix | heap 快照 .catch(()=>{}) 使权限/磁盘失败完全静默。修复：catch 分支 console.error 输出失败原因（保留尽力而为语义）。 |
| H639 | packages/opennovel/src/cli/network.ts:41 | high | bug | wontfix | 误报（已核实）：`--port 8080` 双段形式里 `--port` 本身就是独立 argv token，`arg === name` 直接命中（实验输出 hasArg(--port)=true），且 cli 目录无任何 alias 定义，前提不成立。 原判定理由：hasArg 只认 `--port=N` 与裸旗，不认 `--port 8080` 双段形式，显式旗标可能被误判为未提供而让 env/config 覆盖。修复：判定改用 yargs 解析结果与默认值比对（或补双段扫描）。 |
| H643 | packages/opennovel/src/cli/ui.ts:47 | high | bug | fix | logo() 的 TTY 分支两侧代码完全相同（死逻辑）。修复：确认无隐藏差异后合并为单一路径；如原意是 ANSI 降级需补差异化，二选一都需动此处。 |
| H644 | packages/opennovel/src/cli/ui.ts:74 | high | bug | fix | readline 仅在收到 answer 时 resolve：stdin 提前关闭/出错时 Promise 永挂（调用方卡死）。修复：挂 rl.on("close") 无答案时 resolve("") 或 reject。 |
| H645 | packages/opennovel/src/command/index.ts:123 | high | bug | wontfix | `template?.messages.map(...)` 可选链短路整条链（template 为 null 时表达式 undefined，不抛 TypeError）；getPrompt 返回类型保证 messages 存在；评论误读 ?. 语义。 |
| H642 | packages/opennovel/src/config/agent.ts:50 | high | maintainability | wontfix | 目录扫描式加载默认跳过畸形条目是全仓惯例（51 行 md 解析 .catch 跳过、external.ts 插件 ignoreCause 同族），严格报错只用于显式单文件 load；两口径语义清晰非不一致。 |
| H647 | packages/opennovel/src/config/config.ts:425 | high | bug | fix | 425 行 `dir.endsWith(".opennovel") // dir.endsWith(".opennovel")` 复制粘贴重复条件（第二项永假的死条件）。修复：去重；行为不变。 |
| H646 | packages/opennovel/src/config/managed.ts:35 | high | bug | fix | parseManagedPlist 对 plutil 外部输出裸 JSON.parse：空串/畸形（MDM 配置异常）时抛 SyntaxError 崩启动。修复：try-catch 返回 null 并告警（调用处已有 null 分支语义）。 |
| H648 | packages/opennovel/src/config/parse.ts:74 | high | bug | wontfix | topLevelExtraKeys 对 wrapped schema 只是跳过"额外键提示"（保守方向，不会误报也不会漏校验——decode 本身照常执行）；解包 refinement/brand 属增强。 |
| H650 | packages/opennovel/src/config/plugin.ts:56 | high | bug | fix | resolvePathPluginTarget 的显式错误（目录缺 package.json）被 .catch(()=>file) 吞掉后以裸路径进入 import，报错错位难懂。修复：catch 分支记 warn 再回退（同 external.ts 的告警口径）。 |
| H649 | packages/opennovel/src/control-plane/adapters/index.ts:9 | high | maintainability | wontfix | adapters 注册表规模=本地项目数（有界）、与进程同生命周期，不存在随会话增长的泄漏面；unregister API 属扩展（项目删除路径本身也无其他清理需求）。 |
| H652 | packages/opennovel/src/control-plane/adapters/worktree.ts:45 | high | bug | wontfix | worktree 适配器错误沿 control-plane 通道呈现给 UI（上层统一负责文案），就地 try-catch 重抛只会丢堆栈与类型。 |
| C216 | packages/opennovel/src/control-plane/dev/debug-workspace-plugin.ts:27 | critical | bug | wontfix | dev/debug 专用插件的 PORT! 依赖插件生命周期顺序（create 先于 target，无乱序调用面），且该文件仅在调试路径装载；断言风险面不超出调试夹具。 |
| H651 | packages/opennovel/src/control-plane/dev/debug-workspace-plugin.ts:54 | high | bug | wontfix | 随机端口属 dev 调试夹具的失败可见路径（超时后报错可见），listen(0) 探测属体验增强；不进生产路径。 |
| H653 | packages/opennovel/src/control-plane/util.ts:8 | high | bug | wontfix | Effect.async 的 resume 幂等（首次生效后续忽略），多触发器并发 resume 不会双完成；各路径已显式 cleanup。 |
| C217 | packages/opennovel/src/control-plane/util.ts:24 | critical | bug | wontfix | cleanup 双跑（显式+finalizer）中的 clearTimeout/off/removeEventListener 均为幂等操作，无副作用面；"double cleanup"不构成缺陷。 |
| H655 | packages/opennovel/src/control-plane/workspace.ts:587 | high | bug | fix | warp 序中 events.claim 先于 patch 应用/事件回放无条件执行，后两者失败时会话所有权已迁移而内容未迁（半态）。修复：claim 移到 patch+replay 成功后，或失败路径回滚 claim；实现批次细读 warp 全流程再落刀。 |
| H658 | packages/opennovel/src/effect/bridge.ts:68 | high | bug | fix | bridge.run 的 runPromiseExit 内层 fiber 不随外层中断，中断后内层继续跑（资源泄漏/写后生效）。修复：改用 forkIn 或在外层 interrupt 回调里 fiber 中断。 |
| H654 | packages/opennovel/src/effect/instance-registry.ts:10 | high | bug | fix | disposers 集合执行后不清空：二次 disposeInstance 会对同一批 disposer 重跑（双清理/报错）。修复：快照后 delete 已执行项（clear 全集或逐项移除）。 |
| H665 | packages/opennovel/src/effect/instance-state.ts:38 | high | bug | wontfix | ScopedCache.invalidate 错误通道为 never（等待纤维结算后不 reject），runPromise 无拒绝面，"unhandled rejection"前提不成立。 |
| H666 | packages/opennovel/src/effect/instance-state.ts:38 | high | bug | wontfix | disposeInstance 以 Promise.allSettled 等全部 disposer 完结，Scope finalizer 的 off 只注销后续再入；不存在未完成 runPromise 与 finalizer 竞速的双路径。 |
| H656 | packages/opennovel/src/effect/run-service.ts:28 | high | bug | fix | Context.getReferenceUnsafe 在 fiber 存在但 InstanceRef 未提供时抛裸异常（run-service 可能被无实例 fiber 触达）。修复：改 Context.getReference 取 Option 或提供缺省值。 |
| H657 | packages/opennovel/src/effect/run-service.ts:34 | high | bug | wontfix | 同 H413：memoMap 下 ManagedRuntime 为进程级单例复用，重复 make 不复制资源（memoMap 语义），无泄漏面。 |
| H660 | packages/opennovel/src/effect/runner.ts:83 | high | bug | fix | startRun 用 forkIn(scope)、startShell 用 forkChild，生命周期语义不一致（shell fiber 随父中断/逃逸行为与 run 不同），违背 Runner 自持生命周期的设计意图。修复：统一到 forkIn(scope) 并复核中断语义。 |
| H661 | packages/opennovel/src/effect/runner.ts:108 | high | bug | fix | stopShell 无条件 await shell.ready：work 异常/卡死从未打开 latch 时停止流程永挂。修复：ready 等待加超时（cancelled 置位后即可推进）。 |
| H659 | packages/opennovel/src/env/index.ts:26 | high | bug | wontfix | JS 单线程：env set/delete 各自同步段原子完成，fiber 间不存在数据撕裂；"dual mutation"需要 await 间隙的读-改-写才有危害，env 写入均单行同步。 |
| C218 | packages/opennovel/src/event-manifest.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H662 | packages/opennovel/src/format/formatter.ts:74 | high | bug | fix | formatter 检测对 glob 命中的 package.json 直接 readJson，畸形 JSON 令检测路径抛未处理拒绝。修复：catch 后按"未识别"返回 false。 |
| H663 | packages/opennovel/src/format/formatter.ts:198 | high | bug | fix | 同 H662：readText 配置文件失败应视作探测失败，不该裸抛。修复：各 readText 调用加 catch 返回未命中。 |
| H664 | packages/opennovel/src/format/formatter.ts:225 | high | bug | wontfix | Process.text({nothrow:true}) 契约恒返回 { text: string, code }（stdout 缺省空串），text 无 undefined 分支，.split 不会 TypeError。 |
| C219 | packages/opennovel/src/id/id.ts:54 | critical | bug | fix | id.ts 计数器同毫秒无上限：>4096/ms 时 counter 溢出污染时间戳低位编码，破坏唯一性与有序性。修复：溢出即时间戳 +1（standard monotonic generator 做法）。 |
| H667 | packages/opennovel/src/id/id.ts:72 | high | bug | wontfix | 同 H432：timestamp() 文档注释已限定仅适用于 ascending ID，调用方均为内部升序 ID；补运行时校验是防御扩展。 |
| C221 | packages/opennovel/src/image/image.ts:126 | critical | bug | fix | image.ts:126 resized 原生对象在 get_bytes 抛错路径不 free（136 行 free 不在 finally），WASM 内存泄漏。修复：try/finally 包裹 free（photon.ts 已是正确先例）。 |
| H670 | packages/opennovel/src/index.ts:37 | high | bug | fix | index.ts:37 同一 `startsWith("opennovel ")` 判断写两遍（复制粘贴死条件）。修复：去重（行为不变）；如需大小写双判需产品确认再改。 |
| C220 | packages/opennovel/src/installation/index.ts:145 | critical | security | defer | 安装脚本从本仓 GitHub 发行物 HTTPS 直下执行属既有自更新信任模型；引入校验和/签名验证是发布供应链流程决策（需版本工件同步分发校验值），超出缺陷修复范围，归 release 安全 change。 |
| H668 | packages/opennovel/src/installation/index.ts:216 | high | bug | fix | brew API 返回 formulae 空数组时 info.formulae[0].versions 裸 TypeError。修复：判空后抛可读错误（与网络失败路径同形态）。 |
| H669 | packages/opennovel/src/installation/index.ts:245 | high | bug | fix | 同 H668：Chocolatey API results 空数组越界。修复：判空报错。 |
| H673 | packages/opennovel/src/lsp/lsp.ts:244 | high | bug | wontfix | 244-250 的 existing 复查在 await spawn 之后执行且命中即 stop 新实例返回旧引用，双创建被显式消化；调用方 get→set 也同处同步段，无扩大竞态窗口。 |
| H672 | packages/opennovel/src/lsp/lsp.ts:267 | high | bug | wontfix | 调用点 `s.spawning.get(...)→const task = schedule(...)→s.spawning.set(...)` 之间无 await 挂起点（267-272），单线程下检查与登记原子；并发方从 inflight 合流。 |
| H675 | packages/opennovel/src/lsp/server.ts:183 | high | security | defer | LSP 二进制下载的校验/签名验证与 C220 同属发布供应链议题（需上游 release 提供稳定校验物），不在缺陷清扫范围。 |
| H676 | packages/opennovel/src/mcp/auth.ts:67 | high | bug | fix | mcp/auth decode 失败返回 None 后写入空对象，静默清空全部存储凭据且无日志。修复：解码失败记警告并先把原文件改名备份再覆盖。 |
| C223 | packages/opennovel/src/mcp/browser.ts:19 | critical | bug | wontfix | Effect.callback 的 resume 幂等（仅首次生效，后续忽略），不违反单次契约；500ms 定时器与事件竞争本就取先到者。 |
| C222 | packages/opennovel/src/mcp/catalog.ts:26 | critical | bug | wontfix | 循环体内 `const page` 遮蔽对 header 的计数器无影响（条件/自增在外层作用域求值，体内只引用结果对象），行为正确；改名属可读性建议。 |
| H671 | packages/opennovel/src/mcp/catalog.ts:43 | high | bug | fix | convertTool 无条件覆盖 additionalProperties:false，破坏声明允许动态属性的合法 MCP 工具 schema（调用被本地校验拒掉）。修复：原 schema 显式给出 additionalProperties 时保留其值。 |
| H677 | packages/opennovel/src/mcp/index.ts:109 | high | bug | fix | 模块级 Map 对同一 server 的重复 startAuth 会覆盖在途流程（state 丢失、PKCE verifier 泄漏悬挂）。修复：startAuth 入口检测已存在键即复用或显式拒绝重启。 |
| H678 | packages/opennovel/src/mcp/index.ts:898 | high | bug | fix | browser.open 失败或用户未完成授权时 callbackPromise 永挂、pendingOAuthTransports 条目不清理。修复：为等待回调加超时+失败路径统一移除 transport/state 条目。 |
| H679 | packages/opennovel/src/mcp/index.ts:901 | high | bug | fix | 与 H678 同段：捕获 open 失败只发事件仍继续 await 永不兑现的 callback。修复：失败即终止该 OAuth 流程（reject/清理）。 |
| H674 | packages/opennovel/src/mcp/oauth-callback.ts:133 | high | bug | fix | waitForCallback 以 mcpName 覆盖映射，旧 oauthState 在 pendingAuths 中孤儿化（仅超时可回收、无法取消）。修复：登记新映射前先回收同 mcpName 的旧状态。 |
| C224 | packages/opennovel/src/novel/manual-edit-sync-worker.ts:0 | critical | bug | fix | manual-edit-sync-worker 的摘要 upsert、pending 插入、spine 更新、状态回写多步无事务，中途失败留下半同步状态。修复：用 db.transaction 同步回调包裹（仓库 check-then-act 事务先例 promoteWorldMapDraft）。 |
| H680 | packages/opennovel/src/plugin/cloudflare.ts:71 | high | bug | wontfix | model.api/api.id/capabilities 均为必填类型形状（tsgo 通过即保证，同 H455 论证），可选链建议针对的 undefined 分支不存在。 |
| C225 | packages/opennovel/src/plugin/digitalocean.ts:37 | critical | bug | fix | 模块级单一 pendingOAuth：并发授权时后者覆盖前者 callback（首个流程拿到错误 promise、CSRF 校验错位）。修复：以 state 参数为键的 Map 管理并发流程。 |
| H683 | packages/opennovel/src/plugin/digitalocean.ts:62 | high | bug | fix | 1456 端口占用时 listen 的 rejection 无人接（authorize 只 catch 了 open），呈现未处理拒绝。修复：listen 错误捕获后报明确"端口占用"或换端口重试。 |
| H682 | packages/opennovel/src/plugin/github-copilot/copilot.ts:262 | high | bug | fix | copilot 轮询 while(true) 仅凭 authorization_pending 续轮、无最长时限。修复：按响应 expires_in/10 分钟上限设 deadline，超时 fail。 |
| H681 | packages/opennovel/src/plugin/github-copilot/copilot.ts:287 | high | bug | fix | expires:0 使 connection.resolve 的 `expires > now+5min` 恒 false，每次取连接都强制刷新令牌（多余网络与失败面）。修复：从响应 expires_in 推导真实过期或写入远期哨兵。 |
| H685 | packages/opennovel/src/plugin/github-copilot/models.ts:213 | high | bug | wontfix | models get 的 fetch/decode 失败沿插件加载边界统一处理（external ignoreCause，H376 修复后带日志），就地 try-catch 重复且吞类型。 |
| H684 | packages/opennovel/src/plugin/index.ts:274 | high | bug | fix | `void hook(...)` 丢弃 promise：插件事件钩子异常静默。修复：`.catch((cause) => Effect.logWarning/err)`（保留不阻塞语义）。 |
| H686 | packages/opennovel/src/plugin/loader.ts:187 | high | bug | wontfix | R 泛型默认 Loaded，无 finisher 的调用点全部以默认参数出现；`as R` 是注释明示的类型出口，无现实错配路径。 |
| H687 | packages/opennovel/src/plugin/openai/codex.ts:152 | high | bug | fix | 同 C225：codex.ts 全局 pendingOAuth 并发覆盖。修复：state 键控 Map。 |
| H689 | packages/opennovel/src/plugin/openai/codex.ts:219 | high | bug | fix | startOAuthServer 出错后 oauthServer 引用残留，后续调用误判"已在运行"。修复：server error 事件里清引用并允许重启。 |
| H688 | packages/opennovel/src/plugin/openai/codex.ts:238 | high | bug | fix | OAuth 超时清 pendingOAuth 但不 reject 等待方 promise、不 stop server：流程永挂且端口泄漏。修复：超时路径同时 reject 与 stopOAuthServer。 |
| H690 | packages/opennovel/src/plugin/openai/ws-pool.ts:78 | high | bug | wontfix | `if (entry.busy)` 与 `entry.busy = true` 间无 await（同步段原子），并发请求不可能双双通过检查；评论把 JS 当共享内存模型。 |
| C227 | packages/opennovel/src/plugin/openai/ws.ts:181 | critical | bug | fix | socket.on("message", async fn)：处理器内异常成 unhandledRejection（Node 默认崩溃），且错误无处上报。修复：处理器体套 Effect.runPromise + catch 记录并走错误通道。 |
| C228 | packages/opennovel/src/plugin/openai/ws.ts:198 | critical | bug | fix | await onRetryableTerminal 期间旧 socket 事件竞态（cleanupSocket 后仍有在途 handler 引用旧连接状态）。修复：socket 世代令牌（generation guard），handler 检查后丢弃陈旧事件。 |
| H694 | packages/opennovel/src/plugin/openai/ws.ts:208 | high | bug | fix | onRetryableTerminal 返回 undefined 且 completed=false 时函数直接返回：流既不报错也不产出，消费端永等。修复：该分支显式 invalidate/推错误终止流。 |
| H695 | packages/opennovel/src/plugin/openai/ws.ts:282 | high | bug | fix | onAbort 未考虑重试换 socket 的窗口（旧 handler 已摘除、新 socket 未登记时 abort 落空）。修复：abort 处理同时覆盖 pendingSwap 状态（与 C228 同补丁）。 |
| C226 | packages/opennovel/src/plugin/shared.ts:205 | critical | bug | fix | `engines.opennovel ?? engines.opennovel` 第二操作数是 fork 改名前 `engines.opencode` 的残留（历史插件包只有旧键，兼容检查被旁路）。修复：右操作数改回 engines.opencode。 |
| H692 | packages/opennovel/src/plugin/snowflake-cortex.ts:34 | high | maintainability | fix | snowflake pendingOAuth 模块级单值并发覆盖（第二个流程让第一个回调误报 CSRF）。修复：按 state 键控 Map（同 C225）。 |
| H693 | packages/opennovel/src/plugin/snowflake-cortex.ts:316 | high | bug | fix | 刷新令牌持久化 `.catch(()=>{})`：失败即每次会话重新授权且无痕迹。修复：catch 记录错误。 |
| H691 | packages/opennovel/src/plugin/xai.ts:351 | high | security | wontfix | xAI 授权走 PKCE+code 交换、回调只取 access_token 不验证 ID token（nonce 为附加 OIDC 参数），未校验 nonce 不构成可利用缺陷（grep 全文件无 id_token 消费路径）。 |
| H696 | packages/opennovel/src/project/instance-store.ts:126 | high | bug | fix | reload 先 set 新缓存再 fork 旧条目 dispose：并发 load 会拿到尚未完成初始化的新实例并与旧实例 dispose 交错。修复：uninterruptibleMask 内先完成 dispose 交接（或以世代令牌延迟发布）。 |
| H699 | packages/opennovel/src/project/project.ts:417 | high | bug | fix | addSandbox 读-改-写数组无事务，并发丢更新。修复：db.transaction 同步回调包裹 select+update（promoteWorldMapDraft/C202 同型先例）。 |
| H700 | packages/opennovel/src/project/project.ts:434 | high | bug | fix | 同 H699：removeSandbox 亦读-改-写无事务。 |
| H701 | packages/opennovel/src/project/vcs.ts:11 | high | performance | wontfix | -U<INT_MAX> 是"取全文件上下文补丁"的标准写法，git 实际按文件长度封顶、无超出生成内容的缓冲分配面。 |
| H702 | packages/opennovel/src/project/vcs.ts:88 | high | bug | fix | 截断时 `chunks.slice(0,-1)` 丢末块，但 batchPatches 按原下标映射文件：块与文件错位、补丁可能写错目标。修复：保留映射（丢弃时同步剔除对应文件项）。 |
| H697 | packages/opennovel/src/provider/auth.ts:167 | high | bug | fix | hooks[input.providerID]?.methods[input.method] 无判空：未知 providerID/method 抛裸 TypeError（HTTP 面可达）。修复：判空返回 ValidationFailed 类型化错误。 |
| H698 | packages/opennovel/src/provider/auth.ts:203 | high | bug | wontfix | result 为判别联合（key/refresh 互斥），"同时具备两字段"的类型不存在；两个独立 if 在当前类型下等价 if-else，无覆盖路径。 |
| H703 | packages/opennovel/src/provider/ollama-models.ts:84 | high | security | wontfix | baseURL 来自用户自己的 provider 配置（信任级同 H450/H387）：Ollama 场景本就常指内网主机，加 SSRF 拦截会破坏核心用例。 |
| H704 | packages/opennovel/src/provider/provider.ts:46 | high | bug | fix | 超时分支 `void reader.cancel(err)` 丢弃 promise：cancel 拒绝成 unhandledRejection，且读完成与 reject 竞争未收敛。修复：cancel 走 Effect/promise 收敛后再 reject。 |
| C229 | packages/opennovel/src/provider/provider.ts:1794 | critical | security | wontfix | 动态加载 model.api.npm 声明的 provider 包是 ai-sdk 生态的机制定义（信任边界=配置与 models.dev 目录，同 H454/C211 口径）；file:// 面向本地开发调试，操作者本可直接 import。 |
| H707 | packages/opennovel/src/provider/transform.ts:82 | high | bug | fix | sanitizeToolResultOutput 原地改传入 content 对象（写回 content.output.value），normalizeMessages 的调用方复用原消息引用时历史被静默改写。修复：结构共享复制后再改。 |
| H708 | packages/opennovel/src/provider/transform.ts:367 | high | bug | fix | applyCaching 直接 mutate 输入 msg.providerOptions 与 lastContent（mergeDeep 改首参），对会话历史对象产生副作用。修复：deep-clone 目标消息后写入（同 H707 口径）。 |
| C230 | packages/opennovel/src/question/index.ts:124 | critical | bug | fix | reply 路径先 delete pending 再 publish(Rejected)：publish 失败 deferred 永不完成、ask 调用方永挂。修复：先完成 deferred（或 publish 失败兜底 fail deferred）。 |
| C231 | packages/opennovel/src/question/index.ts:141 | critical | bug | fix | 同 C230：reject 分支同样存在 publish 失败导致永挂。 |
| H705 | packages/opennovel/src/server/auth.ts:24 | high | security | fix | required() 把空串密码视为"未启用"、authorized() 却按已设值比对：空密码配置下两口径不一致存在放行面。修复：统一 password 判定（空串一律按未配置处理并在启动/请求两端一致）。 |
| C232 | packages/opennovel/src/server/auth.ts:28 | critical | security | fix | 密码 `===` 短路比较存在时序侧信道，且仓内已有 timingSafeEqual 先例。修复：比较改 crypto.timingSafeEqual（等长缓冲）。 |
| H706 | packages/opennovel/src/server/global-lifecycle.ts:19 | high | bug | fix | swallowErrors 下 disposeAll 失败仍 emitGlobalDisposed：下游按"已全部释放"行动（如退出进程）漏清理。修复：dispose 失败时不发 disposed 事件或携带失败标记。 |
| H709 | packages/opennovel/src/server/mdns.ts:22 | high | maintainability | fix | mDNS 各错误回调全静默：网络/注册失败无从诊断。修复：统一 console.error/日志（保留吞错继续行为）。 |
| H710 | packages/opennovel/src/server/proxy-util.ts:23 | high | bug | fix | HeadersInit 为 [name,value][] 元组数组时 Object.entries 产生索引键，头部被构造成垃圾。修复：分支处理 Array/Record/Headers 三形态。 |
| H711 | packages/opennovel/src/server/routes/instance/httpapi/groups/config.ts:16 | high | security | defer | GET /config 返回含凭据字段的 ConfigV1.Info 属公开 HttpApi 契约；改脱敏响应=契约变更（本 change 硬约束），归 API 安全演进 change。 |
| C233 | packages/opennovel/src/server/routes/instance/httpapi/groups/config.ts:26 | critical | security | defer | PATCH /config 载荷接受凭据字段是现有契约（写配置本来就需要 apiKey）；收窄 payload 涉及 HttpApi schema 变更，defer 至契约 change。 |
| H714 | packages/opennovel/src/server/routes/instance/httpapi/groups/control.ts:12 | high | security | defer | LogQuery 参数约束属 HttpApi 请求 schema 契约变更；且消费端按 Location 解析+权限门处理（H496 口径），先补 schema 校验需与契约演进一并做。 |
| H713 | packages/opennovel/src/server/routes/instance/httpapi/groups/experimental.ts:187 | high | security | defer | disableCodecs 用于透传型端点（日志流/非 JSON 体），改回框架校验涉及 HttpApi codec 行为契约，归契约 change 评估。 |
| H712 | packages/opennovel/src/server/routes/instance/httpapi/groups/file.ts:15 | high | security | wontfix | path 参数在 handler 端经 Location/文件系统层解析并受工作区边界与权限系统约束（同 H496 信任模型）；query schema 加正则黑名单会拒合法输入且非唯一防线。 |
| H715 | packages/opennovel/src/server/routes/instance/httpapi/groups/mcp.ts:21 | high | security | defer | callback payload 增加 state 字段属 HttpApi 请求契约变更（客户端需同步送参），本 change 契约不变硬约束；OAuth state 校验链路归 API 安全演进 change。 |
| H716 | packages/opennovel/src/server/routes/instance/httpapi/groups/project-copy.ts:0 | high | maintainability | defer | 补错误声明（error: [...]）是端点契约注解变更，涉及 SDK 再生成（AGENTS.md 工作流），归契约 change。 |
| H718 | packages/opennovel/src/server/routes/instance/httpapi/groups/project.ts:32 | high | bug | defer | 同 H716：current 端点错误模式声明缺失属契约演进；把 InstanceState.die 改类型化错误也牵动 HttpApi 错误词汇表。 |
| H717 | packages/opennovel/src/server/routes/instance/httpapi/groups/sync.ts:19 | high | security | defer | directory 参数加 schema 约束属请求契约变更；消费端按本机文件系统语义处理（同 C238 设计口径），收紧校验应与契约演进一并评估。 |
| C234 | packages/opennovel/src/server/routes/instance/httpapi/groups/tui.ts:88 | critical | bug | fix | openThemes 端点/处理器与 openSessions 复制粘贴同命令（见 C237），主题对话框打不开。修复：处理器发布 theme 相关命令，group 描述同步更正。 |
| H719 | packages/opennovel/src/server/routes/instance/httpapi/groups/tui.ts:185 | high | security | wontfix | controlResponse 的 payload 本就是转发给 UI 的任意控制响应，Schema.Unknown 是该端点的既有契约（TODO 注释明示未来收紧计划）；收紧属契约演进。 |
| H721 | packages/opennovel/src/server/routes/instance/httpapi/handlers/config.ts:14 | high | security | defer | 同 H711：响应脱敏改变 success schema 与既有消费方（桌面端配置界面直读原值），归 API 安全演进 change。 |
| H720 | packages/opennovel/src/server/routes/instance/httpapi/handlers/control.ts:13 | high | bug | wontfix | control 处理器的 orDie 与本仓 DB/服务层错误收敛一致（H441 家族），缺陷经 HttpApi 统一映射 5xx；逐个 handler 改类型化错误是仓库级重构。 |
| H722 | packages/opennovel/src/server/routes/instance/httpapi/handlers/event.ts:12 | high | bug | wontfix | SSE 的 data 来自 EventV2 序列化载荷（本就是可 JSON 化的 schema 数据），不存在循环引用/BigInt 面；防御 try-catch 掩盖上游 schema 错误。 |
| C236 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:225 | critical | bug | fix | pty WS 结束时 outbox 队列不 shutdown：阻塞在 Queue.take 的 drain fiber 永挂。修复：连接终局（正常/中断）对 outbox 执行 shutdown（addFinalizer）。 |
| H723 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:244 | high | bug | wontfix | 无界队列 offerUnsafe 永不失败（契约），回放注入自身无挂起点；其生命周期担忧与 C236 重合，由 shutdown 修复覆盖。 |
| C235 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:248 | critical | bug | wontfix | write 残差错误按 defect 收敛：drain fiber die 触发 scope finalizer 关连接（进程不受影响），非 socket 类写错误本就是程序错误面。 |
| H724 | packages/opennovel/src/server/routes/instance/httpapi/handlers/sync.ts:27 | high | bug | fix | fork 的同步任务 Effect.ignore 吞掉失败（27 行），同步静默失败无从诊断。修复：tapError/logWarning 后再 ignore。 |
| H725 | packages/opennovel/src/server/routes/instance/httpapi/handlers/sync.ts:74 | high | bug | wontfix | DB 错误 orDie 后经 HttpApi 统一 500（同 H441/H720 口径），不会裸崩进程；BadRequest 之外的 DB 形态本就不该映射 4xx。 |
| C237 | packages/opennovel/src/server/routes/instance/httpapi/handlers/tui.ts:51 | critical | bug | fix | handlers/tui.ts:51 openThemes 发布 "session.list"（与 openSessions 相同的复制粘贴残留），主题面板不可达。修复：发布 theme 命令。 |
| H728 | packages/opennovel/src/server/routes/instance/httpapi/handlers/workspace.ts:64 | high | bug | fix | create 用 catchCause 消化插件 throw、warp 只 mapError：同族操作中 warp 会把 defect 裸抛给框架。修复：对齐 create 的 catchCause 错误映射。 |
| H726 | packages/opennovel/src/server/routes/instance/httpapi/middleware/authorization.ts:12 | high | security | wontfix | auth_token 查询参数为旧客户端（浏览器 EventSource/WS 无法带头）的显式兼容通道（代码有注释记载），凭据进访问日志面在本地部署可接受；移除属客户端迁移/契约演进。 |
| H727 | packages/opennovel/src/server/routes/instance/httpapi/middleware/compression.ts:57 | high | performance | fix | gzipSync/deflateSync 同步压缩阻塞事件循环，大响应拖垮吞吐。修复：改异步 gzip/deflate（promisify）。 |
| H730 | packages/opennovel/src/server/routes/instance/httpapi/middleware/fence.ts:17 | high | bug | fix | fence 双 load 模式在并发请求间存在窗口（A 的 previous/current 之间 B 变更围栏状态），检查语义失真。修复：以单次 load+compare-and-set 或进程内互斥收敛；实现批次细读 Fence 语义。 |
| H731 | packages/opennovel/src/server/routes/instance/httpapi/middleware/instance-context.ts:23 | high | bug | wontfix | store.load 错误经 HttpApi 错误通道统一映射（H720 同口径）；"用户友好文案"是网关呈现层职责，不在中间件就地吞转。 |
| C238 | packages/opennovel/src/server/routes/instance/httpapi/middleware/instance-context.ts:29 | critical | security | wontfix | 按 x-opennovel-directory/查询参数加载任意目录是本服务器多项目架构的声明设计（serve.ts:10-11 注释原文），访问控制由 authorization 中间件承担；目录白名单属部署形态演进议题。 |
| H729 | packages/opennovel/src/server/routes/instance/httpapi/middleware/schema-error.ts:40 | high | security | wontfix | 日志已按 6-10 行注释的截断策略执行（避免整包回显），1024 残片与服务器日志同信任级；全脱敏需重设计校验错误词汇表，属增强。 |
| H732 | packages/opennovel/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:87 | high | security | wontfix | 同 C238：header 目录即路由入口（架构声明），边界为鉴权层；query schema 校验属契约变更且拒不了合法绝对路径。 |
| C009 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.html:0 | critical | security | fix | novel-reader.html 把 id 直接拼进 onclick 字符串字面量（无 JSON.stringify/转义），id 现虽为内部生成，但读者页属可达 HTML 面、习惯即漏洞温床。修复：onclick 参数用 JSON.stringify 内嵌或改 data-* + 事件委托。 |
| H055 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.html:1144 | high | bug | fix | novel-reader 全部 fetch 链无 catch：网络/4xx/JSON 错误时 UI 永卡 loading 且 unhandled rejection。修复：统一 .then(r=>r.ok?r.json():Promise.reject()) + catch 呈现错误态。 |
| C239 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.ts:23 | critical | security | wontfix | 与 C238/C232（H732）同口径：directory 头/参数选择项目目录是本服务器声明架构，reader 仅读该目录大纲文件；边界为 authorization 中间件。 |
| H734 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.ts:94 | high | bug | fix | existsSync→readFileSync 的 TOCTOU（outline 文件被并发改删时同步抛错直达 500）。修复：readFileSync 套 Effect.try/catch，缺文件按空大纲降级。 |
| H736 | packages/opennovel/src/server/routes/instance/httpapi/websocket-tracker.ts:18 | high | bug | wontfix | closing 检查与 sockets.add 在同一同步函数段（无 await 间隙），closeAll 无法在其间执行；"untracked socket"路径不可达。 |
| H733 | packages/opennovel/src/server/server.ts:72 | high | bug | wontfix | Server.listen 一进程一次（桌面/CLI 启动路径互斥），并发 listener 不存在使用面；模块级 url 是单例句柄便利导出。 |
| H735 | packages/opennovel/src/server/shared/tui-control.ts:11 | high | maintainability | wontfix | tui-control 队列是进程级控制总线单例（服务器与 TUI 同进程对接），跨 import 共享正是设计目的；多租户隔离属未来形态议题。 |
| H737 | packages/opennovel/src/server/shared/workspace-routing.ts:20 | high | bug | wontfix | SessionID.make 为 brand 断言不做校验、不抛错；畸形 id 进入 store 查询命中空集，走既有 NotFound 通道。 |
| H738 | packages/opennovel/src/server/shared/workspace-routing.ts:31 | high | bug | wontfix | target 来自配置中的代理 URL（内部生产方），非法配置就该在路由时显式失败；包一层 TypeError 不改变行为面。 |
| H739 | packages/opennovel/src/session/compaction.ts:296 | high | bug | wontfix | 生成器内 throw 进入 die 通道是本仓 misuse 惯例（H416/C169 家族）：parent 消息缺失属数据不变量破坏，defect 大声失败合理。 |
| H740 | packages/opennovel/src/session/instruction.ts:95 | high | security | wontfix | instructions URL 来自用户自己的配置（信任级同 H387/H703）：本客户端形态加 SSRF 拦截会破坏自托管模型接入。 |
| H743 | packages/opennovel/src/session/llm.ts:157 | high | bug | fix | 权限确认 catch 全吞并返回 approved:false：权限服务故障与用户拒绝不可区分且无日志。修复：记录 cause 后返回拒绝（保留降级行为）。 |
| H741 | packages/opennovel/src/session/llm/request.ts:212 | high | bug | fix | 212 行 `startsWith("opennovel") // startsWith("opennovel")` 同表达式重复（fork 改名残留，第二项原意应为 legacy provider 前缀）。修复：查 git 历史确认原判定后重写（或去重），行为面先安全去重。 |
| H742 | packages/opennovel/src/session/llm/request.ts:224 | high | bug | fix | 224 行同 H741 的复制粘贴恒真条件。修复：同批处理。 |
| C240 | packages/opennovel/src/session/prompt.ts:0 | critical | security | wontfix | 自定义命令模板 `!`cmd`` 与 $ARGUMENTS 插值是面向用户的显式 shell 执行特性（agent 权限门控下操作者自己提交命令），输入源即操作者本人，信任模型同 C211/C208；无外部不可信注入面。 |
| H749 | packages/opennovel/src/session/prompt.ts:170 | high | security | wontfix | prompt @文件引用允许 ~/ 与任意路径是用户显式意图（操作者本就可读这些文件进上下文，与工具层 permission 模型同级）；"留在 worktree 内"限制会破坏跨目录引用的既有工作流。 |
| H750 | packages/opennovel/src/session/prompt.ts:813 | high | security | wontfix | bypassCwdCheck 服务于 part.url（客户端生成的附件引用）读取通道，路径来源与 H749 同信任级；二次收束与权限系统重复。 |
| H744 | packages/opennovel/src/session/reminders.ts:26 | high | bug | fix | 非实验分支内联 push part 未走 sessions.updatePart，与实验分支持久化口径不一（疑漏持久化）。修复：统一经 updatePart 写入；实现批次核对两条分支落库差异。 |
| H745 | packages/opennovel/src/session/reminders.ts:78 | high | bug | fix | `Effect.catch(Effect.die)` 把 ensureDir 可恢复错误（权限/磁盘）升格 defect。修复：改 tapError 记日志并跳过写入（提醒功能可降级）。 |
| H746 | packages/opennovel/src/session/revert.ts:44 | high | bug | fix | 循环内收集的 remaining 循环后无消费（疑为未接线的"应用过滤结果"意图或纯死代码）。修复：核对意图后接线或删除；保持行为不变优先。 |
| C241 | packages/opennovel/src/session/run-state.ts:74 | critical | bug | wontfix | busyError 返回 Session.BusyError（TaggedError 实例）本身 yieldable，`yield* 错误对象`即 Effect.fail（C158 全仓惯例）；评论前提不成立。 |
| H751 | packages/opennovel/src/session/run-state.ts:125 | high | bug | wontfix | jobs 快照是有意的"调用时刻可取消清单"，cancelled 集合防重入；cancel 抛错沿错误通道终结整个批量操作（非无限循环面）。 |
| H747 | packages/opennovel/src/session/session.ts:606 | high | bug | wontfix | 紧邻注释明示 remove 须对损坏会话尽力工作（best-effort 删除），子会话移除失败仅记日志是设计选择；改为上抛会卡死删除路径。 |
| H748 | packages/opennovel/src/session/status.ts:39 | high | bug | wontfix | 状态事件是电平触发提示（消费者按事件重读，最终一致），先 publish 后 set 的窗口仅导致一次冗余读；改序反而引入 set 成功 publish 失败的更大窗口。 |
| H752 | packages/opennovel/src/session/system.ts:121 | high | bug | wontfix | `disabled.size < tools.length` 语义即"存在未被禁用的工具才注入该 server"，部分禁用仍注入是正确行为（禁用的是个别工具）；评论把预期语义读成 bug。 |
| H755 | packages/opennovel/src/session/todo.ts:49 | high | bug | fix | DB 提交后 publish 失败无兜底：订阅者丢更新且无痕。修复：publish 套 tapError 记警告（状态已提交，通知尽力而为），保持既有提交顺序。 |
| H756 | packages/opennovel/src/session/todo.ts:49 | high | bug | wontfix | orDie 属仓库 DB 层统一错误收敛（H441 家族）；transient 失败由重试策略统一解决，不在每个调用点分叉。 |
| H757 | packages/opennovel/src/session/todo.ts:49 | high | bug | wontfix | 同 H756（同一行第二条评论）。 |
| H760 | packages/opennovel/src/session/tools.ts:127 | high | bug | fix | abort 分支 completeToolCall 后仍 return output，外层对同一 callID 再完成一次存在双完成竞态。修复：abort 后走独立终局（返回已完成哨兵或不再向上抛 output）；实现批次核对调用方。 |
| H754 | packages/opennovel/src/setting-organization.ts:80 | high | bug | fix | analyze 无 dryRun 同款的 try 包裹：loadOrganizeContext/analyzeEntities 抛错直达服务器未处理面。修复：对齐 dryRun 的失败呈现。 |
| H753 | packages/opennovel/src/setting-organization.ts:133 | high | bug | fix | 同 H754：apply 缺 try 包裹而 dryRun 有（133 行对比明确不对称）。 |
| H758 | packages/opennovel/src/share/session.ts:26 | high | bug | wontfix | throw 进 die 通道为仓库惯例（C169/H416 家族）；ShareDisabled 属配置违规的显式失败，die 呈现可接受，若需类型化应全仓统一。 |
| H759 | packages/opennovel/src/share/share-next.ts:130 | high | bug | wontfix | queue 的 get→set 在同一同步段（无 await 间隙），并发 sync 无法在检查与登记间交错；"Map 被覆盖"路径不可达。 |
| C242 | packages/opennovel/src/share/share-next.ts:253 | critical | bug | fix | sync 在 HTTP 请求前删除队列条目，网络失败即数据永久丢失（无重试源）。修复：请求成功后再移除；失败保留队列等下轮。 |
| H766 | packages/opennovel/src/skill/discovery.ts:49 | high | security | wontfix | discovery url 来自用户自己的 skill 配置（信任级同 H740/C211）；操作者指定 file:// 是其本机资源的读取意图，不构成越权面。 |
| C243 | packages/opennovel/src/skill/discovery.ts:79 | critical | security | fix | 远端 skill index 的 name/files 未经校验直接 join 本地缓存路径：恶意索引可用 ../ 写越界（外部数据源，非用户输入面）。修复：段级拒绝 ..，解析结果必须落在缓存目录内。 |
| H764 | packages/opennovel/src/skill/index.ts:325 | high | security | fix | skill 列表 HTML 输出仅转义 location，name/description 来自远端 index/SKILL.md 的外部内容未 escapeHtml（外部可控→Web 视图 XSS 面）。修复：两字段同批转义。 |
| H765 | packages/opennovel/src/skill/index.ts:340 | high | security | fix | 非 verbose 的 markdown 输出路径同样未处理 name/description（下游会进 HTML 渲染面）。修复：同口径转义或剥离危险片段。 |
| H761 | packages/opennovel/src/snapshot/index.ts:623 | high | bug | fix | snapshot cat-file 解析的 fail() 只返回 undefined 不记日志，协议错位被静默吞掉难排查。修复：fail 内加 logWarning（保留返回 undefined 的控制流）。 |
| H762 | packages/opennovel/src/snapshot/index.ts:656 | high | bug | fix | 边界条件 `i + size >= out.length` 把"恰好读到数组末尾"误判为截断（off-by-one，合法尾记录被拒）。修复：改 `i + size + 1 > out.length` 语义核对协议尾换行。 |
| H763 | packages/opennovel/src/snapshot/index.ts:743 | high | bug | fix | load 失败时 hit 退化为空占位对象，三元取 [before,after] 而非回落 show(row)，行内容错位。修复：hit 判存在性（text?.get 结果对象与空占位区分），缺失走 show(row)。 |
| H769 | packages/opennovel/src/storage/storage.ts:301 | high | maintainability | wontfix | list 是目录 glob 的尽力快照（读取与文件级写锁目标不同），加目录级锁会把并发缩到串行；不一致窗口仅导致列表多/少一项，读写仍单文件原子。 |
| H767 | packages/opennovel/src/tool/apply_patch.ts:77 | high | bug | fix | apply_patch add 的 stat 不存在→write 之间存在跨进程窗口，会静默覆盖并发新建文件。修复：改用 O_EXCL 原语写入或捕获 EEXIST 报错。 |
| H768 | packages/opennovel/src/tool/apply_patch.ts:241 | high | bug | fix | move 以写新+删旧实现，崩溃中间态两份共存。修复：同卷用 rename 原子移动，跨卷失败显式报错。 |
| H770 | packages/opennovel/src/tool/edit.ts:37 | high | bug | wontfix | lock() 的 get→set 为同步段（无 await），同路径双 semaphore 不可达；建议的 computeIfAbsent 与现状等价。 |
| H771 | packages/opennovel/src/tool/edit.ts:174 | high | bug | wontfix | edit 工具对 FS 意外的 orDie 属工具层统一收敛（H441/H775 家族）：编辑失败以 defect 进入会话错误通道呈现，不影响进程。 |
| H775 | packages/opennovel/src/tool/grep.ts:110 | high | bug | wontfix | grep 工具 orDie 同家族：底层搜索异常即工具调用失败（会话可见），进程不受影响；"返回 error 文案"已由上层工具执行器的失败通道完成。 |
| H772 | packages/opennovel/src/tool/json-schema.ts:6 | high | bug | wontfix | 缓存 schema 的消费方（校验器）只读不写（仓内无 mutation 调用点），防御性深拷贝属加固；与 H617/H618 同口径。 |
| H773 | packages/opennovel/src/tool/mcp-websearch.ts:4 | high | security | wontfix | 查询参数携带 websearch API key 是供应商 API 形态（同 H506 论证：端点即服务方、TLS 直达），改 header 需对方支持。 |
| H774 | packages/opennovel/src/tool/mcp-websearch.ts:92 | high | bug | wontfix | 工具层 die/orDie 失败经会话错误通道 squash 成模型可见错误文本（H775/H771 同口径），超时作为 defect 呈现不改变用户可观测行为；改类型化错误属一致性调整。 |
| H776 | packages/opennovel/src/tool/question.ts:0 | high | bug | wontfix | question 工具的 orDie 与 H497 同判：拒绝/超时走 Reply 数据通道而非错误通道，orDie 只兜底真正的程序异常。 |
| H778 | packages/opennovel/src/tool/read.ts:159 | high | performance | fix | read 达 limit 后未置 done，流继续遍历全文件剩余行（大文件线性浪费）。修复：同处 flags.done=true 并以 ReadStop 终止流。 |
| H777 | packages/opennovel/src/tool/registry.ts:391 | high | bug | wontfix | zodJsonSchema 返回非对象属 schema 定义的程序错误（开发者面），throw 即 die 在注册期暴露是正确信号，类型化不增信息量。 |
| H782 | packages/opennovel/src/tool/skill.ts:0 | high | security | fix | skill name 未转义直接插进 <skill_content name="..."> XML 属性：frontmatter 可控字符（引号/&/<>）破坏结构并被下游解析。修复：属性经 escapeXml。 |
| H784 | packages/opennovel/src/tool/skill.ts:0 | high | bug | wontfix | skill 工具末尾 orDie 属工具层统一收敛家族（H775）：权限/FS 异常以错误文本呈现给模型，进程无碍。 |
| H783 | packages/opennovel/src/tool/skill.ts:23 | high | bug | wontfix | Skill.NotFoundError 经 Cause.squash 后消息（含可用技能列表）仍进入工具错误文本给模型；die 与 ToolFailure 在此路径的可见输出等价，改法是风格统一。 |
| H779 | packages/opennovel/src/tool/tool.ts:146 | high | bug | wontfix | 工具执行器末尾 orDie 同家族：ToolFailure 已在 execute 内部以数据形态处理，orDie 仅兜底逃逸异常。 |
| H780 | packages/opennovel/src/tool/webfetch.ts:82 | high | bug | wontfix | catchIf 的类型谓词读取 err.reason?._tag —— 调用点已处于 Effect 错误对象的稳定形状（StatusCodeError 由本仓 http 层产生），结构漂移即程序错误走 die。 |
| H781 | packages/opennovel/src/tool/webfetch.ts:155 | high | bug | wontfix | webfetch 末尾 orDie 同 H775 家族（网络错误文本对模型可见），不改变可观测行为。 |
| H785 | packages/opennovel/src/tool/websearch.ts:140 | high | bug | wontfix | websearch 末尾 orDie 同家族判例。 |
| C244 | packages/opennovel/src/util/archive.ts:9 | critical | security | fix | archive.ts 把路径内插进 PowerShell 命令串：目录名含单引号（O'Brien 类合法路径）即破坏/注入。修复：改 -LiteralPath 传参或完整 PS 转义（'' 与反引号）。 |
| H786 | packages/opennovel/src/util/data-url.ts:7 | high | bug | fix | decodeURIComponent 对畸形百分号序列抛 URIError（data-url 内容可来自 prompt 附件），解码助手应容错。修复：try 包裹返回 undefined，调用方按解码失败处理。 |
| H787 | packages/opennovel/src/util/defer.ts:3 | high | bug | fix | defer 的 `void fn()`：异步回调 reject 时 unhandledRejection。修复：.catch 记日志（保留 fire-and-forget 语义）。 |
| H788 | packages/opennovel/src/util/error.ts:5 | high | bug | fix | cliErrorMessage 沿 cause.body 递归无深度/环路防护（自引用 cause 可无限循环）。修复：加 depth 上限（>10 即止）。 |
| H789 | packages/opennovel/src/util/lazy.ts:5 | high | bug | fix | opennovel/util/lazy 在 fn() 之后才置 loaded：重入时工厂被执行多次（与 core 版 H508 相反方向的缺陷）。修复：三态标记（running 时重入直接抛程序错误）。 |
| H790 | packages/opennovel/src/util/local-context.ts:3 | high | bug | wontfix | NotFound.name 置为上下文名是有意设计（stack/日志里直接可读），错误分类在仓内一律 instanceof；改 name 属约定变更非缺陷。 |
| H793 | packages/opennovel/src/util/locale.ts:66 | high | bug | fix | truncateLeft 在 len<=1 时 `slice(-0)` 返回整串，输出长于输入违背契约。修复：len<=1 直接返回省略号。 |
| H792 | packages/opennovel/src/util/queue.ts:1 | high | bug | fix | AsyncQueue 无 close：生产端停止后消费端 pending resolver 永挂。修复：补 close()（置位+唤醒等待者+迭代器终止）。 |
| H791 | packages/opennovel/src/util/queue.ts:16 | high | bug | fix | 同 H792：asyncIterator 无终止条件，生产者不再 push 时 for-await 永挂（与 close 一并修复）。 |
| H796 | packages/opennovel/src/util/repository.ts:83 | high | security | wontfix | host/segment 以 spawn 数组参数传 git（不经 shell 解释），元字符无注入语义；parse/validateBranch 已限制危险形态，进一步封禁会拒合法远端。 |
| H794 | packages/opennovel/src/util/rpc.ts:7 | high | bug | wontfix | rpc 通道两端是同进程/同构建 worker 的内部消息（非外部输入），畸形帧属程序错误，handler 抛错可见即正确。 |
| H795 | packages/opennovel/src/util/rpc.ts:8 | high | bug | wontfix | 同 H794：method 名来自编译期对齐的调用方（内部代码），方法缺失即打包/编程错误，die 可见合理。 |
| H797 | packages/opennovel/src/util/signal.ts:4 | high | bug | wontfix | signal 是纯触发闩（trigger/wait），失败路径由调用方以 Effect.race/timeout 组合表达；内置 abort 属功能扩展。 |
| H800 | packages/opennovel/src/util/timeout.ts:3 | high | bug | fix | Promise.race 超时取胜后原 promise 无 rejection handler：后续 reject 变 unhandledRejection。修复：对原 promise 预挂 .catch(()=>{})（或 finally clearTimeout 方案）。 |
| C246 | packages/opennovel/src/worktree/index.ts:461 | critical | security | wontfix | worktree 启动命令是操作者在项目设置里显式声明的自定义启动命令（功能定义即执行用户命令），信任模型同 H749/C211/bash 工具：不存在不可信外部输入面。 |
| C245 | packages/opennovel/test/cli/acp/acp-test-client.ts:46 | critical | bug | wontfix | `received = yield* acp.receive.pipe(Effect.timeout(...))`：超时使整个 Effect 失败并中断 while(true)（yield* 失败即生成器退出），不存在"继续空转"路径；评论把 Effect 失败当成返回哨兵值。 |
| H799 | packages/opennovel/test/cli/acp/acp-test-client.ts:52 | high | bug | wontfix | 同 C245：超时即失败退出循环。request/waitForNotification 共享接收流是测试客户端顺序化使用的既有约定（用例间无并发消费），非产品缺陷面。 |
| H798 | packages/opennovel/test/cli/acp/acp-test-client.ts:89 | high | bug | fix | isJsonRpcResponse 未排除带 method 的请求帧：ACP 支持 agent→client 请求（同含 id/jsonrpc），服务端主动请求可能被误判为响应。修复：类型守卫补 !("method" in input)。 |
| H801 | packages/opennovel/test/cli/acp/helpers.ts:70 | high | bug | fix | expectErrorCode 错误分支的比较逻辑自相矛盾（拿 falsy error 与 {code} 相等比较，恒失败或恒通过取决于形态）。修复：改为 toBeInstanceOf + toHaveProperty("code") + 数值比较。 |
| C247 | packages/opennovel/test/fake/auth.ts:4 | critical | bug | wontfix | Layer.mock 允许部分实现：现有测试未调用缺失方法（tsgo 通过、全量测试通过），mock 完整性按需补即可，不构成缺陷。 |
| H803 | packages/opennovel/test/fake/npm.ts:4 | high | bug | wontfix | 同 C247：noop npm mock 只实现现测试用到的 install；add/which 无调用点。 |
| H802 | packages/opennovel/test/fake/npm.ts:8 | high | bug | wontfix | `export * as NpmTest from "./npm"` 是 AGENTS.md 规定的文件自导出命名空间惯例（D2 白名单第 1 类，src/config 与 test/fake 同构），非循环导入错误。 |
| H804 | packages/opennovel/test/fixture/config.ts:10 | high | bug | wontfix | TS 结构化类型允许少参实现（函数可忽略尾参），update: () => Effect.void 完全满足 (config: Info) => Effect；无类型不匹配。 |
| H805 | packages/opennovel/test/fixture/plugin-meta-worker.ts:17 | high | bug | wontfix | 测试 worker 顶层 await 失败即 reject→测试失败可见（正是期望行为）；包 try 重抛不增加信息。 |
| H806 | packages/opennovel/test/lib/filesystem.ts:4 | high | bug | fix | 测试 helper 在 writeFileString 成功后才注册 finalizer：写失败路径残留临时文件/目录污染后续测试。修复：makeDirectory+finalizer 注册前置，再执行写入。 |
| H807 | packages/opennovel/test/server/httpapi-exercise/assertions.ts:20 | high | bug | wontfix | sort 的输入来自 HTTP JSON 响应（协议上无环），循环引用不可达；WeakSet 防护属泛化加固。 |
| H808 | packages/opennovel/test/server/httpapi-exercise/backend.ts:53 | high | bug | wontfix | httpapi 测试 exercise 串行发起请求（单 fiber 循环），同凭据并发创建 app 的窗口在本测试驱动形态下不存在；即便双建也是测试资源无害重复。 |
| H809 | packages/opennovel/test/server/httpapi-exercise/runtime.ts:20 | high | bug | wontfix | runtime() 仅测试 bootstrap 首调；import 失败属环境级致命错误，缓存 rejected promise 与每次重试的诊断结果等价（fail fast 一致）。 |
| C248 | packages/opennovel/test/server/httpapi-layer.ts:21 | critical | bug | fix | request() 用 HttpClientRequest.setUrl(url.pathname) 覆盖了 fromWeb 保好的完整 URL，查询参数被剥离（?limit=0 类用例失配）。修复：setUrl(url.pathname + url.search)。 |
| H118 | packages/plugin/package.json:8 | high | bug | wontfix | 误报：package.json devDependencies 含 @typescript/native-preview（catalog:），该包正是 tsgo CLI 的分发包，typecheck 脚本在包内可用。 |
| C062 | packages/plugin/package.json:12 | critical | bug | wontfix | 既定模式：script/publish.ts:26-40 在 pack 前把 exports 重写为 dist/*.js + .d.ts 再 npm publish，发布后 exports 与 files:[dist] 一致；workspace 内直接消费 TS 源码是本仓 monorepo 惯例。 |
| H810 | packages/plugin/script/publish.ts:32 | high | bug | wontfix | 误报：publish.ts:31-37 是 try/finally（无 catch），finally 恢复 package.json 后原错误继续向上传播，不会被静默吞掉。 |
| H811 | packages/plugin/script/publish.ts:33 | high | bug | fix | publish.ts:34 npm publish *.tgz 在遗留 tarball 存在时会匹配多个文件导致发布失败；发布前清理旧 tgz 或改用精确文件名（ui/script/publish.ts:23 已用精确名可循例）。 |
| H812 | packages/plugin/src/example-workspace.ts:20 | high | bug | wontfix | 断言安全：example-workspace.ts:16-18 configure 恒为 directory 赋 /tmp/folder/folder-${rand} 值，remove/target 被调用时 directory 必存在；create 亦有 if (!config.directory) return 守卫，属示例代码的刻意简写。 |
| H813 | packages/plugin/src/novel-writer/__verify__/verify-tools.ts:47 | high | bug | wontfix | 退出码契约已满足：verify-tools.ts:268-273 正常路径按 failures 数 process.exit(0/1)，抛错时 unhandled rejection 退出码同为 1（符合文件头约定）；verify.db 残留由下次运行开头的 rmSync(force) 自清理。 |
| C249 | packages/plugin/src/novel-writer/agents/auditor.ts:1 | critical | bug | fix | auditor.ts:39 与维度清单实为 38 项（94-95 行编号到 38），但 submit_chapter_review 按 CONTINUITY_DIMENSIONS（continuity-check.ts:58-113，仅 37 项、无「书籍坐标泄漏」）校验并拒绝清单外维度；LLM 按 38 维提交会被拒，需把提示词统一回 37 维口径。 |
| H814 | packages/plugin/src/novel-writer/annotation.ts:99 | high | bug | fix | annotation.ts:98-99 quote 回退分支用 replace() 只替换首个匹配，段落内 quote 重复时会改错位置；要求 quote 在段落内唯一（indexOf===lastIndexOf）否则视为 stale/拒绝。 |
| H815 | packages/plugin/src/novel-writer/arc-backfill.ts:144 | high | bug | wontfix | 刻意设计：arc-backfill.ts:201 注释表明对事务边界有明确意识（drizzle async 事务在 bun:sqlite 下不回滚），流程为读快照→校验/去重决策→BEGIN 后写入；单用户本地 SQLite 下另一连接改写窗口极小，且把读挪进事务并不能让去重决策更正确。 |
| C250 | packages/plugin/src/novel-writer/arc-progress.ts:21 | critical | bug | fix | arc-progress.ts:21-114 多处相互依赖写入无事务保护，中途失败留不一致状态；按仓库既有惯例（arc-backfill.ts:201-202 原生 BEGIN/COMMIT/ROLLBACK）包裹。 |
| H819 | packages/plugin/src/novel-writer/arc-progress.ts:21 | high | bug | wontfix | 冲突仓库风格：AGENTS.md 明确 Avoid try/catch where possible，错误传播到 tool execute 层由框架统一处理；与全仓其它 DB 函数行为一致，加 try-catch 属风格冲突且无行为收益。 |
| H818 | packages/plugin/src/novel-writer/arc-progress.ts:116 | high | bug | fix | arc-progress.ts:116 set(patch as never) 完全绕过类型检查；patch 仅含 StoryArcTable 已知列，改用 Partial<typeof StoryArcTable.$inferInsert> 或逐列构造即可消除 never 强转。 |
| H821 | packages/plugin/src/novel-writer/budget.ts:271 | high | bug | fix | budget.ts:254 计算的 indexBudget 未被使用、271 行仍用常量 INDEX_BUDGET，P5 紧张时索引导览会挤占 core 预算使总盘超限；改用 indexBudget。 |
| H816 | packages/plugin/src/novel-writer/chapter-normalize.ts:49 | high | bug | wontfix | 无暴露面：normalizeChapter 在全仓无任何调用方（src/test 均仅定义处），参数为类型化 string，加运行时防御检查不符合仓库风格。 |
| H817 | packages/plugin/src/novel-writer/chapter-normalize.ts:52 | high | bug | wontfix | 同上：normalizeChapter 无调用方，targetLength 为类型化 number 且不在信任边界，0/NaN 场景不可达，加校验属死代码。 |
| C252 | packages/plugin/src/novel-writer/chapter-rebuild.ts:64 | critical | bug | wontfix | 刻意设计：bun:sqlite 为同步驱动，async helper 只是 Promise 包装且复用同一 db 连接（chapter-rebuild.ts:90-93 传入 db），事务内顺序执行无交错；模块头注释声明「数据库写入使用事务，失败不留下半更新状态」，catch 中统一 ROLLBACK。 |
| H822 | packages/plugin/src/novel-writer/chapter-rebuild.ts:114 | high | bug | wontfix | chapter-rebuild.ts:110-113 catch 中原始错误 rethrow，仅吞掉 ROLLBACK 自身的次要错误；同步驱动下 ROLLBACK 失败仅发生于无活动事务时，无一致性风险，保留原错误是正确取舍。 |
| H820 | packages/plugin/src/novel-writer/chapter-rollback.ts:54 | high | bug | defer | 根治需在 ChapterVersionTable 加 (chapter_id, version) 唯一约束（涉及 novel-store schema 与 tui.tsx/cli.ts 多处 CREATE TABLE 副本）并改全仓 max+1 模式（novel-writer.ts:6275 nextVersion 同模式），属 schema 契约级变更；本工具并发回滚同一章场景几乎不存在。 |
| C251 | packages/plugin/src/novel-writer/chapter-rollback.ts:65 | critical | bug | fix | chapter-rollback.ts:68-87 备份版本插入与章节恢复更新是两个独立操作，中途失败留半提交状态；按仓库惯例包原生 BEGIN/COMMIT/ROLLBACK。 |
| C253 | packages/plugin/src/novel-writer/chapter-status.ts:61 | critical | bug | fix | chapter-status.ts:61-90 状态读-改-写无原子保护，并发调用可双过校验；按仓库惯例用原生事务包裹，或在 UPDATE 的 WHERE 中加 status=currentStatus 乐观锁。 |
| H825 | packages/plugin/src/novel-writer/chapter-status.ts:66 | high | bug | fix | chapter-status.ts:66 chapter.status as ChapterStatus 在 DB 值为 draft/outline 时（novel-store/src/index.ts:88 默认 draft、outline.ts:358 建章用 outline，均不在 CHAPTER_STATUSES）令 ALLOWED_TRANSITIONS[currentStatus] 为 undefined，canTransitionTo 的 .includes 抛 TypeError；需把未知状态纳入状态机或显式校验。 |
| H826 | packages/plugin/src/novel-writer/cli.ts:106 | high | bug | wontfix | 冲突仓库风格：AGENTS.md 要求避免 try/catch；createBook 已对题材校验给出友好错误（cli.ts:104-106），DB 约束错误文本可读并由 CLI 层统一兜底。 |
| H827 | packages/plugin/src/novel-writer/cli.ts:360 | high | bug | fix | cli.ts:360 JSON.parse 直接解析用户提供的文件，语法错误以无上下文 SyntaxError 崩出；包 try/catch 输出「导入文件不是合法 JSON」类友好错误（用户输入属信任边界，符合风格例外）。 |
| C254 | packages/plugin/src/novel-writer/context.ts:409 | critical | bug | wontfix | 误报：context.ts:396 .map(({ arc }) => { 是块体回调，418-426 的 const 声明与 427 的 return 都在回调体内正常执行，仅 411/437 行缩进不齐；代码可编译运行，unreachable/merge error 的判断不实。 |
| H824 | packages/plugin/src/novel-writer/drift-guards.ts:114 | high | performance | fix | drift-guards.ts:101-105 无 WHERE 全表扫描 character_states 再在内存按 characterIds 过滤；该表无 novel_id 列，改用 inArray(CharacterStateTable.character_id, [...characterIds]) 在 SQL 层过滤避免全表加载。 |
| H823 | packages/plugin/src/novel-writer/edit-sync-gate.ts:108 | high | bug | wontfix | 三条均不成立：(1) 加 try-catch 与仓库 Avoid try/catch 风格冲突，错误由 tool 层处理；(2) bun:sqlite 同步驱动顺序更新开销可忽略，Promise.all 同连接无收益；(3) 空数组 for 循环本就是 no-op 且 getDb 走缓存。 |
| H829 | packages/plugin/src/novel-writer/technique-extract.ts:49 | high | bug | fix | technique-extract.ts:49,94 llm() 网络异常会丢弃整批已收集结果；按模块自身容错设计（parseFailures 计数）把单次调用失败计入 parseFailures 并 continue 该分段。 |
| H828 | packages/plugin/src/novel-writer/technique-hindsight.ts:10 | high | bug | wontfix | 误报：technique.ts:70-72 sceneTypes/evidence 为必填数组类型，technique-normalize.ts:18-20 保证其存在（toCanonicalSceneTypes(partial.sceneTypes) 与 partial.evidence ?? []）；evidence[0]?. 是数组元素访问守卫而非数组 undefined 守卫，「不一致」判断不实。 |
| H999 | packages/plugin/src/novel-writer/tui.tsx:58 | high | bug | wontfix | 已有覆盖：tui.tsx:160-164 插件入口 try/catch（注释「数据库不可用，跳过」）包裹 hasNovels 调用，getDb 抛错同样被捕获并降级跳过向导，处理已在失败点上游闭环。 |
| C256 | packages/schema/src/credential.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H831 | packages/schema/src/event.ts:88 | high | bug | wontfix | 引用相等恰好匹配注册模型：definition 均为模块级单例（schema/src/event.ts:42-70 define() 每次新建对象），latest() 把'同一对象被多个清单重复收录'视为合法去重（80-83 行直接 set 跳过），'两个不同对象声明同一 type'（88 行抛错）才是真正的重复注册错误；Effect Schema 无廉价可靠的结构相等比较，放宽会削弱守卫 |
| C255 | packages/schema/src/file-diff.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C257 | packages/schema/src/mcp-event.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H833 | packages/schema/src/permission-saved.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H832 | packages/schema/src/project-copy.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C258 | packages/schema/src/prompt-input.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H834 | packages/schema/src/pty-ticket.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C259 | packages/schema/src/pty.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H835 | packages/schema/src/pty.ts:16 | high | security | wontfix | ascending(id?) 是全仓库统一的'采纳既有 ID 或新建'约定（opennovel/src/session/schema.ts:13、tool/schema.ts:12、sync/schema.ts:9、workspace.ts:493 均同构）；Pty.ID.ascending 目前无任何带参调用方，且外部 pty id 输入在 protocol 边界经 params:{ptyID: Pty.ID} decode 校验（protocol/src/groups/pty.ts:52-120），无校验绕过路径 |
| H836 | packages/schema/src/question.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C260 | packages/schema/src/session-delivery.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H842 | packages/server/src/annotation-targets.ts:24 | high | bug | wontfix | 契约被误读：annotation-targets.ts:15 注释明确 null 仅表示'目标不存在或不属于当前 novel'，不承诺吞错；若把 DB 错误返回 null，novel.ts:1867 会把它误报成 404 novelNotFound，掩盖基础设施故障；当前抛错进 Effect 错误通道才是正确语义，且符合 avoid try/catch 约定 |
| H846 | packages/server/src/auth.ts:44 | high | security | fix | 改用 crypto.timingSafeEqual 做常量时间密码比较（长度不等先返回 false 避免其抛错），替换 auth.ts 的 === 字符串比较 |
| H844 | packages/server/src/cors.ts:11 | high | security | wontfix | 刻意设计：cors.ts:10-11 无 Origin 即放行是为非浏览器客户端（CLI/桌面/侧车请求不带 Origin），CORS 本质是浏览器强制机制、非认证边界；改成 false 会直接打断 CLI/桌面全部请求，白名单（localhost/oc://renderer/tauri/opennovel.ai/opts.cors）已覆盖浏览器面 |
| C261 | packages/server/src/handlers/credential.ts:7 | critical | security | wontfix | 单用户模型下 BOLA 前提不成立：middleware/authorization.ts 用全局 Basic 认证（OPENNOVEL_SERVER_PASSWORD 单用户名/密码）包装全部端点，无多用户/属主概念；core integration 的 connection.update/remove（core/src/integration.ts:173-176）本身就没有用户维度，加属主校验是无意义的空操作 |
| C262 | packages/server/src/handlers/event.ts:11 | critical | bug | fix | 真实缺陷：EventV2.all() 承载全量事件，发布方经 EventV2Bridge（event-v2-bridge.ts 包同一 core EventV2.Service 实例）会发出 ServerDefinitions 之外的类型（TuiEvent.ToastShow mcp/index.ts:304/315、McpEvent.ToolsChanged:451、VcsEvent.BranchUpdated vcs.ts:328、LspEvent.Updated lsp.ts:293 等），encodeUnknownSync 抛错会炸掉整条 SSE 流；修复=编码前按 OpenNovelEvent schema 过滤/跳过不合规事件并记日志，端点契约不变 |
| H845 | packages/server/src/handlers/event.ts:30 | high | bug | wontfix | 刻意背压设计：core/src/event.ts:152-162 用 Queue.dropping(256)+Queue.fail 专用 SubscriberOverflowError 熔断慢消费者，断连即背压信号，SSE 客户端断线自动重连并可经 durable 流恢复；加重试无意义（慢消费者会立即再次溢出），容量 256 与心跳/haltStrategy 均为有意配置 |
| C263 | packages/server/src/handlers/permission.ts:63 | critical | bug | wontfix | 误报：Effect 4 的 Schema.TaggedErrorClass 官方定义为 yieldable error（effect/src/Schema.ts 文档示例即 yield* new NotFound(...)），return yield* missingRequest(...) 正确进入错误通道并按 httpApiStatus:404 返回；同款模式遍布 question.ts:21、message.ts:35、provider.ts:24、pty.ts:125、session.ts:377 |
