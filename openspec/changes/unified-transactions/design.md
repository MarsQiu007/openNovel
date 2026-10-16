# Design: unified-transactions

## Context

动机见 proposal.md - Why。与方案直接相关的现状：

- 仓库同时存在两种事务机制：ORM 同步回调事务（novel-store 的 4 个写入助手、world-map 两个草稿函数与 opennovel 同步 worker 的一处落库事务在用）与手写 `BEGIN`/`COMMIT`/`ROLLBACK`（plugin 的 5 处）。state-commit.ts、arc-progress.ts 与 arc-backfill.ts 里的注释声称「drizzle 的 async transaction 在 bun:sqlite 下不回滚」，该认知已过时——本变更前用临时脚本（`%TEMP%\verify-node.mjs` / `%TEMP%\verify-bun.ts`）实测：**同步回调**事务在 node:sqlite 与 bun:sqlite 下回滚均生效，嵌套 `tx.transaction` 在两种运行时都按 savepoint 正确提交/回滚；不回滚的只是异步回调形态。
- 事故链：10/13 批次修复给实体引用扫描助手包了 ORM 事务，而章节重建管线内部有更早存在的手写 `BEGIN`，助手被外层事务包裹 → node:sqlite 下第二条 `begin` 报 `cannot start a transaction within a transaction`（drizzle 包装为 `Failed to run the query 'begin'`，与用户库中失败队列条目记录一字不差）；bun 下嵌套 `BEGIN` 静默通过，所以 CI 全绿、用户机器必失败。
- 驱动按运行时分流：novel-store 的 `package.json` 用 conditional imports `#driver`——bun 解析到 bun:sqlite 驱动，node（Electron sidecar）解析到 node:sqlite 驱动，包出口直接指向 TS 源码。
- 5 处手写 BEGIN 全部在 `packages/plugin/src/novel-writer/`：chapter-rebuild.ts、state-commit.ts、chapter-rollback.ts、arc-progress.ts、arc-backfill.ts。经逐事务体扫描，其中只有 chapter-rebuild 的事务体内调用了自带事务的助手（实体引用扫描），即唯一的事故组合点；其余 4 处事务体内只有直接写入。
- 自带事务的写入助手共 4 个（均在 novel-store）：实体引用扫描、手动编辑同步入队、书籍元数据保存、审批请求。它们当前的实现已是「同步回调 + 同步语句」，拆双形态是纯机械改动。
- 既有 ORM 组合点事务共 3 处：world-map 两处（见 D2 豁免）与 opennovel 手动编辑同步 worker 的一处（`db.transaction((tx) => applySyncEntry(tx, …))`，manual-edit-sync-worker.ts:112）。worker 事务体内只有直接写入、当前无嵌套风险，但它是升级 Phase 2 重建任务的消费方——本次一并迁移到 `withTransaction`，让嵌套检测覆盖「重建 handler + 落库回写」整条消费链。
- Phase 1 确定性回填（`runDeterministicUpgrade`，novel-store/upgrade.ts）当前四步**无事务包裹**：第 3 步调用的实体引用扫描自包事务所以不炸，但四步非原子——中途失败会留下半成品派生数据。
- 既有先例：`packages/plugin/test/novel-writer/db-consistency.test.ts` 用 bun:test + glob 扫描源码做静态守卫；CI（test.yml）已有 `unit` / `e2e` 两个 job，Node 已固定 24 / 24.15。

## Goals / Non-Goals

设计层面边界（提案非目标不再重复）：

- 统一入口的行为契约先于实现：`withTransaction(db, fn)` 对三种错误形态（异步回调、嵌套事务、普通抛错）分别给出「回滚 + 可读错误」。
- 双形态拆分**不新增持久化层级、不改任何函数的可观测返回值与错误类型**（`foo` 的对外签名与现状一致，只是内部改道统一入口）。
- 守卫测试只拦两类已证实有事故先例的模式（手写 BEGIN、组合形态内再开事务），不做宽泛的静态分析，避免误伤迁移脚本的 `exec("BEGIN")` 字符串形态。
- node-runtime 测试只覆盖「事务纪律」相关链路（升级编排、章节重建全链路、Phase 1 原子性、嵌套 savepoint），不重跑 bun 全量测试。

## Decisions

### D1：唯一机制选 ORM 同步回调事务，消灭手写 BEGIN

5 处手写 `BEGIN` 全部改走新增的 `withTransaction`（内部即 ORM 同步回调事务）。

- **为什么不用最小补丁**（只把 chapter-rebuild 的 BEGIN 拆掉、其余不动）：事故类别是「两套机制无纪律地组合」，修一个组合点不阻止下一个组合点；且 state-commit.ts 里「drizzle 事务不回滚」的错误注释会继续误导后人。
- **为什么选 ORM 回调而不是保留手写 BEGIN、拆掉助手事务**：手写事务把「忘记 COMMIT/ROLLBACK」「异常路径漏 ROLLBACK」的责任留给每个调用点（state-commit 现在就带着 try/catch + 手动 ROLLBACK 的样板）；ORM 回调把提交/回滚收敛到入口一处，回调返回即提交、抛错即回滚。
- **同步回调的语义依据**：双运行时实测（见 Context）证明同步回调回滚有效；异步回调在驱动层不落同一事务才是不回滚的根因，因此入口对异步回调直接拒绝（D3）。

### D2：事务归属——组合点开事务，助手提供双形态

4 个写入助手拆为 `foo`（自包：内部 `withTransaction(db, tx => fooTx(tx, …))`，供无事务上下文调用）与 `fooTx`（组合形态：首参为事务对象，函数体同步、不得再开事务）。组合点规则：

- 编排多步写入的流程（升级编排、章节重建、状态提交等）负责开事务，事务体内一律调用 `*Tx` 形态。
- 单点写入、无组合需求的调用方（server handler 等）继续用自包形态，不感知事务。
- world-map 两个既有草稿函数（promoteWorldMapDraft / replaceWorldMapDraft）本就是组合层自包事务且体内只有直接写入，**保持不动**——它们已符合纪律，只是历史写法直接调 ORM；本次不为了「看起来统一」而改动无风险的代码（降低改动面）。
- opennovel 同步 worker 的落库事务（`applySyncEntry`）从裸 `db.transaction` 迁移到 `withTransaction`：事务体本就同步、只有直接写入，迁移是纯机械改动；迁移后该组合点获得嵌套检测，与章节重建管线的 `withTransaction` 前后衔接成一条受检链。
- 审批请求助手当前无活跃调用方，仍按同一纪律拆双形态，防止未来组合点踩同一类坑。

**否决的替代**：① 助手永远自包、组合点不支持事务——Phase 1 原子化与状态提交的多步语义无法表达；② 全部只留传事务对象的单形态——所有无事务调用方（含 server handler、测试）都被迫先开事务，噪音大于收益。

### D3：`withTransaction` 强制同步回调 + 特性探测式嵌套检测

新增 `packages/novel-store/src/tx.ts`，导出 `withTransaction(db, fn)`：

1. **嵌套检测（先决）**：通过驱动对象特性探测取「当前是否处于事务中」标志（bun 驱动暴露 `inTransaction`，node 驱动暴露 `isTransaction`，两者都不存在则该运行时无检测能力）。已处于事务中时抛出可读错误（指明嵌套事务、指向 `*Tx` 形态），而不是依赖驱动的嵌套行为（bun 静默放行 / node 报错信息不友好）。
2. **同步强制**：调用回调后检查返回值，是 thenable 即抛错——此时事务内尚无写入或已有部分写入，抛错触发回滚，杜绝「异步回调看似有事务实际无保护」的假象。
3. **正常路径**：`db.transaction((tx) => …)` 同步回调，回调抛错由 ORM 回滚。

**为什么检测用特性探测而非 Node 版本判断**：Electron 内置 node 与 CI node 版本可能不同步，特性探测对「有没有这个能力」直接负责；老运行时（两者皆无）降级为不检测，行为与现状一致，不在热路径引入版本比较。

**为什么拒绝异步回调而不是支持它**：驱动语句本就同步执行，异步回调里的写入不会落入外层事务（这是「不回滚」传闻的真实来源）；支持异步等于内置一个静默陷阱，拒绝则把错误提前到开发期。

### D4：防回归双闸门——静态守卫（bun）+ 运行时覆盖（node CI）

- **静态守卫测试**（跟随 bun 测试跑，秒级反馈）：① 扫描 plugin/src、novel-store/src 与 opennovel/src 源码，出现 `` sql`BEGIN` `` 模板语句即失败（正则只匹配 drizzle 模板字面量形态，`migrate.ts` 的 `exec("BEGIN")` 字符串形态天然不匹配，注释中的 `` sql`BEGIN` `` 也按出现即拦——迁移后注释里不允许再留这种示例）；② 扫描 4 个 `*Tx` 函数体，出现再开事务调用即失败。先例即 db-consistency.test.ts 的 glob + 正则模式。
- **node-runtime 测试任务**（test.yml 新增 job，Node 固定 24.x，与现有 setup-node 一致）：用 `node --test` 在真实 node:sqlite 下跑四类场景——同步队列消费 + 真实章节重建 handler 全链路、Phase 1 四步原子性（第 3 步注入失败 → 第 1、2 步回滚）、嵌套 savepoint 提交/回滚、`withTransaction` 三错误形态。
- **为什么两个都要**：静态守卫在 bun 下秒级反馈、零环境成本，能在 node CI 跑起来之前先拦住手写 BEGIN 回流；node CI 覆盖真实运行时的行为差异（bun 静默放行的嵌套在 node 报错这类陷阱只有真跑才暴露）。单一闸门都做不到对方的覆盖。

### D5：node-runtime 测试用 `bun build --target=node` 打包后由 node 执行

node-runtime 测试文件写在既有 test 目录旁（如 `packages/opennovel/test-node/`、`packages/plugin/test-node/`），用 `node:test` 风格编写；CI 里先用 `bun build --target=node` 把测试入口打成单文件（`#driver` 的 node 条件自动解析到 node:sqlite 驱动），再 `node --test` 执行产物。

- **为什么不用 Node 原生 type stripping 直接跑 TS**：包内相对导入使用 `.js` 扩展名映射 `.ts` 源码（如 driver.node.ts 引 `./migrate.js`），Node 原生 ESM 不做这个重写，会解析失败。
- **为什么不加 tsx 等 devDependency**：bun 已是仓库固定工具链，`bun build` 零新增依赖达成同样效果；若打包在实现期遇到未预见障碍，退路才是评估 tsx（记入任务验收标准：node 测试 job 在 CI 绿才算完成）。
- Electron sidecar 的真实加载路径不受影响：该路径继续走它自己的打包产物，本测试只验证「novel-store + plugin 在 node:sqlite 下的行为」，不验证 sidecar 打包。

### D6：Phase 1 原子化落在 novel-store 的 `runDeterministicUpgrade`

Phase 1 四步收进单个 `withTransaction`，第 3 步实体引用扫描改调组合形态。归属判断：该函数本身就是组合点（编排四步写入），且位于 novel-store 层，与「组合点开事务」纪律一致；调用方（server handler / 测试）继续拿到同步执行的四步结果，签名不变。注意前置条件：第 2 步 `ensureSegmentSummaries` 当前是 async，须先按 D7 同步化，否则其写入会逃逸到提交后。

### D7：同步强制的传导边界——事务体内调用的辅助函数一并同步化

强制同步回调意味着事务体内不得出现 `await`，**这同样适用于事务体内调用的辅助函数**：异步函数在同步回调里被调用时，执行到第一个 `await` 即挂起、续体进入微任务队列，会在事务提交后才运行——写入看似在事务内、实际落在提交后，原子性形同虚设（`ensureSegmentSummaries` 是现成反例：4 处 await 全部压在写语句上）。本次需同步化的辅助函数清单：

- novel-store：`ensureSegmentSummaries`（Phase 1 第 2 步与章节重建事务体都在事务内调用它）。
- plugin 状态提交事务体：`resetChapterScopedState`、`applyToMaterializedView`、`syncChapterSummaryFts`、`applyImpact`。
- plugin 章节重建事务体：`syncChapterSummaryFts`（`ensureSegmentSummaries` 已由 novel-store 侧同步化覆盖）。

行为安全依据：上述函数的 await 全部是同步驱动返回的非 thenable 值，`await` 只把续体推入微任务、不改变求值结果，去 async/await 后执行结果与「在调用点内完成」的时序完全一致；调用方残留的 `await` 对非 thenable 值兼容（`await 5 === 5`），无需联动修改调用方。唯一例外形态：state-commit 日志写入的 `await db.insert(...).values(...)`（无 `.run()`，靠 thenable 触发执行）——去 await 时必须补上 `.run()`，否则语句根本不执行。

## Risks / Trade-offs

- [同步回调内不能 `await`，改造 5 处手写事务时需要把事务体内的 `await db…run()` 改为同步语句，且事务体内调用的辅助函数也要一并同步化（D7）] → 这些 `.run()` 在 bun/node 驱动下本就同步返回，去掉 await 是行为安全的机械改动；同步化清单与「裸 await 语句须补 .run()」的例外形态见 D7。state-commit 事务体较大（含 append-only 日志、物化视图、FTS、级联统改），是本次改动面最大的单点，安排在 tasks 里单独一步并先跑其专属测试文件。
- [`withTransaction` 嵌套检测在 bun 下会让「以前静默放行」的嵌套立即报错] → 这正是目的（把潜伏炸弹提前引爆）；改造完成前全仓已扫描确认无其他嵌套组合点，CI 双运行时全绿即证明。
- [守卫测试的「注释里也拦」策略可能拦下将来合理的注释示例] → 可接受：迁移完成后事务相关注释本来就不该再出现 `` sql`BEGIN` `` 字样；真要引用，注释中隔写（如 `BEGIN 语句`）即可绕过，正则只拦模板字面量形态。
- [node CI job 增加流水线时长与维护面] → 只跑四类事务场景的少量测试文件（非全量），时长可控；Node 版本与现有 setup-node 一致，无新增维护维度。
- [`bun build --target=node` 对个别依赖（如 effect）的打包行为若有坑] → 验收标准含 CI 全绿兜底；实现期若验证发现障碍，fallback 为 tsx 方案并同步更新本 design 的 D5。
- [Electron 内置 node 版本与 CI Node 24 不完全一致] → 事务行为由驱动特性探测 + drizzle 统一封装，不依赖具体小版本；spec 的「双运行时一致」以 bun + node 两族为界，族内版本差异由 drizzle 吸收。

## Migration Plan

- 无数据迁移、无 schema 变化：纯代码层机制整改，旧书数据直接可用。
- 部署顺序：novel-store（tx.ts + 双形态 + ensureSegmentSummaries 同步化）→ plugin（5 处转换 + 调用点改 *Tx + 事务体辅助函数按 D7 同步化）→ opennovel（worker 落库事务迁移 withTransaction）→ 守卫测试与 node 测试 → novel-store/AGENTS.md 文档。每一步独立可验证（typecheck + 包级测试）。
- 回滚策略：还原代码即回滚（无持久化层变化）；此前失败书籍（《执棋人》）的 failed 队列条目沿用既有显式重试路径完成升级，无需一次性数据修复脚本。
- 用户侧动作：修复发布后，用户在升级视图对失败章节显式重试即可；Phase 1 原子化保证重试不会叠加半成品。

## Open Questions

无。D5 的打包细节（入口文件组织、glob 配置）属实现期决定，不改变 specs / 任务结构。
