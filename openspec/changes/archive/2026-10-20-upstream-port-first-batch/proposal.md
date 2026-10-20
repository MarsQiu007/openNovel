# Proposal: upstream-port-first-batch

## Why

`upstream-sync-baseline` 与 `upstream-sync-playbook` 两个先行 change 建立了基线事实与移植流程，但流程从未跑过。本变更是 playbook 的**首次实跑**，选择两个结构隔离、风险最低的候选验证流程可行性；同时通过调研任务修正候选清单——探索阶段（2026-10-20）已发现原候选 `streamUsage` 兼容（49f52ff2d5）依赖 fork 不存在的 `packages/ai`，必须降级，这类误判只有在实跑调研中才会暴露。

## What Changes

- **阶段一（调研，先行）**：
  1. 核实 Playwright 版本提升修复（上游 23a33abad4，`bun install` 在 Node 24.16+ 安装挂起）对 fork 的影响面：fork 根/各包 `package.json` 的 Playwright 版本、是否命中同版本区间、本地是否可复现安装挂起
  2. 梳理 fork 侧 models.dev 数据流：上游为 `packages/core/src/models-dev/snapshot.txt`（目录形态），fork 为 `packages/core/src/models-dev.ts` + `plugin/models-dev.ts`（单文件形态），查明 fork 如何拉取/缓存/消费 models.dev 模型数据，确定"数据刷新"的正确落点
  3. 调研结论回填本 change 的 design.md；若某候选被证伪（如 fork 未命中 Playwright 挂起版本），记录原因并从清单移除
- **阶段二（移植，调研后定案）**：按调研结论移植通过评估的候选，遵循 playbook：独立提交、body 带 `Ported-from: <40 位 SHA>`、受影响包 `bun typecheck` + oxlint 必过
- 已知候选清单（以调研结论为准，不预设全部成立）：
  - `23a33abad4` — chore: bump Playwright past the Node 24.16+ install hang
  - `6e9c85390b` — chore(core): refresh bundled models.dev snapshot（数据层面追平，代码形态保持 fork 现状）

## Capabilities

### New Capabilities

（无——候选均为工程层修复与数据刷新，无运行时行为变化；若调研发现某候选改变行为，则移除 `skip_specs` 并补充对应 specs 工件）

### Modified Capabilities

（无）

> 当前以 `skip_specs: true` 声明：两个候选经探索评估均为非行为变更（devDependency 版本调整、静态数据快照）。此声明是**条件性**的——阶段一调研若推翻该判断，先更新本元数据再继续实现。

## Impact

- **受影响的包**（预期，以调研定案为准）：
  - 根 `package.json` 或相关包的 Playwright 版本声明（工程层）
  - `packages/core`（models.dev 数据文件；若数据流涉及 `plugin` 则同步说明）
- **不受影响**：`novel-store` / `app` / `desktop` / `opennovel` 等业务包；无 API 契约变更，无需重新生成 SDK
- **数据兼容性**：models.dev 快照为静态模型目录数据，刷新不涉及本地数据模型迁移
- **依赖关系**：依赖前两个 change 归档（流程与事实文档先行）；候选清单来自 2026-10-20 探索记录与本地镜像 `D:\AI\Codes\opencode`

## 非目标

- 本变更**不移植** `streamUsage` 兼容（49f52ff2d5）——依赖 fork 不存在的 `packages/ai` 协议层，属 `ai-package-alignment` 调研范畴
- 本变更**不引入** 上游 `packages/ai` 或任何新包结构
- 本变更**不移植** 任何触碰 fork 自有设计（location、system-context、V2 session）的上游改动——playbook 拒绝条件适用
- 本变更**不建立**自动化快照刷新机制——手工移植跑通后再议
