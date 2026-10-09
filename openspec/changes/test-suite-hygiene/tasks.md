# Tasks

依据：proposal.md、design.md（D1–D4）。

## 1. cli.ts 连接收编（D1）

- [ ] 1.1 逐表比对 cli.ts CREATE_TABLES_SQL（15 张）与 novel-store CREATE_TABLES_SQL（44 张）同名列定义，把差异结论记入 design.md（比对方法：按表名抽取列定义逐字段 diff；验证：差异清单落盘）
- [ ] 1.2 修改 packages/plugin/src/novel-writer/cli.ts：删除本地 getDbPath 副本、_db 单例、CREATE_TABLES_SQL 及 drizzle/BunSqlite 仅服务私有连接的 import；改为从 @opennovel-ai/novel-store 导入 getDb 并在原调用点使用 getDb(null)（nodenext 包引 novel-store 用包根既有惯例，typecheck 验证导入路径可行）；cli 内 drizzle table 定义若仅服务已删 SQL 则一并清理（验证：packages/plugin 目录 bun typecheck 通过）
- [ ] 1.3 验证 cli 导出函数调用点无跨 env 依赖单例行为：全仓 grep createBook / createBookAndTagSession / initNovelProject 调用点，确认无生产路径在进程内切换 OPENNOVEL_DB（验证：调用点清单列出并人工确认）

## 2. novel-writer 测试 env 卫生（D2）

- [ ] 2.1 修 chapter-length-limit.test.ts：模块级 originalOpenNovelDb 捕获与 OPENNOVEL_DB 设置移入 beforeAll（先存后设），afterAll 恢复 beforeAll 所存值；模块级保留 TLA 与 mkdirSync（验证：与 e2e.test.ts 配对跑 12 项全绿）
- [ ] 2.2 修 e2e.test.ts：模块级 env 设置（:26）移入 describe 的 beforeAll（新增），afterAll 恢复 beforeAll 所存值；原 afterAll 中基于模块级捕获值的恢复同步改（验证：单跑 e2e 7 项全绿）
- [ ] 2.3 修 review.test.ts：模块级捕获+设置（:17-18）移入 beforeAll，afterAll 恢复 beforeAll 所存值（验证：review 单跑全绿）
- [ ] 2.4 修 runtime-assembly.test.ts：模块级 delete env（:42）移入对应测试体/beforeAll，afterAll 恢复逻辑同步改（验证：runtime-assembly 单跑全绿）
- [ ] 2.5 定位 packages/plugin/.novel 污染源：grep test 目录全部模块级 env 修改点，结合探针确认为何有 bare getDb() 在 env 空窗期落到 cwd；消除该路径（修测试或修调用点），删除误建的 packages/plugin/.novel（验证：整目录跑完后 packages/plugin 下无 .novel 目录生成）
- [ ] 2.6 整目录回归：packages/plugin 目录 bun test test/novel-writer --timeout 90000 全绿（含 e2e 与回归用例）

## 3. schema 测试修复（D3/D4）

- [ ] 3.1 修 packages/schema/test/contract-hygiene.test.ts 与 v1-isolation.test.ts：new URL(...).pathname 改 fileURLToPath(new URL(...))（import { fileURLToPath } from "node:url"）（验证：packages/schema bun test 两文件全绿）
- [ ] 3.2 修 packages/schema/test/event-manifest.test.ts：计数断言更新为 58/88/88/35；Definitions.slice(40,43) 位置锚点改为 indexOf 相对顺序断言（验证：event-manifest 全绿，且新增事件场景下不依赖绝对位置）

## 4. 门禁

- [ ] 4.1 packages/plugin、packages/schema 目录 bun typecheck 通过；仓库根 bun run lint 0 errors 且新增代码零告警（同文件清单对照法）
- [ ] 4.2 packages/schema bun test 全绿；packages/plugin 全目录测试全绿；提交推送，footer 带 OpenSpec-Change: test-suite-hygiene
