# Tasks

## Implementation Commits

- `6b7768e7` chore(sdk): 再生成 upgrade 契约 SDK 产物消除漂移
- `11db170b` fix(opennovel): 恢复升级消费闸门对全局暂停的响应
- `4cd710e6` test(opennovel): 适配 session.remove 幂等语义

## 1. 再生成 SDK 产物

- [x] 1.1 在仓库根运行 `bun script/generate.ts` 完成完整再生成（legacy SDK、openapi.json、prettier），核对漂移字段与 CI 失败日志一致（upgrade 进度 / 收编 / retry 相关）；验证：`git diff --stat` 仅包含 `packages/sdk/js/src/v2/gen/types.gen.ts` 与 `packages/sdk/openapi.json`

## 2. 修复升级消费闸门回归

- [x] 2.1 修复 `packages/opennovel/src/novel/manual-edit-sync-worker.ts` 消费闸门判断：查询全局闸门（`getUpgradeGate`），全局 paused 或活跃 run paused 任一成立即跳过 upgrade 来源任务（保留 pending，下轮重查）；验证：`cd packages/opennovel && bun test test/upgrade-worker.test.ts` 全部通过
- [x] 2.2 更新 `packages/opennovel/test/server/httpapi-session.test.ts`「returns declared not found errors for read routes」用例，将 session.remove 从 not-found 断言中移除（该路由已幂等返回成功）；验证：`cd packages/opennovel && bun test test/server/httpapi-session.test.ts` 中该用例通过

## 3. 回归验证

- [x] 3.1 运行 `packages/opennovel` 全量测试确认无其他回归；验证：全部通过
- [x] 3.2 以与 CI 等价方式复跑根再生成校验 `bun script/generate.ts && git diff --exit-code`；验证：exit 0、工作树无新增漂移
- [x] 3.3 运行 `packages/opennovel` 与 `packages/sdk` 的 `bun typecheck`；验证：全部通过

## Workflow follow-up

- 实现提交遵循仓库约定：conventional commit + `OpenSpec-Change: fix-ci-red` footer。
- 合并前刷新本地 `main`，优先 `git merge --ff-only`；推送后确认 generate 与 test 工作流转绿再归档。
- 闸门回归（ab22e40e8）与 generate 漂移（43b424240）属 upgrade-reliability 实施期遗留，归档后按「归档后收尾修复」惯例在其归档 tasks.md 补录关联说明。
