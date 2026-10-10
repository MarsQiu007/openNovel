# Design

## Context

见 proposal.md - Why。关键事实（均已对照源码核实）：

- novel-store 的 getDb(directory?) 按调用时解析路径（env > directory > cwd，src/index.ts:706），按路径缓存连接（_dbCache，:840），closeDb/closeDbPath 可驱逐（:879-888）；其 Db 类型为 driver.bun.ts:10 的无 schema 泛型 ReturnType<typeof drizzle>。
- plugin cli.ts 自己维护一套 getDbPath 副本 + _db 单例 + 私有 CREATE_TABLES_SQL（src/novel-writer/cli.ts:68-106），首次调用绑定后永不重解析，也不在 novel-store 缓存里，closeDb 够不到它。
- e2e 写入路径走 cli.getDb()，读取路径（generateMasterOutline 等）走 novel-store getDb(projectDir)，两条通道在 env 变化后分裂。探针实证：配对跑时 cli.getDb 全程只绑定一次到先跑文件的临时库。
- cli 的 15 张建表是 novel-store 44 张表的子集（表名 diff 已核实）；novel-store 不建 session 表，cli.getRecentSessionId 依赖 session 表缺失时 try/catch 回退（cli.ts:192-205），委托后该语义不变。
- novel-writer 测试文件中，cascade / recall / segment-rollup / setting-impact / state-commit-reliability / world-category / db-consistency 的 env 修改已在 beforeAll/afterAll 或测试体内（安全模式）；仅 chapter-length-limit（:19-21 模块级捕获/设置）、e2e（:24-26）、review（:17-18）、runtime-assembly（:41-42 模块级捕获/delete）四文件在模块顶层动 env。
- createBook / createBookAndTagSession / initNovelProject 唯一生产调用点是 opennovel CLI 命令（packages/opennovel/src/cli/cmd/novel.ts 的 init / book create）：终端场景 OPENNOVEL_DB 通常未设置，走 cwd 兜底，新旧解析语义一致，行为不变；其余调用均为测试直连。

## Goals / Non-Goals

**Goals:**

- cli 数据访问与 novel-store 收敛到同一连接生命周期：按调用解析、按路径缓存、可被 closeDb 驱逐。
- novel-writer 目录级任意组合跑测试文件结果稳定（配对与整目录一致）。
- schema 包测试在 Windows 本地与双平台 CI 全绿。

**Non-Goals:**

- 不改 env 优先级语义（env > directory > cwd 维持现状）。
- 不为测试引入新的产品行为开关或测试专用生产代码路径。
- 不顺手重构安全模式测试文件（cascade 等）的 afterAll delete 写法。

## Decisions

### D1: cli.getDb() 委托 novel-store getDb，删除私有连接层

删除 cli.ts 本地的 getDbPath 副本（:71-75）、_db 单例与私有 getDb（:95-106）、CREATE_TABLES_SQL（:77-93），改为 import { getDb } from "@opennovel-ai/novel-store"（包根导入为 cli.ts:16 既有惯例），原调用点 getDb()（:149/:194/:213）不变。路径解析语义不变（同为 env > cwd 兜底），连接自动纳入 _dbCache 与 closeDb 管理，写读两侧天然同一连接。

- 本地表定义（NovelTable/SessionTable/SessionNovelTable，:36-66）保留：novel-store 的 Db 是无 schema 泛型，插入本地表定义类型兼容；且 SessionTable 在 novel-store 无对应导出。清理范围仅 drizzle/bun-sqlite/BunSqlite 三个 import 与 _db 相关死代码。
- 备选：给 cli 单例加 env 变更检测 → 否决：治标不治本，连接仍不受 closeDb 管理；委托是一次性收敛。
- 备选：把本地表定义迁到 novel-store 导出表 → 否决：无类型收益，扩大 diff；列级一致性由任务 1.1 比对兜底。
- getRecentSessionId 的 session 表回退语义经核实不受影响（novel-store 建表 SQL 不含 session 表）。

### D2: env 修改收编进 beforeAll/afterAll，值在 beforeAll 内"先存后设"

bun 测试执行阶段严格串行，模块顶层求值阶段会交错。把 env 捕获+设置移入 beforeAll、恢复移入 afterAll 后，每个文件对自己窗口内的值负责，与模块求值顺序解耦：

- chapter-length-limit：模块级 capture(:19)+set(:21) 移入 beforeAll 开头（先存 prev 再设），模块级保留 TLA(:20，hooks 在 :81 使用) 与 mkdirSync(:22)；afterAll 保持 closeDb 在恢复前。
- e2e：模块级 capture(:24) 与 set(:26) 移入 describe 内新增 beforeAll（先存后设），模块级保留 TLA(:25，hooks 在 :564 使用)；afterAll 改为恢复 beforeAll 所存值（closeDb 仍在恢复前）。
- review：在既有 beforeAll（:34）开头先存后设；afterAll 恢复所存值，closeDb() 无参调用保持在恢复前。
- runtime-assembly：模块级 delete env(:42) 移入 Bug 1 测试体（:137）开头、测试末恢复，对照 :189-207 既有 prev 存取惯例；afterAll 随模块级捕获删除而移除其恢复逻辑（保留 TempRoot 目录遍历 closeDb 与清理）。
- 随移动改写失效注释：review:15 与 e2e:20 的"DB 路径必须在模块导入前设置"声明在 lazy 解析下本不成立，移动后必须改写以免误导。

- 备选：保持模块级设置，只修 cli 单例 → 不够：模块级 env 窗口仍会把 novel-store 侧 getDb 引到 cwd 兜底（packages/plugin/.novel 污染源），且 afterAll 恢复模块级捕获值会错序覆盖后跑文件的 env。

### D3: event-manifest 位置锚点改为顺序相对断言

Definitions.slice(40, 43) 锚定绝对位置，新增事件即漂移。改为断言 PartDelta/Diff/Error 三个定义在 Definitions 中保持出现顺序（indexOf 递增），计数断言更新为当前真实值（实测 server=58 / defs=88 / latest=88 / durable=35）。

- 备选：仅更新 slice 下标 → 否决：下次新增事件同样会挂，治标不治本。

### D4: URL 路径用 fileURLToPath

contract-hygiene.test.ts:57 与 v1-isolation.test.ts:20 的 new URL("../src", import.meta.url).pathname 在 Windows 产出 /C:/... 形式，Bun.Glob scanSync 直接 ENOENT；两处改 fileURLToPath(new URL(...))（node:url）。同文件内传给 Bun.file 的 URL 对象（contract-hygiene:61）不经 pathname，无需改动。

## Risks / Trade-offs

- [任务 1.1 结论·列定义比对] 10 张完全一致（chapter_versions/character_states/chapter_summaries/foreshadowing/novel_state_log/plot_threads/relationships/style_guide/volume_summaries/world_entries）；5 张差异均为 novel-store 列超集：novels+master_outline、volumes+outline、chapters+outline+content_fingerprint、characters+status；session_novel 差异为 cli 侧多一条 REFERENCES session(id) 外键（书库本无 session 表，该外键不可执行，收敛后语义不变）。结论：委托安全，对存量 novel.db 无影响（CREATE TABLE IF NOT EXISTS 不改已存在表）。
- [getRecentSessionId 行为差异] → 已核实：novel-store 建表 SQL 无 session 表，session 表缺失时 try/catch 回退不变。
- [运行时 cwd 兜底建库污染源定位耗时] → 任务 2.5 专步定位（grep 模块级 env 修改 + 探针），定位为可交付物，不阻塞主修复。
- [安全模式文件 afterAll 裸 delete env 残留] → 非目标；当前顺序下无受害者，如未来新增前置文件再统一。

## Migration Plan

无需数据迁移：建表 SQL 为子集且以 novel-store 为准，对现有本地 novel.db 无格式变更。回滚 = revert 本分支提交。
