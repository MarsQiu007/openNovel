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

> **待回填**。调研任务完成后，此节由实现者更新：每个通过评估的候选写明移植落点、适配点（若有）、验证方式；被证伪的候选写明证伪原因。移植提交遵循 playbook：独立提交、body `Ported-from: <40 位 SHA>`、受影响包 `bun typecheck` + oxlint 必过。

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
