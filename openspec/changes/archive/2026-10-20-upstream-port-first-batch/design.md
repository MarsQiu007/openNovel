# Design: upstream-port-first-batch

## 方案概述

本 change 分两阶段：先调研、后移植。design.md 在提案阶段只固化**调研方案**与候选的已知事实；移植方案由调研任务回填（见"待回填"节）。这样安排的原因：两个候选的关键前提（Playwright 版本命中、models.dev 数据流形态）都未经核实，先写死移植方案会重蹈 `streamUsage` 的误判。

## 阶段一：调研方案

### 调研 1：Playwright 版本命中（上游 23a33abad4）

- **上游改动面**（已核实，来自 `git show --stat`）：根与工作区 `package.json` 中 Playwright 版本声明提升，越过 Node 24.16+ 的安装挂起区间
- **待核实问题**：
  1. fork 根及各包 `package.json` 中 Playwright 的当前版本与声明方式（直接依赖 / `@playwright/test` / 传递依赖）
  2. fork 使用的 Node/Bun 版本组合是否落入挂起区间（挂起条件依赖 Node 版本）
  3. fork 的锁文件（bun.lock）中 Playwright 的实际解析版本
- **判据**：命中 → 移植版本提升；未命中 → 记录"当前不受影响"并在候选表移除，仅当未来升级 Node 时重启评估
- **产出**：本文件"待回填"节 + 调研结论一段

### 调研 2：models.dev 数据流（上游 6e9c85390b）

- **已知形态差异**：上游 `packages/core/src/models-dev/snapshot.txt`（目录+快照文件）；fork `packages/core/src/models-dev.ts`（单文件模块）+ `packages/core/src/plugin/models-dev.ts`
- **待核实问题**：
  1. fork 的 `models-dev.ts` 是内嵌快照还是运行时拉取 models.dev API？缓存策略是什么？
  2. fork 侧快照数据的生成方式（有无刷新脚本，类似上游 `script/` 下的刷新入口）
  3. 上游快照 `snapshot.txt` 的内容结构与 fork 消费的字段是否兼容
- **判据**：fork 存在等价刷新入口 → 用它刷新数据（数据追平，代码不动）；fork 无刷新入口 → 评估直接替换数据文件的可行性，仍不可行则降级为"季度审阅候选"
- **产出**：同上

## 阶段二：移植方案（调研后回填）

### 调研结论（2026-10-20）

**候选 1（Playwright，上游 23a33abad4）：成立，进入移植。**

- fork 根 `package.json` catalog 声明 `"@playwright/test": "1.59.1"`，bun.lock 解析 1.59.1（registry 为 npmmirror，tarball URL 与 integrity 均为镜像值）
- `packages/app/package.json` 经 `"@playwright/test": "catalog:"` 间接引用，无其他包直接声明
- 本机 Node v24.22.0，命中上游描述的 24.16+ 安装挂起区间；移植为预防性修复，同时也消除未来 CI/新环境的安装风险
- 移植落点：根 `package.json`（catalog 一处）+ bun.lock 四行（catalog 版本、`@playwright/test`、`playwright`、`playwright-core` 的版本与 npmmirror tarball URL、integrity）
- **适配点**：上游 bun.lock 用官方 registry，fork 用 npmmirror，不能照抄上游锁文件行；integrity hash 取自 npm registry `dist.integrity` 官方值（tarball 字节一致，镜像 hash 相同），三个包的新 hash 已逐一核对

**候选 2（models.dev 快照刷新，上游 6e9c85390b）：证伪，移除。**

- fork 数据流与上游形态根本不同：上游内嵌 `snapshot.txt`（bot 定期提交刷新）；fork **无内嵌快照**，构建期由 `packages/cli/script/generate.ts` 实时 `fetch` `https://models.dev/api.json`（或 `MODELS_DEV_API_JSON` 指定本地文件）注入构建全局 `OPENNOVEL_MODELS_DEV`，运行时侧 `packages/core/src/models-dev.ts` 优先读注入值，无则读全局缓存文件（Flock 防跨进程竞争），再无则在线拉取落盘，且支持 `OPENNOVEL_DISABLE_MODELS_FETCH` 关闭
- 上游"刷新快照内容"的提交在 fork 无对应落点——fork 构建时天然拿到最新数据，数据新鲜度优于上游的内嵌快照
- 唯一潜在价值：上游 snapshot.txt 可作为离线构建种子（经 `MODELS_DEV_API_JSON` 引入），属未来增强，记入季度审阅候选，不属于本 change

### 移植实施

- **Ported-from**: 23a33abad413d816d2c7fbcc5134eac8bf92a491（上游 bun.lock + 根 package.json 版本提升）
- **改动**：根 `package.json` catalog `1.59.1 → 1.60.0`；bun.lock 四处条目同步（版本 / npmmirror URL / integrity）
- **验证**：版本提升为依赖元数据变更，无源代码改动；因本机未安装 bun，`bun install` 与 `bun typecheck` 无法本地执行，以 npm registry integrity 三方核对 + 锁文件 diff 逐行复核代替，CI 安装/typecheck 为最终门槛

## 决策记录

| 决策 | 理由 |
| --- | --- |
| 排除 `streamUsage`（49f52ff2d5） | 2026-10-20 探索核实：该提交改动上游 `packages/ai/src/protocols/openai-chat.ts` 等文件，fork 无 `packages/ai`，无法移植；归入 `ai-package-alignment` 调研输入 |
| 排除快照"直接复制文件" | fork 与上游快照形态不同（目录 vs 单文件模块），直接复制会破坏 fork 的消费路径 |
| 调研先于 tasks 定案 | 避免为未验证前提虚构任务；tasks.md 的移植节为占位，调研后补充 |

## 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 调研发现两候选均不成立，change 空转 | 该结果本身有价值（证明 playbook 的评估闸门有效），归档时记录"首批候选全部证伪"并从季度审阅补充新候选 |
| models.dev 数据刷新引入模型目录回归 | 刷新后核对 fork 消费的关键模型（写作流水线依赖的 provider/model 标识）仍存在且字段完整 |
| Playwright 提升引发其他依赖连锁 | 版本提升后全量 `bun install` + 受影响包 typecheck，锁文件变更单独审阅 |

## 验证方式

- 调研阶段：结论与 fork 仓库实际状态一一对应（版本号、文件路径可复核）
- 移植阶段：按 playbook 门槛执行（typecheck + oxlint + CI 全绿），`Ported-from` 可在本地镜像 `git show` 复现
- 从仓库根运行 `openspec validate upstream-port-first-batch --strict` 通过
