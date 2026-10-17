# Proposal

## Why

main 的 generate 与 test 工作流连续多个提交保持红（Windows / Linux 双平台同点位失败，已排除 flake），经本地逐提交复现定位到三个根因，均为「行为变更后验证不完整」：

1. `43b424240`（升级端点改为 run 驱动聚合）改了 server HttpApi 响应 schema，漏跑根 `script/generate.ts` 完整再生成，legacy SDK 与 openapi.json 漂移（generate 红）。
2. `ab22e40e8`（worker 消费回写 run 章节状态与心跳）把消费闸门判断从全局闸门改为仅看活跃 run 的 paused 状态，导致全局闸门暂停时 worker 仍消费 upgrade 任务，违反 derived-data-upgrade 既有契约「用户暂停升级后 worker SHALL 停止消费 upgrade 来源任务，队列条目保留」（升级消费闸门回归，upgrade-worker.test.ts「闸门 paused」用例稳定失败）。
3. `80697fc1d`（session.remove 幂等返回成功）未同步更新 not-found 契约用例的断言（httpapi-session.test.ts 稳定失败）。

main 持续红会掩盖后续提交的真实回归，需立即修复。

## What Changes

- 运行根 `script/generate.ts` 完整再生成（legacy SDK types、openapi.json、prettier 格式化），消除 generate 工作流漂移。
- 修复 `packages/opennovel/src/novel/manual-edit-sync-worker.ts` 消费闸门判断：全局升级闸门（`UpgradeStateTable.gate`）为 paused **或** 活跃 run 为 paused 时，均跳过 upgrade 来源任务（保留 pending），恢复 derived-data-upgrade 的「暂停保留队列」契约。
- 更新 `packages/opennovel/test/server/httpapi-session.test.ts`「returns declared not found errors for read routes」用例，将 session.remove 从 not-found 断言中移除（该路由已幂等返回成功）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——闸门修复是恢复 derived-data-upgrade 的既有需求文本契约（「暂停保留队列」场景），不新增、不修改需求表述；再生成产物与测试断言同步也不产生 spec 级需求变化，故声明 `skip_specs: true`。）

## Impact

- **packages/opennovel**：`manual-edit-sync-worker.ts` 闸门判断修复（运行时行为变更：全局暂停恢复生效）；`test/server/httpapi-session.test.ts` 断言更新。
- **packages/sdk**：`packages/sdk/js/src/v2/gen/types.gen.ts` 与 `packages/sdk/openapi.json` 为再生成产物（upgrade 进度 / 收编 / retry 相关字段），随脚本输出提交。
- **无数据模型变更**：再生成字段在 server 端实现中已生效，本次仅同步产物；闸门修复不改变存储结构。
- **兼容性**：全局闸门暂停在 UI（upgrade-banner 的暂停按钮）已存在，修复后暂停恢复对用户生效，属恢复既有功能而非新行为。
- **风险**：低——漂移产物与 CI 失败日志 diff 已比对一致；闸门修复方向与 derived-data-upgrade spec 场景「暂停保留队列」一致。

## 非目标

1. 不改动 server 端升级对账 / 收编逻辑（ff6242ce7、250bb9a18 的行为即既定行为）。
2. 不重构 upgrade-worker 或 httpapi-session 测试结构，仅修复闸门判断与更新冲突断言。
3. 不处理 main 上 e2e (windows) 的历史失败（独立问题，不在本次范围）。
4. 不改 CI workflow 定义（generate 的 `git diff --exit-code` 校验保持不变）。
