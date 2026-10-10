# Tasks

依据：proposal.md、design.md（D1–D4）。

## 1. cli.ts 连接收编（D1）

- [x] 1.1 逐表比对 cli.ts CREATE_TABLES_SQL（15 张）与 novel-store CREATE_TABLES_SQL（44 张）同名列定义，差异清单记入 design.md Risks 节（比对方法：按表名抽取列定义逐字段 diff；验证：清单落盘且确认 novels/volumes/chapters/chapter_versions/characters/character_states/chapter_summaries/foreshadowing/novel_state_log/plot_threads/relationships/session_novel/style_guide/volume_summaries/world_entries 15 张全覆盖）
- [x] 1.2 修改 packages/plugin/src/novel-writer/cli.ts：删除本地 getDbPath（:71-75）、_db 单例与私有 getDb（:95-106）、CREATE_TABLES_SQL（:77-93）及 drizzle/bun-sqlite/BunSqlite 三个 import；新增 import { getDb } from "@opennovel-ai/novel-store"；调用点 getDb()（:149/:194/:213）保持不变；保留本地表定义（:36-66）；同步改写文件头 :5 注释（私有连接层已删除）（验证：packages/plugin 目录 bun typecheck 通过）
- [x] 1.3 在 design.md Context 记录调用点核查结论：createBook/createBookAndTagSession/initNovelProject 全仓递归 grep（opennovel/src、plugin/src 含子目录）无生产调用点，仅测试直连与 cli 内部自调用（验证：grep 输出附在结论旁）

## 2. novel-writer 测试 env 卫生（D2）

- [x] 2.1 修 chapter-length-limit.test.ts：模块级捕获(:19)与设置(:21)移入 beforeAll 开头（prevOpenNovelDb = process.env.OPENNOVEL_DB 后再设置）；模块级保留 TLA(:20) 与 mkdirSync(:22)；afterAll 改为恢复 beforeAll 所存值，closeDb(projectDir) 保持在恢复前（验证：与 e2e.test.ts 配对跑 12 项全绿）
- [x] 2.2 修 e2e.test.ts：模块级捕获(:24)与设置(:26)移入 describe 内新增 beforeAll 先存后设，模块级保留 TLA(:25)；afterAll 改为恢复 beforeAll 所存值，closeDb(projectDir) 保持在恢复前；改写 :20 失效注释（"必须在模块导入前设置"不再成立，改为说明 lazy 解析 + beforeAll 设置的原因）（验证：单跑 e2e 7 项全绿）
- [x] 2.3 修 review.test.ts：删除模块级捕获/设置(:17-18)，在既有 beforeAll(:34) 开头先存后设；afterAll 恢复 beforeAll 所存值，closeDb() 保持在恢复前；改写 :15 失效注释（验证：review 单跑全绿）
- [x] 2.4 修 runtime-assembly.test.ts：模块级捕获/delete(:41-42) 移入 describe 的 beforeAll 开头（先存 prev 再 delete，保持全文件测试窗口内 env 未设置语义，Bug 1 等目录回退用例依赖此前提）；afterAll 恢复 prev，保留 TempRoot 目录遍历 closeDb 与 rmSync（验证：runtime-assembly 单跑全绿）
- [x] 2.5 定位 packages/plugin/.novel 污染源：grep test 目录全部模块级 env 修改点，结合探针确认为何有 bare getDb() 在 env 空窗期落到 cwd；消除该路径（修测试或修调用点），删除误建的 packages/plugin/.novel。探针定位结论：state-log.md 污染源为 commitState(:1119) 传 db 句柄导致 directory 丢失、appendToMarkdown 经 getNovelDir() 硬编码 process.cwd()——修为 commitState 改传 directory、commitStateWithReport 经 getDbPath 同链推导日志目录；novel.db 污染源为 runtime-assembly Bug 2 负向用例裸调 getNovelForSession 触发 getDb() cwd 回退——修为用例显式传 projectDir；另将 cascade/recall/segment-rollup/setting-impact/state-commit-reliability/world-category/db-consistency 七处 afterAll 统一为先 closeDb 再清 env（setting-impact-gate closeDb 改显式 testDir），消除连接泄漏与误解析（验证：整目录 695/0 且跑完后 packages/plugin 下无 .novel 目录生成）
- [x] 2.6 整目录回归：packages/plugin 目录 bun test test/novel-writer --timeout 90000 全绿（含 e2e 与回归用例）

## 3. schema 测试修复（D3/D4）

- [x] 3.1 修 packages/schema/test/contract-hygiene.test.ts:57 与 v1-isolation.test.ts:20：new URL("../src", import.meta.url).pathname 改 fileURLToPath(new URL("../src", import.meta.url))（import { fileURLToPath } from "node:url"）；contract-hygiene:61 传给 Bun.file 的 URL 对象不动（验证：packages/schema bun test 两文件全绿）
- [x] 3.2 修 packages/schema/test/event-manifest.test.ts：计数断言更新为实测值（ServerDefinitions=58、Definitions=88、Latest=88、Durable=35）；Definitions.slice(40,43) 位置锚点改为 indexOf 相对顺序断言（PartDelta 在 Diff 前、Diff 在 Error 前）（验证：event-manifest 全绿，且新增事件场景下不依赖绝对位置）

## 4. 门禁

- [x] 4.1 packages/plugin、packages/schema 目录 bun typecheck 通过；仓库根 bun run lint 0 errors 且新增代码零告警（同文件清单对照法）
- [x] 4.2 packages/schema bun test 全绿；packages/plugin 全目录测试全绿；提交推送，footer 带 OpenSpec-Change: test-suite-hygiene

## Implementation Commits

- `e19c15fa` fix(plugin): cli 数据访问收编 novel-store 共享连接
- `055a51cc` fix(plugin): 状态日志目录随连接推导并修复测试 env 卫生
- `9c9d85ef` test(schema): 修复 Windows 路径与事件清单断言漂移
