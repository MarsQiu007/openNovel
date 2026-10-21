# Proposal: v1-removal

> v1-retirement-roadmap 第③格。前置：runtime-v2-cutover（第②格）已落地——产品无生产路径依赖 V1 运行时。本 change 清理历史数据与残留代码，V1 从仓库消失。

## Why

第②格后 V1 只剩两样东西：历史 V1 会话数据（V1 消息形状，V2 面读不了）与 `core/src/v1` 数据类型、`opennovel` V1 session 面的死代码。死代码留着会继续被误引用；历史数据不迁移则用户看不到自己已写的小说会话记录。已定案不做运行时只读兼容垫片——一次性数据迁移 + 删码。

## What Changes

- **历史会话数据迁移**：上游 `v1-migration.bun.ts` 模式移植——V1 session / message / part 数据迁进 V2 存储（V2 session 表 + V2 消息形状），工具名在迁移中改写。fork 两代工具名基本同名（bash / apply_patch 均未跟随上游改名），实际改写项以 fork V1/V2 名称差全量核对为准（已知一项：`task` → `subagent`）；迁移幂等、可中断重跑
- **V1 数据类型与代码删除**：删 `core/src/v1/`（config / permission / session 数据类型及 V2 对其的引用改造——V2 config 已在运行时切换后无 V1 引用，本格核清残余）、`opennovel` V1 session 面（prompt 循环、agent 系统、task 工具残留引用）
- **迁移后验证**：历史会话在 V2 面可查看（消息 / 工具调用 / 父子关系完整），全仓 `bun typecheck` / test / CI 绿

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runtime-v2`：历史数据迁移与 V1 代码摘除（skip_specs 阶段不产出 delta）

> `skip_specs: true`。

## Impact

- **受影响包**：`core`（v1 数据类型删除、迁移脚本）、`opennovel`（V1 面删除）、`app`（历史会话查看路径核对）
- **数据兼容性**：V1 历史数据迁移后原表保留（不删行原则，仅代码不再读取）或按迁移脚本设计处理（design 阶段定）；迁移失败可重跑
- **依赖关系**：前置 runtime-v2-cutover；上游参照 `v1-migration.bun.ts`（基线 `9d90d892dc`）
- **风险**：数据迁移是本仓库首次对历史数据做形状转换——迁移脚本需在真实数据副本上演练后再上线

## 非目标

- 不改 V2 运行时行为（纯清理 + 迁移）
- 不迁移非会话类 V1 数据（config 已在 V2 文件态，permission 规则随会话迁移或按 design 阶段结论处理）
- 不做任何 V1 代码的只读兼容保留
