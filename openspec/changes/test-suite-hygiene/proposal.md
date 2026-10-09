# Proposal

## Why

仓库测试套件存在两组长期失败，Windows 本地与 CI（test workflow 跑 bun turbo test，linux + windows）均为红，测试信号已不可信：

1. **packages/schema 4 个测试失败**。contract-hygiene 与 v1-isolation 用 new URL("../src", import.meta.url).pathname 扫描源码目录，Windows 上 pathname 产出 /C:/... 形式路径直接 ENOENT；event-manifest 硬编码的公开事件计数（55/85/85/32）与清单实际值（58/88/88/35）脱节，Definitions.slice(40, 43) 位置锚点随新增事件漂移。事件本体来自 fork 上游初始提交，断言是历史遗留过期值。
2. **packages/plugin novel-writer 目录级跑测试时 e2e 固定挂 6 个**。根因是 cli.ts 的私有连接单例：首次调用按当时 OPENNOVEL_DB 绑定连接后永不重解析，也不受 closeDb 管理；而 generateMasterOutline 等走 novel-store 的 getDb（按调用时 env 解析）。先执行的测试文件把单例绑到自己的临时库，e2e 的 createBook 写入旧库、读路径从新库查，步骤3 起全部 小说不存在。已用探针实证：cli.getDb 全程只绑定一次到先跑文件的临时库。

## What Changes

- **cli.ts 连接收编（生产代码缺陷修复）**：删除 cli.ts 私有 _db 单例与本地 getDbPath 副本，cli 内部 getDb() 委托 novel-store 的 getDb(null)。路径解析语义不变（同为 env > cwd 兜底），连接纳入按路径缓存与 closeDb 生命周期，与 novel-store 读取侧天然收敛到同一连接。已核对 cli 的 15 张建表是 novel-store 44 张表的子集，实施时逐表比对列定义后以 novel-store 为准。
- **novel-writer 测试 env 卫生**：chapter-length-limit、e2e、review、runtime-assembly 四个测试文件对 OPENNOVEL_DB 的模块级修改收编进 beforeAll（先存旧值再设置）/ afterAll（恢复所存值），消除跨文件 env 竞争；同时排查测试运行期 cwd 兜底建库（packages/plugin/.novel）的具体来源并消除。
- **schema 测试修复**：两处 new URL(...).pathname 改 fileURLToPath(new URL(...))（node:url）；event-manifest 计数断言更新为当前真实值，位置锚点断言（slice(40,43)）改为不随新增事件漂移的顺序相对断言。
- **回归验证**：packages/schema 测试全绿；packages/plugin 全目录测试（含 e2e 配对与整目录跑法）全绿。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本变更为缺陷对齐与测试基建修复，不引入新的 spec 级行为；.openspec.yaml 设置 skip_specs: true，与 2026-09-10-fix-opennovel-ci-tests 先例一致。）

## 非目标

- 不改 novel-store 的 OPENNOVEL_DB 优先级机制（env > directory > cwd 维持现状）。
- 不碰 e2e 业务断言与写作流水线任何行为语义。
- 不新增、不删除、不重命名任何公开事件；event-manifest 只更新测试断言。
- 不处理 novel-writer 目录之外的测试隔离问题（如发现新的独立问题，另开提案）。
- 不升级、不新增依赖。

## Impact

- **packages/plugin**：src/novel-writer/cli.ts（生产代码，连接生命周期对齐 novel-store）；test/novel-writer 下 chapter-length-limit / e2e / review / runtime-assembly 四个测试文件的 env 设置方式。
- **packages/schema**：test/contract-hygiene.test.ts、test/v1-isolation.test.ts、test/event-manifest.test.ts 三个测试文件。
- 数据兼容：建表 SQL 为子集关系且列定义经核对后以 novel-store 为准，对现有本地数据库文件无迁移需求；连接生命周期只影响进程内行为，不改落库格式。
- 调用面：cli.ts 导出函数（createBook 等）全仓递归 grep 无生产调用点，仅测试直连与 cli 内部自调用，变更风险面可控。
- CI：修复后 main 的 test workflow 在 Windows 与 Linux 上均应转绿（schema 计数断言双平台均失败）。
