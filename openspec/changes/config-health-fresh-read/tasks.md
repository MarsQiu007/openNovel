# Tasks

## 1. 实现直读接口与健康端点接入

- [x] 1.1 `Config.Service` 接口与实现新增 `getGlobalFresh()`：复用 `loadGlobal` 装载器直读，不读不写缓存，失败回退空配置（与缓存路径同容错语义）。验证方式：`packages/opennovel` 相关单测通过
- [x] 1.2 全局健康端点接入：`evaluateConfigHealth` 的 `info` 与 `configHealthFix` 的 `draft` 改用 `getGlobalFresh()`。验证方式：`packages/opennovel` 相关单测通过

## 2. 决定性复现测试

- [x] 2.1 新增单测：缓存已填充后外部直写配置文件引入新漂移（agent 覆盖指向未知提供商），健康端点必须报告该漂移——即 2026-11-05 CI flake 的决定性复现，修复前必挂、修复后必过。验证方式：单测在未接入 getGlobalFresh 的旧实现上确认失败（临时回退验证或等价手段），接入后通过
- [x] 2.2 穷举关联面：检查 `packages/opennovel` 内所有 `Layer.mock(Config.Service, ...)` 与手写 Config 服务桩，补齐 `getGlobalFresh`；确认无第二处对健康评估数据源的缓存依赖。验证方式：grep 审计 + 全量测试通过

## 3. 收尾检查

- [x] 3.1 `packages/opennovel` 通过 `bun typecheck` 与全量 `bun test`；从仓库根以同模式运行 oxlint 对比基线无新增告警。验证方式：命令退出码为 0
- [x] 3.2 本地跑通 httpapi exerciser 的 effect 模式（或至少 coverage 秒级预检 + 定向场景），确认 `global.config.health` 确定性通过。验证方式：exerciser 输出 `global.config.health` PASS 且无 fail

## Workflow follow-up

- 实现提交收集：归档前运行 `git log --grep "OpenSpec-Change: config-health-fresh-read" --format="%h %s"` 写入本文件 Implementation Commits
- 归档流程：`openspec validate config-health-fresh-read --strict` → 同步 delta specs 至主 specs → `openspec archive` → 合并 main 并确认 CI 全绿 → 清理分支

## Verification 记录

- 2.1 决定性复现：新单测 `httpapi-global-health.test.ts` 在未接入 `getGlobalFresh` 的旧实现上确认失败（`agent-model:ghost` 断言挂，0 pass/1 fail），接入后通过；断言改用 `expect.arrayContaining` 与同族测试风格一致且无 oxlint 告警
- 3.1 进度：`bun typecheck` 通过（期间补齐 `test/fixture/config.ts` 手写桩的 `getGlobalFresh`，系 2.2 mock 审计的一部分）；oxlint 仓库根同模式对比基线无新增告警（config.ts 三处既有告警在 main 上同样存在，新测试文件 0 告警）
- 3.2 记录：coverage 模式 315/315 通过；effect 模式 `--include "global.config.health"` 定向 2/2（health + health/fix）PASS。全量 effect 模式本机 Windows 无 PTY 场景 OS 门控（CI 仅 Linux 运行），按任务书允许以 coverage 预检 + 定向场景代替
- CI 佐证：修复实现期间 flake 于 run 42015932786 第 3 次 attempt 复现（effect 模式 fail=1，恰为 `global.config.health`），与本提案根因判断一致
