# Design

## Context

见 proposal.md - Why。两组失败的当前状态：

- novel-store 的 getDb(directory?) 按调用时解析路径（env > directory > cwd），按路径缓存连接，closeDb/closeDbPath 可驱逐（packages/novel-store/src/index.ts:706, 840-888）。
- plugin cli.ts 自己维护一套 getDbPath + _db 单例（packages/plugin/src/novel-writer/cli.ts:68-106），首次调用绑定后永不重解析，且不在 novel-store 缓存里，closeDb 够不到它。
- e2e 写入路径走 cli.getDb()，读取路径（generateMasterOutline 等）走 novel-store getDb(projectDir)，两条通道在 env 变化后分裂。
- 四个 novel-writer 测试文件在模块顶层修改 OPENNOVEL_DB（chapter-length-limit、e2e 在顶层设置；review 在顶层设置；runtime-assembly 在顶层 delete），bun 同进程加载多文件时模块求值与测试执行交错，先跑文件残留的 env 值会污染后跑文件。

## Goals / Non-Goals

**Goals:**

- cli 数据访问与 novel-store 收敛到同一连接生命周期：按调用解析、按路径缓存、可被 closeDb 驱逐。
- novel-writer 目录级任意组合跑测试文件结果稳定（配对与整目录一致）。
- schema 包测试在 Windows 本地与双平台 CI 全绿。

**Non-Goals:**

- 不改 env 优先级语义（env > directory > cwd 维持现状）。
- 不为测试引入新的产品行为开关或测试专用生产代码路径。

## Decisions

### D1: cli.getDb() 委托 novel-store getDb(null)，而非保留私有缓存加失效开关

cli 私有 getDbPath() 与 novel-store getDbPath(null) 语义完全一致（env > cwd 兜底），委托后路径解析零变化，连接自动纳入 _dbCache 与 closeDb 管理，写读两侧天然同一连接。

- 备选：给 cli 单例加 env 变更检测（比较当前 env 与绑定时的值）→ 否决：治标不治本，连接仍不受 closeDb 管理，且每次调用多一次比较；委托是一次性收敛。
- 备选：把 novel-store 的解析逻辑复制进 cli → 否决：重复代码，两个真源。

实施要点：删除 cli.ts 本地的 getDbPath 副本与 _db/drizzle/BunSqlite 相关 import，getDb() 改为 from "@opennovel-ai/novel-store" 导入 getDb 后的薄封装（同名函数遮蔽外部 import 的惯用法不可行，直接删除本地函数、让 cli 内调用点改用导入的 getDb(null)）；删除本地 CREATE_TABLES_SQL（15 张表为 novel-store 44 张子集，列定义逐表比对后以 novel-store 为准，比对结果记录在本文件）。注意 cli.ts 内 drizzle table 定义（session_novel 等）如仅服务本地 SQL 则一并清理 import。

### D2: env 修改收编进 beforeAll/afterAll，值在 beforeAll 内"先存后设"

bun 测试执行阶段严格串行，模块顶层求值阶段会交错。把 env 捕获+设置移进 beforeAll、恢复移进 afterAll 后，每个文件对自己窗口内的值负责，与模块求值顺序解耦。runtime-assembly 模块级的 delete env 同样移入对应测试/beforeAll。

- 备选：保持模块级设置，只修 cli 单例 → 不够：模块级 env 窗口仍会把 novel-store 侧 getDb 引到 cwd 兜底（packages/plugin/.novel 污染源），且 afterAll 恢复模块级捕获值仍会错序覆盖后跑文件的 env。

### D3: event-manifest 位置锚点改为顺序相对断言

Definitions.slice(40, 43) 锚定绝对位置，新增事件即漂移。改为断言 PartDelta/Diff/Error 三个定义在 Definitions 中保持相对顺序（indexOf 递增），计数断言更新为当前真实值 58/88/88/35。

- 备选：更新 slice 下标到当前位置 → 否决：下次新增事件同样会挂，治标不治本。

### D4: URL 路径用 fileURLToPath

new URL(...).pathname 在 Windows 产出 /C:/... 形式，Bun.Glob scanSync 直接 ENOENT。改 fileURLToPath(new URL(...))（node:url），跨平台行为一致。

## Risks / Trade-offs

- [cli 15 张表与 novel-store 同名列定义存在差异] → 实施时先逐表 diff；若 cli 侧有更宽约束，以 novel-store 为准并跑 plugin 全目录测试验证（既有测试覆盖建表与读写）。
- [删除 cli 私有连接后，有调用点依赖单例的"跨 env 不变"行为] → 全仓 grep cli.ts 导出函数调用点（createBook 等），确认所有调用场景都在同一进程内使用同一 env；测试全绿即证据。
- [runtime-assembly 模块级 delete env 的测试本意是验证 unset 行为] → 移入测试体后语义不变（该测试本就断言 unset 时回退 directory）。
- [packages/plugin/.novel 污染源定位耗时] → 任务内设专门一步定位（grep 模块级 env 修改 + 探针），定位为可交付物，不阻塞主修复。

## Migration Plan

无需数据迁移：建表 SQL 为子集且以 novel-store 为准，对现有本地 novel.db 无格式变更。回滚 = revert 本分支提交。
