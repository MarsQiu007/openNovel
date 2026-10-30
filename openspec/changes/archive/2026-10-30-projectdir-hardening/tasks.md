# Tasks

## 1. 解析实现与单测

- [x] 1.1 将 `packages/plugin/src/novel-writer/tools/shared.ts` 的 `projectDirFromCtx` 化简为 `return directory ?? process.cwd()`，清理随之未使用的 import（`dirname`/`join`/`getDbPath` 以实际为准）。验证：`bun typecheck` 通过。
- [x] 1.2 新增解析单测（放在现有 novel-writer 测试目录，如 `test/novel-writer/project-dir-resolution.test.ts`）：断言恒等语义（任意 directory 返回自身）、`OPENNOVEL_DB` 设为任意路径时结果不变、null 回退 `process.cwd()`；env 用例内保存/恢复（仿 chapter-sequential-gate.test.ts 的 prevEnv 模式），不触碰真实 fs/db。验证：从 `packages/plugin` 目录 `bun test test/novel-writer/project-dir-resolution.test.ts` 通过。

## 2. 行为级回归与整体验证

- [x] 2.1 新增 env 误设行为回归测试（复用 chapter-sequential-gate 测试装配模式，临时目录 + 全工具装配）：故意把 `OPENNOVEL_DB` 指到与 projectDir 不同层级（复现原误设场景），写入 review 模式配置与未通过前置章，断言 `write_chapter` 仍被顺序门禁拦截（配置从正确项目根读取）。验证：从 `packages/plugin` 目录测试通过，且测试临时目录无残留写入 CWD。
- [x] 2.2 整体验证：从 `packages/plugin` 目录 `bun typecheck` 与 `bun test test/novel-writer/` 全族通过；从仓库根对改动文件 `bunx oxlint` 无新增告警；复核 `project-dir-resolution` spec 两个 requirement 的全部 scenario 均有对应实现行为或测试断言。

  > 验证记录（2026-10-30）：`bun typecheck` 通过；`bun test test/novel-writer/` 全族 956 pass / 0 fail（含 project-dir-resolution.test.ts 4 用例：解析 3 + 行为回归 1，行为回归在修复前分支基线上实测失败、合并门禁实现后通过，完成红绿闭环）。`bunx oxlint` 改动文件 0 errors；4 个警告均为既有家族形态（3 个 await-thenable 位于 shared.ts 既有查询代码，1 个 no-unsafe-type-assertion 与已合入 main 的 chapter-sequential-gate.test.ts 同款断言写法）。spec 复核：2 requirement / 3 scenario 均有对应测试断言。

## Implementation Commits

- ffbdead462 fix(plugin): projectDirFromCtx 与 db 路径重定向解耦

## Workflow follow-up

- 归档前收集实现提交写入 `## Implementation Commits`，`openspec validate projectdir-hardening --strict` 通过后按仓库归档流程执行。
