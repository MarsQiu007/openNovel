# Proposal: unified-transactions

## Why

10 月 13 日批次修复给实体引用扫描助手包了 drizzle 事务后，书籍派生数据升级在桌面端（node:sqlite）从 Phase 1 第一步就必然失败：升级编排器自己开手写 `BEGIN` 事务，其第一步又调用自带事务的助手，node:sqlite 下第二条 `begin` 报「cannot start a transaction within a transaction」，升级任务整批 failed；Bun 下嵌套 `BEGIN` 静默通过，CI 全绿造成漏网，用户书籍（《执棋人》）实际无法升级。根因不是某一行写错，而是**仓库同时存在手写 BEGIN 与 drizzle 事务两套机制、且没有规则约束「谁开事务、谁能被事务包裹」**。打最小补丁（只改升级编排器或只拆一个助手）无法阻止同类组合下一次再出现，需要一次系统级的事务纪律整改：统一机制、明确归属、加上防回归闸门。

## What Changes

- **唯一事务机制**：消灭全部 5 处手写 `BEGIN`/`COMMIT`/`ROLLBACK`（章节重建、状态提交、章节回滚、弧光进度、弧光回填），统一改用 drizzle 同步回调事务；历史注释「drizzle 事务不回滚」已实测证伪（仅异步回调形态不回滚），同步回调在 node / bun 双运行时回滚均生效，注释一并清除。
- **事务归属双形态**：novel-store 中 4 个自带事务的写入助手（实体引用扫描、手动编辑同步入队、书籍元信息保存、审批请求）拆为 `foo`（自包事务，供无事务上下文调用）与 `fooTx`（接收调用方事务对象，供组合点内复用）双形态；组合点（升级编排、worker、章节重建等）统一负责开事务并传 `tx`。
- **统一事务入口**：novel-store 新增共享事务助手，强制同步回调（回调返回 Promise 即抛错并回滚）、在驱动支持时检测嵌套事务并抛出可读错误（特性探测：bun `inTransaction` / node `isTransaction`，老版本 node 降级为不检测）。
- **升级 Phase 1 原子化**：确定性回填四步骤（指纹基准、段摘要、实体引用、legacy 主轴转换）整段包进单事务，中途任一步失败整体回滚，不留半成品派生数据。
- **防回归三件套**：① 静态守卫测试——源码零手写 BEGIN 残留、`*Tx` 函数体不得再开事务；② CI 新增 node-runtime 测试任务（Node 版本固定 ≥ 24，与 Electron 内置同级），在真实 node:sqlite 下跑升级编排、章节重建全链路、Phase 1 原子性与嵌套 savepoint；③ novel-store 包文档补事务规则（谁开事务、双形态选用、同步回调约束），新写入路径必须先想清楚事务归属。
- 对外契约（HTTP 端点、同步队列语义、审批语义、数据模型）零变化，无数据迁移。

## 非目标

- 不改升级 / 手动编辑同步 / 审批的任何对外语义：队列条目状态机、失败重试、消费闸门、HTTP 端点与类型契约全部保持现状。
- 不动 schema 迁移脚本的字符串形态事务（`exec("BEGIN")` 走另一条守卫路径，不属于本整改范围）。
- 不拆 world-map 与审批模块现有的 `db.transaction` 自包调用点（它们体内只有直接写入、无嵌套风险，本次只统一机制、不挪动归属）。
- 不引入连接池、不改 SQLite 驱动选型、不做跨进程事务；事务纪律仍限单连接单进程。
- 不重构与事务无关的写入路径（如 FTS5 触发的间接写入链路本次只验证不改写）。
- 不改 AI 阶段（Phase 2）的批量调度与逐章失败语义——那是队列既有行为。

## Capabilities

### New Capabilities

- `store-transaction-discipline`：novel-store 数据层的统一事务纪律——机制唯一性（全仓只允许 drizzle 同步回调事务一种形态）、事务归属规则（组合点开事务、存储助手提供自包与吃事务对象双形态）、同步回调强制（异步回调即抛错回滚）、嵌套事务运行时检测（驱动支持时给出可读错误）、双运行时（bun / node:sqlite）行为一致且有静态守卫兜底。

### Modified Capabilities

- `derived-data-upgrade`：修订「两阶段回填执行」需求——Phase 1 四个确定性步骤在单个事务内原子完成，任一步失败整体回滚、不留半成品；其余需求（注册表、提示、预估、Phase 2 调度、失败重试、handler 注册）行为不变。

## Impact

- **packages/novel-store**：新增共享事务助手模块；4 个写入助手拆双形态；包文档补事务纪律章节。无 schema 变化、无数据迁移，旧书数据直接可用。
- **packages/plugin**：章节重建、章节状态提交、章节回滚、弧光进度推进、弧光回填 5 处手写事务全部改为统一事务助手；升级 Phase 1 四步骤收进单事务；新增静态守卫测试（先于 node CI 兜住手写 BEGIN 与 *Tx 内开事务两类回归）。
- **packages/opennovel / packages/server**：无直接改动；组合层（worker handler、升级编排入口）随 novel-store / plugin 的助手签名调整调用方式。
- **CI**：新增 node-runtime 测试任务，Node 版本固定 ≥ 24；覆盖升级编排、章节重建、Phase 1 原子性、嵌套 savepoint 四类场景。
- **packages/app / packages/desktop**：无改动（事务整改全部在数据层与流水线层，界面无感知）。
- **兼容性**：对外 API 契约、队列状态机、本地数据格式全部不变；修复后此前失败书籍（《执棋人》）可由用户显式重试完成升级，历史 failed 条目语义沿用既有重试路径。
