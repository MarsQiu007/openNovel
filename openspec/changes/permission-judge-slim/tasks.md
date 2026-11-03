# Tasks

## 1. Core 配置面收敛

- [x] 1.1 删除 agent 级与项目级裁判模型解析：改造 `packages/core/src/permission/judge.ts` 的 `resolve` 只读 `scoped.user?.judge?.model`，移除 `PermissionPolicy.agentConfig` 依赖；保留 `selectModel` 纯函数及其单测。验证：`packages/core` 目录 `bun typecheck` 通过、裁判相关测试通过。
- [x] 1.2 策略表退为内置单查：改造 `packages/core/src/permission/policy.ts` 删除 `agentConfig` 与多级 `resolve`，`resolve(action)` 只查 `defaults`；删除 core 侧 UI 镜像同步注释。验证：`bun test test/permission-policy.test.ts` 通过（覆盖用例收缩为内置表用例，`agentConfig` describe 删除，`selectModel` 用例保留）。
- [x] 1.3 删除 agent 级 mode/policy 消费：改造 `packages/core/src/permission.ts` 的 `evaluateInput`，移除 agentConfig 查找，`resolveMode` 只收全局与项目级。验证：`bun test test/permission.test.ts` 通过。
- [x] 1.4 删除 V2 policy 字段与迁移透传：`packages/core/src/config/permission.ts` 的 Info 删 `policy`；`config/v1/permission.ts` 保留接受 `policy` 键；`config/v1/migrate.ts` 的 `permission()` 不再透传 policy、`migrateAgent` 不再产出 agent 级 permission，规则构建器继续跳过 `policy` 键。验证：`bun test test/config/config.test.ts` 通过，改写"含 policy 键的 V1 文件解析不失败且不透传"与"agent 级 permission 不再产出"断言。
- [x] 1.5 删除 V2 agent 裁判配置段：改造 `packages/core/src/config/agent.ts` 删除 Agent 的 `permission` 字段，全仓 grep 确认无其余消费方。验证：`packages/core` 目录 `bun typecheck` 通过。
- [x] 1.6 清理 core 侧死代码：全仓 grep 确认 `permission.policy`、agent 级 `permission.mode` 无其余消费方；在 `packages/core` 运行 `bun typecheck`。

## 2. 契约确认

- [x] 2.1 从仓库根运行 `bun ./script/generate.ts` 再生 openapi.json 与 JS SDK 类型，确认产物零 diff（SDK 类型为 V1 on-disk 形状，继续承载存量键接受面，V2 瘦身不落 SDK）。验证：`git status` 无 sdk/client 生成物变化。
- [x] 2.2 确认 `packages/client` 无需 `bun run generate`（无协议变更）；在 `packages/client` 运行 `bun typecheck` 通过。

## 3. App 界面收敛

- [x] 3.1 精简设置页权限区：改造 `packages/app/src/components/settings-v2/permission.tsx`，删除裁判模型选择器与策略表区块，只留模式行与项目级标注；删除 `packages/app/src/context/permission-policy.ts` 及其全部 import。验证：`packages/app` 目录 `bun typecheck` 通过。
- [x] 3.2 改造智能体面板：改造 `packages/app/src/components/settings-v2/agents.tsx`，删除每行裁判下拉与「裁判」徽标（含 `pendingJudge` 等状态），在智能体列表之外独立渲染内置"权限裁判"行（不参与过滤排序，只读、仅模型选择器，读写全局 `permission.judge.model`，沿用空串清除约定）。验证：面板渲染单测/手动渲染通过，`bun typecheck` 通过。
- [x] 3.3 同步 i18n 三语文案：新增裁判行行名/描述键，删除策略表与旧裁判模型选择器文案键（`settings.permission.judgeModel.*` 语义迁移到裁判行，`settings.permission.policy.*` 删除）。验证：`bun test --preload ./happydom.ts ./src` 通过（含 i18n parity 测试，三文件键集合一致）。

## 4. 测试与收尾

- [x] 4.1 更新受影响测试：core 的 permission / permission-policy / test/config/config.test.ts（V1 迁移用例）同步；opennovel 的 test/config/config.test.ts 验证不改即通过（policy 在 V1 存储层回读、不被消费）；检查 opennovel httpapi 练习场景是否书写 `permission.policy`，命中则同步移除。验证：相关包目录 `bun test` 通过。
- [x] 4.2 全量校验：在 `packages/core`、`packages/app`、`packages/opennovel` 运行 `bun typecheck`；从仓库根运行 oxlint。验证：全部通过且无新增告警。
- [x] 4.3 检查未引入同类、冗余、无用代码：确认被删配置键无残留引用、失效的 FOLLOW_VALUE 共用已清理、无死 import，命中即在本 change 内清理。

## Implementation Commits

- 9962f44b74 feat(core): 权限裁判配置面收敛，删除 agent 级覆盖与策略表配置
- c5b6c6d192 feat(app): 裁判模型入口收敛为智能体面板内置权限裁判行

实现期验证记录：core 全量 1275 用例通过（1 个 location-layer 模型目录用例为本机 models 缓存环境 flake，与本 change 无交）；app 全量 918 用例通过（含 i18n parity）；opennovel config 107 用例不改即通过；根 `bun ./script/generate.ts` 产物零 diff；core/app/opennovel/client 四处 `bun typecheck` 通过；oxlint 0 errors 且变更文件无新增警告。

## Workflow follow-up

- 归档前用 `git log --grep "OpenSpec-Change: permission-judge-slim"` 收集实现提交写入本文件 Implementation Commits。
- 归档时先同步 delta specs 至 `openspec/specs/permission-llm-judge` 与 `openspec/specs/permission-judge-config-ui`，再运行 `openspec validate permission-judge-slim --strict` 与归档命令。
